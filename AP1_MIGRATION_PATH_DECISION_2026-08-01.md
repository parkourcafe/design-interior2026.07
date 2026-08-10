# AP1 Migration Path Decision — 2026-08-01

Status: PROPOSED — separate decision record; no production change performed

## Decision

Use **historical incremental adoption** for an existing production database.
Do not run the clean-bootstrap baseline against production.

The clean-bootstrap path remains a disposable-environment verification path only.
Production adoption requires an explicit baseline-adoption step after schema and
data fingerprint verification, followed by additive migrations in timestamp order.

## Evidence

The repository contains legacy migrations `0001`–`0007` and the guarded migration
`20260716071024_legacy_production_baseline.sql`. That baseline intentionally fails
when any legacy application relation already exists. A clean local replay proved
the failure:

```text
legacy production baseline is clean-bootstrap only;
application relations already exist (SQLSTATE P0001)
```

The baseline itself states that existing production already contains the schema
and has an empty migration ledger. Therefore replaying `0001`–`0007` or executing
the baseline on production would be a duplicate-schema operation.

## Options

| Path | Disposable database | Existing production | Decision |
| --- | --- | --- | --- |
| Clean-bootstrap | Validates the baseline on an empty database | Unsafe: baseline guard must fail when relations exist | Verification only |
| Historical incremental | Starts from the adopted legacy state and applies additive migrations | Compatible after fingerprint gate | **Recommended** |

## Required production sequence

This sequence is a future controlled gate. It has **not** been executed.

1. Create an immutable schema/data snapshot and record the deployed commit.
2. Verify the production fingerprint matches the reviewed legacy baseline.
3. In a transaction, record the legacy baseline as adopted in migration history;
   do not execute its DDL against production.
4. Apply only subsequent additive migrations in exact timestamp order, stopping
   on the first mismatch or failed post-migration assertion.
5. Verify tables, functions, RLS, storage, RPC contracts, and rollback notes.
6. Run authenticated AP1 checks and retain the complete evidence bundle.

The adoption step must be a separately reviewed migration/reconciliation change;
it must not rewrite timestamped migrations, remove the baseline guard, or mark a
version applied without a matching fingerprint.

## Rollback and safety

- No destructive migration is permitted.
- No production migration is permitted from this decision record alone.
- If the fingerprint differs, stop and update the Conflict Register.
- If any additive migration fails, stop before the next version and restore using
  the approved recovery procedure; do not edit migration history to hide failure.
- The disposable clean-bootstrap replay must remain available as an independent
  regression check.

## Acceptance gate

This decision is accepted only when a separate reconciliation PR contains the
snapshot, fingerprint comparison, baseline-adoption SQL, ordered replay log,
post-migration verification, and rollback evidence. Until then:

`PLATFORM_FOUNDATION = BLOCKED`

and production remains unchanged.
