# WP-32 — local disposable preflight evidence

## Superseding verified update — 2026-09-23

- ИЗВЛЕЧЕНО: post-fix canonical wrapper session13598 exited0 at `2026-09-22T20:31:59.000Z`, both wrapper markers and DB4 PG16/17 PASS. PASS SHA256 `a66b44b5d94c39609700513555fd8b16b5066e6d871a0f87b0b266076e0cb2cc`; permanent copy `../backups/WP32_PASS_POSTSQL_20260923.json`. Receipt pins reviewed executor `sha256:434d136440106668a319d5da44760836bde23f39880d60024b827c33760dafff`. Host-level `docker ps` against only the disposable socket returned no containers after cleanup.
- ИЗВЛЕЧЕНО: post-fix release:check passed (256 files/2319 tests; lint0 errors/13 existing warnings, typecheck/build PASS). Independent full changed-source review found an inherited manifest→SQL diagnostic interpolation; minimal quoting fix passed fresh independent review,8 focused tests and real network-none PG16/PG17 probes. No business rows were seeded for those probes; both probe containers disposed.
- НЕ ПОДТВЕРЖДЕНО: full external baseline→release→M4/source provenance and hosted acceptance remain open. The existing external PASS marker still covers five M2→M3 operations only. This latest runtime is a reviewed dirty-snapshot run, not yet a final committed-head run.

- ИЗВЛЕЧЕНО: recovery branch `codex/remhaos-recovery-20260922`, base `8a27b93a0877be7998ee6037961c64501d78de00`, contains uncommitted follow-up repairs. Historical branch/base/blocker claims below describe earlier runs.
- ИЗВЛЕЧЕНО: canonical wrapper PASS at `2026-09-22T19:23:09.135Z`, artifact SHA-256 `7df0e447af56d8579262107938661001fd67b7c4d0486c9b476ee63891c5646f`. DB4 PG16/PG17 and supported Kora plus five-operation external scope passed; see [reconciliation](WP-32_RECONCILIATION_2026-09-22.md).
- ИЗВЛЕЧЕНО: local authenticated AP5 session73078 exited 0: 31 expected, 0 unexpected, 0 skipped, 0 flaky; report start `2026-09-22T19:59:00.369Z`, duration 37049.835 ms. `AP5_NO_SKIPS_OK skipped=0 passed=31`. Command: `npm run test:ap5 -- --trace off`, real disposable Auth/PostgREST/RLS and localhost application, one worker and no retries.
- ИЗВЛЕЧЕНО: AP5 results SHA-256 `019d56ec6d625a655ece45be6cf702d83952c484ebf59e05854b60fae812f8b2`; temporary orchestration source SHA-256 `cf36736b337b1c7f929e8ad6c8a00b31f3a16c91ed8ef6c90874f4cb80d79c40`. Build passed before browser execution. Disposable teardown completed; `tests/ap5/.state` and temporary app log absence verified after process exit.
- ИЗВЛЕЧЕНО: earlier AP5 attempt67567 had 29 passed, 1 failed, 1 skipped because launcher omitted local DB_URL for the existing ANALYZE step. No assertions or product authorization were weakened. Retry used CLI-provided local DB_URL in memory after loopback/port59622 validation. Profile loading used fresh SUPABASE_HOME, no keyring and explicit built-in SUPABASE_PROFILE; global credentials were not inspected or changed.
- НЕ ПОДТВЕРЖДЕНО: final exact-commit integrated acceptance/review, full external Tashkent baseline→release→M4 and external source provenance remain open. These dirty-snapshot local passes do not prove hosted/production readiness or authorize production, shared environments, paid calls, CI/Vercel re-enablement or merge. No new follow-up PR published.

Base: `e992255d9e8419843b174926bedf85d93c9a9bd6`.
Branch: `codex/wp32-ap6-run-cycle7`.
Status: canonical wrapper PASS for its existing scope; full WP-32 acceptance remains pending review and external M4 coverage.

