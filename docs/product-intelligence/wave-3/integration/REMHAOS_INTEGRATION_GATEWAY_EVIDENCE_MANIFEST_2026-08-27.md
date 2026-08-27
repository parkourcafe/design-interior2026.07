# RemHaOS Integration Gateway Evidence Manifest

Evidence capture date: 2026-08-27
Evidence branch: `codex/remhaos-integration-gateway`
Evidence code/migration SHA: `1a33e598b43ffd8523a5a4b8222d785b46a5d5b6`
Canonical repository: `/Users/msnigmatullaeva/Documents/designinterior2026/repo`
Checkpoint commit: `e70695395b7c40099f5e3223b823ebdabac167c9`
No production or `main` evidence was used.

## Quality commands

| Command | Result |
|---|---|
| `npm run lint` | Pass, 0 errors, 9 pre-existing warnings outside the gateway delta. |
| `npm run typecheck` | Pass. |
| `npm run test` | Pass, 98 files and 516 tests. |
| `env NPM_CONFIG_CACHE=/private/tmp/npm-cache-impeccable npx --yes impeccable detect` | Exit 0, no output. |
| `env NEXT_DIST_DIR=.next.nosync npm run build` | Pass, Next 16.2.12, 18/18 static pages generated. |
| `git show --check 1a33e598b43ffd8523a5a4b8222d785b46a5d5b6` | Pass. |

## Database commands and artifacts

| Gate | Command | Artifact |
|---|---|---|
| DBIG clean PG16 | `PI_DB_IMAGE=postgres:16-alpine npm run test:db-integration-gateway` | `/private/tmp/remhaos-dbig-pg16-final8.log` |
| DBIG clean PG17 | `PI_DB_IMAGE=postgres:17-alpine npm run test:db-integration-gateway` | `/private/tmp/remhaos-dbig-pg17-final8.log` |
| DBIG upgrade PG16 | `PI_DB_IMAGE=postgres:16-alpine npm run test:db-integration-gateway-upgrade` | command output; upgrade markers passed |
| DBIG upgrade PG17 | `PI_DB_IMAGE=postgres:17-alpine npm run test:db-integration-gateway-upgrade` | command output; upgrade markers passed |
| DB2 PG16 | `PI_DB_IMAGE=postgres:16-alpine tests/db2/run.zsh` | `/private/tmp/remhaos-db2-pg16-final.log` |
| DB2 PG17 | `PI_DB_IMAGE=postgres:17-alpine tests/db2/run.zsh` | `/private/tmp/remhaos-db2-pg17-final.log` |
| DB4 PG16 | `PI_DB_IMAGE=postgres:16-alpine tests/db4/run.zsh` | `/private/tmp/remhaos-db4-pg16-final.log` |
| DB4 PG17 | `PI_DB_IMAGE=postgres:17-alpine tests/db4/run.zsh` | `/private/tmp/remhaos-db4-pg17-final.log` |
| DB5 PG16 | `PI_DB_IMAGE=postgres:16-alpine zsh tests/db5/run.zsh` | `/private/tmp/remhaos-db5-pg16-final.log` |
| DB5 PG17 | `PI_DB_IMAGE=postgres:17-alpine zsh tests/db5/run.zsh` | `/private/tmp/remhaos-db5-pg17-final.log` |
| AP1 reads PG16 | `PI_DB_IMAGE=postgres:16-alpine zsh tests/ap1/reads/run.zsh` | `/private/tmp/remhaos-ap1-reads-pg16-final.log` |
| AP1 reads PG17 | `PI_DB_IMAGE=postgres:17-alpine zsh tests/ap1/reads/run.zsh` | `/private/tmp/remhaos-ap1-reads-pg17-final.log` |

DBIG markers passed on both versions: `DBIG_SCHEMA_SECURITY_OK`, `DBIG_REGISTRY_OPERATIONS_OK`, `DBIG_PROJECT_LINKS_OK`, `DBIG_FILE_INTAKE_OK`, `DBIG_TELEGRAM_STAGING_OK`, `DBIG_GOOGLE_DRIVE_STAGING_OK`, `DBIG_CONCURRENCY_OK`, `DBIG_RESTART_REPLAY_OK`, `DBIG_DISCONNECT_ACTIVE_JOB_OK`, and `DBIG_INTEGRATION_GATEWAY_HARNESS_OK`.

Upgrade markers passed on both versions: `DBIG_UPGRADE_PRE_PR_STATE_OK`, `DBIG_UPGRADE_POST_PR_STATE_OK`, all DBIG markers above, and `DBIG_UPGRADE_INTEGRATION_GATEWAY_HARNESS_OK`.

The migration ledger entry for `supabase/migrations/20260827010000_remhaos_integration_gateway_transport.sql` is SHA-256 `4713335b78465bc4f5070b0d1812bcc247ef451acab43d58cdd4e13aa686911a`.

## Docker and disposable AP1

`docker info` was healthy on Colima Docker Engine 29.5.2 / server 29.2.1. The previously broken image pull path was recovered with a temporary non-secret Docker config; PostgreSQL 16 and 17 images were available by digest and used only in disposable harnesses.

The AP1 disposable VM was restarted and its stale project stack was disposed/recreated. The resulting markers were `AP1_RUNTIME_OK`, `AP1_DB_OK postgres=17.6`, and `AP1_MIGRATION_LEDGER_OK count=33`.

## Browser evidence boundary

The standard AP1 full-slice command was attempted after the reset. It provisioned five users but stopped at `AP1_MILESTONE_HTTP status=409`, an existing M4 scenario outside this owner gate. A gateway-focused runner provisioned five users and built an isolated Next runtime, then Chrome exited `134` before `DevToolsActivePort` creation. No authenticated five-browser-session pass is recorded.

## Security boundary

No secrets, provider tokens, raw channel/resource IDs, signed URLs, or raw provider bodies are included in this manifest. Disposable logs containing temporary session material were cleaned by their harnesses. The branch worktree had unrelated dirty files; only gateway scope was included in the owner commits.
