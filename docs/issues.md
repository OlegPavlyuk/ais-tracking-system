# Implementation Slices — Maritime Intelligence / AIS Tracking System

Tracer-bullet vertical slices, ordered by dependency. Each slice is independently
demoable. Convert to GitHub issues once the repo and remote are set up.

Source spec: `docs/architecture-decisions.md` and `docs/prd.md`.

---

## #1 — Walking skeleton ✅ (commit `ee1ed6d`)

**Type:** HITL (foundation slice; review repo layout, module boundaries, config
structure, Docker setup, shared infrastructure before continuing).

### What to build

Bring up the empty house with all utilities connected. Nest application that
boots into one of `PROCESS_ROLE=all|api|ingestion|worker`, with shared
infrastructure (config, logger, metrics, DB client, Redis client, EventBus
interface stub) in place. `docker-compose.yml` brings up Postgres+PostGIS,
Redis (AOF), Prometheus, Grafana stub. Drizzle migrations runner wired but no
domain tables yet. Three endpoints live: `/healthz`, `/readyz`, `/metrics`.

### Acceptance criteria

- [x] `docker compose up` brings the full stack to ready in one command.
- [x] `GET /healthz` returns 200 if the process is alive.
- [x] `GET /readyz` returns 200 only when DB and Redis are reachable; 503 otherwise.
- [x] `GET /metrics` exposes a Prometheus-formatted endpoint.
- [x] `PROCESS_ROLE` env selects which Nest modules bootstrap; verified for at least `api` and `all`.
- [x] Repo structure matches the module map in `docs/architecture-decisions.md` (empty placeholders OK for not-yet-built modules).
- [x] `ConfigService` validates env via Zod and fails fast on invalid config.
- [x] `pino` structured logging emits JSON with correlation-field placeholders.
- [x] Drizzle migration tooling runs `pnpm migrate` cleanly against the docker Postgres.
- [x] Prometheus scrapes `/metrics`; Grafana is reachable on its port (no dashboards yet).
- [x] Unit tests cover `ConfigService` (rejects invalid env, applies defaults) and `HealthService` (readyz reflects DB/Redis state).

### Blocked by

None — can start immediately.

---

## #2 — First tracer bullet (AISStream → DB → REST snapshot)

**Type:** AFK

### What to build

The thinnest end-to-end path. Connect to AISStream, accept position messages
inside the Black Sea bbox, normalize to canonical events, publish to
`ais.events.v1`, persist to `vessel_positions_latest` (and create the
`vessels` row on first sight), and serve them via `GET /api/vessels?bbox=...`.
No dedup/sampling, no transaction guarantees yet, no static events.

### Acceptance criteria

- [x] AISStream adapter connects, subscribes to Black Sea bbox, and forwards `RawProviderMessage` events.
- [x] `RawFilter` accepts only 9-digit vessel MMSIs and rejects base-station / non-vessel message types.
- [x] `Normalizer` produces canonical `position` events with `schemaVersion`, validated via Zod.
- [x] `EventBus` publishes events to `ais.events.v1` (Redis Streams).
- [x] `StorageWriterConsumer` consumer-group worker INSERTs/UPSERTs into `vessels` and `vessel_positions_latest`.
- [x] `vessels` schema has UUID PK, indexed `mmsi` unique and `imo` nullable; `vessel_positions_latest` has `position geometry(Point, 4326)` with GIST index, plus `last_seen_at`.
- [x] `GET /api/vessels?bbox=minLon,minLat,maxLon,maxLat` returns vessels in the bbox, joined to profile fields, filtered by `last_seen_at`.
- [x] Out-of-Black-Sea bbox returns `BBOX_OUT_OF_SCOPE` error envelope.
- [x] Live AIS data is queryable via curl within seconds of stream start.
- [x] Unit tests cover `RawFilter` and `Normalizer` against fixture data in `aisstream/`.

### Blocked by

- #1

---

## #3 — Static events + vessel profile + detail endpoint

**Type:** AFK

### What to build

Handle `static` event kind. Populate vessel profile fields (name, IMO,
callsign, ship type, dimensions, destination) on `vessels`. Expose
`GET /api/vessels/:id` returning the full profile and current position.

