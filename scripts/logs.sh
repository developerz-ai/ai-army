#!/usr/bin/env bash
# View logs from AI Army on a server
# Usage:
#   ./scripts/logs.sh master              # Follow all Docker Compose logs on master
#   ./scripts/logs.sh master app          # Follow app logs on master
#   ./scripts/logs.sh master postgres     # Follow postgres logs on master
#   ./scripts/logs.sh worker1             # List LXC containers on worker1
#   ./scripts/logs.sh worker1 bot-name    # Follow LXC container logs on worker1

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/servers.sh"

TARGET="${1:-master}"
SERVICE="${2:-}"

case "$TARGET" in
  master)  HOST="$MASTER_HOST" ;;
  worker1) HOST="$WORKER1_HOST" ;;
  worker2) HOST="$WORKER2_HOST" ;;
  *) echo "Usage: $0 {master|worker1|worker2} [service|container]"; exit 1 ;;
esac

if [ "$TARGET" = "master" ]; then
  # Master uses Docker Compose
  if [ -n "$SERVICE" ]; then
    run_on "$HOST" "cd $DEPLOY_DIR && sg docker -c 'docker compose logs -f --tail=100 $SERVICE'"
  else
    run_on "$HOST" "cd $DEPLOY_DIR && sg docker -c 'docker compose logs -f --tail=100'"
  fi
else
  # Workers use Incus LXC containers
  if [ -n "$SERVICE" ]; then
    echo "Following logs for LXC container '$SERVICE' on $TARGET..."
    run_on "$HOST" "incus console $SERVICE --show-log 2>/dev/null || incus info $SERVICE"
  else
    echo "LXC containers on $TARGET:"
    run_on "$HOST" "incus list --format table 2>/dev/null" || echo "(Incus not installed)"
  fi
fi
