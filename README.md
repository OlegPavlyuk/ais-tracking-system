# AIS Tracking System

Maritime intelligence backend that ingests AISStream data, normalizes it into a
canonical event contract on Redis Streams, persists positions to PostGIS, enriches
vessels against sanctions data, and serves a MapLibre frontend over REST + WebSocket.

Spec: see [`docs/prd.md`](docs/prd.md), [`docs/architecture-decisions.md`](docs/architecture-decisions.md),
and [`docs/issues.md`](docs/issues.md).

## Status

Slice #1 — walking skeleton. The Nest app boots with shared infrastructure
(config, logger, metrics, DB client, Redis client, EventBus stub) and serves
`/healthz`, `/readyz`, `/metrics`. Domain modules are empty placeholders.

## Quick start

Prerequisites: Node 22 LTS, pnpm 10, Docker.

```bash
nvm use            # picks up .nvmrc (22)
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm start:dev
```

Endpoints:

- `GET /healthz` — process liveness
- `GET /readyz` — DB + Redis reachability (503 when either is down)
- `GET /metrics` — Prometheus exposition

Full stack including app, Prometheus, and Grafana:

```bash
docker compose up
```

Grafana: http://localhost:3001 (anonymous access). Prometheus: http://localhost:9090.

## Process roles

The single Nest image boots into one of four roles via `PROCESS_ROLE`:

- `all` (default) — every module
- `api` — REST + WS + admin
- `ingestion` — AIS provider → pipeline → storage writer
- `worker` — enrichment + sanctions ETL

## Scripts

- `pnpm start:dev` — watch-mode start
- `pnpm build` — compile to `dist/`
- `pnpm test` — Jest unit tests
- `pnpm lint` / `pnpm format` — ESLint flat config + Prettier
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm migrate` — run Drizzle migrations
- `pnpm migrate:generate` — generate a new migration from schema changes
