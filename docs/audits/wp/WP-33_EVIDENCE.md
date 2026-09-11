# WP-33 — M3 atomic publication switch — EVIDENCE

Дата: 2026-09-11. Ветка: `wp/wp-33-m3-atomic-final`. Runtime SHA: `67dbfab`. PR: #155 (draft).

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-33-m3-flip-publish-baseline-atomic.md` требует перевести M3 baseline на `publish_baseline_atomic` и убрать raw publishing RPC из `_module_signatures('m3')`.

[ИЗВЛЕЧЕНО] Владелец разрешил migration `20260911160000` для финального M3 switch, обновление ledger, DB4/DB5/AP5 fixtures, security review, commit, push и draft PR. После уточнения владелец подтвердил module-gated ACL: `authenticated` EXECUTE на трёх request-bound publication doors отзывается вне M3 switch и выдаётся/отзывается только через `_module_signatures('m3')`; внутренние capability проверки остаются прежними.

## Allowlist по факту

[ИЗВЛЕЧЕНО] Изменены только H1/H2 migration/ledger/inventory, H3 M3-ветка command service и Postgres adapter, H6 surface matrix/fixtures и этот evidence-файл. Новых ролей, credentials, shared DB или production-конфигурации нет.

## Миграция

| timestamp | ledger | DB4/DB5 | S-MIG |
|---|---|---|---|
| `20260911160000` | `4bc17d558838408b9a28f70395c5d7c33c7bd375f65913f8e95820671a1c38f1` | DB4 06, 49, 51; DB5 default-deny/M3 switch path | #3 |

[ИЗВЛЕЧЕНО] `_module_signatures('m3')` содержит только `publish_baseline_atomic`, `publish_release_request_bound` и `publish_work_package_release_request_bound`; raw `publish_version`, `publish_project_baseline` и `publish_production_package_version` исключены и их authenticated EXECUTE отзывается.

## Локальные гейты

[ИЗВЛЕЧЕНО] Focused Vitest: `tests/ap1/commands/command-service-supported.test.ts` и `tests/projectceo-integration/m3-surface-matrix.test.ts` — 50 passed.

[ИЗВЛЕЧЕНО] `npm run typecheck` — pass.

[ИЗВЛЕЧЕНО] `NEXT_TELEMETRY_DISABLED=1 npm run release:check` — pass: lint 0 errors / 13 существующих warnings; 206 Vitest files, 1,646 passed, 10 skipped; Next build pass.

[ИЗВЛЕЧЕНО] DB4/DB5 PostgreSQL 16 и 17 — `BLOCKED_EXTERNAL`: disposable harness не получил доступ к локальному Docker socket (`permission denied`). Shared DB не использовалась.

[ИЗВЛЕЧЕНО] `npm run test:ap5` — `BLOCKED_EXTERNAL`: отсутствует `NEXT_PUBLIC_SUPABASE_URL`; никаких env-файлов или credentials не читалось.

## Hosted CI correction

[ИЗВЛЕЧЕНО] Первый CI run `34601317901` подтвердил DB4 06 и default-deny до `enable-m3-publication.sql`, затем остановился: enable fixture уже grant-ил новые request-bound doors, но его self-check продолжал требовать три raw signatures. Исправление меняет только этот self-check и matrix test: enable script проверяет module-gated M3 surface и явным negative assertion не возвращает raw doors.

[ИЗВЛЕЧЕНО] После fixture correction targeted tests — 60 passed; `NEXT_TELEMETRY_DISABLED=1 npm run release:check` — pass, 1,646 passed / 10 skipped. Последующий approved-snapshot hardening получил отдельный final security review ниже.

## Approved-snapshot hardening and dependent fixtures

[ИЗВЛЕЧЕНО] Второй hosted DB4 failure показал, что DB4/DB5 positive fixtures всё ещё вызывали revoked raw baseline/release RPC. Финальная migration `20260911160000` теперь оставляет исходную atomic transaction/replay implementation только как non-public delegate, а public same-signature request-bound door сначала авторизует запрос и требует хотя бы один approval package в статусе `approved` для active project package. Delegate отозван у всех callable roles; module-gated grant остаётся только на public door.

[ИЗВЛЕЧЕНО] DB4/DB5 fixtures используют `publish_baseline_atomic`, `publish_release_request_bound` и `publish_work_package_release_request_bound`; старые raw publication calls проверяются только как закрытые `insufficient_privilege`. Canonical IDs atomic baseline обновлены на `baseline:db4-publish-baseline-v1` и `baseline:db5-publish-baseline-v2`.

[ИЗВЛЕЧЕНО] Fresh independent Codex Security review `20f8b2bc-e236-4ded-a269-c6e317949282`: 0 findings; проверены authorization-before-lookup, approved-snapshot guard, delegate reachability и сохранение module-gated ACL.

[ИЗВЛЕЧЕНО] Следующий hosted DB4 schema-security gate обнаружил PostgreSQL default `PUBLIC EXECUTE`, добавленный самим `CREATE FUNCTION` wrapper. Migration теперь явно выполняет `REVOKE ALL` для public wrapper до M3 switch; итоговый независимый security review повторяется после этого исправления.

[ИЗВЛЕЧЕНО] Следующий DB4 inventory gate обнаружил, что delegate увеличивал public `projectceo_product_api` RPC surface. Он перенесён в private `projectceo_product` schema и остаётся закрытым для всех callable roles; public API сохраняет только исходную request-bound signature.

[ИЗВЛЕЧЕНО] Final independent Codex Security review `dbcfbc03-ac5a-4661-ba9a-13369157eebd`: 0 findings; проверены private placement delegate, default-deny и отсутствие второй public RPC surface.

## Grep-проверки

[ИЗВЛЕЧЕНО] Runtime `publish_baseline` больше не вызывает `projectceo_api.publish_version` или `publish_project_baseline`; он вызывает только `ProjectBrainHumanPostgresAdapter.publishBaselineAtomic` с server-confirmed latest-version/baseline coordinates, state revision, command id и idempotency key.

## Independent security review

| scan | scope | verdict |
|---|---|---|
| `1773b465-4da1-4db9-9099-73338df17a86` | финальный working-tree diff от `0a270dd` | 0 findings; 4 security surfaces reviewed |

[ИЗВЛЕЧЕНО] Проверены request-derived inputs, module-gated authenticated ACL, raw-door closure, idempotency/transaction boundary и отсутствие client-provided descriptor/refs/hash.

## Не сделано / вынесено

[ИЗВЛЕЧЕНО] Hosted CI/AP5 и DB4/DB5 не выполнены локально из-за внешних runtime prerequisites. Они остаются обязательными checks draft PR. Shared DB, production, deploy, flags и merge не выполнялись.
