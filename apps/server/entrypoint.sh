#!/bin/sh
set -e

echo "[server] Waiting for database..."
until npx prisma db push --skip-generate 2>&1; do
  echo "[server] DB not ready, retrying in 3s..."
  sleep 3
done

echo "[server] Starting..."
exec node dist/index.js
