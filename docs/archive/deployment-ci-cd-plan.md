# Archived Document

Status: Historical deployment implementation plan.

This document is preserved for historical context and decision history. It is
not considered a canonical source of truth for the current deployment.

Refer to the active documentation in:

- `README.md`
- `docs/gcp-vm-runbook.md`
- `docs/https-domain-runbook.md`
- `docs/operations-runbook.md`
- `docs/restore-drill.md`

---

# Deployment and CI/CD Plan

This document captures the agreed production-like deployment direction for the
Maritime Intelligence / AIS Tracking System. It is intended to be the handoff
document for implementation across multiple sessions.

The goal is a pragmatic, portfolio-grade deployment: understandable by one
backend developer, realistic enough to demonstrate production judgment, and
cost-conscious for an initial GCP deployment.

## Final Agreed Decisions

- Use Google Cloud Platform Compute Engine for the first deployment.
- Deploy to one persistent VM using Docker Compose.
- Use Nginx as the public reverse proxy.
- Do not require a custom domain or HTTPS for the first deployment.
- Reserve a static external VM IP from the beginning.
- Initial public URLs:
  - Frontend: `http://<VM_STATIC_IP>`
  - REST API: `http://<VM_STATIC_IP>/api`
  - WebSocket: `ws://<VM_STATIC_IP>/ws/positions`
- Postpone domain, DNS, and HTTPS to the final phase.
- Design Nginx so TLS can be added later with Certbot or another production-safe
  Nginx TLS setup.
- Publicly expose only:
  - frontend
  - REST API
  - WebSocket endpoint
- Keep these private initially:
  - Postgres
  - Redis
  - Prometheus
  - Grafana
  - `/metrics`
  - admin endpoints unless explicitly protected
- Access Grafana privately at first, preferably with an SSH tunnel or another
  restricted access path.
- Self-host Postgres/PostGIS and Redis on the same VM for the first deployment.
- Use persistent Docker volumes and/or attached persistent disk storage.
- Keep Redis AOF persistence enabled.
- Do not use Cloud SQL or Memorystore in the first deployment phase.
- Document Cloud SQL as a future improvement.
- Treat Memorystore carefully because the current system uses Redis Streams and
  benefits from AOF-style durability.
- Use GitHub Actions for CI/CD.
- Use Artifact Registry for Docker images.
- Use manual GitHub Environment approval before production deployment.
- Run CI automatically on pull requests and on pushes to `main` or `master`.
- Deploy only after explicit approval.
- Split backend runtime containers by role:
  - `api`: `ApiModule`, `AdminModule`, `RealtimeModule`
  - `ingestion`: `IngestionModule`, `PipelineModule`, `StorageModule`
  - `worker`: `EnrichmentModule`
- Run database migrations through a one-shot migrator container.
- Use a European GCP region close enough to Ukraine and cost-conscious.
  Prefer `europe-central2` or `europe-west4` depending on VM availability and
  pricing. Choose one zone initially.

## Target Architecture

The first production-like topology is a single Compute Engine VM running Docker
Compose.

The Docker Compose split must follow the current `AppModule` role composition:

- `PROCESS_ROLE=all`: `ApiModule`, `AdminModule`, `IngestionModule`,
  `PipelineModule`, `StorageModule`, `EnrichmentModule`, `RealtimeModule`.
- `PROCESS_ROLE=api`: `ApiModule`, `AdminModule`, `RealtimeModule`.
- `PROCESS_ROLE=ingestion`: `IngestionModule`, `PipelineModule`,
  `StorageModule`.
- `PROCESS_ROLE=worker`: `EnrichmentModule`.

Do not invent a different production role split unless the current composition
is first shown to be insufficient.

