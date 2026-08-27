# RemHaOS Integration Gateway v2

## Replacement Evidence

- Base: `origin/main` at `7c7f5c982e99c63331cb6aefe680390826298e8a`.
- Branch: `codex/remhaos-integration-gateway-v2`.
- Code checkpoint: `2a055a761122ee971e63c5c648b119711213beb3`.
- This report is committed after the code checkpoint; obtain final branch SHA with `git rev-parse HEAD`.
- Source was PR #115 head only as a read-only file source. No PR #115 merge, rebase, or wholesale cherry-pick was used.
- Canonical projection `20260826059000_projectceo_published_role_projection.sql` is inherited unchanged from base.

## Gate Results

| Gate | Result | Evidence |
| --- | --- | --- |
| Scope audit | PASS | `158` changed paths from base; all matched allowlist; forbidden scope scan empty. |
| Migration ledger/checksums | PASS | `18` new Integration Gateway migrations; AP1 ledger has `80` entries; per-file SHA-256 below. |
| `npm run lint` | PASS | `0 errors`; `13` pre-existing warnings outside Integration Gateway. |
| `npm run typecheck` | PASS | exit `0`. |
| `npm run test` | PASS | `193/193` files; `1524` passed, `10` skipped. |
| `npx --yes impeccable detect` | PASS | exit `0` with disposable npm cache. |
| `npm run build` | PASS | Next build compiled and generated `45/45` static pages. |
| DBIG clean PG16 | PASS | schema security, registry, links, intake, Telegram, Drive, concurrency, restart replay, active-job disconnect. |
| DBIG clean PG17 | PASS | same markers as PG16. |
| DBIG populated upgrade PG16 | PASS | pre/post state, all DBIG markers, concurrency, restart replay, disconnect. |
| DBIG populated upgrade PG17 | PASS | pre/post state, all DBIG markers, concurrency, restart replay, disconnect. |
| DB2 PG16/17 | PASS | schema, canonical JSON, operations, security/rollback, concurrency/restart, auth hook. |
| DB4 PG16/17 | PASS | product, M4 compatibility, Telegram concurrency/upgrades, impact upgrade, restart replay. |
| DB5 PG16/17 | PASS | execution, impact benchmark/coverage, worker reliability, replay, default deny. |
| AP1 authenticated reads PG16/17 | PASS | authenticated read, request-bound replay, concurrency, restart read. |
| AP5 authenticated browser gate | BLOCKED_EXTERNAL | `npm run test:ap5` stops before tests: `NEXT_PUBLIC_SUPABASE_URL` is unset; no credentials or external Supabase writes were attempted. |

## External Gates

- Real Google OAuth callback, PKCE token exchange, Picker, provider download, and Drive webhook require Google Cloud staging credentials and callback registration.
- Real Telegram callback and retry delivery require Telegram bot/webhook credentials.
- Production-shaped scanner, durable SecretStore, and staging worker transport remain adapter boundaries with default-off/fail-closed adapters; connecting real services is external staging work.
- No full production acceptance is claimed.

## Deployment Safety

- Vercel classification: Preview/staged only. No production deployment or promotion was run.
- Production domains were not reassigned.
- Production Supabase was not changed.
- PR #115 was not changed or closed.
- M4/AP6/Cycle 7 source scope was not transferred. The shared Telegram route only gained an `REMHAOS_INTEGRATIONS_ENABLED` branch; legacy M4 path and its tests remain intact.

## Migration Checksums

