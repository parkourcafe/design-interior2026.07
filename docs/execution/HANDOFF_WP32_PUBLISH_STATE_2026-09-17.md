# WP-32 publish-state handoff

Date: 2026-09-17, Asia/Tashkent
Repository: `parkourcafe/design-interior2026.07`
Local checkout: `/private/tmp/archidom-wp32-ap6-run`
Branch: `codex/wp32-ap6-run-cycle7`
Base before local changes: `8173e88`

## Decision for this handoff

This handoff freezes the current local WP-32 state for GitHub publication. It is not a production rollout, not a merge approval, and not a claim that every external package boundary is closed.

The branch should be published as a draft PR so the work no longer depends on the temporary `/private/tmp` worktree.

## What is fixed in this branch

- The Kora local chain is no longer dependent on DB3/DB4/DB5 business fixture seeds for the main authenticated evidence path.
- Kora now exercises authenticated decision, approval, baseline, release, distribution, acknowledgement, change, impact worker, human review, photo review, and milestone acceptance flow in the local wrapper scope.
- The external enrollment path has an authenticated organization/project/package enrollment contract with scoped memberships and role capabilities.
- The external receipt model preserves distinct HTTP request IDs and server audit request IDs instead of rewriting one identity into another.
- Receipt validation has adversarial tests for forged audit request IDs and wrong parent request bindings.
- The executor allowlist includes the current external runner digest.
- New additive migrations are present for enrollment audit vocabulary, enrollment upsert repair, and source snapshot publication.

## Verified local evidence

- Canonical local wrapper PASS for the branch's current wrapper scope:
  - PASS timestamp: `2026-09-17T09:52:17.341Z`
  - PASS artifact SHA-256: `b270a385188690257c446d416b2bd34d52befb978290046706eb84a2823f114a`
  - PASS copy: `/Users/msnigmatullaeva/Documents/designinterior2026/backups/wp32-proof-binding-recovery/PASS.json`
- The wrapper emitted both `KORA_LOCAL_AUTHENTICATED_PASS` and `EXTERNAL_REAL_PACKAGE_PASS`.
- PostgreSQL 16 and PostgreSQL 17 DB4 harnesses passed inside that wrapper run.
- Final quality gate after the runtime run:
  - `npm run lint`: passed with 0 errors and 13 existing warnings.
  - `npm run typecheck`: passed.
  - `npm run test`: passed, 224 files / 1885 tests.
  - `npm run build`: passed.
  - `git diff --check`: passed.

## What is still not closed

- Production, shared environments, Google Drive source folders, and Pejeng were not modified by this branch.
- The current PR does not merge or deploy anything.
- The repository still contains historical Tashkent wording in older audit/handoff material and some fixture labels. The latest working instruction says the external source package should be the architect-provided Google Drive documents. That source reconciliation remains open and must be handled as a separate, explicit package-source cleanup before claiming real external production evidence.
- The canonical wrapper PASS proves the wrapper's current scope. It does not, by itself, prove hosted browser/Auth/RLS behavior, production adoption, paid pilot readiness, or a complete external Drive-document provenance chain.
- The independent security review was started as a local scan during the working session, but it was not completed to a final accepted security report before this publication handoff.
- The architecture audit file in this branch is a repository snapshot and contains historical lines that are partially superseded by the later wrapper PASS and this handoff.

## Safe continuation

1. Review the draft PR diff first, especially the three new migrations and the external receipt validation changes.
2. Reconcile the external package labels and manifest/provenance with the architect-provided Google Drive document set. Do not relabel old Tashkent fixture evidence as Drive evidence without actual source inventory and version bindings.
3. Complete a fresh security review against the PR commit, not against the old dirty worktree.
4. If more runtime evidence is required, rerun only disposable local runtime. Do not touch production/shared systems.
5. Update `docs/audits/wp/WP-32_EVIDENCE.md` and the four-module audit after the source-package reconciliation, not before.

## Do not do

- Do not merge this PR until the remaining production/source provenance gaps are accepted or closed.
- Do not deploy from this branch.
- Do not use privileged SQL for human business operations.
- Do not claim Drive-document provenance until the exact document registry, versions, hashes, and package bindings are recorded.
- Do not treat local/disposable PASS as hosted or production evidence.
