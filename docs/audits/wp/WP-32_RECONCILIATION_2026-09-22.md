# WP-32 reconciliation — 2026-09-22

Pre-push install/check session26800 completed exit0: npm ci from unchanged lockfile,
lint0 errors/13 warnings, typecheck,256 files/2319 tests and build PASS.
Dependency advisory gate remains OPEN: npm audit reports12 vulnerable packages
(3 moderate,8 high,1 critical), with Next16.2.12 in the affected range for
GHSA-2xp9-vwfh-vxw4 (AVIF image optimization) and GHSA-p293-qw3h-jr36 (Windows hosts).
Official advisory confirms16.3.3 as patched for the AVIF issue; repository config
explicitly enables image/avif. Hosted exposure/exploitation is not verified.
package.json/package-lock.json are unchanged against HEAD, so this is inherited
baseline risk, not introduced by this patch. No npm audit fix, dependency upgrade,
production probe or deployment was performed. Scoped draft publication must not
claim dependency-security or production acceptance.
References: https://github.com/advisories/GHSA-2xp9-vwfh-vxw4 and
https://github.com/advisories/GHSA-p293-qw3h-jr36.

Latest canonical post-fix acceptance: session13598 exit0,
2026-09-22T20:31:59.000Z, PASS SHA256
a66b44b5d94c39609700513555fd8b16b5066e6d871a0f87b0b266076e0cb2cc.
Both wrapper markers and DB4 PG16/17 passed; receipt executor digest is the
reviewed434d136440106668a319d5da44760836bde23f39880d60024b827c33760dafff.
Dedicated disposable socket docker ps returned no containers after wrapper cleanup.
No final committed-head run or full external M4/source-provenance acceptance claimed.
This supersedes earlier pending runtime statements below.

## Security review and quality checkpoint — 2026-09-23

SQL remediation superseding status: reviewed candidate integrated into recovery.
`query_db` forwards fixed caller arguments; the affected diagnostic block uses
psql --set values, literal heredoc and :'name' SQL-literal quoting. No identifier
alphabet narrowed and no human operation moved to privileged SQL. Independent
fresh patch reviewer inspected all8 callers and found no concrete surviving bypass
or regression. Syntax/diff checks and integrated focused suite8/8 passed.
Real network-none PostgreSQL16/17 probes executed the exact diagnostic block with
empty table shapes: ordinary IDs, apostrophes, SQL-like strings, newline/backslash/
shell metacharacters all passed; baseline ordinary control passed but apostrophe
case failed. No business rows written; both owned containers disposed. These are
SQL-literal semantics probes, not substitutes for full external E2E/provenance.
Reviewed executor SHA256434d136440106668a319d5da44760836bde23f39880d60024b827c33760dafff
is now locally allowlisted under standing owner approval. Full post-fix suite and
canonical runtime rerun remain required before final acceptance/publication.
Quoting contract: https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-INTERPOLATION

Full `npm run release:check` session21870 exited0: lint0 errors/13 existing
warnings, typecheck PASS, 256 test files/2317 tests PASS, Next build PASS/46 pages.
This was before the pending SQL-literal remediation; rerun affected checks after it.

Frozen scan `d4340635-7364-4307-a52f-288e73eb94a6`, snapshot digest
`bee6622370ef5c2bea28429ab1eb084e2eaa89ba03438f0975df54a1b7a01421`, completed with
PARTIAL coverage and no new native diff candidates in its three product files.
Supplemental independent source review covered all17 changed evidence/test files.
It found inherited `WP32-EVIDENCE-01`/CWE-89: manifest submission/variant text is
interpolated in external runner diagnostic SQL658-718, executed as postgres134-136.
Parent verified source path; no runtime exploit or production exposure claimed.
This is not an overall security PASS; isolated minimal fix is in progress.

