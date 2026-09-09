# WP-24 — Адаптер читает legacy-паспорт и договор request-bound под RLS — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-24-m1-adapter-reads-legacy-passport`. HEAD: `18a50a3`. PR: #139 (draft). Сессия: Codex repository-only.

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-24-m1-adapter-reads-legacy-passport.md` требует проекцию последней `project_passport_revisions` и статуса `contract_documents` через request-bound read path, с UI и DB4-покрытием.

## Allowlist по факту

[ИЗВЛЕЧЕНО] До остановки изменён только allowlisted файл evidence: `docs/audits/wp/WP-24_EVIDENCE.md`. Код и SQL не изменялись.

## Хотспот и точный blocker

[ИЗВЛЕЧЕНО] Grep-first на `main` (`c91c5b3`):

```text
ABSENT components/projectceo/m1-passport-panel.tsx
PRESENT components/projectceo/m1-project-panel.tsx
app/api/dashboard/contracts/route.ts:72: .from("contract_documents")
app/api/dashboard/contracts/route.ts:113: .from("contract_documents")
```

[ИЗВЛЕЧЕНО] В `app/`, `components/` и `lib/` отсутствуют ссылки на `project_passport_revisions`; текущий ProjectCEO read path (`ProjectCeoLiveReadPort` → `ProjectCeoAuthenticatedReadPostgresAdapter`) публикует Project Intelligence projection и M1 facts/approval requests, но не legacy passport/contract projection.

[ИЗВЛЕЧЕНО] Миграция `20260829074543_secure_m1_passport_and_contract_rls.sql` отзывает Data API-доступ к `project_passport_revisions`, включая `authenticated` и `service_role`; таблица доступна только внутренней роли `pi_table_owner` через защищённый trigger. `contract_documents` имеет request-bound owner policy, но существующий маршрут предоставляет только upload/status mutations.

[ИНТЕРПРЕТИРОВАНО] Для выполнения критерия WP-24 нужен новый серверный read-контракт/adapter и явно разрешённый способ проекции внутренней паспортной таблицы, а также подключение результата к `ProjectWorkspaceView`/UI. Это затрагивает файлы вне карточки allowlist и требует решения по RLS/security boundary. Без такого решения безопасный runtime нельзя выдумывать.

Статус пакета: `BLOCKED_HOTSPOT`.

## Пины

Пинов нет.

## Миграция

Новая миграция не создавалась. Существующая RLS-политика не изменялась.

## Локальные гейты

[ИЗВЛЕЧЕНО] Код не менялся; `npm ci` и `release:check` для no-op не запускались.

## Не сделано / требуется от владельца

[ИНТЕРПРЕТИРОВАНО] Нужен owner decision, который назовёт допустимый request-bound read contract для legacy passport (включая внутренний `project_passport_revisions`) и расширит allowlist конкретными файлами. До этого WP-24 закрывать нельзя; production/shared DB не использовались.

## Blind review

Не применимо: рабочий diff отсутствует.

## Безопасность

[ИЗВЛЕЧЕНО] Production, shared DB, credentials и новые миграции не использовались. Секретов в evidence нет.
