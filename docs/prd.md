# PRD — Maritime Intelligence / AIS Tracking System (MVP)

## Problem Statement

A user interested in maritime activity in the Black Sea has no easy way to see, in
near real-time, which vessels are operating in the region, what their movement
history looks like, and whether any of them appear on international sanctions
lists. Public AIS feeds carry the underlying data, but they arrive as a high-volume,
provider-shaped, noisy stream that is unusable without ingestion, normalization,
storage, enrichment, and a delivery channel suited to a map-based UI.

A solo developer also needs to demonstrate, in a portfolio-grade way, that they
can build production-shaped event-driven backend systems — not a CRUD app dressed
up as one. The problem is therefore twofold: deliver a useful maritime
intelligence product, and do it with architecture that holds up to interview
scrutiny.

## Solution

A modular Nest-based backend that ingests AISStream WebSocket data, filters it
to the Black Sea region, normalizes it into a canonical event contract,
publishes it to Redis Streams, fans it out to consumers (storage, realtime,
and post-persistence enrichment), and serves it via REST + WebSocket to a
MapLibre frontend. Storage emits `vessel.persisted.v1` only after a vessel write
succeeds; enrichment consumes that storage-confirmed fact, decides whether to
enqueue work, and falls back to a periodic unchecked/stale reconciler. Sanctions
data is brought in via ETL and matched locally to vessels by IMO / MMSI /
normalized name. Every architectural seam is documented and observable via
Prometheus + Grafana.

The system runs as a single Nest application that boots into one of several
roles (`api`, `ingestion`, `worker`, or `all`) selected via `PROCESS_ROLE`,
giving the codebase a modular-monolith shape today and a clean
microservice-extraction path tomorrow.

## User Stories

1. As a maritime analyst, I want to see all vessels currently active in the Black
   Sea on a map, so that I can understand the regional traffic picture at a glance.
2. As a maritime analyst, I want the map to update in near real-time as vessels
   move, so that I see fresh information without manually refreshing.
3. As a maritime analyst, I want the map to load only vessels in my current
   viewport, so that the experience stays responsive when I zoom out.
4. As a maritime analyst, I want to pan and zoom the map and have the live data
   subscription follow my viewport, so that I always get updates relevant to
   what I am looking at.
5. As a maritime analyst, I want to click a vessel and see its full profile
   (name, MMSI, IMO, type, flag, dimensions, destination, sanctions status), so
   that I can investigate it quickly.
6. As a maritime analyst, I want to see the historical track of a vessel over a
   time window, so that I can analyze its recent movements.
7. As a maritime analyst, I want vessels appearing on sanctions lists to be
   visually flagged, so that I can spot them immediately.
8. As a maritime analyst, I want to see _which_ sanctions sources flagged a
   vessel and when those sources were last refreshed, so that I can trust the
   information.
9. As an end user, I want stale vessels (not seen recently) to be excluded from
   the map by default, so that I am not looking at outdated positions.
10. As a developer/operator, I want to add a new AIS data provider by writing
    one adapter and one normalizer, so that the system is not coupled to
    AISStream.
11. As an operator, I want the system to keep working through transient AIS
    provider disconnects with automatic reconnection and exponential backoff,
    so that brief outages do not require human intervention.
12. As an operator, I want a degraded-feed indicator surfaced in metrics, logs,
    and the readiness payload, so that I can detect provider-side problems
    without restarting the application.
13. As an operator, I want exact-duplicate AIS messages to be dropped before
    they enter the pipeline, so that downstream consumers and storage are not
    polluted with redundant data.
14. As an operator, I want position updates to be sampled (10s for moving
    vessels, 60s for stationary), so that database write volume and realtime
    fanout traffic stay bounded.
15. As an operator, I want navigational-status changes to bypass sampling, so
    that critical state transitions (moored → underway, etc.) reach consumers
    immediately.
16. As an operator, I want messages that fail processing three times to land in
    a dead-letter stream rather than blocking the consumer group, so that one
    poison message cannot stall the pipeline.
17. As an operator, I want a list of recent dead-letter messages with their
    error context, so that I can diagnose failures.
18. As an operator, I want to manually replay specific dead-letter messages
    after fixing the underlying issue, so that no real data is lost.
19. As an operator, I want stuck pending messages to be auto-claimed from dead
    or slow consumers, so that consumer-group progress is resilient to crashes.
