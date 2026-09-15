# R1-08A PDF/DWG source-pair confirmation

This repository-only increment confirms the relationship between two existing,
accepted source versions. It does not parse or convert DWG, generate a preview,
create sheet geometry, approve a production package, or change a module flag.

## Contract

The private command accepts a project, package, exact DWG and PDF asset-version
selectors, a bounded reason and an idempotency key. The server derives the
organization, user, active architect authority, immutable source hashes,
revision numbers and complete validation lineage. Both source versions must pass
the existing request-bound readiness assertion with exact profiles:
`dwg-original-retention-v1` and `legacy-pdf-intake-v1`.

The current upload policy must remain write-eligible while locked. Read-only
retention grace cannot create a new confirmation. Authorization and readiness
run before replay, so revoked users cannot retrieve an old result as a new
authorized action.

The append-only receipt stores the exact pair, both hashes/revisions and both
validation/canonical receipt chains. It is transactionally correlated with the
existing command and audit records. Deferred closure constraints are explicitly
managed so valid calls work regardless of the caller's incoming constraint mode,
and are forced before the command returns. The result timestamp is serialized in
UTC, so exact replay is independent of session timezone.

The fixed result states `confirmationStatus=architect_confirmed`,
`conversionStatus=unconfirmed` and includes the mandatory warning:
`PDF предоставлен архитектором; DWG conversion не подтверждён`.

The table and all helper/command functions are private to `pi_table_owner`.
PUBLIC, anon, authenticated, service_role, pi_human_executor and
pi_worker_executor receive no direct table or function access. Runtime exposure
is outside this package.

## Verification

Migration: `20260915184027_r1_pdf_dwg_source_pair.sql`.

Final source hashes:

- migration: `f7f0de774ac23b04f562beafc490974090ae565bbc335e47d65ae256e28efcdc`;
- DB4 fixture: `8dc792c087a23ff01cd30311963c151d898c01feaa2eb31d09fc1bc48b0df338`;
- sanitized local receipt: `ad3dcc11fbb37d30ae72671ab024b9e86f0f7898f0e2072e142422cdc0dfdaa3`.

Local PostgreSQL 16 loaded the complete migration chain and the existing DB3,
upload, validation, materialization and human-acceptance fixtures. The final
fixture passed exact-format readiness, owner/role/scope denials, immutable source
facts, a second accepted PDF pair, same-key conflict, distinct new receipt,
append-only enforcement, command/audit rollback failures and private ACL checks.

The retained synthetic confirmation survived an actual database restart. An
identical same-key request returned the original logical result and created no
extra receipt. The dedicated socket-only cluster was then stopped and deleted.
Sanitized local receipt:
`artifacts/R1_08A_LOCAL_PG16_RECEIPT.json`.

Local lint, typecheck, 1,777 tests and Webpack build passed after the migration
ledger update. PostgreSQL 17, full DB4/DB5 and CI evidence belong to the draft PR
gate and must not be substituted by this local PG16 receipt.

Independent source/security review passed. Two pre-commit findings were fixed:
cyclic receipt/command/audit constraints are explicitly deferred and forced, and
the confirmation timestamp is rendered deterministically in UTC. A final review
also confirmed that the standalone command-without-receipt negative closes the
remaining coverage observation without changing migration or runner behavior.

All file contents, identities and approvals in this fixture are synthetic. This
does not claim a real architect confirmed a real project pair, and it is not DWG
fidelity or production evidence.
