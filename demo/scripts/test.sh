#!/usr/bin/env bash
# Test script for ai-army demo bots
# Validates all demo configuration files and bot definitions

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ROOT="$(cd "$DEMO_DIR/.." && pwd)"
FAILED=0

echo "=== AI Army Demo Bot Tests ==="
echo ""

# Run config validation tests
echo "--- Running config validation tests ---"
if node --test "$DEMO_DIR/config.test.js"; then
  echo "Config tests: PASSED"
else
  echo "Config tests: FAILED"
  FAILED=1
fi

echo ""

# Verify bot directories exist
echo "--- Checking bot structure ---"
BOTS=("echo-bot" "calculator-bot" "file-assistant")

for bot in "${BOTS[@]}"; do
  BOT_DIR="$DEMO_DIR/bots/$bot"

  if [ ! -d "$BOT_DIR" ]; then
    echo "FAIL: $bot directory missing"
    FAILED=1
    continue
  fi

  if [ ! -f "$BOT_DIR/config.json" ]; then
    echo "FAIL: $bot/config.json missing"
    FAILED=1
  fi

  if [ ! -f "$BOT_DIR/soul.md" ]; then
    echo "FAIL: $bot/soul.md missing"
    FAILED=1
  fi

  if [ -f "$BOT_DIR/config.json" ] && [ -f "$BOT_DIR/soul.md" ]; then
    echo "OK: $bot has config.json and soul.md"
  fi
done

echo ""

# Verify .env.example exists
echo "--- Checking environment ---"
if [ -f "$DEMO_DIR/.env.example" ]; then
  echo "OK: .env.example exists"
else
  echo "FAIL: .env.example missing"
  FAILED=1
fi

echo ""

# Summary
if [ "$FAILED" -eq 0 ]; then
  echo "=== All Tests Passed ==="
  exit 0
else
  echo "=== Some Tests Failed ==="
  exit 1
fi
