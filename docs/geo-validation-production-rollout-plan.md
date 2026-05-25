# Geo Validation Production Rollout Plan

This document captures the production rollout plan for the PostGIS-backed
GeoValidation runtime and GeoImport workflow.

It is intentionally operational and deployment-focused. The durable feature
architecture remains in `docs/geo-validation-implementation-plan.md`; this
document explains how to deploy it safely on the current GCP VM Docker Compose
production stack.

## Current Production Deployment Model

Production runs on one GCP Compute Engine VM using Docker Compose from
`/opt/ais-tracking-system`.

The current production compose stack is:

- `postgres`: `postgis/postgis:16-3.4`, private Docker network, persistent
  volume.
- `redis`: `redis:7-alpine`, private Docker network, AOF persistence.
- `api`: backend runtime image with `PROCESS_ROLE=api`.
- `ingestion`: backend runtime image with `PROCESS_ROLE=ingestion`.
- `worker`: backend runtime image with `PROCESS_ROLE=worker`.
- `nginx`: public HTTP entrypoint and frontend image.
- `prometheus`: private metrics scraping for backend roles.
- `grafana`: private dashboard access through local VM tunnel.
- `migrate`: one-shot migrator image/container.

The normal command shape is:

```bash
sudo docker compose \
  --env-file .env.production \
  --env-file .env.release \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.grafana-local.yml \
  ...
```

Release metadata is managed through:

```text
.env.release
.deploy/releases/current.env
.deploy/releases/previous.env
```

The current `scripts/deploy/deploy.sh` flow is:

1. Build next release metadata.
2. Pull release images.
3. Run `docker compose run --rm migrate`.
4. Promote `.env.release`.
5. Start the full stack with `up -d --remove-orphans`.
6. Run smoke checks.
7. Roll back container metadata if smoke checks fail.

There is already a one-off container pattern through the `migrate` service.
GeoImport should follow that operational shape rather than becoming a long-lived
runtime process.

## Current GeoValidation State

Already implemented:

- PostGIS schema migration and `geo_validate_position(lon, lat)`.
- Runtime `GeoValidationService`.
- Pipeline order: provider normalization -> dedup -> bbox -> geo validation ->
  sampler -> publish.
- Dataset versioning and single active dataset version.
- Safe active-version swap: import activates the new version only after a
  successful load, index refresh, and validation.
- `pnpm geo:import` local import script.
- `pnpm geo:tune` probe validation script.
- Production-like manifest in `scripts/geo/datasets.json`.
- Fixture manifest in `scripts/geo/datasets.fixture.json`.
- Inland water support through Geofabrik-style layer selection and buffered
  `waterways` line import.

Not implemented yet:

- A production `geo-import` Docker image with GDAL/ogr2ogr.
- A production `geo-import` compose service.
- Release metadata for `AIS_GEO_IMPORT_IMAGE`.
- Production compose forwarding of `GEO_*` runtime configuration.
- A first-rollout deployment mode that avoids starting ingestion before a
  verified active geo dataset exists.
- Runbook commands for first rollout and future dataset refreshes.

## Non-Negotiable Architecture Constraint

Runtime containers must remain clean and lightweight.

The following services must not gain GDAL/ogr2ogr or heavy import-time GIS
tooling:

- `api`
- `ingestion`
- `worker`

GDAL/ogr2ogr belongs only in a dedicated import environment/container. The
runtime path must depend only on:

- Postgres/PostGIS tables and `geo_validate_position()`.
- Redis cache.
- Existing backend runtime dependencies.

## Runtime And Import Image Strategy

Use a separate import image. The preferred first implementation is a new
Dockerfile target in the existing `Dockerfile`, for example:

```text
geo-import
```

The target should:

- inherit enough Node/pnpm tooling to run TypeScript scripts;
- include `scripts/geo`, `src/shared/config`, `drizzle.config.ts` only as
  needed by the script;
- install GDAL/ogr2ogr in that target only;
- run `pnpm geo:import` as the default command or compose command;
- stop after success or failure.

The runtime target should remain unchanged except for normal application code
updates. Do not install GDAL in `runtime`, and do not add GDAL to the backend
runtime image used by `api`, `ingestion`, or `worker`.

The GDAL-enabled import image will likely be materially larger than the runtime
image and can increase CI build time and Artifact Registry storage usage. That
tradeoff is acceptable only because the runtime image remains lightweight and
free of import-time GIS tooling.

