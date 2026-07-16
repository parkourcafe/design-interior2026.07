# ТЗ: первый исполняемый вертикальный срез L1

Дата: 16 июля 2026 года.
Версия: `project-intelligence-vertical-slice-l1/1.0`.
Architecture baseline: [`architecture-v1.md`](./architecture-v1.md).

## 1. Цель

Доказать одним исполняемым сценарием, что application layer сохраняет причинную цепочку:

```text
source → AI revision → human confirmation → V1
       → human decision change + reason → V2
       → diff → impacts → reviews → logical handoff hash
```

Сценарий использует только synthetic kitchen-worktop fixtures. Он не подключает БД,
production, UI, HTTP, storage, OCR/LLM или настоящий renderer.

## 2. Definition of Done

L1 считается выполненным, если один root-owned integration test доказывает:

1. AI-origin decision подтверждается human actor над exact current revision;
2. V1 публикуется как immutable snapshot;
3. material меняется с `natural_stone` на `quartz_composite` в новой revision того же
   stable node;
4. изменение требует reason и expected revision/base version;
5. V2 публикуется без изменения V1;
6. diff содержит только decision и `/material`;
7. roots вычисляются из diff, а не принимаются от caller;
8. impacts точно равны golden: Item distance 1, Budget и Finish Schedule distance 2;
9. `conflicts_with` Risk не propagates;
10. human dispositions разделяют resolved/unresolved impacts;
11. logical handoff соответствует принятому contract и даёт stable semantic hash;
12. replay одного key/digest возвращает прежний logical result;
13. тот же key с другим digest даёт `IDEMPOTENCY_CONFLICT`;
14. stale revision/version/state не создаёт partial mutation или audit event;
15. domain/application targeted tests, typecheck, lint, full tests и build проходят в
    trusted validation environment.

## 3. Входные артефакты

Обязательные неизменяемые inputs:

- public API `lib/project-intelligence/index.ts`;
- `docs/product-intelligence/domain/contract-v0.1.{md,json}`;
- `docs/product-intelligence/vertical-slice/**`;
- `fixtures/project-intelligence/kitchen-worktop/**`;
- Wave 1 integration decisions.

Agents не меняют frozen domain или fixtures. Расхождение оформляется как finding для
Integrator.

## 4. Модули результата

### 4.1 Workflow application

Owned path: `lib/project-intelligence/application/workflow/**`.

Обязательные public concepts:

- `ApplicationActorContext` и server-owned execution context;
- `WorkflowState` с `stateRevision`, draft snapshot, published versions, change sets и
  audit events либо эквивалентной строго типизированной моделью;
- `WorkflowStatePort` с load + atomic conditional commit semantics;
- `reviewClaim`/эквивалентная operation поверх domain `reviewRevision`;
- `publishVersion`;
- `reviseDecision` с new immutable revision и ChangeSet;
- stable application errors/result;
- canonical request digest/idempotency identity contract.

Обязательные правила:

- actor/time не берутся из command body;
- system/AI actor не может выполнить human review или human decision change;
- exact project closure проверяется до mutation;
- reason code и trim-непустой reason обязательны для confirmed decision change;
- no-semantic-change отклоняется;
- published snapshots не мутируются;
- commit получает expected state revision и полный audit intent;
- ошибка/конфликт не оставляет частичное состояние;
- test adapter располагается только в `*.test.ts`/test support path и не экспортируется
  как production persistence.

### 4.2 Change-impact and handoff application

Owned path: `lib/project-intelligence/application/change-handoff/**`.

Обязательные public concepts:

- `ChangeContext`: project, from/to versions, ChangeSet identity;
- `ImpactRun` с immutable inputs, deterministic results и initial `needs_review`;
- `reviewImpact`/эквивалентная operation с exact impact/status check;
- `LogicalHandoff`/`HandoffArtifactDescriptor`;
- canonical JSON + SHA-256 semantic hash;
- stable application errors/result либо совместимый adapter boundary.

Обязательные правила:

