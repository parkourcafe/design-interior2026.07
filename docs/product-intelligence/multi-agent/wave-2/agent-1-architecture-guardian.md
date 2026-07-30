# Agent 1 ТЗ — Architecture Guardian & Acceptance Oracle

## Mission

Независимо проверить, что Architecture v1 и L1 ТЗ непротиворечивы frozen contracts, и
создать автоматический acceptance oracle. В первом проходе не ревьюить незавершённый код;
после handoff Agent 2/3 выполнить отдельный post-implementation audit по команде
Integrator.

## Read first

1. `docs/product-intelligence/architecture-v1.md`
2. `docs/product-intelligence/vertical-slice-l1-spec.md`
3. `docs/product-intelligence/domain/contract-v0.1.md`
4. `docs/product-intelligence/vertical-slice/**`
5. `docs/product-intelligence/agent-runs/INTEGRATION_REPORT.md`
6. `lib/project-intelligence/**` и synthetic fixtures

## Exclusive write scope

- `tests/project-intelligence/application/architecture/**`
- `docs/product-intelligence/agent-runs/wave-2/agent-1/**`

Everything else is read-only.

## Pass 1 deliverables

1. `frozen-input-manifest.json`:
   - sorted relative file paths;
   - SHA-256 per frozen domain/contract/fixture file;
   - aggregate SHA-256 over canonical manifest entries;
   - no timestamps inside hashed content.
2. `acceptance-matrix.md`:
   - each L1 DoD item;
   - evidence expected from Agent 2, Agent 3 or Integrator;
   - negative/security cases;
   - state `preparable / blocked` with exact reason.
3. `architecture-v1.contract.test.ts`:
   - verifies required docs/frozen inputs exist;
   - verifies manifest hashes;
   - verifies application production files, when present, do not import Next.js,
     Supabase, app routes, storage or vendor SDKs;
   - verifies no test adapter is exported by production application indices;
   - verifies Agent 2/3 exclusive trees do not modify frozen domain by relying on the
     manifest, not Git;
   - may initially fail only because an expected implementation tree is not yet present;
     document this clearly.
4. `STATUS.md` with commands/results/findings.

Do not create business implementation or root integration test.

## Pass 2 deliverables

After Integrator reactivates you:

- inspect exact Agent 2/3 `files_changed` lists;
- rerun oracle and their targeted tests;
- check actor/time trust boundary, project closure, immutable versions, command
  idempotency semantics, no partial mutation, deterministic ordering/hash;
- classify findings `P0 blocker / P1 before L2 / P2 follow-up`;
- update `STATUS.md` and add `implementation-audit.md`;
- do not fix their code; send exact evidence to Integrator.

## Acceptance rules

- Hash manifest reproducible across reruns.
- Static checks use AST/import text or narrowly scoped file inspection; do not scan
  `node_modules`, `.next`, `.git` or unrelated product code.
- No false claim that static checks prove auth/RLS/durability.
- Missing implementation during Pass 1 is `pending`, not architecture failure.
- Existing Wave 1 files are not reformatted or rewritten.

## Stop conditions

Stop and report if a frozen file is unreadable/dataless, if a hash changes during your
run, or if work would require writing outside ownership.

## Required final message

Return status, exact changed files, aggregate frozen hash, test results, blockers and a
plain statement that production/migrations/frozen inputs were not changed.
