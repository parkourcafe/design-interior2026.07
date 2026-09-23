# Dependency-security evidence — 2026-09-23

## Authority and scope

ИЗВЛЕЧЕНО: owner answered «Разрешаю» to a separate local dependency-security WP,
independent review/tests and draft PR, without merge/deploy/production changes.
Branch: codex/dependency-security-20260923, base8a27b93a0877be7998ee6037961c64501d78de00.
WP32 PR208 remains unchanged; this branch does not contain its separate scope fixes.

## Dependency evidence

ИЗВЛЕЧЕНО: baseline npm audit reported12 affected package entries:3 moderate,
8 high,1 critical. Updated lockfile and ordinary npm ci report0 known advisories.
This is registry evidence at the time of the check, not proof of universal safety.

| Package | Before | Locked candidate |
|---|---|---|
| next / eslint-config-next |16.2.12|16.3.6|
| sharp |0.35.3|0.35.4|
| vitest / @vitest/mocker |4.1.10|4.1.11|
| @xmldom/xmldom |0.9.10|0.9.12|
| baseline-browser-mapping |2.10.40|2.11.25|
| brace-expansion |1.1.15; two5.0.7 copies|1.1.21; two5.0.12 copies|
| browserslist |4.28.4|4.29.0|
| fast-uri |3.1.5|3.1.8|
| js-yaml |4.3.0|4.3.2|
| nanoid |3.3.16|3.3.19|
| tar |7.5.19|7.5.22|

ИЗВЛЕЧЕНО: root changes are Next/eslint-config-next minimum^16.3.3, Vitest
minimum^4.1.11 and existing Sharp override0.35.4. React18.3.1, Supabase2.110.7,
SSR0.12.3 and postcss override8.5.25 remain unchanged. Registry/installed package
constraints support Node22.23.0 and existing React18.3.1. No major family migration.

ИЗВЛЕЧЕНО: pre-patch independent inventory was corrected against actual lockfile:
ajv is a direct runtime dependency; fast-uri, postcss and nanoid are not dev-only.
All nested affected copies were checked. Next SWC/Sharp optional platform entries
remain; removed Lightning CSS entries were Vite optional peers. Repository source
search found no explicit Lightning CSS transformer selection; build passes.

ИЗВЛЕЧЕНО: npm10.9.8 lock-only resolution first failed inside Arborist with
`Cannot read properties of null (reading 'edgesOut')`, without changing lockfile.
One-shot npm12.1.0 via npm exec resolved it. Global npm was not upgraded. No force,
legacy-peer-deps, lockfile deletion, install-script bypass during final npm ci,
or blanket npm audit fix was used. Lock-only resolution used ignore-scripts;
subsequent normal npm10.9.8 ci succeeded, preserving CI tool compatibility.

## Local verification

ИЗВЛЕЧЕНО: npm ci and full release:check passed. Final candidate release:check
session83811 exited0 after adding the regression test. A machine-readable full
Vitest rerun reports255 files,2306 passed,0 failed,0 pending. Typecheck/build PASS.
Three new regressions cover manifest/lock alignment, all known advisory-version
floors including nested copies, and real synthetic AVIF→WebP encode/decode/resize
through installed Sharp. The initial new test had strict-indexing type errors;
they were fixed without suppressions and typecheck plus3 focused tests passed.

ИЗВЛЕЧЕНО: lint has0 errors and15 warnings:13 existing unused-variable warnings,
plus newly reported Next lint warnings in unchanged fork-variant-form.tsx:41 and
delete-account.tsx:29 about window.location.assign. No UI edits or suppressions.

ИЗВЛЕЧЕНО: fresh independent read-only candidate review found no concrete blocking
bypass/regression in manifest, lockfile and test. It verified affected copies,
framework peers and optional-platform package retention. It did not execute tests
or inspect deployed services; parent performed local checks independently.

НЕ ПОДТВЕРЖДЕНО: native-image smoke is not an exploit regression or proof of the
Next Windows/AVIF security boundary on every platform. Version floors alone do
not replace audit metadata. No Windows/Linux application build or hosted proof
is claimed. Current macOS Node22 checks do not authorize production deployment.

## Browser acceptance / publication

ИЗВЛЕЧЕНО: authenticated AP5 session93805 exited0:31 expected,0 unexpected,
0 skipped,0 flaky; no-skips validator PASS. Start2026-09-23T01:09:25.430Z,
duration38488.677ms. Real local Auth/PostgREST/RLS, not mocked browser sessions.
Disposable containers removed; host docker ps empty. Temporary session state and
app log removed. Supabase versions, migrations, grants and Auth/RLS code unchanged.

ИЗВЛЕЧЕНО: tested-byte SHA256 bindings (runtime was before commit):
- package.json: ef40fcdae3a0b8fc20d3904cc9a18e560a740f53ae04b8b10b32612e04e3e3ba
- package-lock.json: 2ab2f9878c799f2c60d35843ca75bad06d00d9e4abe576d68708b68be90f0840
- regression test: 86aab808a7584d545e0724185c74822f360ab54152f12da7b54e939a31aaa871
- AP5 results: 3940c37b4225002be954be0f392f7c7f663aa7febfa4d8409d944d706a2daa99

НЕ ПОДТВЕРЖДЕНО: combined integration with unmerged WP32 PR208, hosted behavior
and production rollout. These remain distinct from this standalone dependency
branch's local acceptance. Commit/push/draft PR follow final pre-publication checks.

ИЗВЛЕЧЕНО: final pre-publication npm ci + release:check session60742 exited0:
0 audit advisories,255 files/2306 tests PASS, typecheck/build PASS, lint0 errors/
15 documented warnings. Disposable Colima stop session74894 exited0; VM stopped.
All four workflows remain workflow_dispatch-only; Vercel deploymentEnabled=false.
No automatic CI runs, hosted acceptance, merge or deploy are claimed.

References: [Next AVIF advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4),
[Next Windows advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36).