Sealed report retains earlier checkpoint deferred entries, including a stale
native-discovery-running note. Final independent reviewer completed all three
native files; source verdict and supplemental finding take precedence over that
checkpoint wording. Sealed report is preserved unchanged. Archive outside repo:
`../backups/wp32-security-scan-20260923.tgz`, SHA256
`6d249a385179526fdc5481dafbc31223b5c545d2907c17bbddcef996b7923dad`.
Scanner usage rollup reports17021377 total tokens including16601984 cached input
tokens across5 threads (`source=codex_rollout`); monetary/credit cost is not measured.
These counters must not be represented as new paid API calls or exact incremental spend.

## AP5 continuation — 2026-09-23

Superseding terminal result: session73078 exited0. AP5 31/31 passed,
skipped0/unexpected0/flaky0; no-skips validator passed. Start
2026-09-22T19:59:00.369Z, duration37049.835ms. Results SHA256
019d56ec6d625a655ece45be6cf702d83952c484ebf59e05854b60fae812f8b2.
Launcher SHA256 cf36736b337b1c7f929e8ad6c8a00b31f3a16c91ed8ef6c90874f4cb80d79c40.
Build and dispose completed; temporary session state/app log absence verified.
This closes local AP5 for the tested dirty snapshot, not final exact-commit,
external-source provenance, full external M4 or hosted/production acceptance.

Session67567 terminal: build succeeded; Playwright executed 31 tests with
29 expected, 1 unexpected and 1 skipped (0 flaky). Failure is in
`tests/ap5/coverage-graph.ts:226`: missing `SUPABASE_DB_URL` for existing
ANALYZE after authenticated wide-graph ingestion. The serial successor was
skipped, so this is not AP5 acceptance. Disposable teardown completed.
Temporary launcher correction binds the official local status DB_URL in memory
after requiring loopback host and port59622; it does not seed business tables.
Original results/summary preserved as `*-attempt-67567.json` in the private run
directory. Full fresh retry session73078 is running; no retry PASS assumed.

Independent read-only audit wording review identified stale AP5 wording and a
noncanonical readiness label; both were corrected in the four-module audit.

Local attempt session13147 stopped at CLI profile loading, before browser tests.
Readback showed the intended isolation edit was absent from its temporary launcher;
do not interpret that attempt as a failed test of the isolated configuration.
The launcher was patched separately and read back before launching session67567.
It now uses a fresh `SUPABASE_HOME`, `SUPABASE_NO_KEYRING=1` and explicit built-in
`SUPABASE_PROFILE=supabase`, supported by the official CLI profile loader.
No global profile or credential files were read or modified; no container secrets
were extracted. Session67567 passed local status, AP1_RUNTIME_OK and migration
ledger count127, provisioned disposable identities and reached the application
build. Browser acceptance remains pending. Owned runtime teardown is in finally.

The canonical wrapper result below remains valid for its dirty snapshot; AP5 does
not widen its external-package or source-provenance scope.

Canonical retry29289 finished exit0. PASS timestamp2026-09-22T19:23:09.135Z,
SHA2567df0e447af56d8579262107938661001fd67b7c4d0486c9b476ee63891c5646f;
permanent copy `../backups/WP32_PASS_20260923.json`. Both DB4 PG16/17 and both
wrapper markers passed. This was an uncommitted working-tree run; HEAD in receipt
alone does not identify all tested bytes. Preserve diff/migration hashes and rerun
against final committed snapshot before claiming exact-commit runtime evidence.
Scope is still Kora supported chain plus external five-operation M2→M3, not full
external M4/source provenance. Local AP5 launch initiated separately after cleanup.

AP5 initial launch session24537 ended exit1 at local-status, before identities or
browser tests. Temporary launcher recorded only stage, so precise failure cause is
not yet known. Disposable teardown completed. Added safe diagnostic exit/signal/type
metadata without secret-bearing stdout/stderr and initiated one diagnostic retry.
Do not classify this as Auth/browser product failure or count skipped AP5 as PASS.

