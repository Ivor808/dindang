#!/bin/sh
set -e

REPO="https://raw.githubusercontent.com/Ivor808/dindang/master"
COMPOSE_FILE="docker-compose.yml"

echo "dindang — AI coding agent platform"
echo ""

# Check for Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required. Install it from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose v2 is required. Update Docker or install the compose plugin."
  exit 1
fi

# Download or update docker-compose.yml
if [ -f "$COMPOSE_FILE" ]; then
  echo "Updating dindang..."
  docker compose pull
else
  echo "Installing dindang..."
  curl -fsSL "$REPO/$COMPOSE_FILE" -o "$COMPOSE_FILE"
fi

# Start services
docker compose up -d

echo ""
echo "dindang is running at http://localhost:3000"
