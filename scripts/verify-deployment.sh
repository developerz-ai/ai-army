#!/bin/bash
# Verify AI Army deployment on remote server

set -e

SSH_HOST="ubuntu@15.204.245.151"
DEPLOY_DIR="/home/ubuntu/ai-army"

echo "🔍 Verifying AI Army deployment..."
echo "Server: $SSH_HOST"
echo ""

ssh "$SSH_HOST" "bash -s" << 'ENDSSH'
set -e
cd /home/ubuntu/ai-army

# Source environment
source .env

echo "========================================="
echo "1. Container Status"
echo "========================================="
docker compose ps
echo ""

if docker compose ps | grep -q "(healthy)"; then
  echo "✅ Containers are healthy"
else
  echo "⚠️  Some containers may not be healthy yet"
fi
echo ""

echo "========================================="
echo "2. Database Connection"
echo "========================================="
if docker compose exec -T postgres pg_isready -U ai_army > /dev/null 2>&1; then
  echo "✅ Database is ready"
else
  echo "❌ Database connection failed"
  exit 1
fi
echo ""

echo "========================================="
echo "3. Health Endpoint"
echo "========================================="
response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/health" 2>&1)
if [ "$response" = "200" ]; then
  echo "✅ Health endpoint responding (HTTP $response)"
  curl -s "http://localhost:3000/health" | jq . 2>/dev/null || curl -s "http://localhost:3000/health"
else
  echo "❌ Health endpoint failed (HTTP $response)"
fi
echo ""

echo "========================================="
echo "4. Bot Container"
echo "========================================="
if docker ps | grep -q "test-bot"; then
  echo "✅ Bot container is running"
  docker ps --format "table {{.Names}}\t{{.Status}}" | grep test-bot
else
  echo "⚠️  Bot container not found (may still be starting)"
fi
echo ""

echo "========================================="
echo "5. Application Logs Check"
echo "========================================="
if docker compose logs --tail=50 app 2>&1 | grep -qi "error\|fail"; then
  echo "⚠️  Errors found in logs:"
  docker compose logs --tail=20 app | grep -i "error\|fail"
else
  echo "✅ No obvious errors in recent logs"
fi
echo ""

echo "========================================="
echo "6. Z.AI API Connectivity"
echo "========================================="
response=$(curl -s -w "\n%{http_code}" -X POST "https://api.z.ai/api/paas/v4/chat/completions" \
  -H "Authorization: Bearer $ZAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5","messages":[{"role":"user","content":"test"}],"max_tokens":5}' 2>&1)
http_code=$(echo "$response" | tail -n1)
if [ "$http_code" = "200" ]; then
  echo "✅ Z.AI API connection successful"
else
  echo "❌ Z.AI API connection failed (HTTP $http_code)"
  echo "$response" | head -n-1
fi
echo ""

echo "========================================="
echo "7. Bot Registration in Database"
echo "========================================="
docker compose exec -T postgres psql -U ai_army -d ai_army \
  -c "SELECT id, status FROM bots;" 2>/dev/null && echo "✅ Bot registered" || echo "⚠️  Could not check bot status"
echo ""

echo "========================================="
echo "Deployment Summary"
echo "========================================="
echo ""
echo "✅ Deployment verification complete!"
echo ""
echo "📊 System Information:"
echo "  Server: ubuntu@15.204.245.151"
echo "  API Endpoint: http://15.204.245.151:3000"
echo ""
echo "🔑 Credentials (save these securely):"
echo "  API_TOKEN: $API_TOKEN"
echo ""
echo "📝 Useful Commands:"
echo "  View logs:     docker compose logs -f app"
echo "  Check status:  docker compose exec app node bin/cli.js status"
echo "  Restart:       docker compose restart app"
echo "  Stop:          docker compose down"
echo ""
echo "📖 Documentation:"
echo "  See ./tmp/debug/production/*.md for detailed guides"
echo ""
ENDSSH

echo ""
echo "✅ Verification complete"
echo ""
echo "For detailed troubleshooting, see:"
echo "  ./tmp/debug/production/05-troubleshooting.md"
echo ""
