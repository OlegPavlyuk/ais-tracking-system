# Geo Validation Implementation Plan

Durable implementation plan for production-like AIS position geo validation in
the Maritime Intelligence / AIS Tracking System.

This document is intended to survive future sessions and fresh AI contexts. It
captures the finalized architecture decisions, module boundaries, dataset
choices, operational assumptions, implementation phases, progress tracking,
testing expectations, and out-of-scope items for the geo-validation feature.

Update this document as implementation progresses. Do not silently change the
architecture decisions without recording the reason.

---

## Goal

Prevent clearly invalid AIS positions from reaching `ais.events.v1`, storage,
and realtime consumers when upstream AIS data contains noisy, stale, spoofed, or
otherwise incorrect coordinates.

The feature should reject obvious deep-land positions such as vessels appearing
near Paris, Lyon, Turin, or other inland continental areas without relevant
navigable water, while preserving valid vessels near coastlines, ports,
estuaries, major rivers, canals, and inland waterways where available data
supports that decision.

Target scale:

- ~200 AIS messages/second average.
- ~1k AIS messages/second peak.
- Production-like portfolio backend, without heavyweight GIS operations in the
  normal runtime container.

---

## Scope

### In Scope

- PostGIS-backed geo validation.
- Deep-land rejection.
- Inland/navigable-water exceptions.
- Coastal tolerance handling.
- SQL validation function: `geo_validate_position()`.
- Dedicated `src/geo` module.
- Redis rounded-coordinate/geohash-style cache.
- Repo-owned manual override GeoJSON import.
- Prometheus metrics, Grafana panels, and structured logs.
- Dataset clipping to `AIS_COVERAGE_ZONES + GEO_COVERAGE_MARGIN_KM`.
- Subdivided geometries and GiST indexes.
- Structured geo-validation results.
- Safe, rerunnable dataset import flow.
- Dataset versioning and active-version swap strategy.

### Out Of Scope For This Phase

- Movement validator.
- Suspicious AIS scoring.
- Full confidence engine.
- Rejected sample persistence tables or streams.
- Scheduled dataset auto-refresh jobs.
- Admin API for manual overrides.
- Overpass-based automated production import.

Rejected-position observability is in scope through metrics and structured logs
only.

---

## Finalized Decisions

### Module Ownership

Geo validation is owned by a dedicated `src/geo` module.

The geo module owns:

- PostGIS geo-validation logic.
- Dataset versioning.
- Redis geo cache.
- SQL validation integration.
- Geo-specific repositories, services, and types.
- Manual overrides support.
- Geo metrics.

The pipeline consumes `GeoValidationService`, but does not own geo dataset
lifecycle, spatial-query logic, cache details, or import tooling.

### Dataset Import Tooling

Use a TypeScript orchestration script with GDAL/ogr2ogr and PostGIS SQL.

The normal runtime application container must not require GDAL/ogr2ogr. GDAL is
an import-time dependency only for the geo-import/dev/ops environment.

The import flow should be mostly automated and production-like:

- Download pinned datasets automatically.
- Clip datasets using `AIS_COVERAGE_ZONES + GEO_COVERAGE_MARGIN_KM`.
- Validate, subdivide, index, and analyze geometries automatically.
- Import repo-owned manual overrides.
- Activate a dataset version only after successful import.
- Support first-time bootstrap on a fresh environment.
- Support safe reruns during deploys.
- Support idempotent dataset refreshes.

No full distributed geo-update pipeline or scheduled auto-refresh job is needed
for the first implementation.

### Inland Water Source

Use Geofabrik free regional extracts plus repo-owned manual overrides.

Avoid Overpass-based automated extraction in the production-like import flow for
now.

Inland/navigable-water support is best effort. The system should preserve major
rivers, canals, ports, estuaries, and coastal inland waterways where available
from OSM/Geofabrik plus manual overrides. Perfect inland-water coverage is not
guaranteed initially.

### Coastal Tolerance

Default:

```text
GEO_COASTAL_TOLERANCE_METERS=500
```

Positions inside coastal tolerance pass as `uncertain/coastal_tolerance`.

They should:

