# WP-42 orchestration state

- Project: `parkourcafe/design-interior2026.07`
- Canonical ref at start: `origin/main` / `e5e8d79b5888431856fff137e1ec8285e2b534e2`
- Branch/worktree: `wp/wp-42-market-routing` / `/private/tmp/archidom-wp42-20260911`
- CONTEXT_MODE: `repository_only`; Central Memory tools are unavailable.
- Phase: regional routing foundation
- Slice: WP-42A market/cell policy, no runtime activation
- State: `PR_PREPARATION`
- Latest checks: final targeted suite 14/14 PASS; `npm run release:check` PASS
  (lint 0 errors/13 pre-existing warnings, typecheck PASS, 1629 tests PASS/10 SKIP,
  build PASS)
- Active reviewers: exact final blind review PASS; governance contradiction remains
  isolated in owner gate G42-GOV
- Next action: commit, push and open draft PR; then prepare gated persistence slice
- Owner gate: migration/RLS/security and shared/production infrastructure

## Governance limitation

Automatic approval review rejected adding an owner-override block to `AGENTS.md`
and changing historical execution plans without a separate explicit governance
authorization. The implementation continues under the owner's current-session
instruction. ADR-0008 and this state record the decision; `AGENTS.md` and old
plans remain unchanged until gate G42-GOV is approved.

## Verified conflicts

- ADR-0005 already establishes RemHaOS as the public brand; no new brand choice
  is required.
- ADR-0004 and architecture-v1 prohibit current multi-region runtime. The owner
  explicitly selected variant B on 11.09.2026; ADR-0008 supersedes only that
  regional limitation and preserves one product/four workspaces.
- Current Supabase clients read one global endpoint. This slice does not claim
  that two data planes exist.
- `architecture-v1.md` is a frozen input protected by a byte-for-byte contract.
  ADR-0008 is therefore the additive decision record; editing the frozen file
  remains in G42-GOV.

## Unknowns retained

- RU cloud/provider and exact endpoint are not selected or paid.
- Existing account/project migration policy is not approved.
- Russian legal filing, retention and cross-border basis are not established by code.
- Selena Systems LLC operational readiness and US production operator details are unverified.
