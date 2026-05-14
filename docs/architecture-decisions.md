# Maritime Intelligence / AIS Tracking System — Architecture Decisions

This document is the consolidated decision log produced from the design interview.
It is the spec implementation should be measured against. When a decision needs to
change, update this file in the same PR.

---

## Scale envelope

- **~200 msg/s average, ~1k msg/s peak** (Black Sea bbox, AISStream filtered).
- All architectural decisions lean toward simplicity at this scale.
- No premature scaling infrastructure.

## Messaging

- **Redis Streams** behind an abstract `EventBus` interface.
- Migration path to RabbitMQ documented but not built for MVP.
- Streams:
  - `ais.events.v1` — canonical position/static events.
  - `vessel.enriched` — enrichment results.
  - `ais.deadletter` — poison messages.
- Stream trim: `MAXLEN ~ 100k` (configurable).
- Redis AOF `appendfsync everysec`. Up to ~1s of in-flight loss tolerated; AIS is
  a continuous live stream and short gaps self-heal.

## Pipeline topology (Topology A)

In-process inside the ingestion role:

```
Provider Connector → Raw Filter → Normalizer → Dedup/Sampler → Publisher
                                                                  │
                                                          ais.events.v1
                                                                  │
        ┌─────────────────────────────┬─────────────────────────────┐
        ▼                             ▼                             ▼
  storage-writer            realtime-gateway            enrichment-dispatcher
  (Postgres)                (WebSocket fanout)          (BullMQ jobs)
```

- Single Nest app, multi-role via `PROCESS_ROLE=all|api|ingestion|worker`.
- Same Docker image, different bootstrap path. Roles are the future
  microservice-extraction boundary.

## Canonical event contract

Two event kinds published on `ais.events.v1`, discriminated by `kind`:

- `position` — from `PositionReport`, `StandardClassBPositionReport`.
- `static` — from `StaticDataReport`, `ShipStaticData`.

All other AIS message types are filtered at the Connector layer and never
enter the canonical pipeline.

Every event includes `schemaVersion`. Zod-validated. Unknown major version
on the consumer side → DLQ.

## Identity

- `vessels.id` is an **internal UUID** (PK).
- `mmsi` is the indexed operational/runtime key.
- `imo` is nullable, indexed; populated when static data carries it.
- Connector drops messages whose MMSI is not 9 digits or that come from
  non-vessel sources (base stations, technical messages).

## Deduplication & sampling

Both happen inside the Normalizer layer **before publishing** to the stream,
so all consumers see a clean, consistent feed.

- **Dedup**: `(mmsi, occurredAt)` via Redis last-seen state, ~10 min TTL.
- **Sampling** (position events only):
  - moving vessels: max 1 update per MMSI per 10 seconds
  - stationary vessels (`sog < 0.5 kn`): max 1 update per MMSI per 60 seconds
- **Bypass**: a position event always passes through if `navStatus` changed,
  even inside the sampling window.
- Static events are **never** sampled.
- Drop reasons exposed as metric: `ais_messages_dropped_total{reason="duplicate"|"sampled"|"out_of_bbox"|"non_vessel_mmsi"|"invalid"}`. `out_of_bbox` is reserved for a future in-process bbox check; today the provider subscription enforces the bbox upstream.

## Storage

Three tables, three access patterns:

- `vessels` — identity, profile, enrichment results.
  - PK `id` (uuid). Indexed: `mmsi` (unique), `imo`.
- `vessel_positions_latest` — current state, one row per vessel, fast bbox reads.
  - `position geometry(Point, 4326)` + GIST index.
  - UPSERT target.
- `vessel_positions_history` — append-only, daily UTC range partitioning.
  - First-party lifecycle management; no `pg_partman` for MVP.
  - Startup-safe and scheduled maintenance create today + next 7 days and drop
    partitions older than retention.
  - Unique `(vessel_id, occurred_at)` index supports idempotent replay and
    vessel/time track queries. No history GIST index until history spatial
    queries exist.

Storage writer first applies the retained telemetry window as business policy.
AIS position/static events older than retention are treated as expected stale
telemetry: they increment `history_events_dropped_total{reason="too_old"}`, emit
a structured log, and return before any DB transaction. The guard intentionally
lives at the storage boundary, where stale history can otherwise target dropped
daily partitions; enrichment dispatch keeps its normal lightweight lookup/job
decision path.
Current position events then perform vessel identity UPSERT, `_latest` UPSERT,
and `_history` INSERT in a **single DB transaction**. The latest-position
timestamp guard remains as a secondary replay/out-of-order protection inside
the retained window.

