# WP-28 — Launch gate metrics — EVIDENCE

[ИЗВЛЕЧЕНО] Date: 2026-09-11 (Asia/Makassar). Branch: `wp/wp-28-launch-gate-metrics`. Base: `07d9ea4933b994eaf92e2cfe9c13a1ebbf26ed5c` from fresh `origin/main`. Final HEAD/PR: resolve via `git rev-parse HEAD` and the PR containing this file (no self-referential commit hash).

## Основание
[ИЗВЛЕЧЕНО] `docs/execution/wp/WP-28-launch-gate-metrics.md`, WP_PROTOCOL; Charter v0.5 §18.9 and engineering preparation for §18.11–12/AP7. CONTEXT_MODE: repository_only; no Central Memory registration/binding asserted.

[ИЗВЛЕЧЕНО] Delegated current-turn owner inputs: “R7 accepted, R20 variant (a), R22 paid M1→M2 designer cycle.” These do not authorize shared DB, adoption, deployment, activation flags or paid calls.

## Allowlist по факту
[ИЗВЛЕЧЕНО] `app/api/intake/{start,submit,upload}/route.ts`, `app/api/proposal/respond/route.ts`, `app/dashboard/analytics/page.tsx`, `scripts/ops/launch-metrics.ts`, `lib/i18n/ru.ts` (`analytics` namespace only), the two requested report templates and this evidence file are within the card scope.

[ИЗВЛЕЧЕНО] Orchestrator explicitly expanded the allowlist to `tests/release/launch-metrics.test.ts`, `tests/release/launch-error-events.test.ts`, and `lib/analytics/launch-metrics.ts`. The pure shared module keeps dashboard/CLI formulas identical without importing Node-only CLI dependencies into Next.js or duplicating formulas.

[ИЗВЛЕЧЕНО] Orchestrator additionally authorized `app/dashboard/projects/[id]/proposal/actions.ts` and `app/dashboard/projects/[id]/proposal/page.tsx` strictly for best-effort PII-free legacy proposal error events. Save/rebuild/send/creation failures now have fixed event types. Existing approval guards, return values and rendering semantics are retained; error events may coexist with legacy success events after partial writes. No command-service changes.

## Хотспоты / пины / миграция
[ИЗВЛЕЧЕНО] H8 only (`ru.analytics`). No H1–H7/H11/H13/H14 changes, no migrations, no count pins, no CI edits. SQL in the CLI contains read-only SELECTs in a repeatable-read transaction, not a migration.

## Реализация
[ИЗВЛЕЧЕНО] After resolving the legacy capability, operation failures write only `designer_id`, `project_id`, and a fixed failure type to existing `events`. Submitted answers, tokens, filenames, provider error bodies and PII are excluded. Unknown/invalid capabilities never generate an event under another project.

[ИЗВЛЕЧЕНО] Database error responses are checked before emitting successful completion; failures return a fixed 500 error. Error telemetry itself remains best-effort and cannot mask the original failure. Successful rule fallback emits `intake_ai_fallback`, distinct from failed submission.

[ИЗВЛЕЧЕНО] Analytics reads paginated request-bound events, fails visibly on query errors, counts ordered stages by unique project and excludes projects without a link event. Duplicate/retry events cannot inflate conversions. Time metrics use the first start and first subsequent finish; sample counts and missing-pair censoring are explicit in the CLI/templates.

[ИЗВЛЕЧЕНО] CLI has explicit fixture mode and explicit owner-only bounded DB mode. It does not load env files, mutate DB or grant access. The URL is read from the process environment and never passed as a command-line argument or printed; subprocess failures are sanitized. Output contains aggregates only.

[ИЗВЛЕЧЕНО] Null/invalid costs are unknown. Known sums, missing costs, unscoped calls and failure counts remain separate; no unscoped cost-per-brief inference. Empty telemetry cannot establish zero cost. Snapshot reporting never marks adoption or paid wedge complete.

## Локальные гейты
[ИЗВЛЕЧЕНО] Node v22.23.0; npm 10.9.8. `npm ci --cache /private/tmp/wp28-npm-cache` exit 0. Initial default-cache attempt failed due to root-owned cache; no shared cache repair performed. Final npm ci reported 12 pre-existing dependency advisories (3 moderate, 8 high, 1 critical); dependency files were unchanged, no audit fix applied.

[ИЗВЛЕЧЕНО] Focused tests: 2 files, 15/15 pass. `npm run release:check` exit 0: lint, typecheck, 207 test files (1657 passed, 10 skipped), production build. Log: local `/private/tmp/wp28-release-check-final.log` (not hosted/production evidence).

[ИЗВЛЕЧЕНО] Lint: 13 existing unused-variable warnings in `lib/llm/gigachat.ts`, `lib/risks/llm.ts`, and four untouched test files; no errors. `git diff --check` exit 0.

[ИЗВЛЕЧЕНО] `npx --no-install ... impeccable detect` unavailable: package not installed; npx refused installation. No dependency/config changes. Existing project tokens retained, no new colors/fonts introduced. DB4/DB5 not run because no schema changes; real DB CLI execution not run.

## CI / Blind review
[ИЗВЛЕЧЕНО] Pending exact-HEAD remote CI and independent review; local green gates do not replace either. No AP5 artifact asserted.

## Grep-проверки
[ИЗВЛЕЧЕНО] Existing analytics on base counted raw events and selected last proposal send; intake routes ignored returned DB errors. `rg -n 'proposal_created|proposal_sent|ai_calls|cost_rub' app/dashboard lib/llm supabase/migrations` located existing event/AI contracts. `ai_calls.cost_rub` is nullable; existing recording has no price argument. This is an active implementation task, not a no-op.

## Не сделано / вынесено
[ИНТЕРПРЕТИРОВАНО] Actual metering coverage, provider invoice reconciliation, complete per-brief cost, at least three real briefs, paid scenarios, second organization project and adoption remain BLOCKED_ON_OWNER. Templates carry UNKNOWN values, not invented measurements.

[ИНТЕРПРЕТИРОВАНО] Legacy writes remain non-transactional; failure events do not make retries atomic or repair earlier partial writes. Total DB outage can also lose error telemetry. Invalid-token/rate-limit requests are not project-attributed. Improving these contracts is outside WP-28.

## Безопасность
[ИЗВЛЕЧЕНО] No production/shared DB/API/provider calls, deployments, activation flags, credentials files, migration edits or merge performed. No private runtime table access added to application routes. CLI reading is separately owner-run only.
