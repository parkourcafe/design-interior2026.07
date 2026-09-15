# R1-04 filtered browser manifest evidence

Date: 2026-09-16. Context: `repository_only`.

## Scope

This increment adds the missing filtered private browser-manifest contract from
INT-R1-04. It starts from `origin/main`
`c683f166941a5a896f0df92b46d9e517780b75aa`, where the stronger
`R1PrivateDeliveryBroker` is already merged. Historical draft PR #161 is not
reused because its ten-line helper is superseded by that broker core.

This slice builds and validates a structural manifest only. It does not
authenticate a request, query memberships/grants, read Storage, return a signed
URL, stream bytes, enforce HTTP headers, deploy a broker or prove Gate 0.

## Implemented and verified

- Exact authenticated-review and guest-release scope branches reject mixed,
  missing, unknown and `undefined` opposite-branch fields.
- Entries contain only opaque asset/representation IDs, SHA-256 digest, version,
  format, current/superseded state, safe display label and bounded transform.
- GLB matrices are exact length 16 with bounded finite values. PDF/PNG use
  page/rotation and normalized crop contracts; sparse arrays fail closed.
- Entries are bounded to 1..500, normalized and sorted by explicit ASCII UUID
  order. Duplicate representation versions are rejected after UUID case
  normalization.
- Revoked access returns a stable denial. Active/grace/archive inputs still emit
  only `broker_recheck_required`, not an authorization result.
- Projection source is deliberately named `structural_manifest_input`; it does
  not claim server authorization. Exact request-bound provenance remains an
  adapter responsibility.
- No locator/token/credential/filename fields are projected. Labels reject
  paths, schemes, controls and the listed R1 filename extensions. Label
  provenance and secret classification remain caller responsibilities.
- Delivery fields are normative `deliveryRequirements`, not claims of observed
  transport behavior.

## Independent Codex/security review

Initial review returned one P1, three P2 and one P3 class of finding: accessor
and input-owned array bypasses, overclaimed projection provenance, malformed
calendar normalization, bidi spoofing and locale-dependent sort. All were fixed
with regressions.

The first follow-up found a remaining Proxy length race that could bypass the
500-entry bound. `arrayValues` now obtains the own length data descriptor once,
applies exact/min/max constraints to that snapshot and never reads the input
array length during iteration. Final review returned `PASS`; the changing-length
Proxy and filename-shaped-label probes both reject.

## Local checks on the final tree

| Check | Result |
| --- | --- |
| `npm run lint` | PASS, 0 errors / 13 pre-existing warnings outside this slice |
| `npm run typecheck` | PASS |
| `npm run test` | CONFLICTING: orchestrator run PASS 216/1786; later independent run FAIL 1/1786 in the pre-existing ClamAV success timing test, whose isolated retry also failed |
| `npm run build -- --webpack` | PASS, 46 static pages generated |
| focused manifest tests | PASS, 32 tests |
| file-scoped ESLint | PASS |
| `git diff --check` | PASS |

Webpack is the supported build equivalent in this symlinked isolated worktree;
a default Turbopack result is not claimed.

The current manifest tests are 32/32 PASS and the changed files do not touch
the scanner. Nevertheless the later independent full-suite failure is the
newest evidence and prevents a package-quality PASS. Draft PR #192 at
`df863021040c734877f1af1a4eadf22b4a86ac53` contains the independently reviewed
test-only startup-latency correction and has green exact-head CI, but it is
owned by the existing R1-08A task and is not copied, merged or claimed here.

## Remaining INT-R1-04 work

Actual request-bound authorization/storage/revocation adapters, the dedicated
HTTP GET/Range broker, response-header verification, private data-plane runtime,
viewer integration, hosted revoke-after-open tests and Gate 0 remain
`UNKNOWN`/unfinished. No production, shared DB, real-file or cloud evidence was
created by this slice.
