# Disposable clone rehearsal and rollback plan

## Required order

1. Capture a provider backup/snapshot and checksum it outside the application.
2. Restore into a disposable PostgreSQL 17 clone; never point the application at
   production for rehearsal.
3. Load the restored Auth, Storage metadata, legacy tables, and current additive
   migrations. Record row counts and migration ledger before any proposal.
4. Run baseline advisors, then apply one additive candidate at a time.
5. Run DB2–DB5: RLS/read-contract checks, concurrency and idempotency, rollback,
   and browser/Kora acceptance checks.
6. Compare row counts, grants, policies, indexes, query plans, and application
   behavior with the pre-change clone snapshot.
7. Produce a signed diff and a separate human decision for production.

## Rollback

- Index-only change: drop only the named additive index concurrently.
- Policy change: restore the exact pre-change policy definition from the clone
  snapshot; do not use a broad `disable row level security` fallback.
- Function ACL change: restore the captured ACL and legacy function definition.
- Auth configuration: revert the specific dashboard setting after Auth smoke tests.
- Any unexpected data or privilege drift: stop, discard the clone, restore from
  the provider backup, and keep production untouched.

## Exit criteria

The clone is green only when DB2–DB5 pass on PostgreSQL 16 and 17, all five
authenticated Kora sessions retain their intended isolation, replay is
idempotent, rollback is demonstrated, and no public asset leaks production
identifiers. Until then `PRODUCTION_ADOPTION=NO_GO`.

## 2026-07-19 rehearsal result

An ephemeral Supabase branch `archidom-ru-adoption-gate-20260719` was created
and then deleted after the rehearsal. The branch was healthy but had no data or
migrations, as expected from Supabase branch semantics. The provider
`apply_migration` endpoint could apply the frozen legacy baseline, but rejected
the repository's subsequent migrations because it wraps submitted SQL in a
server-side block that is incompatible with repository-level `DO`/PLpgSQL and
role-provisioning statements. No production object was touched and no branch
was retained.

Therefore this is a valid clone-control test, not a completed production clone
rehearsal. DB2–DB5 remain locally green, while the provider-clone gate remains
open until a supported restore/import path can execute the exact migration
chain and load a sanitized Kora fixture.
