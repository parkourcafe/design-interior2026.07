# Four-module architecture audit — 2026-09-16

Scope: repository-only audit of the current RU RemHaOS/ArchiDom compatibility line. Production, shared environments, Google Drive and Pejeng were not accessed or changed.

## Current reconciliation — 2026-09-23

**ИЗВЛЕЧЕНО.** This section supersedes the September 16/17 runtime, publication and readiness statements below. Current checkout is `codex/remhaos-recovery-20260922`, based on `8a27b93a0877be7998ee6037961c64501d78de00`, with uncommitted follow-up repairs. Detailed requirement-to-evidence mapping: [WP-32 reconciliation](wp/WP-32_RECONCILIATION_2026-09-22.md).

**ИЗВЛЕЧЕНО.** The local disposable wrapper completed with exit 0 at `2026-09-22T19:23:09.135Z`. Preserved `WP32_PASS_20260923.json` has SHA-256 `7df0e447af56d8579262107938661001fd67b7c4d0486c9b476ee63891c5646f`, rechecked on September 23. Evidence includes DB4 PostgreSQL 16/17 and the supported authenticated Kora chain. It was a dirty-worktree run: the receipt's HEAD alone does not identify all tested bytes.

**НЕ ПОДТВЕРЖДЕНО.** The external executor's five-operation M2→M3 PASS does not prove external baseline→release→distribution→M4 acceptance, independently verified external source provenance, hosted acceptance or production readiness. Those remain separate requirements. No new follow-up PR has been published.

**ИЗВЛЕЧЕНО.** Earlier AP5 launch attempts failed at local CLI profile loading, then session67567 reached browser execution but lacked the local DB_URL for the existing planner-statistics maintenance step (29 passed, 1 failed, 1 skipped). After correcting only the temporary launcher, session73078 exited0: **31 passed, zero skipped/failed/flaky**, no-skips gate passed, runtime disposed. Full result hash and scope are recorded in [WP-32 evidence](wp/WP-32_EVIDENCE.md). This is current dirty-snapshot local browser evidence, not hosted or final exact-commit acceptance.

**ИЗВЛЕЧЕНО.** DEC-016 in `REMHAOS_DECISION_LOG_v1.md` cancels percentage readiness scores in favour of status plus evidence level. The numbers in the historical matrix below are retained only as `HISTORICAL_AUDIT_SNAPSHOT`, not current canonical scores.

| Workspace | Current evidence assessment | Remaining acceptance boundary |
|---|---|---|
| M1 · Заказчик | **ИНТЕРПРЕТИРОВАНО — PARTIAL:** repository contracts and local DB evidence; whole customer journey not re-proven by WP-32 | **НЕ ПОДТВЕРЖДЕНО:** current browser/hosted M1→M2 and production adoption |
| M2 · Дизайнер | **ИЗВЛЕЧЕНО — VERIFIED for the recorded dirty disposable snapshot:** authenticated Kora plus five-operation external sequence | **НЕ ПОДТВЕРЖДЕНО:** complete real external package provenance and final exact-commit acceptance |
| M3 · Архитектор | **ИЗВЛЕЧЕНО — VERIFIED for Kora in the recorded dirty disposable snapshot:** baseline/release within supported chain | **НЕ ПОДТВЕРЖДЕНО:** complete external release, current browser and hosted acceptance |
| M4 · ГлавПрораб | **ИЗВЛЕЧЕНО — VERIFIED for supported Kora in the recorded dirty disposable snapshot:** distribution/acknowledgement, change/impact, photo review, milestone acceptance | **НЕ ПОДТВЕРЖДЕНО:** full external M4, handover production adoption and hosted operations |

**ИНТЕРПРЕТИРОВАНО.** Current architecture point: an authenticated local vertical slice with tighter package authorization, not a fully evidenced external pilot or production-ready product. Local enrollment/approval authorization repairs do not retroactively revoke historical explicit project grants.

### Current sequential completion plan

