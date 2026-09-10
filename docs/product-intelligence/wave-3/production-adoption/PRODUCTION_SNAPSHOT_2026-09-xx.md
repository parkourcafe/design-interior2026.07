# RemHaOS — Production read-only snapshot — 2026-09-xx

Status: `OWNER_INPUT_REQUIRED`

Snapshot contract: `remhaos-production-catalog/2.0`

Production changed: `false`

## Owner procedure

1. Open the Supabase SQL Editor for the production project.
2. Run `docs/product-intelligence/agent-runs/db-wave/PRODUCTION_READONLY_AUDIT_v2.sql` without edits.
3. Download the single `production_schema_snapshot` result as JSON.
4. Keep the raw JSON outside the repository until it has been checked for unexpected content.
5. Run the local fingerprint command documented in
   `PRODUCTION_READ_ONLY_FINGERPRINT_2026-09-xx.md`.

The query reads PostgreSQL catalogs and the migration ledger only. It does not
read application rows, Auth identities, Storage objects, filenames or file
contents, and it performs no DDL or DML.

## Capture receipt

| Field | Value |
|---|---|
| Captured at | `PENDING` |
| Operator | `PENDING` |
| PostgreSQL version | `PENDING` |
| Snapshot contract | `PENDING` |
| Raw JSON retained outside repository | `PENDING` |
| Production changed | `false` |

## Catalog inventory

Fill this section from the generated fingerprint. Counts describe catalog
objects and grants; they are not business-row counts.

| Category | Count | Review state |
|---|---:|---|
| schemas | `PENDING` | `PENDING` |
| relations | `PENDING` | `PENDING` |
| routines | `PENDING` | `PENDING` |
| policies | `PENDING` | `PENDING` |
| grants | `PENDING` | `PENDING` |
| migration_ledger | `PENDING` | `PENDING` |

## Drift and gate result

- Fingerprint: `PENDING`
- Drift CSV generated: `PENDING`
- Every `REVIEW_REQUIRED`, `BASELINE_REQUIRED` and `BLOCKER` row classified: `PENDING`
- Production adoption: `NO_GO` until the reconciliation and owner approvals are complete.
