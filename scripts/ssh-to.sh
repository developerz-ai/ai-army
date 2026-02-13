#!/usr/bin/env bash
# SSH into a server
# Usage: ./scripts/ssh-to.sh {master|worker1|worker2}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/servers.sh"

TARGET="${1:-master}"

case "$TARGET" in
  master)  HOST="$MASTER_HOST" ;;
  worker1) HOST="$WORKER1_HOST" ;;
  worker2) HOST="$WORKER2_HOST" ;;
  *) echo "Usage: $0 {master|worker1|worker2}"; exit 1 ;;
esac

echo "Connecting to $TARGET ($HOST)..."
ssh $SSH_OPTS "$HOST"