1. **ИЗВЛЕЧЕНО — completed for current dirty snapshot:** isolated AP5 passed 31/31; retain the no-skip receipt and cleanup evidence, and rerun when final code bytes change.
2. **ИНТЕРПРЕТИРОВАНО:** Close external baseline/release/M4 through the same authenticated contracts; separately obtain missing source facts without using prohibited Drive/Pejeng access or fabricated substitutes.
3. **ИНТЕРПРЕТИРОВАНО:** Run full integrated quality gates and independent authorization/security/idempotency/E2E review; reconcile every finding.
4. **ИНТЕРПРЕТИРОВАНО:** Preserve exact source bytes and repeat acceptance against the final commit; publish the authorized follow-up branch/draft PR only after required gates. No automatic merge or CI/Vercel re-enablement.
5. **ИНТЕРПРЕТИРОВАНО:** Reconcile remaining authorized work packages with the current evidence matrix, without duplicating WP-13/AV/R1-08A work. Hosted adoption, production, paid pilots and other owner-controlled actions remain separate gates.

## Historical audit snapshot — September 16/17

**ИЗВЛЕЧЕНО.** The following sections describe the earlier audit and preserve its source inventory. Their runtime blockers, percentages and publication status are historical, superseded by the current reconciliation above; they must not be cited as current-state evidence.

## Publication note — 2026-09-17

**ИЗВЛЕЧЕНО.** This audit was prepared before the later local wrapper PASS recorded in `docs/audits/wp/WP-32_EVIDENCE.md` and `docs/execution/HANDOFF_WP32_PUBLISH_STATE_2026-09-17.md`. Where this file says the clean runtime receipt is missing or blocked by Colima/Docker startup, those lines are historical for this audit snapshot and are superseded by the later PASS evidence.

**НЕ ПОДТВЕРЖДЕНО.** The later PASS still does not close production, hosted browser/Auth/RLS proof, a complete external Drive-document provenance chain, or a final independent security report.

Evidence labels used throughout:

- **ИЗВЛЕЧЕНО** — directly confirmed by a repository document, source, test or recorded runtime log.
- **ИНТЕРПРЕТИРОВАНО** — analytical conclusion derived from extracted evidence.
- **НЕ ПОДТВЕРЖДЕНО** — insufficient evidence; not treated as complete.

## 1. Canonical architecture source

**ИЗВЛЕЧЕНО.** The current product contract is `docs/canonical/remhaos-v1/REMHAOS_CHARTER_v0.5_CANONICAL.md`. Its predecessor `docs/canonical/archidom-v1/ARCHIDOM_CHARTER_v0.5_CANONICAL.md` explicitly says it is superseded by the brand rename and points to the RemHaOS successor. The four official module names and responsibilities are defined in the successor charter §4:

1. **M1 · Заказчик / Presale**
2. **M2 · Дизайнер**
3. **M3 · Архитектор**
4. **M4 · ГлавПрораб**

**ИЗВЛЕЧЕНО.** `docs/product-intelligence/adr/0004-one-archidom-four-workspaces.md` records the compatible internal mapping: public four workspaces over one Organization/Project/Project Intelligence Core; `projectceo` remains an internal compatibility namespace. `docs/product-intelligence/architecture-v1.md` confirms the layered modular monolith and server-derived authorization invariant.

**ИНТЕРПРЕТИРОВАНО.** Historical labels such as “M3 publication” and “M4 execution” are implementation vocabulary, not separate products. This audit uses the canonical public names above and reports internal names only as mappings.

## 2. Module matrix

| Module | Official source | Readiness | Current evidence state |
|---|---|---:|---|
| M1 · Заказчик / Presale | RemHaOS Charter §4, ADR-0004 | **75/100** *(ИНТЕРПРЕТИРОВАНО)* | Strong repository/unit/integration coverage; hosted and production proof not confirmed |
| M2 · Дизайнер | RemHaOS Charter §4, ADR-0004 | **62/100** *(ИНТЕРПРЕТИРОВАНО)* | Decision/selection/approval/layout/review contracts exist; clean authenticated runtime not confirmed |
| M3 · Архитектор | RemHaOS Charter §4, ADR-0004 | **55/100** *(ИНТЕРПРЕТИРОВАНО)* | Baseline/release/documentation doors exist; external release and hosted acceptance not confirmed |
| M4 · ГлавПрораб | RemHaOS Charter §4, ADR-0004 | **48/100** *(ИНТЕРПРЕТИРОВАНО)* | Distribution/change/impact/photo/milestone contracts exist; full runtime receipt not confirmed |

