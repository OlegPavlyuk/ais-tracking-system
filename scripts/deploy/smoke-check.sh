#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://localhost}"
SMOKE_MAX_ATTEMPTS="${SMOKE_MAX_ATTEMPTS:-10}"
SMOKE_RETRY_SLEEP_SECONDS="${SMOKE_RETRY_SLEEP_SECONDS:-3}"
SMOKE_CURL_MAX_TIME_SECONDS="${SMOKE_CURL_MAX_TIME_SECONDS:-2}"

retry_curl_ok() {
  local url="$1"
  local attempt
  local output

  for attempt in $(seq 1 "$SMOKE_MAX_ATTEMPTS"); do
    if output="$(curl -fsS --max-time "$SMOKE_CURL_MAX_TIME_SECONDS" "$url" 2>&1 > /dev/null)"; then
      return 0
    fi

    if [[ "$attempt" -lt "$SMOKE_MAX_ATTEMPTS" ]]; then
      echo "Smoke check $url failed on attempt $attempt/$SMOKE_MAX_ATTEMPTS: $output. Retrying in ${SMOKE_RETRY_SLEEP_SECONDS}s..."
      sleep "$SMOKE_RETRY_SLEEP_SECONDS"
    else
      echo "Smoke check $url failed after $SMOKE_MAX_ATTEMPTS attempts: $output" >&2
      return 1
    fi
  done
}

retry_curl_status() {
  local url="$1"
  local expected_status="$2"
  local attempt
  local output
  local status

  for attempt in $(seq 1 "$SMOKE_MAX_ATTEMPTS"); do
    output="$(curl -sS --max-time "$SMOKE_CURL_MAX_TIME_SECONDS" -o /dev/null -w '%{http_code}' "$url" 2>&1)" && status="$output" || status=""

    if [[ "$status" == "$expected_status" ]]; then
      return 0
    fi

    if [[ "$attempt" -lt "$SMOKE_MAX_ATTEMPTS" ]]; then
      echo "Smoke check $url expected HTTP $expected_status on attempt $attempt/$SMOKE_MAX_ATTEMPTS, got ${status:-curl error: $output}. Retrying in ${SMOKE_RETRY_SLEEP_SECONDS}s..."
      sleep "$SMOKE_RETRY_SLEEP_SECONDS"
    else
      echo "Expected $url to return HTTP $expected_status after $SMOKE_MAX_ATTEMPTS attempts, got ${status:-curl error: $output}" >&2
      return 1
    fi
  done
}

retry_curl_ok "$BASE_URL/healthz"
retry_curl_ok "$BASE_URL/readyz"
retry_curl_ok "$BASE_URL/api/vessels?limit=1"
retry_curl_status "$BASE_URL/metrics" "404"
retry_curl_status "$BASE_URL/admin" "404"

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
