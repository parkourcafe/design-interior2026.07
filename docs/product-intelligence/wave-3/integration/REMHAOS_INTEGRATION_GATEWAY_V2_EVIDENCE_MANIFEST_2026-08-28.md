# RemHaOS Integration Gateway v2 Evidence Manifest

- `base_sha`: `7c7f5c982e99c63331cb6aefe680390826298e8a`
- `branch`: `codex/remhaos-integration-gateway-v2`
- `code_checkpoint_sha`: `2a055a761122ee971e63c5c648b119711213beb3`
- `ci_portability_fix_sha`: `b7c77c743be560478ca35a5a3a69aae3213a7076`
- `final_sha_command`: `git rev-parse HEAD`
- `changed_path_count_at_code_checkpoint`: `156`
- `migration_count`: `18`
- `ledger_count`: `80`
- `canonical_projection_check`: `cmp -s <(git show origin/main:supabase/migrations/20260826059000_projectceo_published_role_projection.sql) supabase/migrations/20260826059000_projectceo_published_role_projection.sql`

## Reproducible Commands

```sh
npm run lint
npm run typecheck
npm run test
NPM_CONFIG_CACHE=/private/tmp/npm-cache-impeccable npx --yes impeccable detect
npm run build
PI_DB_IMAGE=postgres:16-alpine zsh tests/db-integration-gateway/run.zsh
PI_DB_IMAGE=postgres:17-alpine zsh tests/db-integration-gateway/run.zsh
PI_DB_IMAGE=postgres:16-alpine zsh tests/db-integration-gateway/run-upgrade.zsh
PI_DB_IMAGE=postgres:17-alpine zsh tests/db-integration-gateway/run-upgrade.zsh
PI_DB_IMAGE=postgres:16-alpine zsh tests/db2/run.zsh
PI_DB_IMAGE=postgres:17-alpine zsh tests/db2/run.zsh
PI_DB_IMAGE=postgres:16-alpine zsh tests/db4/run.zsh
PI_DB_IMAGE=postgres:17-alpine zsh tests/db4/run.zsh
PI_DB_IMAGE=postgres:16-alpine zsh tests/db5/run.zsh
PI_DB_IMAGE=postgres:17-alpine zsh tests/db5/run.zsh
PI_DB_IMAGE=postgres:16-alpine zsh tests/ap1/reads/run.zsh
PI_DB_IMAGE=postgres:17-alpine zsh tests/ap1/reads/run.zsh
npm run test:ap5
```

## Status Semantics

- All commands except `npm run test:ap5` exited `0` in disposable/local scope.
- `npm run test:ap5` was blocked before test execution because `NEXT_PUBLIC_SUPABASE_URL` was unset.
- Docker context was disposable Colima `colima-archidom-ap1`; local `postgres:16-alpine` and `postgres:17-alpine` images were present.
- No production credentials, deployment, domain assignment, PR #115 mutation, or production Supabase mutation was performed.
