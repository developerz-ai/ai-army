#!/usr/bin/env bash
# Cleanup script for ai-army demo project
# Stops PostgreSQL container, removes generated files and runtime data.
#
# Usage: ./scripts/cleanup.sh
# Options: --keep-db  Keep the PostgreSQL container and data

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER_NAME="ai-army-demo-postgres"
KEEP_DB=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --keep-db) KEEP_DB=true ;;
  esac
done

echo "=== AI Army Demo Cleanup ==="
echo ""

# ─── Stop and remove demo PostgreSQL container ───────────────────────────────

if command -v docker &> /dev/null; then
  echo "--- Docker cleanup ---"

  # Remove the named demo PostgreSQL container
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    if [ "$KEEP_DB" = true ]; then
      echo "  Keeping container '${CONTAINER_NAME}' (--keep-db)"
    else
      echo "  Stopping and removing '${CONTAINER_NAME}'..."
      docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true
      echo "  Removed '${CONTAINER_NAME}'"
    fi
  else
    echo "  No demo PostgreSQL container found (skipped)"
  fi

  # Remove any other demo-labeled containers
  CONTAINERS=$(docker ps -a --filter "label=ai-army-demo" -q 2>/dev/null || true)
  if [ -n "$CONTAINERS" ]; then
    echo "  Removing demo-labeled containers..."
    docker rm -f $CONTAINERS > /dev/null 2>&1 || true
    echo "  Removed demo containers"
  fi

  echo ""
fi

# ─── Remove node_modules ─────────────────────────────────────────────────────

echo "--- File cleanup ---"

if [ -d "$DEMO_DIR/node_modules" ]; then
  echo "  Removing node_modules/..."
  rm -rf "$DEMO_DIR/node_modules"
  echo "  Removed node_modules/"
else
  echo "  node_modules/ not found (skipped)"
fi

# ─── Remove runtime data ─────────────────────────────────────────────────────

if [ -d "$DEMO_DIR/data" ]; then
  echo "  Removing data/..."
  rm -rf "$DEMO_DIR/data"
  echo "  Removed data/"
else
  echo "  data/ not found (skipped)"
fi

# ─── Remove package-lock.json ────────────────────────────────────────────────

if [ -f "$DEMO_DIR/package-lock.json" ]; then
  echo "  Removing package-lock.json..."
  rm -f "$DEMO_DIR/package-lock.json"
  echo "  Removed package-lock.json"
fi

echo ""
echo "=== Cleanup Complete ==="
echo "Run './scripts/setup.sh' to re-initialize the demo."
