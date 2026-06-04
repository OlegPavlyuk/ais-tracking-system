# Operations Runbook

This runbook covers day-two operation for the AIS Tracking System deployment:
one GCP Compute Engine VM running Docker Compose. Domain and certificate
operations are covered in `docs/operations/https-domain-runbook.md`.

It intentionally does not cover Terraform, Cloud SQL, Memorystore, GKE, or
Cloud Run.

Related runbooks:

- GCP VM setup: `docs/operations/gcp-vm-runbook.md`
- HTTPS/domain/TLS: `docs/operations/https-domain-runbook.md`
- Restore drills: `docs/operations/restore-drill.md`

## Deployment State

The first workflow-driven production deployment has been verified.

Deployment artifacts on the VM:

```text
/opt/ais-tracking-system/.env.production
/opt/ais-tracking-system/.env.release
/opt/ais-tracking-system/.deploy/releases/current.env
/opt/ais-tracking-system/.deploy/releases/previous.env
```

Use the Grafana local override unless you intentionally disable private Grafana
tunnel access.

```bash
cd /opt/ais-tracking-system
export AIS_DEPLOY_USE_SUDO_DOCKER=true
```

Most examples use `docker` directly. If your VM user is not in the `docker`
group, prefix those commands with `sudo docker`. The deployment and backup
scripts support this through `AIS_DEPLOY_USE_SUDO_DOCKER=true`.

## Status And Health

```bash
docker compose \
  --env-file .env.production \
  --env-file .env.release \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.grafana-local.yml \
  ps
```

Run the same smoke checks used by deployment:

```bash
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/deploy/smoke-check.sh
```

The deployment smoke script checks local Nginx readiness at
`http://localhost/nginx-health`, verifies that normal HTTP app routes redirect
to HTTPS, then verifies app health/API routes over HTTPS with `-k` so first
bootstrap works before the Let's Encrypt certificate exists.

Public checks from your laptop:

```bash
curl -I http://aiswatch.live/
curl -fsS https://aiswatch.live/healthz
curl -fsS https://aiswatch.live/readyz
curl -fsS "https://aiswatch.live/api/vessels?limit=1"
curl -i https://aiswatch.live/metrics
curl -i https://aiswatch.live/admin
```

HTTP should redirect to HTTPS. `/metrics` and `/admin` should return `404`.

## Logs

```bash
docker compose \
  --env-file .env.production \
  --env-file .env.release \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.grafana-local.yml \
  logs --tail=200 api

docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=200 ingestion
docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=200 worker
docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=200 nginx
docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=200 postgres
docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=200 redis
```

Look for repeated migration errors, missing tables, Redis connection loops,
AISStream auth failures, or fatal NestJS bootstrap errors.

## Disk Usage

```bash
df -h
docker system df
docker volume ls
du -sh /opt/ais-tracking-system/backups 2>/dev/null || true
```

If disk pressure is high, first inspect old Docker images and backup files. Do
not delete Postgres or Redis Docker volumes unless you are intentionally
restoring from backup.

## Backups

Backups are created on the VM under:

```text
/opt/ais-tracking-system/backups/postgres
/opt/ais-tracking-system/backups/redis
```

Create a Postgres backup:

```bash
cd /opt/ais-tracking-system
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/backup/postgres-backup.sh
```

Create a Redis backup:

```bash
cd /opt/ais-tracking-system
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/backup/redis-backup.sh
```

Optional private GCS upload:

Create a private bucket if you want off-VM copies:

```bash
PROJECT_ID="project-10228515-1338-4278-a31"
BACKUP_BUCKET="ais-tracking-system-backups-UNIQUE_SUFFIX"
REGION="europe-central2"

gcloud storage buckets create "gs://$BACKUP_BUCKET" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access

gcloud storage buckets update "gs://$BACKUP_BUCKET" \
  --public-access-prevention=enforced
```

Grant the VM service account access to write objects:

```bash
VM_SERVICE_ACCOUNT_EMAIL="ais-vm-runner@$PROJECT_ID.iam.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding "gs://$BACKUP_BUCKET" \
  --member="serviceAccount:$VM_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/storage.objectAdmin"
```

Then run:

```bash
BACKUP_GCS_URI=gs://$BACKUP_BUCKET/ais-tracking-system/postgres \
  AIS_DEPLOY_USE_SUDO_DOCKER=true \
  scripts/backup/postgres-backup.sh

BACKUP_GCS_URI=gs://$BACKUP_BUCKET/ais-tracking-system/redis \
  AIS_DEPLOY_USE_SUDO_DOCKER=true \
  scripts/backup/redis-backup.sh
```

