# AP1 Migration Replay Report — 2026-08-01

Status: disposable replay PASS; production unchanged; hosted Auth Hook activation pending separate gate

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
- Added the explicitly approved additive
  `20260801150000_projectceo_custom_access_token_hook.sql` migration and local
  `[auth.hook.custom_access_token]` configuration. The hook emits
  `email_verified=true` only for `otp`, `magiclink`, `invite`, and
  `email/signup`, preserves it on token refresh, and strips it from generic
  email/password sessions.

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
| Auth Hook claim assertions | `DB2_AUTH_HOOK_ASSERTIONS_OK` on PostgreSQL 16 and 17 |
| Concurrency/restart | `DB2_CONCURRENCY_AND_RESTART_OK` |
| AP1 environment contract | 8 tests passed |
| Request-bound `list_projects` against local PostgREST | Passed with signed authenticated JWT |
| Authenticated browser E2E | `AP1_SUPPORTED_SLICE_E2E_OK`; five real GoTrue magic-link sessions completed invitation, distribution/ack, change-impact, photo review, milestone acceptance, replay, CSRF and isolation checks |
| Production writes | none |

The replay proves the clean-bootstrap chain is internally coherent. It does not
authorize production history repair or additive migration application. Existing
production still requires a fresh snapshot, fingerprint match, backup gate,
history-repair approval and the full production-clone rehearsal.

## Remaining blocker

The standard Supabase/GoTrue access token used by the real browser session has
`amr=[{"method":"otp"}]` and `user_metadata.email_verified=true`, but no
top-level `email_verified` claim. The explicitly approved additive Auth Hook
now supplies that claim from the signed authentication method while preserving
the existing recipient-email equality and allowlisted AMR checks. Local browser
E2E confirms the complete authenticated slice. Hosted production still needs a
separate Auth Hook activation gate and must not be changed by this PR.
