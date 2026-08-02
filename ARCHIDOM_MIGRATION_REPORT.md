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
