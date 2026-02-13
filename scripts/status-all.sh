#!/usr/bin/env bash
# Check status of AI Army on all servers
# Usage: ./scripts/status-all.sh

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/servers.sh"

for i in "${!ALL_SERVERS[@]}"; do
  name="${SERVER_NAMES[$i]}"
  host="${ALL_SERVERS[$i]}"
  echo "============================================"
  echo "  $name ($host)"
  echo "============================================"

  # Check SSH
  if ! ssh $SSH_OPTS "$host" "echo connected" &>/dev/null; then
    echo "  SSH: FAILED"
    echo ""
    continue
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
done
