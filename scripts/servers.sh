#!/usr/bin/env bash
# Server inventory for AI Army deployment
# Source this file in other scripts: source "$(dirname "$0")/servers.sh"

MASTER_HOST="ubuntu@vps-944c38ff.vps.ovh.net"
WORKER1_HOST="ubuntu@vps-ff5c88bb.vps.ovh.us"
WORKER2_HOST="ubuntu@vps-02a9b234.vps.ovh.net"

ALL_SERVERS=("$MASTER_HOST" "$WORKER1_HOST" "$WORKER2_HOST")
SERVER_NAMES=("master" "worker1" "worker2")
WORKER_SERVERS=("$WORKER1_HOST" "$WORKER2_HOST")
WORKER_NAMES=("worker1" "worker2")

DEPLOY_DIR="/home/ubuntu/ai-army"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

# Run a command on a specific server
run_on() {
  local host="$1"
  shift
  ssh $SSH_OPTS "$host" "$@"
}

# Run a command on all servers
run_on_all() {
  for i in "${!ALL_SERVERS[@]}"; do
    echo "=== ${SERVER_NAMES[$i]} (${ALL_SERVERS[$i]}) ==="
    run_on "${ALL_SERVERS[$i]}" "$@" 2>&1
    echo ""
  done
}
