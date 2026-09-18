#!/usr/bin/env bash
# Копирует файлы Keycloak на сервер и запускает установку. Запускать с машины,
# у которой есть вход по SSH на сервер:
#   bash deploy/keycloak/push-remote.sh root@13.143.181.167 2222
set -euo pipefail
HOST="${1:?root@адрес}"; PORT="${2:-22}"
IP="${HOST#*@}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ssh -p "$PORT" "$HOST" 'mkdir -p /root/keycloak-setup'
scp -P "$PORT" "$HERE/realm-hackathon.json" "$HERE/docker-compose.remote.yml" "$HERE/install-remote.sh" "$HOST:/root/keycloak-setup/"
ssh -p "$PORT" "$HOST" "bash /root/keycloak-setup/install-remote.sh http://$IP:8080 ${KEYCLOAK_ADMIN_PASSWORD:-admin}"