## Verified update — 2026-09-17

- ИЗВЛЕЧЕНО: canonical wrapper exited 0 and emitted `KORA_LOCAL_AUTHENTICATED_PASS` and `EXTERNAL_REAL_PACKAGE_PASS` at `2026-09-17T09:52:17.341Z`. The PASS artifact SHA-256 is `b270a385188690257c446d416b2bd34d52befb978290046706eb84a2823f114a`.
- ИЗВЛЕЧЕНО: receipt commands now preserve separate HTTP `requestId` and database `auditRequestId`. Audit proof retains the original database marker and digest. The validator no longer overwrites a child request ID to satisfy parent equality. Audit rows are ordered by resulting state revision; privacy uses a distinct, already performed architect request.
- ИЗВЛЕЧЕНО: final executor SHA-256 is `42a7fd934bf2b25148c1d5db171121fdd4df5646edb9731ddd8f5205b59b3f0f`.
- ИЗВЛЕЧЕНО: lint completed with 0 errors and 13 warnings; typecheck, 224 test files / 1885 tests, build and diff-check passed after the runtime run. Adversarial tests reject forged audit request IDs even when the proof digest is recomputed, and reject an unbound parent request.
- ИЗВЛЕЧЕНО: both PostgreSQL 16 and PostgreSQL 17 DB4 harnesses passed in the canonical run.
- НЕ ПОДТВЕРЖДЕНО: this wrapper does not prove Tashkent baseline → release → M4 → milestone acceptance; its external receipt covers the five M2-to-M3 operations. Independent security review and GitHub publication have not been completed by this update.

The earlier blocker notes below are historical and are superseded by this update where contradicted.

Owner approved: local disposable WP-32 run on the existing Tashkent manifest with subsequent dispose. Google Drive is excluded. No production/shared DB or workflow_dispatch authorization.

## Verified blockers before runtime startup

1. Wrapper selects Docker socket `.colima/archidom-ap1-disposable/docker.sock`, but `tests/ap1/environment/run-local.zsh:11` accepts only `.colima/archidom-ap1/docker.sock`. Direct invocation of launcher `version` with the approved socket exits 65 with `AP1_DOCKER_HOST_REJECTED`. No stack starts.
2. External runner validates `scope.roomId` as a UUID alongside organization/project/package UUIDs, but the canonical Tashkent manifest uses `tashkent-ground-floor-living-kitchen`. This necessarily fails scope validation. Room identifiers must retain their existing bounded entity-ID contract; UUID guards for actual SQL scope IDs must remain.

## Required narrowly scoped follow-up

- Align launcher with the approved disposable profile, retaining reject-by-default socket validation.
- Validate room ID separately as a bounded entity ID, retaining UUID validation for organization/project/package.
- Add offline regressions for both exact canonical inputs.
- Independent Codex security review and full tests/build.
- Freeze runner bytes and request exact final SHA approval before updating H15 allowlist.

Owner explicitly approved the narrow local repair with «da». Launcher now selects and permits only the canonical disposable profile (plus the unchanged Actions exception). Runner preserves UUID validation for SQL scope IDs and validates raw room JSON as a bounded entity ID before shell extraction. Executable regressions cover canonical inputs and unsafe values. Independent Codex review found a trailing-newline extraction edge; fixed with absolute jq anchors and raw-JSON regressions, re-review PASS. Full checks remain pending dependency installation. H15 allowlist remains unchanged and runtime is still gated on final executor SHA approval. No containers/VM were started; no data was created, so there is no newly started runtime requiring dispose. No PASS receipt was minted.

## Final repair verification (supersedes pending checks above)

