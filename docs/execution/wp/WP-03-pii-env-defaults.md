# WP-03 — ПДн из `lib/env.ts`/`.env.example` → плейсхолдеры + полнота env-примера + тест

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 0.12 | W1 | 0,5–1 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Убрать реальные ФИО, адрес, телефон и почту оператора ПДн из исходников и примера env; дополнить пример недостающими переменными.

## Входы (что должно быть выполнено до старта)
- Р9 — владелец выставляет реальные значения в Vercel env до слияния (страницы `app/legal/*`, `app/support` читают `legalOperator()`)

## Allowlist файлов (правишь только это)
- `.env.example`
- `lib/env.ts`
- новый `tests/release/legal-operator-env.test.ts`
- `docs/audits/wp/WP-03_EVIDENCE.md`

## Запрещено
- `supabase/config.toml` (H16, пинится тестами)
- остальные хотспоты

## Шаги
1. `.env.example:63-69` и `NEXT_PUBLIC_SUPPORT_EMAIL`, `APPLE_TEAM_ID` → нейтральные плейсхолдеры вида `<...>`; убрать комментарии с личной почтой.
2. `lib/env.ts:16,30-33`: `supportEmail()` и `legalOperator()` без личных дефолтов; при `NODE_ENV=production` и пустом env — `console.warn` и нейтральный плейсхолдер.
3. Добавить в `.env.example`: `REMHAOS_M4_V2_V3_ENABLED`, `REMHAOS_GOOGLE_DRIVE_REVOKE_ENABLED`, `RELEASE_WORKER_MAX_ROWS`, `IMPACT_WORKER_MAX_ROWS`, `INGEST_WORKER_MAX_ROWS`, `TELEGRAM_{PROJECTION,NOTIFICATION,EXTRACTION}_MAX_ROWS`, `AP1_ROTATE_EXISTING_PASSWORD`, `NEXT_DIST_DIR` с комментариями.
4. Тест: в `lib/env.ts` и `.env.example` нет телефона (`\+\d{9,}`), физического адреса, личной почты (`gmail.com`).

## Гейты
- полный CI

## Критерий приёмки
- `rg -n '\+62|gmail\.com' lib .env.example` → 0
- тест зелёный
- страницы юрблока рендерят env-значения (проверка на dev-сервере в evidence)

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-03-pii-env-defaults` от свежего `origin/main`; один PR `WP-03: ПДн из `lib/env.ts`/`.env.example` → плейсхолдеры + полнота env-примера + тест`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-03_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-03: <статус> | PR #N | HEAD <sha> | blockers: …`.
