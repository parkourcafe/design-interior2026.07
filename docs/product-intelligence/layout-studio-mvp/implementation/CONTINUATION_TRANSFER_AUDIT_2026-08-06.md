# ArchiDom Layout Studio M2 — continuation transfer audit

Date: 2026-08-06  
Target branch: `codex/archidom-layout-studio-m2`  
Base closeout: `1978b27`  
Transferred continuation commits: `0c20a54`, `b2e1dd6`

## Result

The two continuation commits are replayed on the target history. The module remains
default-off and no production merge was performed. This audit does not grant a merge
decision: owner survey holds in the acceptance ledger and authenticated in-module
visual QA remain separate gates.

## Remediation applied during audit

- The exact frozen `archidom.layout-document/0.1` JSON Schema is now enforced at runtime
  with AJV before semantic validation.
- Runtime types and the Three light adapter now follow the frozen `linear_proxy` contract;
  polygon clearance zones follow the frozen schema.
- Exact-version export now fails closed on invalid schema content or a semantic-hash
  mismatch, in addition to the existing privacy gate and artifact checksum manifest.
- `/app/layout-studio/**` is included in the authenticated proxy matcher as well as
  `/dashboard/**`.
- Next.js/PostCSS and transitive vulnerable packages were upgraded without a force or
  major dependency migration. `npm audit` reports zero known vulnerabilities.
- Dead continuation adapters that duplicated and conflicted with the stronger target
  implementations were removed during cherry-pick resolution.

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| Lint | PASS with 10 inherited warnings, 0 errors | `npm run lint` |
| TypeScript strict | PASS | `npm run typecheck` |
| Full tests | PASS: 70 files, 405 tests | `npm run test` |
| Layout Studio tests | PASS: 14 files, 77 tests | `npx vitest run tests/layout-studio` |
| Production build | PASS on Next.js 16.3.0 | `npm run build` |
| Dependency audit | PASS: 0 vulnerabilities | `npm audit` |
| Frozen schema checksum | PASS | `5ac7210f2b89950c93465c3486956a2a71012bc3db32013b52309989e3b0c5d6` |
| Diff whitespace | PASS | `git diff --check` |

## Export audit

JSON, SVG, GLB and print exports are generated only from an immutable published version.
Tests verify exact-version binding after a newer version exists, byte-level SHA-256
manifest checksums, stable IDs, GLB metadata, privacy rejection for local paths/email/
tokens/signed URLs/localStorage references, and fail-closed behavior for schema or
semantic-hash corruption.

## Browser audit

Production server and real headless Chromium were used through the DevTools protocol.
The `/login` page rendered meaningful content and all expected controls with no Next.js
error overlay. An unauthenticated request to `/app/layout-studio` redirected to `/login`,
confirming the corrected proxy matcher. The actual editor was not bypassed for the audit:
an authenticated Supabase browser session is required for final visual interaction QA.

## Security audit

A full Standard Codex Security inventory reviewed 674 repository items. The audit covered
authentication/route gating, schema and command integrity, persistence/versioning, export
privacy/integrity, dependency supply chain, secret patterns and dangerous browser sinks.
No reportable code finding remained after remediation. A final scan must be attached to the
post-remediation commit because the first scan correctly warned that the working tree changed
while it was running.

## Honest gate status

- Code, test, build, export-contract, dependency and unauthenticated browser gates: PASS.
- Authenticated editor visual/interactions: PENDING real role session.
- KORA survey-dependent geometry rows marked `EXTERNAL_HOLD` in the acceptance ledger:
  still open and not converted into assumptions.
- Production merge: NOT AUTHORIZED.