PostGIS column type is `geometry(Point, 4326)` (not `geography`). Justification:
the primary use case is bbox queries within the Black Sea region; geometry is
the natural fit for `ST_MakeEnvelope` and web-map coordinates. Cast to geography
in specific queries that need accurate distance-in-meters.

Defaults (configurable):

- History retention: 7 days + 1 safety day.
- History partition precreate window: today + next 7 days.
- History partition maintenance: startup and daily at 00:05 UTC.
- `_latest` staleness filter: 24 hours (vessels not seen in 24h excluded from
  bbox queries; not deleted).

## Realtime delivery

- WebSocket from day one. Raw `ws`, not Socket.io.
- Endpoint: `/ws/positions`.
- Client → server messages: `subscribe` only. The backend owns coverage and
  streams the supported global feed to subscribed clients.
- Server → client messages: `position`, `static`, `vessel.enriched`, `error`.
- REST `GET /api/vessels` provides the startup snapshot for the full supported
  coverage set.
- Frontend keeps the snapshot in a store; pan/zoom changes camera only and does
  not trigger REST refetches for the main marker layer.
- Per-connection bounded send queue. On overflow: drop oldest position events
  per vessel (newer position supersedes older); never drop static events.
- 30-second heartbeat ping.
- Realtime gateway holds the subscribed connection set.

Future scaling (not in MVP): insert a Redis pub/sub channel between the
consumer-group worker and WS fanout pods to scale fanout independently.

## Sanctions (ETL, not runtime API)

For MVP, sanctions data is **imported and matched locally**, not queried
per-vessel via an external API.

Sources for MVP:

- **OFAC SDN consolidated** (XML, public domain).
- **OpenSanctions vessels bulk** (CSV/JSON, CC-BY-NC 4.0, free for
  non-commercial portfolio use; attribution required in README/UI).
- EU consolidated list — **dropped from MVP**.

Architecture:

- `SanctionsSourceAdapter` interface — one implementation per source.
- Daily BullMQ scheduled job per source: download → parse → extract vessel
  entities → upsert into `sanctioned_entities`.
- `sanctions_import_runs` table records each import (source, started_at,
  finished_at, status, records_imported, errors).

Tables:

- `sanctioned_entities` — `(source, source_entity_id)` unique; indexed on
  `imo`, `mmsi`, `name`; stores aliases, flag, listing date, raw payload.
- `sanctions_import_runs` — audit / observability.

Per-vessel enrichment:

- `enrichment-dispatcher` consumes `ais.events.v1`, decides whether to enqueue
  a job. Triggers:
  - new MMSI discovered;
  - profile change (IMO/name learned or changed);
  - staleness — `sanctions_checked_at` older than 7 days.
- Jobs run on BullMQ queue `enrichment.vessel` with exponential backoff.
- Idempotency: `jobId = enrich:{vessel_id}:{trigger_reason}:{trigger_payload_hash}`,
  guarded by `WHERE sanctions_checked_at IS NULL OR sanctions_checked_at < $`.
- Matching strategy (exact only for MVP):
  1. IMO match.
  2. MMSI match.
  3. Normalized name match (lowercase, strip punctuation, collapse spaces) —
     candidate / manual-review signal.
- On successful update, publish `vessel.enriched` event to Redis Stream.

Two BullMQ queues: `sanctions.import` and `enrichment.vessel`.

## Provider abstraction

Two-part contract — keeps transport and semantics independently swappable:

- `AisProviderAdapter` — transport boundary. Connect/reconnect, auth,
  provider-specific subscription format, health, backoff. Produces
  `RawProviderMessage` events. **Provider-scoped raw filtering is the
  adapter's job**: AISStream's `MessageType` / `MetaData.MMSI` envelope is
  not portable, so each adapter owns its own filter (e.g.
  `AisStreamRawFilter`) and increments
  `ais_messages_dropped_total{reason}` on rejects. Only accepted raw
  messages are emitted into the pipeline.
- `ProviderNormalizer` — semantic boundary. Converts `RawProviderMessage`
  into canonical `position` / `static` events. Co-located with its
  adapter under `ingestion/<provider>/`.
