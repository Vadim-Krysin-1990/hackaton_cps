#!/usr/bin/env bash
# Ставит Docker (если нет) и поднимает Keycloak с готовым realm на этом сервере.
# Запускать НА сервере Keycloak от root:
#   bash install-remote.sh http://13.143.181.167:8080 [пароль_admin]
set -euo pipefail
PUBLIC_URL="${1:?укажите публичный адрес, например http://13.143.181.167:8080}"
ADMIN_PASSWORD="${2:-admin}"
DIR=/opt/keycloak

if ! command -v docker >/dev/null 2>&1; then
  echo "[1/4] Docker не найден, ставлю"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "нужен docker compose v2"; exit 1; }

echo "[2/4] Файлы в $DIR"
mkdir -p "$DIR"
cp "$(dirname "$0")/realm-hackathon.json" "$(dirname "$0")/docker-compose.remote.yml" "$DIR/"
cat > "$DIR/.env" <<ENV
KEYCLOAK_PUBLIC_URL=$PUBLIC_URL
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV

echo "[3/4] Порт 8080 в файрволе"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 8080/tcp >/dev/null
fi

echo "[4/4] Запуск"
cd "$DIR" && docker compose -f docker-compose.remote.yml up -d
for i in $(seq 1 60); do
  if curl -fs "$PUBLIC_URL/realms/hackathon/.well-known/openid-configuration" >/dev/null 2>&1; then
    # админка realm master по HTTP с внешнего адреса закрыта по умолчанию («HTTPS required»);
    # для стенда снимаем требование, для боевого контура ставится TLS и режим start
    docker compose -f docker-compose.remote.yml exec -T keycloak /opt/keycloak/bin/kcadm.sh config credentials \
      --server http://localhost:8080 --realm master --user admin --password "$ADMIN_PASSWORD" >/dev/null 2>&1 \
      && docker compose -f docker-compose.remote.yml exec -T keycloak /opt/keycloak/bin/kcadm.sh update realms/master -s sslRequired=NONE \
      && echo "realm master: HTTPS не требуется (стенд)"
    echo "Keycloak готов: $PUBLIC_URL/realms/hackathon"
    echo "Админка: $PUBLIC_URL (admin / $ADMIN_PASSWORD). Пользователи realm: ruk, exp, ana, пароль demo2026"
    exit 0
  fi
  sleep 3
done
echo "Keycloak не ответил за 3 минуты, смотрите: docker compose -f $DIR/docker-compose.remote.yml logs"
exit 1
