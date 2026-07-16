# Agent 2 workflow validation report

Date: 16 July 2026.
Implementation scope: `lib/project-intelligence/application/workflow/**` only.

## Evidence environment

The canonical checkout has dataless TypeScript/Vitest toolchain artifacts. In particular,
its normal Vitest launcher can return exit `0` without running tests, so no silent/empty
canonical command is counted as a pass.

Trusted runtime validation used the materialized clone:

```text
/private/tmp/pi-agent2-domain-validation
```

Only the owned workflow tree was copied there by this agent. No Git command or mutation
was performed in that clone. Full-suite output also included the concurrently present
Agent 3 application files and is reported as cross-track evidence, not as ownership of
those files.

## Commands and exact results

### Frozen-input integrity in canonical checkout

Command:

```sh
node -e '<read Agent 1 manifest; hash all 51 files and canonical manifest entries>'
```

Result: exit `0`.

```json
{"fileCount":51,"aggregate":"73bec18122badb492dc989904978e4ff9962ca063359f1e6a4d3483720e67eec","bad":[]}
```

### Workflow tests

Command:

```sh
./node_modules/.bin/vitest run lib/project-intelligence/application/workflow/workflow.test.ts
```

Result: exit `0`; **1 file, 18/18 tests passed**.

Coverage includes human review/origin/evidence preservation, AI/system denial, stale
exact revision, immutable V1/V2, stale state/latest/base/revision, confirmed-decision
revision and ChangeSet linkage, required reason/no-op, cross-project denial, replay,
idempotency conflict, rejected-CAS atomicity and deterministic controlled clock/IDs.
Adversarial regressions additionally cover commit-race replay, async caller mutation,
same-ID revision/stable-node tampering, exact version/ChangeSet closure, missing AI
evidence, cross-project loaded state, descendant-draft pending ChangeSet mismatch and
sparse-array canonicalization.

### Domain + Wave 1 integration + workflow targeted suite

Command:

```sh
./node_modules/.bin/vitest run \
  lib/project-intelligence/application/workflow/workflow.test.ts \
  lib/project-intelligence/contract-manifest.test.ts \
  lib/project-intelligence/impact.test.ts \
  lib/project-intelligence/invariants.test.ts \
  lib/project-intelligence/locator.test.ts \
  lib/project-intelligence/review.test.ts \
  lib/project-intelligence/version-diff.test.ts \
  tests/project-intelligence/vertical-slice-contract.integration.test.ts
```

Result: exit `0`; **8 files, 76/76 tests passed**.

### Typecheck

Command:

```sh
npm run typecheck
```

Result in materialized clone: exit `0`, no TypeScript errors.

The same command in the canonical checkout returned exit `2` with missing global types
such as `Array`, `Boolean`, `Object` and `String`; that environment result is classified
as dataless toolchain evidence and is not attributed to the workflow implementation.

### Targeted lint

Command:

```sh
./node_modules/.bin/eslint lib/project-intelligence/application/workflow --ext .ts
```

Result: exit `0`, no findings.

### Full tests

Command:

```sh
npm test
```

Result: exit `0`; **22 files, 156/156 tests passed**.

### Full lint

Command:

```sh
npm run lint
```

Result: exit `0`, no findings.

### Build

Command:

```sh
npm run build
```

Result: exit `0`; Next.js `16.2.10`, compiled, TypeScript checked and 16/16 static pages
generated successfully.

### Synthetic fixture validator/privacy scan

Command:

```sh
node fixtures/project-intelligence/kitchen-worktop/validate.mjs
```

Result: exit `0`.

```text
Fixture validation passed: 17 JSON files, 3 sources, 3 fragments, 3 impacts.
PII/secret/signed-URL scan passed.
```

## Boundary statements

These checks demonstrate L1 application semantics on test adapters. They do not prove
database transactions, restart durability, multi-process idempotency, RLS, production
authorization or L2 readiness.

```text
Production changed: NO
Production data/PII read: NO
Migrations/database changed: NO
Frozen domain/contracts/fixtures changed: NO
Package/config/lock files changed: NO
App/API/UI changed: NO
Deployment performed: NO
Git add/commit/push performed: NO
```