- Continue through the pipeline.
- Emit metrics.
- Produce structured logs during tuning.
- Not be treated as high-confidence valid positions.

Keep the tolerance configurable.

`geo_coastal_tolerance_polygons` should remain optional. If coastal tolerance can
be implemented efficiently with indexed geometries and `ST_DWithin`, prefer the
simpler approach first. Precomputed tolerance polygons can be added later if
profiling shows a need.

### Dataset Unavailable Behavior

Default:

```text
GEO_VALIDATION_FAIL_OPEN=true
```

If geo validation becomes unavailable:

- Do not stop ingestion.
- Continue processing positions.
- Emit explicit metrics and structured logs.

### Redis Cache

Cache `allow` and `reject` verdicts with the normal TTL.

Cache `uncertain/coastal_tolerance` verdicts with a shorter TTL.

Include dataset version in cache keys so cache invalidation after dataset
refresh happens naturally.

### Manual Overrides

Use repo-owned GeoJSON files imported into `geo_manual_overrides`.

Manual overrides remain:

- Version-controlled.
- Reviewable.
- Reproducible between environments.

No admin API for manual overrides in this phase.

---

## Coverage Zones And Validity

`AIS_COVERAGE_ZONES` in `src/shared/config/constants.ts` are the single source
of truth for operational coverage envelopes.

Important distinction:

- Bbox coverage is not valid-water proof.
- Bbox coverage only defines operational scope for AIS subscription, coarse
  server-side filtering, and dataset clipping/import optimization.

The current coverage zones are coarse bounding boxes and intentionally include
large land areas. They must not be used as proof that a point is a valid
maritime/water position.

Actual land/water validity must come from:

- PostGIS geo datasets.
- Inland/navigable-water layers.
- Manual overrides.
- Coastal tolerance logic.
- `geo_validate_position()`.

As new coverage zones are added later, geo import tooling should automatically
clip datasets to the expanded coverage union plus safety margin.

---

## Runtime Responsibilities

The normal app runtime owns:

- `src/geo` Nest module.
- `GeoValidationService`.
- `GeoCacheService`.
- `GeoDatasetRepository`.
- SQL function calls.
- Redis geo cache reads/writes.
- Metrics and structured logging.
- Pipeline integration before `ais.events.v1`.

Runtime must not:

- Download shapefiles.
- Run GDAL/ogr2ogr.
- Transform large raw GIS datasets.
- Require global/world-scale raw datasets.

---

## Implementation Strategy: Fixtures First

Implementation must not begin with large real OSM/Geofabrik imports.

Start by validating the core behavior using small controlled fixture geometries
and fixture-based PostGIS integration tests. This keeps algorithm correctness,
module boundaries, and pipeline semantics separate from real-world dataset
quality and import-tooling complexity.

Fixture-based tests should prove:

- SQL function correctness.
- Verdict evaluation order.
- Pipeline behavior.
- Fail-open and fail-closed behavior.
- Cache behavior.
- Drop/pass decisions.
- Metrics and logging behavior.
- Module boundaries.

Example fixture scenarios:

- Point clearly inside land -> `reject/deep_land`.
- Point inside navigable-water polygon -> `allow/navigable_water`.
- Point inside manual override polygon -> `allow/manual_allow`.
- Point near coastline -> `uncertain/coastal_tolerance`.
- Point outside land -> `allow/not_land`.

Fixture tests validate algorithm correctness and architecture.

Real dataset tests validate:

- Dataset quality.
- Import tooling.
- GDAL/ogr2ogr orchestration.
- Clipping/subdivision/indexing behavior.
- Operational behavior across reruns and active-version swaps.

These concerns should not be mixed too early. Keep the first implementation
slices small, deterministic, and reviewable before introducing large real-world
datasets.

---

## Geo Import / Dev / Ops Responsibilities

The geo import/dev/ops environment owns:

- Downloading pinned datasets.
- Running GDAL/ogr2ogr.
- Loading raw data into staging.
- Building the coverage union from `AIS_COVERAGE_ZONES`.
- Applying `GEO_COVERAGE_MARGIN_KM`.
- Running `ST_MakeValid`.
- Clipping datasets to coverage union plus margin.
- Subdividing geometries.
- Creating GiST indexes.
- Running `ANALYZE`.
- Importing repo-owned manual override GeoJSON.
- Recording dataset version metadata.
- Activating the new version only after successful import.

