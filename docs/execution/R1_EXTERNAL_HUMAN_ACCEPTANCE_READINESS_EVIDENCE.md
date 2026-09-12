# R1 private human acceptance and source readiness

Repository-only increment stacked on materialization PR184. This does not open a public RPC, seed live authority or publish a native release.

## Scope and allowlist

- `supabase/migrations/20260913063000_r1_external_human_acceptance_readiness.sql`
- `tests/ap1/environment/migration-ledger.sha256`
- `tests/db4/69_r1_external_human_acceptance_readiness.sql`
- `tests/db4/run.zsh`
- `tests/layout-studio/integration/integration.test.ts`
- this evidence file

The additive migration records one terminal accepted/rejected human decision for an exact materialized R1 intake. It derives fresh human authority through existing exact-package review_source, binds actor/request replay and atomically closes typed decision, intake review fields and event actor/time. Accepted files stop at human_reviewed; no automatic native ingestion or approval/release is fabricated.

The private assert_external_source_ready predicate requires exact intake/receipt/canonical/AssetVersion lineage and explicit acceptance. Current read/retention authority is checked separately from historical uploader, acceptor and worker provenance. It adds no retrospective employment check or rolling age expiry to valid historical evidence. SKP source retention remains distinct from a viewable GLB representation and from native release readiness.

## Verified local evidence

SQL SHA256: f29b7e69b6cd69f716f2741f1b073e34606885cd3d23d2ec0e39da388805421d.
Fixture SHA256: 15071f80584f418a943f4414e05d83545be99d4838a61db26bb5d36e780f328c.

Independent final source/fixture/runner review PASS. A test-only finding was corrected: readiness assertions now compare the exact seven-field JSON using IS DISTINCT FROM, including byteLength and validatedFormat; absent, null, extra or wrongly typed fields fail. Migration source was unchanged by this correction.

Corrected PG16 and PG17 fixtures passed private grants, forged acceptance denial, atomic late-failure rollback, actor-bound replay, revoked grant/new/replayed commands, current read grace/policy rotation/expiry, historical employment changes, SKP retention versus GLB viewable profiles, actual observed acceptance/capability-revoke lock races and exact readiness replay postchecks. Dedicated bounded local containers were removed and absence verified. The local tmpfs replay checks did not restart PostgreSQL.

Local lint/typecheck/1777 tests/Webpack build PASS;13 existing lint warnings. Layout classification first failed for this new non-Layout migration, then passed after explicit classification. DB4 runner now includes persistent-data restart plus E-specific exact replay checks; actual CI restart evidence is pending on the final head.

## Remaining integration

Independent Claude code review and current-head CI/AP5/DB4/DB5 remain separate pending evidence. No hosted/shared DB or production proof is claimed. Runtime transport and public command/read wiring, full release predicates, real scanner/storage bindings, and Gate0 remain separate work. Merge, shared DB, production, deploy and flags require their owner gates.
