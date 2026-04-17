#!/bin/sh

set -e

echo "=== ENTRYPOINT START ==="
echo "Node version: $(node -v)"
echo "PORT env: ${PORT:-not set}"
echo "DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo yes || echo no)"

echo "Running Prisma migrations..."

MAX_RETRIES=${MAX_RETRIES:-10}
RETRY_DELAY=${RETRY_DELAY:-3}
attempt=1

until npx prisma migrate deploy 2>&1; do
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "Prisma migration failed after $attempt attempts"
    exit 1
  fi

  echo "Migration attempt $attempt failed. Retrying in ${RETRY_DELAY}s..."
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done

echo "=== Migrations complete. Starting NestJS ==="
exec node dist/src/main.js
