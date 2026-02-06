#!/usr/bin/env bash
# Setup script for ai-army demo project
# Validates environment and installs dependencies

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== AI Army Demo Setup ==="
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed. Install Node.js 22+ first."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required (found v$(node -v))"
  exit 1
fi
echo "Node.js $(node -v) OK"

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "WARNING: Docker is not installed. Sandbox execution will not work."
else
  echo "Docker $(docker --version | cut -d' ' -f3 | tr -d ',') OK"
fi

# Check for .env file
if [ ! -f "$DEMO_DIR/.env" ]; then
  echo ""
  echo "Creating .env from .env.example..."
  cp "$DEMO_DIR/.env.example" "$DEMO_DIR/.env"
  echo "IMPORTANT: Edit $DEMO_DIR/.env and set your ANTHROPIC_API_KEY"
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
cd "$DEMO_DIR"
npm install

# Validate configuration
echo ""
echo "Validating configuration..."
npx ai-army validate || echo "WARNING: Config validation failed (framework may not be built yet)"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env and set ANTHROPIC_API_KEY"
echo "  2. Run: npm run validate"
echo "  3. Run: npm start"
