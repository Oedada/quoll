Установка зависимостей и самого пакета выполняется в директории backend:
```bash
uv sync --all-groups
```

Инфраструктура (postgres, keycloak, minio):
```bash
docker compose up -d
```

Схема базы ведётся миграциями Alembic, приложение её больше не создаёт само:
```bash
uv run alembic upgrade head
```

Запуск приложения:
```bash
uv run uvicorn quoll.main:app --reload
```