The intended command is:

```text
pnpm geo:import
```

The command should be safe to run:

- On a fresh database.
- During redeployments.
- Multiple times with the same pinned dataset metadata.
- As an idempotent refresh operation.

Geo dataset imports/reimports must not interrupt active runtime validation
unexpectedly.

---

## Dataset Pinning And Reproducibility

Geo import must rely on pinned dataset URLs, dates, versions, or a small dataset
metadata file so imports remain reproducible between environments and future
sessions.

Recommended metadata location:

```text
scripts/geo/datasets.json
```

The metadata file should capture:

- Source name.
- Dataset URL.
- Dataset type/layer.
- Region/extract name.
- License/attribution note.
- Pinned date or version when available.
- Optional checksum if practical.
- Intended target table or staging flow.

The first implementation does not need a complex checksum/version registry, but
the import flow should avoid untracked "latest URL with unknown contents"
behavior where possible. If a source only exposes a latest URL, record the import
timestamp and source URL in `geo_dataset_versions`.

---

## Active Dataset Version Swap Strategy

Dataset refreshes should use a safe active-version swap:

1. The old dataset version remains active.
2. The new dataset version is downloaded, staged, cleaned, clipped, subdivided,
   indexed, and analyzed under a new version id.
3. The new version is marked active only after the import completes
   successfully.
4. Runtime validation reads only the active version.
5. Redis cache invalidates naturally because cache keys include dataset version.
6. Old dataset versions can be retained temporarily for rollback/debugging and
   cleaned up later by an explicit maintenance step.

If a refresh fails, the previous active version remains active and ingestion
continues.

---

## Pipeline Placement

Current path:

```text
AISStream raw -> raw filter -> normalizer -> dedup -> bbox -> sampling -> publish ais.events.v1
```

New path:

```text
AISStream raw
  -> raw filter
  -> normalizer
  -> dedup
  -> bbox coarse filter
  -> geo validation
  -> sampling
  -> publish ais.events.v1
```

Only `position` events are geo-validated. `static` events bypass this stage.

The insertion point is in `IngestionPipelineService`, immediately after the
existing coarse bbox check and before `SamplerService.shouldEmit(...)`.

Rationale:

- Keeps invalid positions out of `ais.events.v1`.
- Prevents invalid positions from being stored.
- Prevents invalid positions from being broadcast over WebSocket.
- Keeps downstream consumers clean and consistent.
- Avoids putting provider-agnostic geo logic into provider normalizers.

---

## Module Boundary

Proposed runtime structure:

```text
src/geo/
  geo.module.ts
  geo-validation.service.ts
  geo-cache.service.ts
  geo-dataset.repository.ts
  geo-validation.types.ts
  geo.metrics.ts
```

Responsibilities:

- `GeoModule`: imports `DbModule`, `RedisModule`, `ConfigModule`, and metric
  providers; exports `GeoValidationService`.
- `GeoValidationService`: hot-path validation orchestration and fail-open
  behavior.
- `GeoCacheService`: dataset-versioned Redis cache keys and TTL selection.
- `GeoDatasetRepository`: SQL function call and active dataset version lookup.
- `geo-validation.types.ts`: verdict/result types.
- `geo.metrics.ts`: geo-specific metric label constants/helpers if useful.

`PipelineModule` should import `GeoModule` and consume only
`GeoValidationService`.

---

## Datasets

### Land Baseline

Use OSMData land polygons, preferably split WGS84 polygons.

Purpose:

- Reject points clearly inside land polygons.
- Better coastline fidelity than Natural Earth for Europe, Mediterranean, and
  Black Sea coverage.

License:

- OSM-derived data; treat as ODbL.

### Sea / Coastal Context

Use OSMData water polygons, preferably split WGS84 polygons.

Purpose:

- Support coastal tolerance checks and water context.

Important limitation:

- OSMData water polygons cover oceans/seas from coastline and do not cover all
  inland water such as lakes, reservoirs, rivers, and canals.