The bucket must be private. Do not put backups in a public bucket, and do not
commit backup files.

## Rollback

Container rollback uses the previous image metadata recorded by the deploy
script. It does not roll back schema changes.

```bash
cd /opt/ais-tracking-system
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/deploy/rollback.sh --app-dir /opt/ais-tracking-system
```

If a migration was not backward-compatible, rollback may require a database
restore or a corrective migration. Read `docs/operations/restore-drill.md` before doing
that on production data.

## GeoValidation Rollout

GeoValidation uses PostGIS tables populated by a dedicated GDAL-enabled
`geo-import` image. The `api`, `ingestion`, and `worker` runtime images must not
contain GDAL.

For the first rollout, keep `.env.production` conservative until the import and
probes are verified:

```text
AIS_PROVIDERS=
GEO_VALIDATION_ENABLED=false
GEO_VALIDATION_FAIL_OPEN=true
```

The rollout order is always:

```text
migrations -> geo-import -> verification -> enable geo validation -> enable ingestion
```

Define a shell helper for the production compose command:

```bash
cd /opt/ais-tracking-system
export AIS_DEPLOY_USE_SUDO_DOCKER=true

compose() {
  sudo docker compose \
    --env-file .env.production \
    --env-file .env.release \
    -f docker-compose.prod.yml \
    -f docker-compose.prod.grafana-local.yml \
    "$@"
}
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

Verify GDAL exists only in the import image:

```bash
compose run --rm --entrypoint ogr2ogr geo-import --version
compose run --rm --entrypoint gdalinfo geo-import --version
compose run --rm --entrypoint ogr2ogr geo-import --formats | grep -i PostgreSQL
```

Run the one-off import. `geo-import` is profile-gated and has `restart: "no"`,
so ordinary `compose up -d` does not start it.

```bash
compose run --rm geo-import
```

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

Run representative probes:

```bash
compose exec postgres psql -U ais -d ais -c "
SELECT 'rhine_basel_1' AS probe, geo_validate_position(7.58678, 47.56220333333333)
UNION ALL
SELECT 'rhine_basel_2', geo_validate_position(7.575641666666667, 47.61412833333333)
UNION ALL
SELECT 'rhine_rheinfelden', geo_validate_position(7.7906, 47.5596)
UNION ALL
SELECT 'nearby_basel_land', geo_validate_position(7.6100, 47.5600);
"
```

After import and probes pass, enable validation but keep fail-open:

```text
GEO_VALIDATION_ENABLED=true
GEO_VALIDATION_FAIL_OPEN=true
```

Restart backend runtime services and smoke check:

```bash
compose up -d api worker nginx
AIS_DEPLOY_USE_SUDO_DOCKER=true scripts/deploy/smoke-check.sh
```

Then enable ingestion:

```text
AIS_PROVIDERS=aisstream
```

```bash
compose up -d ingestion
compose logs --tail=300 ingestion
```

For future dataset refreshes, keep the app online and run only:

```bash
compose run --rm geo-import
```

The import loads a new inactive dataset version, validates it, and swaps the
active version only after success. If import fails, the previous active dataset
remains active.

Fast disable for validation problems:

```text
GEO_VALIDATION_ENABLED=false
```

```bash
compose up -d api ingestion worker
```

## Private Grafana

From your laptop:

```bash
gcloud compute ssh ais-prod-vm \
  --zone=europe-central2-a \
  --tunnel-through-iap \
  -- -L 3001:127.0.0.1:3001
```

Then open:

```text
http://127.0.0.1:3001
```

Use the Grafana credentials from `.env.production`.

The provisioned AIS Tracking System dashboard includes a **Geo Validation**
section. During geo rollout and tuning, watch:

- `Deep-land rejects / sec` for `reject/deep_land` spikes.
- `Geo validation errors / sec` for fail-open/fail-closed validation failures.
- `Geo cache hit ratio` for Redis cache effectiveness.
- `PostGIS geo validation p95 latency` for database validation cost.
- `Active geo dataset` to confirm only one active dataset version is exposed.

## Manual Sanctions And DLQ Notes

Sanctions imports can be inspected and manually enqueued through the admin API
when `ADMIN_TOKEN` is configured:

- `GET /admin/sanctions/imports`
- `POST /admin/sanctions/imports/ofac/run`

DLQ and stream state can also be inspected through admin routes:

- `GET /admin/streams`
- `GET /admin/deadletter`
- `POST /admin/deadletter/:id/replay`

For ingestion or enrichment failures, start with:

```bash
docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=300 ingestion
docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=300 worker
```
