Установка зависимостей и самого пакета выполняется в директории backend:
```bash
uv sync --all-groups
```

Инфраструктура (postgres, keycloak, minio):
```bash
docker compose up -d
```

Запуск приложения:
```bash
uv run uvicorn quoll.main:app --reload
```