### Inland / Navigable Water

Use Geofabrik free regional OSM extracts for relevant regions/countries.

Purpose:

- Preserve valid vessels on major rivers, canals, docks, basins, estuaries, and
  port water where available.

License:

- OSM-derived data; treat as ODbL.

Initial support is best effort. Manual overrides should cover practical gaps
found during tuning.

### Manual Overrides

Use repo-owned GeoJSON files.

Suggested path:

```text
data/geo/manual-overrides/*.geojson
```

Manual override polygons are imported into `geo_manual_overrides` and evaluated
before land rejection.

---

## PostGIS Schema

Proposed tables:

```text
geo_dataset_versions
geo_land_polygons
geo_navigable_water_polygons
geo_manual_overrides
```

Optional later:

```text
geo_coastal_tolerance_polygons
```

Suggested `geo_dataset_versions` fields:

```text
id uuid primary key
version text not null unique
source_metadata jsonb not null
coverage_margin_km double precision not null
coastal_tolerance_meters double precision not null
is_active boolean not null default false
created_at timestamptz not null default now()
activated_at timestamptz
```

Suggested polygon table fields:

```text
id bigserial primary key
dataset_version_id uuid not null references geo_dataset_versions(id)
source text not null
source_layer text
region text
geom geometry(Geometry, 4326) not null
created_at timestamptz not null default now()
```

Indexes:

```text
GiST (geom)
Btree (dataset_version_id)
Btree (source)
```

Production query tables should contain only clipped/subdivided geometries, not
global raw datasets.

---

## SQL Function

Add a stable DB boundary:

```text
geo_validate_position(lon double precision, lat double precision)
```

Return a structured result as `jsonb` or a composite type:

```json
{
  "verdict": "allow | reject | uncertain",
  "reason": "manual_allow | navigable_water | coastal_tolerance | deep_land | not_land | dataset_unavailable",
  "datasetVersion": "..."
}
```

Evaluation order:

1. Manual allow override -> `allow/manual_allow`.
2. Navigable/inland water -> `allow/navigable_water`.
3. Coastal tolerance within `GEO_COASTAL_TOLERANCE_METERS` ->
   `uncertain/coastal_tolerance`.
4. Covered by land -> `reject/deep_land`.
5. Otherwise -> `allow/not_land`.

Only `reject/deep_land` is dropped by the pipeline.

Query patterns should use:

- `geom && point` index prefilters where appropriate.
- `ST_Covers` for point-in-polygon checks.
- `ST_DWithin` for coastal tolerance if performant.
- `ST_Subdivide` during import to reduce expensive large-polygon candidate
  scans.

---

## Configuration

Add config keys:

```text
GEO_VALIDATION_ENABLED=true
GEO_VALIDATION_FAIL_OPEN=true
GEO_COASTAL_TOLERANCE_METERS=500
GEO_COVERAGE_MARGIN_KM=50
GEO_CACHE_ENABLED=true
GEO_CACHE_PRECISION=4
GEO_CACHE_TTL_SECONDS=604800
GEO_CACHE_UNCERTAIN_TTL_SECONDS=1800
```

Behavior:

- If `GEO_VALIDATION_ENABLED=false`, pipeline bypasses geo validation but emits
  enough logs/metrics to make the bypass visible.
- If validation fails and `GEO_VALIDATION_FAIL_OPEN=true`, ingestion continues
  and emits `geo_validation_error` metrics/logs.
- If validation fails and `GEO_VALIDATION_FAIL_OPEN=false`, position events can
  be dropped with `geo_validation_error`.

Default should be fail-open.

---

## Redis Cache Strategy

Cache key:

```text
geo:validation:{datasetVersion}:p{precision}:{latBucket}:{lonBucket}
```

Default precision:

```text
GEO_CACHE_PRECISION=4
```

Cache values store the structured geo-validation result.

TTL policy:

- `allow`: `GEO_CACHE_TTL_SECONDS`.
- `reject`: `GEO_CACHE_TTL_SECONDS`.
- `uncertain/coastal_tolerance`: `GEO_CACHE_UNCERTAIN_TTL_SECONDS`.