Active retry: session29289, `/private/tmp/remhaos-wp32-finalizer-runtime.B8Qgto`,
private run.log retained with umask077. Observed AP1_RUNTIME_OK, ledger count127,
Kora provision with foundation_fixtures=0. Finalizer/reference and operation-scope
followup review found no new blocker; 79 focused tests passed. Final runtime result
pending. Terra prepares read-only local AP5 procedure; no hosted target is authorized.

## Acceptance matrix (current, supersedes historical status statements)

| Requirement | Evidence | Status |
|---|---|---|
| Preserve source outside temporary worktree | Verified full Git bundle and permanent checkout | VERIFIED |
| New members do not obtain implicit project-wide grants | Additive migration + DB77 PG16/17, independent source review | VERIFIED for new enrollment; legacy grants unchanged |
| Package client reviews its own approval only | Additive wrapper + standalone DB78 PG16/17 success/denials/replay | VERIFIED for tested scope |
| Exact command/audit/result binding | New key-digest lookup and mocked-shell tests, independent review | PARTIAL; external runtime receipt pending |
| Kora source→decision→approval→release→M4 acceptance | Previous retry emitted AP1_SUPPORTED_SLICE_E2E_OK | VERIFIED for that disposable snapshot; latest descriptor edit not in snapshot |
| Complete external Tashkent M2→M3→baseline→release→M4 | Canonical WP card requires this; executor currently covers only five M2→M3 operations | NOT_COMPLETE |
| Exact external source provenance | Historical manifest operator-prepared; handoff explicitly unresolved | BLOCKED_FACT; Drive/Pejeng excluded |
| Authenticated browser AP5 | Session73078: 31 passed, zero skipped/failed/flaky, no-skips gate, dispose | VERIFIED for tested dirty snapshot; not hosted |
| Lint/typecheck/unit/build on final diff | Earlier slices pass; final diff continues evolving | PARTIAL |
| Independent review of final integrated diff | Slice reviews conducted; complete final review pending | PARTIAL |
| New follow-up commit/push/draft PR | Required gates not all met | NOT_STARTED |

The canonical WP card `docs/execution/wp/WP-32-ap6-run-cycle7-green.md:10`
requires external baseline/release/M4. An EXTERNAL_REAL_PACKAGE_PASS marker for
the five-operation executor must not be used to close that broader requirement.
Current owner restrictions also exclude workflow_dispatch despite the historical
card suggesting it; automatic CI/Vercel remain disabled.

Latest 2026-09-23: test78 package review executed after all migrations in
separate network-none disposable PG16/PG17 containers: both exit0 with
DB4_PACKAGE_BOUND_APPROVAL_REVIEW_OK; cleanup trap removed owned containers.
Chromium installation completed. Canonical session75649 ended exit1 after both
DB4 PASS markers: EXTERNAL_RUNNER_PROJECT_READ_HTTP role=architect status=403
code=forbidden, stage=preflight_complete. Approval review now works; next confirmed
failure is package-only architect HTTP workspace reading. Inspect read scope before
any permission change. No final runtime PASS or AP5 acceptance yet.

Source diagnosis: live-read-port.getProjectWorkspace forwards effective packageId
to primary authenticated read, then unconditionally calls project-only facts,
approval requests, M1 legacy read for architect role, and project-only audit timeline
for view_audit. Those secondary RPCs use _authorize_project_human. The package-only
architect therefore fails despite a valid package read. Repair owned by Terra:
guard project-wide secondary projections by server-derived accessScope, preserving
primary denial behavior and existing project-wide roles. Do not broaden SQL grants.
Test78 now registered in DB4 runner after the previous live wrapper terminated.

Reconciled stale Kora output marker labels with current harness: foundation_fixtures=0,
identity_bootstrap=disposable; summary already reported zero foundation fixture sources.
This reporting correction does not rewrite old logs or turn their receipts into new proof.