The scores are readiness judgments, not product KPIs. They are intentionally reduced when evidence is only local/static.

## 3. M1 · Заказчик / Presale

**Официальное название и источник — ИЗВЛЕЧЕНО.** RemHaOS Charter §4 names M1 “Заказчик / Presale”; ADR-0004 maps it to legacy brief/passport/proposal plus immutable passport handoff.

**Пользовательский поток — ИЗВЛЕЧЕНО.** The charter defines: request → brief/materials → extracted facts → gaps/conflicts → risks/assumptions → scope/cost basis → proposal → contract-readiness check. Repository surfaces include `app/dashboard/projectceo`, `components/projectceo/m1-project-panel.tsx`, `components/projectceo/m1-passport-panel.tsx`, `lib/project-intelligence/adapters/postgres/m1-legacy-read.ts`, and M1 migrations including `20260910090000_projectceo_m1_legacy_read_contract.sql` and `20260824170000_projectceo_m1_passport_versions_contract.sql`.

**Что реально реализовано — ИЗВЛЕЧЕНО.** The codebase contains legacy brief/passport/proposal flows, ProjectCEO M1 UI panels, authenticated legacy reads, passport version contracts and approval-related command services. Tests include `tests/projectceo-integration/m1-legacy-read-adapter.test.ts`, `m1-proposal-approval.test.ts`, `m1-platform-command-service.test.ts`, and DB4 M1 contract/security SQL.

**Только документация — ИЗВЛЕЧЕНО.** The charter’s broader Project Check vocabulary (`READY`, `CONDITIONAL`, `BLOCKED`) and all future checkpoints are not evidence of hosted implementation by themselves; the charter explicitly says only proposal/contract readiness are MVP checkpoints.

**Связи — ИНТЕРПРЕТИРОВАНО.** M1 supplies the approved project foundation that M2 consumes as its input. The bridge is represented by authenticated enrollment and Project Intelligence scope, not a second project database.

**Security/authorization gaps — НЕ ПОДТВЕРЖДЕНО.** Hosted RLS/Auth/browser/email proof for M1 is not present in this audit. Local tests prove contracts, not production tenant isolation.

**Evidence — ИЗВЛЕЧЕНО.** Unit/integration tests pass in the current full suite (`223` files, `1877` tests); DB4 SQL files are present as contract/fixture sources but were not executed in the blocked current runtime. **НЕ ПОДТВЕРЖДЕНО:** hosted/production M1 acceptance.

**Minimum production work — ИНТЕРПРЕТИРОВАНО.** Close hosted Auth/RLS/browser evidence; reconcile production adoption and rollback; prove the M1→M2 handoff with a real authenticated tenant; retain the internal `projectceo` compatibility namespace until an additive rename ADR exists.

## 4. M2 · Дизайнер

**Официальное название и источник — ИЗВЛЕЧЕНО.** RemHaOS Charter §4 defines M2 as designer concept, variants, materials, budget and approvals, producing approved Design Intent and `DESIGN_FREEZE`. ADR-0004 maps M2 to Decision/Selection/Approval foundation.

**Пользовательский поток — ИЗВЛЕЧЕНО.** Repository contracts cover room/design intent, decisions, selections, price observations, approval packages, client review, approved commits, layout versions and M2→M3 handoff. Relevant paths include `lib/project-intelligence/application/m2-approval`, `lib/project-intelligence/application/m2-to-m3-handoff`, `components/projectceo/m2-workflow-panel.tsx`, `m2-client-review-panel.tsx`, and migrations `20260802070000`, `20260802080000`, `20260802090000`.

**Что реально реализовано — ИЗВЛЕЧЕНО.** Command contracts/service tests cover decision creation, approval package create/submit/review, layout versions, client review and exact handoff. The WP-32 executor now assembles decision → approval → baseline/release through authenticated request-bound commands; the source changes are committed locally in `8173e88`.

**Только документация/неполное — ИЗВЛЕЧЕНО.** Wide AI editing/credits and broad design intelligence remain outside the accepted pilot scope. A passing local test suite does not establish a real authenticated M2 pilot receipt.

**Связи — ИНТЕРПРЕТИРОВАНО.** M2 consumes M1’s project scope and produces exact revision references consumed by M3 baseline/release. M2 approval is not itself a production release.