Dataset version in the key provides natural invalidation after dataset refresh.

---

## Metrics

Extend existing drop reasons:

```text
on_land
geo_validation_error
```

Add geo metrics:

```text
ais_geo_validation_total{verdict,reason,source}
ais_geo_validation_cache_total{result}
ais_geo_validation_duration_seconds{source}
ais_geo_dataset_active_info{version}
```

Guidance:

- Keep `ais_geo_dataset_active_info{version}` cardinality controlled.
- Expose only the single active dataset version at a time.
- Avoid labels with MMSI, raw coordinates, or unbounded dataset URLs.

Suggested Grafana panels:

- Deep-land rejects over time.
- Geo validation errors over time.
- Cache hit ratio.
- PostGIS validation latency p50/p95/p99.
- Uncertain/coastal tolerance rate.
- Active dataset version.

---

## Structured Logging

During early tuning/debugging:

- Detailed geo reject logs are acceptable.
- Include MMSI, coordinates, verdict, reason, dataset version, provider, and
  trace id when available.

After stabilization:

- Deep-land reject logs should be sampled or rate-limited to avoid noisy
  production logs during bad AIS bursts.
- Validation errors remain warn-level.
- Uncertain/coastal tolerance passes should be metric-first and sampled/debug
  logged.

Rejected-position persistence is intentionally out of scope.

---

## Import Workflow

Target command:

```text
pnpm geo:import
```

Proposed flow:

1. Read pinned dataset metadata from `scripts/geo/datasets.json`.
2. Download datasets to a local/import working directory.
3. Load raw data into staging tables using GDAL/ogr2ogr.
4. Build coverage union from `AIS_COVERAGE_ZONES`.
5. Apply `GEO_COVERAGE_MARGIN_KM`.
6. Validate geometries with `ST_MakeValid`.
7. Clip to coverage union plus margin.
8. Subdivide geometries.
9. Import manual override GeoJSON.
10. Create GiST indexes and supporting btree indexes.
11. Run `ANALYZE`.
12. Insert dataset version metadata.
13. Activate the new dataset version only after all previous steps succeed.

The import flow must support:

- Fresh DB bootstrap.
- Safe reruns.
- Idempotent refresh during redeployments.
- Failed refresh without disturbing the old active version.

---

## Testing Strategy

TDD/test-first implementation is strongly recommended for the hot-path runtime
and SQL validation behavior.

Use test-first or close-to-test-first implementation for:

- `GeoValidationService`.
- `GeoCacheService`.
- Verdict-to-drop mapping.
- Pipeline integration order.
- Fail-open and fail-closed behavior.
- Cache key/version behavior.
- Metrics increment behavior.
- SQL function behavior using fixture polygons.

Import tooling and GDAL orchestration do not require strict TDD. They are better
validated through integration and operational tests:

- Bootstrap/import tests.
- Rerun/idempotency tests.
- Active-version swap tests.
- Real dataset import validation.
- Operational validation in the geo-import/dev/ops environment.

### Unit Tests

- Pipeline invokes geo validation only for position events.
- Pipeline order is bbox before geo, geo before sampler.
- Static events bypass geo validation.
- Fail-open behavior.
- Fail-closed behavior when configured.
- Verdict-to-drop mapping.
- Cache key includes dataset version.
- Cache TTL differs for certain and uncertain verdicts.
- Validation errors increment the right metrics.

### Integration Tests

- SQL function works with tiny fixture polygons.
- Reject Paris/Lyon/Turin-style points.
- Allow open water in every configured coverage region.
- Allow manual override polygon.
- Allow or uncertain-pass coastal point within 500m.
- Active dataset version lookup works.
- Cache key changes by dataset version.
- Runtime can validate without GDAL installed.

### Import / Ops Tests

- Fresh DB bootstrap succeeds.
- Rerun does not corrupt active version.
- Failed import leaves previous version active.
- Active dataset version exposed as one controlled metric label.
- Import tooling can load manual override GeoJSON.
- Dataset clipping uses `AIS_COVERAGE_ZONES`, not hardcoded Black Sea bounds.

---

## Implementation Workflow Requirements

After completing each implementation phase or slice:

