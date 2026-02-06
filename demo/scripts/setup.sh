#!/usr/bin/env bash
# Setup script for ai-army demo project
# Starts PostgreSQL 18 in Docker, installs dependencies, runs migrations.
#
# Usage: ./scripts/setup.sh
# Prerequisites: Node.js 22+, Docker

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ROOT="$(cd "$DEMO_DIR/.." && pwd)"

# Demo PostgreSQL container settings
CONTAINER_NAME="ai-army-demo-postgres"
PG_IMAGE="postgres:18-alpine"
PG_PORT="${DEMO_PG_PORT:-5432}"
PG_USER="demo"
PG_PASSWORD="demo"
PG_DB="ai_army_demo"
DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}"

# Max seconds to wait for PostgreSQL readiness
PG_WAIT_TIMEOUT=30

echo "=== AI Army Demo Setup ==="
echo ""

# ─── Step 1: Check Prerequisites ─────────────────────────────────────────────

echo "--- Checking prerequisites ---"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed. Install Node.js 22+ first."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required (found $(node -v))"
  exit 1
fi
echo "  Node.js $(node -v) ... OK"

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker is not installed. Docker is required to run PostgreSQL."
  exit 1
fi
echo "  Docker $(docker --version | cut -d' ' -f3 | tr -d ',') ... OK"

echo ""

# ─── Step 2: Create .env if missing ──────────────────────────────────────────

if [ ! -f "$DEMO_DIR/.env" ]; then
  echo "--- Creating .env from .env.example ---"
  cp "$DEMO_DIR/.env.example" "$DEMO_DIR/.env"
  # Update DATABASE_URL in .env to match container settings (portable across GNU/BSD sed)
  if command -v sed &> /dev/null; then
    tmpfile=$(mktemp)
    sed "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "$DEMO_DIR/.env" > "$tmpfile" \
      && mv "$tmpfile" "$DEMO_DIR/.env"
  fi
  echo "  Created .env (edit it to set ANTHROPIC_API_KEY)"
  echo ""
fi

# ─── Step 3: Start PostgreSQL 18 ─────────────────────────────────────────────

echo "--- Starting PostgreSQL 18 ---"

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  # Container exists - check if running
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "  Container '${CONTAINER_NAME}' is already running"
  else
    echo "  Starting existing container '${CONTAINER_NAME}'..."
    docker start "$CONTAINER_NAME" > /dev/null
  fi
else
  echo "  Creating PostgreSQL 18 container..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    --label "ai-army-demo=true" \
    -e POSTGRES_DB="$PG_DB" \
    -e POSTGRES_USER="$PG_USER" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -p "${PG_PORT}:5432" \
    "$PG_IMAGE" > /dev/null
  echo "  Container '${CONTAINER_NAME}' created"
fi

# ─── Step 4: Wait for PostgreSQL readiness ────────────────────────────────────

echo "  Waiting for PostgreSQL to be ready..."

elapsed=0
while [ "$elapsed" -lt "$PG_WAIT_TIMEOUT" ]; do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" -d "$PG_DB" > /dev/null 2>&1; then
    echo "  PostgreSQL is ready (${elapsed}s)"
    break
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

if [ "$elapsed" -ge "$PG_WAIT_TIMEOUT" ]; then
  echo "ERROR: PostgreSQL did not become ready within ${PG_WAIT_TIMEOUT}s"
  echo "  Check: docker logs ${CONTAINER_NAME}"
  exit 1
fi

echo ""

# ─── Step 5: Install dependencies ────────────────────────────────────────────

echo "--- Installing dependencies ---"
cd "$DEMO_DIR"
npm install
echo ""

# ─── Step 6: Run database migrations ─────────────────────────────────────────

echo "--- Running database migrations ---"
DATABASE_URL="$DATABASE_URL" npx ai-army migrate
echo ""

# ─── Step 7: Validate configuration ──────────────────────────────────────────

echo "--- Validating configuration ---"
npx ai-army validate || echo "  WARNING: Config validation failed (framework may not be fully built yet)"
echo ""

# ─── Done ─────────────────────────────────────────────────────────────────────

echo "=== Setup Complete ==="
echo ""
echo "PostgreSQL 18 running at: ${DATABASE_URL}"
echo ""
echo "Next steps:"
echo "  1. Edit .env and set your ANTHROPIC_API_KEY"
echo "  2. Run: npm start"
echo "  3. Test: ./scripts/test.sh"
echo ""
echo "Useful commands:"
echo "  psql ${DATABASE_URL}         # Connect to database"
echo "  docker logs ${CONTAINER_NAME}  # View PostgreSQL logs"
echo "  ./scripts/cleanup.sh           # Remove everything"
