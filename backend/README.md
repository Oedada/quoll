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

Отчёты (`/api/v1/reports`, дизайн — `docs/reports-design.md`). Предпросмотр строится сразу, файл (xlsx, xls, pdf) — в фоне:
`POST /exports` ставит задание в очередь, `GET /exports/{id}` отдаёт статус и место в очереди, `GET /exports/{id}/file` — готовый файл.
Очередь — таблица `report_exports`, её разбирают фоновые процессы, поэтому нужны `WORKERS_ENABLED=true` и S3: файл хранится там сутки, потом удаляется.
Одновременно строится не больше 10 отчётов на все экземпляры приложения; рендер идёт в пуле процессов, его размер — `REPORT_RENDER_PROCESSES`.

Импорт (`/api/v1/imports`, только администратор; дизайн — `docs/import-design.md`, состояние — `docs/handoff/imports-status.md`). Загруженный xlsx/xls/csv/json разбирается в превью каталогов и реестра работы с вузами; правки, решения по конфликтам и исключение строк — до запуска.
`POST /` — загрузка и превью, `PATCH /{id}` и `PATCH /{id}/sheets/{number}` — маршрут и сопоставление колонок, `GET /{id}/rows` / `PATCH /{id}/rows/{row_id}` — построчный просмотр и правка, `POST /{id}/decisions` — решение по конфликтующим группам массово, `GET /{id}/managers` — подбор менеджера, `POST /{id}/apply` — запуск, `GET /{id}` — статус и прогресс, `POST /{id}/stop` — остановка, `GET /{id}/report` — итоговый xlsx.
Применение — в фоне (`WORKERS_ENABLED=true`, задание `import-apply`), по одной строке каталога или группе реестра за раз, с арендой партии и повторами при сбое; черновик партии и её файлы живут `import_draft_ttl_hours`, применённая партия — `import_applied_ttl_days`, потом их подчищает `import-cleanup`.
Формат файла и коды ошибок — `docs/import-format.md` и `docs/import-errors.md` (генерируются `python -m quoll.imports.template`).
