# AP1 Migration Replay Report — 2026-08-01

Status: disposable replay PASS; production unchanged

## What changed

- Removed legacy numeric `0001`–`0007` files from executable
  `supabase/migrations/` input.
- Preserved their exact bytes as legacy evidence; the local `0007_invite_tokens`
  candidate is recorded separately because it is not part of the audited
  production baseline.
- Updated the AP1 migration ledger to contain only timestamped migrations.
- Extended DB2 schema/ACL assertions for the request-claims helpers introduced
  by the merged AP1 authorization fix.

## Evidence

| Check | Result |
|---|---|
| Clean DB2 replay, PostgreSQL 16 | `DB2_HARNESS_OK` |
| Clean DB2 replay, PostgreSQL 17 | `DB2_HARNESS_OK` |
| Baseline second-run guard | `LEGACY_BASELINE_REAPPLY_GUARD_OK` |
| Schema assertions | `DB2_SCHEMA_ASSERTIONS_OK` |
| Canonical JSON assertions | `DB2_CANONICAL_JSON_ASSERTIONS_OK` |
| Security/rollback assertions | `DB2_SECURITY_ROLLBACK_AND_ISOLATION_OK` |
| P1 security region | `DB2_P1_SECURITY_REGION_GOLDEN_OK` |
| Concurrency/restart | `DB2_CONCURRENCY_AND_RESTART_OK` |
| AP1 environment contract | 8 tests passed |
| Production writes | none |

The replay proves the clean-bootstrap chain is internally coherent. It does not
authorize production history repair or additive migration application. Existing
production still requires a fresh snapshot, fingerprint match, backup gate,
history-repair approval and the full production-clone rehearsal.