20. As an operator, I want consumer-group lag exposed as a metric, so that I
    can detect a slow consumer before the stream trim window evicts data.
21. As an operator, I want to trigger a sanctions data import out-of-schedule,
    so that I can refresh data after a known list update without waiting for
    the daily run.
22. As an operator, I want each sanctions import run recorded with timing,
    record counts, and errors, so that I can audit data freshness.
23. As an operator, I want admin endpoints protected by a static admin token
    (required outside local dev), so that operational controls are not exposed
    publicly.
24. As an operator, I want a `/healthz` endpoint that reflects only process
    liveness and a `/readyz` endpoint that reflects DB + Redis reachability,
    so that orchestration restarts only when restart will actually help.
25. As an operator, I want the AIS feed staleness reported as a degraded signal
    rather than failing readiness, so that an external provider outage does not
    cause unnecessary pod restarts.
26. As an operator, I want a Prometheus `/metrics` endpoint and a pre-built
    Grafana dashboard committed to the repo, so that I can see system health at
    a glance without bespoke setup.
27. As an operator, I want structured JSON logs with correlation fields
    (`traceId`, `mmsi`, `vesselId`, `streamMessageId`, `consumerGroup`,
    `provider`), so that I can trace one AIS message end-to-end via grep.
28. As an enrichment consumer, I want sanctions lists imported daily through
    source adapters (OFAC implemented, OpenSanctions planned) and stored
    locally, so that per-vessel matching does not require an external API call.
29. As an enrichment consumer, I want vessels matched against sanctions data
    by exact IMO, then exact MMSI, then exact normalized name, so that match
    quality is predictable and auditable.
30. As an enrichment consumer, I want a vessel re-evaluated against sanctions
    data when it is first discovered, when its profile changes, and when its
    last check is older than 7 days, so that status stays current without
    redundant work.
31. As an enrichment consumer, I want enrichment jobs to be idempotent, retried
    with exponential backoff, and rate-limited per source, so that flaky
    external work does not corrupt vessel state.
32. As an enrichment consumer, I want successful enrichments published as
    `vessel.enriched` events, so that downstream consumers (realtime, UI) can
    react to status changes without polling.
33. As a frontend developer, I want a REST snapshot endpoint that returns
    vessels in a bbox, so that the map can render the initial state quickly.
34. As a frontend developer, I want a single WebSocket connection with mutable
    bbox subscription, so that I can update the live filter as the user pans
    and zooms without reconnecting.
35. As a frontend developer, I want a vessel-detail endpoint with full profile
    and sanctions match information, so that I can render a side panel or
    modal with one request.
36. As a frontend developer, I want a vessel-track endpoint that returns
    either downsampled points or a simplified LineString, so that historical
    tracks render smoothly.
37. As a frontend developer, I want the track endpoint to enforce a maximum
    7-day window with a clear error when violated, so that I cannot
    accidentally request unbounded history.
38. As a frontend developer, I want WebSocket message types `position`,
    `static`, `vessel.enriched`, and `error`, so that I can route updates to
    the right UI handler.
39. As a frontend developer, I want all errors returned as a consistent
    envelope `{ error: { code, message, details } }`, so that error handling is
    uniform across REST and WebSocket.
40. As a frontend developer, I want bbox queries outside the Black Sea region
    to return an explicit `BBOX_OUT_OF_SCOPE` error rather than an empty list,
    so that misconfigured clients fail loudly.
41. As a frontend developer, I want pan/zoom to affect only camera state, so
    that rapid panning does not cause server-side churn or data ownership
    changes.
42. As a system operator, I want slow WebSocket clients to have their oldest
    queued position events per vessel dropped under backpressure (but never
    static or enrichment events), so that one slow client cannot impact the
    fanout for others.
43. As a system operator, I want each WebSocket connection heartbeated every
    30 seconds with disconnection of unresponsive clients, so that ghost
    connections are cleaned up.
44. As a portfolio reviewer, I want a single `docker-compose up` to bring up
    Postgres+PostGIS, Redis, the application, Prometheus, and Grafana with the
    dashboard pre-loaded, so that I can evaluate the system end-to-end in
    minutes.
45. As a developer, I want canonical event schemas validated by Zod and
    versioned via `schemaVersion`, so that consumers can detect incompatible
    versions and DLQ them deterministically.
46. As a developer, I want internal vessel identity to be a UUID with
    `mmsi`/`imo` as indexed operational fields, so that MMSI reassignment over
    time does not corrupt our model.
