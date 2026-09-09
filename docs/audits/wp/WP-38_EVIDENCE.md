# WP-38 — Мёртвый контур impact — EVIDENCE

[ИЗВЛЕЧЕНО] Дата: 2026-09-09. Ветка: `wp/wp-38-dead-impact-contour-reassess`.
Базовый HEAD: `64b23e83bfc028aa3daa25ce07fc9da8a34c87b8`.
PR: не создан. Сессия: `/root/wp38`. Результат находится в рабочем дереве,
не закоммичен. CONTEXT_MODE: repository_only, разрешён владельцем.

## Основание

[ИЗВЛЕЧЕНО] WP-38, трек 3.4; поправка 08.09 к глобальному аудиту;
DEC-034 и DEC-037. Оркестратор разрешил реализацию и точечный append
исторического аудита согласно allowlist карточки.

## Allowlist по факту

[ИЗВЛЕЧЕНО] Изменены только файлы allowlist:
- `lib/project-intelligence/adapters/postgres/execution.ts`;
- `tests/projectceo-integration/static-request-bound-boundary.test.ts`;
- `docs/canonical/remhaos-v1/REMHAOS_M4_V1_PRODUCTION_READINESS_AUDIT_2026-08-12.md`;
- `docs/audits/wp/WP-38_EVIDENCE.md` (новый файл).

[ИЗВЛЕЧЕНО] Первые три пути проверены `git diff --name-only`; evidence
является untracked до коммита. Исторический аудит дополнен в конце,
существующий текст не изменён.

## Хотспоты

[ИЗВЛЕЧЕНО] H17 зарезервирован карточкой WP-38: удалён raw метод
`calculateChangeImpact`, сохранён `calculateChangeImpactPolicyBound`.
Именованные отказы поверхности и совместимые поля truncation не менялись.

## Пины

[ИЗВЛЕЧЕНО] В static-request-bound-boundary.test.ts сохранён запрет raw
`calculateChangeImpact(` в human command service и добавлен запрет
`calculateChangeImpactPolicyBound(`. Числовых пинов нет.

## Миграция

[ИЗВЛЕЧЕНО] Нет; SQL не менялся.

## Локальные гейты

[ИЗВЛЕЧЕНО] Node v22.23.0; npm 10.9.8. `git diff --check`: exit 0.
[ИЗВЛЕЧЕНО] Targeted tests: `./node_modules/.bin/vitest run
tests/projectceo-integration/static-request-bound-boundary.test.ts
tests/db5/adapter-contract.test.ts
tests/projectceo-integration/change-impact-worker.test.ts` — exit 0,
3 файла / 35 тестов passed, Vitest 4.1.10. Использован общий install
оркестратора через локальный symlink node_modules; отдельный npm ci не запускался.
[ИЗВЛЕЧЕНО] `npm run release:check` выполнен: lint exit 0 (13 warnings,
0 errors), typecheck exit 0, Vitest — 195 файлов passed, 1563 теста passed,
10 skipped. Build первоначально упал, общий exit 1: Turbopack не допускает
symlink node_modules за root проекта. Это фактический отказ первого запуска.

[ИЗВЛЕЧЕНО] После замены собственного symlink локальной copy-on-write копией
общего node_modules (`cp -cR`, без изменения lockfile, конфигов и исходников)
повторён только упавший шаг: `npm run build` — exit 0, 45/45 статических
страниц. Остальные шаги не повторялись, поскольку исходники не менялись.
Таким образом, все четыре локальных шага пройдены; единого успешного
запуска release:check после замены symlink не было.

[ИЗВЛЕЧЕНО] Логи: `/private/tmp/remhaos-wp38-release-check.log` и
`/private/tmp/remhaos-wp38-build-retry.log`. DB4/DB5 harness и AP5: NOT_RUN.
Тест tests/db5/adapter-contract.test.ts — unit contract, не DB5 harness.

[ИЗВЛЕЧЕНО] Все 13 lint warnings — `@typescript-eslint/no-unused-vars`
в файлах вне diff: lib/llm/gigachat.ts:11 (`_prompt`);
lib/risks/llm.ts:43 (`_city`, `_district`), :44 (`_contact`),
:49 (`_c`, `_a`), :52 (`_city`, `_district`);
tests/layout-studio/adapters/http/authenticated-layout-repository.test.ts:524
(`_redacted`); tests/layout-studio/domain/schema-registry.test.ts:69
(`_dropped`); tests/project-intelligence/vertical-slice-contract.integration.test.ts:328
(`_impactRelevant`); tests/projectceo-integration/m2-authenticated-read-v5-adapter.test.ts:288,:403
(`_redacted`). Во втором build warnings не обнаружены.

## CI

[ИЗВЛЕЧЕНО] NOT_PROVEN: нового CI run нет; AP5 не запускался.
Звенья 12–15 требуют предыдущих звеньев serial chain и authenticated среды.

## Grep-проверки

[ИЗВЛЕЧЕНО] На базовом HEAD команда
`rg -n 'acknowledgeImpactTruncation|allImpactsReviewed|truncationAcknowledged|unacknowledgedTruncatedRunId' lib tests`
не вывела совпадений. Это проверка lib/tests, не исторических документов.

[ИЗВЛЕЧЕНО] Команда `rg -n '\.calculateChangeImpact\(' lib tests`
не вывела совпадений на базовом HEAD.

[ИЗВЛЕЧЕНО] До изменения `execution.ts:441` содержал raw метод адаптера;
после удаления совпадений `async calculateChangeImpact(` в нём нет.
`runner.ts:337` продолжает вызывать `calculateChangeImpactPolicyBound`.

[ИЗВЛЕЧЕНО] Одноимённая pure-функция в impact.ts имеет живых callers
и не входит в удаляемый контур; она сохранена.

## Не сделано / вынесено

[ИЗВЛЕЧЕНО] Коммит, push, PR, CI и AP5 не выполнены.
[ИНТЕРПРЕТИРОВАНО] WP нельзя считать принятым до обязательных гейтов карточки
и независимого ревью.

## Blind review

[ИЗВЛЕЧЕНО] Не проводилось.

## Безопасность

[ИЗВЛЕЧЕНО] Production и секреты не использовались; внешних mutations нет.

## Финальная локальная проверка и независимое ревью

[ИЗВЛЕЧЕНО] После исправления только расположения зависимостей выполнена полная
последовательность `npm ci --cache /private/tmp/remhaos-npm-cache-20260909 --no-audit --no-fund`
и `npm run release:check`, оба exit 0. Логи:
`/private/tmp/remhaos-wp38-npm-ci.log`, `/private/tmp/remhaos-wp38-release-final.log`.
Ранее упавший прогон сохранён как история, его результат не переименован в PASS.

[ИЗВЛЕЧЕНО] Независимый read-only reviewer `/root/review_wp38` проверил isolated
snapshot без истории исполнителя, source diff, карточку, протокол и мастер-ТЗ.
Вердикт: BLOCKER/MAJOR/MINOR не найдено. Reviewer самостоятельно тесты не запускал.
Обязательные CI и AP5 остаются непроверенными; пакет ещё не принят.
