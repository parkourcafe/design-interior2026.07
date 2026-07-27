# ArchiDom Migration and Rollback — 27.07.2026

## Migration

`0007_platform_foundation_m1.sql` is additive. It creates ten tables, indexes,
constraints, one fixed workflow definition and RLS policies.
`0008_platform_security_hardening.sql` adds least-privilege grants, a private
membership helper, mutation guards and covering indexes. Existing timestamped
migrations and legacy columns are unchanged.
`0009_workflow_retry_idempotency.sql` adds a partial unique index that permits
historical attempts but prevents two active attempts for the same workflow step.
`20260727111743_govern_proposal_revisions_and_workflow_commands.sql` adds
immutable proposal revisions, exact revision approvals and guarded workflow
command RPCs while revoking direct authenticated ledger mutations.
`20260727113109_lock_issued_proposal_content.sql` prevents in-place changes to
an issued proposal. `20260727113235_index_corrective_foreign_keys.sql` covers
the new foreign keys reported by the database advisor.

## Controlled adoption

1. Snapshot/fingerprint target DB and confirm migrations `0001`–`0006`.
2. Apply `0007`, `0008`, `0009`, then the three timestamped corrective
   migrations to a disposable branch.
3. Run policy/role negatives and M1 E2E.
4. Only then schedule production adoption.

## Rollback

Before any workflow writes, rollback may drop the new tables in reverse FK order:
`project_overrides`, `studio_standards`, `ai_calls`, `audit_events`,
`approval_requests`, `workflow_step_runs`, `workflow_runs`,
`workflow_definitions`, `project_facts`, `project_sources`.

After workflow writes, prefer application rollback: deploy the previous app,
retain additive tables as dormant evidence, and do not destroy audit/fact history.
Physical table removal then requires an explicit retention/export decision.

The corrective migration's first disposable execution failed and rolled back as
one transaction because of invalid PL/pgSQL composite assignment. After fixing
the statement, all migrations applied successfully. Rollback must therefore
retain `proposal_revisions`, approval revision references and issued-revision
audit evidence after any authorization or issue operation.

Disposable branch status: all six Sprint/corrective migrations applied
successfully on 27.07.2026.
Production migration status: not applied.
