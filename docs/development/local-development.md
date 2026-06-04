# Local Development

## Requirements

- Node.js 22 or newer.
- pnpm 10.27.0 or compatible with the repository `packageManager`.
- Docker and Docker Compose for Postgres, Redis, Prometheus, and Grafana.

## Setup

```bash
pnpm install
pnpm --dir web install
cp .env.example .env
```

Set `AISSTREAM_API_KEY` in `.env` only when you want live AIS ingestion. Without a provider key, local API and worker development can still run against local services and tests.

## Full Local Stack

```bash
docker compose --profile full up --build
```

Primary local URLs:

- API: `http://localhost:3000`
- WebSocket: `ws://localhost:3000/ws/positions`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

## Common Commands

```bash
pnpm start:dev
pnpm web:dev
pnpm migrate
pnpm partition:maintain
```

Use `PROCESS_ROLE=api`, `PROCESS_ROLE=ingestion`, `PROCESS_ROLE=worker`, or `PROCESS_ROLE=all` to run the backend with the same role boundaries used by production containers.

Related docs:

- [Testing](testing.md)
- [API reference](api.md)
- [Architecture overview](../architecture/architecture.md)
