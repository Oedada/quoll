Установка зависимостей и самого пакета выполняется в директории backend:
```bash
uv sync --all-groups
```

Инфраструктура (postgres, keycloak, garage):
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

Эталонный воркфлоу «Работа с вузами» (шаги 1–8, 3.1, пороги застоя). Повторный запуск ничего не делает; тот же граф можно собрать руками через админские ручки:
```bash
uv run python -m quoll.seed workflow
```

Демо-режим для проверки: `DEMO_MODE=true` в `.env`. При старте заводится эталонный воркфлоу и учётки ролей — руководитель и два менеджера в его команде. Пароль у всех — `DEMO_PASSWORD` (по умолчанию `quoll-demo`); список отдаёт `GET /auth/demo-accounts` для кнопок «войти как».

| Логин | Роль |
|---|---|
| `admin` | администратор (`APP_ADMIN_PASSWORD`) |
| `supervisor` | руководитель |
| `manager1`, `manager2` | менеджеры (КАМ) |
