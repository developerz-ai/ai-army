#!/bin/bash
set -e

REGISTRY="${DOCKER_REGISTRY:-ai-army}"
VERSION="${VERSION:-latest}"

IMAGES=(
  "frontend-developer"
  "backend-developer"
  "devops-engineer"
  "data-scientist"
  "qa-engineer"
)

echo "🐳 Building AI Army worker images..."
echo "Registry: $REGISTRY"
echo "Version: $VERSION"
echo ""

for image in "${IMAGES[@]}"; do
  echo "📦 Building $image..."

  docker build \
    -t "$REGISTRY/$image:$VERSION" \
    -t "$REGISTRY/$image:latest" \
    docker/images/$image/

  echo "  ✅ Built $image"
  echo ""
done

echo "🎉 All images built successfully!"
