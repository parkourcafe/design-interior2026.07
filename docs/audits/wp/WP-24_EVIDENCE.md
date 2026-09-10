# WP-24 — Адаптер читает legacy-паспорт и договор request-bound под RLS — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-24-m1-adapter-reads-legacy-passport`. HEAD: `e9d22aa` (merge with current `main`). PR: [#140](https://github.com/parkourcafe/design-interior2026.07/pull/140) (draft). Сессия: Codex repository-only.

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-24-m1-adapter-reads-legacy-passport.md` требует проекцию последней `project_passport_revisions` и статуса `contract_documents` через request-bound read path, с UI и DB4-покрытием.

## Allowlist по факту

[ИЗВЛЕЧЕНО] Изменения ограничены расширенным allowlist WP-24: additive migration `20260910090000` (S-MIG #6), DB4-59/DB5 harness invocation, migration ledger, strict adapter/parser, live port, M1 DTO/UI/copy, integration test и этот evidence.

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

Статус пакета: `IMPLEMENTED_CI_GREEN_PR_OPEN`.

## Решение владельца по ролям

[ПОДТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ, 2026-09-10] Новый read-only RPC может обслуживать
только роли `owner_lead` и `architect`, и только при active membership
конкретного пользователя в конкретном проекте и прохождении всех scope-проверок.
Остальные роли запрещены. Последующим owner-сообщением разрешены additive
migration/RLS/security реализация в repository-only/disposable scope,
commit/push и открытие PR. Merge и shared staging/production остаются закрыты.

[СВЕРЕНО С УТВЕРЖДЁННЫМ КОНТРАКТОМ, 2026-09-10] Основание доступа —
`docs/product-intelligence/wave-3/FOUNDATION_CONTRACT_FREEZE.md:61-96`:
active Organization membership + active exact ProjectMembership + capability.
Для чтения используется capability `view_project`, которую матрица даёт
Owner/lead и Architect/designer/PM. Техническая реализация должна вызывать
канонический `_authorize_project_human(project_id, 'view_project')`, а затем
ограничить effective role до `owner_lead|architect`; это также проверяет
активную RU Organization и устраняет ручное дублирование authorizer.

[СВЕРЕНО С АРХИТЕКТУРОЙ, 2026-09-10] `architecture-v1.md:210-222`,
`wave-3/integration/REQUEST_BOUND_CONTRACT.md:5-12` и
`wave-4/ap1/READ_CONTRACTS_REPORT.md:52-67` требуют server-derived actor/
organization/project/role, project-scoped reads, fixed `search_path`, minimal
grants, private-table isolation и отсутствие service-role path. Proposed RPC
соответствует этим требованиям после вызова канонического authorizer.

[СВЕРЕНО С ГЕНЕРАЛЬНЫМ ТЗ, 2026-09-10] `docs/execution/wp/WP-24-m1-adapter-
reads-legacy-passport.md:9-32` определяет read-only результат как последнюю
`project_passport_revisions` и статус `contract_documents`, с designer-facing
критерием и DB4 56 isolation. `FOUNDATION_CONTRACT_FREEZE.md:61-96` и
`projectceo_foundation._role_capabilities` дают `view_project` owner/lead и
architect; поэтому owner-approved role set не противоречит capability matrix.

[НЕСОВПАДЕНИЕ ОБЪЁМА, НЕ НОВОЕ РЕШЕНИЕ] Карточка WP-24 в строке 5 говорит
`S-UI ... Миграция: нет`, а в строке 10 требует чтение private passport через
RLS. Для варианта 2 существующего прямого доступа недостаточно: новый
request-bound RPC неизбежно требует additive migration. Owner согласовал S-MIG
#6 и разрешил реализацию SQL/RLS/security в repository-only/disposable scope;
это не меняет роли или утверждённую архитектуру. Merge и shared
staging/production по-прежнему требуют отдельного owner gate.

## Независимый security review

[PASS С ОГРАНИЧЕНИЕМ, 2026-09-10] Независимая проверка реализованного RPC по frozen
документам подтверждает:

- `FOUNDATION_CONTRACT_FREEZE.md:61-96`: `view_project` есть у Owner/lead и
  Architect; доступ требует active Organization membership, active exact
  ProjectMembership и capability;
- `projectceo_foundation._authorize_project_human` в
  `supabase/migrations/20260717090000_projectceo_foundation_access.sql:760-827`
  является канонической реализацией этих проверок, включая active RU
  Organization и server-derived `auth.uid()`;
- `architecture-v1.md:210-222`, `REQUEST_BOUND_CONTRACT.md:5-12` и
  `READ_CONTRACTS_REPORT.md:52-67` требуют server-derived scope, project-
  scoped reads, fixed `search_path`, minimal grants, private-table isolation и
  отсутствие service-role path;
- реализованный RPC соблюдает эти требования после вызова канонического authorizer,
  явного deny ролей вне `owner_lead|architect`, exact-project filters,
  `SECURITY DEFINER`, `search_path=''`, authenticated-only execute и DTO без
  Storage metadata.

Реализация прошла независимый diff/security review после локального SQL-прогона и обязательного CI; shared staging/production не использовались.

## Пины

Пинов нет.

## Миграция

Добавлена `20260910090000_projectceo_m1_legacy_read_contract.sql` (S-MIG #6): request-bound `projectceo_read_api.get_m1_legacy_project_read(uuid)`, canonical authorizer + owner_lead/architect role gate, sanitized passport/contract DTO, SECURITY DEFINER `search_path=''`, authenticated-only execute, narrow internal `pi_table_owner` grant/policy. Existing migrations remain unchanged.

## Локальные гейты

[PASS] `npm run typecheck`; `npm run lint` (13 pre-existing warnings, 0 errors); `npm run test` (201 files, 1603 passed, 10 skipped); `npm run build`; `git diff --check`.
[PASS] DB4 PostgreSQL 16 and 17: `DB4_M1_LEGACY_READ_RPC_OK`, `DB4_PRODUCT_BRAIN_HARNESS_OK`.
[PASS] DB5 PostgreSQL 16 and 17: `DB5_EXECUTION_HARNESS_OK`, `DB5_DEFAULT_DENY_AFTER_OK`.

## Не сделано / требуется от владельца

[ИЗВЛЕЧЕНО] Owner разрешил additive migration/RLS/security implementation,
commit/push/new PR. Очередь согласована: WP-24 S-MIG #6; replay follow-up WP-21
остаётся отдельным пакетом и получает S-MIG #7 при запуске. PR #140 открыт в
draft; merge и shared staging/production остаются owner gates.

## Blind review

PASS: Codex Security diff scan `807ca1dc-5621-496d-8250-e29e6a8e8f5c` на
диапазоне `1e132cb..414829d` завершён; reportable findings: 0. Два кандидата
deferred только для hosted privilege/serialization проверки, shared
staging/production остаются owner-gated. CI run `34424739437` завершён
успешно: lint/typecheck/test/build, AP5, DB4 PG16/17 и DB5 PG16/17.

## Безопасность

[ИЗВЛЕЧЕНО] Production/shared DB/credentials не использовались; миграция применялась только в disposable PostgreSQL 16/17 harness. Секретов в diff нет.
