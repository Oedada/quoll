# syntax=docker/dockerfile:1

# --- build: зависимости в venv через uv ---
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder
WORKDIR /app/backend

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# --- runtime ---
FROM python:3.13-slim
WORKDIR /app

ENV PYTHONPATH=/app/backend/src \
    PATH="/app/backend/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# venv из builder (в builder зависимости ставились в /app/backend/.venv)
COPY --from=builder /app/backend/.venv /app/backend/.venv

# приложение
COPY backend/src /app/backend/src
# alembic (миграции гоняются при старте)
COPY backend/alembic.ini /app/backend/alembic.ini
COPY backend/alembic /app/backend/alembic
# статику фронта отдаёт сам FastAPI через /front
COPY frontend /app/frontend

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/')" || exit 1

COPY backend/docker-entrypoint.sh /app/backend/docker-entrypoint.sh
RUN chmod +x /app/backend/docker-entrypoint.sh

ENTRYPOINT ["/app/backend/docker-entrypoint.sh"]
CMD ["uvicorn", "quoll.main:app", "--host", "0.0.0.0", "--port", "8000"]
