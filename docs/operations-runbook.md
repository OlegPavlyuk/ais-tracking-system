# Operations Runbook

This runbook covers day-two operation for the first AIS Tracking System
production-like deployment: one GCP Compute Engine VM running Docker Compose.

It intentionally does not cover HTTPS/domain setup, Terraform, Cloud SQL,
Memorystore, GKE, or Cloud Run.

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

Public checks from your laptop:

```bash
curl -fsS http://VM_STATIC_IP/healthz
curl -fsS http://VM_STATIC_IP/readyz
curl -fsS "http://VM_STATIC_IP/api/vessels?limit=1"
curl -i http://VM_STATIC_IP/metrics
curl -i http://VM_STATIC_IP/admin
```

`/metrics` and `/admin` should return `404`.

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
restore or a corrective migration. Read `docs/restore-drill.md` before doing
that on production data.

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

## Manual Sanctions And DLQ Notes

No production sanctions import workflow is automated in this phase. If manual
sanctions data is added later, keep the source file private and document the
exact import command used.

For ingestion or enrichment failures, start with:

```bash
docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=300 ingestion
docker compose --env-file .env.production --env-file .env.release -f docker-compose.prod.yml -f docker-compose.prod.grafana-local.yml logs --tail=300 worker
```

If a Redis-backed DLQ is added later, document the exact Redis keys and safe
inspection commands here before using them in production.
