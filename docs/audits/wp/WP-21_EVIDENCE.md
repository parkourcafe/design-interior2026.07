# WP-21 — Перенос PR #124 на актуальную базу — EVIDENCE

[ИЗВЛЕЧЕНО] Текущий статус: REVIEW_PENDING. WP-21 core возвращён к существующим direct RPC contracts; replay follow-up остаётся отдельным незакрытым пакетом. Коммит, новый PR и merge для WP-21 не созданы.

[ИЗВЛЕЧЕНО] Дата: 2026-09-09. Ветка: `wp/wp-21-land-pr-124`. Base HEAD: `64b23e83bfc028aa3daa25ce07fc9da8a34c87b8`. Рабочее дерево содержит staged перенос PR #124, незакоммиченные corrections в его allowlist и этот evidence.

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-21-land-pr-124.md`, трек 2.1, S-MIG #1. Решение Р11=enrollment записано в `docs/execution/HANDOFF_TO_CODEX_2026-09-09.md`; действует режим `repository_only`. Задача — перенести существующий PR без расширения функциональности.

[ИЗВЛЕЧЕНО] PR #124 — исходный источник переноса, HEAD `1a7ae0b3e6be4d0e09b690ac74e861b4d13bc25f`; пять исходных коммитов перенесены локально без изменения исходной ветки.

## Allowlist по факту

[ИЗВЛЕЧЕНО] В staged diff остаются 25 файлов исходного PR #124: контракты и UI M1, адаптеры и command service, русские строки, одна миграция, DB4-сценарий 51, AP1/layout/integration/UI tests и migration ledger. Полный перечень даёт `git diff --cached --name-only`.

[ИЗВЛЕЧЕНО] Дополнительно создан только `docs/audits/wp/WP-21_EVIDENCE.md`. Core correction затрагивает runtime boundary и этот evidence; новые SQL/DB4/runner/ledger-92 изменения в WP-21 не входят.

[ИЗВЛЕЧЕНО] Четыре M1 write-команды в `command-service.ts` вызывают реально существующие двери `projectceo_platform_api.create_project_fact`, `create_approval_request`, `submit_approval_request` и `decide_approval_request` через соответствующие adapter methods. Несуществующий `projectceo_platform_api.execute_m1_command` из replay follow-up в core runtime не используется.

## Хотспоты

[ИЗВЛЕЧЕНО] Для WP-21 заняты H1/H2, H3/H4/H5/H8/H13, H14/S-LRP и S-MIG #1 только в объёме PR #124. Production, shared DB, CI-настройки и права доступа не затрагивались.

## Пины

[ИЗВЛЕЧЕНО] Migration/ledger count для WP-21: 90 → 91. Единственная новая строка — `20260831170000_projectceo_platform_approval_request_actor_projection.sql`; её SHA256 `ab1575b66fe402867ead7eb57c230c013cb44f2fcc9d25b544160fa7ca8e41a7`.

[ИЗВЛЕЧЕНО] `tests/ap1/commands/execution-guardrail.test.ts`: 33 → 37 команд из исходного PR. `tests/projectceo-ui/contracts.test.ts`: добавлена вкладка `passport` из исходного PR. `tests/projectceo-integration/m1-platform-command-service.test.ts` подтверждает direct RPC names, server-derived state revision, capability derivation и retry idempotency. Новые M1 replay operations в этот пакет не входят.

## Миграция

[ИЗВЛЕЧЕНО] `20260831170000_projectceo_platform_approval_request_actor_projection.sql` относится к S-MIG #1 и использует DB4-сценарий `51_platform_approval_requests_operations.sql`. Existing timestamps не переименовывались.

[ИЗВЛЕЧЕНО] `20260909010000_projectceo_m1_command_replay_revision.sql`, `tests/db4/58_m1_command_replay.sql`, race-блок в `tests/db4/run.zsh` и запись ledger 92 вынесены в отдельный локальный пакет на ветке `wp/wp-21-command-replay-followup` от `origin/main` `1e132cb47bc9893ac1d46c46051898cf1df0eb70`.

[ИНТЕРПРЕТИРОВАНО] Для отдельного пакета новый S-MIG slot не назначен: protocol требует выдавать timestamp и DB4 номер оркестратором. Slot остаётся UNKNOWN/owner gate; до назначения нельзя считать пакет готовым к commit или PR.

## Локальные гейты

[ИЗВЛЕЧЕНО] Targeted Vitest после core correction: exit 0, 3 файла и 43 теста
passed; полный scope-clean targeted log — 10 файлов и 96 тестов passed.

[ИЗВЛЕЧЕНО] `npm run test:db4`: exit 0, `DB4_PRODUCT_BRAIN_HARNESS_OK` на
`postgres:16-alpine`; `npm run test:db5`: exit 0,
`DB5_EXECUTION_HARNESS_OK` на `postgres:16-alpine`. Повторно выполнены
`PI_DB_IMAGE=postgres:17-alpine npm run test:db4` и `... test:db5`: оба exit 0,
`DB4_PRODUCT_BRAIN_HARNESS_OK`/`DB5_EXECUTION_HARNESS_OK`. Эти прогоны используют
существующие migrations и DB4/DB5 scripts; replay follow-up #58 не добавлялся.

[ИЗВЛЕЧЕНО] `git diff --cached --check` и `git diff --check`: exit 0 для текущего кандидата; secrets и production refs не использовались.

## CI и hosted gates

[ИЗВЛЕЧЕНО] Новый commit/PR, CI, Claude review и hosted AP5 для текущего WP-21 кандидата отсутствуют. Старые receipts PR #124 не заменяют проверки нового HEAD. Merge и production не разрешены.

## Не сделано / вынесено

[ИЗВЛЕЧЕНО] WP-21 не включает command replay revision, DB4 №58, race harness и ledger 92. Эти четыре изменения сохранены отдельным локальным кандидатом без commit/push/PR.

[ИЗВЛЕЧЕНО] M1 completion и production readiness не заявлены. Legacy `sendProposal` approval gate и полный enrollment bridge остаются отдельными пакетами программы.

## Blind review

[ИЗВЛЕЧЕНО] Предыдущий blind review выявил замечания по replay, lost response и
provenance. Core runtime correction устраняет вызов отсутствующего replay RPC;
replay migration, DB4 №58, ledger 92 и UI lost-response retry не включены и не
закрыты. Независимое ревью после direct-RPC correction ожидает финальной проверки
evidence; core scope/runtime review пока BLOCKED только до этой проверки.

## Безопасность

[ИЗВЛЕЧЕНО] В этой сессии не выполнялись commit, push, PR, merge, rebase, production mutation или изменение shared DB. Секретные файлы не читались.
