#!/bin/bash
# Test OpenRouter API connectivity and authentication

set -e

# Load from .env if available
if [ -f .env ]; then
  source .env
fi

API_KEY="${OPENROUTER_API_KEY:-}"
API_URL="https://openrouter.ai/api/v1/chat/completions"
MODEL="openrouter/aurora-alpha"

if [ -z "$API_KEY" ]; then
  echo "❌ Error: OPENROUTER_API_KEY not set"
  echo "Set it in .env or export OPENROUTER_API_KEY=your-key"
  exit 1
fi

echo "🔍 Testing OpenRouter API connection..."
echo "API URL: $API_URL"
echo "Model: $MODEL"
echo "API Key: ${API_KEY:0:20}... (truncated)"
echo ""

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "HTTP-Referer: https://github.com/developerz-ai/ai-army" \
  -H "X-Title: AI Army Test" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Hello! Respond with exactly 3 words.\"}],
    \"max_tokens\": 50
  }" 2>&1)

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

echo "HTTP Status: $http_code"

if [ "$http_code" = "200" ]; then
  echo "✅ OpenRouter API connection successful"
  echo ""
  echo "Response:"
  echo "$body" | jq . 2>/dev/null || echo "$body"
  echo ""
  echo "Message content:"
  echo "$body" | jq -r '.choices[0].message.content' 2>/dev/null
  exit 0
else
  echo "❌ OpenRouter API connection failed"
  echo ""
  echo "Response:"
  echo "$body"
  echo ""
  echo "Troubleshooting:"
  echo "  - Verify API key is correct"
  echo "  - Check network connectivity: curl -I https://openrouter.ai"
  echo "  - See tmp/debug/production/07-openrouter-working.md for details"
  exit 1
fi
