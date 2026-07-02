# PHASE 0 — Скелет. Отчёт

## Что сделано

- **Next.js 14 (App Router) + TypeScript strict + Tailwind + ESLint + Vitest.** Проект собирается, линтуется, типизируется и тестируется (все зелёные).
- **Два Supabase-клиента:** `lib/supabase/browser.ts` (anon, браузер), `lib/supabase/server.ts` (anon, привязан к cookie сессии, RLS). Плюс `lib/supabase/admin.ts` — service-role, только для публичных server routes.
- **SQL-миграция полной схемы** `supabase/migrations/0001_init.sql`: `designers · projects · answers · risk_cards · proposals · events`, все чек-констрейнты статусов/enum, индексы, **RLS-политики** (дизайнер видит только свои проекты; публичный доступ — через service role по токену), bucket `client-uploads`.
- **Auth по magic link:** страница входа `/login`, callback `/auth/callback`, middleware защищает `/dashboard` и обновляет сессию. Layout кабинета дизайнера с шапкой и выходом.
- **Seed-скрипт** `scripts/seed.ts`: демо-дизайнер `demo@studio.ru` с заполненными `pricing` и `proposal_defaults` (идемпотентно).
- **Healthcheck** `GET /api/health` — сообщает, какие подсистемы сконфигурированы (без сетевых вызовов).
- **i18n:** `lib/i18n/ru.ts` — единственный источник строк UI. Весь интерфейс читает строки оттуда (подготовка к EN, саму EN не делаем).
- **LLM-провайдер за интерфейсом** `lib/llm/provider.ts` (`completeJSON(prompt, schema)`): реализация YandexGPT (`lib/llm/yandex.ts`) + заглушка GigaChat (`lib/llm/gigachat.ts`). Внутри — извлечение JSON, Zod-валидация, один repair-retry, деградация.

## Выбор LLM-модели и эндпоинта (сверено с документацией в фазе 0)

- Эндпоинт: `POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion`.
- `modelUri`: `gpt://<YC_FOLDER_ID>/<LLM_MODEL>/latest` (по умолчанию `yandexgpt-lite`; на 2025 ветка `/latest` — поколение 5).
- Авторизация: заголовок `Authorization: Api-Key <YC_API_KEY>` + `x-folder-id`.
- Зафиксировано в комментарии в `lib/llm/yandex.ts` со ссылками на офиц. документацию Yandex Cloud.

## Как проверить руками за 5 минут

1. `npm install` (уже выполнено).
2. Проверки: `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build` — всё зелёное.
3. Заполните `.env.local` реальными значениями Supabase + Yandex Cloud (шаблон — `.env.example`).
4. Примените миграцию `supabase/migrations/0001_init.sql` к своему проекту Supabase (SQL Editor или Supabase MCP `apply_migration`).
5. `npm run seed` — создаст демо-дизайнера.
6. `npm run dev`, откройте `/` → `/login`, войдите magic-link'ом на `demo@studio.ru` → попадёте в `/dashboard`.
7. `GET /api/health` вернёт `{ status: "ok", env: {...} }`.

## Известные ограничения

- **Env в среде разработки — плейсхолдеры.** Реальных ключей Supabase/Yandex у агента нет, поэтому вживую против БД/LLM здесь не проверялось; build/lint/typecheck/test это не требуют (тесты без сети). Для запуска нужны реальные ключи.
- GigaChat — осознанная заглушка (mTLS/OAuth-обмен вынесен в BACKLOG); основной путь — YandexGPT.
- Edge-runtime warning от `@supabase/ssr` в middleware (`process.version`) — известный безвредный, сборка проходит.

## Вопросы

- Нужны значения env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `YC_FOLDER_ID`, `YC_API_KEY`. `LLM_PROVIDER=yandex`, `LLM_MODEL=yandexgpt-lite` — по умолчанию, поменять при необходимости.
- Подтвердить `NEXT_PUBLIC_APP_URL` для продакшена (Vercel) — от него строятся публичные ссылки intake/КП.
