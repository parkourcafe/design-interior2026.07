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
- Added the additive `20260801130000_projectceo_request_claim_sub_fallback.sql`
  migration. It resolves the authenticated actor from `request.jwt.claims` when
  hosted PostgREST does not populate the legacy `request.jwt.claim.sub` GUC;
  it does not grant any access to the managed `auth` schema.

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
| Request-bound `list_projects` against local PostgREST | Passed with signed authenticated JWT |
| Authenticated browser E2E | Blocked at invitation acceptance: standard GoTrue exposes verified mailbox ownership in the session `amr`/user metadata, not the top-level `email_verified` claim required by the current SQL contract |
| Production writes | none |

The replay proves the clean-bootstrap chain is internally coherent. It does not
authorize production history repair or additive migration application. Existing
production still requires a fresh snapshot, fingerprint match, backup gate,
history-repair approval and the full production-clone rehearsal.

## Remaining blocker

The standard Supabase/GoTrue access token used by the real browser session has
`amr=[{"method":"otp"}]` and `user_metadata.email_verified=true`, but no
top-level `email_verified` claim. The current request-claims rewrite therefore
adds a duplicate top-level-claim gate after the existing
`_has_email_ownership_amr()` contract and returns `identity_unverified` even
after a confirmed magic-link login.

No trust-model relaxation or managed-auth lookup was applied as a workaround.
The next change must be an explicitly reviewed additive authorization decision:
either a hosted Auth Hook emits a confirmed `email_verified` claim, or the
existing signed allowlisted ownership AMR is approved as the documented
equivalent. Exact recipient-email matching and rejection of generic
email/password AMR must remain mandatory before the authenticated pilot can be
marked ready.
