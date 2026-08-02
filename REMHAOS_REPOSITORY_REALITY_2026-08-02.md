# RemHaOS repository reality — 2026-08-02

Status: **RECONCILED for the feature branch; production adoption remains unproven**.

## Evidence

- Feature branch: `codex/ap1-migration-chain-reconciliation`.
- Working baseline before this report: `1c5cbf5390a0553c8d58fe6ca7c66b614ce17dd1`.
- GitHub repository: `parkourcafe/design-interior2026.07`.
- GitHub default branch is `claude/new-session-gsayp3`; the PR target is `main` at
  `15f4318a3215dd5b3b29b1edb111079def4ac255`. This mismatch is recorded rather
  than silently treated as a product decision.
- PR #62 is open and draft. PR #61 is the related migration-path draft; PR #59
  is the production reconciliation proposal. No merge was performed.
- A preview deployment exists for the branch at `1c5cbf5`. The GitHub deployment
  API returned no production deployment record, so deployed production commit is
  `UNKNOWN` from repository evidence.
- The canonical chain replays cleanly through 24 migrations on local Supabase and
  PostgreSQL 16/17 harnesses. Production was not migrated.
- Production read-only evidence is recorded in
  `docs/product-intelligence/agent-runs/db-wave/PRODUCTION_COMPATIBILITY_MATRIX_2026-08-02.md`:
  production has a separate 13-entry ledger, zero `projectceo_*` schemas and no
  `project_intelligence` schema. This is a compatibility gap, not permission to
  rewrite production.

## Safe consequence

The feature branch is ready for review of the additive fixes. Production remains
on its existing schema and secrets. The next production action requires a
separate controlled adoption gate with a complete schema/ACL/RLS snapshot and a
clone-only compatibility bridge proof.