| Migration | SHA-256 |
| --- | --- |
| 20260826010550_remhaos_integration_registry_foundation.sql | `afca7d5156f8bfb7df556ed6f842931b173f4db9d6a267fadd4d1042545f5f18` |
| 20260826010601_remhaos_integration_registry_operations.sql | `0b9cf7f92f962c1bdb1a1fdc56aea9acd63314e32c63afe97829a49628f79e40` |
| 20260826020840_remhaos_project_links.sql | `1d4d6bdbf8c1e2efab7feec58f4df6b4bc3dabdc11e51286d2aaf40d33cc6bf4` |
| 20260826023906_remhaos_file_intake_hardening.sql | `54d1dbe3e8211d3424e18180799a06d79b51dd078113405b3bf2c75aa9b49702` |
| 20260826030233_remhaos_telegram_staging.sql | `155029ac09f06526d88ddf14a38a860613316afcc7e9c930aaa0e75b7667ab34` |
| 20260826034120_remhaos_google_drive_staging.sql | `b275c1f13f3b31c2994ba1f151cb2aa809cc1cf72ed3b4f14f18ec6ed52ce736` |
| 20260826042000_remhaos_google_drive_webhook_operations.sql | `fcddbd809097f046f7849769bc555e79fed2222ba52633f4d25895d1ca7716a3` |
| 20260826043000_remhaos_external_revision_supersession.sql | `2300a9b5c869e0d9e2cb12a5a672db1a4516c78bf350f0b8fae776be79a25172` |
| 20260826044000_remhaos_google_drive_reauth_transition.sql | `16ef141460c96364431b9dffa32670ed2a2ba2d62d1eb60b69a97ee804dee759` |
| 20260826050000_remhaos_integration_ui_read_projections.sql | `16ff70d41788d1eff8bb8f6d5d646b8eb800a021bc3dfb9d107aa780052487b8` |
| 20260826051000_remhaos_manual_sync_request.sql | `71736ad4542db88cfcd53ca8279243eeda6862b4052e2c543d699824af218a38` |
| 20260826053000_remhaos_safe_import_candidate_projection.sql | `2469ad38b63f69cd6daccedd4f72b11a890c252fddb81f38e0d36efcb55694f6` |
| 20260826054000_remhaos_safe_connection_projection.sql | `d5fca20fb215d04d57e9e57275538eab6bb30371cbe5597af9d67d1e7ea782ea` |
| 20260826055000_remhaos_import_candidate_target_review.sql | `94a885d922227d777c4424d5de47d5fb60a6c7761096ea4560be3c9bc162c0a9` |
| 20260826056000_remhaos_file_intake_publish_replay.sql | `9fd5c20cf11bc308deb2270ea03232c12a73eb886f49a27c0d418efc5c832565` |
| 20260826057000_remhaos_telegram_quarantine_key_guard.sql | `d5f7ef6bc81712b0e3d5e53e5a72101d3db28f22fdcdc0a79f8bc2e551b9ef3b` |
| 20260826058000_remhaos_file_intake_worker_ingest.sql | `f8dc92854da3744fa043eb7b2f8144ea1523b54506765dbc9b9f3dd550e8a095` |
| 20260827010000_remhaos_integration_gateway_transport.sql | `4713335b78465bc4f5070b0d1812bcc247ef451acab43d58cdd4e13aa686911a` |

## Exact Changed-Path Manifest

Every path in the final replacement commit is listed below. The authoritative reproducible command is:

```sh
git diff --name-only 7c7f5c982e99c63331cb6aefe680390826298e8a..HEAD
```

