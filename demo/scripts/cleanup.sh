#!/usr/bin/env bash
# Cleanup script for ai-army demo project
# Stops PostgreSQL container, removes volumes, generated files, and runtime data.
#
# Usage: ./scripts/cleanup.sh
# Options:
#   --keep-db   Keep the PostgreSQL container and its volume
#   --all       Also remove .env file (full reset)
#   --help      Show this help message

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER_NAME="ai-army-demo-postgres"
COMPOSE_PROJECT="demo"
KEEP_DB=false
REMOVE_ALL=false

# ─── Parse arguments ──────────────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --keep-db) KEEP_DB=true ;;
    --all) REMOVE_ALL=true ;;
    --help|-h)
      cat <<'HELPEOF'
Usage: ./scripts/cleanup.sh
Options:
  --keep-db   Keep the PostgreSQL container and its volume
  --all       Also remove .env file (full reset)
  --help      Show this help message
HELPEOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Run with --help for usage"
      exit 1
      ;;
  esac
done

echo "=== AI Army Demo Cleanup ==="
echo ""

# ─── Docker Compose cleanup ──────────────────────────────────────────────────

if command -v docker &> /dev/null; then
  echo "--- Docker cleanup ---"

  # Try docker compose down first (handles compose-managed resources)
  if [ -f "$DEMO_DIR/docker-compose.yml" ]; then
    if [ "$KEEP_DB" = true ]; then
      echo "  Keeping docker compose services (--keep-db)"
    else
      # Check if compose services are running
      if docker compose -f "$DEMO_DIR/docker-compose.yml" ps -q 2>/dev/null | grep -q .; then
        echo "  Stopping docker compose services..."
        docker compose -f "$DEMO_DIR/docker-compose.yml" down --volumes --remove-orphans \
          > /dev/null 2>&1 || true
        echo "  Stopped and removed compose services"
      fi
    fi
  fi

  # Remove the named demo PostgreSQL container (standalone setup.sh container)
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
  mapfile -t CONTAINERS < <(docker ps -a --filter "label=ai-army-demo" -q 2>/dev/null || true)
  if [ ${#CONTAINERS[@]} -gt 0 ] && [ -n "${CONTAINERS[0]}" ]; then
    echo "  Removing demo-labeled containers..."
    docker rm -f "${CONTAINERS[@]}" > /dev/null 2>&1 || true
    echo "  Removed demo containers"
  fi

  # Remove demo Docker volumes
  if [ "$KEEP_DB" != true ]; then
    mapfile -t VOLUMES < <(docker volume ls --filter "label=ai-army-demo" -q 2>/dev/null || true)
    if [ ${#VOLUMES[@]} -gt 0 ] && [ -n "${VOLUMES[0]}" ]; then
      echo "  Removing demo-labeled volumes..."
      docker volume rm "${VOLUMES[@]}" > /dev/null 2>&1 || true
      echo "  Removed demo volumes"
    fi

    # Remove compose-created volumes (project name prefix)
    mapfile -t COMPOSE_VOLUMES < <(docker volume ls -q --filter "name=${COMPOSE_PROJECT}_" 2>/dev/null || true)
    if [ ${#COMPOSE_VOLUMES[@]} -gt 0 ] && [ -n "${COMPOSE_VOLUMES[0]}" ]; then
      echo "  Removing compose volumes..."
      docker volume rm "${COMPOSE_VOLUMES[@]}" > /dev/null 2>&1 || true
      echo "  Removed compose volumes"
    fi
  fi

  echo ""
fi

# ─── File cleanup ─────────────────────────────────────────────────────────────

echo "--- File cleanup ---"

# Remove node_modules
if [ -d "$DEMO_DIR/node_modules" ]; then
  echo "  Removing node_modules/..."
  rm -rf "$DEMO_DIR/node_modules"
  echo "  Removed node_modules/"
else
  echo "  node_modules/ not found (skipped)"
fi

# Remove runtime data
if [ -d "$DEMO_DIR/data" ]; then
  echo "  Removing data/..."
  rm -rf "$DEMO_DIR/data"
  echo "  Removed data/"
else
  echo "  data/ not found (skipped)"
fi

# Remove package-lock.json
if [ -f "$DEMO_DIR/package-lock.json" ]; then
  echo "  Removing package-lock.json..."
  rm -f "$DEMO_DIR/package-lock.json"
  echo "  Removed package-lock.json"
fi

# Remove .env only with --all flag
if [ "$REMOVE_ALL" = true ]; then
  if [ -f "$DEMO_DIR/.env" ]; then
    echo "  Removing .env..."
    rm -f "$DEMO_DIR/.env"
    echo "  Removed .env"
  fi
fi

echo ""
echo "=== Cleanup Complete ==="
echo "Run './scripts/setup.sh' to re-initialize the demo."
