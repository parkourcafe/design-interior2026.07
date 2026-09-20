# R1-09 external review storage and command context

Repository-only storage increment, stacked on the R1-10 candidate contract at
`1e903d0`. This does not implement public review commands or close R1-09.

## Contract and allowlist

- `supabase/migrations/20260913023000_r1_external_review_storage_context.sql`
- `tests/ap1/environment/migration-ledger.sha256`
- `tests/db4/65_r1_external_review_storage_context.sql`
- `tests/db4/run.zsh`
- `tests/layout-studio/integration/integration.test.ts`
- This evidence file.

The separate test-only scanner deadline fix from PR #178 is also present in this
branch, to make the existing real-process termination regression independent of
child startup latency. It does not change the production scanner.

Private tables preserve scoped thread identity, immutable submissions and exact
normalized reference snapshots, separate client and technical decisions, and
append-only events. No authenticated or worker direct access is opened.
Self-approval follows canonical DEC-010: the submission initiator and decider
are compared, with explicit authorship disclosure. A technical decision does not
silently claim independent review. Client maker/checker restrictions remain.

The private command context authorizes, locks the project workflow before
subject state, rechecks authority, binds replay to the actor and full payload,
and completes against the locked server revision through the existing command
completion contract. Subject lifecycle revision and event sequence are separate;
unrelated project activity must not become client subject CAS. Public command
orchestration and race coverage are still required before exposing this context.

## Verification

Independent source review found and closed two P2 issues. Disclosure checks now
require an allowed JSON string and evaluate the whole predicate with IS TRUE.
Normalized references reconstruct all six typed selector shapes and compare the
complete descriptor to the immutable snapshot, rejecting asset substitution and
cross-kind substitution. Both regressions were reproduced against the faulty
implementation before the fixes; valid resolver-compatible leaf data remains
accepted. Final independent source review: PASS.

Local lint (0 errors, 13 pre-existing warnings), typecheck, 1777 tests and
Webpack build passed after the scanner test fix. Full disposable PG16 DB4 passed
including new regressions, concurrency and restart replay. Full DB4 PG17 and DB5 PG16 also passed. DB5 PG17 twice stopped before
migrations because its disposable database did not become ready; environment
diagnosis is ongoing. This is missing PG17 DB5 evidence, not a SQL failure
or a passing check.
GitHub CI/AP5 and Claude code review are separate outstanding evidence.

## Remaining delivery

Request-bound submit/decide/withdraw/read commands, explicit readiness from
immutable clean-byte lineage, human acceptance, authenticated UI and browser
races, release authorization and atomic 0.2 publication are not supplied here.
No readiness stub, synthetic human approval or legacy scan-outcome shortcut
is an acceptable substitute. No shared DB, production, deploy or flags changed.
