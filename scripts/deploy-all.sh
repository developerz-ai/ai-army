#!/usr/bin/env bash
# Deploy AI Army to all servers (or a specific one)
# Usage:
#   ./scripts/deploy-all.sh           # Deploy to all servers
#   ./scripts/deploy-all.sh master    # Deploy to master only
#   ./scripts/deploy-all.sh worker1   # Deploy to worker1 only
#   ./scripts/deploy-all.sh --full    # Full rebuild on all servers

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/servers.sh"

FULL_BUILD=false
TARGET=""

for arg in "$@"; do
  case "$arg" in
    --full) FULL_BUILD=true ;;
    master) TARGET="master" ;;
    worker1) TARGET="worker1" ;;
    worker2) TARGET="worker2" ;;
  esac
done

deploy_to() {
  local name="$1"
  local host="$2"

  echo "=== Deploying to $name ($host) ==="

  # Create deploy dir
  run_on "$host" "mkdir -p $DEPLOY_DIR"

  # Sync code (exclude heavy/sensitive dirs)
  echo "  Syncing code..."
  rsync -az --delete \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'data' \
    --exclude 'tmp' \
    --exclude '.claude*' \
    --exclude '.env.local' \
    -e "ssh $SSH_OPTS" \
    "$PROJECT_DIR/" "$host:$DEPLOY_DIR/"

  echo "  Building and starting containers..."
  if [ "$FULL_BUILD" = true ]; then
    run_on "$host" "cd $DEPLOY_DIR && sg docker -c 'docker compose down 2>/dev/null || true' && sg docker -c 'docker compose build --no-cache' && sg docker -c 'docker compose up -d'"
  else
    run_on "$host" "cd $DEPLOY_DIR && sg docker -c 'docker compose up -d --build'"
  fi

  echo "  Waiting for health check..."
  local retries=20
  for i in $(seq 1 $retries); do
    if run_on "$host" "curl -sf http://localhost:3000/health > /dev/null 2>&1"; then
      echo "  Healthy!"
      break
    fi
    if [ "$i" -eq "$retries" ]; then
      echo "  WARNING: Health check not passing yet. Checking logs..."
      run_on "$host" "cd $DEPLOY_DIR && sg docker -c 'docker compose logs --tail=30 app'" 2>&1
    fi
    sleep 5
  done

  # Run migrations
  echo "  Running migrations..."
  run_on "$host" "cd $DEPLOY_DIR && sg docker -c 'docker compose exec -T app node bin/cli.js migrate'" 2>&1 || echo "  (migration may have already run)"

  echo "=== $name deployed ==="
  echo ""
}

# Resolve target
if [ -n "$TARGET" ]; then
  case "$TARGET" in
    master)  deploy_to "master"  "$MASTER_HOST" ;;
    worker1) deploy_to "worker1" "$WORKER1_HOST" ;;
    worker2) deploy_to "worker2" "$WORKER2_HOST" ;;
  esac
else
  for i in "${!ALL_SERVERS[@]}"; do
    deploy_to "${SERVER_NAMES[$i]}" "${ALL_SERVERS[$i]}"
  done
fi

echo "Deployment complete."
