# WP-27 — Static-boundary тест TTL подписей ≤900 — EVIDENCE

[ИЗВЛЕЧЕНО] Дата: 2026-09-09. Ветка: `wp/wp-27-signed-url-ttl-boundary-test`. Base HEAD: `64b23e83bfc028aa3daa25ce07fc9da8a34c87b8`. Изменения пока не закоммичены; PR не создан. Сессия: `wp27`.

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-27-signed-url-ttl-boundary-test.md`, трек 2.6, требует static boundary ≤900 и отрицательное доказательство при 3600. Владелец разрешил продолжение в режиме `repository_only` через оркестратора.

## Allowlist по факту

[ИЗВЛЕЧЕНО] Созданы только `tests/release/signed-url-ttl-boundary.test.ts` и `docs/audits/wp/WP-27_EVIDENCE.md`. Production-код и конфигурации не менялись. `git status --short` показывает эти два новых файла; commit/PR diff ещё отсутствует.

## Хотспоты

[ИЗВЛЕЧЕНО] Хотспоты не изменялись. Числовые литералы, const aliases и арифметические TTL проверяются через установленный TypeScript AST; неизвестные значения и отсутствующий TTL отклоняются. Поддержаны обычный вызов метода, индексный доступ со строкой или template literal без подстановок, прозрачные AST-обёртки callee (скобки, assertions, non-null, satisfies).

[ИЗВЛЕЧЕНО] Исключён каталог `lib/project-intelligence/adapters/storage`. Единственный существующий unary wrapper `this.storageAdapter.createSignedUrl(authorization)` в `lib/integration-gateway/file-intake/service.ts` передаёт авторизацию адаптеру; его второй аргумент не является SDK TTL. Динамический SDK TTL `authorization.ttlSeconds` в `lib/integration-gateway/file-intake/storage.ts` допускается только при точной безопасной структуре первых двух инструкций метода: guard с исключением при TTL >900, затем непосредственно неизменённый SDK-вызов. Промежуточная запись или переопределение authorization не допускается. Исключение привязано по identity к единственному AST-вызову внутри второй инструкции, другие dynamic calls его использовать не могут.

## Пины

[ИЗВЛЕЧЕНО] Пины количества миграций/контрактов не менялись.

## Миграция

[ИЗВЛЕЧЕНО] Нет. SQL не изменён; DB4/DB5 к этому test-only пакету не применяются.

## Локальные гейты

[ИЗВЛЕЧЕНО] Node `v22.23.0`, npm `10.9.8`. Оркестратор сообщил успешный обычный `npm ci` (exit 0, 600 packages) в базовом checkout; рабочее дерево использует собственную APFS-копию этого `node_modules`.

[ИЗВЛЕЧЕНО] Предварительные `release:check` останавливались на strict typecheck: индекс аргумента имел тип `Expression | undefined`. Добавлены явная обработка отсутствующего TTL и optional access первого аргумента wrapper. Финальный `npm run release:check` завершился exit 0: lint → typecheck → tests → build. Vitest: 196 файлов, 1564 passed, 10 skipped. Build завершён успешно. Лог: `/private/tmp/remhaos-wp27-release-check.log`.

[ИЗВЛЕЧЕНО] Lint: 0 errors, 13 предупреждений `@typescript-eslint/no-unused-vars` в существующих файлах `lib/llm/gigachat.ts` (1), `lib/risks/llm.ts` (7), `tests/layout-studio/adapters/http/authenticated-layout-repository.test.ts` (1), `tests/layout-studio/domain/schema-registry.test.ts` (1), `tests/project-intelligence/vertical-slice-contract.integration.test.ts` (1), `tests/projectceo-integration/m2-authenticated-read-v5-adapter.test.ts` (2). Новый тест предупреждений не добавил.

[ИЗВЛЕЧЕНО] Финальная версия теста скопирована в `/private/tmp/remhaos-wp27-negative-jauaouqv`. В этой изолированной копии каждый сценарий запускался командой `npx vitest run tests/release/signed-url-ttl-boundary.test.ts`. Baseline TTL 900 и `const ttl = 900` — exit 0. TTL 3600, `60 * 60`, `const ttl = 3600`, неразрешимый `unknownTtl`, `["createSignedUrl"](path, 3600)`, отсутствие TTL — каждый exit 1 с соответствующей диагностикой. Дополнительно после blind review проверены `(bucket.createSignedUrl)(path, 3600)`, ``bucket[`createSignedUrl`](path, 3600)`` и переопределение `authorization = { ...authorization, ttlSeconds: 3600 }` после guard — каждый exit 1. Второй dynamic SDK call после безопасного первого вызова и переопределения TTL до 3600 — также exit 1. Ослабление существующего dynamic guard `>900` до `>3600` — exit 1. Логи отдельных сценариев сохранены в той же временной папке. Временные исходники восстановлены после проверок; исходники рабочего дерева не менялись.

[ИЗВЛЕЧЕНО] `git diff --check` завершился exit 0. Frontend/UI не менялся; Impeccable не запускался.

## CI

[ИЗВЛЕЧЕНО] Не запускался: push и PR не выполнялись. Hosted/browser/production evidence этот пакет не создаёт.

## Grep-проверки

[ИЗВЛЕЧЕНО] `rg -n 'createSignedUrl\(' app lib components` обнаружил SDK literal TTL `900` в `app/dashboard/projects/[id]/page.tsx:238`, dynamic SDK call в file-intake storage, unary wrapper в file-intake service и исключённый PI storage adapter.

## Не сделано / вынесено

[ИНТЕРПРЕТИРОВАНО] Static boundary не является доказательством фактического времени жизни удалённой ссылки или hosted Storage policy. Анализ произвольного JavaScript и алиасов имён SDK-метода не входит в карточку. Неразрешимые TTL в распознанных вызовах не допускаются молча.

## Blind review

[ИЗВЛЕЧЕНО] Первое независимое ревью: CHANGES_REQUESTED, два MAJOR — пропуск скобок/template literal в callee и переопределения authorization после guard. Оба исправлены в тесте; добавлены отрицательные mutation cases. Повторное ревью выявило дополнительный MAJOR: второй dynamic call после безопасного первого мог воспользоваться исключением. Исправлено привязкой к identity конкретного AST-вызова, добавлен negative `second_call_after_reassignment`. Итоговое независимое ревью после этой коррекции ещё не выполнено.

## Безопасность

[ИЗВЛЕЧЕНО] Production, секретные файлы, внешние mutations, push/merge/rebase не использовались. Отрицательные проверки выполняются в отдельной временной копии source-каталогов; исходники рабочего дерева не изменяются.

## Финальная последовательность и reviewer verdict

[ИЗВЛЕЧЕНО] После окончательной коррекции выполнены свежие
`npm ci --cache /private/tmp/remhaos-npm-cache-20260909 --no-audit --no-fund`
и `npm run release:check`, оба exit 0. Логи:
`/private/tmp/remhaos-wp27-npm-ci.log`, `/private/tmp/remhaos-wp27-release-final.log`.

[ИЗВЛЕЧЕНО] Независимый reviewer `/root/review_wp38` по окончательному isolated
snapshot: REVIEW_PASSED, новых actionable findings нет; предыдущие MAJOR
закрыты. Source рабочего дерева совпадает со snapshot побайтово. Reviewer
самостоятельно тесты не запускал; CI на окончательном кандидате ещё отсутствует.