```text
Internet
  |
  v
GCP external static IP
  |
  v
Nginx container, public ports 80 only at first
  |-- /              -> frontend static service or Nginx-served static files
  |-- /api/*         -> api container :3000
  |-- /ws/positions  -> api container :3000 with WebSocket upgrade headers
  |
  |-- private Docker network only:
      api          PROCESS_ROLE=api
      ingestion    PROCESS_ROLE=ingestion
      worker       PROCESS_ROLE=worker
      migrate      one-shot Drizzle migrations and partition maintenance
      postgres     Postgres 16 + PostGIS, persistent volume
      redis        Redis 7 with AOF, persistent volume
      prometheus   private only
      grafana      private only
```

### Nginx Entrypoint

Nginx is the only public container entrypoint in the initial deployment.

Responsibilities:

- serve the frontend at `/`;
- reverse proxy REST API requests under `/api`;
- reverse proxy `ws://<VM_STATIC_IP>/ws/positions` with correct WebSocket
  upgrade headers;
- expose `/healthz` and `/readyz` by proxying to `api:3000`;
- avoid exposing `/metrics` publicly;
- block `/admin` for the first public deployment even though `AdminModule`
  exists in the API process;
- be structured so a later server-name and TLS block can be added cleanly.

### Frontend

The frontend should be built as a production Vite artifact. It can be served
either:

- from an Nginx image that contains the built static files; or
- from a dedicated static frontend container behind the main Nginx proxy.

The preferred first implementation is to let the public Nginx container serve
the static frontend files directly, unless that makes image publishing or
release tagging awkward.

### API Service

The API service runs the existing NestJS image with:

```text
PROCESS_ROLE=api
```

It owns:

- `ApiModule`;
- `AdminModule`;
- `RealtimeModule`;
- public REST API;
- public WebSocket gateway;
- admin controllers, blocked publicly at Nginx for the first deployment;
- health and readiness endpoints exposed through Nginx for smoke checks.

Only Nginx should reach the API service from the public internet.

### Ingestion Service

The ingestion service runs the same backend image with:

```text
PROCESS_ROLE=ingestion
```

It owns:

- `IngestionModule`;
- `PipelineModule`;
- `StorageModule`;
- AIS provider connection;
- normalization;
- deduplication/sampling pipeline;
- storage writer consumer.

It requires outbound internet access for AISStream and internal access to
Postgres and Redis.

### Worker Service

The worker service runs the same backend image with:

```text
PROCESS_ROLE=worker
```

It owns:

- `EnrichmentModule`;
- enrichment and sanctions background work included in that module;
- BullMQ processors and scheduled/recurring enrichment work owned by the
  current worker role composition.

### Migrator

The migrator is a one-shot container based on the backend migrator image/stage.

It should run before app containers are updated or restarted:

```text
pnpm migrate
pnpm partition:maintain
```

Migration execution must be explicit in the deploy workflow. The initial
strategy assumes migrations are forward-only. If a migration is not
backward-compatible, rollback must be treated as a manual database operation.

### Postgres/PostGIS

Postgres runs privately on the Docker network with a persistent volume.

Requirements:

- no public host port;
- strong production password;
- persistent storage;
- backup and restore procedure;
- disk usage monitoring;
- regular history partition maintenance.

Cloud SQL should be documented as a future improvement when managed backups,
patching, HA, and operational maturity become more valuable than single-VM
simplicity.

### Redis

Redis runs privately on the Docker network with AOF enabled.

Requirements:

- no public host port;
- persistent storage;
- AOF enabled with an explicit fsync policy;
- stream retention configured intentionally;
- backup/restore notes that explain the difference between Redis durability and
  Postgres source-of-truth data.
- Redis AUTH is not required for the first deployment while Redis has no public
  port and is reachable only on the private Docker network. Treat Redis AUTH as
  future hardening unless it is wired cleanly across the app Redis client,
  BullMQ, Redis Streams consumers, readiness checks, and Compose health checks.

Memorystore should not be used initially. If considered later, validate Redis
Streams behavior, persistence semantics, backup/export options, and the lack of
AOF-style durability against this application's recovery expectations.

### Prometheus and Grafana

Prometheus and Grafana run privately at first.

Initial access:

