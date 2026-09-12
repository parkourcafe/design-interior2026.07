# R1 upload control: private SQL slice A

Base: candidate contract1e903d0. Repository-only implementation; no upload
endpoint or authoritative hosted binding is opened by this migration.

## Scope

Private versioned authority/runtime policy bindings, quota ledgers and
reservations, upload sessions, bounded finalize claims, immutable seal/generation
facts and durable outbox. Private begin/cancel helpers reuse exact-package human
authorization and existing integration command replay/audit. No real policy,
quota entitlement, broker credential or storage approval is seeded.

Operational provenance and state are guarded separately from append-only facts.
Quota reservations serialize under project/policy/ledger locks; deferred
aggregate checks keep the ledger equal to its reservations. Cancellation retains
physical liabilities until a future verified cleanup transaction acknowledges
actual removal. Finalize facts bind exact session revision, cancellation revision,
part manifest, policy, claim fence, seal and generation; deferred constraints
reject a partial terminal transition. Enqueue binds the exact seal fence.

## Allowlist

- supabase/migrations/20260913033000_r1_external_upload_control.sql
- tests/ap1/environment/migration-ledger.sha256
- tests/db4/66_r1_external_upload_control.sql
- tests/db4/run.zsh
- tests/layout-studio/integration/integration.test.ts
- This evidence file.

The branch also carries the reviewed PR178 scanner deadline test fix, needed
for the existing process test on loaded runners; production scanner unchanged.

## Evidence and remaining checks

Independent source review PASS at migration SHA256
157197cb6e2af201be1ac5ed82c865c72990a99e4fb69b5ce023886726ef5993
after fixing enqueue-fence binding. Local lint/typecheck/1777tests/Webpack PASS
(13 pre-existing lint warnings). Focused PG16/17 tests applied exact migrations
and fixtures using a bounded local tmpfs data directory because persistent
Colima storage was full. This does not prove container restart or hosted behavior.
Expanded actor/package/tenant/revocation and quota-concurrency matrix passed
on PG16 and PG17. The race observes one sleeping lock holder and a second
transaction actually waiting on a lock, then verifies one winner, a quota-specific
loser and exact accounting. Both success and synthetic-failure container cleanup
were verified. Post-check validates exact receipts and unchanged ledger/outbox/
command/session/reservation counts; locally this was run without restart.
The permanent DB4 runner now creates these records, performs a second actual
container restart, then repeats the post-check. Its CI result is still pending.
Final independent fixture/runner source review PASS.

No public finalize RPC, authenticated worker broker, validation lease consumer,
measured receipt persistence, intake/AssetVersion materialization, cleanup
acknowledgement or readiness function is implemented in this slice. Those are
necessary follow-up work; private evidence-shaped tables alone are not real AV,
canonical storage, accepted file or construction release proof. GitHub CI/AP5
and full persistent restart evidence are separate checks. No merge, shared DB,
production, deploy or flags were changed.
