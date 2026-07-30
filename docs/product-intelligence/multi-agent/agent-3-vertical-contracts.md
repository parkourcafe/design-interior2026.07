# ТЗ Agent 3 — Vertical Slice Contracts & Fixtures

## 1. Миссия

Описать первый вертикальный срез так, чтобы следующий implementation agent мог реализовать его без продуктовых догадок. Создать синтетический fixture pack, ожидаемый version diff, change-impact и handoff.

Agent 3 не пишет runtime code, SQL и UI components.

## 2. Exclusive write scope

```text
docs/product-intelligence/vertical-slice/**
fixtures/project-intelligence/**
docs/product-intelligence/agent-runs/agent-3/**
```

Запрещено менять:

- `lib/**`, `app/**`, `supabase/**`;
- `package.json`/configs;
- Agent 1/2 paths;
- общие architecture/ADR docs.

## 3. Канонический сценарий

До записи файлов дождаться `snapshot_captured: true` в `agent-runs/agent-1/STATUS.md`. Читать документы и составлять внутренний план можно сразу. `BASELINE_READY` ждать не требуется.

Использовать синтетический residential kitchen case без PII:

1. загружены client questionnaire, transcript excerpt и PDF plan;
2. извлечены requirement и decision с source locators;
3. человек подтверждает AI-origin revision для V1; content origin остаётся `ai`, а review отдельно содержит human actor и target revision;
4. V1 содержит decision «натуральный камень»;
5. Item «кухонная столешница» specified_by decision;
6. Finish Schedule и Budget depend_on Item;
7. Risk «lead time» связан с decision через non-propagating `conflicts_with`;
8. клиент меняет decision на «кварцевый агломерат» с обязательным reason;
9. создаётся V2;
10. content diff содержит только decision и JSON Pointer `/material`;
11. impact содержит ровно Item (distance 1), Finish Schedule (distance 2) и Budget (distance 2) с dependency paths, но не Risk;
12. пользователь рассматривает impacts;
13. handoff V2 содержит provenance, version и unresolved/resolved impacts;
14. повторный render имеет тот же semantic content hash.

Не добавлять procurement, WBS ремонта, billing или CAD.

Все IDs, timestamps, checksums и ordering фиксированы в manifest. Запрещены `randomUUID()`, `Date.now()` и зависимость expected output от порядка JSON object keys/input arrays.

## 4. Рабочие пакеты

### A3.1 — Use-case contract

Создать `vertical-slice/use-case.md`:

- actors и roles;
- preconditions;
- happy path;
- alternative paths;
- error/retry paths;
- idempotency points;
- audit events;
- postconditions;
- out-of-scope.

Обязательные alternatives:

- extraction failed;
- AI claim без locator;
- user edits claim before confirmation;
- stale review attempt;
- V2 created with no semantic change;
- graph cycle;
- missing dependency edge found by human;
- export retry.

### A3.2 — API contract

Создать `vertical-slice/api-contract.md`. Это proposal, не реализация.

Минимальные operations:

| Operation | Purpose |
|---|---|
| create source upload | idempotent source record/upload intent |
| complete/process source | checksum, fragments, processing status |
| list review queue | claims + source locators + current revision |
| review revision | confirm/reject/edit с expected revision |
| publish version | immutable V1/V2 |
| revise decision | new revision + reason |
| calculate/read impacts | deterministic paths for change set |
| review impact | accepted/resolved/not applicable/missing added |
| request/read export | idempotent versioned handoff job |

Для каждой operation указать:

- method и proposed route;
- authenticated role;
- request schema;
- response schema;
- idempotency key;
- optimistic concurrency field;
- status codes;
- domain error codes;
- audit event;
- PII/logging restrictions.

Общие обязательные правила API:

- authenticated actor ID/role и server timestamp не принимаются как доверенные client fields;
- изменяющие команды используют idempotency key; повтор ключа с другим payload возвращает `IDEMPOTENCY_CONFLICT`;
- human actions используют expected revision/version и возвращают `REVISION_STALE` при конфликте;
- impact server вычисляет из `fromVersionId/toVersionId` и сохранённого graph; client не передаёт произвольные changed-node IDs или edges;
- отсутствие доступа к чужому project возвращает `404` без подтверждения существования;
- недоступный source fragment требует отдельного human acknowledgement с reason и audit event;
- минимальные stable codes: `REVISION_STALE`, `IDEMPOTENCY_CONFLICT`, `CHANGE_REASON_REQUIRED`, `EVIDENCE_ACK_REQUIRED`, `PROJECT_SCOPE_VIOLATION`, `INVALID_TRANSITION`.

