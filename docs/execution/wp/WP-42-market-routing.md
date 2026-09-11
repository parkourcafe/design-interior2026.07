# WP-42 — RU / International market routing foundation

## Goal

Create the non-production contract for variant B: one RemHaOS codebase with
isolated `ru` and `international` data cells. This package does not create or
activate the second database.

## Allowlist

- `docs/product-intelligence/adr/0008-one-product-regional-data-cells.md`
- `docs/implementation/wp42/**`
- `docs/execution/wp/WP-42-market-routing.md`
- `docs/audits/wp/WP-42_EVIDENCE.md`
- `lib/market/**`
- `tests/market/**`

## Acceptance

- only canonical markets `ru` and `international`;
- unknown/invalid input resolves conservatively to `ru`;
- RU signals cannot silently downgrade to international;
- routing basis retains the declaration, trusted signal categories and reason;
- data cell remains separate from currency, locale and legal jurisdiction;
- international AI remains disabled until its provider allowlist is approved;
- returned cell/provider policy values are deeply immutable;
- invalid market/provider fails closed;
- no network, DB, Auth, storage, migration, env or production mutation.

## Gates

- targeted tests, full release check, independent blind review, CI;
- migration/RLS/security, cloud, credentials, merge and production remain owner gates.
