#!/bin/sh
set -e

echo "Running database migrations..."
cd /app/backend
alembic upgrade head

echo "Starting uvicorn..."
exec "$@"
