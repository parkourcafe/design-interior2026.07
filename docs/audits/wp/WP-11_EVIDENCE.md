# WP-11 — Snapshot-tooling v2 — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-11-snapshot-tooling-v2`. База: `main@ef3c18c`. Implementation HEAD: `813758c`. PR: `#142`.

## Основание

[ИЗВЛЕЧЕНО] WP-11 / трек 1.2 требует read-only SQL по всем несистемным схемам,
детерминированный fingerprint, генератор дрейфа против снимка 19.07 и шаблоны
для owner-operated production snapshot.

[ИЗВЛЕЧЕНО] Действующий режим — `repository_only`. Разрешены локальные и
disposable проверки, commit/push и PR. Production, shared DB, credentials,
deploy и применение изменений не разрешены.

## Allowlist по факту

```text
docs/product-intelligence/agent-runs/db-wave/PRODUCTION_READONLY_AUDIT_v2.sql
scripts/ops/fingerprint-from-snapshot.mjs
tests/release/fingerprint-from-snapshot.test.ts
docs/product-intelligence/wave-3/production-adoption/PRODUCTION_SNAPSHOT_2026-09-xx.md
docs/product-intelligence/wave-3/production-adoption/PRODUCTION_READ_ONLY_FINGERPRINT_2026-09-xx.md
docs/audits/wp/WP-11_EVIDENCE.md
```

[ИНТЕРПРЕТИРОВАНО] Карточка явно требует unit-тест на фикстуре; тест размещён
в существующем `tests/release` и не расширяет runtime scope.

## Хотспоты и миграции

[ИЗВЛЕЧЕНО] H1–H18 не изменялись. Миграций нет. Existing timestamped
migrations, ledger, CI workflow и production configuration не изменялись.

## Реализация

[ИЗВЛЕЧЕНО] SQL v2 состоит из одного `WITH ... SELECT`, динамически включает
все несистемные схемы и исключает `pg_catalog`, `information_schema`, временные
и TOAST-схемы. Он читает каталоги PostgreSQL и migration ledger; application
rows, Auth identities и Storage objects не читает. Текст statements ledger не
выдаётся: в snapshot попадает только MD5 нормализованного JSON-поля statements.

[ИЗВЛЕЧЕНО] Локальный генератор принимает raw JSON и one-row Supabase export,
проверяет контракт `remhaos-production-catalog/2.0`, сортирует ключи и строки
категорий, считает count/MD5 и общий SHA-256. Capture time, database и server
version не влияют на fingerprint.

[ИЗВЛЕЧЕНО] Drift CSV содержит только изменившиеся, исчезнувшие или новые
категории. Генератор не перезаписывает существующий conflict register сам.

## Локальные гейты

[ИЗВЛЕЧЕНО] `npx vitest run tests/release/fingerprint-from-snapshot.test.ts`:
5 tests passed.

[ИЗВЛЕЧЕНО] `npm run typecheck`: exit 0. `npm run lint -- --quiet`: exit 0.

[ИЗВЛЕЧЕНО] SQL v2 выполнен на одноразовых PostgreSQL 16.15 и 17.11 после
создания синтетических `private`, `storage`, `market_harvest` и migration
ledger объектов. Оба запуска вернули snapshot contract v2 без SQL-ошибок.
Контейнеры остановлены и удалены.

[ИЗВЛЕЧЕНО] Полный `npm run release:check`: exit 0; lint — 0 errors и 13
существующих warnings; typecheck — pass; 202 test files, 1611 passed и 10
skipped; production build — pass.

## CI и review

[ИЗВЛЕЧЕНО] PR CI: `PENDING`. Независимое review: `PENDING`.

## Не сделано / owner gate

[ИНТЕРПРЕТИРОВАНО] Реальный production snapshot не снимался. После принятия
repository tooling владелец запускает готовый SQL в Supabase Dashboard,
скачивает единственный JSON-result и передаёт его для fingerprint/reconciliation.
Это отдельный read-only owner action; production adoption остаётся `NO_GO`.

## Безопасность

[ИЗВЛЕЧЕНО] Production, shared DB, Vercel, Railway, credentials, flags и CI
settings не использовались. Секреты и production project ref в diff не добавлены.
