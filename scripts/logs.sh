#!/usr/bin/env bash
# View logs from AI Army on a server
# Usage:
#   ./scripts/logs.sh master          # Follow all logs on master
#   ./scripts/logs.sh worker1 app     # Follow app logs on worker1
#   ./scripts/logs.sh worker2 postgres # Follow postgres logs

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/servers.sh"

TARGET="${1:-master}"
SERVICE="${2:-}"

case "$TARGET" in
  master)  HOST="$MASTER_HOST" ;;
  worker1) HOST="$WORKER1_HOST" ;;
  worker2) HOST="$WORKER2_HOST" ;;
  *) echo "Usage: $0 {master|worker1|worker2} [service]"; exit 1 ;;
esac

if [ -n "$SERVICE" ]; then
  run_on "$HOST" "cd $DEPLOY_DIR && sg docker -c 'docker compose logs -f --tail=100 $SERVICE'"
else
  run_on "$HOST" "cd $DEPLOY_DIR && sg docker -c 'docker compose logs -f --tail=100'"
fi
