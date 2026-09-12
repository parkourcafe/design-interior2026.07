# R1 external materialization and legacy isolation

Stacked on private validation PR182. Atomically creates an existing-schema clean
file intake, generated Asset parent/first version, exact typed lineage, system
event/audit and measured source accounting from a verified private completion and
canonical receipt. Original uploader provenance is retained without reauthorizing
a departed uploader; generated display labels are explicitly distinguished from
supplied names. No human acceptance, geometry approval or native publication is
created by this operation.

Existing ten legacy entrypoints preserve their latest bodies and ownership/ACLs
except explicit legacy-only lookup/dedup and replay target guards. New R1 linkage
is stored/immutable, not a browser flag. Legacy format limits and ordinary PDF
workflow remain intact; R1 rows cannot enter legacy storage/download/review/publish
paths even through a poisoned replay. No prior migration is rewritten.

## Allowlist

- supabase/migrations/20260913053000_r1_external_materialization_isolation.sql
- tests/ap1/environment/migration-ledger.sha256
- tests/db4/68_r1_external_materialization_isolation.sql
- tests/db4/run.zsh
- tests/layout-studio/integration/integration.test.ts
- This evidence file.

## Verification

Independent final source/fixture/runner reviews PASS after closing exact
AssetVersion lineage validation. Each new version referencing a known generation
must have its own matching lineage; another version's lineage cannot satisfy it.

Focused PG16/17 passed late-failure rollback, exact byte/provenance/accounting,
legacy direct-RPC isolation and poisoned-replay/dedup checks, observed same-key
materialization lock overlap, no duplicate effects and exact replay postcheck.
The complete synthetic A→B→D chain passed all eight formats: SKP, DWG, GLB,
DAE-package, PDF, JPG, JPEG and PNG. Assertions check extension/MIME/source kind,
exact byte identity and label origin, and force deferred constraints before each
intentional rollback. This does not establish real AV/parser/conversion acceptance.

The published-state legacy negative uses a clearly synthetic owner update within
a rollback block; it is not genuine publication/approval, and no production guard
is disabled. Existing ordinary legacy PDF publication is tested separately.

Local lint/typecheck/1777tests/Webpack build PASS (13 existing lint warnings).
Local tmpfs postchecks ran WITHOUT restart. The permanent DB4 runner commits D
materialization, restarts the database, then checks unchanged exact replay and
accounting/counts. Current-head CI/AP5 and actual persistent restart proof remain
pending. Dedicated Claude code review is externally blocked by provider limits.

No runtime grants, real principal/entitlement seeds, shared DB, production, deploy
or flags changed. Broker transport, human acceptance/readiness and product UI
remain follow-up requirements; private typed facts alone are not hosted proof.