**Security/authorization gaps — ИЗВЛЕЧЕНО.** Actor, project and package are intended to be server-derived; the new enrollment migration uses `_request_user_id`, idempotency and state revision. **НЕ ПОДТВЕРЖДЕНО:** live Postgres execution of the new migration because the disposable Docker daemon failed before the latest rerun.

**Evidence — ИЗВЛЕЧЕНО.** Unit/integration/contract tests pass; static auth/environment targeted checks are `30/30`. **НЕ ПОДТВЕРЖДЕНО:** clean runtime PASS receipt, hosted Auth/RLS and production pilot.

**Minimum production work — ИНТЕРПРЕТИРОВАНО.** Obtain clean disposable authenticated receipt; independently review the exact approval/release lineage; prove a second project/organization and hosted tenant isolation; close provider/legal/unit-economics gates before broad AI scope.

## 5. M3 · Архитектор

**Официальное название и источник — ИЗВЛЕЧЕНО.** RemHaOS Charter §4 defines M3 as working documentation, room sheets, schedules/specifications, versions, completeness and conflicts, producing an approved package and `DOCUMENTATION_RELEASE`.

**Пользовательский поток — ИЗВЛЕЧЕНО.** Code and migrations expose source registry/materialization/review, baseline composition and release publication. Relevant files include `lib/project-intelligence/delivery/projectceo/m3-surface.ts`, `supabase/migrations/20260825030000_projectceo_publish_baseline_door.sql`, `20260911150000_projectceo_publish_release_request_bound.sql`, `20260911160000_projectceo_m3_atomic_publication_flip.sql`, and documentation persistence/read migrations.

**Что реально реализовано — ИЗВЛЕЧЕНО.** Server-derived baseline/release snapshot tokens and request-bound publication command paths exist. M3 surface classification and closed/open module switch tests exist. WP-32 code wires authenticated baseline and release after approval.

**Только документация/неполное — ИЗВЛЕЧЕНО.** A complete external Tashkent documentation package and hosted `DOCUMENTATION_RELEASE` proof are not present. Some documentation-sheet and external attachment paths remain hardening/backlog work.

**Связи — ИНТЕРПРЕТИРОВАНО.** M3 consumes exact M2 approval/revision state and emits the production package version consumed by M4 distribution. A baseline is not a release until the request-bound release door succeeds.

**Security/authorization gaps — ИЗВЛЕЧЕНО.** Raw/legacy publication doors are guarded by module switches and request-bound command paths in the current migrations. **НЕ ПОДТВЕРЖДЕНО:** production grants, hosted ACL parity, and external release evidence.

**Evidence — ИЗВЛЕЧЕНО.** M3 guardrail/read/surface SQL and integration tests are present; the Vitest suite and local build pass. **НЕ ПОДТВЕРЖДЕНО:** execution of DB4 SQL against the current disposable Postgres, clean runtime or hosted release receipt.

**Minimum production work — ИНТЕРПРЕТИРОВАНО.** Pass authenticated Kora and external Tashkent runtime; prove exact source/document provenance, release artifact lineage, restart/idempotency/concurrency; complete M3 production hardening and hosted ACL review.

## 6. M4 · ГлавПрораб

**Официальное название и источник — ИЗВЛЕЧЕНО.** RemHaOS Charter §4 defines M4 as issuing/receiving the active package, RFI, deviations/substitutions, photo evidence, stages, acceptance and punch list, producing controlled execution history and Evidence Pack.

**Пользовательский поток — ИЗВЛЕЧЕНО.** Repository surfaces include `lib/project-intelligence/delivery/projectceo/m4-surface.ts`, M4 migrations for distribution, execution persistence, change/impact worker, photo evidence and V2/V3 compatibility, plus `tests/db4/07_m4_execution_boundary.sql`, `08_m4_surface_classification.sql`, and `55_m4_v2_v3_compatibility.sql`.

**Что реально реализовано — ИЗВЛЕЧЕНО.** Command contracts cover distribution, acknowledgement, change request, worker impact calculation, human impact review, photo upload/review and milestone acceptance. The WP-32 executor contains these stages and replay/cardinality assertions.

**Только документация/неполное — ИЗВЛЕЧЕНО.** Full handover/Evidence Pack production worker adoption and hosted operational workflow are not proven by repository contracts alone. AP6 runtime remains separate WP-32/WP-32 evidence.

