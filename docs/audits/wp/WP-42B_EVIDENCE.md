# WP-42B evidence

Дата: 11.09.2026. Ветка: `wp/wp-42b-regional-auth-routing`.
CONTEXT_MODE: `repository_only`.
PR: #147 (draft).

## Основание и allowlist

[ИЗВЛЕЧЕНО] ADR-0008 требует назначать cell до первого сбора пользовательских
данных, разделять cookies/Auth context, fail-close при отсутствии конфигурации
и не хранить raw IP, телефон или locale в routing basis.

[ИЗВЛЕЧЕНО] Владелец разрешил для WP-42B additive migration/RLS, local or
disposable verification, DB4/DB5/AP5, independent security review, commit/push
and a new PR. Shared DB, real credentials, paid cloud, merge and production
не разрешены.

[ИЗВЛЕЧЕНО] Фактический allowlist определён в
`docs/execution/wp/WP-42b-regional-auth-routing.md`; исторические migrations,
CI configuration, credentials и production configuration не изменяются.

## Миграция

| timestamp | ledger | DB4/DB5 | S-MIG |
|---|---|---|---|
| `20260911100000_remhaos_market_routing_receipts.sql` | SHA-256 ledger regenerated | `61_market_routing_receipts.sql`, full DB4/DB5 | #8 |

[ИЗВЛЕЧЕНО] PR #145 remains draft with `20260911090000` / DB4-60. WP-42B is
therefore allocated timestamp `20260911100000` and DB4-61.

## Локальные гейты

[ИЗВЛЕЧЕНО] `npx vitest run tests/market/contract.test.ts
tests/market/receipt.test.ts`: 18 passed.

[ИЗВЛЕЧЕНО] Ledger and Layout Studio inventory test: 17 passed.

[ИЗВЛЕЧЕНО] DB4 full harness: PASS on `postgres:16-alpine` and
`postgres:17-alpine` (`DB4_PRODUCT_BRAIN_HARNESS_OK`).

[ИЗВЛЕЧЕНО] DB5 full harness: PASS on `postgres:16-alpine` and
`postgres:17-alpine` (`DB5_EXECUTION_HARNESS_OK`).

[ИЗВЛЕЧЕНО] `npm run release:check`: PASS; lint 0 errors / 13 pre-existing
warnings, typecheck PASS, 1633 passed / 10 skipped, build PASS. The build used
neutral placeholders for public legal/support values; that is not production
evidence.

[ИЗВЛЕЧЕНО] `npm run test:ap5` is BLOCKED_EXTERNAL locally: disposable
`NEXT_PUBLIC_SUPABASE_URL` is not configured. No real credential, shared DB or
cloud configuration was read or used.

## Security boundary

[ИЗВЛЕЧЕНО] Receipt stores only market declaration, allowed trusted-signal
categories, result reason, timestamps and nonce. The raw receipt is HTTP-only;
the database receives only its SHA-256 digest.

[ИЗВЛЕЧЕНО] `accept_market_routing_receipt` uses
`project_intelligence._request_user_id()`, SECURITY DEFINER with empty search
path, authenticated-only EXECUTE and no table grant to public/anon/
authenticated/service_role.

[ИЗВЛЕЧЕНО] Independent Codex Security diff scan
`a161d25f-eece-4994-9e1b-808b36d89ccc` completed against code SHA
`09f8c3f811f8d8bd926e277e21b261a7d7213cad`: 19 runtime surfaces reviewed,
four candidates validated and zero reportable findings. The final evidence-only
commit follows this reviewed code SHA and does not change runtime or SQL.

## Не сделано

[ИЗВЛЕЧЕНО] No second Supabase project, shared/disposable deployment, real
credential, legal activation, AI provider activation, migration application,
merge or production deployment was performed.

[ИНТЕРПРЕТИРОВАНО] Hosted AP5 and PR CI can only validate the exact pushed SHA;
their status is UNKNOWN until the draft PR exists and GitHub completes them.
