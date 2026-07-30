# Agent 3 validation report

Date: 2026-07-16. Scope: Vertical Slice Contracts & Fixtures only.

## Gate and ownership

- Observed Agent 1 `snapshot_captured: true` before first write.
- Snapshot scope hash: `6d6d82221ed157e3f8248af14ad4b6c72573801e454b15ed466658a39577f218`.
- Writes are limited to:
  - `docs/product-intelligence/vertical-slice/**`;
  - `fixtures/project-intelligence/**`;
  - `docs/product-intelligence/agent-runs/agent-3/**`.
- Runtime code, SQL, migrations, app/UI code, package/config files and Agent 1/2 paths were not changed.
- No commit, push, deploy or production mutation was performed.

## Final validation commands

| Command | Exit | Result |
|---|---:|---|
| `node fixtures/project-intelligence/kitchen-worktop/validate.mjs` | 0 | 17 JSON files, 3 sources, 3 fragments, 3 exact impacts; privacy scan passed |
| `node --check fixtures/project-intelligence/kitchen-worktop/validate.mjs` | 0 | validator syntax passed |
| standalone document audit via `node --input-type=module -e …` | 0 | 7 vertical docs, 16 UI states, 6 stable errors and L0/L1/L2 tokens present |
| two parallel validator replays | 0 / 0 | stdout equal; deterministic output confirmed |

Intermediate validator runs intentionally failed while the handoff hash was a placeholder and while manifest ordering was non-canonical. The reported expected SHA-256 and manifest order were corrected; all final reruns are green.

## Fixture assertions executed

- every JSON fixture parses;
- manifest exactly enumerates all 17 JSON fixtures and existing validator, and fixes the happy-path actor/source/fragment/node/revision/edge/evidence/review/version/change-set/impact/export IDs, timestamps, idempotency keys, checksums and ordering rules;
- source byte lengths/SHA-256 values match embedded synthetic payloads and manifest;
- source IDs, fragment IDs, graph entity IDs and impact IDs are unique in their scopes;
- project/source/fragment/revision/evidence/edge/review references close correctly;
- AI-origin claims retain evidence even after separate human confirmation;
- human-confirmed/rejected revision results have a human review record;
- V1/V2 snapshot membership and revision replacement are consistent;
- V1 stays byte-for-byte unchanged during standalone diff calculation;
- V1→V2 diff is exactly one decision with `changedPaths=["/material"]`;
- calculated impacts exactly equal Item distance 1 and Budget/Finish Schedule distance 2;
- reversing node/edge input order does not change impact output;
- non-propagating `conflicts_with` risk is excluded;
- cycle traversal terminates and emits no duplicate/self impact;
- all nine negative fixtures produce their expected stable outcome/error;
- handoff source/revision/impact references close against V2;
- semantic handoff hash equals `sha256:9c7d1eddd1278bda3308fc8c41b20908ee3f600e08848b49a910484fb3e8484b` and repeats deterministically;
- JSON fixture scan found no email-, phone-, secret- or signed-URL-like value.

## Contract completeness

- Use case includes actors, pre/postconditions, happy path, audit/idempotency points and all required alternatives.
- Proposed API covers source upload/process, review queue/action, version publish, decision revision, impact calculation/read/review and export request/read.
- Each mutation has idempotency and optimistic concurrency semantics.
- Stable codes include `REVISION_STALE`, `IDEMPOTENCY_CONFLICT`, `CHANGE_REASON_REQUIRED`, `EVIDENCE_ACK_REQUIRED`, `PROJECT_SCOPE_VIOLATION`, `INVALID_TRANSITION`.
- UI contract covers all 16 required source/review/version/impact/export states plus stale/loading/error behavior.
- Event contract separates immutable audit from product analytics and follows controlled properties from `measurement-plan.md`.
- Traceability maps every acceptance bullet from `vertical-slice-spec.md` and distinguishes L0/L1/L2.
- Contract gaps are classified as resolved, assumed, deferred or cross-contract blocking.

## Honest maturity boundary

Passed here means standalone logical/fixture validation only.

- `L0 executable now`: green.
- `L1 contract ready`: specified; application/API adapter not implemented.
- `L2 deferred`: persistence, RLS, version immutability constraints, durable idempotency, job store and real renderer are not claimed as passing.

`npm test`, typecheck, lint and build are not Agent 3 acceptance commands because this package adds no runtime TypeScript/dependency/config change and the canonical Git/package baseline remains under Agent 1 integrity review. Integrator must perform cross-contract and full-repository validation in a trusted environment.

## Integrator handoff

After Agent 2 contract freeze, Integrator must create the only cross-contract adapter and prove:

1. graph V1/V2 map to frozen public types and pass invariants;
2. AI content origin survives human confirmation with a separate target revision/actor;
3. Agent 2 diff equals `expected-diff.json` pure fields;
4. changed node IDs feed Agent 2 impact and equal `expected-impacts.json` pure paths;
5. ChangeSet and persisted impact lifecycle wrap rather than silently mutate pure results;
6. version-active edges are selected before impact;
7. all invalid fixtures map to accepted stable codes.

The observed frozen-candidate mapping is recorded as `CG-018`: application-effective
`human_confirmed` becomes an Agent 2 source claim status plus separate confirmation
review; edit lineage remains ChangeSet/audit; Agent 2 diff must additionally assert
`impactRelevant=true`. Structured questionnaire locator maps deterministically to the
plain-text code-point range `61..89` for the fixed fixture while the application view
retains its JSON Pointer.

Route names remain proposals. No `CHANGE_REQUEST.md` is needed unless the frozen Agent 2 contract cannot preserve the provenance/review separation in `CG-005`.