Live-read correction implemented: effective project scope gates secondary M1 facts,
approval/legacy, access and audit RPCs. Package primary read still receives exact
packageId; P1103 primary denial stays forbidden. Behavioral suite 30/30 passed,
typecheck/diff-check passed. Independent followup review requested.
Canonical retry uses fresh `/private/tmp/remhaos-wp32-scope-runtime.E8uHRx`,
session54621; no final result yet. No runtime mutations occurred outside disposable.

Followup live-read review found operationStates still offered project-only M1/access
actions by role after secondary data reads were scoped. Package architect would see
create_project_fact/create_approval_request even though SQL correctly denies them.
Terra is aligning those operation descriptors with effective scope; package-valid
commands and database authorization must stay intact. Runtime already copied the
prior app snapshot; its result will not validate this later descriptor adjustment.
AP5 identity provisioning creates auth users only; membership comes from browser
invitation flow. Run from isolated environment with no .env.local to prevent loading
unrelated credentials. No production, hosted or paid provider calls are authorized.

AP5 source preflight completed: existing bootstrap/local scripts and CI disposable
gate sequence can be reused; no new product feature is necessary. Run only after
current wrapper teardown: fresh local stack/identities, M3 + M4 increment1/V1 gates,
build with layout/documentation/execution flags, app on127.0.0.1:3100, then test:ap5.
V2/V3 remain off for the AP5 CI-equivalent path. Credentials must remain in memory
or protected ephemeral files, never displayed or committed. AP5 not yet executed.

Current uncommitted scope/receipt changes backed up outside temporary directory:
wp32-auth-scope-20260923.patch SHA25639f87feb6a3001591c37464ce03876787b429790dd8678e8a7ae6f0692213a12;
wp32-auth-scope-new-files-20260923.tgz SHA256168ea90cfd71c8c52e5ff8b8dc533ea17821e099bd45b7014ae9639f1fe94c2b.

Operation descriptors now receive hasProjectScope: four project-only M1 actions
and three manage-access actions are unavailable for package scope. Behavioral test
asserts all seven exact unavailable outcomes, plus retained project-architect fact
and approval-request availability. Focused suite 30/30 passed after those assertions.

Scope retry session54621 reached finalizer after external execution, then exited1.
Captured tail lacked first exception line; do not invent its exact runtime code.
Source review exposed a deterministic mismatch: actual external receipt builder emits
Kora receiptId+producer reference, not inline marker/sessions. New claim check wrongly
required those duplicate fields. Correction keeps mandatory protected file validation
and receiptId equality; validates inline marker/sessions only when present. The positive
builder integration test no longer overwrites builder output with a hand-filled Kora
receipt. Full rerun needed. Parallel lint had scanned disposable runtime-generated
output; repeat after wrapper cleanup, without altering lint rules.

Scope: repository-only; base main 8a27b93a0877be7998ee6037961c64501d78de00.
State: IN_PROGRESS. Existing merged PRs #202/#203 are not reopened.

## Verified preservation

Main and WP-32 b08764f are stored in a persistent checkout and in
`../backups/remhaos-main-wp32-20260922.bundle`. `git bundle verify` passed;
the bundle contains full history, not an incremental archive requiring a missing base.
The historical PASS artifact matches the recorded SHA-256
`b270a385188690257c446d416b2bd34d52befb978290046706eb84a2823f114a`.
This verifies artifact identity only; it is not a new runtime run or acceptance of broader scope.

## Independent static review candidates

| ID | Finding | Status |
|---|---|---|
| F1 | Finalizer permits inline Kora claims when protected receipt path is absent | Fallback removed; focused identity suite 12/12 and pilot suite 86/86 passed before subsequent agent edits |
| F2 | Enrollment of package members also grants project-level capabilities | Static finding; scope semantics and impact require validation before additive correction |
| F3 | Audit harvest selects latest operation instead of exact command identity | Implementation assigned to Terra; existing allowlist remains unchanged until review |
| F4 | Negative finalizer tests fail on absent manifest before intended guard | Test repair assigned to Sol |

