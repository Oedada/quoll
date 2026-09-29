# Quoll

CRM для отдела по работе с вузами ИТ-школы Ростелекома. Прототип для хакатона — автоматизирует путь заявки от черновика до окончательного внедрения: этапы и переходы задаются воркфлоу, у каждой роли (КАМ, руководитель, администратор) свой набор действий.

## Возможности

- Аутентификация пользователей с тремя ролями
- Управление шаблонами врокфлоу, создание и управление воркфлоу, этапами, переходами этапов
- Мониторинг работы менеджеров у руководителя
- Управление системой у админа

## Архитектура

Проект состоит из следующих основных компонентов:

- **FastAPI** — backend
- **React** — frontend
- **Postgres + S3 + sqlalchemy** — хранение данных
- **Keycloak** — аутентификация и управление пользователями

## Быстрый старт

```bash
git clone https://github.com/Oedada/quoll.git
cd quoll
cp backend/example.env backend/.env
sed -i "s/^SESSION_SECRET_KEY=.*/SESSION_SECRET_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")/" backend/.env
docker build -f backend/Dockerfile -t quoll .
docker compose -f backend/docker-compose.yml up -d
```