- Targeted suites: 2 files, 38/38 tests PASS.
- Lint: 0 errors / 13 pre-existing warnings; typecheck PASS.
- Full tests: 222/223 files, 1871/1872 tests PASS. Sole failure is the intentionally stale external-runner allowlist digest; no other failure.
- Webpack production build PASS, 46 static pages. Shell syntax and diff-check PASS.
- Dependency registry installation failed/stalled; partial installs were preserved in explicit `/private/tmp` directories. Tests/build use an existing dependency installation with a byte-identical package-lock through a local symlink; no lockfile/version change.
- Stable candidate runner SHA: `sha256:5c2768a51f258addb251594e57c40a38df630e0965601e59f2fa7541ddeea2e1`.
- Wrapper SHA remains the previously approved `sha256:cdc0cceb66b55fc4ca0f0deca1a638597d74bb8f5e36e89d11f791539d587a35`; no wrapper change.
- Next gate: owner approval of the single runner allowlist replacement from `495c121f…` to `5c2768a5…`. No trust update, commit/push, runtime or PASS receipt yet.

## Standing local approval and first runtime attempt

Owner explicitly removed intermediate local approval stops. This supersedes the preceding single-SHA gate for reviewed local WP-32 repair bytes. Runner allowlist updated to the verified `5c2768a5…` digest. Full sequential retry: 223/223 files,1872/1872 tests PASS; process suites isolated43/43 PASS. A concurrent VM-start run had three process/cleanup timing failures; they are not erased by the retries.

Disposable Colima profile started with global-context activation/config rewrite/SSH-config modification disabled. Docker profile was empty. Protected wrapper invoked on Tashkent manifest with separate EXIT stop handler. Native Supabase start remained silent for several minutes with no Docker images or containers created. Its own TERM did not exit; exact verified native process was terminated, and explicit Colima stop completed successfully (VM state stopped). Remaining known runner/redactor processes were terminated only after dispose. No PASS/receipt, business data or hosted evidence was generated. CLI startup cause remains UNKNOWN; further bounded local diagnosis is permitted without a new owner approval. Production/shared systems and Google Drive remain excluded.

## Subsequent verification and boundaries

- Added exact worktree mount to temporary VM invocation; images began downloading. Bounded600s attempt timed out. Supabase dispose and VM stop completed; no PASS/receipt or business records created. Read-only streaming of four cached public Supabase images from already-running default Docker into disposable Docker changed no source apps/data/config. Remaining external image download did not complete.
- Fixed remaining old socket defaults/guard in Kora producer and five-session script. Actual pre-runtime regressions12/12 PASS; independent Codex review PASS. Final lint0errors/13priorwarnings and typecheck PASS; full223files/1873tests has only one expected stale Kora-producer digest failure (222files/1872tests PASS).
- Producer stable SHA `sha256:4ecc11ef1563f3cd61f035147e5b4b2da0295059f06302a42a2c91e09263e500`. Persistent allowlist update was explicitly rejected by the execution safety gate despite standing local authority; no workaround attempted. Owner must explicitly approve this trust change after being informed it permits the modified producer to execute; old digest remains in allowlist.
- Independent WP-32 coverage review found Tashkent-specific M3/baseline/release/M4 continuation absent; Kora scenarios cannot substitute. A preparation-only M3 helper draft was reviewed, found insufficiently lineage-bound, and removed before publication; no M3 implementation/acceptance claimed.
- Actual Kora site photo env input is unconfigured/unreadable. Raw source availability remains UNKNOWN; no synthetic image relabeled real. All disposable VMs are stopped. WP-32 remains incomplete.

## Current runtime fact

- With the real Kora photo, authenticated source registration and stats passed (`215/86/33`). The clean fixture then failed at source upload with `P1103 PACKAGE_CAPABILITY_REQUIRED`: project enrollment creates the root project scope but no authenticated package-membership/enrollment door exists for the root package after DB3/DB4/DB5 seeds are removed.
- Direct SQL package-membership insertion is prohibited by this TZ, and broadening source authorization from package scope to project scope would bypass the failed capability check. The correct next implementation is an additive authenticated package-scope enrollment contract (or an existing approved invitation path), not a fixture write or scope broadening.
- All disposable profiles are stopped. No PASS/receipt or hosted evidence was generated. Local tests/build remain green for the current diff; WP-32 is `BLOCKED_FACT` on the missing authenticated package-scope contract, not on Drive/photo input.

