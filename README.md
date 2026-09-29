# Quoll

CRM для отдела по работе с вузами ИТ-школы Ростелекома. Прототип для хакатона — автоматизирует путь заявки от черновика до окончательного внедрения: этапы и переходы задаются воркфлоу, у каждой роли (КАМ, руководитель, администратор) свой набор действий.

## Стек

FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL, Keycloak для авторизации, S3-совместимое хранилище для файлов. Подробнее — в [`docs/`](docs).

## Быстрый старт

```bash
git clone https://github.com/Oedada/quoll.git
cd quoll
cp backend/example.env backend/.env
sed -i "s/^SESSION_SECRET_KEY=.*/SESSION_SECRET_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")/" backend/.env
docker build -f backend/Dockerfile -t quoll .
docker compose -f backend/docker-compose.yml up -d
```

Переменные окружения — `backend/example.env` → `.env` (обязательно сгенерировать `SESSION_SECRET_KEY` и `PII_ENCRYPTION_KEY`, команда есть в комментарии рядом). Демо-режим (`DEMO_MODE=true`) поднимает эталонный воркфлоу и три учётки — руководителя и двух менеджеров, список отдаёт `GET /auth/demo-accounts`.

Локальный запуск без сборки образа и остальные команды — в [`backend/README.md`](backend/README.md).

## Проверка

- `GET /` — health-check
- `GET /docs` — Swagger UI

## Структура

backend — FastAPI-приложение (модульный монолит, src-layout)

docs — требования, дизайн-документы, схема БД



Документация по модулям, ролям и решениям — в mkdocs (в процессе), полный список файлов пока в [`docs/`](docs).
