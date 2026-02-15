#!/usr/bin/env bash
# Deploy AI Army to all servers (or a specific one)
# Usage:
#   ./scripts/deploy-all.sh           # Deploy to all servers
#   ./scripts/deploy-all.sh master    # Deploy to master only
#   ./scripts/deploy-all.sh worker1   # Deploy to worker1 only
#   ./scripts/deploy-all.sh --full    # Full rebuild on master

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

sync_code() {
  local host="$1"
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
}

deploy_master() {
  local host="$1"

  echo "=== Deploying to master ($host) ==="

  # Create deploy dir
  run_on "$host" "mkdir -p $DEPLOY_DIR"

  # Sync code
  sync_code "$host"

  # Build and start Docker Compose stack
  echo "  Building and starting containers..."
  if [ "$FULL_BUILD" = true ]; then
    run_on "$host" "cd $DEPLOY_DIR && sg docker -c 'docker compose down 2>/dev/null || true' && sg docker -c 'docker compose build --no-cache' && sg docker -c 'docker compose up -d'"
  else
    run_on "$host" "cd $DEPLOY_DIR && sg docker -c 'docker compose up -d --build'"
  fi

  # Health check
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

  echo "=== master deployed ==="
  echo ""
}

deploy_worker() {
  local name="$1"
  local host="$2"

  echo "=== Deploying to $name ($host) ==="

  # Create deploy dir
  run_on "$host" "mkdir -p $DEPLOY_DIR"

  # Sync code (workers host LXC containers managed remotely by master)
  sync_code "$host"

  # Verify Incus is available
  echo "  Checking Incus..."
  if run_on "$host" "command -v incus &>/dev/null"; then
    echo "  Incus: $(run_on "$host" "incus --version")"
    echo "  Containers:"
    run_on "$host" "incus list --format table 2>/dev/null" || echo "    (none)"
  else
    echo "  WARNING: Incus not installed. Run: ./scripts/provision-worker.sh $name"
  fi

  echo "=== $name deployed ==="
  echo ""
}

# Resolve target
if [ -n "$TARGET" ]; then
  case "$TARGET" in
    master)  deploy_master "$MASTER_HOST" ;;
    worker1) deploy_worker "worker1" "$WORKER1_HOST" ;;
    worker2) deploy_worker "worker2" "$WORKER2_HOST" ;;
  esac
else
  deploy_master "$MASTER_HOST"
  for i in "${!WORKER_SERVERS[@]}"; do
    deploy_worker "${WORKER_NAMES[$i]}" "${WORKER_SERVERS[$i]}"
  done
fi

echo "Deployment complete."
