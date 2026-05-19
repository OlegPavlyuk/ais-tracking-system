#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/ais-tracking-system"
PROD_ENV=".env.production"
RELEASE_ENV=".env.release"
RELEASE_DIR=".deploy/releases"
SMOKE_BASE_URL="http://localhost"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: scripts/deploy/rollback.sh [--app-dir APP_DIR]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

cd "$APP_DIR"

CURRENT_METADATA="$RELEASE_DIR/current.env"
PREVIOUS_METADATA="$RELEASE_DIR/previous.env"

if [[ ! -f "$PREVIOUS_METADATA" ]]; then
  echo "No previous release metadata found at $APP_DIR/$PREVIOUS_METADATA" >&2
  exit 1
fi

compose_files=(-f docker-compose.prod.yml)
if [[ "${AIS_COMPOSE_INCLUDE_GRAFANA_LOCAL:-true}" == "true" && -f docker-compose.prod.grafana-local.yml ]]; then
  compose_files+=(-f docker-compose.prod.grafana-local.yml)
fi

docker_cmd() {
  if [[ "${AIS_DEPLOY_USE_SUDO_DOCKER:-false}" == "true" ]]; then
    sudo docker "$@"
  else
    docker "$@"
  fi
}

compose() {
  docker_cmd compose --env-file "$PROD_ENV" --env-file "$RELEASE_ENV" "${compose_files[@]}" "$@"
}

rollback_from=""
if [[ -f "$CURRENT_METADATA" ]]; then
  rollback_from="$RELEASE_DIR/rollback-from-$(date -u +%Y%m%dT%H%M%SZ).env"
  cp "$CURRENT_METADATA" "$rollback_from"
fi

cp "$PREVIOUS_METADATA" "$RELEASE_ENV"

echo "Rolling back containers using $APP_DIR/$PREVIOUS_METADATA"
compose pull
compose up -d --remove-orphans
AIS_DEPLOY_USE_SUDO_DOCKER="${AIS_DEPLOY_USE_SUDO_DOCKER:-false}" SMOKE_BASE_URL="$SMOKE_BASE_URL" scripts/deploy/smoke-check.sh

cp "$PREVIOUS_METADATA" "$CURRENT_METADATA"

if [[ -n "$rollback_from" ]]; then
  echo "Rolled back from metadata saved at $APP_DIR/$rollback_from"
fi
echo "Rollback succeeded"
