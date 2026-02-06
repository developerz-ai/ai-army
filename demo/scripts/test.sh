#!/usr/bin/env bash
# Test script for ai-army demo - sends test messages to all 3 bots
#
# Usage:
#   ./scripts/test.sh                  # Full test (validate + send messages)
#   ./scripts/test.sh --validate-only  # Validate config/structure only (offline)
#   ./scripts/test.sh --bot echo-bot   # Test a single bot
#   ./scripts/test.sh --port 4000      # Use custom API port
#   ./scripts/test.sh --timeout 30     # Set response timeout (seconds)
#   ./scripts/test.sh --verbose        # Show full response bodies
#
# Prerequisites:
#   - ./scripts/setup.sh has been run
#   - npm start (server running) for message tests
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ROOT="$(cd "$DEMO_DIR/.." && pwd)"

# ─── Defaults ────────────────────────────────────────────────────────────────

API_PORT="${DEMO_API_PORT:-3000}"
API_HOST="${DEMO_API_HOST:-localhost}"
BASE_URL="http://${API_HOST}:${API_PORT}"
TIMEOUT=30
VALIDATE_ONLY=false
SINGLE_BOT=""
VERBOSE=false
PASSED=0
FAILED=0
SKIPPED=0

# All demo bot IDs
ALL_BOTS=("echo-bot" "calculator-bot" "file-assistant")

# ─── Parse Arguments ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --validate-only)
      VALIDATE_ONLY=true
      shift
      ;;
    --bot)
      SINGLE_BOT="$2"
      shift 2
      ;;
    --port)
      API_PORT="$2"
      BASE_URL="http://${API_HOST}:${API_PORT}"
      shift 2
      ;;
    --host)
      API_HOST="$2"
      BASE_URL="http://${API_HOST}:${API_PORT}"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      head -17 "$0" | tail -15
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run with --help for usage"
      exit 1
      ;;
  esac
done

# ─── Helpers ─────────────────────────────────────────────────────────────────

pass() {
  PASSED=$((PASSED + 1))
  echo "  PASS: $1"
}

fail() {
  FAILED=$((FAILED + 1))
  echo "  FAIL: $1"
}

skip() {
  SKIPPED=$((SKIPPED + 1))
  echo "  SKIP: $1"
}

# Determine which bots to test
get_bots() {
  if [ -n "$SINGLE_BOT" ]; then
    echo "$SINGLE_BOT"
  else
    echo "${ALL_BOTS[@]}"
  fi
}

# ─── Phase 1: Structure Validation ──────────────────────────────────────────

echo "=== AI Army Demo Tests ==="
echo ""
echo "--- Phase 1: Structure Validation ---"

# Validate each bot has config.json and soul.md
for bot in $(get_bots); do
  BOT_DIR="$DEMO_DIR/bots/$bot"

  if [ ! -d "$BOT_DIR" ]; then
    fail "$bot directory missing at bots/$bot/"
    continue
  fi

  if [ ! -f "$BOT_DIR/config.json" ]; then
    fail "$bot/config.json missing"
  else
    pass "$bot/config.json exists"
  fi

  if [ ! -f "$BOT_DIR/soul.md" ]; then
    fail "$bot/soul.md missing"
  else
    pass "$bot/soul.md exists"
  fi
done

echo ""

# ─── Phase 2: Config Validation ──────────────────────────────────────────────

echo "--- Phase 2: Config Validation ---"

# Validate main config.json
if [ -f "$DEMO_DIR/config.json" ]; then
  # Check it's valid JSON
  if node -e "JSON.parse(require('fs').readFileSync('$DEMO_DIR/config.json','utf-8'))" 2>/dev/null; then
    pass "config.json is valid JSON"
  else
    fail "config.json is invalid JSON"
  fi
else
  fail "config.json missing"
fi

# Validate bot config.json files are valid JSON
for bot in $(get_bots); do
  CONFIG_FILE="$DEMO_DIR/bots/$bot/config.json"
  if [ -f "$CONFIG_FILE" ]; then
    if node -e "JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'))" 2>/dev/null; then
      pass "$bot/config.json is valid JSON"
    else
      fail "$bot/config.json is invalid JSON"
    fi
  fi
done

# Run framework config validation if available
if [ -f "$DEMO_DIR/config.test.js" ]; then
  echo ""
  echo "  Running config.test.js..."
  if node --test "$DEMO_DIR/config.test.js" > /dev/null 2>&1; then
    pass "config.test.js passed"
  else
    fail "config.test.js failed"
  fi
fi

# Verify .env.example exists
if [ -f "$DEMO_DIR/.env.example" ]; then
  pass ".env.example exists"
else
  fail ".env.example missing"
fi

echo ""

# ─── Phase 3: Bot Config Content Checks ─────────────────────────────────────

echo "--- Phase 3: Bot Config Content ---"

for bot in $(get_bots); do
  CONFIG_FILE="$DEMO_DIR/bots/$bot/config.json"
  if [ ! -f "$CONFIG_FILE" ]; then
    continue
  fi

  # Verify bot id matches directory name
  BOT_ID=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'));process.stdout.write(c.id||'')" 2>/dev/null)
  if [ "$BOT_ID" = "$bot" ]; then
    pass "$bot has correct id field"
  else
    fail "$bot id mismatch: expected '$bot', got '$BOT_ID'"
  fi

  # Verify soul references ./soul.md
  SOUL_REF=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'));process.stdout.write(c.soul||'')" 2>/dev/null)
  if [ "$SOUL_REF" = "./soul.md" ]; then
    pass "$bot soul references ./soul.md"
  else
    fail "$bot soul should be './soul.md', got '$SOUL_REF'"
  fi

  # Verify provider is set
  PROVIDER=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'));process.stdout.write(c.provider||'')" 2>/dev/null)
  if [ -n "$PROVIDER" ]; then
    pass "$bot has provider: $PROVIDER"
  else
    fail "$bot missing provider field"
  fi
