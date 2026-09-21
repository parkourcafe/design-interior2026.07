# R1-08A sheet-sidecar request door

This package exposes the existing private architect-declared sheet-sidecar command
through the established authenticated ProjectCEO command route. It adds no UI,
read/list API, renderer, representation, object binding, source parsing or
coordinate interpretation.

The thin `projectceo_api.bind_pdf_dwg_sheet_sidecar` wrapper is SECURITY DEFINER
because an invoker wrapper cannot call the private runtime-revoked helper. It is
owned by `pi_table_owner`, has an empty search path, delegates exactly the twelve
bounded arguments and is revoked from every runtime role when the migration is
applied. Only the existing M3 switch may grant its exact signature. The private
helper remains directly inaccessible.

The strict application DTO reuses the complete declared-geometry refinement from
the accepted PDF fallback contract. UUIDs and idempotency components are
canonicalized; sheet identifiers remain exact trimmed case-sensitive text. The
request-bound client is used without a service-role fallback. Package-limited
scope and module-off state are checked before any mutation RPC. The response must
match the exact sidecar identifiers and declared geometry and retain
`architect_declared`, `not_verified`, `unconfirmed` and the mandatory warning.
The returned project state revision is the observed unchanged revision.

Local PostgreSQL 16 loaded the complete product/M2→M3/source-pair/sidecar chain.
Fixture75 proved M3 closed/open/closed ACL behavior, authenticated first-call and
replay, exact +1 sidecar/+1 command/+1 audit effects, zero replay/denial effects,
owner/cross-package/anonymous denial and direct private table/helper denial. All
predecessor overlap and restart fixtures also passed. The owned socket-only
cluster was stopped and removed. Sanitized receipt:
`artifacts/R1_08A_SIDECAR_DOOR_LOCAL_PG16_RECEIPT.json`.

Local lint passed with 13 existing warnings; typecheck, 221 files / 1,839 tests
and Webpack build passed. Independent source/security review passed after adding
the exact effect counts, project-scope success and malformed response/error tests.

PostgreSQL 17, full CI DB4/DB5, AP5 and Claude review remain draft-PR gates. No
shared database, production, deployment, module opening, merge or cloud mutation
was performed.