- `ProviderRegistry` — resolves `AIS_PROVIDERS` env into a fixed set of
  `(adapter, normalizer)` pairs at construction. Throws on unknown ID.
  Owns adapter lifecycle and the provider-health metric refresh loop.

For MVP: single active provider, AISStream. Reconnect with exponential
backoff (1s → 2s → 4s → 8s → 16s, capped at 30s, ±20% jitter). Backoff
attempt counter resets only after the **first raw message** received
post-connect, not on socket open. Health surface:
`{ connected, lastMessageAt, reconnectCount, startedAt }`.
Degraded-feed signal in `/readyz` payload (`feedDegraded: true`) when any
provider has no message after `PROVIDER_FEED_DEGRADED_SECONDS`
(default 60); readiness still returns 200.

Provider selection is env-driven: `AIS_PROVIDERS=aisstream`. Adding another
provider means dropping a new `ingestion/<provider>/` folder
(adapter + normalizer + raw filter) and registering it in
`IngestionModule` — no pipeline changes.

No automatic failover in MVP. Multi-active is a free side-effect of the
existing dedup logic if a second adapter is started.

## Failure handling

Stream-consumer poison messages (per consumer group):

- On handler success: `XACK`.
- On handler error: increment retry counter (Redis hash, keyed by
  `streamId:consumerGroup`). Leave message unacked for re-delivery via
  pending-message claim.
- After 3 failed attempts: publish to `ais.deadletter` with metadata
  (original event, consumer group, error, attempts, first-failed-at,
  last-failed-at), then `XACK` original to unblock the group.

`XAUTOCLAIM` background task per consumer group recovers stuck pending
messages from dead/slow consumers.

DLQ never auto-replays. Admin endpoints provide listing and manual replay.

Structured logging on DLQ events: reason, consumer group, event type, mmsi.

Database write failures: storage-writer's transaction-wrapped write rolls
back; message goes through the same retry/DLQ flow.

Backpressure: producer never blocks (Redis Streams buffer). Per-group lag
exposed as metric. Approximate trim at `MAXLEN ~ 100k` (configurable).

## API surface

Public REST:

- `GET /api/vessels?limit=N&staleMinutes=M` — latest snapshot from
  `vessel_positions_latest`, joined to profile and sanctions status and filtered
  to supported coverage.
- `GET /api/vessels/:id` — full profile, current position, sanctions detail.
- `GET /api/vessels/:id/track?from=ISO&to=ISO&simplify=N` — historical
  positions. Max window 7 days. Either downsampled points or a server-side
  simplified `LineString` (`ST_SimplifyPreserveTopology` operates on the
  LineString geometry, not on raw points).
- `GET /api/sanctions/sources` — provenance + last import run summary.
- `GET /healthz` — liveness.
- `GET /readyz` — DB + Redis reachable. AIS feed staleness reported as
  degraded in the payload but does not flip readiness (provider downtime
  is not application failure).
- `GET /metrics` — Prometheus.

WebSocket:

- `WS /ws/positions` — see Realtime section.

Admin (gated by `ADMIN_TOKEN`, required outside local dev):

- `GET /admin/deadletter?stream=...&limit=...`
- `POST /admin/deadletter/:id/replay`
- `GET /admin/sanctions/imports`
- `POST /admin/sanctions/imports/:source/run`
- `GET /admin/streams` — consumer group lag, pending counts.

Standards:

- All input validated with **Zod** (REST, WS, env config, canonical events).
- Error envelope: `{ error: { code, message, details } }`.
- Hard limits: max bbox result size, max track window 7 days, `from < to`
  validation, explicit error for out-of-Black-Sea bbox queries.

No public/end-user auth in MVP. Production extension noted as future work.

## Observability

- **Prometheus + Grafana** in `docker-compose`. Pre-built Grafana dashboard
  JSON committed to the repo — this is the headline portfolio artifact.
- **pino** structured JSON logs. Correlation fields on every line: `traceId`,
  `mmsi`, `vesselId`, `streamMessageId`, `consumerGroup`, `provider`.
- No log aggregator (Loki/ELK) in MVP. `docker compose logs | jq` is enough.
- No OpenTelemetry / distributed tracing in MVP. Mentioned as future work.

Headline metrics:

