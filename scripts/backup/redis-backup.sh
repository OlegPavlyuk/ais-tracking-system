#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/ais-tracking-system"
BACKUP_DIR=""
PROD_ENV=".env.production"
RELEASE_ENV=".env.release"

usage() {
  cat <<'USAGE'
Usage:
  scripts/backup/redis-backup.sh [--app-dir APP_DIR] [--backup-dir ABSOLUTE_BACKUP_DIR]

Creates a compressed archive of the Redis /data directory from the production
Compose redis service after requesting BGSAVE. Set BACKUP_GCS_URI=gs://bucket/prefix
to also upload the archive.
USAGE
}

require_value() {
  local option="$1"
  local value="${2:-}"

  if [[ -z "$value" || "$value" == --* ]]; then
    echo "$option requires a non-empty value" >&2
    exit 2
  fi
}

require_absolute_path() {
  local option="$1"
  local value="$2"

  if [[ "$value" != /* ]]; then
    echo "$option must be an absolute path: $value" >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      require_value "$1" "${2:-}"
      APP_DIR="${2:-}"
      shift 2
      ;;
    --backup-dir)
      require_value "$1" "${2:-}"
      BACKUP_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_value "--app-dir" "$APP_DIR"
require_absolute_path "--app-dir" "$APP_DIR"

if [[ -n "$BACKUP_DIR" ]]; then
  require_absolute_path "--backup-dir" "$BACKUP_DIR"
fi

if [[ -n "${BACKUP_GCS_URI:-}" ]] && ! command -v gcloud >/dev/null 2>&1; then
  echo "BACKUP_GCS_URI is set, but gcloud is not installed or not on PATH" >&2
  exit 1
fi

cd "$APP_DIR"

if [[ ! -f "$PROD_ENV" ]]; then
  echo "Missing $APP_DIR/$PROD_ENV" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups/redis}"
mkdir -p "$BACKUP_DIR"
if [[ -d "$APP_DIR/backups" ]]; then
  chmod 700 "$APP_DIR/backups"
fi
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/redis-$timestamp.tar.gz"
latest_file="$BACKUP_DIR/redis-latest.tar.gz"

compose_files=(-f docker-compose.prod.yml)
if [[ "${AIS_COMPOSE_INCLUDE_GRAFANA_LOCAL:-true}" == "true" && -f docker-compose.prod.grafana-local.yml ]]; then
  compose_files+=(-f docker-compose.prod.grafana-local.yml)
fi

env_files=(--env-file "$PROD_ENV")
if [[ -f "$RELEASE_ENV" ]]; then
  env_files+=(--env-file "$RELEASE_ENV")
fi

docker_cmd() {
  if [[ "${AIS_DEPLOY_USE_SUDO_DOCKER:-false}" == "true" ]]; then
    sudo docker "$@"
  else
    docker "$@"
  fi
}

compose() {
  docker_cmd compose "${env_files[@]}" "${compose_files[@]}" "$@"
}

echo "Requesting Redis BGSAVE"
before_lastsave="$(compose exec -T redis redis-cli LASTSAVE)"
compose exec -T redis redis-cli BGSAVE >/dev/null

for _ in $(seq 1 30); do
  after_lastsave="$(compose exec -T redis redis-cli LASTSAVE)"
  if [[ "$after_lastsave" != "$before_lastsave" ]]; then
    break
  fi
  sleep 1
done

if [[ "${after_lastsave:-$before_lastsave}" == "$before_lastsave" ]]; then
  echo "Redis BGSAVE did not complete within 30 seconds" >&2
  exit 1
fi

echo "Creating Redis data archive at $backup_file"
compose exec -T redis tar -C /data -czf - . > "$backup_file"
chmod 600 "$backup_file"
ln -sfn "$backup_file" "$latest_file"

if [[ -n "${BACKUP_GCS_URI:-}" ]]; then
  echo "Uploading Redis backup to $BACKUP_GCS_URI/"
  gcloud storage cp "$backup_file" "$BACKUP_GCS_URI/"
fi

echo "Redis backup complete: $backup_file"
