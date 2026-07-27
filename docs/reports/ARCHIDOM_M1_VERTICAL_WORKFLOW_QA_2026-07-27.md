# ArchiDom M1 Vertical Workflow QA — 27.07.2026

## Automated evidence

- 19 test files, 88 tests passing.
- Passport regression: 12 tests.
- Pricing regression: 4 tests.
- Risk rules/schema/dedupe/LLM tests passing.
- Workflow transitions, retry, fact versioning, action contracts, approval label,
  resolver precedence and migration security contract passing.
- Production build and TypeScript compilation passing.

## Browser evidence

Local production runtime (`next start`) was built with disposable branch
credentials. Authenticated login and the complete client/designer path passed:

`project → public brief → workflow/facts → human fact review → passport → risk
fallback → proposal → approval → issue → public proposal`.

The UI displayed `Подтверждено автором действия` for self-approval rather than
representing it as independent review. The public proposal passed at 390×844
with `scrollWidth = innerWidth = 390` and no console warning/error in a fresh
tab.

Browser QA found and fixed a legacy compatibility failure where an empty
`proposal_defaults = {}` crashed setup. The fixed page was rechecked.

## Database evidence

Migrations `0007` and `0008` were applied successfully to disposable Supabase
branch `archidom-sprint1-pilot`. Cross-studio isolation, anon denial, AI fact
confirmation denial, append-only ledger permissions, approval immutability and
workflow state transitions passed live SQL role tests.

Final database evidence for the browser run:

- workflow `completed`, current step `issue_proposal`;
- approval `approved`, `self_approved = true`;
- proposal `sent` with public token;
- fact version created through `supersedes_id`;
- 4 audit events and 1 metered AI-call record.

## Retry/resume evidence

A controlled `generate_risk_register` failure was created on the disposable
branch and replayed through the authenticated project UI.

- failed attempt 1 remained immutable;
- retry created exactly attempt 2;
- previously completed `build_project_passport` attempt 1 was not replayed;
- attempt 2 completed with deterministic fallback and recorded the provider
  failure separately in `ai_calls`;
- workflow resumed to `waiting_for_human · human_review`;
- audit trail contains `workflow_retry_started` and
  `workflow_retry_completed`;
- retry AI call points to the first call through `retry_of_id`;
- concurrent second active attempt was rejected by the partial unique index;
- fresh browser console contained no warning/error.

## Corrective approval/ledger evidence

The PR #49 corrective branch adds exact proposal revisions and removes direct
authenticated mutations from `workflow_runs`, `workflow_step_runs` and
`approval_requests`.

- authenticated roles retain ledger SELECT but have no INSERT/UPDATE privilege;
- retry/rerun/authorize/issue mutations use six guarded command RPCs;
- proposal approval references one immutable `proposal_revisions` row;
- editing after approval immediately invalidates the UI release state;
- re-approval creates a new monotonic revision;
- issue consumes the exact approval/revision and is idempotent only for that
  same issued revision;
- issued proposal content is protected by a database trigger;
- SQL retry replay reached `waiting_for_human · human_review`, while a second
  terminal replay was rejected;
- authenticated browser QA passed
  `approve revision A → edit to B → approval invalidated → approve B → issue B`;
- after issue the editor is disabled and Save is absent;
- no new browser warning/error appeared during the corrective flow.

The corrective migrations were executed against the disposable branch. The
first attempt failed transactionally on invalid PL/pgSQL composite assignment;
the query was corrected and the clean migration then applied successfully.

## Remaining gate

Production migration/deployment, production browser regression and a successful
credentialed YandexGPT call were not executed.

Verdict: `M1_VERTICAL_WORKFLOW: PARTIAL`.

## PR #50 post-merge review correction

The additive `20260727114500_guard_proposal_revision_issuance.sql` migration
moves the stale-approval comparison into the locked issuance command. Live
disposable-branch proof covered both directions:

- a draft changed after approval remained `draft`; its revision was not issued,
  approval was not consumed and workflow remained running;
- an unchanged exact approved revision advanced the proposal to version 2,
  consumed the approval and completed the workflow;
- a cross-studio caller remained denied.

`rerunRisks` now resolves the governed workflow before executing the metered
pipeline, persists and checks the `ai_calls` record before changing passport or
risk-card state, and fails on every checked persistence error. Successful
proposal rebuild now invalidates both local release-approval flags.

The post-review local browser login reached the disposable Auth service, but
authenticated dashboard rendering requires the disposable service-role key
through the legacy `getStudio()` resolver. The connector exposes only a
publishable key, so this incremental browser recheck is
`BLOCKED_BY_DISPOSABLE_SERVICE_KEY`; no production key was substituted.
The rebuild behavior is covered by a focused regression contract, while the
database race is covered by live disposable SQL.
