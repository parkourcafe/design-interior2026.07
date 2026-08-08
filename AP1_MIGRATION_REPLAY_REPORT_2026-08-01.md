# AP1 Migration Replay Report — 2026-08-01

Status: disposable replay PASS; production Auth Hook active; historical migration reconciliation remains a separate blocked gate

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
- Added the additive strict-method correction
  `20260802001000_projectceo_custom_access_token_hook_strict_method.sql`. It
  prevents a pre-existing `email_verified=true` claim from leaking into a new
  password or generic-email authentication event.

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
| In-app browser UI | Owner magic-link opened `/dashboard/projectceo/projects/41111111-1111-4111-8111-111111111111`; `Kora Food Hall`, `1 800 м²`, and owner scope rendered; console errors/warnings: 0 |
| Mobile browser capture | Not claimed: the in-app browser exposes no viewport control, and the host Chrome headless launcher exits before DevTools in this macOS sandbox; the deterministic HTTP/E2E and desktop UI evidence remain green |
| Production writes | Auth Hook function and Auth Hook setting only; no data or migration-ledger writes |

## Production gate — 2026-08-02

The production read-only snapshot was taken in the Supabase SQL Editor before
the change. It reported PostgreSQL 17.6, 13 applied migration records
(`0007`, `0008`, `0009`, and the 10 listed timestamped records), eight public
Platform Foundation relations, and no Auth Hook function. This ledger is not
the branch's canonical timestamped ledger; therefore no historical replay,
baseline repair, or migration-history mutation was attempted.

Only the approved additive Auth Hook function was applied and enabled through
Supabase Auth Hooks. Post-checks passed:

- function exists; `supabase_auth_admin` can execute; `anon` cannot execute;
- `otp` adds the claim, password removes an existing claim, and token refresh
  preserves it;
- a real production magic-link JWT returned `email_verified=true` with
  `amr=otp`;
- authenticated read-only RLS probes returned HTTP 200 with project scope and
  no unauthorized foundation rows.

Production data and the historical migration ledger were not rewritten.

The replay proves the clean-bootstrap chain is internally coherent. It does not
authorize production history repair or additive migration application. Existing
production still requires a fresh snapshot, fingerprint match, backup gate,
history-repair approval and the full production-clone rehearsal.

## Remaining blocker

The standard Supabase/GoTrue access token used by the real browser session has
`amr=[{"method":"otp"}]` and `user_metadata.email_verified=true`, but no
top-level `email_verified` claim. The additive Auth Hook now supplies that
claim from the signed authentication method while preserving the existing
recipient-email equality and allowlisted AMR checks. Local browser E2E and the
production magic-link probe confirm the behavior. Historical production
baseline reconciliation remains a separate migration-path gate.
