# Geo Validation Implementation Bootstrap Prompt

Use this prompt to start a fresh AI implementation session for the geo-validation
feature.

---

You are working in the Maritime Intelligence / AIS Tracking System repository.

Primary source of truth:

```text
docs/geo-validation-implementation-plan.md
```

Read that document before making implementation changes. Keep it updated as work
progresses.

## Current Status

Planning is complete. Implementation has not started yet.

The approved feature is a production-like but lightweight geo-validation layer
for AIS position quality. It must prevent clearly invalid deep-land AIS
positions from reaching `ais.events.v1`, storage, and realtime consumers.

Current pipeline:

```text
AISStream raw -> raw filter -> normalizer -> dedup -> bbox -> sampling -> publish ais.events.v1
```

Target pipeline:

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

Only position events are geo-validated. Static events bypass geo validation.

## Finalized Architecture Decisions

- Use a dedicated `src/geo` module.
- Pipeline consumes `GeoValidationService`; pipeline does not own datasets,
  spatial SQL, cache internals, or import lifecycle.
- Use PostGIS-backed deep-land rejection.
- Use inland/navigable-water exceptions.
- Use manual override GeoJSON files imported into PostGIS.
- Use coastal tolerance with default `GEO_COASTAL_TOLERANCE_METERS=500`.
- Positions inside coastal tolerance pass as `uncertain/coastal_tolerance`.
- Use `GEO_VALIDATION_FAIL_OPEN=true` by default.
- Use Redis cache with dataset version in cache keys.
- Cache `allow` and `reject` with normal TTL; cache `uncertain` with shorter TTL.
- Use TypeScript import orchestration with GDAL/ogr2ogr and PostGIS SQL.
- GDAL/ogr2ogr belongs only in geo-import/dev/ops environments, not in the
  normal runtime application container.
- `AIS_COVERAGE_ZONES` are coarse operational bboxes and are used only for
  dataset clipping/import optimization, not as proof of valid water.
- Actual validity comes from PostGIS datasets, navigable-water layers, manual
  overrides, coastal tolerance logic, and `geo_validate_position()`.

## Implementation Strategy

Do not begin with large real OSM/Geofabrik imports.

Start with small controlled fixture geometries and fixture-based PostGIS
integration tests. Fixture tests should prove:

- SQL function correctness.
- Verdict evaluation order.
- Pipeline behavior.
- Fail-open/fail-closed behavior.
- Cache behavior.
- Drop/pass decisions.
- Metrics/logging behavior.
- Module boundaries.

Example fixture scenarios:

- Point clearly inside land -> `reject/deep_land`.
- Point inside navigable-water polygon -> `allow/navigable_water`.
- Point inside manual override polygon -> `allow/manual_allow`.
- Point near coastline -> `uncertain/coastal_tolerance`.
- Point outside land -> `allow/not_land`.

Fixture tests validate algorithm correctness and architecture. Real dataset
tests validate dataset quality, import tooling, and operational behavior. Do not
mix these concerns too early.

## Recommended Implementation Order

1. Config, metrics, and `src/geo` module skeleton.
2. PostGIS schema, SQL function, and fixture tests.
3. Dataset import tooling.
4. Runtime geo services and Redis cache.
5. Pipeline integration.
6. Observability and Grafana.
7. Real AIS tuning and manual overrides.

## Testing / TDD Expectations

Use TDD or close-to-test-first implementation for:

- `GeoValidationService`.
- `GeoCacheService`.
- Verdict-to-drop mapping.
- Pipeline integration order.
- Fail-open and fail-closed behavior.
- Cache key/version behavior.
- Metrics increment behavior.
- SQL function behavior using fixture polygons.

Import tooling/GDAL orchestration does not require strict TDD. Validate it with:

- Integration tests.
- Bootstrap/import tests.
- Rerun/idempotency tests.
- Active-version swap tests.
- Operational validation.

After each implementation phase/slice:

- Run relevant tests.
- Run lint/typecheck/check gates.
- Verify migrations/import tooling where applicable.
- Request review before committing.

Do not commit immediately after coding without review.

Use conventional commit prefixes when committing after review, for example:

- `feat:`
- `fix:`
- `docs:`
- `chore:`
- `ci:`
- `deploy:`
- `test:`

## Maintenance Requirements

Keep `docs/geo-validation-implementation-plan.md` current:

- Update checklists as work completes.
- Record newly discovered architectural decisions.
- Record tradeoffs and deviations.
- Do not silently change finalized decisions without documenting why.