- `.env.example`
- `app/api/integrations/[provider]/callback/route.ts`
- `app/api/integrations/[provider]/connect-intent/route.ts`
- `app/api/integrations/[provider]/disconnect/route.ts`
- `app/api/integrations/[provider]/oauth/callback/route.ts`
- `app/api/integrations/[provider]/webhook/route.ts`
- `app/api/integrations/connections/[connectionId]/route.ts`
- `app/api/integrations/connections/route.ts`
- `app/api/integrations/providers/route.ts`
- `app/api/integrations/telegram/webhook/route.ts`
- `app/api/projects/[projectId]/connections/[connectionId]/bind/route.ts`
- `app/api/projects/[projectId]/connections/[connectionId]/sync/route.ts`
- `app/api/projects/[projectId]/connections/[connectionId]/unbind/route.ts`
- `app/api/projects/[projectId]/connections/route.ts`
- `app/api/projects/[projectId]/connections/unbind/route.ts`
- `app/api/projects/[projectId]/file-intakes/[intakeId]/download/route.ts`
- `app/api/projects/[projectId]/file-intakes/[intakeId]/publish/route.ts`
- `app/api/projects/[projectId]/file-intakes/[intakeId]/review/route.ts`
- `app/api/projects/[projectId]/file-intakes/route.ts`
- `app/api/projects/[projectId]/imports/[candidateId]/review/route.ts`
- `app/api/projects/[projectId]/imports/review/route.ts`
- `app/api/projects/[projectId]/imports/route.ts`
- `app/api/projects/[projectId]/inbox/review/route.ts`
- `app/api/projects/[projectId]/links/[linkId]/archive/route.ts`
- `app/api/projects/[projectId]/links/[linkId]/publish/route.ts`
- `app/api/projects/[projectId]/links/[linkId]/revisions/route.ts`
- `app/api/projects/[projectId]/links/route.ts`
- `app/dashboard/projectceo/projects/[projectId]/connections/page.tsx`
- `app/dashboard/projectceo/projects/[projectId]/inbox/page.tsx`
- `app/dashboard/projectceo/projects/[projectId]/links/page.tsx`
- `app/dashboard/setup/integrations/page.tsx`
- `components/integration-gateway/integrations-settings-panel.tsx`
- `components/integration-gateway/project-connections-panel.tsx`
- `components/integration-gateway/project-inbox-panel.tsx`
- `components/integration-gateway/project-links-panel.tsx`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_EVIDENCE_MANIFEST_2026-08-26.md`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_EXECUTION_REPORT_2026-08-26.md`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_GATEWAY_EVIDENCE_MANIFEST_2026-08-27.md`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_GATEWAY_EXECUTION_REPORT_2026-08-27.md`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_GATEWAY_ROLLBACK_RUNBOOK_2026-08-27.md`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_GATEWAY_V2_EVIDENCE_MANIFEST_2026-08-28.md`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_GATEWAY_V2_EXECUTION_REPORT_2026-08-28.md`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_PR0_DECISION_PACKAGE_2026-08-26.md`
- `docs/product-intelligence/wave-3/integration/REMHAOS_INTEGRATION_ROLLBACK_RUNBOOK.md`
- `lib/i18n/ru.ts`
- `lib/integration-gateway/core/capability.ts`
- `lib/integration-gateway/core/connector.ts`
- `lib/integration-gateway/core/errors.ts`
- `lib/integration-gateway/core/ids.ts`
- `lib/integration-gateway/core/index.ts`
- `lib/integration-gateway/core/logging.test.ts`
- `lib/integration-gateway/core/logging.ts`
- `lib/integration-gateway/core/oauth-intent.ts`
- `lib/integration-gateway/core/secret-store.test.ts`
- `lib/integration-gateway/core/secret-store.ts`
- `lib/integration-gateway/core/url-policy.test.ts`
- `lib/integration-gateway/core/url-policy.ts`
- `lib/integration-gateway/file-intake/http.test.ts`
- `lib/integration-gateway/file-intake/http.ts`
- `lib/integration-gateway/file-intake/index.ts`
- `lib/integration-gateway/file-intake/policy.test.ts`
- `lib/integration-gateway/file-intake/policy.ts`
- `lib/integration-gateway/file-intake/scanner.ts`
- `lib/integration-gateway/file-intake/service.ts`
- `lib/integration-gateway/file-intake/storage.test.ts`
- `lib/integration-gateway/file-intake/storage.ts`
- `lib/integration-gateway/google-drive/channel-lifecycle.ts`
- `lib/integration-gateway/google-drive/channel-worker.test.ts`
- `lib/integration-gateway/google-drive/channel-worker.ts`
- `lib/integration-gateway/google-drive/connector.ts`
- `lib/integration-gateway/google-drive/import-adapter.ts`
- `lib/integration-gateway/google-drive/import-worker.test.ts`
- `lib/integration-gateway/google-drive/import-worker.ts`
- `lib/integration-gateway/google-drive/index.ts`
- `lib/integration-gateway/google-drive/job-runner.ts`
- `lib/integration-gateway/google-drive/oauth-flow.test.ts`
- `lib/integration-gateway/google-drive/oauth-flow.ts`
- `lib/integration-gateway/google-drive/oauth.test.ts`
- `lib/integration-gateway/google-drive/oauth.ts`
- `lib/integration-gateway/google-drive/picker.test.ts`
- `lib/integration-gateway/google-drive/picker.ts`
- `lib/integration-gateway/google-drive/policy.test.ts`
- `lib/integration-gateway/google-drive/policy.ts`
- `lib/integration-gateway/google-drive/provider-transport.test.ts`
- `lib/integration-gateway/google-drive/provider-transport.ts`
- `lib/integration-gateway/google-drive/runtime.ts`
- `lib/integration-gateway/google-drive/secret-store-adapters.ts`
- `lib/integration-gateway/google-drive/webhook.test.ts`
- `lib/integration-gateway/google-drive/webhook.ts`
- `lib/integration-gateway/index.ts`
- `lib/integration-gateway/links/catalog.ts`
- `lib/integration-gateway/links/http.ts`
- `lib/integration-gateway/links/index.ts`
- `lib/integration-gateway/links/project-link-service.ts`
- `lib/integration-gateway/registry/access.ts`
- `lib/integration-gateway/registry/connection-service.ts`
- `lib/integration-gateway/registry/http.test.ts`
- `lib/integration-gateway/registry/http.ts`
- `lib/integration-gateway/registry/index.ts`
- `lib/integration-gateway/registry/provider-registry.ts`
- `lib/integration-gateway/runtime/worker-client.ts`
- `lib/integration-gateway/telegram/contracts.ts`
- `lib/integration-gateway/telegram/index.ts`
- `lib/integration-gateway/telegram/lease.test.ts`
- `lib/integration-gateway/telegram/lease.ts`
- `lib/integration-gateway/telegram/provider-transport.test.ts`
- `lib/integration-gateway/telegram/provider-transport.ts`
- `lib/integration-gateway/telegram/runtime.ts`
- `lib/integration-gateway/telegram/security.test.ts`
- `lib/integration-gateway/telegram/security.ts`
- `lib/integration-gateway/telegram/service.ts`
- `lib/integration-gateway/telegram/webhook.ts`
- `lib/integration-gateway/telegram/worker.test.ts`
- `lib/integration-gateway/telegram/worker.ts`
- `lib/project-intelligence/adapters/postgres/rpc.ts`
- `lib/project-intelligence/adapters/storage/storage.ts`
- `supabase/config.toml`
- `supabase/migrations/20260826010550_remhaos_integration_registry_foundation.sql`
- `supabase/migrations/20260826010601_remhaos_integration_registry_operations.sql`
- `supabase/migrations/20260826020840_remhaos_project_links.sql`
- `supabase/migrations/20260826023906_remhaos_file_intake_hardening.sql`
- `supabase/migrations/20260826030233_remhaos_telegram_staging.sql`
- `supabase/migrations/20260826034120_remhaos_google_drive_staging.sql`
- `supabase/migrations/20260826042000_remhaos_google_drive_webhook_operations.sql`
- `supabase/migrations/20260826043000_remhaos_external_revision_supersession.sql`
- `supabase/migrations/20260826044000_remhaos_google_drive_reauth_transition.sql`
- `supabase/migrations/20260826050000_remhaos_integration_ui_read_projections.sql`
- `supabase/migrations/20260826051000_remhaos_manual_sync_request.sql`
- `supabase/migrations/20260826053000_remhaos_safe_import_candidate_projection.sql`
- `supabase/migrations/20260826054000_remhaos_safe_connection_projection.sql`
- `supabase/migrations/20260826055000_remhaos_import_candidate_target_review.sql`
- `supabase/migrations/20260826056000_remhaos_file_intake_publish_replay.sql`
- `supabase/migrations/20260826057000_remhaos_telegram_quarantine_key_guard.sql`
- `supabase/migrations/20260826058000_remhaos_file_intake_worker_ingest.sql`
- `supabase/migrations/20260827010000_remhaos_integration_gateway_transport.sql`
- `tests/ap1/environment/auth-regression.contract.test.ts`
- `tests/ap1/environment/migration-ledger.sha256`
- `tests/db-integration-gateway/10_schema_security.sql`
- `tests/db-integration-gateway/20_registry_operations.sql`
- `tests/db-integration-gateway/30_restart_replay.sql`
- `tests/db-integration-gateway/40_project_links.sql`
- `tests/db-integration-gateway/50_file_intake.sql`
- `tests/db-integration-gateway/60_telegram_staging.sql`
- `tests/db-integration-gateway/70_google_drive_staging.sql`
- `tests/db-integration-gateway/80_disconnect_active_job.sql`
- `tests/db-integration-gateway/run-concurrency.zsh`
- `tests/db-integration-gateway/run-upgrade.zsh`
- `tests/db-integration-gateway/run.zsh`
- `tests/integration-gateway/file-intake.static.test.ts`
- `tests/integration-gateway/google-drive.static.test.ts`
- `tests/integration-gateway/http-boundary.static.test.ts`
- `tests/integration-gateway/project-links.static.test.ts`
- `tests/integration-gateway/route-early-paths.test.ts`
- `tests/integration-gateway/static-boundary.test.ts`
- `tests/integration-gateway/telegram-webhook.test.ts`
- `tests/integration-gateway/telegram.static.test.ts`
- `tests/integration-gateway/ui-projections.static.test.ts`
- `tests/layout-studio/integration/integration.test.ts`

## Acceptance Classification

- `IMPLEMENTED + LOCALLY VERIFIED`: registry, Project Links, file intake/quarantine/checksum/scan/review, Telegram queue/candidate boundary and default-off webhook, Google OAuth/PKCE contracts, Picker contract, selected-file import boundary, Drive watch/revision/dedupe/reauth contracts, disconnect lifecycle, SecretStore/worker boundaries, team UI and client-safe projections, migrations and tests.
- `IMPLEMENTED + REQUIRES EXTERNAL STAGING`: real provider callbacks, provider API download, Picker runtime, scanner runtime, durable secret store, and staging worker transport.
- `BLOCKED_EXTERNAL`: AP5 authenticated browser gate until disposable Supabase URL/keys and a running local/staging app are supplied.
- `NOT IMPLEMENTED`: none within the allowlisted code-complete Integration Gateway scope; external adapters are deliberately default-off and are not represented as connected.
