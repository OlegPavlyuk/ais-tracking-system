#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/ais-tracking-system"
DEPLOY_SHA=""
IMAGE_REGISTRY=""
PROD_ENV=".env.production"
RELEASE_ENV=".env.release"
RELEASE_DIR=".deploy/releases"
SMOKE_BASE_URL="http://localhost"

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy/deploy.sh --sha GIT_SHA --registry IMAGE_REGISTRY [--app-dir APP_DIR]

Required:
  --sha       Exact Git SHA tag to deploy.
  --registry  Artifact Registry repository path, for example:
              europe-central2-docker.pkg.dev/project-id/repository

Optional:
  --app-dir   App directory on the VM. Defaults to /opt/ais-tracking-system.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha)
      DEPLOY_SHA="${2:-}"
      shift 2
      ;;
    --registry)
      IMAGE_REGISTRY="${2:-}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:-}"
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

if [[ -z "$DEPLOY_SHA" || -z "$IMAGE_REGISTRY" ]]; then
  usage >&2
  exit 2
fi

cd "$APP_DIR"

if [[ ! -f "$PROD_ENV" ]]; then
  echo "Missing $APP_DIR/$PROD_ENV. Create it on the VM before deploying." >&2
  exit 1
fi

if grep -q 'change-me' "$PROD_ENV"; then
  echo "$APP_DIR/$PROD_ENV still contains change-me placeholders." >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"

CURRENT_METADATA="$RELEASE_DIR/current.env"
PREVIOUS_METADATA="$RELEASE_DIR/previous.env"
NEXT_RELEASE_ENV="$RELEASE_DIR/next.env"

cat > "$NEXT_RELEASE_ENV" <<EOF
DEPLOY_SHA=$DEPLOY_SHA
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
AIS_BACKEND_IMAGE=$IMAGE_REGISTRY/backend:$DEPLOY_SHA
AIS_MIGRATOR_IMAGE=$IMAGE_REGISTRY/migrator:$DEPLOY_SHA
AIS_GEO_IMPORT_IMAGE=$IMAGE_REGISTRY/geo-import:$DEPLOY_SHA
AIS_FRONTEND_IMAGE=$IMAGE_REGISTRY/frontend:$DEPLOY_SHA
EOF

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
  local release_env="$1"
  shift
  docker_cmd compose --env-file "$PROD_ENV" --env-file "$release_env" "${compose_files[@]}" "$@"
}

rollback_to_previous() {
  if [[ ! -f "$PREVIOUS_METADATA" ]]; then
    echo "Smoke checks failed and no previous release metadata exists for automatic rollback." >&2
    return 1
  fi

  echo "Smoke checks failed. Rolling containers back to previous release metadata."
  cp "$PREVIOUS_METADATA" "$RELEASE_ENV"
  compose "$RELEASE_ENV" pull
  compose "$RELEASE_ENV" pull geo-import
  compose "$RELEASE_ENV" up -d --remove-orphans
  AIS_DEPLOY_USE_SUDO_DOCKER="${AIS_DEPLOY_USE_SUDO_DOCKER:-false}" SMOKE_BASE_URL="$SMOKE_BASE_URL" scripts/deploy/smoke-check.sh
}

echo "Preparing release $DEPLOY_SHA"
cp "$NEXT_RELEASE_ENV" "$RELEASE_ENV.next"

echo "Pulling release images"
compose "$RELEASE_ENV.next" pull
compose "$RELEASE_ENV.next" pull geo-import

echo "Running database migrator"
compose "$RELEASE_ENV.next" run --rm migrate

if [[ -f "$CURRENT_METADATA" ]]; then
  cp "$CURRENT_METADATA" "$PREVIOUS_METADATA"
fi

cp "$RELEASE_ENV.next" "$RELEASE_ENV"

echo "Starting application services"
compose "$RELEASE_ENV" up -d --remove-orphans

echo "Running smoke checks"
if ! AIS_DEPLOY_USE_SUDO_DOCKER="${AIS_DEPLOY_USE_SUDO_DOCKER:-false}" SMOKE_BASE_URL="$SMOKE_BASE_URL" scripts/deploy/smoke-check.sh; then
  rollback_to_previous || true
  echo "Deployment failed smoke checks for $DEPLOY_SHA." >&2
  exit 1
fi

cp "$RELEASE_ENV" "$CURRENT_METADATA"
rm -f "$RELEASE_ENV.next" "$NEXT_RELEASE_ENV"

echo "Deployment succeeded for $DEPLOY_SHA"
echo "Current release metadata: $APP_DIR/$CURRENT_METADATA"
if [[ -f "$PREVIOUS_METADATA" ]]; then
  echo "Previous release metadata: $APP_DIR/$PREVIOUS_METADATA"
fi
