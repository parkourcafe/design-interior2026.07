# WP-42B — региональная маршрутизация Auth и public intake

## Цель

Продолжить принятый WP-42: до регистрации или создания самостоятельного
брифа пользователь явно выбирает `ru` либо `international`. Выбор создаёт
короткоживущий подписанный receipt без сырых ПДн. Auth и public-intake операции
берут cell только из receipt либо из непрозрачного cell-prefixed токена ссылки.

## Основание

- ADR-0008, разделы «Решение», «Поэтапное внедрение» и «Инварианты»;
- решение владельца от 11.09.2026: WP-42B, additive migration/RLS, локальные
  DB4/DB5/AP5, security review, commit/push/new PR; без shared DB, real
  credentials, paid cloud, merge и production.

## Allowlist

- `.env.example`;
- `app/api/auth/register/route.ts`, `app/api/auth/market-binding/route.ts`,
  `app/api/client/create/route.ts`, `app/api/intake/{start,submit,upload}/route.ts`,
  `app/api/market/select/route.ts`, `app/auth/callback/route.ts`,
  `app/b/[token]/page.tsx`, `app/login/page.tsx`, `app/start-client-brief.tsx`;
- `lib/intake.ts`, `lib/i18n/ru.ts`, `lib/market/{bind,receipt}.ts`,
  `lib/supabase/{cells,regional,regional-admin}.ts`;
- `supabase/migrations/20260911100000_remhaos_market_routing_receipts.sql`;
- `tests/market/**`, `tests/db4/61_market_routing_receipts.sql`, DB4/DB5
  runners, migration ledger and Layout Studio migration inventory;
- эта карточка и `docs/audits/wp/WP-42B_EVIDENCE.md`.

## Слот и конфликты

PR #145 остаётся draft и держит `20260911090000` / DB4-60. WP-42B назначен
после него: S-MIG #8, timestamp `20260911100000`, DB4-61. При rebase после
возможного другого timestamp owner-ветки timestamp сверяется заново; применённая
миграция не переименовывается.

## Инварианты

- market `international` всегда соответствует физической cell `us`;
- отсутствующая конфигурация выбранной cell блокирует Auth/public-intake до
  сетевого вызова;
- cookies Auth разделены по cell; routing receipt HTTP-only, signed, expires in
  one hour and stores only declaration/categories/reason/nonce;
- authenticated receipt фиксируется request-bound RPC; таблица не доступна
  напрямую никакой публичной роли;
- existing links without a prefix are legacy RU links. New links use `ru.` or
  `us.` prefix with an opaque token, so cell is known before public DB lookup;
- этот пакет не создаёт cell, не переносит данные, не включает international AI,
  не применяет migration к shared DB и не меняет production.

## Definition of done

Локально: targeted contracts, migration ledger inventory, DB4/DB5 на PG16+17,
`release:check`, AP5 если доступна disposable Auth configuration, security
review exact SHA. PR остаётся draft до завершения required hosted gates; merge
и production требуют отдельного owner gate.