F1 is only partially remediated: requiring a file closes the inline fallback,
but local caller-owned files and matching hashes do not independently attest execution.
Full manifest validation, exact scope binding and runtime observation remain required.
An exported helper's unit test PASS must not be described as live execution proof.

## Evidence boundaries

The external runner covers five M2→M3 operations, not external baseline→release→M4 acceptance.
Source provenance remains unresolved in the historical handoff. Current authority excludes
Google Drive/Pejeng; no substitute sources or relabelling are authorized.
The old Colima diagnosis mixed sandbox and host observations; no renewed runtime failure
has been established in this recovery checkout.

## Current next action

Review the two bounded worker diffs, run meaningful rejection tests, and complete exact
manifest/receipt validation. Then validate enrollment scope with an isolated database
test before any correction. Preserve timestamped migrations; changes are additive.
No new commit, push, deployment, shared DB mutation or CI re-enablement in this cycle.

## Local verification 22 September

Lint: 0 errors, 13 existing warnings. Typecheck passed.
Full Vitest in the sandbox: 251 files passed, 3 failed; 11 process tests failed
with spawn EPERM. Re-running the same suite with authorized host execution,
without changing test assertions or implementation, passed 254 files / 2303 tests.
This establishes a sandbox process restriction for that failure, not a product defect.
Database/AP5 and fresh end-to-end wrapper were not run in this cycle.

Host check at 2026-09-22 23:27 Asia/Tashkent, outside sandbox: disposable
Colima reported running and its explicit Docker socket returned server 29.2.1.
Container inventory on that socket was empty. The historical infrastructure
blocker is not current evidence; no profile deletion or restart was needed.

Independent Astra review of the changed runner found no key-mapping/result/child
lookup correctness defect. It found additional identity negative tests failing
before intended guards. Stale-Kora case now supplies manifest and matching digest,
and explicitly asserts KORA_RECEIPT_STALE_OR_REPLACED (13/13 identity tests pass).
Remaining producer/executor/session identity negatives still require the same repair.

Subsequent correction: those three negatives now use persisted prepare/manifest/Kora
inputs and assert their intended error codes. Inline Kora identity/session claims
must match the protected receipt, or KORA_RECEIPT_CLAIM_MISMATCH is raised.
Identity and adversarial/runner checks passed 27 tests in total.
Following independent runner review and its six behavioral/static tests,
the authorized local allowlist now pins external runner
`sha256:9331e42ae3564616be6ae1b3e5a88855ded7d6af6cb7070f44be620d65736b54`.
Pilot suite currently has 92 passing and two failing tests: two older positive
fixtures lack full manifest input and are being corrected without weakening guards.

Two fixture corrections completed: full canonical external manifest now matches
receipt selectors and protected Kora claim; targeted 49 tests passed. Scope mismatch
has an explicit rejection test. No guard was disabled.

Before canonical runtime, Kora provision still contains direct private SQL writes
for packages/members/capabilities before enrollment. A bounded removal/door migration
task is assigned; runtime will not be used to certify the authenticated-only boundary
while these writes remain. External enrollment needs explicit distinction between
project-wide and package-only grants: simply deleting project memberships would
break existing project-only source snapshot calls and is not a sound correction.

## Follow-up source verification

F3: `projectceo_product._complete_command` creates a random DB command UUID
and a separate `db:` audit request UUID (20260717101000 migration, lines 187/250).
Neither equals the client command UUID or HTTP request UUID by contract. The
repair must select by the exact persisted idempotency digest, preserve both
identities, and compare logical result/state. Equality of unrelated UUIDs is
not a valid acceptance check. Atomic approved-commit lookup must derive its
key from the original client review key plus `:approved-commit`.

