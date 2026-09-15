# R1-06 viewer-state contract evidence

Date: 2026-09-16. Context: `repository_only`.

## Scope

This increment replaces the original seven-line draft PR #169 helper with a
strict, versioned browser-state DTO validator for the repository-only part of
INT-R1-06. It does not fetch bytes, authorize a user, issue a Storage URL,
render a browser view, parse a source file or prove private broker behavior.

The branch was normally merged with `origin/main`
`c683f166941a5a896f0df92b46d9e517780b75aa` before implementation. No rebase,
migration, shared runtime or production action was used.

## Implemented and verified

- Authenticated review scope is exact Project/Package/Submission; guest scope
  is exact Project/Package/Release/Grant ID. Mixed and unknown fields fail.
- Representation version ID, lowercase SHA-256 digest, format and lifecycle
  are mandatory. Access lifecycle/evidence is separate from representation
  current/superseded history.
- GLB uses a bounded 3D camera; PDF/PNG use bounded 2D state, with integer PDF
  page, page-less PNG and normalized optional selection regions.
- Selection is bound to the exact representation digest and an opaque object
  ID. Sparse arrays, non-finite numbers, format/camera mismatch and unsafe
  region geometry fail closed.
- Output contains no raw URL, redirect, token, storage key or source path.
  Display labels reject slash-bearing paths, leading URI schemes, known source
  filename extensions and control characters.
- Revoked access emits `deny_revoked`. Other states emit only
  `broker_authorization_required`; they are not represented as authorization.
- Cache, broker reauthorization, one-second Range checking and locator rules
  are emitted as `deliveryRequirements`, not as claims that a transport already
  enforces them.

## Independent review

Fresh Codex specification/security review returned two P1, three P2 and one P3
finding: authorization-like booleans, runtime-guarantee overclaims, sparse-array
bypass, access/history conflation, opposite-variant `undefined` bypass and a
subnormal normalized-region edge. All were corrected with regressions.

The first follow-up found one remaining opposite-scope `undefined` bypass; both
scope branches now use own-property checks. Final focused follow-up returned
`PASS`, 37/37 tests. Evidence review then found that `javascript:` was not
rejected as a display-label URI scheme; the validator and regression were
strengthened, with the final focused suite passing 38/38.

A late independent child-review result then identified original-filename-shaped
labels such as `Ivanov-plan.pdf`. Known R1 source/representation extensions are
now rejected; the prior published head is historical and a new exact head is
required before current-head evidence can be claimed.

## Local checks

| Check | Result |
| --- | --- |
| `npm run lint` | PASS with 0 errors and 13 pre-existing warnings outside this slice |
| `npm run typecheck` | PASS |
| `npm run test` | PASS, 216 files / 1793 tests on the final tree |
| `npm run build -- --webpack` | PASS, 46 static pages generated |
| focused viewer tests | PASS, 39 tests on the final tree |
| file-scoped ESLint | PASS |
| `git diff --check` | PASS |

The first full-suite attempt had the known ClamAV subprocess timing failure.
Its exact focused retry passed 15/15 and the single full-suite rerun passed
1791/1791. After the final display-label hardening, the final full suite passed
1792/1792 before the late display-label correction. Scanner code and tests were
not changed; final-tree focused/full results are 39/39 and 1793/1793.

Webpack is the supported build equivalent used in this symlinked isolated
worktree. A default Turbopack result is not claimed.

## Remaining package work

This is a validated DTO/domain slice, not full INT-R1-06 acceptance. Real
request-bound identity/grant/membership/retention enforcement, broker GET/Range
revocation, storage streaming, authenticated and guest callers, 2D/3D rendering,
private-view UI, accessibility and synthetic browser acceptance remain
`UNKNOWN`/unfinished. No production, hosted or real-file evidence exists here.
