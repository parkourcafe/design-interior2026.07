# ProjectCEO RU — request-bound UI contract

Дата фиксации: 18 июля 2026 года.

## Граница доверия

- UI передаёт только селектор проекта, идентификатор целевого ресурса, полезную нагрузку команды и стабильный `commandId`.
- `actor`, `organization`, effective role, package scope и `stateRevision` заново выводятся на сервере из request-bound Supabase JWT и RPC-проекций.
- Подлинность сессии проверяется через `getClaims()`, затем текущий пользователь подтверждается через `getUser()`; `data: null`, несовпадение subject и user ID и ошибки Auth завершаются контролируемым отказом.
- Human route не использует service role, admin client, worker adapter или прямой доступ к private Project Intelligence tables.
- Изменяющий запрос требует `application/json`, exact same-origin и строгую Zod-схему. Неизвестные и authority-поля отклоняются.
- Один `commandId` сохраняется при сетевом/серверном retry и меняется только после `completed`. DB idempotency key имеет вид `ui:<projectId>:<kind>:<commandId>`.

## Реализованные human-команды backend

1. `revoke_invitation`;
2. `revoke_guest_grant`;
3. `create_change` с точным `fromProductionPackageVersionId`;
4. `review_change_impact`;
5. `upload_photo_evidence`;
6. `review_photo_evidence`;
7. `accept_milestone`.

В текущем UI непосредственно подключены `revoke_guest_grant` и `create_change`. Остальные реализованные backend-команды требуют отдельной экранной read-модели/контрола и не считаются пройденным browser workflow.

## Typed unavailable до расширения read-контракта

- `create_invitation`: нет законченного маршрута доставки и принятия одноразовой ссылки;
- `acknowledge_release`: текущая delivery projection не содержит controlled `recipientUserId`, поэтому UI не получает ни один pending distribution ID;
- `register_source`, `review_source`, `review_selection`;
- `publish_baseline`, `publish_release`, `distribute_release`;
- `build_handover`: worker-only.

Эти команды возвращают `operation_unavailable` до любой записи. Локальная Kora fixture также read-only и не имитирует успешные mutations.

## Fail-closed ограничения v0.1

- Несколько организаций в singular `PortfolioView` дают `scope_conflict` до появления organization selector.
- Несколько sibling package memberships одного проекта дают `scope_conflict` до появления DTO с per-package roles/scopes; первый пакет не выбирается автоматически.
- Ошибка или `data: null` любого обязательного downstream RPC не преобразуется в пустой успешный экран.
- Quarantined/archive/CAD source без подходящей preview/revision не признаётся evidence-eligible.
- Production schema exposure и production adoption не входят в этот контракт.

## HTTP mapping

- 401: unauthenticated;
- 403: identity/authorization/expired/revoked;
- 404: not found;
- 409: stale/idempotency/scope conflict и unavailable operation;
- 400: validation/unsupported source;
- 429: rate limited;
- 500: internal error.
