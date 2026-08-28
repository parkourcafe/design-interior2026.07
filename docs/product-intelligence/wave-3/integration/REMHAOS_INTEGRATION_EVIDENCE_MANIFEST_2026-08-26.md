# RemHaOS Integration Gateway — evidence manifest

Дата фиксации: 2026-08-26
Наблюдаемый UTC timestamp: `2026-08-26T14:25:26Z`
Последнее локальное обновление проверки (WITA): 2026-08-27

## Repository and environment

- Repository: `/Users/msnigmatullaeva/Documents/designinterior2026/repo`
- Branch: `claude/arhidom-cinematic-website-t2zfdc`
- HEAD: `9470fceb0912b5546d2d53b297a6a01c8c3d28a8`
- Node: `v22.23.0`
- Next build: `16.2.12`
- Database images: `postgres:16-alpine`, `postgres:17-alpine`
- Local smoke origin: `http://127.0.0.1:3100`
- Disposable authenticated browser smoke origins: `http://127.0.0.1:3110` (four-role
  compatibility run) and `http://127.0.0.1:3111` (fresh five-role run)
- Rollout flags: default-off in `.env.example`

## Reproducible evidence

- `npm run lint` — PASS, 0 errors; 9 pre-existing warnings.
- `npm run typecheck` — PASS.
- `npm run test` — PASS, 94 test files / 502 tests.
- `env NPM_CONFIG_CACHE=/private/tmp/npm-cache-impeccable npx --yes impeccable detect` — PASS.
- `NEXT_DIST_DIR=.next.nosync npm run build` — PASS, including TypeScript,
  static generation and route optimization.
- `npm run test:db-integration-gateway` — PASS on PG16 and PG17.
- `npm run test:db-integration-gateway-upgrade` — PASS on PG16 and PG17.
- Fresh disposable Supabase profile `remhaos-integration-gate` — PASS on PG17.6:
  `AP1_RUNTIME_OK`, `AP1_DB_OK`, `AP1_MIGRATION_LEDGER_OK count=31`.
- Fresh Supabase profile DBIG replay — PASS markers for schema security, registry,
  Project Links, File Intake, Telegram staging, Google Drive staging, concurrency
  and restart/replay.
- DB markers: `DBIG_SCHEMA_SECURITY_OK`, `DBIG_REGISTRY_OPERATIONS_OK`,
  `DBIG_PROJECT_LINKS_OK`, `DBIG_FILE_INTAKE_OK`, `DBIG_TELEGRAM_STAGING_OK`,
  `DBIG_GOOGLE_DRIVE_STAGING_OK`, `DBIG_CONCURRENCY_OK`,
  `DBIG_RESTART_REPLAY_OK`.
- Upgrade markers: `DBIG_UPGRADE_PRE_PR_STATE_OK`,
  `DBIG_UPGRADE_POST_PR_STATE_OK`,
  `DBIG_UPGRADE_INTEGRATION_GATEWAY_HARNESS_OK`.
- Runtime smoke: `/api/health` `200`; default-off provider and File Intake
  surfaces `404`; GET against POST-only Telegram/Drive webhooks `405`; protected
  Connections/Inbox pages redirect `307` without a session.
- Local authenticated browser smoke via
  `tests/ap1/e2e/capture-gateway-auth-smoke.mjs` — PASS against disposable
  Supabase and production-like `next start`: participant entry rendered; four
  separate browser profiles resolved actor roles `owner`, `architect`, `builder`,
  `client`; workspace API `200` for each; owner Settings/Integrations and Project
  Connections UI rendered; client direct command, connections and import-candidate
  requests returned `403 forbidden`.
  Screenshots and the non-secret summary were written to
  `/private/tmp/remhaos-gateway-browser-evidence` and are not staging evidence.
- The browser harness now declares five independent local profiles, adding M2
  Designer as a separate session while expecting the current compatibility actor
  role `architect` (per ADR-0004). A fresh five-session rerun against the matching
  local disposable runtime passed: Owner, M1 Client, M2 Designer, M3 Architect and
  M4 Builder each used a separate Chrome profile; workspace API returned `200` for
  all five; owner Integrations/Project Connections UI rendered; reviewer candidate
  reads returned `200`; client command, connections and import-candidate requests
  returned `403 forbidden`. Non-secret summary and screenshots were written to
  `/private/tmp/remhaos-gateway-browser-evidence-five-debug3` and are not staging
  evidence.
- Bounded-body regressions: registry JSON + Project Links `2 files / 6 tests`;
  File Intake chunked multipart `2 files / 5 tests`.
- Direct Integration Gateway handler early-path regressions: `1 file / 7 tests`;
  auth failure, same-origin enforcement, JSON content type, malformed JSON,
  provider/scope admission, owner-only provider/OAuth boundary and File Intake
  error redaction.
- Role-safe projection/UI regression run: `3 files / 19 tests`; client projection
  removes sources, evidence, revision history, price and exact refs, while the
  builder projection keeps only scoped execution material.
- Google Drive OAuth protocol/flow targeted run: `2 files / 12 tests`, including
  bounded streamed token-response, invalid UTF-8 rejection and cancellation-time
  PKCE verifier cleanup.
- Migration ledger hash for
  `20260826058000_remhaos_file_intake_worker_ingest.sql`:
  `f8dc92854da3744fa043eb7b2f8144ea1523b54506765dbc9b9f3dd550e8a095`.
- Migration ledger hash for
  `20260826059000_projectceo_published_role_projection.sql`:
  `44c4fd5ed728f778056f2e7d6df8cdc8170a29f76ed857c7c1e0cb62d18fd690`.
- Transactional PG17.6 runtime helper smoke for the new projection: PASS with
  `DO` assertion and `ROLLBACK`; full AP1 read wrapper harness after this migration:
  PASS on PG16 and PG17, including client immutable published-revision assertions.
- Full DBIG harness after this migration: PASS on PG16 and PG17; upgrade harness:
  PASS on PG16 and PG17 with pre-PR state, post-PR state, all operation markers,
  concurrency and restart/replay markers.
- Scoped secret scan, route-boundary audit, shell syntax check and `git diff --check` — PASS.

## Evidence intentionally absent

- No provider credentials, OAuth exchange, public callback, Telegram worker
  transport or real Google Drive test account were used.
- No authenticated five-session external staging screenshots were produced; the
  confirmed local five-profile browser smoke is not presented as external staging
  evidence.
- No production database, production write, deploy, credential registration or
  feature-flag enablement was performed.
- All current PG16/PG17 checks ran against disposable containers through the
  local Colima Docker context; no production or persistent local DB mutation was
  made. External provider credentials and production adoption remain intentionally
  absent.

Detailed status and blockers: [REMHAOS_INTEGRATION_EXECUTION_REPORT_2026-08-26.md](./REMHAOS_INTEGRATION_EXECUTION_REPORT_2026-08-26.md).