Рекомендуемые proposed routes:

```text
POST /api/projects/{projectId}/sources
POST /api/projects/{projectId}/sources/{sourceId}/complete
GET  /api/projects/{projectId}/review-queue
POST /api/projects/{projectId}/revisions/{revisionId}/review
POST /api/projects/{projectId}/versions
POST /api/projects/{projectId}/decisions/{nodeId}/revisions
GET  /api/projects/{projectId}/change-sets/{changeSetId}/impacts
POST /api/projects/{projectId}/change-sets/{changeSetId}/impacts/{impactId}/review
POST /api/projects/{projectId}/exports
GET  /api/projects/{projectId}/exports/{exportId}
```

Route names можно изменить Integrator, но semantics и error codes должны сохраняться.

### A3.3 — UI state contract

Создать `vertical-slice/ui-state-machine.md` без visual design.

Состояния:

```text
source_empty
uploading
processing
processing_partial
processing_failed
review_pending
review_complete
v1_published
decision_editing
v2_draft
impact_pending
impact_review
v2_ready
export_queued
export_ready
export_failed
```

Для каждого state:

- visible data/actions;
- allowed transition;
- forbidden transition;
- loading/empty/error behavior;
- stale-data behavior;
- required role;
- audit/product event.

Отдельно описать source + claim side-by-side, version diff и dependency path. Graph canvas не проектировать.

### A3.4 — Fixture pack

Создать структуру:

```text
fixtures/project-intelligence/kitchen-worktop/
├── manifest.json
├── sources.json
├── fragments.json
├── graph-v1.json
├── graph-v2.json
├── expected-diff.json
├── expected-impacts.json
├── expected-handoff.json
├── invalid-cases/
│   ├── unsourced-ai-claim.json
│   ├── ai-human-confirmation.json
│   ├── unknown-without-reason.json
│   ├── cross-project-edge.json
│   ├── stale-review.json
│   ├── unavailable-fragment.json
│   ├── missing-change-reason.json
│   ├── idempotency-conflict.json
│   └── cycle.json
└── validate.mjs
```

Fixture IDs фиксированы и читабельны. Нельзя использовать UUID/контакты реального проекта.

`ai-human-confirmation.json` — отрицательный case, где AI/system actor пытается выполнить human-review action. Он не должен трактоваться как запрет человеку подтвердить AI-origin revision.

### A3.5 — Expected diff

`expected-diff.json` должен явно содержать:

- changed stable node ID;
- from/to revision IDs;
- change type;
- JSON Pointer paths;
- reason code;
- actor role без PII;
- from/to project version.

Happy-path diff содержит одну changed decision, новый immutable revision ID и единственный semantic payload path `/material`. Budget/Finish Schedule не меняются автоматически: они появляются в impact list для human review. Added/removed nodes включать только если они действительно нужны сценарию. Не маскировать decision edit созданием нового stable node.

Actor/timestamp/reason относятся к application-level ChangeSet/AuditEvent. Если pure `NodeVersionChange` их не содержит, fixture хранит эти поля в отдельном change-set object и фиксирует adapter mapping; Agent 3 не расширяет чужой public type.

### A3.6 — Expected impacts

Для каждого impact:

- changed node;
- impacted node;
- distance;
- node path;
- edge IDs/relations;
- initial review status;
- expected human disposition.

Cycle fixture должен доказывать конечность обхода, но не менять happy-path expected impacts.

Happy-path содержит non-propagating `conflicts_with` risk и явно доказывает его отсутствие в expected impacts.

### A3.7 — Expected handoff

`expected-handoff.json` содержит logical content, не бинарный PDF:

- project/version identifiers;
- confirmed scope/decision summary;
- room/area;
- items/deliverables;
- source references без signed URLs;
- resolved/unresolved impacts;
- generated content hash placeholder;
- locale/unit/currency metadata отдельно от canonical values.

