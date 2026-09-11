# WP-35 — M4 drop legacy release doors — EVIDENCE

Дата: 2026-09-11. Ветка: `wp/wp-35-m4-drop-legacy-release-doors`. Runtime SHA: `9fdfa7f`. PR: ещё не открыт.

## Основание

[ИЗВЛЕЧЕНО] Владелец разрешил repository-only additive migration, физическое удаление legacy `distribute_release` и `acknowledge_release`, DB4/DB5/AP5, review, commit, push и draft PR. Shared DB, production, deploy и merge не разрешены.

## Миграция

| timestamp | historical slot | exact DROP RESTRICT |
|---|---|---|
| `20260911170000` | WP-35 historical S-MIG #4; serialized after WP-33 | `projectceo_product_api.distribute_release(uuid,text,uuid,bigint,text)`; `projectceo_product_api.acknowledge_release(uuid,uuid,text,bigint,text)` |

[ИЗВЛЕЧЕНО] M3 signature array сохранён. M4 increment 1 сохраняет только request-bound distribute/acknowledge и change request doors.

## Allowlist

[ИЗВЛЕЧЕНО] Изменены migration, M4 surface/matrix, M4 environment/DB4 fixtures, migration ledger, Layout Studio migration inventory и DB5 default-deny inventory. DB4/10 и DB5/05 добавлены как test-only extension: они явно доказывают отсутствие двух dropped signatures.

## Локальные гейты

[ИЗВЛЕЧЕНО] Focused M4 matrix/environment: 20 passed.

[ИЗВЛЕЧЕНО] `NEXT_TELEMETRY_DISABLED=1 npm run release:check`: pass; lint 0 errors / 13 existing warnings; 1,646 passed / 10 skipped; build pass.

[ИЗВЛЕЧЕНО] DB4/DB5 PostgreSQL 16: `BLOCKED_EXTERNAL`, local Docker socket returned permission denied. Shared DB не использовалась.

[ИЗВЛЕЧЕНО] `npm run test:ap5`: `BLOCKED_EXTERNAL`, `NEXT_PUBLIC_SUPABASE_URL` is not set. AP5 remains required hosted CI evidence.

## Independent review

[ИЗВЛЕЧЕНО] `root_release` reviewed exact `9fdfa7f` against `b4a52e7`: 17 M4 matrix/Layout tests, no findings. Review confirmed exact two DROP RESTRICT signatures, unchanged request-bound implementations and M3 surface, and preserved M4 positives/negatives.

## Границы

[ИЗВЛЕЧЕНО] Request-bound M4 release functions are self-contained and do not delegate to dropped functions. No `CASCADE`, production, shared DB, deploy, flags or merge performed. AP5 remains required CI evidence.
