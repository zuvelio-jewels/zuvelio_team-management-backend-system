#!/bin/sh

set -e

echo "Running Prisma migrations..."

MAX_RETRIES=${MAX_RETRIES:-10}
RETRY_DELAY=${RETRY_DELAY:-3}
attempt=1

until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "Prisma migration failed after $attempt attempts"
    exit 1
  fi

  echo "Migration attempt $attempt failed. Retrying in ${RETRY_DELAY}s..."
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done

echo "Starting NestJS application..."
exec node dist/src/main.js
