#!/bin/bash
# Deploy AI Army to production server

set -e

SSH_HOST="ubuntu@15.204.245.151"
DEPLOY_DIR="/home/ubuntu/ai-army"
LOCAL_DIR="$(pwd)"

echo "🚀 Deploying AI Army to production..."
echo "Local: $LOCAL_DIR"
echo "Remote: $SSH_HOST:$DEPLOY_DIR"
echo ""

# Validate local environment
echo "→ Validating local configuration..."
if ! npm run validate > /dev/null 2>&1; then
  echo "❌ Local configuration validation failed"
  echo "Run 'npm run validate' to see errors"
  exit 1
fi
echo "✅ Local configuration valid"

# Create deployment archive
echo "→ Creating deployment archive..."
tar czf /tmp/ai-army-deploy.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=data \
  --exclude=tmp \
  --exclude='*.log' \
  -C "$LOCAL_DIR" .

ARCHIVE_SIZE=$(du -h /tmp/ai-army-deploy.tar.gz | cut -f1)
echo "✅ Archive created ($ARCHIVE_SIZE)"

# Transfer to server
echo "→ Transferring files to server..."
scp /tmp/ai-army-deploy.tar.gz "$SSH_HOST:$DEPLOY_DIR/"
rm /tmp/ai-army-deploy.tar.gz
echo "✅ Files transferred"

# Deploy on server
echo "→ Deploying on server..."
ssh "$SSH_HOST" "bash -s" << ENDSSH
set -e
cd $DEPLOY_DIR

# Extract archive
echo "  → Extracting files..."
tar xzf ai-army-deploy.tar.gz
rm ai-army-deploy.tar.gz

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo "  → Creating .env file..."
  DB_PASSWORD=\$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
  API_TOKEN=\$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)

  cat > .env << 'EOF'
NODE_ENV=production
DB_PASSWORD=DB_PASSWORD_PLACEHOLDER
DATABASE_URL=postgresql://ai_army:DB_PASSWORD_PLACEHOLDER@postgres:5432/ai_army
PORT=3000
API_TOKEN=API_TOKEN_PLACEHOLDER

# AI Provider API Key
OPENROUTER_API_KEY=your-openrouter-api-key-here
EOF

  sed -i "s/DB_PASSWORD_PLACEHOLDER/\$DB_PASSWORD/g" .env
  sed -i "s/API_TOKEN_PLACEHOLDER/\$API_TOKEN/g" .env
  chmod 600 .env

  echo "  ✅ .env created with generated credentials"
  echo "  → Credentials (SAVE THESE):"
  echo "     DB_PASSWORD: \$DB_PASSWORD"
  echo "     API_TOKEN: \$API_TOKEN"
else
  echo "  ✅ .env already exists (not overwriting)"
fi

# Update config.json for OpenRouter
echo "  → Configuring OpenRouter provider..."
cat > config.json << 'EOF'
{
  "defaults": {
    "model": {
      "provider": "openrouter",
      "model": "openrouter/aurora-alpha"
    },
    "sandbox": {
      "type": "docker",
      "image": "node:22-slim"
    }
  },
  "providers": {
    "openrouter": {
      "type": "openrouter",
      "apiKey": "\${OPENROUTER_API_KEY}"
    }
  },
  "api": {
    "enabled": true,
    "port": 3000,
    "host": "0.0.0.0"
  },
  "channels": {},
  "mcpServers": {}
}
EOF

# Create test bot
echo "  → Creating test bot..."
mkdir -p bots/test-bot

cat > bots/test-bot/config.json << 'EOF'
{
  "id": "test-bot",
  "soul": "./soul.md",
  "provider": "openrouter",
  "model": "openrouter/aurora-alpha",
  "tools": ["bash", "readFile", "writeFile"]
}
EOF

cat > bots/test-bot/soul.md << 'EOF'
# Test Bot

You are a helpful AI assistant for testing AI Army deployment.

**Capabilities:**
- Execute bash commands
- Read files
- Write files

**Purpose:**
- Respond concisely to test queries
- Verify all tools work correctly
- Help identify deployment issues

When asked to test something, execute and report results clearly.
EOF

echo "  ✅ Configuration complete"

# Start services
echo "  → Starting Docker containers..."
docker compose down -v 2>/dev/null || true
docker compose up -d

echo "  → Waiting for services to be ready..."
sleep 30

# Run migrations
echo "  → Running database migrations..."
docker compose exec -T app node bin/cli.js migrate || {
  echo "  ⚠️  Migration failed, checking logs..."
  docker compose logs app --tail=20
  exit 1
}

# Check status
echo "  → Checking deployment status..."
docker compose ps

echo "  ✅ Deployment complete"
ENDSSH

echo ""
echo "========================================="
echo "✅ Deployment successful!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Verify deployment: ./scripts/verify-deployment.sh"
echo "  2. View logs: ssh $SSH_HOST 'cd $DEPLOY_DIR && docker compose logs -f'"
echo "  3. Check status: ssh $SSH_HOST 'cd $DEPLOY_DIR && docker compose exec app node bin/cli.js status'"
echo ""
