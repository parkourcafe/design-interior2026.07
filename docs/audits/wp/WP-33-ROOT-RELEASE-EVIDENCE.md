# WP-33 root request-bound release — EVIDENCE

## Основание
[ИЗВЛЕЧЕНО] Разрешение владельца: additive migration `20260911150000_projectceo_publish_release_request_bound.sql`, SECURITY DEFINER RPC `projectceo_product_api.publish_release_request_bound(uuid,text,text,bigint,text,text)`, EXECUTE только для `authenticated`, авторизация существующей `_authorize_package_human(project_id, derived_root_package_id, 'publish_release')`.

## Allowlist по факту
[ИЗВЛЕЧЕНО] Миграция, ledger, DB4 security/fixture, M3 disposable enable fixture, Postgres adapter, adapter/migration contract tests, Layout Studio `preExisting` и этот evidence-файл.

## Миграция
| timestamp | ledger | DB4/DB5 | S-MIG |
|---|---|---|---|
| `20260911150000` | SHA-256 в `tests/ap1/environment/migration-ledger.sha256` | DB4 root-release scenario; DB5 full harness | #6 |

## Локальные гейты
[ИЗВЛЕЧЕНО] `npm ci` с изолированным cache `/private/tmp/wp33-root-release-npm-cache` завершён успешно. `npm run release:check` завершён успешно: lint — 0 errors, 13 существующих warnings; typecheck; 1 646 passed / 10 skipped Vitest; Next build.

[ИЗВЛЕЧЕНО] Targeted adapter/migration/ledger/Layout Studio tests: 25 passed. DB4 PostgreSQL 16 был запущен дважды, включая разрешённый disposable Docker запуск, но Docker socket вернул `permission denied`; DB4 PG16/17 и DB5 PG16/17 — `BLOCKED_EXTERNAL`, shared DB не использовалась.

## CI
[ИЗВЛЕЧЕНО] Hosted CI, AP5 и DB4/DB5 остаются обязательными для draft PR и на момент локального evidence ещё не запускались.

## Безопасность
[ИЗВЛЕЧЕНО] Root package, baseline, previous version, exact revision refs и semantic hash выводятся в PostgreSQL. Клиент не передаёт эти поля. Raw release RPC не отзывается этим пакетом; финальный M3 flip остаётся в WP-33.

## Не сделано
[ИЗВЛЕЧЕНО] Shared DB, production, deploy, flags и merge не выполнялись.
