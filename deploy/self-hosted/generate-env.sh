#!/bin/sh
# Создаёт .env со случайными секретами и ключами API.
#   sh generate-env.sh <домен API> <адрес сайта>
#   пример: sh generate-env.sh api.remhaos.com https://www.remhaos.com
# Ключи ANON_KEY и SERVICE_ROLE_KEY подписаны JWT_SECRET и действуют 10 лет.
# .env содержит секреты: не коммитить, хранить копию в менеджере паролей.
set -eu
API_DOMAIN=${1:?укажите домен API, например api.remhaos.com}
SITE=${2:?укажите адрес сайта, например https://www.remhaos.com}
[ -e .env ] && { echo ".env уже есть — не перезаписываю"; exit 1; }

rand() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-"$1"; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() {
  iat=$(date +%s); exp=$((iat + 10 * 365 * 24 * 3600))
  h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$iat" "$exp" | b64url)
  s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$h" "$p" "$s"
}

JWT_SECRET=$(rand 48)
CORS=$(printf '%s' "$SITE" | sed 's/[.]/\\./g')
umask 077
cat > .env <<ENV
# Создано generate-env.sh $(date -u +%Y-%m-%d). СЕКРЕТЫ — не коммитить.
API_SITE_ADDRESS=$API_DOMAIN
API_EXTERNAL_URL=https://$API_DOMAIN
SITE_URL=$SITE
ADDITIONAL_REDIRECT_URLS=$SITE/**
CORS_ALLOWED_ORIGINS=$CORS

POSTGRES_PASSWORD=$(rand 40)
JWT_SECRET=$JWT_SECRET
ANON_KEY=$(jwt anon)
SERVICE_ROLE_KEY=$(jwt service_role)

# Почта (обязательно для регистрации): данные SMTP вашего почтового сервиса.
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_ADMIN_EMAIL=

# Вход через Google (необязательно).
GOOGLE_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_SECRET=

# Проверка паролей по базе утечек (нужен доступ сервера к api.pwnedpasswords.com).
PASSWORD_HIBP_ENABLED=true

BACKUP_HOUR_UTC=0
BACKUP_RETENTION_DAYS=14
ENV
echo "Готово: .env создан. Заполните SMTP_* (и GOOGLE_*, если нужен вход через Google)."