- Run all relevant tests.
- Run lint/typecheck/validation gates.
- Verify migrations/import tooling where applicable.
- Request review before committing.

Do not commit immediately after coding without review.

The planning document itself must be continuously updated during
implementation:

- Keep progress tracking/checklists current.
- Record newly discovered architectural decisions.
- Record meaningful tradeoffs and deviations from this plan.
- Do not silently change finalized decisions without documenting the reason.

Commit messages should follow the existing conventional style, for example:

- `feat:`
- `fix:`
- `docs:`
- `chore:`
- `ci:`
- `deploy:`
- `test:`

---

## Implementation Phases

### Phase 0 - Planning

- [x] Decide module ownership.
- [x] Decide dataset/tooling strategy.
- [x] Decide fail-open behavior.
- [x] Decide cache strategy.
- [x] Decide manual override format.
- [x] Persist this implementation plan.

Acceptance criteria:

- [x] Durable planning document exists under `docs/`.

### Phase 1 - Config, Metrics, And Module Skeleton

What to build:

- Add geo config keys to `EnvSchema`.
- Add drop reasons.
- Add geo metric names/providers.
- Add `src/geo` module skeleton.
- Export `GeoValidationService` from `GeoModule`.

Acceptance criteria:

- [x] Config tests cover defaults and invalid values.
- [x] Metrics module exposes geo metric providers.
- [x] `PipelineModule` can import `GeoModule` without circular dependencies.
- [x] Lint/typecheck pass.

### Phase 2 - PostGIS Schema, SQL Function, And Fixture Tests

What to build:

- Add migrations for geo dataset tables.
- Add GiST/btree indexes.
- Add `geo_validate_position()`.
- Add fixture SQL integration tests.
- Use small controlled geometries, not real OSM/Geofabrik imports.

Acceptance criteria:

- [x] Migrations apply on a fresh PostGIS database.
- [x] SQL function returns structured verdicts.
- [x] Fixture tests cover allow, reject, uncertain, and dataset unavailable.
- [x] Fixture tests cover evaluation order: manual override, navigable water,
      coastal tolerance, deep land, not land.
- [x] Failed/no active dataset behavior is explicit and tested.

### Phase 3 - Dataset Import Tooling

What to build:

- Add `scripts/geo/datasets.json`.
- Add TypeScript import orchestration script.
- Add GDAL/ogr2ogr-based staging load.
- Add clipping/subdivision/index/analyze flow.
- Add manual override GeoJSON import.
- Add package script, likely `geo:import`.

Acceptance criteria:

- [x] Import works on fresh DB.
- [x] Import can be safely rerun.
- [x] New version activates only after successful import.
- [x] Failed import leaves old version active.
- [x] Runtime app container remains free of GDAL dependency.

### Phase 4 - Geo Runtime Services

What to build:

- Implement `GeoDatasetRepository`.
- Implement `GeoCacheService`.
- Implement `GeoValidationService`.
- Add structured verdict types.
- Add metrics/logging.

Acceptance criteria:

- [x] Cache keys include active dataset version.
- [x] Cache TTL differs for `uncertain`.
- [x] Fail-open behavior emits metric/log and allows event.
- [x] Fail-closed behavior can drop with `geo_validation_error`.
- [x] Unit tests cover service behavior.

### Phase 5 - Pipeline Integration

What to build:

- Wire `GeoModule` into `PipelineModule`.
- Insert geo validation after bbox and before sampler.
- Drop `reject/deep_land` as `on_land`.
- Keep `uncertain/coastal_tolerance` passing with metrics/logs.

Acceptance criteria:

- [ ] Static events bypass geo validation.
- [ ] Position events call geo validation only after bbox passes.
- [ ] Rejected deep-land positions are not published to `ais.events.v1`.
- [ ] Sampler is not called for rejected deep-land positions.
- [ ] Existing dedup/sampler tests remain valid or are updated.

### Phase 6 - Observability And Grafana

What to build:

- Add Grafana panels for geo metrics.
- Tune structured logs for early debugging.
- Add notes to operations docs if useful.

Acceptance criteria:

