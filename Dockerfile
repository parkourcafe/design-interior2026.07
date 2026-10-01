# Сайт RemHaOS для своего сервера (deploy/self-hosted, сервис web).
# NEXT_PUBLIC_* встраиваются в сайт при сборке, поэтому передаются как
# build-args; секреты сервера (service role и т.п.) — только при запуске.
#
# MEDIA_MODE=local (по умолчанию): медиа лендинга скачиваются при сборке и
# отдаются самим сайтом — браузер посетителя не ходит на зарубежный CDN.
# Если скачать не удалось, сборка останавливается. MEDIA_MODE=cdn — медиа
# с CDN (только для проверки без доступа к нему).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_LEGAL_OPERATOR_NAME
ARG NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS
ARG NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL
ARG NEXT_PUBLIC_LEGAL_OPERATOR_PHONE
ARG NEXT_PUBLIC_LEGAL_OPERATOR_INN
ARG NEXT_PUBLIC_LEGAL_OPERATOR_OGRNIP
ARG NEXT_PUBLIC_LEGAL_OPERATOR_REGISTRATION_AUTHORITY
ARG NEXT_PUBLIC_LEGAL_OPERATOR_REGISTRATION_DATE
ARG MEDIA_MODE=local
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_PUBLIC_LEGAL_OPERATOR_NAME=$NEXT_PUBLIC_LEGAL_OPERATOR_NAME \
    NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS=$NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS \
    NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL=$NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL \
    NEXT_PUBLIC_LEGAL_OPERATOR_PHONE=$NEXT_PUBLIC_LEGAL_OPERATOR_PHONE \
    NEXT_PUBLIC_LEGAL_OPERATOR_INN=$NEXT_PUBLIC_LEGAL_OPERATOR_INN \
    NEXT_PUBLIC_LEGAL_OPERATOR_OGRNIP=$NEXT_PUBLIC_LEGAL_OPERATOR_OGRNIP \
    NEXT_PUBLIC_LEGAL_OPERATOR_REGISTRATION_AUTHORITY=$NEXT_PUBLIC_LEGAL_OPERATOR_REGISTRATION_AUTHORITY \
    NEXT_PUBLIC_LEGAL_OPERATOR_REGISTRATION_DATE=$NEXT_PUBLIC_LEGAL_OPERATOR_REGISTRATION_DATE \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN if [ "$MEDIA_MODE" = "local" ]; then \
      node scripts/fetch-landing-media.mjs && \
      echo "NEXT_PUBLIC_MEDIA_BASE=/landing" > .env.production.local; \
    elif [ "$MEDIA_MODE" != "cdn" ]; then \
      echo "MEDIA_MODE: local или cdn" >&2; exit 1; \
    fi
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
ARG APP_COMMIT=unknown
ENV APP_COMMIT=$APP_COMMIT
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
