# R1-11 lifecycle dry-run evidence

Date: 2026-09-15. Context: `repository_only`.

## Scope

This increment replaces the original scalar retention classifier from draft PR
#164 with a deterministic, fail-closed dry-run plan for the external-file
lifecycle contract in MASTER section 12, INT-R1-11 and acceptance cases T27-T30.
It performs no deletion, Storage/provider call, job scheduling, production write
or shared-database mutation. Every result carries
`destructiveActionAuthorized: false`.

The branch was normally merged with `origin/main` at
`c683f166941a5a896f0df92b46d9e517780b75aa` before implementation. No rebase or
history rewrite was used.

## Implemented and verified

- Exact 30 x 24 hour UTC grace is derived only from a typed
  `retention_grace_started` server-ledger projection.
- Active entitlement preserves read/write and requires a cancel event when a
  grace exists before any purge claim.
- Grace sets `read=true` and `write=false` in the dry-run plan; export
  enforcement remains outside this increment and `UNKNOWN`. Expiry only
  produces `eligible_for_owner_review`, never an automatic deletion instruction.
- Holds do not grant access. A zero-progress post-claim hold is distinct from a
  true partial purge.
- Live shared references, canonical LayoutDocument scope and oversized target
  sets fail closed before and after a claim.
- Claimed work cannot resume without an exact matching worker fence; stale and
  absent fences have separate safe outcomes.
- Tombstones keep access closed, backup deletion remains a separate unverified
  policy, and restore is required to reapply the tombstone before access.
- Plan output is field-bounded and contains no filename, path, URL, token or
  content. Observability contains policy/state/count metadata; grace provenance
  is emitted separately in the grace result.

## Independent review

The first independent Codex/security review returned two P1 and two P2
findings: post-claim blockers were ordered after the resume path, a missing
worker fence failed open, zero-progress hold was labelled partial, and the grace
input did not represent ledger provenance. Regression coverage was added for
all four findings.

The final focused follow-up returned `PASS` for this dry-run slice after the
server-ledger source, event ID, event sequence, scope revision, event kind and
policy version became mandatory and runtime-validated. The reviewer ran 32
focused tests and typecheck. Actual database-ledger authenticity and adapter
projection correctness remain `UNKNOWN`; there is no caller or persistence
adapter in this increment.

## Local checks on the final working tree

| Check | Result |
| --- | --- |
| `npm run lint` | PASS with 0 errors and 13 pre-existing warnings outside this slice |
| `npm run typecheck` | PASS |
| `npm run test` | PASS, 216 files / 1786 tests |
| `npm run build -- --webpack` | PASS, 46 static pages generated |
| focused `vitest` | PASS, 32 tests |
| file-scoped ESLint | PASS |
| `git diff --check` | PASS |

The first full-suite attempt had one timing failure in the pre-existing ClamAV
subprocess test. Its exact focused retry passed 15/15 and the single permitted
full-suite rerun passed 1786/1786. No scanner source or test was changed.

The default Turbopack build was attempted and failed because this isolated
worktree uses an ignored `node_modules` symlink outside the filesystem root.
The project-supported Webpack build above passed; this is an environment
limitation, not a claim that the Turbopack command passed.

## Remaining package work

This is a reviewed domain dry-run increment, not full INT-R1-11 acceptance.
Still required in a later dependency-complete slice: additive private retention
ledger/projection persistence, request-bound adapter integration, same-lock
renewal/reference/hold-versus-claim races, durable purge claims/outcomes, worker
restart/idempotency, and backup/restore rehearsal. Production destructive
retention stays prohibited until the canonical LayoutDocument policy conflict,
legal/audit/backup policy and separate owner gate are resolved.
