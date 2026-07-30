# Agent 2 — Workflow Application status

Status: **accepted_candidate**.
Frozen launch aggregate:
`73bec18122badb492dc989904978e4ff9962ca063359f1e6a4d3483720e67eec`.

## Outcome

Implemented the owned L1 workflow application boundary from source-linked draft review
through immutable V1, confirmed-decision revision/ChangeSet and immutable V2.

The module provides:

- trusted server actor/execution context and capability checks;
- stable controlled application result/error codes with original domain code details;
- exact-revision human review through frozen `reviewRevision`;
- graph-invariant-checked immutable version publication with monotonic version numbers;
- confirmed-decision human revision, protected reason and pending ChangeSet;
- atomic V2 publication plus exact pending→published ChangeSet linkage;
- canonical command serialization and injected digest/ID dependencies;
- replay/conflict-aware load plus conditional atomic commit contract for state,
  idempotency result and audit intents;
- defensive command/context capture before async boundaries and cross-snapshot
  revision/stable-node identity validation;
- exact published-version base chains and ChangeSet metadata/lineage/version closure;
- test-only in-memory port proving L1 no-partial-write semantics.

Public API and integration example are documented in `interface-summary.md`. Exact
validation commands/results are in `validation-report.md`.

## Changed files

Every changed file owned by this agent:

1. `lib/project-intelligence/application/workflow/canonical.ts`
2. `lib/project-intelligence/application/workflow/contracts.ts`
3. `lib/project-intelligence/application/workflow/index.ts`
4. `lib/project-intelligence/application/workflow/service.ts`
5. `lib/project-intelligence/application/workflow/workflow.test.ts`
6. `docs/product-intelligence/agent-runs/wave-2/agent-2/interface-summary.md`
7. `docs/product-intelligence/agent-runs/wave-2/agent-2/validation-report.md`
8. `docs/product-intelligence/agent-runs/wave-2/agent-2/STATUS.md`

No file outside the exclusive Agent 2 paths was edited.

## Validation summary

Trusted materialized validation clone:
`/private/tmp/pi-agent2-domain-validation`.

```text
Frozen manifest:                    51 files, aggregate matched, 0 mismatches
Workflow targeted tests:            1 file, 18/18 passed
Domain + integration + workflow:    8 files, 76/76 passed
Typecheck:                           passed
Targeted workflow lint:              passed
Full tests:                          22 files, 156/156 passed
Full lint:                           passed
Build:                               passed (Next.js 16.2.10)
Synthetic fixture/privacy validator: passed
```

The canonical checkout's dataless toolchain result was not counted as validation.

## Assumptions and findings

- Frozen domain `ProjectGraphSnapshot` validates reviews only for current revisions.
  Therefore the mutable draft keeps the active current-review projection; an earlier
  review remains immutable in V1 and in atomic audit history. This follows the accepted
  Wave 1 adapter decision that maps reviews for current revisions.
- In the L1 publication policy, AI-origin `decision` and `requirement` nodes are treated
  as confirmation-required. Other AI-origin graph signals still must satisfy frozen
  evidence/invariant rules. A future edition-specific policy can replace this local P0
  rule only through an approved application contract decision.
- A title-only rewrite with an unchanged canonical payload is rejected as
  `INVALID_TRANSITION / NO_SEMANTIC_CHANGE`, keeping frozen payload diff semantics.
- The test adapter models, but does not prove, durable or multi-process atomicity.
- A read-only adversarial self-audit found three initial P1 gaps (same-ID snapshot
  tampering, async input TOCTOU and incomplete version/ChangeSet closure), then one
  follow-up P1 for descendant-draft pending ChangeSet linkage, plus P2 edge cases. All
  were fixed and covered by regressions before this handoff; no P0 was found.
- No implementation blocker or required shared-contract change remains for L1
  Integrator composition.

## Explicit state statements

```text
Production changed: NO
Production data/PII read: NO
Migrations/database/RLS changed: NO
Frozen domain changed: NO
Frozen contracts changed: NO
Frozen fixtures changed: NO
Agent 3 scope changed: NO
Common application/root exports changed: NO
App/API/UI changed: NO
Package/config/lock files changed: NO
Deployment performed: NO
Git add/commit/push performed: NO

BASELINE_READY=false
DATABASE_CHANGES_ALLOWED=false
PRODUCTION_CHANGES_ALLOWED=false
MIGRATIONS_ALLOWED=false
L2_PASSED=false
```
