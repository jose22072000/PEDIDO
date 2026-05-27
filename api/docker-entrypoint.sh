#!/bin/sh
set -e

echo "[api] DATABASE_PROVIDER=${DATABASE_PROVIDER:-sqlite}"

echo "[api] Applying Prisma schema..."
npx prisma db push --skip-generate

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[api] Running seed..."
  npx prisma db seed
fi

echo "[api] Starting server..."
exec node dist/index.js
