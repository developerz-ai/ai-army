#!/usr/bin/env bash
# Provision a worker VPS with Incus (LXC) and create base images
# Usage:
#   ./scripts/provision-worker.sh                  # Provision all workers
#   ./scripts/provision-worker.sh worker1           # Provision worker1 only
#   ./scripts/provision-worker.sh ubuntu@host.com   # Provision specific host

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/servers.sh"

install_incus() {
  local host="$1"
  echo "=== Installing Incus on $host ==="
  ssh $SSH_OPTS "$host" 'bash -s' << 'REMOTE'
set -e

# Check if already provisioned
if command -v incus &>/dev/null; then
  echo "Incus already installed:"
  incus --version
  echo "Checking base images..."
  if incus image list --format csv | grep -q "ai-army-base"; then
    echo "Base images already exist."
    incus image list --format table
    exit 0
  fi
  echo "Base images not found — will create them."
fi

echo "--- Installing Incus ---"
# Add Zabbly PPA for latest Incus (works on Ubuntu 24.04+)
if [ ! -f /etc/apt/sources.list.d/zabbly-incus-stable.sources ]; then
  sudo mkdir -p /etc/apt/keyrings/
  curl -fsSL https://pkgs.zabbly.com/key.asc | sudo gpg --dearmor -o /etc/apt/keyrings/zabbly.gpg --yes
  sudo sh -c 'cat <<EOF > /etc/apt/sources.list.d/zabbly-incus-stable.sources
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/zabbly.gpg
EOF'
fi

sudo apt-get update -y
sudo apt-get install -y incus

# Add current user to incus-admin group
sudo usermod -aG incus-admin "$USER"

echo "--- Initializing Incus ---"
# Initialize with defaults (creates default storage pool + network bridge)
sudo incus admin init --auto

echo "--- Verifying Incus ---"
incus --version
incus list

echo "=== Incus installation complete ==="
REMOTE
  echo "Done installing Incus on $host"
}

create_base_images() {
  local host="$1"
  echo "=== Creating base images on $host ==="
  ssh $SSH_OPTS "$host" 'bash -s' << 'REMOTE'
set -e

# -------------------------------------------------------
# ai-army-base: Standard base image (no Docker)
# -------------------------------------------------------
if incus image list --format csv | grep -q "ai-army-base,"; then
  echo "Image ai-army-base already exists, skipping."
else
  echo "--- Building ai-army-base image ---"
  incus launch images:ubuntu/24.04 base-build

  # Wait for container networking
  echo "Waiting for container to be ready..."
  sleep 5
  for i in $(seq 1 30); do
    if incus exec base-build -- ping -c1 -W2 archive.ubuntu.com &>/dev/null; then
      break
    fi
    sleep 2
  done

  incus exec base-build -- bash -c '
    set -e

    # Create agent user
    useradd -m -s /bin/bash agent
    echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent

    # Install common tools
    apt-get update -y
    apt-get install -y \
      git curl wget \
      python3 python3-pip \
      build-essential \
      jq tree htop \
      ca-certificates gnupg

    # Install Node.js 22 via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs

    # Clean up
    apt-get clean
    rm -rf /var/lib/apt/lists/*

    echo "--- Verifying ---"
    node --version
    npm --version
    python3 --version
    git --version
  '

  incus stop base-build
  incus publish base-build --alias ai-army-base description="AI Army base image - Ubuntu 24.04 + Node 22 + Python3 + build tools"
  incus delete base-build
  echo "ai-army-base image created."
fi

# -------------------------------------------------------
# ai-army-base-docker: Base image with Docker CE
# -------------------------------------------------------
if incus image list --format csv | grep -q "ai-army-base-docker"; then
  echo "Image ai-army-base-docker already exists, skipping."
else
  echo "--- Building ai-army-base-docker image ---"
  incus launch images:ubuntu/24.04 docker-base-build
  incus config set docker-base-build security.nesting=true

  # Restart to apply nesting config
  incus restart docker-base-build

  # Wait for container networking
  echo "Waiting for container to be ready..."
  sleep 5
  for i in $(seq 1 30); do
    if incus exec docker-base-build -- ping -c1 -W2 archive.ubuntu.com &>/dev/null; then
      break
    fi
    sleep 2
  done

  incus exec docker-base-build -- bash -c '
    set -e

    # Create agent user
    useradd -m -s /bin/bash agent
    echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent

    # Install common tools
    apt-get update -y
    apt-get install -y \
      git curl wget \
      python3 python3-pip \
      build-essential \
      jq tree htop \
      ca-certificates gnupg

    # Install Node.js 22 via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs

    # Install Docker CE
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker agent
    systemctl enable docker

    # Clean up
    apt-get clean
    rm -rf /var/lib/apt/lists/*

    echo "--- Verifying ---"
    node --version
    npm --version
    python3 --version
    git --version
    docker --version
  '

  incus stop docker-base-build
  incus publish docker-base-build --alias ai-army-base-docker description="AI Army Docker-enabled base - Ubuntu 24.04 + Node 22 + Docker CE"
  incus delete docker-base-build
  echo "ai-army-base-docker image created."
fi

echo ""
echo "=== Base images ==="
incus image list --format table
echo "=== Provisioning complete ==="
REMOTE
  echo "Done creating base images on $host"
}

provision_worker() {
  local host="$1"
  echo ""
  echo "############################################"
  echo "  Provisioning worker: $host"
  echo "############################################"
  echo ""
  install_incus "$host"
  create_base_images "$host"
}

# Parse arguments
if [ $# -gt 0 ]; then
  case "$1" in
    worker1) provision_worker "$WORKER1_HOST" ;;
    worker2) provision_worker "$WORKER2_HOST" ;;
    *)       provision_worker "$1" ;;
  esac
else
  # Provision all workers (not master)
  for host in "${WORKER_SERVERS[@]}"; do
    provision_worker "$host" &
  done
  wait
  echo ""
  echo "All workers provisioned with Incus."
fi