47. As a developer, I want the `vessel_positions_history` table partitioned
    daily so that 7-day history retention is a partition drop, not a row delete.
48. As a developer, I want the storage writer to perform `_latest` UPSERT and
    `_history` INSERT inside a single DB transaction, so that the two
    representations cannot diverge.
49. As a developer, I want all cross-module imports to go through `contracts/`
    and `shared/` only, so that future microservice extraction is mechanical.
50. As a developer, I want the storage module to own the Drizzle schema with
    other modules using repository interfaces, so that schema changes never
    leak into ingestion, enrichment, or realtime code.

## Implementation Decisions

The full architecture decision log is at `docs/architecture-decisions.md`.
The PRD-relevant items:

### Modules to build

**Deep, testable modules (encapsulate logic behind narrow interfaces):**

- `EventBus` — `publish(stream, event)`, `subscribe(stream, group, handler)`,
  with `XAUTOCLAIM` background recovery. RedisStreams implementation;
  RabbitMQ swap path preserved by the interface.
- `DedupService` — `shouldAccept(mmsi, occurredAt) → boolean`. Redis-backed
  last-seen state with ~10 minute TTL.
- `SamplerService` — `shouldEmit(event, lastEmittedAt, sog, prevNavStatus) → boolean`.
  Pure logic. 10s moving / 60s stationary; navStatus-change bypass.
- `RawFilter` — `accept(rawProviderMessage) → boolean`. MMSI shape (9 digits,
  vessel range), bbox prefilter, message-type allowlist.
- `Normalizer` — routes a `RawProviderMessage` by `providerId` to the
  registered `ProviderNormalizer.toCanonical(raw) → CanonicalEvent[]`.
- `Matcher` — `match(vesselProfile) → SanctionMatch[]`. Exact IMO → MMSI →
  normalized-name (latter is candidate/manual-review only).
- `AisProviderAdapter` (interface) — `start(handler) / stop() / health()`.
  Per-provider implementation. AISStream adapter for MVP.
- `ProviderNormalizer` (interface) — per-provider semantic mapper.
- `ProviderRegistry` — resolves `providerId` to its adapter and normalizer;
  driven by `AIS_PROVIDERS` env var.
- `SanctionsSourceAdapter` (interface) — `fetch() / parseVessel(raw)`.
  Implementations: OFAC, OpenSanctions.
- `FailureHandler` — encapsulates the retry counter + 3-strikes-to-DLQ +
  structured DLQ event publish. Used by every stream consumer.
- `ConfigService` — Zod-validated env config, loaded once at boot.
  Exposes typed config slices to modules.
- `HealthService` — provides `/healthz` (process), `/readyz` (DB + Redis),
  and degraded-feed reporting consumed by both readiness payload and metrics.
- Repositories: `VesselsRepository`, `PositionsRepository` (atomic
  `_latest` UPSERT + `_history` INSERT), `SanctionsRepository`
  (`sanctioned_entities`, `sanctions_import_runs`).

**Coordinator modules (thinner, orchestration):**

- `IngestionService` — boots `ProviderRegistry`, hooks `RawFilter`, forwards
  accepted messages into `PipelineService`.
- `PipelineService` — normalize → dedup → sample → publish to
  `ais.events.v1`.
- `StorageWriterConsumer` — consumer-group worker for `ais.events.v1`; writes
  storage repositories and publishes `vessel.persisted.v1` after successful
  vessel persistence. Persisted-event publish failures are logged and swallowed.
- `VesselPersistedConsumer` — consumer-group worker for `vessel.persisted.v1`;
  validates the post-persistence vessel contract and calls the requester.
- `VesselEnrichmentRequester` — computes profile hashes, reads enrichment Redis
  cache keys, decides discovered/profile-changed/stale/fresh outcomes, and
  enqueues deterministic `enrichment.vessel` jobs when needed.
- `VesselEnrichmentReconciler` — worker-side recovery loop that scans persisted
  vessels whose `sanctions_checked_at` is null or older than
  `ENRICHMENT_STALENESS_SECONDS`. It recovers unchecked/stale vessels; fresh
  profile changes are handled by `vessel.persisted.v1` and otherwise wait until
  staleness.
- `EnrichmentProcessor` — BullMQ worker, queries local sanctions data via
  `Matcher`, updates `vessels`, publishes `vessel.enriched`.
