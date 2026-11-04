#!/bin/bash
# Set up remote server for AI Army deployment

set -e

SSH_HOST="ubuntu@15.204.245.151"

echo "🚀 Setting up remote server for AI Army deployment..."
echo "Server: $SSH_HOST"
echo ""

# Test SSH connection
echo "Testing SSH connection..."
if ! ssh -o ConnectTimeout=10 "$SSH_HOST" "echo 'Connected'" > /dev/null 2>&1; then
  echo "❌ Cannot connect to $SSH_HOST"
  echo "Run ./scripts/test-ssh.sh for diagnostics"
  exit 1
fi

echo "✅ SSH connection successful"
echo ""

# Setup script to run on remote server
echo "Running setup commands on remote server..."
ssh "$SSH_HOST" 'bash -s' << 'ENDSSH'
set -e

echo "→ Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

echo "→ Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  rm get-docker.sh
  sudo usermod -aG docker ubuntu
  echo "✅ Docker installed"
else
  echo "✅ Docker already installed ($(docker --version))"
fi

echo "→ Installing Docker Compose..."
if ! docker compose version &> /dev/null; then
  sudo apt-get install docker-compose-plugin -y -qq
  echo "✅ Docker Compose installed"
else
  echo "✅ Docker Compose already installed ($(docker compose version))"
fi

echo "→ Creating application directory..."
mkdir -p ~/ai-army
cd ~/ai-army
echo "✅ Directory created at ~/ai-army"

echo ""
echo "→ Checking system resources..."
echo "Disk space:"
df -h / | tail -1 | awk '{print "  Available: " $4 " (" $5 " used)"}'
echo "Memory:"
free -h | grep "Mem:" | awk '{print "  Total: " $2 ", Available: " $7}'

echo ""
echo "✅ Server setup complete!"
ENDSSH

echo ""
echo "========================================="
echo "Server setup complete!"
echo "========================================="
echo ""
echo "⚠️  IMPORTANT: Docker group changes require logout"
echo ""
echo "Next steps:"
echo "  1. Log out and back in to server for Docker group changes:"
echo "     ssh $SSH_HOST"
echo "     exit"
echo "     ssh $SSH_HOST"
echo ""
echo "  2. Verify Docker works without sudo:"
echo "     ssh $SSH_HOST 'docker ps'"
echo ""
echo "  3. Run deployment script:"
echo "     ./scripts/deploy.sh"
echo ""