Implemented: executor retains DB commandId for proof consumers and a separate
submittedCommandId for key derivation; exact key digest replaces latest-row lookup.
Mocked-shell tests exercise distinct identities, parent side effects and result mismatch.
Finalizer additionally calls full external-manifest validation and matches project/package
selectors. Organization is server-derived by enrollment and cannot be compared to the
operator placeholder UUID; independent attestation of that mapping remains open.
No fresh runtime PASS or allowlist approval is claimed by these unit checks.

F2: current enrollment repair lines 101–107 insert project memberships and full
project capabilities for the members supplied together with package_id.
The package authorizer's project-wide branch (20260717092000, lines 44–69)
then accepts those capabilities for every active package. Source-level scope
expansion is confirmed. A package-A/package-B behavioral regression and an
additive migration are still required; do not patch historical migration files.

## Enrollment correction design

Independent source review recommends: supplied members get package-only scope;
owner retains project-wide scope; existing explicit project grants stay untouched.
Use the existing role capability set within package capabilities for this bounded
enrollment contract, without changing global invitation templates. Project-wide
source snapshot publication uses the authenticated owner. Validate actual package
identity after conflict handling; do not silently issue success for a different package.
Sol owns additive migration/DB4 tests; Terra owns provisioner. Required tests:
package A allowed/B denied, project-scope denied to fresh package members, owner
all-scope access, exact replay, conflicting payload and preserved explicit project grants.

Full Vitest after receipt corrections: 255 files / 2311 tests passed on host.
This predates the new enrollment migration and cannot validate it.

Kora provisioner correction now removes private package/membership/capability
SQL and calls authenticated enrollment. Public disposable identity bootstrap remains.
Root-package operations subsequently use explicit authenticated project invitations:
`run-five-sessions.zsh` calls invite_role architect/builder/client before the portfolio
and business chain. Thus engineering-package enrollment is not relied on to silently
grant root access. This ordering is source-verified; live behavior remains to test.
External source snapshot now uses ownerClient as required by its project-wide contract.

Publication side-effect preflight: repository CI has only workflow_dispatch trigger;
vercel.json declares git.deploymentEnabled=false. Neither setting was changed.
Future push remains gated on review and runtime acceptance; no manual CI dispatch
or deployment is authorized by this observation. Remote integration settings have
not been independently queried.

## Live database baseline verification

Immutable tracked HEAD 8a27b93 subset (DB harnesses and migrations) was exported to
`/private/tmp/remhaos-db-baseline-20260922.aH7CxR` before the enrollment migration.
Existing DB4 harness on disposable Docker postgres:16-alpine completed exit 0 with
DB4_PRODUCT_BRAIN_HARNESS_OK, including concurrency, upgrade and restart/replay.
This proves the current main baseline only, not the new enrollment correction.
The identical PG17 baseline harness completed exit 0 with
DB4_PRODUCT_BRAIN_HARNESS_OK image=postgres:17-alpine. Both baseline runs passed;
neither includes the uncommitted enrollment correction.

Migration source review found no new project-wide grant path for supplied members.
One acceptance issue remains to fix: reject archived matching packages before issuing
membership/success. Preserve two distinct test actors: package-only architect denied
sibling/project scope, and explicitly invited project architect retaining those reads.
Legacy broad grants are not retroactively revoked; historical records lack sufficient
provenance for bulk revocation. This limitation remains explicit after the correction.

New correction snapshot: `/private/tmp/remhaos-db-enrollment-20260922.xsn4AY`.
Migration SHA256 a69af82c0e081f4939208ce38f99a00733817cdce799388330f04e011ee0a0c9;
test77 SHA256 4df30a6b7a7228ca3c5030ea2e19ed22b3db42e1474e31fbbc539c0500c0d7e3.
Both matched working bytes when PG16 run started. Full DB4 PG16 session 42694
is live; migration phase completed and upgrade scenarios are running. Final result
pending; do not claim new enrollment runtime acceptance before exit 0.

