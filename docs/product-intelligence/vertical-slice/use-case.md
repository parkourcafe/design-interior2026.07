# Use case — Kitchen worktop decision change

Contract version: `project-intelligence-vertical-slice/0.1`.

## Outcome

Авторизованный участник видит подтверждённое исходное решение, меняет материал столешницы с обязательной причиной и получает проверяемый список зависимых объектов и versioned handoff. Ни AI, ни export worker не могут подменить human review или создать скрытый impact.

## Actors and roles

| Actor | Trust boundary | Responsibilities |
|---|---|---|
| Designer reviewer | authenticated organization member, role derived server-side | рассматривает AI claims, публикует baseline, рассматривает impacts |
| Client approver | authenticated project participant, role derived server-side | меняет подтверждённое решение в разрешённом project scope |
| Ingestion worker | system actor | checksum, fragments, locators, extraction status |
| Extraction worker | AI/system actor | предлагает revisions со статусом `extracted/interpreted/unknown`; не выполняет human review |
| Impact worker | deterministic system actor | строит impact paths по сохранённым edges |
| Export worker | system actor | строит render из immutable project version и impact snapshot |

Actor IDs в fixtures синтетические и не являются user-entered полями API.

## Preconditions

- organization/project membership проверена сервером;
- существует project `project-kitchen-001` и Area `area-kitchen`;
- deployment region и locale заданы policy, а не входом client command;
- три synthetic source payload доступны ingestion worker;
- source bytes/checksum, fragment locator и revision history рассматриваются как immutable;
- mutable commands имеют `Idempotency-Key` и optimistic concurrency field;
- V1/V2 number allocation и publication будут atomic на persistence layer — это L2 requirement.

## Happy path

1. Designer создаёт upload intent для questionnaire, transcript и PDF plan. API фиксирует project-scoped idempotency key.
2. Worker завершает sources: вычисляет SHA-256, создаёт addressable fragments и переводит source в `ready`.
3. Extraction создаёт AI-origin requirement и decision. Каждый имеет EvidenceLink на доступный fragment с locator.
4. Review queue возвращает content origin, target revision, evidence excerpt и locator side-by-side.
5. Designer подтверждает requirement и decision. Review records содержат human actor, `targetRevisionId` и server timestamp; `contentOrigin="ai"` сохраняется.
6. Designer публикует V1. Snapshot выбирает конкретные revision IDs, становится immutable и получает `versionNo=1`.
7. Client открывает decision из V1 и меняет `material` с `natural_stone` на `quartz_composite`. Command содержит `baseVersionId`, `expectedRevisionId`, reason code и непустой reason.
8. Система создаёт новую revision того же stable node, draft V2 и ChangeSet. V1 и revision r1 не обновляются.
9. Client публикует V2. Version number равен 2, base version — V1.
10. Diff V1 → V2 возвращает один changed node и один JSON Pointer `/material`; actor/timestamp/reason добавляются из ChangeSet/AuditEvent.
11. Impact worker берёт `fromVersionId/toVersionId`, version-active graph и propagating policy. Client не передаёт changed node IDs или edges.
12. Возвращаются Item distance 1, Budget и Finish Schedule distance 2. Risk через `conflicts_with` исключён.
13. Designer рассматривает все три impacts: Item и Budget — `accepted`, Finish Schedule — `resolved`.
14. Export worker создаёт logical handoff V2. Он содержит source references, decision provenance, resolved/unresolved impacts и semantic content hash.
15. Повторный render semantic content даёт тот же hash. Новый artifact ID/timestamp допустимы только вне hashed logical content.

## Alternative and error paths

### Extraction failed

- Source остаётся созданным с checksum и получает `processing_failed` плюс controlled error code.
- Raw bytes/text, filename клиента и provider payload не попадают в log/error message.
- Retry с тем же idempotency key и тем же payload возвращает прежнюю operation; новый processing attempt использует отдельный attempt ID/correlation ID.
- Existing successful fragments не удаляются; partial processing показывается как `processing_partial`.

### AI claim without locator

