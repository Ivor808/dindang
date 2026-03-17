#!/bin/sh
set -e

# Auto-generate encryption secret if not set
if [ -z "$DINDANG_ENCRYPTION_SECRET" ]; then
  export DINDANG_ENCRYPTION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "[entrypoint] generated DINDANG_ENCRYPTION_SECRET"
fi

# Run database migrations
echo "[entrypoint] applying database schema..."
npx drizzle-kit push --force

echo "[entrypoint] starting dindang..."
exec node .output/server/index.mjs
