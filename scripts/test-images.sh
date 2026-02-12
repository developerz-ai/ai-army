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

echo "🧪 Testing AI Army worker images..."
echo "Registry: $REGISTRY"
echo "Version: $VERSION"
echo ""

for image in "${IMAGES[@]}"; do
  echo "Testing $image..."

  CONTAINER_NAME="test-$image-$$"

  # Start container
  echo "  Starting container..."
  docker run -d --name "$CONTAINER_NAME" "$REGISTRY/$image:$VERSION" > /dev/null

  # Test Node.js available (for frontend-developer, backend-developer, qa-engineer)
  if [[ "$image" == "frontend-developer" ]] || [[ "$image" == "backend-developer" ]] || [[ "$image" == "qa-engineer" ]]; then
    echo "  Checking Node.js..."
    docker exec "$CONTAINER_NAME" node --version || exit 1
  fi

  # Test Python available (for backend-developer, data-scientist, qa-engineer)
  if [[ "$image" == "backend-developer" ]] || [[ "$image" == "data-scientist" ]] || [[ "$image" == "qa-engineer" ]]; then
    echo "  Checking Python..."
    docker exec "$CONTAINER_NAME" python3 --version || exit 1
  fi

  # Test git available (all images)
  echo "  Checking git..."
  docker exec "$CONTAINER_NAME" git --version || exit 1

  # Test workspace writable (all images)
  echo "  Checking workspace is writable..."
  docker exec "$CONTAINER_NAME" sh -c 'echo test > /home/agent/test.txt' || exit 1

  # Cleanup
  echo "  Cleaning up..."
  docker rm -f "$CONTAINER_NAME" > /dev/null

  echo "  ✅ $image passed"
  echo ""
done

echo "🎉 All images tested successfully!"
