#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://localhost}"
if [[ -n "${SMOKE_HTTP_BASE_URL:-}" ]]; then
  HTTP_BASE_URL="$SMOKE_HTTP_BASE_URL"
elif [[ "$BASE_URL" == https://* ]]; then
  HTTP_BASE_URL="http://${BASE_URL#https://}"
else
  HTTP_BASE_URL="$BASE_URL"
fi
if [[ -n "${SMOKE_HTTPS_BASE_URL:-}" ]]; then
  HTTPS_BASE_URL="$SMOKE_HTTPS_BASE_URL"
elif [[ "$BASE_URL" == http://* ]]; then
  HTTPS_BASE_URL="https://${BASE_URL#http://}"
else
  HTTPS_BASE_URL="$BASE_URL"
fi
SMOKE_HTTPS_INSECURE="${SMOKE_HTTPS_INSECURE:-true}"
SMOKE_MAX_ATTEMPTS="${SMOKE_MAX_ATTEMPTS:-20}"
SMOKE_RETRY_SLEEP_SECONDS="${SMOKE_RETRY_SLEEP_SECONDS:-3}"
SMOKE_CURL_MAX_TIME_SECONDS="${SMOKE_CURL_MAX_TIME_SECONDS:-2}"

retry_curl_ok() {
  local url="$1"
  shift
  local attempt
  local output

  for attempt in $(seq 1 "$SMOKE_MAX_ATTEMPTS"); do
    if output="$(curl -fsS "$@" --max-time "$SMOKE_CURL_MAX_TIME_SECONDS" "$url" 2>&1 > /dev/null)"; then
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
  shift 2
  local attempt
  local output
  local status

  for attempt in $(seq 1 "$SMOKE_MAX_ATTEMPTS"); do
    output="$(curl -sS "$@" --max-time "$SMOKE_CURL_MAX_TIME_SECONDS" -o /dev/null -w '%{http_code}' "$url" 2>&1)" && status="$output" || status=""

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

wait_for_service_running() {
  local service="$1"
  local attempt
  local running_services

  for attempt in $(seq 1 "$SMOKE_MAX_ATTEMPTS"); do
    running_services="$(compose ps --services --status running)"
    if grep -Fxq "$service" <<< "$running_services"; then
      return 0
    fi

    if [[ "$attempt" -lt "$SMOKE_MAX_ATTEMPTS" ]]; then
      echo "Service $service is not running on attempt $attempt/$SMOKE_MAX_ATTEMPTS. Retrying in ${SMOKE_RETRY_SLEEP_SECONDS}s..."
      sleep "$SMOKE_RETRY_SLEEP_SECONDS"
    else
      echo "Service $service is not running after $SMOKE_MAX_ATTEMPTS attempts" >&2
      return 1
    fi
  done
}

wait_for_service_health() {
  local service="$1"
  local attempt
  local container_id
  local health_status

  for attempt in $(seq 1 "$SMOKE_MAX_ATTEMPTS"); do
    container_id="$(compose ps -q "$service")"
    if [[ -z "$container_id" ]]; then
      health_status="missing"
    else
      health_status="$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
    fi

    case "$health_status" in
      healthy)
        return 0
        ;;
      none)
        echo "Service $service has no Docker healthcheck; accepting running container."
        return 0
        ;;
    esac

    if [[ "$attempt" -lt "$SMOKE_MAX_ATTEMPTS" ]]; then
      echo "Service $service health status is $health_status on attempt $attempt/$SMOKE_MAX_ATTEMPTS, expected healthy. Retrying in ${SMOKE_RETRY_SLEEP_SECONDS}s..."
      sleep "$SMOKE_RETRY_SLEEP_SECONDS"
    else
      echo "Service $service health status is $health_status after $SMOKE_MAX_ATTEMPTS attempts, expected healthy" >&2
      return 1
    fi
  done
}

for service in "${required_services[@]}"; do
  wait_for_service_running "$service"
  wait_for_service_health "$service"
done

https_curl_args=()
if [[ "$SMOKE_HTTPS_INSECURE" == "true" ]]; then
  https_curl_args+=(-k)
fi

retry_curl_ok "$HTTP_BASE_URL/nginx-health"
retry_curl_status "$HTTP_BASE_URL/healthz" "301"
retry_curl_status "$HTTP_BASE_URL/readyz" "301"
retry_curl_status "$HTTP_BASE_URL/api/vessels?limit=1" "301"
retry_curl_status "$HTTP_BASE_URL/metrics" "301"
retry_curl_status "$HTTP_BASE_URL/admin" "301"
retry_curl_ok "$HTTPS_BASE_URL/healthz" "${https_curl_args[@]}"
retry_curl_ok "$HTTPS_BASE_URL/readyz" "${https_curl_args[@]}"
retry_curl_ok "$HTTPS_BASE_URL/api/vessels?limit=1" "${https_curl_args[@]}"
retry_curl_status "$HTTPS_BASE_URL/metrics" "404" "${https_curl_args[@]}"
retry_curl_status "$HTTPS_BASE_URL/admin" "404" "${https_curl_args[@]}"

echo "Smoke checks passed for HTTP $HTTP_BASE_URL and HTTPS $HTTPS_BASE_URL"