- `SanctionsImporter` — daily-scheduled BullMQ job per `SanctionsSourceAdapter`;
  upserts into `sanctioned_entities`; records `sanctions_import_runs`.
- `RealtimeGateway` (NestJS `@WebSocketGateway`, raw `ws` adapter) —
  handles `subscribe`, manages the subscribed-connection set.
- `FanoutConsumer` — consumer-group worker for `ais.events.v1` and
  `vessel.enriched`; routes the backend-supported realtime feed to subscribed
  connections.
- `AdminTokenGuard` — Nest guard enforcing `ADMIN_TOKEN` outside local dev.

### Architecture / cross-cutting

- Single repo, single Nest app, single Docker image.
- `PROCESS_ROLE=all|api|ingestion|worker` selects which modules bootstrap.
- Cross-module imports allowed only through `contracts/` and `shared/`.
- `storage/` owns the Drizzle schema; other modules consume via repositories.
- `ingestion/` never references canonical types; normalization is in
  `pipeline/`.
- `realtime/` does no DB reads at runtime.
- Single deployable runs Postgres+PostGIS, Redis (AOF `appendfsync everysec`),
  Prometheus, Grafana via `docker-compose.yml`.

### Schema

- `vessels` — UUID PK, indexed `mmsi` (unique) and `imo`; profile + sanctions
  fields (`sanctions_status` enum, `sanctions_checked_at`, `sanctions_payload`
  JSONB).
- `vessel_positions_latest` — vessel-keyed; `position geometry(Point, 4326)`
  with GIST index; `last_seen_at`; one row per vessel.
- `vessel_positions_history` — append-only, `PARTITION BY RANGE (occurred_at)`
  daily by UTC day. First-party partition lifecycle maintenance.
- `sanctioned_entities` — `(source, source_entity_id)` unique; indexed `imo`,
  `mmsi`, `name`; `aliases` text[] with GIN index; raw payload JSONB.
- `sanctions_import_runs` — audit table.

### API contract

- REST: `GET /api/vessels`, `GET /api/vessels/:id`, `GET /api/vessels/:id/track`,
  `GET /api/sanctions/sources`, `GET /healthz`, `GET /readyz`, `GET /metrics`.
- WebSocket `/ws/positions`: client `subscribe`; server `position`, `static`,
  `vessel.enriched`, `error`.
- Admin (token-gated): DLQ list/replay, sanctions import list/run, stream
  inspection.
- All input Zod-validated.
- Error envelope `{ error: { code, message, details } }`.
- Track window capped at 7 days; out-of-Black-Sea bbox returns
  `BBOX_OUT_OF_SCOPE`.

### Streams

- `ais.events.v1` — canonical position/static events.
- `vessel.persisted.v1` — post-persistence vessel facts emitted by storage.
- `vessel.enriched` — enrichment results.
- `ais.deadletter` — poison messages with full error context.
- `MAXLEN ~ 100k`, configurable.

### Queues (BullMQ)

- `sanctions.import` — daily scheduled jobs per source.
- `enrichment.vessel` — per-vessel enrichment with idempotent `jobId` and
  exponential backoff.

### Cross-cutting libraries

- `pino` / `nestjs-pino` for structured JSON logs.
- `prom-client` via `@willsoto/nestjs-prometheus` for `/metrics`.
- Drizzle ORM for relational data; raw SQL templates for PostGIS-typed
  columns (`geometry(Point, 4326)`).

## Testing Decisions

A good test in this codebase exercises **external behavior** of a module
through its public interface. We do not assert on internal state, internal
helper methods, or private collaborators. We avoid mocking the database in
integration tests; we do mock external HTTP (sanctions sources) and the
AIS provider WebSocket using fixture replay.

We follow TDD: tests are written alongside (or before) the code they cover,
not as a final phase.

### Modules with dedicated unit tests

- `DedupService` — accepts new `(mmsi, occurredAt)`; rejects duplicates;
  honors TTL; behaves correctly across restarts (i.e. no stale state).
- `SamplerService` — pure-logic table tests for moving/stationary windows,
  navStatus bypass, static-event passthrough.
- `RawFilter` — MMSI digit count + vessel range, base-station rejection,
  bbox edge cases (boundary inclusive), message-type allowlist.
- `Normalizer` — per-provider mapping correctness; uses real fixture
  data from `aisstream/raw-api-response.jsonl` and
  `aisstream/normalized-vessel-data.json` as golden output.