- diff только через `diffProjectVersions`;
- roots только через `changedNodeIds`;
- impact только через `calculateChangeImpact` на exact target snapshot;
- caller не задаёт roots/impacted list/edges;
- исходный run immutable, reviews хранятся отдельно;
- duplicate review/replay детерминирован;
- handoff строится из published version + exact run + reviews;
- volatile fields исключены из semantic hash;
- порядок не зависит от input array order или locale;
- модуль не рендерит PDF/XLSX и не пишет в storage.

### 4.3 Integrator-owned composition

Только Integrator меняет:

- `lib/project-intelligence/application/index.ts`;
- при принятии — `lib/project-intelligence/index.ts`;
- `tests/project-intelligence/application/vertical-slice-l1.integration.test.ts`;
- Wave 2 integration report.

Integrator сопоставляет структурно совместимые outputs модулей; agents не импортируют
private implementation друг друга.

## 5. Required commands and outcomes

| Operation | Required input | Success | Stable failure examples |
|---|---|---|---|
| Human review | project, target + expected revision, decision, idempotency | review + updated draft | `REVISION_STALE`, `ACCESS_DENIED` |
| Publish V1/V2 | selected revisions, expected latest/state, idempotency | immutable version | `VERSION_STALE`, `INVALID_TRANSITION` |
| Revise decision | node, base version, expected revision, new payload/title, reason | new revision + ChangeSet | `CHANGE_REASON_REQUIRED`, `REVISION_STALE` |
| Calculate run | from/to versions + exact target graph | immutable ImpactRun | `VERSION_STALE`, `DOMAIN_CONTRACT_VIOLATION` |
| Review impact | run, impact, expected status, disposition | separate human review | `IMPACT_STALE`, `ACCESS_DENIED` |
| Build handoff | exact version/run/reviews | logical content + stable hash | `INVALID_TRANSITION` |

## 6. Idempotency L1 contract

Для каждой mutation test adapter хранит scoped key, canonical digest и logical result.

```text
new key                      → execute and record
same key + same digest       → return recorded result, idempotentReplay=true
same key + different digest  → IDEMPOTENCY_CONFLICT, no mutation
```

Canonical digest не включает server time, request ID или volatile response metadata.
L1 не утверждает durability после process restart.

## 7. Audit L1 contract

Успешные mutations формируют append-only audit intent как минимум для:

- `claim_review_confirmed|rejected`;
- `project_version_published`;
- `confirmed_decision_revised`;
- `impact_run_created`;
- `impact_reviewed`;
- `logical_handoff_built`.

Event содержит server-derived actor/time и controlled IDs/codes. Raw payload, excerpts,
free-text reason, filename, signed URL и provider response не входят в structured event.
Reason text может храниться в protected domain record, но не в log/analytics projection.

## 8. Negative acceptance matrix

Минимальные тесты:

- AI/system actor attempts human review;
- stale target/current revision;
- cross-project revision or edge;
- missing evidence for AI revision;
- empty reason and reason-only no semantic change;
- stale base/latest/state version;
- same idempotency key with different payload;
- same revision ID with changed payload;
- client-supplied changed roots ignored/not accepted;
- shuffled nodes/edges/keys preserve impact and hash;
- duplicate/stale impact disposition;
- handoff requested for mismatched version/run.

## 9. Ownership и запреты

Агенты работают только в назначенных paths. Общие frozen files — read-only. Запрещены:

- migrations, schema, RLS, production;
- `app/**`, API routes, components;
- package/config/lock files;
- network/provider calls;
- real user data;
- git add/commit/push;
- изменение другого agent-owned path;
- заявление `L2 passed`.

## 10. Handoff каждого implementation agent

В `docs/product-intelligence/agent-runs/wave-2/<agent>/` нужны:

- `STATUS.md` со статусом `accepted_candidate|blocked`;
- полный список changed files;
- команды и результаты проверок;
- assumptions и unresolved findings;
- явные statements: production changed, migrations changed, frozen contract changed;
- interface summary для Integrator.

## 11. Stop conditions

Agent прекращает mutation и сообщает Integrator, если:

- требуемый frozen input unreadable/dataless;
- нужен write вне ownership;
- требуется изменить frozen domain semantics;
- невозможно соблюсти project closure или actor trust boundary;
- тест требует production credential/data;
- обнаружено существующее пересекающееся изменение после scope snapshot.
