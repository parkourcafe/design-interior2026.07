# Agent 2 ТЗ — Workflow Application

## Mission

Реализовать L1 application orchestration от source-linked draft graph до immutable V1,
human decision revision, ChangeSet и immutable V2. Не реализовывать diff/impact/handoff,
DB, API или UI.

## Read first

1. `docs/product-intelligence/architecture-v1.md`
2. `docs/product-intelligence/vertical-slice-l1-spec.md`
3. `docs/product-intelligence/domain/contract-v0.1.md`
4. `docs/product-intelligence/vertical-slice/use-case.md`
5. `docs/product-intelligence/vertical-slice/api-contract.md`
6. frozen public API in `lib/project-intelligence/index.ts`
7. kitchen-worktop fixtures and Wave 1 integration adapter decisions

## Exclusive write scope

- `lib/project-intelligence/application/workflow/**`
- `docs/product-intelligence/agent-runs/wave-2/agent-2/**`

Do not edit `lib/project-intelligence/application/index.ts` or any frozen/shared path.

## Public module boundary

Create `lib/project-intelligence/application/workflow/index.ts` that exports only
production contracts and implementation. Required concepts/names may be split into
files, but the index must expose:

- server-owned actor/execution context type;
- stable application error/result type for this module;
- `WorkflowState` and immutable published version / ChangeSet records;
- atomic conditional `WorkflowStatePort` contract;
- ID factory or equivalent server dependency;
- canonical command-digest/idempotency identity contract;
- a `WorkflowApplicationService` (or one clearly named façade) with operations for
  review, publish and revise decision.

Test adapters/helpers stay in `*.test.ts` or `__tests__/support` and are not exported.

## State semantics

Minimum logical state:

```text
projectId
stateRevision (monotonic optimistic token)
draft ProjectGraphSnapshot
published versions (immutable exact snapshots)
change sets
idempotency records or atomic-port contract for them
append-only audit intents or atomic-port contract for them
```

It is acceptable for the port, rather than public state, to own idempotency/audit records,
provided the port contract commits transition + idempotency + audit as one atomic logical
operation.

## Commands

### Review claim

Input contains project, target revision, expected revision, decision, expected state and
idempotency key. Actor and time come only from execution context.

Must:

- authorize a human capability;
- check project closure;
- invoke frozen `reviewRevision`;
- preserve AI origin/evidence;
- append the new review without mutating revision;
- emit controlled audit intent;
- reject stale/duplicate/system review without partial state.

### Publish version

Input contains project, expected latest version, expected state, label/selection if needed,
and idempotency key. Generated ID/number/time/actor are server dependencies/context.

Must:

- reject unconfirmed required AI claims selected for publish;
- validate graph invariants;
- create an exact immutable snapshot;
- allocate monotonic version number in the logical atomic boundary;
- preserve all prior published snapshots;
- emit `project_version_published` audit intent;
- replay same key/digest as the same logical version.

### Revise confirmed decision

Input contains project/node, base version, expected current revision/state, new title and
payload, controlled reason code, non-empty reason and idempotency key.

Must:

- require human capability and a confirmed current decision;
- require exact published base version;
- reject empty reason and semantic no-op;
- create a human-origin immutable revision with `replacesRevisionId`;
- update only draft node `currentRevisionId`;
- create ChangeSet with server actor/time and protected reason;
- not mutate V1;
- emit controlled audit projection without free-text reason.

Publication of V2 remains the publish operation and links the pending ChangeSet to exact
from/to versions atomically or through an explicit application transition.

## Stable failures

At minimum map: `ACCESS_DENIED`, `PROJECT_NOT_FOUND`, `PROJECT_SCOPE_VIOLATION`,
`REVISION_STALE`, `VERSION_STALE`, `STATE_STALE`, `IDEMPOTENCY_CONFLICT`,
`INVALID_TRANSITION`, `CHANGE_REASON_REQUIRED`, `EVIDENCE_ACK_REQUIRED`,
`DOMAIN_CONTRACT_VIOLATION`. Preserve original domain code in controlled details.

## Required tests

Use synthetic objects/fixtures only. Tests must cover:

1. human confirms AI revision, origin/evidence unchanged;
2. AI/system actor denied;
3. stale exact revision denied;
4. successful immutable V1 publication;
5. stale latest/state publication denied;
6. decision revision produces r2 + ChangeSet with server actor/time/reason;
7. empty reason and semantic no-op denied;
8. cross-project command denied;
9. V1 byte/deep equality preserved after revision and V2;
10. same idempotency key/digest replay;
11. same key/different digest conflict;
12. rejected operations leave state/audit unchanged;
13. deterministic results with controlled clock/ID factory.

Run targeted tests and any safe typecheck/lint available. Do not change package files to
make commands pass.

## Handoff

Create:

- `docs/product-intelligence/agent-runs/wave-2/agent-2/STATUS.md`;
- `interface-summary.md` with exported symbols, operation signatures, state/port
  semantics and a short Integrator usage example;
- `validation-report.md` with exact commands/results.

`STATUS.md` must list every changed file and explicitly state production, migrations,
frozen domain, fixtures, package/config and Git were not changed.

## Stop conditions

Report, do not work around, if frozen inputs are unreadable, if implementation needs a
domain semantic change, if atomic semantics cannot be represented by a port, or if a
required write falls outside ownership.