- `ProviderRegistry` — resolves providers from env config; rejects unknown
  IDs; returns adapter + normalizer pair atomically.
- `Matcher` — exact IMO match, exact MMSI match, normalized-name match;
  no-false-positive on null IMO/MMSI; deterministic candidate ordering.
- `FailureHandler` — increments retry counter; ACKs and publishes to DLQ
  on third failure; preserves error context.
- `OfacAdapter` — parsing correctness against fixture XML; only vessel
  entities extracted; idempotent `(source, source_entity_id)` upsert behavior.
  `OpenSanctionsAdapter` is a planned second adapter.
- `ConfigService` — rejects invalid env (Zod failure raises at boot); loads
  defaults; surfaces typed slices.
- `AdminTokenGuard` — accepts valid token; rejects missing/invalid; allows
  unauthenticated in local dev when not configured.
- `HealthService` — `/readyz` payload matches DB/Redis reachability;
  degraded AIS-feed signal surfaces but does not flip readiness.

### Modules with integration / e2e tests

- **End-to-end pipeline test**: fixture file (`raw-api-response.jsonl`) →
  ingestion → `ais.events.v1` → storage. Asserts: `vessels`,
  `vessel_positions_latest`, `vessel_positions_history` populated correctly;
  drop counters incremented for non-vessel/duplicate/sampled inputs;
  exactly the expected canonical events visible on the stream.
- **Storage transaction test**: simulated DB failure mid-transaction leaves
  neither `_latest` nor `_history` written; success path writes both
  atomically.
- **DLQ test**: a poison event hits the storage consumer 3× and lands on
  `ais.deadletter` with full error context; consumer group continues making
  progress on subsequent messages.
- **Realtime fanout test**: two connected WS clients with overlapping bboxes
  receive the events relevant to their viewport (and only those); slow
  client's queue drops oldest position per vessel without affecting the
  other client.
- **Sanctions ETL test**: importer ingests fixture OFAC data, populates
  `sanctioned_entities`, records a `sanctions_import_runs` row; running twice
  is idempotent.
- **Enrichment loop test**: a persisted vessel event triggers an enrichment
  job; matcher hits a fixture sanctioned entity by IMO; `vessels` is updated
  and `vessel.enriched` is published.

### Prior art

- No prior application code exists in the repo yet. The fixture files in
  `aisstream/` (raw and normalized samples) are authoritative test fixtures
  for the ingestion + normalization layers.
- Test infrastructure decisions to follow Nest community conventions:
  Jest for unit + integration; Testcontainers for Postgres+Redis in
  integration tests so we exercise real PostGIS and real Redis Streams,
  not mocks.

## Out of Scope

- User authentication / multi-tenancy for the public API.
- OAuth/JWT, rotated tokens, or any auth more sophisticated than a static
  admin token.
- Distributed tracing / OpenTelemetry.
- Log aggregation infrastructure (Loki / ELK).
- Automatic provider failover (architecture allows it; no logic built).
- Multi-active provider merging beyond the dedup-driven side-effect.
- Fuzzy / Levenshtein name matching for sanctions.
- Per-IP / per-user rate limiting on public endpoints.
- EU sanctions source.
- Kafka or RabbitMQ at runtime (Rabbit migration path documented only).
- Cold-storage tiering for history beyond the 90-day partition window.
- Geographic scope beyond the Black Sea bbox.
- Mobile apps; only a web frontend is in scope.
- CI/CD pipeline, deployment to a cloud provider, or production secret
  management.

## Further Notes

- The architecture decision log at `docs/architecture-decisions.md` is the
  authoritative spec. When a decision changes, update that file in the same
  PR as the code change.
- The MVP target is 7–10 days of solo + AI-assisted development. Cuts (in
  order, only if needed) are: EU sanctions source (already cut),
  `/admin/streams` lag inspection endpoint, OpenSanctions adapter
  (leaving OFAC alone), track downsampling, and the frontend (last resort).
- The frontend (MapLibre GL + React) is in scope but begins after the
  backend pipeline + API are stable.
- License attribution for OpenSanctions data ("© OpenSanctions, CC-BY-NC 4.0")
  must appear in the README and somewhere visible in the UI when sanctions
  status is displayed from that source.
- The most important interview-level artifact this project produces, after
  the code itself, is the Grafana dashboard JSON committed to the repo.
  Live event-driven metrics are worth more than long architectural
  explanations.