Release metadata should gain:

```text
AIS_GEO_IMPORT_IMAGE=<registry>/geo-import:<DEPLOY_SHA>
```

`AIS_GEO_IMPORT_IMAGE` must use the same immutable `${DEPLOY_SHA}` tagging
strategy as `AIS_BACKEND_IMAGE`, `AIS_MIGRATOR_IMAGE`, and
`AIS_FRONTEND_IMAGE`. Do not use `latest` for production geo imports.

CI/CD should build and push this image alongside:

- backend runtime image;
- migrator image;
- frontend image.

Compose should gain a one-shot `geo-import` service that uses the same private
Docker network as Postgres. It should receive the same database URL convention
as `migrate`:

```text
postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```

Required import environment:

```text
DATABASE_URL
GEO_DATASETS_PATH=scripts/geo/datasets.json
GEO_IMPORT_USE_OGR2OGR=true
GEO_IMPORT_WORK_DIR=/tmp/geo-import
GEO_COVERAGE_MARGIN_KM=50
GEO_COASTAL_TOLERANCE_METERS=500
```

Optional environment:

```text
GEO_MANUAL_OVERRIDES_DIR=data/geo/manual-overrides
GEO_IMPORT_FAIL_AFTER_LOAD=false
```

The service must have `restart: "no"` and must not be part of normal automatic
startup. GeoImport must never run because of plain `docker compose up`, app
startup, healthcheck behavior, or a restart policy. It should be invoked only
as an explicit one-off operator job:

```bash
sudo docker compose ... run --rm geo-import
```

The import container should stop after the command exits. Operators should treat
any long-running `geo-import` container as abnormal.

After building the import image, verify that GDAL is actually present:

```bash
sudo docker compose ... run --rm --entrypoint ogr2ogr geo-import --version
sudo docker compose ... run --rm --entrypoint gdalinfo geo-import --version
```

## Runtime Configuration Strategy

Production compose currently does not pass `GEO_*` variables into backend
runtime containers. This must be fixed before first rollout because the app
configuration defaults `GEO_VALIDATION_ENABLED=true`.

Production compose should forward at least:

```text
GEO_VALIDATION_ENABLED
GEO_VALIDATION_FAIL_OPEN
GEO_COASTAL_TOLERANCE_METERS
GEO_COVERAGE_MARGIN_KM
GEO_CACHE_ENABLED
GEO_CACHE_PRECISION
GEO_CACHE_TTL_SECONDS
GEO_CACHE_UNCERTAIN_TTL_SECONDS
```

For first rollout, `.env.production` should explicitly set:

```text
GEO_VALIDATION_ENABLED=false
GEO_VALIDATION_FAIL_OPEN=true
GEO_COASTAL_TOLERANCE_METERS=500
GEO_COVERAGE_MARGIN_KM=50
GEO_CACHE_ENABLED=true
GEO_CACHE_PRECISION=4
GEO_CACHE_TTL_SECONDS=604800
GEO_CACHE_UNCERTAIN_TTL_SECONDS=1800
AIS_PROVIDERS=
```

After import and verification, enable:

```text
GEO_VALIDATION_ENABLED=true
AIS_PROVIDERS=aisstream
```

Keep `GEO_VALIDATION_FAIL_OPEN=true` for the initial production rollout. Consider
fail-closed only after real production traffic has been observed and false
reject risk is understood.

## First Production Rollout Sequence

This is the safest first enablement flow. It is intentionally manual and
operator-controlled.

The required order is always:

```text
migrations -> geo-import -> verification -> enable geo validation -> enable ingestion
```

Do not run GeoImport before migrations. The import script depends on the
PostGIS schema, geo tables, indexes, and `geo_dataset_versions` structures
created by the migration set.

### 1. Prepare Release

Deploy support changes but keep ingestion disabled:

```text
AIS_PROVIDERS=
GEO_VALIDATION_ENABLED=false
GEO_VALIDATION_FAIL_OPEN=true
```

The first implementation should either add a deploy mode that does not start
the full stack automatically or document a manual sequence that operators run
instead of the current all-in-one `deploy.sh` flow.

### 2. Start Infrastructure

Start only infrastructure dependencies if needed:

```bash
sudo docker compose ... up -d postgres redis
```

If the old stack is already running, stop live ingestion before migration/import:

```bash
sudo docker compose ... stop ingestion
```

### 3. Run Migrations