- [ ] Deep-land reject counter visible.
- [ ] Geo validation error counter visible.
- [ ] Cache hit ratio visible.
- [ ] PostGIS validation latency visible.
- [ ] Active dataset version visible with controlled cardinality.

### Phase 7 - Real Data Tuning

What to do:

- Run import against pinned datasets.
- Observe AISStream behavior.
- Verify known inland false positives are rejected.
- Verify ports/coastlines are not over-dropped.
- Add manual overrides where needed.
- Tune coastal tolerance if necessary.

Acceptance criteria:

- [ ] Paris/Lyon/Turin-style false positions rejected.
- [ ] Major covered coastal/port areas still pass.
- [ ] Major navigable/inland-water cases pass where source data supports them.
- [ ] Deep-land logs can be reduced to sampled/rate-limited mode after tuning.

---

## Recommended Slice Order

Implementation should remain incremental and reviewable. The intended order is:

1. Config, metrics, and module skeleton.
2. PostGIS schema, SQL function, and fixture tests.
3. Import tooling.
4. Runtime geo services and cache.
5. Pipeline integration.
6. Observability and Grafana.
7. Real AIS tuning and manual overrides.

Each slice should end with tests/checks passing and a review request before
committing.

---

## Progress Tracker

- [x] Planning doc approved.
- [x] Config added.
- [x] Geo metric names/providers added.
- [x] Drop reasons added.
- [x] Geo module skeleton added.
- [x] Geo schema migrated.
- [x] SQL function implemented.
- [x] SQL integration fixtures added.
- [x] Dataset metadata file added.
- [x] Import tooling implemented.
- [x] Manual overrides directory added.
- [x] Manual overrides imported.
- [x] Dataset active-version swap implemented.
- [x] Geo repository implemented.
- [x] Redis cache implemented.
- [x] Geo validation service implemented.
- [ ] Pipeline wired.
- [x] Metrics/logs added.
- [ ] Grafana panels added.
- [ ] Integration tests passing.
- [ ] Runtime container verified without GDAL.
- [ ] First dataset bootstrap tested.
- [ ] Real AIS tuning pass completed.

## Implementation Notes

- Phase 2 migration and fixture integration tests were verified against a fresh
  Testcontainers PostGIS database after Docker was enabled locally.
- Phase 3 import tooling defaults to a GDAL/`ogr2ogr` staging loader, while the
  integration tests use a PostGIS GeoJSON fallback because `ogr2ogr` is not
  installed in the local runtime. The normal application Docker runtime still
  has no GDAL dependency.
- Phase 3 intentionally pins tiny repo-owned fixture GeoJSON datasets in
  `scripts/geo/datasets.json` to validate import lifecycle behavior before
  large OSMData/Geofabrik imports are introduced during real data tuning.
- Phase 4 keeps pipeline decisions for Phase 5 but returns `shouldDrop` from
  `GeoValidationService` so `reject/deep_land` and fail-closed
  `geo_validation_error` can be mapped cleanly by the pipeline.
- Phase 4 records active dataset version as a single info-style gauge label by
  removing the previous version label when a new active version is observed.

---

## Known Risks And Tradeoffs

- OSM/Geofabrik inland-water coverage is best effort and may miss some valid
  waterways.
- Manual overrides may be needed for ports, estuaries, docks, and local data
  gaps.
- Too-small coastal tolerance can false-reject valid coastal AIS noise.
- Too-large coastal tolerance can allow fake land positions near coastlines.
- OSM coastline quality varies; broken or delayed source updates can affect
  accuracy.
- Import tooling depends on GDAL in the ops/import environment.
- Dataset version labels must be controlled to avoid Prometheus cardinality
  issues.
- Fail-open preserves ingestion availability but can allow bad points during
  geo outages.

---

## Future Improvements

Not part of this phase, but intentionally left as future extension points:

- Movement/outlier validator.
- AIS suspicious scoring.
- Confidence engine.
- Rejected sample persistence or review stream.
- Scheduled geo dataset refresh job.
- Admin UI/API for manual overrides.
- Precomputed coastal tolerance polygons if `ST_DWithin` becomes too expensive.
- More precise navigable-water classification per region.
- Dataset rollback command.
