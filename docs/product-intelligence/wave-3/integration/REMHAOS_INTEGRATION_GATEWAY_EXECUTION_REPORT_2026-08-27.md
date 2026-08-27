# RemHaOS Integration Gateway Execution Report

Date: 2026-08-27
Owner gate: `OWNER GO - Integration Gateway code-complete and durable PR`
Scope: File Intake, Telegram, Connections UI/API, and Google Drive only.

## Control point

- Canonical repository: `/Users/msnigmatullaeva/Documents/designinterior2026/repo`
- Branch: `codex/remhaos-integration-gateway`
- Evidence code/migration SHA: `1a33e598b43ffd8523a5a4b8222d785b46a5d5b6`
- Checkpoint ancestor: `e70695395b7c40099f5e3223b823ebdabac167c9`
- Base before the gateway branch: `9470fceb0912b5546d2d53b297a6a01c8c3d28a8`
- Remote: `https://github.com/parkourcafe/design-interior2026.07.git`
- `main` was not changed and no merge was performed.
- No production Supabase, production users, or rollout flags were touched.
- The real worktree contains unrelated user/staged changes; they were preserved and excluded from the gateway commits.

The DB evidence below was captured against the exact evidence code/migration SHA above. The later documentation commit is docs-only.

## Delivered

The gateway now has a default-off server transport boundary for:

- Telegram webhook ingestion into a durable worker job and candidate path, with provider retry and duplicate-update idempotency.
- Google OAuth callback with state, PKCE, cancellation, bounded token response parsing, replay protection, scope validation, and token exchange.
- Google Picker selected-object parsing and cancellation contract. Only an explicitly selected object can enter the import path.
- Google Drive metadata revalidation and media download for the selected file only, using the minimal `drive.file` scope and exact revision/checksum checks.
- PDF intake through quarantine, scan outcome, candidate projection, and human review. The default scanner is fail-closed.
- Google Drive `files/{fileId}/watch` and `channels/stop` transport, hashed provider identifiers in the database, opaque raw channel references in SecretStore, webhook dedupe, reorder-safe revision processing, channel expiry, and reauthentication transition.
- Disconnect lifecycle that cancels queued/leased/retryable jobs and, when external revoke is explicitly enabled, stops stored Drive channels before revocation.
- Pluggable `SecretStore` with fail-closed default and an explicit non-production memory adapter. The memory adapter is not a durable staging secret store.
- Worker-only Supabase service-role boundary. Human routes and browser code do not receive service-role credentials or raw provider tokens.

## Verification classification

### 1. Implemented and verified locally

- Full unit, contract, negative-path, and static boundary suite: `98` files, `516` tests passed.
- OAuth success/cancellation/state mismatch/PKCE mismatch/repeated callback and malformed or oversized provider responses.
- Picker selection/cancellation and unknown-field rejection.
- Selected PDF provider download, quarantine-ready bytes, size and checksum mismatch handling.
- Drive webhook reorder/dedupe/revision and token-expiry-to-`reauth_required` behavior.
- Disconnect during an active selected-object job, stale completion rejection, Telegram duplicate/retry behavior, and client denial of private connection/import APIs.
- SecretStore fail-closed behavior and TTL behavior of the explicit memory test adapter.
- Lint, typecheck, build, and `impeccable detect`.
- DBIG clean bootstrap on PostgreSQL 16 and 17: schema/security, registry, links, file intake, Telegram, Drive, concurrency, restart/replay, and disconnect-active-job.
- DBIG populated upgrade on PostgreSQL 16 and 17, preserving pre-PR state.
- DB2, DB4, DB5, and AP1 authenticated-read compatibility harnesses on PostgreSQL 16 and 17, including concurrency and restart/replay.
- Docker daemon recovery and image availability were verified locally. The final disposable DB runs used `postgres:16-alpine` and `postgres:17-alpine`.

### 2. Implemented but requires external staging credentials or provider data

- Real Google authorization, token exchange, user identity lookup, Picker SDK selection, selected-file download, Drive watch notification, revision change, channel renewal/stop, token revocation, and reauthentication.
- Real Telegram webhook delivery, provider retry, duplicate update, `getFile`, and PDF download.
- Durable worker transport with `REMHAOS_WORKER_TRANSPORT=supabase_service_role`.
- A real malware scanner and a real durable SecretStore implementation. Only their fail-closed/test boundaries are present locally.
- External staging authenticated browser sessions against the actual provider flows.

