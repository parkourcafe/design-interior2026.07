# Wave 2 — Integrator protocol

## Before launch

1. Freeze Architecture v1 and L1 spec.
2. Verify every frozen input and agent-owned existing path is readable.
3. Record sorted paths, sizes and SHA-256 in a root-owned snapshot report.
4. Confirm ownership scopes do not overlap.
5. Launch all three agents with the exact spec and snapshot hash.

## Handoff acceptance

For each agent:

- compare actual writes with exclusive scope;
- compare frozen input hashes with snapshot;
- read every changed source/test/report;
- rerun targeted tests outside the agent's narration;
- reject hidden package/config/frozen edits;
- classify assumptions and gaps;
- ask the agent for a correction only inside its scope.

## Composition

Integrator alone:

1. creates `lib/project-intelligence/application/index.ts`;
2. reconciles only public types, using a small adapter if structurally required;
3. creates the root L1 integration test;
4. adds root public export only after targeted acceptance;
5. does not change frozen domain behavior to make application tests pass.

## Root L1 integration test

The test starts from accepted synthetic source/graph fixtures and executes the full DoD
sequence. It asserts immutable V1, exact V2, exact diff/impacts, impact dispositions,
handoff logical content/hash, replay/conflict and no-partial-state behavior.

## Independent audit

After composition, reactivate Agent 1. P0 findings return work to the owning agent. P1 is
recorded before L2; P2 enters backlog. Integrator, not Agent 1, decides acceptance with
evidence.

## Validation ladder

1. standalone fixture validator;
2. Agent 1 contract oracle;
3. Agent 2 targeted tests;
4. Agent 3 targeted tests;
5. root L1 integration test;
6. all Project Intelligence tests;
7. typecheck;
8. targeted and full lint;
9. full tests;
10. build;
11. production dependency audit when safe.

Run in a trusted materialized clone if canonical Git/worktree remains unreliable. Record
the exact base and copied file set; do not label this a validation of unknown dirty state.

## Final report states

```text
ARCHITECTURE_V1=accepted|rejected
L1_WORKFLOW=accepted|rejected
L1_CHANGE_HANDOFF=accepted|rejected
L1_END_TO_END=passed|failed
BASELINE_READY=false|true
L2_ALLOWED=false|true
DATABASE_CHANGED=false
PRODUCTION_CHANGED=false
GIT_COMMIT_PUSH=false
```

`L1_END_TO_END=passed` does not change `BASELINE_READY` or `L2_ALLOWED`.
