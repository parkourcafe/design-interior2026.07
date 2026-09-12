# R1 external validation: private durable jobs

Stacked on upload control/closure PR181. This slice implements private processing
coordination and evidence storage, not an operational broker or accepted upload.

## Implemented scope

Scoped principal/host bindings and host/worker/project capacity, durable jobs and
immutable attempts, broker-held lease secret with digest-only persistence, bounded
heartbeat, expiry/reclaim and three-attempt retry. Current organization/package/
principal/host authorization is locked and rechecked. Existing exact terminal
replay follows fresh processing authorization, before requiring an unexpired lease;
new writes still require the live attempt/fence.

Immutable validation, canonical-byte and completion facts correlate exact scope,
generation, attempt, measured hash/length, runtime policy and canonical evidence.
Success holds logical and physical reservations until later atomic materialization.
No intake/AssetVersion or human acceptance is created here. Failure preserves
physical liability through the narrow additive closure model. Original033000 and
035000 remain immutable; runtime helper/table grants remain revoked and no actual
authority, host allowance or credential is seeded.

## Allowlist

- supabase/migrations/20260913043000_r1_external_validation_jobs.sql
- tests/ap1/environment/migration-ledger.sha256
- tests/db4/67_r1_external_validation_jobs.sql
- tests/db4/run.zsh
- tests/layout-studio/integration/integration.test.ts
- This evidence file.

## Verification

Independent intent and final source/fixture/runner reviews PASS after correcting
revocation row locking and validity rechecks after lock waits. Focused PG16/17
tests passed actual lease expiry, retries, stale fences, two-project host/worker/
project limits, observed-lock organization/principal revocation races, uploader
departure, malformed receipts, cancellation, terminal replay and unchanged held
reservations with no intake/Asset creation. Success and failure cleanup verified.

Local lint (13 existing warnings, no errors), typecheck,1777tests and Webpack build
PASS. Local tmpfs runs validated the postcheck WITHOUT restart. Permanent DB4
wiring commits validation evidence, restarts the database, then checks exact
terminal replay, unchanged counts/accounting and altered-request rejection.
Its actual persistent restart/CI/AP5 result is pending.

Dedicated Claude code review is BLOCKED_EXTERNAL by the existing subscription
limit, not a PASS. Broker authentication transport, real scanner/storage/sandbox
evidence, intake/Asset lineage, human acceptance and readiness are remaining work.
No shared DB, production, deploy, flags or merge was performed.
