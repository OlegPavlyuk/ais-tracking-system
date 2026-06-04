# Architecture Decision Record

This document records the major architectural decisions and trade-offs for the AIS Tracking System. It focuses on design intent: why the system is shaped this way, what constraints influenced the choices, and which alternatives were intentionally deferred.

Subsystem behavior lives in the architecture and subsystem documents. API details live in [../development/api.md](../development/api.md), testing guidance lives in [../development/testing.md](../development/testing.md), and operational procedures live in the operations runbooks.

## Scale Envelope

**Decision:** Optimize for a live AIS workload in the low-hundreds-of-messages-per-second order of magnitude, with room for broader regional coverage and additional providers without adopting large-scale distributed streaming infrastructure prematurely.

**Rationale:** AIS is a continuous stream where short gaps self-heal as new messages arrive. The architecture targets workloads that benefit from durable queues, consumer isolation, replay, and observability, but not yet the operational cost of Kafka-scale streaming, multi-region processing, or fully distributed orchestration.

**Trade-offs:**

- Avoided early Kubernetes or managed orchestration work.
- Kept role boundaries explicit so API, ingestion, and worker processes can be split when workload growth justifies it.
- Chose bounded local retention and partitioning instead of unbounded historical storage.

## Messaging Strategy

**Decision:** Use Redis Streams behind an internal `EventBus` abstraction for durable internal events.

**Rationale:** Redis is already needed for deduplication state and BullMQ. Streams provide consumer groups, pending-message recovery, approximate trimming, and manual replay paths without adding another broker to the MVP stack.

**Trade-offs:**

- Redis Streams are less feature-rich than RabbitMQ or Kafka, but they are sufficient for the current scale envelope.
- The `EventBus` boundary preserves a migration path if future throughput or routing requirements outgrow Redis Streams.
- EventEmitter-style in-process dispatch was rejected because it would remove durability, replay, and independent consumer failure handling.

## Pipeline and Role Strategy

**Decision:** Keep one NestJS codebase and one backend image, selected at runtime with `PROCESS_ROLE=all|api|ingestion|worker`.

**Rationale:** The project stays a modular monolith while still making service boundaries concrete. API, ingestion, storage, realtime, and enrichment responsibilities can run together locally or as separate production containers from the same image.

**Trade-offs:**

- Shared code and deployment artifacts reduce operational overhead.
- Role-specific module composition makes future service extraction easier.
- The approach avoids network boundaries between modules until there is a demonstrated need for them.

## Event Contract Strategy

**Decision:** Normalize provider-specific AIS messages into versioned canonical events before publishing to shared consumers.

**Rationale:** Storage, realtime, and enrichment should not depend on AISStream-specific payload shapes. Canonical Zod-validated contracts create a stable internal boundary and make schema evolution explicit.

**Trade-offs:**

- Provider adapters and normalizers carry more responsibility at the edge.
- Consumers reject unknown or invalid event shapes instead of trying to infer intent.
- Only supported AIS message categories enter the pipeline; unsupported raw provider messages are filtered before publishing.

## Identity Strategy

**Decision:** Use an internal UUID as the vessel primary key and treat MMSI/IMO as operational identifiers.

**Rationale:** MMSI can be reassigned and IMO is not always present. A stable internal ID decouples persisted vessel state, history, enrichment, and API references from upstream identifier lifecycle changes.

**Trade-offs:**

- MMSI remains the runtime key for ingestion and map updates.
- IMO is indexed and useful for matching, but nullable.
- The database, not the provider payload, owns stable vessel identity.

## Ingestion Quality Strategy

**Decision:** Apply deduplication, sampling, coverage filtering, and optional geo validation before publishing canonical events.

**Rationale:** Downstream consumers should see a cleaner, consistent feed rather than each consumer independently handling provider noise, duplicate messages, or impossible positions.

**Trade-offs:**

- Some noisy-but-real telemetry may be dropped according to configured policy.
- Fail-open geo validation supports safer rollout when datasets are uncertain.
- Centralizing these checks makes metrics and drop reasons easier to reason about.

