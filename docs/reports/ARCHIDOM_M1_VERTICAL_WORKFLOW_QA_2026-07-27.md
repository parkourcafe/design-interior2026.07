# ArchiDom M1 Vertical Workflow QA — 27.07.2026

> **Superseded current-state note (28.07.2026).** The browser and database
> results below belong to an earlier disposable package. That branch is no
> longer final-package evidence. Current target order is
> `Facts → Review → Questions → Passport → Risk`, while observed persisted
> legacy order is `Facts → Passport → Risk → Review → Questions`; this keeps M1
> `PARTIAL`. Use `ARCHIDOM_WORKFLOW_QA.md` for current evidence and verdict.

## Automated evidence

- 21 test files, 104 tests passing.
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

Both `rerunRisks` and failed-workflow retry now reserve a linked workflow step
and `ai_calls` row before executing the metered pipeline. Actual provider usage
is persisted idempotently before a separate authenticated command atomically
finalizes passport, proposed risk cards, workflow state and audit evidence. A failed/empty
reservation prevents provider execution. Successful proposal rebuild now
invalidates both local release-approval flags through an executable state
transition test rather than source-text parsing.

The post-review local production build used disposable Auth and service-role
credentials from gitignored `.env.local`. Authenticated browser QA passed:

- release approval enabled proposal send;
- successful rebuild replaced the proposal sections;
- rebuild immediately invalidated release/self-approval state;
- send became disabled and human confirmation was required again;
- browser console warnings/errors: 0;
- local server runtime errors during the verified flow: 0.

The database race remains independently covered by live disposable SQL.
The newer reservation/finalization migrations passed Supabase PR Preview on
`krspwzipzfuwumzotpmb`; catalog checks confirmed function privileges,
`search_path` hardening and lifecycle constraints. They have not been applied
to production or to the paused pilot branch.
