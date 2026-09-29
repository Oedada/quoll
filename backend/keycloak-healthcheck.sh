#!/bin/bash
# Проверка готовности Keycloak: реалм отдаёт конфиг (OIDC well-known).
# В образе нет curl, поэтому голый TCP: printf делает CRLF, head читает
# первую строку ответа, grep проверяет статус 200.
set -u
host="${1:-127.0.0.1}"
port="${2:-8080}"
realm="${3:-demo}"

timeout 10 bash -c '
  host="$1"; port="$2"; realm="$3"
  exec 3<>"/dev/tcp/${host}/${port}"
  printf "GET /realms/%s/.well-known/openid-configuration HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n" "$realm" >&3
  timeout 5 head -n 1 <&3
  exec 3>&-
' _ "$host" "$port" "$realm" | grep -q " 200 "