- Revision не попадает в обычный confirm flow как evidence-complete claim.
- UI показывает `evidence unavailable` и запрещает silent confirmation.
- Human confirmation возможна только с отдельным evidence acknowledgement и непустой причиной; создаётся audit event `evidence_unavailable_acknowledged`.
- Без acknowledgement API возвращает `422 EVIDENCE_ACK_REQUIRED`.

### User edits claim before confirmation

- Original AI revision остаётся immutable.
- Review action `edit` адресует original `targetRevisionId` и создаёт новую human-origin revision того же stable node.
- Resulting revision может быть подтверждена в той же atomic human action; AI provenance original revision и EvidenceLink сохраняются в lineage.
- V1 выбирает resulting revision, а не переписывает AI revision.

### Stale review attempt

- Если `expectedRevisionId` не равен current revision, API возвращает `409 REVISION_STALE` и current revision metadata.
- Human action не повторяется автоматически и не переносится на новую revision.
- UI обновляет side-by-side view и просит человека принять решение заново.

### V2 requested with no semantic change

- Если canonical payload равен selected V1 payload, новая revision/version/change set не создаются.
- API возвращает `422 INVALID_TRANSITION` с detail code `NO_SEMANTIC_CHANGE`.
- Reason сам по себе не считается content change.

### Graph cycle

- Traversal использует visited set на каждый changed root.
- Changed root не возвращается как собственный impact.
- Результат конечен, дедуплицирован и детерминирован; cycle fixture проверяет максимум три visited nodes.

### Missing dependency edge found by human

- Reviewer выбирает disposition `missing_added` и указывает impacted node либо controlled reference + reason.
- Original impact run не переписывается скрыто.
- Audit фиксирует human observation; отдельная явная graph-edge command создаёт edge в draft version после authorization/invariant checks.
- После добавления edge создаётся новый deterministic impact run для того же change context или следующей version; lineage связывает оба runs.

### Export retry

- Тот же idempotency key и тот же request digest возвращают существующий export job/artifact.
- Тот же key с другим payload возвращает `409 IDEMPOTENCY_CONFLICT`.
- Новый key может создать новый render; semantic content hash той же version/impact snapshot остаётся прежним.
- Failed render не меняет project version и может быть повторён.

## Idempotency points

| Operation | Scope | Same key + same payload | Same key + different payload |
|---|---|---|---|
| Source upload intent | project + operation | existing source/upload intent | `IDEMPOTENCY_CONFLICT` |
| Complete/process source | source + processing operation | existing completion result | `IDEMPOTENCY_CONFLICT` |
| Human review | target revision + action | existing review result | `IDEMPOTENCY_CONFLICT` |
| Publish version | project + base/current set | existing version | `IDEMPOTENCY_CONFLICT` |
| Revise decision | node + base version | existing new revision/change set | `IDEMPOTENCY_CONFLICT` |
| Calculate impacts | change set + graph/version pair | same impact set | `IDEMPOTENCY_CONFLICT` |
| Review impact | impact + disposition | same review event | `IDEMPOTENCY_CONFLICT` |
| Request export | version + format + impact snapshot | existing job/artifact | `IDEMPOTENCY_CONFLICT` |

## Audit events

Immutable audit events are required for:

- source processing terminal transition;
- review confirm/reject/edit;
- unavailable evidence acknowledgement;
- version publication;
- confirmed decision revision/change reason;
- impact set creation;
- impact disposition, including `missing_added`;
- export terminal transition.

Audit actor/time are server-derived. Analytics events and allowed dimensions are defined in [events.md](./events.md).

## Postconditions

- V1 and V2 are addressable immutable snapshots;
- decision stable node is unchanged, revisions r1/r2 coexist;
- every AI-origin confirmed claim retains evidence and human review record;
- ChangeSet explains who/when/why without putting those fields into pure content diff;
- each impact has a reproducible edge path and review lifecycle;
- handoff identifies project/version and explicitly separates resolved/unresolved impacts;
- no production data, PII, signed URL or secret exists in fixtures.

## Out of scope

- production persistence/RLS/migrations;
- actual PDF/OCR/LLM calls;
- visual design or graph canvas;
- automatic mutation of impacted deliverables;
- procurement, WBS, billing, CRM, CAD/3D;
- full Studio or Renovation product journey;
- deployment or provider selection.
