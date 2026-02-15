#!/usr/bin/env bash
# Check status of AI Army on all servers
# Usage: ./scripts/status-all.sh

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/servers.sh"

status_master() {
  local host="$1"
  echo "============================================"
  echo "  master ($host)"
  echo "============================================"

  # Check SSH
  if ! ssh $SSH_OPTS "$host" "echo connected" &>/dev/null; then
    echo "  SSH: FAILED"
    echo ""
    return
  fi
  echo "  SSH: OK"

  # Check Docker
  docker_ver=$(run_on "$host" "docker --version 2>/dev/null" || echo "NOT INSTALLED")
  echo "  Docker: $docker_ver"

  # Check containers
  echo "  Containers:"
  run_on "$host" "cd $DEPLOY_DIR 2>/dev/null && sg docker -c 'docker compose ps --format \"table {{.Name}}\t{{.Status}}\t{{.Ports}}\"' 2>/dev/null" || echo "    (not deployed)"

  # Health check
  health=$(run_on "$host" "curl -sf http://localhost:3000/health 2>/dev/null" || echo '{"status":"unreachable"}')
  echo "  Health: $health"

  echo ""
}

status_worker() {
  local name="$1"
  local host="$2"
  echo "============================================"
  echo "  $name ($host)"
  echo "============================================"

  # Check SSH
  if ! ssh $SSH_OPTS "$host" "echo connected" &>/dev/null; then
    echo "  SSH: FAILED"
    echo ""
    return
  fi
  echo "  SSH: OK"

  # Check Incus
  incus_ver=$(run_on "$host" "incus --version 2>/dev/null" || echo "NOT INSTALLED")
  echo "  Incus: $incus_ver"

  # Check LXC containers
  echo "  LXC Containers:"
  run_on "$host" "incus list --format table 2>/dev/null" || echo "    (none or Incus not installed)"

  # Check base images
  echo "  Base Images:"
  run_on "$host" "incus image list --format table 2>/dev/null" || echo "    (none)"

  echo ""
}

# Check master
status_master "$MASTER_HOST"

# Check workers
for i in "${!WORKER_SERVERS[@]}"; do
  status_worker "${WORKER_NAMES[$i]}" "${WORKER_SERVERS[$i]}"
done
