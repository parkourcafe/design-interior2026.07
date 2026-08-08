# Migration report — 2026-08-02

Status: **RECONCILED for clean clones; production adoption BLOCKED pending gate**.

The filename-ordered chain now contains 24 additive migrations. The two latest
fixes preserve the complete legacy M1/M3/M4 command/audit unions and correct
project-wide M2 package scoping. Clean replay, migration ledger hashes, DB4 and
DB5 harnesses pass on PostgreSQL 16 and 17. Existing timestamped migrations were
not rewritten. Production was not replayed or changed.

Migration-path decision: clean-bootstrap for new/disposable environments;
historical production ledger remains grandfathered. See
`docs/product-intelligence/agent-runs/db-wave/MIGRATION_PATH_DECISION_2026-08-02.md`.

## Hosted preview bootstrap gate

The first hosted Supabase Preview attempt failed before migration application
because the runner could not `SET ROLE pi_table_owner` (`SQLSTATE 42501`). The
existing guarded `supabase/roles.sql` bootstrap was applied manually to the
disposable Preview project only. It created the three NOLOGIN/NOINHERIT private
roles and granted membership to `postgres`; production was not touched. The
Preview check must now be rerun against that prepared disposable project.
