# R1-04 private streaming core

This increment implements the broker core over the R1-01 identities branch.
It does not expose a Next.js route or provision a data-plane service.

The exact selector contains project, package, asset version and representation
version. Each 256 KiB chunk uses a shared one-second deadline for authorization
and storage access. Storage receives the required expected generation for a
conditional read. Locator, generation, SHA-256 and length stay pinned across
the stream. A private revocation watcher aborts in-flight work, and cancellation
is checked before yield. Adapter errors are reconstructed using only a safe code.
Returned chunks contain bytes and media metadata, not storage URLs or locators.

Verification: 12 focused tests, 208 files / 1,669 full tests, lint (13 existing
warnings, no errors), typecheck and build passed. Independent read-only review
of an isolated source snapshot passed after correcting generation forwarding
and decorated-error leakage. Later parent integration adds only the independently
reviewed R1-01 private trigger ACL correction; current-head CI must still run.

Remaining INT-R1-04 requirements: database authorization for allowed review
subjects and retained releases, real generation-conditional storage adapter,
revocation subscription, HTTP backpressure/cancellation, private caching headers,
OS/data-plane isolation and integrated proof. Dependency interfaces are not
evidence that those services exist. Gate 0 and real-file delivery stay unverified.
