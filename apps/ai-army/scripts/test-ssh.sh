#!/bin/bash
# Test SSH connection to remote server

set -e

SSH_HOST="ubuntu@15.204.245.151"

echo "🔍 Testing SSH connection to $SSH_HOST..."
echo ""

if ssh -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST" "echo 'SSH connection successful'" 2>/dev/null; then
  echo "✅ SSH connection successful"
  echo ""
  echo "Server information:"
  ssh "$SSH_HOST" "uname -a"
  echo ""
  echo "Docker status:"
  ssh "$SSH_HOST" "docker --version 2>/dev/null || echo 'Docker not installed'"
  echo ""
  exit 0
else
  echo "❌ SSH connection failed"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Verify IP address: ping 15.204.245.151"
  echo "  2. Check SSH key is loaded: ssh-add -l"
  echo "  3. Try manual connection: ssh $SSH_HOST"
  echo "  4. Use verbose mode: ssh -v $SSH_HOST"
  echo ""
  exit 1
fi
