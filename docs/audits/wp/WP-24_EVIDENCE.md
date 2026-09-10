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

Статус пакета: `BLOCKED_OWNER_GATE`.

## Решение владельца по ролям

[ПОДТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ, 2026-09-10] Новый read-only RPC может обслуживать
только роли `owner_lead` и `architect`, и только при active membership
конкретного пользователя в конкретном проекте и прохождении всех scope-проверок.
Остальные роли запрещены. Это решение не разрешает migration/RLS/security
реализацию, commit, push, merge или production.

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
request-bound RPC неизбежно требует additive migration. Это не меняет роли или
архитектуру, но требует отдельного уже оговорённого owner gate на migration
slot и реализацию; до него SQL/RLS/security не меняются.

## Независимый security review

[PASS С ОГРАНИЧЕНИЕМ, 2026-09-10] Повторная проверка proposed RPC по frozen
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
- proposed RPC соблюдает эти требования после вызова канонического authorizer,
  явного deny ролей вне `owner_lead|architect`, exact-project filters,
  `SECURITY DEFINER`, `search_path=''`, authenticated-only execute и DTO без
  Storage metadata.

Ограничение review: SQL/RLS ещё не реализованы и не прогонялись на DB4/DB5;
этот PASS относится к контракту и проекту границы, не к runtime evidence.

## Пины

Пинов нет.

## Миграция

Новая миграция не создавалась. Существующая RLS-политика не изменялась.

## Локальные гейты

[ИЗВЛЕЧЕНО] Код не менялся; `npm ci` и `release:check` для no-op не запускались.

## Не сделано / требуется от владельца

[ИНТЕРПРЕТИРОВАНО] Role decision и архитектурное основание получены. Остаются отдельные owner gates:
разрешение на additive migration/RLS/security реализацию. Очередь технически
согласована: WP-24 получает S-MIG #6; отложенный replay follow-up WP-21 остаётся
отдельным пакетом и получает следующий слот #7 при его запуске. До owner gate
SQL/RLS/security не меняются; production/shared DB не использовались.

## Blind review

Не применимо: рабочий diff отсутствует.

## Безопасность

[ИЗВЛЕЧЕНО] Production, shared DB, credentials и новые миграции не использовались. Секретов в evidence нет.
