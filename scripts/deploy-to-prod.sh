#!/usr/bin/env bash
#
# Deploy AI Army to Production Server
#
# Usage:
#   ./scripts/deploy-to-prod.sh
#   ./scripts/deploy-to-prod.sh --full  # Rebuild Docker image
#
# Environment:
#   PROD_SERVER: Production server address (default: ubuntu@15.204.245.151)
#   PROD_PATH: Path on production server (default: /home/ubuntu/ai-army)

set -euo pipefail

PROD_SERVER="${PROD_SERVER:-ubuntu@15.204.245.151}"
PROD_PATH="${PROD_PATH:-/home/ubuntu/ai-army}"
FULL_BUILD="${1:-}"

echo "🚀 Deploying AI Army to production..."
echo "  Server: $PROD_SERVER"
echo "  Path: $PROD_PATH"
echo ""

# Step 1: Sync code files (excluding node_modules, .git, etc.)
echo "📦 Syncing code to production server..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env.local' \
  --exclude 'data' \
  --exclude 'tmp' \
  --exclude '.claude' \
  --exclude 'dist' \
  ./ "$PROD_SERVER:$PROD_PATH/"

echo "✅ Code synced"

# Step 2: Rebuild and restart if requested
if [ "$FULL_BUILD" = "--full" ]; then
  echo ""
  echo "🔨 Rebuilding Docker image..."
  ssh "$PROD_SERVER" "cd $PROD_PATH && docker compose build --no-cache app"
  echo "✅ Docker image rebuilt"
fi

# Step 3: Restart the application
echo ""
echo "🔄 Restarting application..."
ssh "$PROD_SERVER" "cd $PROD_PATH && docker compose restart app"

# Step 4: Wait for health check
echo ""
echo "⏳ Waiting for service to be healthy..."
for i in {1..15}; do
  if ssh "$PROD_SERVER" "curl -sf http://localhost:3000/health > /dev/null"; then
    echo "✅ Service is healthy"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "⚠️  Service did not become healthy within 30 seconds"
    echo "   Check logs with: ssh $PROD_SERVER 'docker logs ai-army-app'"
    exit 1
  fi
  sleep 2
done

# Step 5: Show status
echo ""
echo "📊 Current status:"
ssh "$PROD_SERVER" "cd $PROD_PATH && docker compose ps"

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "Next steps:"
echo "  - View logs: ssh $PROD_SERVER 'docker logs -f ai-army-app'"
echo "  - Check health: curl http://15.204.245.151:3000/health"
echo "  - SSH to server: ssh $PROD_SERVER"