Added executable preservation-after-enrollment check: the separately project-invited
fifth actor is now also enrolled in A, then must still read project/B. Test SHA256
931823f583f8e07aff1ebc80db49ed1b483af6927442c6b7d90c69972d4a8266.
New immutable snapshot `/private/tmp/remhaos-db-enrollment-final-20260922.M5yvwy`
runs PG17 (session 26976). The earlier PG16 snapshot remains unchanged.
Archived-package refusal is reviewed in code, but no live archival setup test is
claimed yet; no new archival product command was added for the sake of testing.

Canonical wrapper started in persistent recovery checkout using approved real Kora
photo and `/private/tmp/remhaos-wp32-runtime-20260922.XZEQRH` as a fresh evidence
directory. Session 4647, bounded 1500 seconds; Supabase migration application observed.
No PASS yet. PG17 final snapshot session 26976 remains live. Do not restart either
on observation timeout; poll exact handles and inspect final exit status first.

Update: PG17 session 26976 completed exit 0 with DB4_PRODUCT_BRAIN_HARNESS_OK;
expanded test includes preserved project actor enrolled into A. Earlier PG16
correction snapshot also completed exit 0 (before that additional preservation check).
Canonical wrapper session 4647 completed exit 1 during external provisioning:
`AP1_RPC_REVIEW_APPROVAL_PACKAGE_P1103 forbidden {"reason":"PROJECT_CAPABILITY_REQUIRED"}`.
The actual clientClient review at provision-kora.ts:312 now has package-only grants,
while the existing RPC requires project capability. This is a confirmed integration
failure; do not silently restore project-wide grants to make the test pass.
Read-only design review is inspecting a package-bound additive review authorization
path and the subsequent client-review door. No fresh runtime PASS is claimed.

Added `20260922185630_projectceo_package_bound_approval_review.sql` after source
review: only the public generic approval-review wrapper changes. It authenticates,
resolves stored organization/package for the approval ID, authorizes exact package
review_selection, and delegates to unchanged transition/self-approval/idempotency code.
Missing approval returns uniform forbidden to avoid an existence oracle. Existing
RPC ACL is preserved; no global authorizer or private helper grant is changed.
Next test extension covers package-A approval/replay and sibling/builder/anonymous
denials using public human RPCs. Database execution of this new wrapper is pending.

Independent source review of wrapper SHA
d8860cdfcc8cb95386a7d6f006600871894522a9cb673a6a52e6b8785af5b151 found no
new defect in variable resolution, authentication, stored package binding or ACL.
Existing same-package cross-actor replay semantics remain unchanged and are not
claimed hardened. Missing approval now uniformly returns P1103 as documented.
Canonical retry: evidence directory `/private/tmp/remhaos-wp32-review-runtime.F6ptcT`,
session 75649; migration application observed, result pending. No duplicate run.

2026-09-23 continuation: same run's sanitized markers confirm
AP1_EXTERNAL_PACKAGE_PROVISIONED and AP1_SUPPORTED_SLICE_E2E_OK, including
distribution_ack/change_impact/photo_review/milestone_accept and five magiclink
sessions. Kora receipt was written. Wrapper has advanced into DB4 PG16 regressions;
external executor/final PASS still pending. The old marker labels
foundation_fixtures=4/seeded_preconditions=true are stale strings in the harness;
they must be reconciled after this fixed running invocation, not counted as proof
of current fixture dependency or evidence of its removal.

AP5 preparation: current Playwright config uses live Auth/PostgREST/RLS,
workers=1 and retries=0; setup refuses fixture mode. Chromium executable was
absent; project-pinned Playwright browser download started (session 76440).
AP5 state/report/results paths are gitignored; raw traces/cookies must remain local.
New test78 package approval review is standalone/unregistered until live wrapper
finishes, preserving the running test list. AP5 itself has not started yet.
