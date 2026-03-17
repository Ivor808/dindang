#!/bin/sh
set -e

SECRET_FILE="/app/data/.encryption-secret"

# Auto-generate encryption secret if not set
if [ -z "$DINDANG_ENCRYPTION_SECRET" ]; then
  if [ -f "$SECRET_FILE" ]; then
    export DINDANG_ENCRYPTION_SECRET=$(cat "$SECRET_FILE")
    echo "[entrypoint] loaded DINDANG_ENCRYPTION_SECRET from $SECRET_FILE"
  else
    export DINDANG_ENCRYPTION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    mkdir -p /app/data
    echo "$DINDANG_ENCRYPTION_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "[entrypoint] generated and persisted DINDANG_ENCRYPTION_SECRET"
  fi
fi

# Run database migrations
echo "[entrypoint] applying database schema..."
npx drizzle-kit push --force

echo "[entrypoint] starting dindang..."
exec node --import tsx server.ts
