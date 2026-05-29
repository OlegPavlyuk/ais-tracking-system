#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${AIS_APP_DIR:-/opt/ais-tracking-system}"
PROD_ENV="${PROD_ENV:-.env.production}"
RELEASE_ENV="${RELEASE_ENV:-.env.release}"

cd "$APP_DIR"

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
    --env-file "$PROD_ENV" \
    --env-file "$RELEASE_ENV" \
    "${compose_files[@]}" \
    "$@"
}

compose --profile certbot run --rm certbot renew \
  --webroot \
  --webroot-path /var/www/certbot

compose exec -T nginx nginx -s reload

echo "Certificate renewal check completed and Nginx reloaded."