## Approved producer allowlist and current fact gate

Owner explicitly approved producer SHA `4ecc11ef1563f3cd61f035147e5b4b2da0295059f06302a42a2c91e09263e500`; H15 entry now matches current bytes. Final local gates: full 223/223 files and 1873/1873 tests PASS; lint 0 errors/13 pre-existing warnings; typecheck, Webpack 46-page build, shell syntax and diff-check PASS.

Read-only workspace inventory found no Kora site photo. Existing images are product/UI QA screenshots, not site evidence, and are excluded. A real, locally readable Kora site photo remains the required factual input for the photo/milestone part of the runtime gate. No image was copied, transformed, uploaded or reclassified.

## Cycle 7 authenticated-chain repair (2026-09-16)

- Kora provision no longer executes DB3/DB4/DB5 business scenario seeds. Root-package capability is obtained through an authenticated invitation/acceptance path; the temporary raw invitation token is removed from the session file immediately after acceptance.
- `run-five-sessions.zsh` now executes authenticated `create_decision → create_approval_package → submit_approval_package → review_selection → publish_baseline → publish_release`. Baseline/release use snapshot tokens read from the authenticated workspace; release/version IDs are server-derived. Milestone definition uses an authenticated PostgREST RPC helper, and photo evidence uses the provisioned real area node rather than a fixture area ID.
- The change request now references the actual published release. A final guest grant is created against that server-derived release through an authenticated RPC helper; no fixture release ID is used.
- Contract/test updates now reflect authenticated source stats observed by the read contract: physical `215`, materialized `86`, placeholders `129`, unique blobs `33`, duplicate groups `18`, quarantined groups `8`.
- Verified locally: `223` test files / `1877` tests PASS, typecheck PASS, lint `0` errors / `13` pre-existing warnings, production build PASS. The disposable runtime has not yet produced a PASS receipt after this latest chain change; the last bounded runtime attempts stopped at disposable startup/state issues and must be rerun from a clean profile.
- External Tashkent executor remains a separate continuation. Its current provisioning helper still contains privileged disposable bootstrap SQL for organization/package scope; no production/shared mutation was made and no external PASS is claimed until that path is reconciled with the authenticated-only boundary.
- Follow-up static review findings were addressed: guest grant now uses a post-milestone state refresh and the latest server-read package version, guest checks run only after final grant creation, and pre-provision guest scope is marked unverified.
- Added migration `20260916132722_projectceo_authenticated_package_enrollment.sql` with authenticated owner authorization, idempotency, organization/project/package enrollment, scoped project/package memberships, and role capabilities. Tashkent now retains only disposable public identity bootstrap SQL; organization/package/business rows are created through the authenticated RPC.
- Latest static gates remain green: 223 test files / 1877 tests, typecheck, lint (0 errors / 13 existing warnings), and production build. Clean disposable runtime is still pending because the Colima profile is repeatedly reporting stale `already running` then `not running` state before the stack can start.
- Independent static review caught and the implementation now fixes three migration hazards before runtime: PL/pgSQL exception block closure, command-record operation vocabulary, and unsafe member role replacement/capability accumulation. Targeted auth/environment/layout tests (30/30) and typecheck pass after the fixes.
- Latest clean-profile retry did not reach migrations: `supabase start` failed while pulling `supabase/postgrest:v14.14`, `supabase/storage-api:v1.62.5` and `supabase/postgres:17.6.1.143` because `unix:///Users/msnigmatullaeva/.colima/archidom-ap1-disposable/docker.sock` disappeared (`Cannot connect to the Docker daemon`). The profile is now stopped and no receipt was generated.