### 3. Not implemented

- Production rollout, production credentials, production Supabase changes, production user migration, and rollout flags.
- Full acceptance claim before external staging evidence.
- Provider integrations outside Telegram and Google Drive.
- Any AP6, Tashkent package, M4 V2/V3, or Cycle 7 work.

No requested Integration Gateway transport item is intentionally left as an unimplemented application path. The remaining provider behavior is an evidence/credential gate, not a claim that local mocks are real provider evidence.

### 4. Blocked by owner decision

- Select the real staging SecretStore product and retention/rotation policy.
- Select and gate the real staging malware scanner and quarantine retention policy.
- Provide the public HTTPS staging host and decide where the worker transport runs.
- Provide Google Cloud and Telegram test accounts and consent/configuration ownership.
- Resolve the local browser runtime blocker (Chrome exits `134` without creating `DevToolsActivePort`) or provide an approved browser runner.

## Explicit status: Picker, OAuth callback, worker transport

| Surface | Status |
|---|---|
| Picker | Selected-object and cancellation contract is implemented and tested. Real Picker UI/provider selection is external-staging work. |
| OAuth callback | Server callback, state/PKCE checks, cancellation, bounded token exchange, identity lookup, and replay handling are implemented and mock-tested. Real Google exchange is not verified without staging credentials. |
| Worker transport | Server-only `supabase_service_role` adapter boundary is implemented. Default is `disabled`; no staging worker credential is connected. |

## Browser gate result

The AP1 disposable environment was recreated and verified with `AP1_RUNTIME_OK`, `AP1_DB_OK postgres=17.6`, and migration ledger count `33`. Provisioning the Kora fixture produced five local Auth users. The standard full AP1 scenario then stopped at the existing out-of-scope M4 precondition with `AP1_MILESTONE_HTTP status=409`; no M4 code was changed.

A gateway-focused five-profile runner successfully provisioned five users and built the isolated Next runtime, but the local Chrome executable exited with code `134` before `DevToolsActivePort` was created. Therefore the five-session authenticated browser gate is **not claimed as passed**. The API/DB contracts remain covered by the local tests and DB harnesses above.

## Owner checklist for external staging

1. Telegram: bot token, webhook secret, a test Telegram account/chat, and a test PDF. Enter them only in the staging secret manager; configure the webhook against the staging HTTPS host.
2. Google Cloud: OAuth Web Application client ID and client secret, Drive API enabled, Picker configuration/consent screen, and one Google test account with Drive test data. Enter client credentials only in the staging secret manager.
3. Exact callback URL: `https://<staging-host>/api/integrations/google_drive/oauth/callback`.
4. Exact Drive webhook URL: `https://<staging-host>/api/integrations/google_drive/webhook`.
5. Staging URL: provide the final HTTPS host used by both browser QA and provider callbacks.
6. SecretStore: choose Vault, KMS-backed store, or another reviewed server-only store; provide its staging connection/configuration through the platform secret manager. Do not put values in Git, browser storage, ordinary business tables, or fixtures.
7. Worker: set `REMHAOS_WORKER_TRANSPORT=supabase_service_role` only in staging and provide `SUPABASE_SERVICE_ROLE_KEY` through the server-only secret manager.
8. Scanner: choose the reviewed staging scanner and set `REMHAOS_FILE_SCANNER_ADAPTER` through staging configuration. The local `staging` scanner is a deterministic test adapter, not malware protection.
9. Cost/billing: no external provider calls were made in this run. Exact cost is `UNKNOWN` until the Google Cloud project, quotas, and billing state are supplied; owner must confirm whether billing is required for the selected Google APIs and Telegram usage.
10. Remaining external scenarios: OAuth success/cancel/expiry/replay; real selected PDF; checksum mismatch; Drive revision supersession; webhook duplicate/reorder/restart; channel stop and token revoke; revoked-token reauth; Telegram retry/duplicate; and five independent authenticated staging sessions with client denial.

Full acceptance remains blocked until these external staging facts and browser evidence exist.
