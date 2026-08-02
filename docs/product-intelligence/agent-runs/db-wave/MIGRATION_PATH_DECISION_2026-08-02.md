# Production migration-path decision — 2026-08-02

Status: **clean-bootstrap is the only proven bootstrap path; production history remains grandfathered**

## Evidence

- The canonical branch contains a tested timestamped chain beginning with
  `20260716071024_legacy_production_baseline.sql` and ending with the current
  additive Auth Hook migrations.
- A clean disposable replay passed on PostgreSQL 16 and PostgreSQL 17,
  including schema, ACL/RLS, rollback, concurrency, restart and Auth Hook
  assertions.
- Production `ztnycrchwxqczqbyegnp` has a different 13-entry migration ledger
  (`0007`, `0008`, `0009` plus ten unrelated timestamped records) and a
  materially different public governed-M1 runtime. The production ledger does
  not prove that the canonical branch migrations are pending.
- The clean-bootstrap baseline is guarded to fail when application relations
  already exist. Running it against production would therefore be unsafe and
  would not be a compatibility bridge.

## Decision

### New or disposable environments

Use the canonical clean-bootstrap chain only. Apply migrations in filename order,
verify the ledger after every file, and run the DB2 harness on PostgreSQL 16 and
17. This is the path already proven by the replay evidence.

### Existing production

Do **not** replay the historical branch chain and do **not** mark the clean
bootstrap baseline as applied. Keep the existing production schema and ledger as
the source of truth for the deployed product. Production changes must be
forward-only, additive migrations written against a fresh production schema
snapshot and accompanied by a compatibility bridge where an API contract is
actually missing.

The 2026-08-02 production gate changed only the custom Auth Token Hook function
and its Supabase Auth Hook registration. It did not mutate application data or
the migration ledger.

## Next implementation gate

1. Capture and checksum a complete production schema/ACL/RLS snapshot, not only
   the REST/OpenAPI shape.
2. Map each required M1 contract to the existing production public tables/RPCs;
   classify every item as compatible, bridgeable additively, or blocked.
3. Implement only the smallest additive compatibility bridge for items proven
   missing; validate it on a disposable clone and with rollback/restart tests.
4. Re-run the authenticated M1 flow and browser QA against that clone.
5. Treat production adoption as a separate controlled gate; no historical
   migration replay is implied by this document.

## Current consequence

The repository is reconciled and the clean-bootstrap foundation is reproducible,
but production adoption is not yet proven. Therefore Platform Foundation and the
M1 vertical workflow remain `PARTIAL`, and `READY_FOR_MODULE_2` remains `NO`.