Semantic hash строится по canonical logical content: UTF-8, сортированные object keys, стабильный порядок contract-defined arrays. Volatile artifact ID, generation timestamp и job status в hash не входят.

### A3.8 — Traceability matrix

Создать `vertical-slice/traceability.md`:

| Acceptance criterion | API operation | UI state | Fixture | Expected assertion |
|---|---|---|---|---|

Каждый criterion из `vertical-slice-spec.md` должен иметь минимум одну строку.

Каждой строке назначить maturity:

- `L0 executable now` — standalone fixture/domain assertion;
- `L1 contract ready` — API/application adapter ещё не подключён;
- `L2 deferred` — persistence, RLS, idempotency store или real export.

Deferred requirement нельзя отмечать passed через fake persistence, `skip` или `todo`.

### A3.9 — Contract gaps

Создать `vertical-slice/contract-gaps.md`. Минимум проверить и явно классифицировать:

- content origin vs review actor и target revision;
- review-only revision transition: content diff или только audit event;
- ChangeSet enrichment actor/timestamp/reason поверх pure diff;
- persisted impact ID/status/version pair поверх pure `ChangeImpact`;
- edges active for exact target version;
- unavailable evidence acknowledgement;
- idempotency conflict semantics.

Gap не исправляется изменением Agent 2/runtime paths. Для cross-owner решения используется `CHANGE_REQUEST.md`.

## 5. Fixture validator

`validate.mjs` использует только Node built-ins и проверяет:

- JSON parse всех файлов;
- unique IDs;
- references между nodes/revisions/fragments/edges;
- same project ID;
- evidence → revision + fragment;
- expected path edge continuity;
- manifest перечисляет каждый fixture;
- отсутствие очевидных email/phone/signed URL/secret patterns;
- повторный handoff даёт тот же semantic content hash;
- deterministic output and exit code.

Validator не импортирует Agent 2 code во время параллельной работы. Это делает Integrator после contract freeze.

## 6. Event contract

Создать `vertical-slice/events.md`, используя `measurement-plan.md`.

Для каждого события указать:

- trigger;
- audit или analytics;
- required IDs;
- allowed controlled properties;
- forbidden PII/source content;
- idempotency/correlation semantics.

Не смешивать immutable audit и product analytics.

## 7. Validation

Минимум:

```text
node fixtures/project-intelligence/kitchen-worktop/validate.mjs
```

Дополнительно проверить все JSON через Node. Не устанавливать JSON Schema tools/dependencies.

## 8. Deliverables

- весь `vertical-slice/**` contract pack;
- весь synthetic fixture pack;
- `vertical-slice/contract-gaps.md` с разделением resolved/assumed/deferred/blocking;
- validator с exit 0;
- `agent-runs/agent-3/STATUS.md`;
- `agent-runs/agent-3/validation-report.md`;
- `CHANGE_REQUEST.md`, если contract требует изменения Agent 2/common docs.

## 9. Acceptance criteria

- happy path полностью воспроизводим из fixture files;
- нет реальных PII/project data;
- every claim has explicit revision/provenance semantics;
- expected diff/impact paths однозначны;
- API operations содержат concurrency/idempotency/error contracts;
- UI states покрывают loading/error/stale paths;
- каждый criterion traceable;
- L0/L1/L2 не смешаны, deferred persistence не выдана за passing test;
- validator проходит без dependencies;
- Agent 3 не изменил runtime code/schema;
- нет изменений вне owned paths.

## 10. Stop conditions

Остановиться и написать `CHANGE_REQUEST.md`, если требуется:

- изменить Agent 2 public type/export;
- выбрать конкретную SQL table shape;
- добавить framework/package;
- использовать production data;
- принять финальный visual/brand design;
- выбрать Studio или Renovation build-track;
- реализовать API/UI вместо описания контракта.

## 11. Handoff contract

В `STATUS.md`:

```yaml
vertical_contract_ready: true | false
snapshot_gate_observed: true | false
fixture_pack_ready: true | false
fixture_validator: passed | failed
pii_scan: passed | failed
domain_contract_assumptions: []
required_integrator_adapters: []
routes_are_proposals: true
```
