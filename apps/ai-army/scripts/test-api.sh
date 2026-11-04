#!/usr/bin/env bash
# Test AI Army REST API on all servers
# Usage:
#   ./scripts/test-api.sh                    # Test all servers
#   ./scripts/test-api.sh master             # Test master only
#   ./scripts/test-api.sh master chat        # Send a test chat on master

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/servers.sh"

# Load API keys from .env
if [ -f "$SCRIPT_DIR/../.env" ]; then
  export $(grep -E '^(ADMIN_API_KEY|DANIEL_API_KEY|SEBASTIAN_API_KEY)=' "$SCRIPT_DIR/../.env" | xargs)
fi

TARGET="${1:-all}"
ACTION="${2:-status}"

get_host_ip() {
  case "$1" in
    master)  echo "vps-944c38ff.vps.ovh.net" ;;
    worker1) echo "vps-ff5c88bb.vps.ovh.us" ;;
    worker2) echo "vps-02a9b234.vps.ovh.net" ;;
  esac
}

test_server() {
  local name="$1"
  local ip=$(get_host_ip "$name")
  local base="http://$ip:3000"

  echo "============================================"
  echo "  Testing $name ($ip)"
  echo "============================================"

  # Health
  echo "--- GET /health ---"
  curl -sf "$base/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "UNREACHABLE"
  echo ""

  # List bots (admin)
  echo "--- GET /api/bots (admin) ---"
  curl -sf -H "Authorization: Bearer $ADMIN_API_KEY" "$base/api/bots" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "FAILED"
  echo ""

  # Test daniel's access
  echo "--- GET /api/bots (daniel) ---"
  curl -sf -H "Authorization: Bearer $DANIEL_API_KEY" "$base/api/bots" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "FAILED"
  echo ""

  # Test sebastian's access
  echo "--- GET /api/bots (sebastian) ---"
  curl -sf -H "Authorization: Bearer $SEBASTIAN_API_KEY" "$base/api/bots" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "FAILED"
  echo ""

  if [ "$ACTION" = "chat" ]; then
    echo "--- POST /api/bots/sebastian-buza-assistant/message (sebastian) ---"
    curl -s --max-time 60 -X POST \
      -H "Authorization: Bearer $SEBASTIAN_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"userId":"sebastian-buza","text":"Hello! What can you do?"}' \
      "$base/api/bots/sebastian-buza-assistant/message" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "FAILED"
    echo ""

    echo "--- POST /api/bots/daniel-francoeur-assistant/message (daniel) ---"
    curl -s --max-time 60 -X POST \
      -H "Authorization: Bearer $DANIEL_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"userId":"daniel-francoeur","text":"Hello! What can you do?"}' \
      "$base/api/bots/daniel-francoeur-assistant/message" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "FAILED"
    echo ""
  fi
}

if [ "$TARGET" = "all" ]; then
  for name in master worker1 worker2; do
    test_server "$name"
  done
else
  test_server "$TARGET"
fi
