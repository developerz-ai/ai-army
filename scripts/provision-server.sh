#!/usr/bin/env bash
# Provision a server with Docker + Node.js 22
# Usage: ./scripts/provision-server.sh [user@host]
# If no host given, provisions all servers from servers.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/servers.sh"

provision_one() {
  local host="$1"
  echo "Provisioning $host ..."
  ssh $SSH_OPTS "$host" 'bash -s' << 'REMOTE'
set -e

# Skip if already provisioned
if command -v docker &>/dev/null && command -v node &>/dev/null; then
  echo "Already provisioned:"
  docker --version
  node --version
  exit 0
fi

echo "--- Installing Docker ---"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu

echo "--- Installing Node.js 22 ---"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "--- Verifying ---"
docker --version
docker compose version
node --version
npm --version
echo "=== PROVISIONING COMPLETE ==="
REMOTE
  echo "Done: $host"
}

if [ $# -gt 0 ]; then
  provision_one "$1"
else
  for host in "${ALL_SERVERS[@]}"; do
    provision_one "$host" &
  done
  wait
  echo "All servers provisioned."
fi