## Storage Strategy

**Decision:** Use PostgreSQL/PostGIS as the system of record, with separate tables for vessel identity, latest positions, historical track data, sanctions entities, and sanctions import runs.

**Rationale:** The system has distinct access patterns: fast latest-state map snapshots, append-only history, identity/profile lookup, and local sanctions matching. PostGIS gives native spatial indexing and query behavior for the map workload.

**Trade-offs:**

- `geometry(Point, 4326)` is preferred over `geography` for bbox-first web-map queries.
- Latest state and history are stored separately to keep map bootstrap fast without losing track history.
- Daily history partitions keep retention and maintenance explicit rather than relying on unbounded table growth.

## Realtime Strategy

**Decision:** Use a raw WebSocket endpoint for realtime map updates, backed by Redis Stream fanout consumers.

**Rationale:** The client needs a focused position/static/enrichment stream rather than a general realtime framework. Raw `ws` keeps protocol behavior explicit and avoids Socket.io complexity that is not needed for the current client contract.

**Trade-offs:**

- The backend owns coverage and broadcasts the configured feed to subscribed clients.
- Bounded per-client queues protect the server from slow clients.
- Future horizontal fanout may require an extra pub/sub layer or a different broadcast topology.

## Sanctions Strategy

**Decision:** Import sanctions data locally and match persisted vessel profiles asynchronously instead of calling a sanctions API at request time.

**Rationale:** Local ETL creates deterministic, auditable enrichment, avoids per-vessel runtime HTTP dependencies, and better fits an event-driven portfolio system. Enrichment is derived state, so it should not block ingestion or storage writes.

**Trade-offs:**

- Imported data must be scheduled, audited, and refreshed.
- Matching is intentionally deterministic and exact for MVP, with name matches treated as candidate signals.
- A reconciler is needed to recover unchecked or stale vessels if immediate persisted-event handoff is missed.

## Provider Strategy

**Decision:** Separate provider transport adapters from provider normalizers.

**Rationale:** Transport concerns such as authentication, reconnects, subscriptions, provider health, and raw message filtering are not the same as semantic conversion into internal events. Keeping them separate makes additional providers easier to add.

**Trade-offs:**

- Each provider owns its raw filtering semantics.
- The shared pipeline consumes only normalized provider output.
- Automatic multi-provider failover is deferred until there is a real operational need.

## Failure Handling Strategy

**Decision:** Use consumer-group retries, pending-message recovery, and a dead-letter stream for poison messages.

**Rationale:** Storage, realtime, and enrichment consumers should fail independently without blocking ingestion forever. Manual DLQ inspection and replay make failure recovery observable and deliberate.

**Trade-offs:**

- Retry counters and DLQ metadata add Redis bookkeeping.
- DLQ entries are not auto-replayed, which avoids retry storms but requires operator action.
- Storage transaction failures follow the same stream retry path as other consumer failures.

## Observability Strategy

**Decision:** Use Prometheus metrics, Grafana dashboards, structured logs, health checks, and readiness checks before adopting distributed tracing or a log aggregation stack.

**Rationale:** The current topology can be operated effectively with metrics, dashboards, and structured container logs. This keeps the observability story concrete without adding tools that are not yet required.

**Trade-offs:**

- No OpenTelemetry or centralized log stack in the current architecture.
- Metrics focus on ingestion, stream health, storage, geo validation, enrichment, realtime, HTTP, and provider health.
- Readiness distinguishes infrastructure failure from provider-feed degradation.

## Key Rationale Summary

Quick reference for the highest-impact choices:

- Redis Streams for durable async boundaries without a separate broker stack.
- Versioned canonical events so shared consumers avoid provider-specific payloads.
- PostGIS as the persistent spatial system of record.
- Async enrichment so sanctions checks do not block ingestion or reads.
- Raw WebSocket delivery for a focused realtime map stream.
- Single-image multi-role deployment until service extraction is justified.
