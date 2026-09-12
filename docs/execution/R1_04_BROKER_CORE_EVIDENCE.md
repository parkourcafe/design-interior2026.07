# R1-04 private streaming core

This increment implements the broker core over the R1-01 identities branch.
It does not expose a Next.js route or provision a data-plane service.

The exact selector contains project, package, asset version and representation
version. Initial bounded authorization returns the canonical effective scope
before the broker opens a private revocation watch. All four returned UUIDs must
match the pinned request selectors, allowing canonical case normalization only.
Initial denial, cancellation or an unsatisfiable start allocates no watch or
storage read. The watcher uses
the authorized scope; authorization runs again after subscription and before
the first read, covering revocation between the initial check and subscription.
Effective scope and the initial immutable descriptor stay pinned across checks.
Each 256 KiB chunk uses a shared one-second deadline for authorization
and storage access. Storage receives the required expected generation for a
conditional read. Locator, generation, SHA-256 and length stay pinned across
the stream. A private revocation watcher aborts in-flight work, and cancellation
is checked before yield. Adapter errors are reconstructed using only a safe code.
Returned chunks contain bytes and media metadata, not storage URLs or locators.

Valid explicit ranges extending beyond EOF are clamped to the representation's
length, including ranges spanning several chunks. A start at or beyond EOF,
unsafe integers, negative offsets and empty intervals remain invalid. This
matches [RFC 9110 section 14.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.1.2).

PR #175 review correction, 2026-09-12: 14 targeted regression cases failed
against the original core before the fix. Final local checks passed:
`npm run lint` (13 existing warnings, no errors), `npm run typecheck`,
`npm run test -- lib/integration-gateway/r1-delivery/broker.test.ts`
(52 focused tests), `npm run test -- --reporter=dot`
(208 files / 1,709 tests), and `npm run build -- --webpack`.
Tests cover no-watch initial denials, canonical effective scope, the missed-revoke
subscription window, descriptor/scope drift before the first read, cancellation,
range clamping and invalid ranges. Independent candidate review identified initial
scope substitution; four added regressions reproduced it before the correction,
and each now rejects before watch or storage access. The same reviewer confirmed
closure with no further findings; a separate in-memory check confirmed zero watches
and reads for each of the four initial scope substitutions.
The local build uses placeholder support/legal
copy because those public fields are not configured in this disposable checkout.

Baseline verification before this correction: 12 focused tests,
208 files / 1,669 full tests, lint (13 existing
warnings, no errors), typecheck and build passed. Independent read-only review
of an isolated source snapshot passed after correcting generation forwarding
and decorated-error leakage. Later parent integration adds only the independently
reviewed R1-01 private trigger ACL correction; current-head CI must still run.

Remaining INT-R1-04 requirements: database authorization for allowed review
subjects and retained releases, real generation-conditional storage adapter,
revocation subscription, HTTP backpressure/cancellation, private caching headers,
OS/data-plane isolation and integrated proof. Dependency interfaces are not
evidence that those services exist. Gate 0 and real-file delivery stay unverified.
