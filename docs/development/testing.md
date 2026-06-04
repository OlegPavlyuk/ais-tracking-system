# Testing

The repository uses Jest for backend tests, Testcontainers for integration coverage, and Vitest/Testing Library for the React client.

## Testing Strategy

Tests should protect architectural behavior rather than mirror every implementation detail. The most important behaviors are provider normalization, pipeline filtering, stream failure handling, storage consistency, enrichment idempotency, realtime delivery contracts, and frontend state merging.

Unit tests cover focused services, reducers, protocol helpers, repositories, and controllers. They should stay fast, deterministic, and close to the code they verify.

Integration tests are reserved for flows where module boundaries matter, especially behavior involving Redis, Postgres, queues, or multi-step event processing. Backend integration tests use Testcontainers and therefore require Docker.

Frontend tests focus on user-visible behavior and client-side data flow: WebSocket reconnect/subscribe behavior, store merge freshness rules, vessel detail rendering, MapLibre layer updates, and lightweight browser diagnostics.

## Backend Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

## Frontend Checks

```bash
pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web test
pnpm --dir web build
```

## CI Quality Gates

CI is expected to protect the same gates contributors run locally:

- backend and frontend typechecking;
- backend and frontend linting;
- backend and frontend unit tests;
- backend integration tests where Docker-backed services are required;
- backend and frontend build verification;
- deployment approval and smoke checks before production rollout.

Related docs:

- [Local development](local-development.md)
- [Deployment](../operations/deployment.md)
