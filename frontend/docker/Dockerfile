# syntax=docker/dockerfile:1
#
# Отдельный образ только для фронтенда (Vite SPA) - не трогает backend/Dockerfile
# и backend/docker-compose.yml. Контекст сборки - папка frontend/ (см. .dockerignore
# рядом с ней), а не app/, т.к. nginx.conf.template лежит в frontend/docker/:
#   docker build -f frontend/docker/Dockerfile -t quoll-frontend:latest frontend

FROM node:20-alpine AS build
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/. .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

# куда проксировать /api и /auth; по умолчанию - сервис quoll из
# backend/docker-compose.yml. Хост должен резолвиться на старте, иначе nginx
# не запустится. templates/*.template раскрывает envsubst базового образа.
ENV BACKEND_ORIGIN=http://quoll:8000

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
