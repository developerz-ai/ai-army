#!/usr/bin/env bash
# Cleanup script for ai-army demo project
# Removes generated files, node_modules, and runtime data

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== AI Army Demo Cleanup ==="
echo ""

# Remove node_modules
if [ -d "$DEMO_DIR/node_modules" ]; then
  echo "Removing node_modules..."
  rm -rf "$DEMO_DIR/node_modules"
  echo "  Removed node_modules/"
else
  echo "  node_modules/ not found (skipped)"
fi

# Remove runtime data directories
if [ -d "$DEMO_DIR/data" ]; then
  echo "Removing runtime data..."
  rm -rf "$DEMO_DIR/data"
  echo "  Removed data/"
else
  echo "  data/ not found (skipped)"
fi

# Remove package-lock.json
if [ -f "$DEMO_DIR/package-lock.json" ]; then
  echo "Removing package-lock.json..."
  rm -f "$DEMO_DIR/package-lock.json"
  echo "  Removed package-lock.json"
fi

# Stop and remove demo Docker containers (if any)
if command -v docker &> /dev/null; then
  echo "Checking for demo Docker containers..."
  CONTAINERS=$(docker ps -a --filter "label=ai-army-demo" -q 2>/dev/null || true)
  if [ -n "$CONTAINERS" ]; then
    echo "Stopping and removing demo containers..."
    docker rm -f $CONTAINERS 2>/dev/null || true
    echo "  Removed demo containers"
  else
    echo "  No demo containers found (skipped)"
  fi
fi

echo ""
echo "=== Cleanup Complete ==="
echo "Run 'npm run setup' to re-initialize the demo."