Run the existing migrator:

```bash
sudo docker compose ... run --rm migrate
```

Expected result:

- `geo_dataset_versions` exists.
- `geo_land_polygons` exists.
- `geo_navigable_water_polygons` exists.
- `geo_manual_overrides` exists.
- `geo_validate_position(lon, lat)` exists.

### 4. Run GeoImport

Before running the first real import from a newly built image, verify GDAL in
the same one-off service:

```bash
sudo docker compose ... run --rm --entrypoint ogr2ogr geo-import --version
sudo docker compose ... run --rm --entrypoint gdalinfo geo-import --version
sudo docker compose ... run --rm --entrypoint ogr2ogr geo-import --formats | grep -i PostgreSQL
```

Run the one-shot import job:

```bash
sudo docker compose ... run --rm geo-import
```

Expected behavior:

- downloads configured datasets from `scripts/geo/datasets.json`;
- uses GDAL `/vsizip/` paths for zipped OSMData/Geofabrik sources;
- loads source data into staging tables;
- filters configured `fclass` values;
- buffers selected waterway lines into polygons;
- clips to `AIS_COVERAGE_ZONES + GEO_COVERAGE_MARGIN_KM`;
- inserts rows into final geo tables;
- creates/refreshes indexes and statistics;
- activates the new dataset version only after success;
- drops staging tables and stops.

### 5. Verify Active Dataset

Run:

```bash
sudo docker compose ... exec postgres psql -U ais -d ais -c "
SELECT id, version, is_active, activated_at, coverage_margin_km, coastal_tolerance_meters
FROM geo_dataset_versions
ORDER BY created_at DESC
LIMIT 5;
"
```

There should be exactly one active dataset:

```bash
sudo docker compose ... exec postgres psql -U ais -d ais -c "
SELECT count(*) AS active_versions
FROM geo_dataset_versions
WHERE is_active;
"
```

Expected: `1`.

### 6. Verify Imported Row Counts

Run:

```bash
sudo docker compose ... exec postgres psql -U ais -d ais -c "
SELECT source, source_layer, region, count(*) AS rows
FROM geo_navigable_water_polygons
WHERE dataset_version_id = (SELECT id FROM geo_dataset_versions WHERE is_active)
GROUP BY source, source_layer, region
ORDER BY source, source_layer;
"
```

Also verify land:

```bash
sudo docker compose ... exec postgres psql -U ais -d ais -c "
SELECT source, source_layer, region, count(*) AS rows
FROM geo_land_polygons
WHERE dataset_version_id = (SELECT id FROM geo_dataset_versions WHERE is_active)
GROUP BY source, source_layer, region
ORDER BY source, source_layer;
"
```

Expected:

- OSMData land rows.
- OSMData water rows.
- Geofabrik Freiburg waterways rows.
- Geofabrik Freiburg water polygon rows if the configured layer contributes
  geometries inside coverage.

### 7. Verify SQL Probes

Run:

```bash
sudo docker compose ... exec postgres psql -U ais -d ais -c "
SELECT 'rhine_basel_1' AS probe, geo_validate_position(7.58678, 47.56220333333333)
UNION ALL
SELECT 'rhine_basel_2', geo_validate_position(7.575641666666667, 47.61412833333333)
UNION ALL
SELECT 'rhine_rheinfelden', geo_validate_position(7.7906, 47.5596)
UNION ALL
SELECT 'rhine_near_basel_midstream', geo_validate_position(7.5985, 47.5790)
UNION ALL
SELECT 'nearby_basel_land', geo_validate_position(7.6100, 47.5600)
UNION ALL
SELECT 'nearby_rheinfelden_land', geo_validate_position(7.8050, 47.5650);
"
```

Expected:

- Rhine/Basel/Rheinfelden water probes: `allow/navigable_water`.
- Nearby land probes: ideally `reject/deep_land`; `uncertain/coastal_tolerance`
  can be acceptable if the selected point is close to shoreline.

Run `pnpm geo:tune` only from a container/image that contains the script and can
connect to production Postgres. The runtime image does not currently include
source scripts.

### 8. Start Runtime With Geo Disabled

Start API/worker/observability first:

```bash
sudo docker compose ... up -d api worker prometheus grafana nginx
```

Run smoke checks:

```bash
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/deploy/smoke-check.sh
```

### 9. Enable Geo Validation

Update `.env.production`:

```text
GEO_VALIDATION_ENABLED=true
```

