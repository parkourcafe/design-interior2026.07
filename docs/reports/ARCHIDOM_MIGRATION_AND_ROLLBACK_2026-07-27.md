# ArchiDom Migration and Rollback — 27.07.2026

## Migration

`0007_platform_foundation_m1.sql` is additive. It creates ten tables, indexes,
constraints, one fixed workflow definition and RLS policies.
`0008_platform_security_hardening.sql` adds least-privilege grants, a private
membership helper, mutation guards and covering indexes. Existing timestamped
migrations and legacy columns are unchanged.

## Controlled adoption

1. Snapshot/fingerprint target DB and confirm migrations `0001`–`0006`.
2. Apply `0007`, then `0008`, to a disposable branch.
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

Disposable branch status: both migrations applied successfully on 27.07.2026.
Production migration status: not applied.
