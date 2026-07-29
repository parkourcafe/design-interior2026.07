# RemHaOS Repository Reality — 27.07.2026

## Evidence

- Repository: `parkourcafe/design-interior2026.07`.
- Default branch: `claude/new-session-gsayp3`, commit `7fd3512d6a6c24898ee9cd4be598c2c51f338102`.
- Production branch/commit: GitHub Production deployment evidence points to `main`, commit `10725364065bcb538607ec2930d4be5571751626`, deployed 18.07.2026.
- Sprint branch: `codex/archidom-sprint1-platform-foundation`.
- Open PRs at reconciliation: none.
- Default branch had a clean checkout. The prior local checkout was on `claude/arhidom-cinematic-website-t2zfdc`; its iCloud-backed `.git/index` was dataless and was preserved unchanged.
- Deployment configuration: Vercel GitHub deployments exist; canonical default HEAD had Preview deployment only. No `.vercel` project metadata is committed on the canonical branch.
- Migrations before Sprint: `0001`–`0006`. Platform migration added as `0007`.
- Feature flags: no application feature-flag service found. Runtime provider selection is env-based.

## Repository facts

- M1 public intake, deterministic passport, hybrid risks, Review Board, deterministic pricing and proposal token flow are implemented in code.
- Existing proposal issue had no reusable approval gate.
- Existing `events` is a thin product-event table, not an immutable platform audit ledger.
- Project facts, workflow runs/steps, approval requests, AI call cost ledger and versioned studio standards were absent.
- Existing risk regeneration deletes all cards, including accepted cards. This remains a known legacy conflict; the Sprint workflow creates governed facts but does not silently claim the risk engine itself is immutable.
- Public intake and public proposals use server routes plus service role after token lookup; no anonymous data policies were found.

## Verdict

Repository structure is reconciled. Production runtime/database state is not modified by this branch and requires a controlled migration/deployment gate.