- SSH tunnel to VM; or
- GCP IAP or another restricted operator-only path.

Initial non-goals:

- no public Grafana;
- no public Prometheus;
- no public `/metrics`.

Prometheus should preferably scrape useful backend role containers from day one:
`api`, `ingestion`, and `worker`. If implementation shows that only some roles
expose meaningful metrics, document the final scrape targets.

Public Grafana can be revisited later only with strong authentication, HTTPS,
and a clear reason to expose it.

### Persistent Volumes

At minimum, persist:

- Postgres data directory;
- Redis data directory;
- Grafana data directory;
- Prometheus data if retaining local metric history matters.

For the first VM deployment, named Docker volumes are acceptable if backed by
the VM's persistent disk. A later hardening step can move data paths onto a
separate attached persistent disk with documented mount points.

## CI/CD Design

### Pull Request CI

Every pull request should run the repository's quality gates.

Backend:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Frontend:

```bash
pnpm --dir web install --frozen-lockfile
pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web test
pnpm web:build
```

Integration tests:

```bash
pnpm test:integration
```

Integration tests use Testcontainers and require Docker on the runner. They are
not required on every PR initially. Run them on pushes to `main`/`master` and
through manual workflow dispatch. They can become required on PRs later if
runtime and stability are acceptable.

Note: the frontend currently imports shared contract source from
`../src/contracts`, so the frontend CI job installs root dependencies before
running web-scoped commands. Future improvement: extract shared contracts into a
proper workspace package such as `@ais/contracts`, so backend and frontend
depend on it explicitly instead of importing source across package boundaries.

### Main/Master Workflow

Pushes to `main` or `master` should:

- run the same CI gates;
- build production Docker images;
- push images to Artifact Registry;
- make a deployment available to the protected production environment;
- wait for manual approval before touching the VM.

### Docker Image Strategy

Use immutable tags for deployments.

Recommended tags:

- `backend:<git-sha>`
- `backend:main-latest` or `backend:master-latest` for convenience only;
- `frontend:<git-sha>` if frontend is packaged as its own image;
- `frontend:main-latest` or `frontend:master-latest` for convenience only.

Deployment should always use the exact Git SHA tag, not `latest`.

The backend runtime and migrator can be built from the same Dockerfile using
different targets. If publishing a separate migrator image simplifies Compose,
use:

- `backend:<git-sha>`
- `backend-migrator:<git-sha>`

Otherwise, use one backend image with explicit Compose commands for migration.

### Artifact Registry

Use GCP Artifact Registry as the image registry.

Implementation requirements:

- create a Docker repository in the chosen GCP region;
- configure GitHub Actions authentication using OIDC where practical;
- grant the CI service account permission to push images;
- grant the VM service account permission to pull images;
- avoid long-lived JSON service account keys unless there is no practical
  alternative.

### Manual Approval

Use a protected GitHub Environment, for example `production`.

Deployment should pause for approval after:

- CI succeeds;
- Docker images are built and pushed;
- the exact image tag is known.

Deployment should continue only after explicit approval.

### VM Deployment Mechanism

The first deployment mechanism can be SSH-based because it is simple,
transparent, and appropriate for a single VM.

The deploy job should:

- authenticate to GCP;
- connect to the VM using SSH, preferably through IAP if practical;
- update a release env file with exact image tags;
- run `docker compose pull`;
- run the migrator one-shot container;
- restart/update services with `docker compose up -d`;
- run smoke checks;
- keep enough release metadata to roll back to the previous image tag.

The VM should have:

- Docker and Compose plugin installed;
- access to Artifact Registry;
- production Compose files checked out or deployed under a stable path such as
  `/opt/ais-tracking-system`;
- environment files stored outside the Git working tree or generated securely
  during provisioning/deployment.

### Migration Execution

Deployment order:

1. Pull new images.
2. Run migrator against the current database.
3. If migration succeeds, update/recreate app services.
4. Run smoke checks.
5. If smoke checks fail, roll back containers to previous image tag when safe.