**Связи — ИНТЕРПРЕТИРОВАНО.** M4 accepts only the server-derived released package version from M3, then records receipt, change impacts and field evidence against that version. It must not become ERP, warehouse, marketplace or warranty service; this boundary is explicit in the charter.

**Security/authorization gaps — ИЗВЛЕЧЕНО.** M4 has request-bound role/capability surfaces, package/project checks, idempotency and replay tests. **НЕ ПОДТВЕРЖДЕНО:** live hosted RLS, real executor/browser sessions, production worker scheduling and email/notification delivery.

**Evidence — ИЗВЛЕЧЕНО.** Local unit/integration tests pass and M4 DB4 contract files are present; those DB4 SQL scenarios were not executed in the current blocked runtime. **НЕ ПОДТВЕРЖДЕНО:** clean WP-32 runtime PASS; the latest attempt failed before the stack could pull images because Docker daemon socket disappeared.

**Minimum production work — ИНТЕРПРЕТИРОВАНО.** Obtain full runtime receipt; prove worker durability/restart and notification semantics; prove hosted package tenancy and role separation; define operational rollout/rollback and real site evidence policy.

## 7. Full cross-module path

**ИЗВЛЕЧЕНО.** The intended repository path is:

`public project identity → authenticated organization/project enrollment → M1 passport/foundation → M2 decision and approval → M3 baseline → M3 release → M4 distribution → builder acknowledgement → change → impact worker → human review → real photo review → milestone acceptance`.

**ИЗВЛЕЧЕНО.** `tests/ap1/e2e/run-five-sessions.zsh` contains the authenticated command sequence, server-derived snapshot/version bindings, replay assertions and capability isolation checks. `tests/pilot-evidence/run-m2-pilot-evidence.zsh` wraps Kora and external evidence and disposes the disposable environment.

**НЕ ПОДТВЕРЖДЕНО.** The complete path has not produced a clean current PASS receipt. The latest exact blocker was:

`Cannot connect to the Docker daemon at unix:///Users/msnigmatullaeva/.colima/archidom-ap1-disposable/docker.sock`.

The previous bounded run reached a Kora authenticated-read mismatch before the latest diagnostic retry; no hosted/production conclusion can be drawn from it.

## 8. Current architecture point

**ИЗВЛЕЧЕНО.** The repository is at the authenticated RU pilot boundary: a layered modular monolith with one Project Intelligence Core, compatibility `projectceo` namespaces, additive migrations, server-derived authorization and M1–M4 capability composition.

**ИНТЕРПРЕТИРОВАНО.** The product is not yet at production-adoption readiness. The implementation is between “local authenticated vertical slice” and “externally evidenced pilot”; the remaining risk is evidence/operational closure more than naming or module decomposition.

## 9. One sequential completion plan

1. **Restore local disposable Docker/Colima host** and obtain a stable socket; do not touch production/shared environments.
2. **Run WP-32 cleanly** with the handoff command; capture sanitized exact error if it fails and fix only the demonstrated cause.
3. **Independent security review** of enrollment, auth provenance, scope, idempotency, replay, baseline/release and M4 chain; then rerun full tests/build.
4. **External Tashkent continuation** through authenticated enrollment and the same M2→M3 doors; no privileged business/package SQL.
5. **Update WP-32 evidence** with real receipt hashes and runtime facts; classify any missing hosted fact as `НЕ ПОДТВЕРЖДЕНО`.
6. **Commit and push** the stabilized branch; create a draft PR; inspect CI and do not merge automatically.
7. **Only after pilot evidence** plan production adoption, hosted RLS/Auth/browser proof, worker scheduling, rollback and first paid pilot gates.

## 10. WP-32 status at audit time

**ИЗВЛЕЧЕНО.** Local implementation commit: `8173e88` (`Implement authenticated WP-32 enrollment flow`). Worktree currently contains uncommitted follow-up changes: the exact baseline graph-version binding for guest grants, the architecture audit file, and evidence wording updates; they are intentionally not pushed while runtime is blocked.

**НЕ ПОДТВЕРЖДЕНО.** No GitHub branch/PR was confirmed in this audit because the remote lookup failed with DNS/network resolution failure. No push or production mutation was attempted.
