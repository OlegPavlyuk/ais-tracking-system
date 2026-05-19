#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://localhost}"

curl -fsS "$BASE_URL/healthz" > /dev/null
curl -fsS "$BASE_URL/readyz" > /dev/null
curl -fsS "$BASE_URL/api/vessels?limit=1" > /dev/null

metrics_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/metrics")"
if [[ "$metrics_status" != "404" ]]; then
  echo "Expected /metrics to return 404, got $metrics_status" >&2
  exit 1
fi

admin_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/admin")"
if [[ "$admin_status" != "404" ]]; then
  echo "Expected /admin to return 404, got $admin_status" >&2
  exit 1
fi

docker_cmd() {
  if [[ "${AIS_DEPLOY_USE_SUDO_DOCKER:-false}" == "true" ]]; then
    sudo docker "$@"
  else
    docker "$@"
  fi
}

compose_files=(-f docker-compose.prod.yml)
if [[ "${AIS_COMPOSE_INCLUDE_GRAFANA_LOCAL:-true}" == "true" && -f docker-compose.prod.grafana-local.yml ]]; then
  compose_files+=(-f docker-compose.prod.grafana-local.yml)
fi

compose() {
  docker_cmd compose \
    --env-file .env.production \
    --env-file .env.release \
    "${compose_files[@]}" \
    "$@"
}

required_services=(nginx api ingestion worker postgres redis prometheus grafana)
running_services="$(compose ps --services --status running)"

for service in "${required_services[@]}"; do
  if ! grep -Fxq "$service" <<< "$running_services"; then
    echo "Service $service is not running" >&2
    exit 1
  fi
done

for service in "${required_services[@]}"; do
  container_id="$(compose ps -q "$service")"
  health_status="$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
  case "$health_status" in
    healthy)
      ;;
    none)
      echo "Service $service has no Docker healthcheck; accepting running container."
      ;;
    *)
      echo "Service $service health status is $health_status, expected healthy" >&2
      exit 1
      ;;
  esac
done

echo "Smoke checks passed for $BASE_URL"