Restart backend runtime services:

```bash
sudo docker compose ... up -d api worker
```

If ingestion is still stopped, leave it stopped until the API/metrics path is
healthy.

### 10. Enable Ingestion

Update `.env.production`:

```text
AIS_PROVIDERS=aisstream
```

Start ingestion:

```bash
sudo docker compose ... up -d ingestion
```

Watch logs:

```bash
sudo docker compose ... logs --tail=300 ingestion
sudo docker compose ... logs --tail=300 api
sudo docker compose ... logs --tail=300 postgres
```

## Future Dataset Refresh Flow

Future refreshes should not require app downtime.

Recommended flow:

1. Keep runtime app running.
2. Run `sudo docker compose ... run --rm geo-import`.
3. Import creates a new dataset version with `is_active=false`.
4. Import loads all rows, indexes/analyzes, validates minimum row counts, then
   swaps active version inside a transaction.
5. If import fails, the previous active version remains active.
6. Run row-count and SQL probe checks.
7. Observe Grafana active dataset label changing after runtime sees traffic.

Do not delete old dataset versions during the first production rollout. Add a
retention/cleanup policy later after storage growth is understood.

## Rollback Strategy

If import fails:

- The one-shot container exits non-zero.
- No new active version should be promoted.
- Existing active dataset remains active if one existed.
- If this is first rollout and no active dataset exists, keep
  `GEO_VALIDATION_ENABLED=false` and do not start ingestion yet.

If new code deploys but no active dataset exists:

- `geo_validate_position()` returns `allow/dataset_unavailable`.
- With `GEO_VALIDATION_FAIL_OPEN=true`, ingestion availability is preserved.
- This is availability-safe but not validation-complete.

Fast disable:

```text
GEO_VALIDATION_ENABLED=false
```

Then restart backend runtime services:

```bash
sudo docker compose ... up -d api ingestion worker
```

Container rollback:

```bash
cd /opt/ais-tracking-system
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/deploy/rollback.sh --app-dir /opt/ais-tracking-system
```

Schema rollback is not automatic. The geo migration should be treated as
forward-only operationally.

## Observability And Acceptance Checks

Grafana already has a **Geo Validation** row. During rollout, watch:

- `Active geo dataset`
- `Deep-land rejects / sec`
- `Geo validation errors / sec`
- `Geo cache hit ratio`
- `PostGIS geo validation p95 latency`
- `Geo validation decisions / sec`

Prometheus metric names:

- `ais_geo_dataset_active_info`
- `ais_geo_validation_total`
- `ais_geo_validation_cache_total`
- `ais_geo_validation_duration_seconds`
- `ais_messages_dropped_total{reason="on_land"}`
- `ais_messages_dropped_total{reason="geo_validation_error"}`

Good rollout looks like:

- Exactly one active geo dataset version.
- SQL probes return expected results.
- `geo_validation_error` is zero or near zero.
- `dataset_unavailable` decisions disappear after enablement and import.
- Deep-land rejects exist but do not dominate all position traffic.
- PostGIS p95 latency remains acceptable.
- AISStream connects and emits messages.
- `/healthz`, `/readyz`, and `/api/vessels?limit=1` remain healthy.

## Existing Bad Latest Positions

GeoValidation only affects new incoming position events after it is enabled.
Existing `vessel_positions_latest` rows may already include invalid historical
positions. Do not combine first rollout with destructive latest-position cleanup.

Treat cleanup/backfill as separate follow-up work:

- inspect how many current latest rows would be rejected by the active dataset;
- decide whether to delete, mark stale, or wait for new valid telemetry;
- document exact SQL and rollback before modifying production data.

## Risks And Tradeoffs

- `GEO_VALIDATION_ENABLED=true` without active dataset allows positions as
  `dataset_unavailable`; this is safe for availability but not validation.
- Fail-open preserves ingestion during geo outages but can allow bad positions.
- Fail-closed can drop valid AIS traffic if data/import/query behavior is wrong.
- First production manifest is a minimal Upper Rhine/Freiburg slice, not full
  Rhine corridor coverage.
- OSMData/Geofabrik latest URLs can change between imports; import metadata
  records import time but not immutable upstream content.
- Import can be network, CPU, memory, and disk intensive.
- The GDAL-enabled import image can substantially increase CI build time,
  registry storage use, and image size. Runtime images must remain lightweight.
- The VM may need temporary disk headroom for downloaded archives and staging
  tables.