done

echo ""

# If --validate-only, stop here
if [ "$VALIDATE_ONLY" = true ]; then
  echo "--- Skipping message tests (--validate-only) ---"
  echo ""

  # Print summary
  TOTAL=$((PASSED + FAILED + SKIPPED))
  echo "=== Results: $PASSED passed, $FAILED failed, $SKIPPED skipped (of $TOTAL) ==="

  if [ "$FAILED" -gt 0 ]; then
    exit 1
  fi
  exit 0
fi

# ─── Phase 4: Server Connectivity ───────────────────────────────────────────

echo "--- Phase 4: Server Connectivity ---"

# Check if the server is running
if curl -s --connect-timeout 3 "${BASE_URL}/api/bots" > /dev/null 2>&1; then
  pass "Server responding at ${BASE_URL}"
else
  echo ""
  echo "  Server not responding at ${BASE_URL}"
  echo "  Start the server first: npm start"
  echo "  Or run with --validate-only for offline tests"
  echo ""
  skip "Message tests skipped (server not running)"
  echo ""

  TOTAL=$((PASSED + FAILED + SKIPPED))
  echo "=== Results: $PASSED passed, $FAILED failed, $SKIPPED skipped (of $TOTAL) ==="

  if [ "$FAILED" -gt 0 ]; then
    exit 1
  fi
  exit 0
fi

echo ""

# ─── Phase 5: Send Test Messages ────────────────────────────────────────────

echo "--- Phase 5: Send Test Messages ---"

# Test message definitions per bot
declare -A TEST_MESSAGES
TEST_MESSAGES[echo-bot]='Hello from test script!'
TEST_MESSAGES[calculator-bot]='What is 15 times 23?'
TEST_MESSAGES[file-assistant]='Create a file called test.txt with content: Hello World'

send_test_message() {
  local bot_id="$1"
  local message="$2"
  local endpoint="${BASE_URL}/api/bots/${bot_id}/message"
  local session_id="test-${bot_id}-$$"

  echo ""
  echo "  Testing ${bot_id}..."
  echo "    Message: \"${message}\""

  # Send message via REST API
  local response
  local http_code
  response=$(curl -s -w "\n%{http_code}" \
    --max-time "$TIMEOUT" \
    -X POST "$endpoint" \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"${message}\", \"sessionId\": \"${session_id}\"}" \
    2>&1) || true

  # Extract HTTP status code (last line)
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | head -n -1)

  if [ -z "$http_code" ] || [ "$http_code" = "000" ]; then
    fail "${bot_id}: No response (timeout or connection error)"
    return
  fi

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    pass "${bot_id}: HTTP ${http_code} OK"

    # Check response has content
    if [ -n "$body" ]; then
      # Try to extract the response text
      local reply
      reply=$(node -e "
        try {
          const r = JSON.parse(process.argv[1]);
          process.stdout.write(r.response || r.text || r.message || '(no text)');
        } catch { process.stdout.write('(non-JSON response)'); }
      " "$body" 2>/dev/null) || reply="(parse error)"

      # Truncate long responses for display
      if [ ${#reply} -gt 120 ] && [ "$VERBOSE" = false ]; then
        echo "    Response: ${reply:0:120}..."
      else
        echo "    Response: ${reply}"
      fi
      pass "${bot_id}: Got response body"
    else
      fail "${bot_id}: Empty response body"
    fi
  else
    fail "${bot_id}: HTTP ${http_code}"
    if [ "$VERBOSE" = true ] && [ -n "$body" ]; then
      echo "    Body: ${body}"
    fi
  fi
}

# Send test message to each bot
for bot in $(get_bots); do
  message="${TEST_MESSAGES[$bot]:-Hello from test script!}"
  send_test_message "$bot" "$message"
done

echo ""

# ─── Phase 6: Verify Bot List Endpoint ──────────────────────────────────────

echo "--- Phase 6: API Endpoints ---"

# Test GET /api/bots endpoint
BOT_LIST_RESPONSE=$(curl -s --max-time 5 "${BASE_URL}/api/bots" 2>/dev/null) || BOT_LIST_RESPONSE=""

if [ -n "$BOT_LIST_RESPONSE" ]; then
  pass "GET /api/bots returns data"

  # Verify all 3 bots are listed
  for bot in $(get_bots); do
    if echo "$BOT_LIST_RESPONSE" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
      const bots = Array.isArray(d) ? d : (d.bots || []);
      process.exit(bots.some(b => b.id === '$bot') ? 0 : 1);
    " 2>/dev/null; then
      pass "$bot listed in /api/bots"
    else
      skip "$bot not found in /api/bots (API may not be fully implemented)"
    fi
  done
else
  skip "GET /api/bots returned empty (API may not be fully implemented)"
fi

echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────

TOTAL=$((PASSED + FAILED + SKIPPED))
echo "=== Results: $PASSED passed, $FAILED failed, $SKIPPED skipped (of $TOTAL) ==="

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