Migration rules:

- migrations are forward-only by default;
- destructive migrations require manual review and a tested backup;
- application code should remain compatible with the previous schema when
  practical;
- rollback after a schema-changing migration may require manual DB intervention.

### Smoke Checks

Minimum smoke checks after deploy:

```bash
curl -fsS http://localhost/nginx-health
curl -I http://localhost/healthz
curl -kfsS https://localhost/healthz
curl -kfsS https://localhost/readyz
curl -kfsS https://localhost/api/vessels?limit=1
```

After HTTPS is enabled, normal HTTP app routes should redirect to HTTPS. The
local deployment smoke script uses `/nginx-health` for plain-HTTP Nginx
readiness and uses `-k` for local HTTPS checks so the bootstrap self-signed
certificate does not block deployment before Let's Encrypt issuance.

Additional checks:

- inspect `docker compose ps`;
- verify `api`, `ingestion`, and `worker` containers are running;
- verify Postgres and Redis health checks are healthy;
- verify Nginx can reach the API;
- verify WebSocket upgrade with a small test client where practical;
- check recent logs for migration errors, missing tables, repeated Redis errors,
  or fatal bootstrap errors.

Nginx should expose `/healthz` and `/readyz` publicly by proxying to
`api:3000/healthz` and `api:3000/readyz`. Nginx must continue to block
`/metrics` publicly.

### Rollback Strategy

Container rollback:

- store previous deployed Git SHA before updating;
- redeploy previous image tags through the same Compose mechanism;
- rerun smoke checks.

Database rollback:

- do not assume automatic rollback after migrations;
- keep fresh backups before risky migrations;
- document whether each migration is backward-compatible;
- for non-backward-compatible migrations, rollback is a manual procedure using
  restore or a corrective migration.

## Security Checklist

- [ ] Do not expose Postgres public ports.
- [ ] Do not expose Redis public ports.
- [ ] Do not expose Prometheus publicly.
- [ ] Do not expose Grafana publicly in the first deployment.
- [ ] Do not expose `/metrics` through public Nginx routes.
- [ ] Expose `/healthz` and `/readyz` through Nginx for smoke checks.
- [ ] Keep admin endpoints protected by `ADMIN_TOKEN`.
- [ ] Block `/admin` at Nginx for the first public recruiter/demo deployment.
- [ ] Use SSH key-only access.
- [ ] Start with SSH restricted by source IP if simpler.
- [ ] Document GCP IAP as preferred SSH hardening and adopt it when practical.
- [ ] Use least-privilege GCP service accounts.
- [ ] Prefer GitHub OIDC for CI-to-GCP authentication.
- [ ] Avoid long-lived service account JSON keys.
- [ ] Do not commit production secrets.
- [ ] Keep production env files on the VM outside tracked source files.
- [ ] Use strong generated values for DB password, `ADMIN_TOKEN`, AISStream key,
      and Grafana admin password.
- [ ] Do not require Redis AUTH initially while Redis is private-only; document
      it as future hardening.
- [ ] Configure GCP firewall rules so public ingress is limited to HTTP now and
      HTTPS later.
- [ ] Keep VM OS packages updated.
- [ ] Configure Docker log rotation.
- [ ] Ensure backups are not world-readable.
- [ ] If backups are uploaded to GCS, use a private bucket and least-privilege
      IAM.
- [ ] Add HTTPS in the final domain phase.
- [ ] In the HTTPS phase, redirect HTTP to HTTPS.
- [ ] In the HTTPS phase, use secure TLS settings and renew certificates
      automatically.

## Implementation Phases

### Phase 1 - CI Foundation

Goal: add GitHub Actions CI for backend and frontend.

Likely files:

- `.github/workflows/ci.yml`
- optionally package scripts if small command aliases help

Implement:

- install pnpm consistently;
- cache pnpm dependencies where appropriate;
- run backend typecheck, lint, tests, and build;
- run frontend typecheck, lint, tests, and build;
- run integration tests on `main`/`master` and manual workflow dispatch, but not
  as required PR CI initially.