- Ingestion: `ais_messages_received_total{provider}`,
  `ais_messages_dropped_total{reason}`, `ais_provider_connected{provider}`,
  `ais_provider_last_message_age_seconds{provider}`,
  `ais_provider_reconnects_total{provider}`.
- Pipeline: `ais_events_published_total{stream,kind}`,
  `ais_stream_consumer_lag{stream,group}`,
  `ais_stream_consumer_pending{stream,group}`,
  `ais_stream_handler_duration_seconds{stream,group}` (histogram),
  `ais_stream_handler_errors_total{stream,group}`,
  `ais_deadletter_total{stream,reason}`.
- Storage: `db_query_duration_seconds{query}` (histogram),
  `db_writes_total{table}`.
- Enrichment: `enrichment_jobs_total{status}`,
  `sanctions_import_duration_seconds{source}` (histogram),
  `sanctions_import_records_total{source}`,
  `sanctions_matches_total{match_type}`.
- Realtime: `ws_connections_active`, `ws_messages_sent_total`,
  `ws_messages_dropped_total{reason}`, `ws_subscriptions_accepted_total`.
- HTTP: `http_request_duration_seconds{route,method,status}` (histogram).

## Module structure

Single repo, single Nest app, single Docker image. Multi-role via
`PROCESS_ROLE=all|api|ingestion|worker`.

```
src/
  main.ts                  # boots based on PROCESS_ROLE
  app.module.ts
  shared/                  # cross-cutting: redis, db, bus, config, logger, metrics, errors
  contracts/               # canonical event types + Zod schemas + schemaVersion
  ingestion/               # provider adapters + raw filter
  pipeline/                # normalizer, dedup, sampler, publisher
  storage/                 # Drizzle schema, repositories, storage-writer consumer
  enrichment/              # sanctions sources, importer, dispatcher, worker, matcher
  realtime/                # WS gateway, subscription, fanout consumer
  api/                     # public REST controllers
  admin/                   # admin REST, ADMIN_TOKEN guard
```

Hard rules:

- Cross-module imports go through `contracts/` and `shared/` only.
- `storage/` owns the Drizzle schema. Other modules use repository interfaces.
- `ingestion/` never touches canonical types. Normalization happens in `pipeline/`.
- `realtime/` does not read from the DB at runtime.

## Testing

TDD throughout. Tests are core deliverable, not afterthought.

- Unit tests: normalizer, dedup, sampler, matcher (per-source adapters).
- At least one integration/e2e test: fixture file → stream → storage,
  asserting end-to-end correctness.

## Frontend

Built after backend pipeline + API are stable. Minimal, MapLibre-based:

- Map with vessels (positions, sanctions badges).
- Vessel details panel/card.
- Route history visualization.

## MVP cut list

Cut from MVP up front:

- EU sanctions source.
- OpenTelemetry / distributed tracing.

Everything else stays unless real time pressure forces further cuts.

---

## Decision rationale (for interview narration)

- **Redis Streams over RabbitMQ for MVP**: Redis is already in the stack
  (dedup state, BullMQ); Streams provide consumer groups, retries, and
  pending-message visibility — enough for ~1k msg/s. Migration path to
  Rabbit preserved via `EventBus` interface.
- **EventEmitter explicitly rejected** even for MVP: no durability, no
  consumer groups, no real async boundary — undersells the event-driven
  architecture story.
- **ETL sanctions pipeline over runtime API calls**: stronger portfolio
  story (real ETL, normalization across heterogeneous sources, idempotent
  re-imports), faster runtime (local DB lookup, no per-vessel HTTP), and
  license-clean for portfolio use.
- **`geometry(Point, 4326)` over `geography`**: bbox-first workload, web
  map coordinates, natural fit with `ST_MakeEnvelope` + GIST. Cast to
  geography for distance queries when needed.
- **UUID PK for vessels, MMSI/IMO as operational fields**: MMSI can be
  reassigned over time; UUID provides stable internal identity decoupled
  from the upstream identifier lifecycle.
- **Raw `ws` over Socket.io**: Socket.io's room model doesn't fit
  continuous bbox subscriptions; we don't need its protocol features for a
  one-purpose position stream.
- **Single-image multi-role deployment**: makes "future microservice
  extraction" concrete, not aspirational. Each role is already runnable as
  its own process today.