### Acceptance criteria

- [x] `Normalizer` produces canonical `static` events from `StaticDataReport` and `ShipStaticData`.
- [x] Static events flow on the same `ais.events.v1` stream, discriminated by `kind`.
- [x] `StorageWriterConsumer` upserts profile fields onto `vessels` from static events.
- [x] `GET /api/vessels/:id` returns full profile + current position + sanctions placeholder fields.
- [x] 404 envelope returned when ID not found.
- [x] Unit tests for static-event normalization against fixture data.
- [ ] Integration test: replay fixture file, assert both `vessels` profile fields and `vessel_positions_latest` are populated correctly.

### Blocked by

- #2

---

## #4 — Dedup, sampling, drop metrics ✅ (commit `7c0138f`)

**Type:** AFK

### What to build

Add quality controls to the pipeline. `DedupService` rejects duplicates by
`(mmsi, occurredAt)`. `SamplerService` enforces 10s/60s windows with
navStatus-change bypass. Both run in the Normalizer layer before publishing.
Drop counters exposed as metrics with reason labels.

### Acceptance criteria

- [x] `DedupService.shouldAccept(mmsi, occurredAt)` uses Redis last-seen state with ~10 minute TTL.
- [x] `SamplerService.shouldEmit(...)` returns true on navStatus change regardless of window.
- [x] Static events are never sampled.
- [x] `ais_messages_dropped_total{reason="duplicate"|"sampled"|"out_of_bbox"|"non_vessel_mmsi"|"invalid"}` metric incremented per drop.
- [x] Unit tests cover dedup TTL, sampler windows (moving + stationary), navStatus bypass, static passthrough.
- [ ] Integration test: replay fixture stream with duplicates; assert exactly the expected canonical events appear and drop counters match.

### Blocked by

- #2

---

## #5 — History + transactional writes + track endpoint ✅ (commit `caf83df`)

**Type:** AFK

### What to build

Append-only history table with monthly range partitioning. Storage writer
performs latest UPSERT and history INSERT in a single transaction. Track
endpoint returns historical positions, capped at 7 days, with downsampling
or simplified LineString.

### Acceptance criteria

- [x] `vessel_positions_history` table created with `PARTITION BY RANGE (occurred_at)` and current + next-month partitions, each with GIST index on `position`.
- [x] Migration helper script creates a new monthly partition.
- [x] `StorageWriterConsumer` writes `_latest` UPSERT and `_history` INSERT inside one DB transaction.
- [x] `GET /api/vessels/:id/track?from=&to=&simplify=` returns history.
- [x] Track endpoint enforces 7-day max window, validates `from < to`, returns 400 envelope on violation.
- [x] Server-side downsampling (or `ST_SimplifyPreserveTopology` over a built LineString) honors the `simplify` parameter.
- [ ] Integration test: simulated DB failure mid-transaction leaves neither table mutated.
- [ ] Integration test: track endpoint returns expected points for a fixture vessel.

### Blocked by

- #2

---

## #6 — Realtime WebSocket with mutable bbox

**Type:** AFK

### What to build

`/ws/positions` endpoint, mutable bbox per connection, fanout consumer that
filters events by each connection's bbox, bounded send queue with drop-oldest
on overflow, 30-second heartbeat.

### Acceptance criteria

