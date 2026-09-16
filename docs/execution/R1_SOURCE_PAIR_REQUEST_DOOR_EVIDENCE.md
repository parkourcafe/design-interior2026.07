# R1-08A source-pair request door

This package wires existing private original-source confirmation into the existing
request-bound command endpoint. It does not create a viewer, UI selector, parser,
representation or sheet. No external resources, shared database, flags or deployment
were changed.

The thin `projectceo_api.confirm_pdf_dwg_source_pair` wrapper is SECURITY DEFINER:
a SECURITY INVOKER wrapper could not call the runtime-revoked private command.
The wrapper has no authorization shortcut and delegates all six arguments to the
existing architect-only private command. PUBLIC and runtime privileges are revoked
on migration apply; the existing M3 switch owns only its authenticated EXECUTE.
Private command privileges remain unchanged.

The strict DTO supplies project/package and two immutable AV selectors, bounded
trimmed reason, and the existing commandId-derived idempotency key. Actor, authority,
byte hashes and confirmation are resolved by the database. The adapter validates
the exact integration envelope and source selectors, including the mandatory
unconfirmed conversion status and warning. It never uses service role.

The response stateRevision is the project revision observed by scopeOnly before
execution; it is not a new pair revision, transaction CAS, or part of the immutable
receipt. Database confirmation does not change the workflow revision. Receipt
identity and exact source revisions define this operation's historical identity.

Focused contract/adapter/dispatcher, M3 matrix, registry and supported-command
checks passed locally. Independent review found that accepted uppercase UUIDs
could be compared case-sensitively after the database mutation; selectors and
idempotency components are now canonicalized before scope checks and RPC calls.
The uppercase package-scoped regression passes. Fixture72 also covers another
package, missing Auth claims and replay after the M3 door closes.

The final local quality pass completed with lint (0 errors, 13 existing warnings),
typecheck, 218 files / 1,791 tests, and Webpack build all passing. The M4 command
guardrail explicitly classifies this new command as M3 and outside M4.

DB4 fixture72 requires fixture71 persisted synthetic A/B/D/E data. It exercises
actual authenticated SQL access, M3 close/open/close, private-helper denial,
owner-only denial, exact replay and unchanged workflow revision in a rollback-only
disposable transaction. Root ran the entire migration/source chain on a clean
socket-only PostgreSQL 16 cluster: source-pair behavior, real database restart and
request-door fixture all passed. The owned cluster was stopped and removed.
Sanitized receipt: `artifacts/R1_08A_REQUEST_DOOR_LOCAL_PG16_RECEIPT.json`.

Independent source/security review passed after the UUID fix. PostgreSQL 17,
full DB4/DB5 and hosted AP5/CI remain draft-PR gates. Local mock tests and this
SQL fixture are not hosted PostgREST/browser proof.

Existing disposable `enable-m3-publication.sql` fixture gains the wrapper signature
for its intentionally enabled AP5 environment; editing that file does not execute
it or authorize activation in a shared environment.
