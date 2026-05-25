#!/bin/sh
set -e

echo "[server] Waiting for database..."
until npx prisma db push --skip-generate 2>&1; do
  echo "[server] DB not ready, retrying in 3s..."
  sleep 3
done

# Start Scrapling proxy in background (if Python is available)
if command -v python3 &> /dev/null && [ -f /app/scrapling_proxy.py ]; then
  echo "[server] Starting Scrapling proxy..."
  python3 /app/scrapling_proxy.py &
fi

echo "[server] Starting..."
exec node dist/index.js
