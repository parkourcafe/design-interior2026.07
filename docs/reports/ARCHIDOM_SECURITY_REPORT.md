# RemhaOS Security Report

Date: 2026-07-28
Status: `PARTIAL`

## Implemented Controls

- RLS remains enabled for governed platform tables.
- Runtime access to private tables is avoided; guarded commands derive actor/project/studio context server-side.
- Human approvals are not performed through `service_role`.
- Terminal AI commands are `service_role` only.
- Public intake input is bounded before request body buffering.
- AI facts cannot be written as `human_confirmed`.
- Approved overrides are immutable and require exact digest approval.
- Unsafe table privileges are revoked from API roles where command RPCs are required.

## Independent SQL Proof

Result: `FINAL_BEHAVIORAL_SQL_PROOF_OK`

Covered:

- direct approved insert denied;
- digest includes value and `standard_version_id`;
- exact-digest auth approval succeeds with actor/audit metadata;
- stale digest and cross-tenant approvals fail;
- approved override mutation/delete is denied;
- parent project cascade remains valid;
- `service_role` cannot execute human approval RPC;
- terminal AI RPCs are `service_role` only;
- private helpers are not executable by API roles.

## Verification

- Tests: 61 files, 250 tests passed.
- Lint: passed.
- Typecheck: passed.
- Build: passed.
- PG17 replay: 18/18 migrations passed.

## Residual Risk

Final exact-hash browser QA and formal external security scan are not complete in this environment. Production migrations remain blocked.

## Verdict

`SECURITY: PARTIAL`

## 2026-07-30 production RLS verification

This section supersedes the earlier provisional migration gap.

- Production SQL confirms `rls_enabled=8` for the eight Platform Foundation
  tables required by Sprint 1.
- Production SQL confirms active policies on every required table: one policy
  on `ai_calls`, `audit_events`, `project_sources`, `workflow_definitions`,
  `workflow_runs` and `workflow_step_runs`; two on `project_facts`; three on
  `approval_requests`.
- The real browser flow enforced human approval before issue and labelled a
  same-actor decision as self-approved; AI did not issue or approve the
  proposal.
- The established contract, SQL replay and production browser checks remain
  green; no security control was weakened for the release.

## Final Verdict

`SECURITY: READY`
