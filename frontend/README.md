# Фронтенд quoll

React 18 + TypeScript + Vite SPA для трёх ролей (менеджер, руководитель, админ).
Код приложения — в [`app/`](./app); Docker-образ, который его собирает и отдаёт
через nginx, — в [`docker/`](./docker). Это два независимых куска: `app/` можно
гонять просто через `npm run dev`, а `docker/` нужен только когда хочется
собрать готовый контейнер (например, для деплоя или ревью).

## Требования

- Node.js 20+ и npm (для разработки и `npm run build`)
- Поднятый backend (см. `backend/README.md` / `backend/docker-compose.yml`) —
  фронтенд сам по себе ничего не считает, все данные идут через `/api` и `/auth`
- Docker 24+, если нужен собранный образ

## Разработка (dev-сервер)

```bash
cd frontend/app
npm install
npm run dev
```

Дев-сервер поднимется на `http://127.0.0.1:5173` и проксирует `/api` и `/auth`
на `http://127.0.0.1:8000` (см. `app/vite.config.ts`) — это адрес backend из
`backend/docker-compose.yml`. Важно открывать именно `127.0.0.1:5173`, а не
`localhost:5173`: сессионная кука привязана к хосту `127.0.0.1`.

Backend с зависимостями (Postgres, Keycloak, Garage) поднимается отдельно:

```bash
cd backend
docker compose up -d
```

### Вход и демо-аккаунты

На `/login` в dev-режиме (`DEMO_MODE=true` на backend) показаны кнопки
демо-учёток — они подсказывают логин/пароль, но вход всё равно идёт через
форму Keycloak (кнопка просто подставляет данные, которые нужно скопировать
туда):

| Логин | Пароль | Роль |
|---|---|---|
| `superchel` | `vobla123` | администратор |
| `miniboss` | `kurkuma2017` | руководитель |
| `microbro1`, `microbro2` | `bananchik` | менеджеры (КАМ) |

При переключении между ролями через демо-кнопки Keycloak может оставить
активную SSO-сессию прежнего пользователя и тихо залогинить под старой
учёткой. Если это происходит, перед следующим входом сначала разлогиньтесь:

```js
await fetch('/auth/logout', { method: 'POST' })
```

и затем откройте `http://127.0.0.1:8081/realms/demo/protocol/openid-connect/logout`
(порт Keycloak из `backend/docker-compose.yml`) — после этого `/login` отдаёт
чистую форму.

## Прод сборка

```bash
cd frontend/app
npm run build   # tsc -b && vite build -> frontend/app/dist
npm run preview
```

## Проверка типов и линт

```bash
cd frontend/app
npx tsc -p tsconfig.app.json --noEmit
npm run lint
```

## Docker-образ

Отдельный образ только для фронтенда — собирает `app/` через Vite и отдаёт
результат через nginx с проксированием `/api` и `/auth` на backend. Не трогает
`backend/Dockerfile` и `backend/docker-compose.yml`, живёт независимо в
[`docker/`](./docker).

Собрать (контекст сборки — папка `frontend/`, не `frontend/app`, потому что
`nginx.conf.template` лежит в `frontend/docker/`):

```bash
docker build -f frontend/docker/Dockerfile -t quoll-frontend:latest frontend
```

Запустить рядом с уже поднятым backend (`backend/docker-compose.yml`, сеть
по умолчанию `backend_default`):

```bash
docker run --rm -p 8080:80 --network backend_default quoll-frontend:latest
```

`BACKEND_ORIGIN` по умолчанию `http://quoll:8000` — это сервис из
`backend/docker-compose.yml`. Если backend запущен прямо на хосте
(`uvicorn ... --host 0.0.0.0`, иначе из контейнера он недоступен):

```bash
docker run --rm -p 8080:80 \
  --add-host=host.docker.internal:host-gateway \
  -e BACKEND_ORIGIN=http://host.docker.internal:8000 \
  quoll-frontend:latest
```

Хост из `BACKEND_ORIGIN` должен резолвиться при старте контейнера, иначе nginx
не запустится (`host not found in upstream`). Значение подставляется в
nginx-конфиг через `envsubst` при старте (см. `docker/nginx.conf.template`).
Открыть `http://127.0.0.1:8080`.
