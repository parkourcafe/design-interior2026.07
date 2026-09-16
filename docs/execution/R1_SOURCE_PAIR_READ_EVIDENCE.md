# R1-08A historical source-pair read

This package provides an exact-confirmation-ID read RPC and request-bound adapter,
not a list, UI, preview, current source-readiness check or byte-access endpoint.
The result is the existing immutable pair projection only: exact versions/digests,
confirmation status/time and the mandatory unconfirmed-DWG warning. Reason, signer,
validation/intake/generation IDs and private locators are excluded.

The reader is default revoked and included in the M3 module signature registry.
It also checks the existing effective M3 read gate internally. Current view_project
capability and a scoped active owner/architect witness are required, with membership
locks and post-wait reauthorization before receipt lookup. A project builder with
an exact target-package architect role may read that package; builder/client roles
alone cannot read unpublished authoring evidence. This is not architect signing
permission. Original signer/source-policy changes do not erase historical receipts.

The app adapter refuses module-off before RPC, validates and canonicalizes three
UUID selectors, and rejects result identity mismatch or extra fields. Its optional
module-config argument is server configuration/test injection, never a browser DTO.
The shared source-pair result validator is reused by the confirmation adapter.
Read RPCs are represented separately from mutation commands in the M3 matrix.

Final source hashes:

- migration: `72bea3d3a579b41f2b54838f183bd9ff93d3c013f5825c49db49ef49181bf664`;
- fixture73: `c4369f056ddfe632888250f0e8a5bec0c90c8a1b1a78cca26501504cb591501e`.

Local focused checks passed. The final project quality pass completed with lint
(0 errors, 13 existing warnings), typecheck, 219 files / 1,803 tests and Webpack
build all passing.

Root executed fixture73 against genuine persisted synthetic A/B/D/E→71 data in
a clean socket-only PostgreSQL 16 cluster. M3 closed/partial-grant/open/reclosed,
roles/scope, package-only authority, client/private ACL denial, safe unknown ID,
historical read, exact output and zero-write checks passed. The same exact result
survived a real database restart. Two real connection races passed: revocation
first blocked then denied the read; read first completed while revocation waited.
The owned cluster was stopped and removed. Sanitized receipt:
`artifacts/R1_08A_READ_LOCAL_PG16_RECEIPT.json`.

PostgreSQL 17, full CI DB4/DB5, AP5 and Claude review remain draft-PR gates.
No shared database, production, flags, merge or deploy action was performed.
Editing disposable enable-m3-publication.sql did not execute it outside local
rollback/test environments.
