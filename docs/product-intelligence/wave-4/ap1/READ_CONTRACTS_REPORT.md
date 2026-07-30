# AP1 · Authenticated read contracts

Дата проверки: 18 июля 2026 года.

## Вердикт

```text
READ_CONTRACT_STATIC_GATE=PASS
READ_CONTRACT_PG16=PASS
READ_CONTRACT_PG17=PASS
READ_MIGRATION_SHA256=f13fba09145de4960fc3b216664b060db37354d22e14216c6deb30d03b269837
PRODUCTION_READ=false
PRODUCTION_WRITES=false
PRODUCTION_APPLIED=false
```

Additive authenticated read surface и request-bound TypeScript adapter собраны.
Статические границы, sanitization, fail-closed UI projection и TypeScript прошли
локальную проверку. Exact immutable ledger и AP1 migration прошли на чистых
PostgreSQL 16 и 17: ACL/RLS negatives, пять request-bound role sessions,
idempotency, actor-bound replay, concurrency и replay после рестарта зелёные.
Миграция заморожена по указанному SHA-256 и передана environment gate для
materialization disposable Supabase. Production не читался и не изменялся.

## Новый контракт

Единственная новая exposed schema:

```text
projectceo_read_api.get_project_workspace_read(project_id, package_id)
contractVersion=project-ceo-authenticated-read/0.1
```

Функция получает только selectors. `actor`, `organization`, effective scope,
package scope и capabilities выводятся внутри PostgreSQL из `auth.uid()` и
принятых Foundation authorizers. Caller не может передать actor, organization,
role, recipient или state revision.

Контракт возвращает:

- sanitized project metadata, включая Kora 1 800 м² из `projects.passport`;
- exact package list и source inventory в пределах effective scope;
- review state, decisions, selections и exact evidence revisions;
- approval packages, latest baseline, package versions и release artifacts;
- aggregate distribution counts без recipient identity;
- только собственные distribution IDs пользователя (`recipient_user_id = auth.uid()`);
- список release recipients только актору с `distribute_release`;
- impact, photo, milestone и handover projection через принятый M4 delivery;
- source statistics по физическим записям, unique hashes, duplicate hash groups,
  semantic-conflict groups и review queue.

## Security boundary

- private schemas не exposed и не получили grants для runtime roles;
- `projectceo_read_api` имеет explicit `USAGE/EXECUTE` только для
  `authenticated`;
- `anon`, `service_role`, `pi_human_executor` и `pi_worker_executor` не могут
  вызывать read RPC;
- SECURITY DEFINER принадлежит `pi_table_owner`, `search_path=''`;
- protected filenames, Storage paths, signed URLs и absolute paths не входят в
  DTO;
- package-only actor не может запросить project-wide или sibling-package scope;
- пользователь без grants получает пустой portfolio и guest actor без
  capabilities, но не synthetic owner authority;
- recipient-unbound distribution IDs не попадают ни в новый контракт, ни в
  compatibility `projectceo_api.get_project_delivery`;
- application runtime не читает private relations напрямую.

## UI projection

`ProjectCeoLiveReadPort` переведён с нескольких неполных delivery reads на один
authenticated projection. UI получает фактические:

- Kora name/location/area;
- source revision и human review status;
- Decision/Selection evidence и revision history;
- recipient-bound acknowledgement target;
- release recipients для distributor;
- M4 impacts, milestone areas, photos и handover state.

Operation state формируется fail-closed. В частности, milestone acceptance не
предлагается при undecided/rejected photo evidence и появляется только когда
есть хотя бы одна фотография и все фотографии приняты человеком. Регистрация
фото дополнительно требует materialized image source exact revision в том же
execution package; UI не может выбрать source из sibling package.

## Compatibility

Публичный бренд остаётся ArchiDom. Существующие `projectceo_*` namespace не
переименованы. `projectceo_api.get_project_delivery(uuid, uuid)` получает
additive compatibility bridge и сохраняет frozen foundation envelope, но
distribution IDs теперь recipient-bound. Timestamped migrations до AP1 не
переписывались.

## Автоматические проверки

На текущем shared-tree snapshot:

- `npm run typecheck` — PASS;
- scoped ESLint для read adapter/live projection/tests — PASS, 0 warnings;
- AP1 adapter/static boundary + live sanitization + request-bound command bridge —
  `5 files / 24 tests` PASS;
- покрыты malformed projection, caller-field boundary, protected filename
  sanitization, recipient isolation, cross-organization and sibling-package
  fail-closed behavior, empty-grant guest, три milestone acceptance состояния и
  package-exact photo source selection.

Database harness выполнен дважды — на `postgres:16-alpine` и
`postgres:17-alpine`. В обоих прогонах PASS:

- последовательного применения immutable migration ledger;
- schema/function ACL и executor-role negatives;
- owner/architect/package-builder/cross-tenant sessions;
- decisions/selections/source/baseline/release/M4 shape;
- recipient-bound compatibility bridge;
- 24 параллельных reads;
- 8 конкурентных exact replays M4 submit change request;
- fresh-revision retry, changed-payload conflict и same-capability wrong-actor
  conflict для distribute/acknowledge и пяти M4 human operations;
- read-only invariants по domain state, command records и audit events;
- PostgreSQL restart и повторный exact replay.

Harness containers после прогонов удалены. Kora fixture counts
`209 / 81 / 128 / 28 unique / 18 duplicate groups / 8 conflict groups`
сохранены. Эти локальные PG16/PG17 доказательства не подменяют следующий
authenticated Supabase/browser gate.

## Следующий шаг

Environment agent materializes disposable Supabase строго по замороженному hash,
после чего root orchestrator проходит Kora invitation → sources → reviews →
baseline/release → distribution → change/impact → photo/acceptance → handover с
пятью реальными Auth/PostgREST сессиями. Production adoption остаётся отдельным
решением после authenticated browser evidence.
