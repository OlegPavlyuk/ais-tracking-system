# Operations Runbook

This runbook covers day-two operation for the AIS Tracking System deployment:
one GCP Compute Engine VM running Docker Compose. Domain and certificate
operations are covered in `docs/operations/https-domain-runbook.md`.

It intentionally does not cover Terraform, Cloud SQL, Memorystore, GKE, or
Cloud Run.

Related runbooks:

- GCP VM setup: `docs/operations/gcp-vm-runbook.md`
- GitHub deployment auth: `docs/operations/github-oidc-deployment.md`
- HTTPS/domain/TLS: `docs/operations/https-domain-runbook.md`
- Geo validation operations: `docs/operations/geo-validation-runbook.md`
- Restore drills: `docs/operations/restore-drill.md`

## Deployment State

Deployment metadata is stored on the VM:

```text
/opt/ais-tracking-system/.env.production
/opt/ais-tracking-system/.env.release
/opt/ais-tracking-system/.deploy/releases/current.env
/opt/ais-tracking-system/.deploy/releases/previous.env
```

`.env.production` contains durable environment configuration and secrets.
`.env.release` contains image tags for the active release. The release metadata
under `.deploy/releases` records the current and previous image sets used by
deploy and rollback scripts.

Use the Grafana local override unless you intentionally disable private Grafana
tunnel access.

## Shell Helper

Most commands assume you are on the VM in the app directory:

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

The deployment, rollback, smoke-check, backup, and certificate scripts also
honor `AIS_DEPLOY_USE_SUDO_DOCKER=true`. If you intentionally omit the Grafana
local override, set `AIS_COMPOSE_INCLUDE_GRAFANA_LOCAL=false` for scripts that
build their own compose command.

## Status And Health

```bash
compose ps
```

Run the same smoke checks used by deployment:

```bash
scripts/deploy/smoke-check.sh
```

The deployment smoke script verifies that required Compose services are running
and healthy. It checks local Nginx readiness at `http://localhost/nginx-health`,
verifies that normal HTTP app routes redirect to HTTPS, then verifies app
health/API routes over HTTPS with `-k` so first bootstrap works before the
Let's Encrypt certificate exists.

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
compose logs --tail=200 api
compose logs --tail=200 ingestion
compose logs --tail=200 worker
compose logs --tail=200 nginx
compose logs --tail=200 postgres
compose logs --tail=200 redis
```

Look for repeated migration errors, missing tables, Redis connection loops,
AISStream auth failures, or fatal NestJS bootstrap errors.

## Disk Usage

```bash
df -h
docker_cmd system df
docker_cmd volume ls
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
scripts/backup/postgres-backup.sh
```

Create a Redis backup:

```bash
scripts/backup/redis-backup.sh
```

To upload a backup off-VM, set `BACKUP_GCS_URI` to a private GCS bucket prefix:

```bash
BACKUP_GCS_URI=gs://$BACKUP_BUCKET/ais-tracking-system/postgres \
  scripts/backup/postgres-backup.sh

BACKUP_GCS_URI=gs://$BACKUP_BUCKET/ais-tracking-system/redis \
  scripts/backup/redis-backup.sh
```

One-time GCS setup, if a private backup bucket does not already exist:

```bash
PROJECT_ID="<your-project-id>"
BACKUP_BUCKET="<private-backup-bucket>"
REGION="<bucket-region>"

gcloud storage buckets create "gs://$BACKUP_BUCKET" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access

gcloud storage buckets update "gs://$BACKUP_BUCKET" \
  --public-access-prevention=enforced

VM_SERVICE_ACCOUNT_EMAIL="ais-vm-runner@$PROJECT_ID.iam.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding "gs://$BACKUP_BUCKET" \
  --member="serviceAccount:$VM_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/storage.objectAdmin"
```

The bucket must be private. Do not put backups in a public bucket, and do not
commit backup files.

## Rollback

Container rollback uses the previous image metadata recorded by the deploy
script. It does not roll back schema changes.

```bash
scripts/deploy/rollback.sh --app-dir /opt/ais-tracking-system
```

If a migration was not backward-compatible, rollback may require a database
restore or a corrective migration. Read `docs/operations/restore-drill.md`
before doing that on production data.

## Geo Validation

Geo validation uses PostGIS tables populated by the profile-gated `geo-import`
service. Runtime services use the imported dataset; the `api`, `ingestion`, and
`worker` images do not include GDAL.

Common day-two checks:

```bash
grep -E '^(DEPLOY_SHA|AIS_GEO_IMPORT_IMAGE)=' .env.release
compose run --rm geo-import pnpm geo:tune
compose logs --tail=300 ingestion
```

For dataset imports, rollout sequencing, tuning probes, and fast disable steps,
use `docs/operations/geo-validation-runbook.md`.

## Private Grafana

From your laptop:

```bash
gcloud compute ssh "<vm-name>" \
  --zone="<vm-zone>" \
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
compose logs --tail=300 ingestion
compose logs --tail=300 worker
```
