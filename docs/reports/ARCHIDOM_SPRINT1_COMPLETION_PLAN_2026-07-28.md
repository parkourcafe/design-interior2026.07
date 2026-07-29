# ArchiDom Sprint 1 — Completion Plan

Date: 2026-07-28  
Execution mode: four parallel streams  
Target: one reviewed draft PR at the production-adoption gate

## Non-negotiable boundary

This plan completes Platform Foundation + the M1 vertical workflow only.
It does not implement M2–M5, Marketplace, Workflow Builder, integrations,
billing, CAD/BIM, or a product redesign.

Production migration history will not be repaired and migrations will not be
applied to production without a separate explicit owner decision. The completion
package must make that final gate small, reversible, and evidence-based.

## Starting evidence

- Repository reality and baseline reconciliation package are merged.
- Clean local and disposable database replay has previously passed.
- The pre-completion code baseline passes 106 tests, lint, typecheck, and the
  production build.
- Approval, immutable proposal revisions, retry reservations, AI usage closure,
  and migration compatibility bridges are present.
- Remaining gaps are runtime coverage of the full M1 action sequence, crash-safe
  initial-intake metering, persisted `standard_drift`, current evidence reports,
  full mobile browser QA, and production adoption.

## Four parallel streams

### Stream A — Governed M1 runtime

Owner: workflow agent

Deliverables:

1. Persist deterministic M1 steps that already exist in the product:
   `generate_clarifying_questions`, `build_scope_draft`, `calculate_fee`, and
   `generate_proposal_draft`.
2. Persist `issue_proposal` from the successful issuance transaction.
3. Make inserts idempotent and keep WorkflowRun resumable.
4. Keep approval human-only and preserve the existing immutable revision lock.
5. Add unit and migration-contract tests.

Proof:

- Canonical action order is visible in `workflow_step_runs`.
- Reopening or retrying a page does not create conflicting active attempts.
- Approval remains required before issue.
- Existing proposal links and legacy project behavior remain compatible.

### Stream B — Initial-intake AI accounting

Owner: metering agent

Deliverables:

1. Reserve the initial risk workflow step and `ai_calls` ledger row before any
   provider request.
2. Prevent provider execution when reservation fails.
3. Persist usage immediately after the provider returns and before business
   output finalization.
4. Reuse the same reservation IDs during workflow finalization.
5. Close failed reservations explicitly and preserve measured cost evidence.
6. Expose the public-intake reservation command only to `service_role`; keep anon
   and authenticated roles denied.

Proof:

- Source-order and SQL permission contracts pass.
- No second post-provider `ai_calls` insert exists.
- A provider-completed/business-failed path still retains immutable usage.
- Public token validation remains the authorization boundary.

### Stream C — Studio Resolver and drift

Owner: standards agent

Deliverables:

1. Preserve resolver precedence:
   approved project decision → project override → studio default → platform
   default.
2. Preserve the approved value when a referenced studio standard is superseded.
3. Append a `standard_drift` audit event with old/new version provenance.
4. Never overwrite the approved project decision.
5. Add pure-domain and migration-contract tests.

Proof:

- Resolver tests preserve approved decisions.
- A version insert creates append-only drift evidence for affected approved
  overrides.
- No migration mutates `project_overrides` during drift recording.

### Stream D — Integration, security, and release evidence

Owner: primary integrator

Deliverables:

1. Integrate the three streams without changing existing timestamped migrations.
2. Correct internal cost classes to match actual runtime behavior.
3. Run full unit, lint, typecheck, and production build checks.
4. Replay all migrations on an empty local PostgreSQL database.
5. Validate a disposable Supabase branch, authenticated RLS negatives, retry,
   approval, issuance, and migration compatibility.
6. Run complete desktop and mobile browser flows with console/network checks.
7. Refresh repository reality, readiness matrix, conflict register, QA, security,
   migration, platform, and AI cost reports.
8. Open one draft PR, obtain independent code/security/database reviews, fix
   findings, and rerun proof.
9. Delete the disposable branch after evidence is captured so hourly billing
   stops.

## Execution waves

### Wave 1 — RED

Each vertical slice starts with one failing behavioral or infrastructure
contract. Missing-import stubs are allowed only to turn setup failures into
behavioral failures.

### Wave 2 — GREEN

Fresh implementers see only the failing test, failure output, and relevant source
surface. Each stream owns non-overlapping application files. Shared SQL is merged
by the primary integrator.

### Wave 3 — REFACTOR and security review

Fresh reviewers receive only green code and test output. Suggestions are applied
one at a time and retained only when lint, typecheck, and the full suite remain
green.

### Wave 4 — Database proof

Run:

1. empty local replay;
2. restart replay;
3. idempotency and concurrency checks;
4. authenticated positive and cross-tenant/package negative checks;
5. rollback rehearsal;
6. disposable Supabase replay and advisor review.

### Wave 5 — Browser proof

Desktop and mobile:

project → brief → review → passport → risk → proposal → approval → issue →
retry/resume.

Required evidence:

- no browser console errors;
- no failed network requests;
- workflow steps and AI usage persisted;
- self-approval labelled as approval by the author;
- public links remain usable;
- migration compatibility confirmed.

### Wave 6 — PR and adoption gate

The draft PR may become ready-for-review only after all non-production proof is
green and review findings are closed. It must not be merged automatically.

Production adoption requires a separate decision covering:

1. migration-history repair plan;
2. exact production backup/snapshot;
3. apply and rollback window;
4. responsible operator;
5. post-apply RLS, health, cost-ledger, and browser checks.

## Completion verdict rule

`READY` is evidence, not intent. Any missing database replay, RLS proof, build,
test, browser QA, or production adoption proof keeps the corresponding verdict
at `PARTIAL` or `BLOCKED`.