Acceptance criteria:

- PR CI is green;
- CI runs automatically on pull requests;
- CI runs automatically on pushes to `main` and `master`;
- failures block merging if branch protection is enabled.

Commands to run locally:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:integration
pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web test
pnpm web:build
```

Risks / things to verify:

- Testcontainers integration tests require Docker on GitHub runners.
- Frontend and backend have separate lockfiles.
- CI cache should not hide lockfile drift.

### Phase 2 - Production Docker Images

Goal: ensure deployable production images exist for backend, migrator, and
frontend/static assets.

Likely files:

- `Dockerfile`
- `web/Dockerfile` or equivalent frontend build packaging
- `.dockerignore`
- possibly `docker/nginx/*`

Implement:

- confirm backend runtime image contains only production runtime requirements;
- confirm backend migrator can run Drizzle migrations and partition maintenance;
- add frontend production build strategy;
- decide whether frontend static files are copied into an Nginx image or served
  from a dedicated frontend container;
- ensure images do not require source mounts.

Acceptance criteria:

- backend image builds locally;
- migrator image/stage builds locally;
- frontend production artifact/image builds locally;
- containers run using environment variables only;
- no production secrets are baked into images.

Commands to run locally:

```bash
docker build -t ais-backend:test .
docker build --target migrator -t ais-migrator:test .
docker build -f web/Dockerfile -t ais-frontend:test .
pnpm web:build
```

Risks / things to verify:

- The current `.dockerignore` excludes docs and env files; keep secrets out.
- The migrator currently uses dev dependencies from the deps stage; verify this
  is acceptable or create a cleaner migrator image.
- Alpine runtime package choices should support all production dependencies.
- The frontend Docker build copies the currently required shared source into
  `web/shared-src` during the image build. Future improvement: extract these
  shared contracts into a proper package such as `@ais/contracts`.

### Phase 3 - Production Docker Compose

Goal: add a VM-oriented Compose stack.

Likely files:

- `docker-compose.prod.yml`
- `.env.production.example`
- possibly `docker/prometheus/prometheus.prod.yml`
- possibly `docs/deployment-ci-cd-progress.md` if the tracker is split later

Implement:

- split backend into `api`, `ingestion`, and `worker`;
- add `migrate` one-shot service;
- add Postgres/PostGIS with persistent volume;
- add Redis with AOF and persistent volume;
- add Prometheus and Grafana private only;
- prefer Prometheus scraping `api`, `ingestion`, and `worker`;
- remove public DB/Redis ports;
- add restart policies;
- add Docker log rotation defaults;
- add health checks;
- wire image tags through env variables rather than local builds;
- keep local development Compose untouched unless needed.

Acceptance criteria:

- production Compose stack can run locally or in a VM-like environment;
- public-facing service is only Nginx once Phase 4 is complete;
- this Compose file is not publicly complete until Phase 4 adds the public
  Nginx entrypoint;
- DB and Redis are reachable only on the private Docker network;
- `api`, `ingestion`, and `worker` use the same image with different
  `PROCESS_ROLE` values.

Commands to run:

```bash
docker compose --env-file .env.production.example -f docker-compose.prod.yml config
docker compose --env-file .env.production.example -f docker-compose.prod.yml up -d
docker compose --env-file .env.production.example -f docker-compose.prod.yml ps
```

Risks / things to verify:

- Role split changes stream consumer behavior and should be tested with live or
  fixture data.
- If multiple roles expose `/metrics`, decide whether Prometheus scrapes all
  role containers or only API initially.
- Values named `change-me` in `.env.production.example` are local placeholders
  only. Replace them with strong secrets in `.env.production` on the VM and do
  not commit that file.
- Ensure service startup ordering does not pretend to guarantee application
  readiness beyond health checks.

### Phase 4 - Nginx Reverse Proxy

Goal: expose frontend, REST API, and WebSocket through one HTTP entrypoint.

Likely files:

- `docker/nginx/nginx.conf`
- `docker/nginx/conf.d/default.conf`
- `docker-compose.prod.yml`

Implement:

- serve frontend at `/`;
- proxy `/api` to the API container;
- proxy `/ws/positions` to the API container;
- set `Upgrade` and `Connection` headers for WebSockets;
- set reasonable proxy timeouts for long-lived WebSockets;
- block `/metrics`;
- block `/admin` for the first public deployment;
- expose `/healthz` and `/readyz`;
- keep config ready for later `server_name` and TLS additions;
- do not configure HTTPS yet.

Acceptance criteria:

- `http://<host>/` serves the frontend;
- `http://<host>/api/vessels` reaches the API;
- `ws://<host>/ws/positions` works;
- `/healthz` and `/readyz` are reachable through Nginx;
- `/metrics` is not publicly reachable;
- `/admin` is not publicly reachable;
- Postgres, Redis, Prometheus, and Grafana are not publicly reachable.

Commands to run:

```bash
curl -i http://localhost/
curl -i http://localhost/api/vessels?limit=1
curl -i http://localhost/metrics
curl -i http://localhost/admin
```

Risks / things to verify:

- Nginx path rewriting for `/api` must preserve the backend's expected routes.
- WebSocket proxy headers and timeouts must be correct.
- Frontend asset fallback should support client-side routing if added later.
- This phase is HTTP-only and uses `server_name _`; domain-specific server names
  and HTTPS/TLS are intentionally deferred to Phase 8.

### Phase 5 - GCP VM Bootstrap and Runbook

Goal: document and optionally script the first reproducible GCP setup.

Likely files:

- `docs/gcp-vm-runbook.md`
- `scripts/deploy/`
- `scripts/vm/`

Implement/document:

- create or select GCP project;
- enable required APIs;
- create Artifact Registry Docker repository;
- reserve static external IP;
- create Compute Engine VM;
- attach or size persistent disk storage;
- configure firewall rules;
- create service accounts;
- grant least-privilege IAM;
- install Docker and Compose plugin;
- authenticate VM to Artifact Registry;
- prepare `/opt/ais-tracking-system` or another stable app directory;
- create production env file securely on the VM;
- document private Grafana access through SSH tunnel or restricted equivalent.

Acceptance criteria:

- a fresh VM can be prepared by following the runbook;
- VM can pull images from Artifact Registry;
- only intended public ports are reachable;
- production secrets are not committed.

Commands to run:

```bash
gcloud compute addresses list
gcloud compute firewall-rules list
gcloud artifacts repositories list
docker compose version
```

Risks / things to verify:

- Region/zone choice affects cost and latency.
- Firewall rules must not accidentally expose DB/Redis.
- SSH access should remain recoverable while still being restricted.
- Start with SSH restricted by source IP if that is simpler. Document IAP as
  preferred hardening, but do not block the first deployment on IAP unless it is
  straightforward to add.

### Phase 6 - CD Workflow

Goal: add approved deployment from GitHub Actions to the VM.

Likely files:

- `.github/workflows/deploy.yml`
- `scripts/deploy/deploy.sh`
- `scripts/deploy/smoke-check.sh`
- `docker-compose.prod.yml`

Implement:

- build and push SHA-tagged images to Artifact Registry;
- require GitHub Environment approval before deployment;
- connect to VM through restricted-source SSH initially, or IAP if already set
  up cleanly;
- update release image tags on VM;
- run `docker compose pull`;
- run migrator;
- restart stack;
- run smoke checks;
- record current and previous deployed SHA;
- fail loudly on unsuccessful migration or smoke check.

Acceptance criteria:

- approved deployment updates the VM to an exact image tag;
- migration runs before app restart;
- failed migration stops deployment;
- smoke checks run after restart;
- previous image tag is available for rollback.

Commands to run:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d --remove-orphans
curl -fsS http://localhost/nginx-health
curl -kfsS https://localhost/readyz
```

Risks / things to verify:

- GitHub OIDC setup can be fiddly but is worth it.
- SSH from GitHub runner to VM may require IAP or carefully scoped firewall
  rules.
- Rollback after non-backward-compatible DB migrations is manual.

### Phase 7 - Backups, Restore, and Operations

Goal: make the deployment operable, not just runnable.

Likely files:

- `scripts/backup/postgres-backup.sh`
- `scripts/backup/redis-backup.sh`
- `docs/operations-runbook.md`
- `docs/restore-drill.md`

Implement:

- Postgres backup script using `pg_dump` or `pg_dumpall` as appropriate;
- Redis backup notes/scripts for AOF/RDB data;
- optional upload to private GCS bucket;
- restore procedure for Postgres;
- restore procedure or recovery notes for Redis;
- log inspection commands;
- container health commands;
- disk usage checks;
- rollback procedure;
- manual sanctions import and DLQ inspection notes;
- backup privacy requirements.

Acceptance criteria:

- backup procedure is documented and manually testable;
- restore procedure is documented;
- operator can inspect logs, health, disk usage, and container status;
- rollback procedure is documented.

Commands to run:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 api
docker compose -f docker-compose.prod.yml logs --tail=200 ingestion
docker compose -f docker-compose.prod.yml logs --tail=200 worker
df -h
```

Risks / things to verify:

- Backups must be encrypted or kept in private storage.
- Redis recovery expectations should be documented honestly.
- Restore drills are the only proof that backups are usable.

### Phase 8 - Domain and HTTPS

Goal: move from static-IP HTTP to domain-based HTTPS.

Likely files:

- `web/nginx.conf`
- `web/docker-entrypoint.d/*`
- `docker-compose.prod.yml`
- `docs/https-domain-runbook.md`
- `docs/gcp-vm-runbook.md`
- `docs/operations-runbook.md`

Implement:

- register or configure a domain;
- create DNS A record pointing to the reserved static IP;
- update Nginx `server_name`;
- add Certbot or another production-safe Nginx TLS workflow;
- configure certificate renewal;
- redirect HTTP to HTTPS;
- update frontend/API/WebSocket public URL documentation;
- verify WebSocket works over `wss://`;
- consider HSTS after the setup is stable.

Acceptance criteria:

- frontend works at `https://<domain>`;
- REST API works at `https://<domain>/api`;
- WebSocket works at `wss://<domain>/ws/positions`;
- HTTP redirects to HTTPS;
- certificate renewal is documented and testable.

Commands to run:

```bash
curl -I https://<domain>/
curl -fsS https://<domain>/api/vessels?limit=1
```

Risks / things to verify:

- Certbot container/file permissions with Nginx volumes.
- Renewal must reload Nginx safely.
- DNS propagation can make initial verification flaky.

## Progress Tracker

Use this tracker as the source of truth for future implementation sessions.
When a task is completed, check it off in the same PR.

### Phase 1 - CI Foundation

- [x] Add backend/frontend GitHub Actions CI workflow.
- [x] Run backend install, typecheck, lint, test, build.
- [x] Run frontend install, typecheck, lint, test, build.
- [x] Configure integration tests to run on main/master and manual dispatch,
      not required PR CI initially.
- [x] Verify PR CI is green.
- [x] Verify push-to-main/master CI is green.

### Phase 2 - Production Docker Images

- [x] Review backend runtime image for production suitability.
- [x] Confirm migrator image/stage behavior.
- [x] Add frontend production image or static build packaging.
- [x] Ensure images run without source mounts.
- [x] Ensure secrets are not baked into images.
- [x] Document local image build commands.

### Phase 3 - Production Docker Compose

- [x] Add `docker-compose.prod.yml`.
- [x] Add `api` service with `PROCESS_ROLE=api`.
- [x] Add `ingestion` service with `PROCESS_ROLE=ingestion`.
- [x] Add `worker` service with `PROCESS_ROLE=worker`.
- [x] Add one-shot `migrate` service.
- [x] Add Postgres persistent volume.
- [x] Add Redis AOF persistent volume.
- [x] Add private Prometheus service.
- [x] Configure Prometheus to prefer scraping `api`, `ingestion`, and `worker`.
- [x] Add private Grafana service.
- [x] Remove public DB/Redis ports.
- [x] Add restart policies.
- [x] Add Docker log rotation defaults.
- [x] Add health checks.
- [x] Validate production Compose config.

### Phase 4 - Nginx Reverse Proxy

- [x] Add Nginx config.
- [x] Serve frontend at `/`.
- [x] Proxy `/api` to API service.
- [x] Proxy `/ws/positions` to API service.
- [x] Configure WebSocket upgrade headers.
- [x] Configure WebSocket-friendly timeouts.
- [x] Block public `/metrics`.
- [x] Expose public `/healthz` and `/readyz`.
- [x] Block public `/admin`.
- [x] Verify frontend/API/WebSocket through one HTTP entrypoint.
- [x] Add notes for future domain/HTTPS changes.

### Phase 5 - GCP VM Bootstrap and Runbook

- [x] Document GCP project setup.
- [x] Document required API enablement.
- [x] Document Artifact Registry creation.
- [x] Document static IP reservation.
- [x] Document Compute Engine VM creation.
- [x] Document firewall rules.
- [x] Document service accounts and IAM.
- [x] Document Docker installation.
- [x] Document Artifact Registry pull auth from VM.
- [x] Document production env file handling.
- [x] Document private Grafana access method.
- [ ] Verify a fresh VM can be prepared from the runbook.

### Phase 6 - CD Workflow

- [x] Add deploy workflow.
- [x] Build and push SHA-tagged images.
- [x] Configure GitHub Environment manual approval.
- [x] Deploy exact image tags to VM.
- [x] Run migrator during deployment.
- [x] Restart production stack.
- [x] Run smoke checks.
- [x] Record current and previous deployed SHAs.
- [x] Document rollback command/path.
- [x] Verify approved deployment updates VM safely.

### Phase 7 - Backups, Restore, and Operations

- [x] Add Postgres backup procedure.
- [x] Add Redis backup/recovery procedure.
- [x] Document optional private GCS backup upload.
- [x] Document Postgres restore drill.
- [x] Document Redis restore/recovery expectations.
- [x] Document log inspection.
- [x] Document health checks.
- [x] Document disk usage checks.
- [x] Document rollback procedure.
- [ ] Manually test backup and restore procedure where practical.

### Phase 8 - Domain and HTTPS

- [x] Document domain/DNS setup.
- [x] Add Nginx `server_name` guidance.
- [x] Add Certbot or equivalent TLS plan.
- [x] Configure HTTP-to-HTTPS redirect.
- [ ] Verify frontend over HTTPS.
- [ ] Verify REST API over HTTPS.
- [ ] Verify WebSocket over WSS.
- [x] Document certificate renewal.
- [ ] Consider HSTS after stable HTTPS operation.

## Recorded Implementation Decisions

- GCP region/zone: use a European GCP region close enough to Ukraine and
  cost-conscious. Prefer `europe-central2` or `europe-west4` depending on VM
  availability and pricing. Choose one zone initially.
- Integration tests: required PR CI includes typecheck, lint, unit tests, and
  build. Integration tests run on `main`/`master` and manual workflow dispatch
  initially.
- Frontend serving: prefer building frontend static files into the public Nginx
  image for the first production deployment. If this complicates image tagging
  or workflow too much, explain why and propose a separate frontend image.
- SSH access: start with SSH restricted by source IP if simpler. Document IAP as
  preferred hardening. Do not block the first deployment on IAP unless it is
  straightforward to add.
- Prometheus: prefer scraping `api`, `ingestion`, and `worker` containers from
  day one. Keep Prometheus private.
- Redis password: do not require Redis AUTH initially. Document it as future
  hardening.