- Old dataset versions will accumulate until a retention task exists.
- Runtime cache keys include dataset version; a dataset refresh naturally avoids
  stale cache decisions but leaves old Redis keys until TTL expiry.

## Required Implementation Phases

### Phase 1 - Compose And Env Safety

- Add `GEO_*` runtime variables to `x-backend-env` in
  `docker-compose.prod.yml`.
- Add conservative geo defaults to `.env.production.example`, with
  `GEO_VALIDATION_ENABLED=false` for first rollout.
- Keep `AIS_PROVIDERS=` documented as the safe pre-import setting.
- Verify production compose config renders with the new variables.

### Phase 2 - GDAL-Enabled Import Image

- Add a dedicated GDAL-enabled import target/image.
- Do not modify the runtime image to install GDAL.
- Ensure the import image contains `pnpm geo:import`, `scripts/geo`,
  `scripts/geo/datasets.json`, and enough source/config code to run.
- Add or document smoke checks for `ogr2ogr --version` and
  `gdalinfo --version` inside the built import image/container.
- Account for larger image size, longer CI builds, and additional registry
  storage usage caused by GDAL packages.
- Build and push the import image in CI.

### Phase 3 - Compose GeoImport Service

- Add `geo-import` one-shot service to `docker-compose.prod.yml`.
- Wire `AIS_GEO_IMPORT_IMAGE`.
- Use `restart: "no"`.
- Ensure the service does not run during ordinary `docker compose up`, app
  startup, or restart handling; operators must launch it explicitly with
  `docker compose run --rm geo-import`.
- Depend on healthy `postgres`.
- Set import-specific env vars.
- Ensure it can reach `postgres` over the private Compose network.

### Phase 4 - Release Metadata Flow

- Add `AIS_GEO_IMPORT_IMAGE` to `.env.release` generation.
- Tag it with the exact same `${DEPLOY_SHA}` as backend, migrator, and frontend
  images.
- Include the import image in deployment summary.
- Pull the import image during deploy.
- Do not automatically run import during the default deploy flow yet unless a
  dedicated first-rollout mode is intentionally added.

### Phase 5 - First Rollout Operator Workflow

- Add documented or scripted manual workflow for:
  - stop/disable ingestion;
  - run migrations;
  - run geo import;
  - verify active dataset;
  - verify probes;
  - enable geo validation;
  - enable ingestion;
  - monitor.
- Prefer runbook documentation plus a small helper script over clever
  automation for the first rollout.

### Phase 6 - Safer Deploy Orchestration

- Consider `deploy.sh --no-start-ingestion` or `--infra-only` if needed.
- Do not make the standard deploy automatically run long geo imports until the
  first manual rollout has been proven.

### Phase 7 - Future Operational Enhancements

- Dataset retention cleanup.
- Import duration/disk usage metrics.
- Optional immutable source checksums when practical.
- Additional Rhine corridor extracts beyond Freiburg.
- Optional latest-position cleanup/backfill workflow.

## Required Checks Before Merging Deployment Support

Run at least:

```bash
pnpm typecheck
pnpm lint
pnpm test --runTestsByPath src/geo/geo-import-paths.spec.ts
pnpm test:integration
pnpm migrate:check
docker build --target runtime .
docker build --target migrator .
docker build --target geo-import .
docker run --rm <built-geo-import-image> ogr2ogr --version
docker run --rm <built-geo-import-image> gdalinfo --version
docker run --rm <built-geo-import-image> ogr2ogr --formats | grep -i PostgreSQL
docker compose --env-file .env.production.example --env-file <test-release-env> -f docker-compose.prod.yml config
```

The exact Docker compose config command may need a temporary local release env
with placeholder image names and required passwords.

## Open Questions For Implementation

- Should `geo-import` be a target in the existing `Dockerfile` or a separate
  `Dockerfile.geo-import`? Preferred first choice: existing multi-stage
  `Dockerfile` target for shared dependency cache and CI simplicity.
- Should first-rollout orchestration live in `deploy.sh` or a separate
  `scripts/deploy/geo-rollout.sh`? Preferred first choice: separate script or
  runbook commands so the normal deploy path remains boring.
- Should `pnpm geo:tune` run inside the import image after import? It is useful
  but should probably remain an explicit operator command for first rollout.
- How much disk headroom is needed for OSMData archives and staging tables on
  the current VM? Verify before import.
