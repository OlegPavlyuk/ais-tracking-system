# Geo Validation Runbook

This runbook covers operational lifecycle tasks for geo validation: importing
datasets, validating representative probes, enabling or disabling validation,
and refreshing datasets. General VM operations remain in
`docs/operations/operations-runbook.md`.

Geo validation uses PostGIS tables populated by the profile-gated `geo-import`
service. The `api`, `ingestion`, and `worker` runtime images must not contain
GDAL; GDAL is limited to the dedicated import image.

## Shell Helper

Run these commands on the VM:

```bash
cd /opt/ais-tracking-system
export AIS_DEPLOY_USE_SUDO_DOCKER=true

docker_cmd() {
  if [ "${AIS_DEPLOY_USE_SUDO_DOCKER:-false}" = "true" ]; then
    sudo docker "$@"
  else
    docker "$@"
  fi
}

compose() {
  docker_cmd compose \
    --env-file .env.production \
    --env-file .env.release \
    -f docker-compose.prod.yml \
    -f docker-compose.prod.grafana-local.yml \
    "$@"
}
```

## Rollout Sequence

Keep `.env.production` conservative until the import and probes are verified:

```text
AIS_PROVIDERS=
GEO_VALIDATION_ENABLED=false
GEO_VALIDATION_FAIL_OPEN=true
```

The rollout order is:

```text
migrations -> geo-import -> verification -> enable geo validation -> enable ingestion
```

Before first import, confirm the release metadata points at the immutable import
image tag for the deployed SHA:

```bash
grep -E '^(DEPLOY_SHA|AIS_GEO_IMPORT_IMAGE)=' .env.release
```

Run migrations first:

```bash
compose run --rm migrate
```

Verify GDAL exists in the import image:

```bash
compose run --rm --entrypoint ogr2ogr geo-import --version
compose run --rm --entrypoint gdalinfo geo-import --version
compose run --rm --entrypoint ogr2ogr geo-import --formats | grep -i PostgreSQL
```

Run the import. `geo-import` is profile-gated and has `restart: "no"`, so
ordinary `compose up -d` does not start it.

```bash
compose run --rm geo-import
```

The import loads a new inactive dataset version, validates it, and swaps the
active version only after success. If import fails, the previous active dataset
remains active.

## Verification

Check the imported active dataset:

```bash
compose exec postgres psql -U ais -d ais -c "
SELECT id, version, is_active, activated_at, coverage_margin_km, coastal_tolerance_meters
FROM geo_dataset_versions
ORDER BY created_at DESC
LIMIT 5;
"

compose exec postgres psql -U ais -d ais -c "
SELECT count(*) AS active_versions
FROM geo_dataset_versions
WHERE is_active;
"
```

Expected `active_versions` is `1`.

Run the maintained tuning probes:

```bash
compose run --rm geo-import pnpm geo:tune
```

The probe manifest in `scripts/geo/tuning-probes.json` contains representative
validation checks for deep-land rejects, navigable inland waterways,
near-coastal uncertainty, and known Rhine/Rhone/Danube/Bosphorus edge cases.
They exist as regression checks for scenarios that are easy to break when
dataset sources, tolerances, or manual overrides change.

If you need an ad hoc SQL probe while debugging:

```bash
compose exec postgres psql -U ais -d ais -c "
SELECT 'rhine-navigation-near-basel' AS probe, geo_validate_position(7.58678, 47.56220333333333)
UNION ALL
SELECT 'rhine-navigation-near-rheinfelden', geo_validate_position(7.7906, 47.5596)
UNION ALL
SELECT 'rhine-nearby-basel-land', geo_validate_position(7.6100, 47.5600);
"
```

## Enable Validation

After import and probes pass, enable validation but keep fail-open behavior:

```text
GEO_VALIDATION_ENABLED=true
GEO_VALIDATION_FAIL_OPEN=true
```

Restart backend runtime services and smoke check:

```bash
compose up -d api worker nginx
scripts/deploy/smoke-check.sh
```

Then enable ingestion:

```text
AIS_PROVIDERS=aisstream
```

```bash
compose up -d ingestion
compose logs --tail=300 ingestion
```

## Dataset Refresh

For future dataset refreshes, keep the app online and run only:

```bash
compose run --rm geo-import
compose run --rm geo-import pnpm geo:tune
```

Then watch ingestion logs and the Grafana Geo Validation dashboard section.

## Fast Disable

For validation problems, disable validation and restart backend runtime
services:

```text
GEO_VALIDATION_ENABLED=false
```

```bash
compose up -d api ingestion worker
scripts/deploy/smoke-check.sh
```

Related docs:

- [Operations runbook](operations-runbook.md)
- [Geo validation architecture](../architecture/geo-validation.md)
- [Restore drill](restore-drill.md)