- [x] `RealtimeGateway` accepts `subscribe` and `update_subscription` messages.
- [x] `SubscriptionService` holds in-memory `connectionId → bbox` map.
- [x] `FanoutConsumer` consumer-group worker for `ais.events.v1` filters and routes to matching connections.
- [x] Server emits `position`, `static`, `vessel.enriched`, and `error` typed messages. (`vessel.enriched` slot defined; not emitted until slice #8.)
- [x] Per-connection bounded queue (configurable) with drop-oldest-position-per-vessel under overflow; static and enriched events never dropped.
- [x] 30s heartbeat ping; non-responsive clients disconnected.
- [x] Standard `{ error: { code, message, details } }` envelope on WS errors.
- [ ] Integration test: two `wscat`-style clients with overlapping bboxes; assert each receives only events in its viewport. (Deferred until integration harness lands.)
- [ ] Integration test: slow client's queue overflows; oldest position-per-vessel dropped while other client continues unaffected. (Deferred until integration harness lands.)

### Blocked by

- #2

---

## #7 — Sanctions ETL — OFAC source

**Type:** AFK

### What to build

`SanctionsSourceAdapter` interface, OFAC SDN consolidated XML adapter,
`sanctioned_entities` and `sanctions_import_runs` schemas, daily BullMQ
scheduled job. Public endpoint listing sanctions sources with last-import
metadata.

### Acceptance criteria

- [x] `SanctionsSourceAdapter` interface defined as `fetchAll(): AsyncIterable<VesselEntity>` (adapter owns transport + parsing + vessel filtering; importer owns batched upserts and run-record bookkeeping).
- [x] `OfacAdapter` implements it; downloads consolidated XML; parses with `fast-xml-parser`; extracts only `sdnType === 'Vessel'` entries; normalizes IMO ("IMO 9187629" and bare-digit forms), MMSI, and strong-category aliases.
- [x] `sanctioned_entities` table with `(source, source_entity_id)` unique; indexed `imo`, `mmsi`, `name`; `aliases` text[] with GIN; raw_payload JSONB. Strong-only aliases live in the structured column; weak aliases preserved in `raw_payload`.
- [x] `sanctions_import_runs` records each run with timing, counts, errors.
- [x] `sanctions.import` BullMQ queue (`@nestjs/bullmq`); daily scheduled job per source via `SanctionsScheduler`.
- [x] Re-running the import is idempotent: `INSERT ... ON CONFLICT (source, source_entity_id) DO UPDATE` keeps row count stable across re-runs.
- [x] `GET /api/sanctions/sources` returns sources with last-import summary and attribution metadata.
- [x] Unit tests for `OfacAdapter` parsing against fixture XML.
- [ ] Integration test: ingest fixture OFAC file, assert `sanctioned_entities` populated and `sanctions_import_runs` row recorded; second run is a no-op. (Deferred until integration harness lands.)

### Blocked by

- #1

---

## #8 — Per-vessel enrichment loop

**Type:** AFK

### What to build

`EnrichmentDispatcher` consumer decides when a vessel needs enrichment.
`Matcher` finds sanctions hits by IMO → MMSI → normalized name.
`EnrichmentWorker` BullMQ updates `vessels.sanctions_status` and publishes
`vessel.enriched`. Realtime fanout consumes the enriched events so the UI
gets badge updates live.

### Acceptance criteria

- [x] `EnrichmentDispatcher` consumer-group worker on `ais.events.v1` enqueues a job on: new MMSI, profile change, or stale (`sanctions_checked_at` older than 7 days). Triggers detected via Redis cache keys `enrich:profile:{vesselId}` (set permanently by worker) and `enrich:checked:{vesselId}` (TTL = `ENRICHMENT_STALENESS_SECONDS`, default 7d).
- [x] `enrichment.vessel` BullMQ queue with idempotent `jobId = enrich.{vesselId}.{trigger}.{profileHash}` (dot-delimited because BullMQ rejects `:` in custom IDs), exponential backoff, configurable attempts. Per-source rate limiting deferred — matcher path is DB-only, no HTTP fan-out.
- [x] `Matcher` returns matches in order: exact IMO → exact MMSI → normalized name (latter as candidate / manual-review signal). Same `normalizeName()` applied to both sides; name candidates only surface when no exact identifier match is found.
- [x] `EnrichmentWorker` updates `vessels` with timestamp-guarded UPDATE (`WHERE sanctions_checked_at IS NULL OR sanctions_checked_at = $observed`); publishes `vessel.enriched` to Redis Stream only when the guard accepted the update; sets Redis cache keys after success.
- [x] `FanoutConsumer` consumes `vessel.enriched` and emits matching WS messages.
- [x] Unit tests: `Matcher` (exact match priorities, null IMO/MMSI handling, deterministic candidate ordering).
- [x] End-to-end test (in-process wiring): vessel discovery → enrichment job → matcher hits fixture sanctioned entity by IMO → `vessels.sanctions_status` updated → `vessel.enriched` event observable. Live verification against worker role + docker stack confirms the same loop end-to-end.

### Blocked by

- #3, #6, #7

---

## #9 — Sanctions ETL — OpenSanctions source

**Type:** AFK

### What to build

Second concrete `SanctionsSourceAdapter`: OpenSanctions vessels bulk dataset
(CSV/JSON). Validates the abstraction with a second source. Adds
CC-BY-NC 4.0 attribution where sanctions data is surfaced.

### Acceptance criteria

- [ ] `OpenSanctionsAdapter` implements `SanctionsSourceAdapter`.
- [ ] OpenSanctions bulk file downloaded, parsed, vessel entities extracted, upserted into `sanctioned_entities` with `source = 'opensanctions'`.
- [ ] Idempotent on re-run; second run produces no duplicates.
- [ ] `/api/sanctions/sources` lists OpenSanctions with last-import summary.
- [ ] CC-BY-NC 4.0 attribution string appears in the API response and in README.
- [ ] Unit tests: OpenSanctions parsing against fixture file.
- [ ] Integration test: matcher finds vessels via both OFAC and OpenSanctions data side-by-side.

### Blocked by

- #7

---

## #10 — Failure handling + admin endpoints

**Type:** AFK

### What to build

`FailureHandler` encapsulates 3-strike retry counter, DLQ publish, and ACK
behavior. `XAUTOCLAIM` background recovery per consumer group.
`ais.deadletter` stream. Admin endpoints for DLQ inspection/replay,
sanctions admin, stream lag inspection, all gated by `AdminTokenGuard`.

### Acceptance criteria

- [ ] `FailureHandler` increments retry counter (Redis hash); leaves message unacked for re-delivery.
- [ ] On 3rd failure: publishes to `ais.deadletter` with `{ originalEvent, consumerGroup, error, attempts, firstFailedAt, lastFailedAt }`, then ACKs original.
- [ ] `XAUTOCLAIM` background task per consumer group recovers stuck pending messages.
- [ ] Structured DLQ logs include `reason`, `consumerGroup`, event `kind`, `mmsi`.
- [ ] Stream `MAXLEN ~ 100k` (configurable) approximate trim on producer.
- [ ] `AdminTokenGuard` enforces `ADMIN_TOKEN` outside local dev; allows unauthenticated when token unconfigured in dev mode.
- [ ] `GET /admin/deadletter?stream=&limit=` lists recent DLQ entries.
- [ ] `POST /admin/deadletter/:id/replay` re-publishes to original stream.
- [ ] `GET /admin/sanctions/imports` lists recent import runs.
- [ ] `POST /admin/sanctions/imports/:source/run` triggers an out-of-schedule import.
- [ ] `GET /admin/streams` returns consumer-group lag and pending counts.
- [ ] Unit tests: `FailureHandler` (retry increment, DLQ on 3rd, ACK), `AdminTokenGuard`.
- [ ] Integration test: poison fixture event hits storage consumer 3×, lands in DLQ; consumer group continues progressing; admin replay succeeds.

### Blocked by

- #2, #7

---

## #11 — Provider abstraction polish

**Type:** AFK

### What to build

Make the provider seam fully realized: `ProviderRegistry` driven by
`AIS_PROVIDERS` env, exponential reconnect/backoff in the AISStream adapter,
provider health metrics, degraded-feed signal in `/readyz` payload + metrics
without flipping readiness.

### Acceptance criteria

- [ ] `ProviderRegistry` reads `AIS_PROVIDERS` env, instantiates each adapter and normalizer pair, rejects unknown IDs at boot.
- [ ] AISStream adapter reconnects with exponential backoff (1s → 30s capped); resets backoff on success message.
- [ ] Provider health: `health()` exposes `connected`, `lastMessageAt`, `reconnectCount`.
- [ ] Metrics: `ais_provider_connected{provider}`, `ais_provider_last_message_age_seconds{provider}`, `ais_provider_reconnects_total{provider}`.
- [ ] `/readyz` payload includes `feedDegraded: true` when `lastMessageAt` is older than threshold (e.g. 60s) but readiness still returns 200.
- [ ] Unit tests: `ProviderRegistry` (config resolution, unknown ID rejection).
- [ ] Integration test: kill the AISStream connection mid-test, observe reconnect, `feedDegraded` flag flip on/off, no pod-restart-equivalent triggered.

### Blocked by

- #2

---

## #12 — Observability polish + Grafana dashboard

**Type:** AFK

### What to build

Wire all remaining planned metrics. Ensure `pino` correlation fields
(`traceId`, `mmsi`, `vesselId`, `streamMessageId`, `consumerGroup`,
`provider`) are present on every relevant log line. Commit a pre-built
Grafana dashboard JSON loaded automatically by the Grafana container.

### Acceptance criteria

- [ ] All metrics from `docs/architecture-decisions.md` (ingestion, pipeline, storage, enrichment, realtime, HTTP) are emitted.
- [ ] Correlation fields appear on log lines along the AIS message path; one event can be traced end-to-end via grep.
- [ ] Grafana provisioning config + dashboard JSON committed under `docker/grafana/`.
- [ ] On `docker compose up`, Grafana auto-loads the dashboard with live data.
- [ ] Dashboard panels cover: ingestion rate, drop reasons, stream lag per group, DLQ rate, sanctions matches, WS connections, p95 query duration, provider health.
- [ ] README screenshot of the dashboard in action.

### Blocked by

- #4, #6, #8, #10, #11

---

## #13 — Frontend — map + REST snapshot + WS updates

**Type:** HITL (UX choices benefit from review).

### What to build

MapLibre-based React app rendering vessels in the current viewport. Loads
snapshot via REST on mount and after significant viewport change. Opens
single WS connection; sends `subscribe` on connect and `update_subscription`
on debounced `moveend`/`zoomend`.

### Acceptance criteria

- [ ] Map mounts and loads snapshot from `GET /api/vessels?bbox=`.
- [ ] WS connection opens to `/ws/positions`, sends `subscribe` with current bbox.
- [ ] `moveend`/`zoomend` triggers debounced `update_subscription` plus a fresh REST snapshot.
- [ ] Live `position` events update vessel markers in place; `static` events update vessel meta.
- [ ] Reconnect handled cleanly when WS drops.
- [ ] Out-of-Black-Sea bbox handled by error envelope display.
- [ ] Lightweight component tests for the bbox-debounce hook.

### Blocked by

- #5, #6

---

## #14 — Frontend — vessel detail panel + sanctions badge

**Type:** HITL

### What to build

Clicking a vessel marker opens a side panel/card showing the full profile
from `GET /api/vessels/:id`, with a visual badge for sanctions status.
Live `vessel.enriched` events update the badge without reload.

### Acceptance criteria

- [ ] Click on marker opens detail panel populated from `GET /api/vessels/:id`.
- [ ] Sanctions status renders as a visible badge with source attribution.
- [ ] OpenSanctions data is shown with required CC-BY-NC 4.0 attribution.
- [ ] `vessel.enriched` WS messages update the open panel live.
- [ ] Closing the panel cleans up subscriptions.

### Blocked by

- #8, #13

---

## #15 — Frontend — track visualization

**Type:** HITL

### What to build

In the vessel detail panel, a "show track" control loads
`GET /api/vessels/:id/track` over a configurable window (≤7 days) and
renders the route on the map.

### Acceptance criteria

- [ ] Track control with from/to picker (default last 24h).
- [ ] Track rendered as a polyline on the map.
- [ ] 7-day max enforced client-side with a clear message; server error envelope handled gracefully.
- [ ] Toggling the control on/off cleanly adds/removes the polyline.
- [ ] Reasonable performance for tracks with downsampling enabled.

### Blocked by

- #5, #14

---

## Cut order if time slips

Already cut (per `docs/architecture-decisions.md`): EU sanctions source, OpenTelemetry.

If further cuts needed, drop in this order:

1. Slice #15 (track visualization in frontend) — backend track endpoint stays.
2. Slice #9 (OpenSanctions) — OFAC alone is the irreducible minimum.
3. Slice #10 admin endpoints (DLQ logic stays; just no UI/REST surface for it).
