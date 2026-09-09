# WP-25 — service-role import boundary — EVIDENCE

[ИЗВЛЕЧЕНО] Дата: 2026-09-09. Ветка: wp/wp-25-token-scoped-helper-allowlist.
HEAD baseline: 64b23e83bfc028aa3daa25ce07fc9da8a34c87b8; рабочий diff,
без коммита и PR. CONTEXT_MODE: repository_only, разрешён владельцем.

## Основание

[ИЗВЛЕЧЕНО] WP-25, BUG-05 (а), подготовка Р26. Оркестратор подтвердил
конкретные route paths после grep-first. Р26 принят владельцем 2026-09-09
до завершения и принятия WP-26; подписант `parkourcafe`.

## Allowlist по факту

[ИЗВЛЕЧЕНО] 15 существующих callers переведены с createAdminClient на
createScopedServiceClient с literal purpose; только import/call/type alias,
тела запросов и существующие guards сохранены.

| Путь | Purpose |
|---|---|
| [ИЗВЛЕЧЕНО] `app/api/intake/start/route.ts` | `intake-start` |
| [ИЗВЛЕЧЕНО] `app/api/intake/submit/route.ts` | `intake-submit` |
| [ИЗВЛЕЧЕНО] `app/api/intake/upload/route.ts` | `intake-upload` |
| [ИЗВЛЕЧЕНО] `app/api/client/create/route.ts` | `client-bootstrap` |
| [ИЗВЛЕЧЕНО] `app/api/proposal/respond/route.ts` | `proposal-response` |
| [ИЗВЛЕЧЕНО] `app/p/[public_token]/page.tsx` | `public-proposal` |
| [ИЗВЛЕЧЕНО] `app/b/[token]/page.tsx` | `public-brief` |
| [ИЗВЛЕЧЕНО] `app/room/[access_token]/page.tsx` | `participant-room` |
| [ИЗВЛЕЧЕНО] `app/api/brief/custom-question/plan-upload/route.ts` | `authenticated-plan-upload` |
| [ИЗВЛЕЧЕНО] `app/api/project-room/task-status/route.ts` | `participant-task-status` |
| [ИЗВЛЕЧЕНО] `lib/rate-limit.ts` | `system-rate-limit` |
| [ИЗВЛЕЧЕНО] `lib/llm/recording.ts` | `system-ai-recording` |
| [ИЗВЛЕЧЕНО] `app/api/account/delete/route.ts` | `authenticated-account-delete` |
| [ИЗВЛЕЧЕНО] `app/api/integrations/telegram/webhook/route.ts` | `system-telegram-webhook` |
| [ИЗВЛЕЧЕНО] `lib/integration-gateway/runtime/worker-client.ts` | `system-integration-worker` |

[ИЗВЛЕЧЕНО] Четыре новых файла:
lib/supabase/token-scoped.ts;
tests/release/service-role-allowlist.test.ts;
docs/audits/REMHAOS_RISK_ACCEPTANCE_TOKEN_SCOPED_2026-09-xx.md;
docs/audits/wp/WP-25_EVIDENCE.md. Всего 19 файлов, строго allowlist.

## Хотспоты / пины / миграции

[ИЗВЛЕЧЕНО] H1–H18 не менялись. SQL, права БД, configs и lockfile не менялись.
Числовых пинов нет. Inventory raw callers намеренно точный и временный.

## Grep-first и остаточный inventory

[ИЗВЛЕЧЕНО] До изменения `rg -n 'createAdminClient|supabase/admin' app lib`
нашёл 22 caller-файла плюс определение фабрики. 15 разрешены карточкой,
7 вне allowlist остаются raw: lib/intake.ts; lib/designer.ts; lib/studio.ts;
app/dashboard/projects/[id]/page.tsx; app/join/[token]/page.tsx;
app/join/[token]/actions.ts; app/api/pilot/route.ts.
[ИЗВЛЕЧЕНО] Их классы и основания перечислены явно в guard и черновике Р26.
Designer/session случаи адресованы WP-26; дополнительные public/invite
исключения требуют отдельной постановки, а не молчаливого расширения allowlist.

## Локальные гейты

[ИЗВЛЕЧЕНО] Node v22.23.0 / npm 10.9.8. Зависимости скопированы APFS
copy-on-write из общего npm ci оркестратора. Отдельный install не запускался.
[ИЗВЛЕЧЕНО] Первые targeted: allowlist, account-delete-and-associations,
telegram-webhook-route — 3 файла / 34 tests passed, exit 0.
[ИЗВЛЕЧЕНО] После добавления TS import-equals проверки targeted guard —
12 tests passed, exit 0. `git diff --check`: exit 0.
[ИЗВЛЕЧЕНО] Первый release:check exit 0: 196 файлов, 1574 tests passed,
10 skipped, lint/typecheck/build прошли. После дополнительного negative
случая финальный `npm run release:check` — exit 0: lint (0 errors,
13 warnings), typecheck, 196 файлов / 1575 tests passed / 10 skipped,
build 45/45 static pages. Лог /private/tmp/remhaos-wp25-release-check-final.log.
[ИЗВЛЕЧЕНО] 13 warnings @typescript-eslint/no-unused-vars вне diff:
lib/llm/gigachat.ts:11; lib/risks/llm.ts:43 (2), :44, :49 (2), :52 (2);
tests/layout-studio/adapters/http/authenticated-layout-repository.test.ts:524;
tests/layout-studio/domain/schema-registry.test.ts:69;
tests/project-intelligence/vertical-slice-contract.integration.test.ts:328;
tests/projectceo-integration/m2-authenticated-read-v5-adapter.test.ts:288,:403.

## Реальный отрицательный эксперимент

[ИЗВЛЕЧЕНО] В отдельной disposable директории /private/tmp скопированы
тест boundary, helper/admin и vitest config; добавлен настоящий файл
app/api/unlisted/route.ts с aliased import:
`import { createAdminClient as db } from "@/lib/supabase/admin"; db();`.
Запущен тот же `vitest run tests/release/service-role-allowlist.test.ts`.
Результат — exit 1, 1 failed / 10 passed: inventory assertion получил
`app/api/unlisted/route.ts: import lib/supabase/admin`.
Лог: /private/tmp/remhaos-wp25-negative.log. Disposable fixture удалён
после эксперимента; в рабочий runtime запрещённый caller не добавлялся.
[ИЗВЛЕЧЕНО] Отдельные negative cases покрывают named alias, namespace,
relative re-export/export *, dynamic import, require, TS import-equals,
helper caller вне allowlist, wrong-purpose, client module и local re-export.

## CI

[ИЗВЛЕЧЕНО] Новый CI NOT_RUN; DB/AP5 NOT_RUN. Локальная проверка
исходников не является hosted/RLS/production доказательством.

## Риск Р26 / остаточные ограничения

[ИЗВЛЕЧЕНО] Документ Р26 имеет статус ПРИНЯТО; срок — до завершения и
принятия WP-26; условия и подпись владельца зафиксированы в документе.
Helper проверяет purpose и browser boundary, не проверяет token/ownership
и не ограничивает SQL привилегии возвращаемого клиента. Это не sandbox.
[ИЗВЛЕЧЕНО] Authenticated plan upload/account deletion и system workers
названы отдельными классами, не token-scoped маршрутами.
[ИЗВЛЕЧЕНО] Выявлено исходное отличие b/[token]: token проверяется, expiry
не проверяется. Зафиксировано в документе как остаточный риск; семантика
авторизации в WP-25 не менялась.
[ИНТЕРПРЕТИРОВАНО] Подпись Р26 закрывает только owner risk gate; пакет всё ещё
требует security blind review и обязательного CI перед merge. Коммит/push/PR
WP-25 не выполнялись.

## Blind review

[ИЗВЛЕЧЕНО] Первый security review выявил два MAJOR: экспорт фабрики
через ordinary module и обход purpose через parenthesized/aliased callee.
Оба исправлены: imported factory reference допускается только в direct call
или type query; скобки нормализуются перед проверкой purpose. Возврат,
assignment, alias, export и .call/.bind не допускаются. Bindings собираются
до обхода AST, чтобы порядок import/use не был обходом.
[ИЗВЛЕЧЕНО] Guard после исправления — 20 tests passed, exit 0.
Три отдельные on-disk negative fixtures с тем же тестом дали exit 1
(каждая 1 failed / 19 passed): export const ordinaryClient в allowed file
плюс новый второй caller; parenthesized wrong-purpose; const alias wrong-purpose.
Логи: /private/tmp/remhaos-wp25-negative-export.log,
/private/tmp/remhaos-wp25-negative-parenthesized.log,
/private/tmp/remhaos-wp25-negative-alias.log. Fixtures удалены после прогона.
[ИЗВЛЕЧЕНО] Повторный security verdict ожидается; автор не объявляет
замечания закрытыми от имени reviewer. Финальный `npm run release:check` на исправленном коде — exit 0:
lint 0 errors / те же 13 warnings, typecheck, 196 файлов / 1583 tests passed /
10 skipped, build 45/45. Лог /private/tmp/remhaos-wp25-review-fixes-release-check.log.

## Безопасность

[ИЗВЛЕЧЕНО] .env/реальные секреты не читались. Тест фабрики использует
mock syntheticClient, сетевых Supabase вызовов нет. Production и shared DB
не использованы; полномочий service_role не добавлено.

## Финальная локальная последовательность и security review

[ИЗВЛЕЧЕНО] Свежие `npm ci --cache /private/tmp/remhaos-npm-cache-20260909 --no-audit --no-fund`
и `npm run release:check` завершились exit 0. Логи:
`/private/tmp/remhaos-wp25-npm-ci.log`, `/private/tmp/remhaos-wp25-release-final.log`.

[ИЗВЛЕЧЕНО] Независимый reviewer `/root/review_wp38` на corrected isolated
snapshot: REVIEW_PASSED, оба MAJOR закрыты, новых actionable findings нет.
Source рабочего дерева совпадает со snapshot; reviewer тесты сам не запускал.

[ИЗВЛЕЧЕНО] Повторное независимое review обновления подписанного Р26:
`REVIEW_PASSED`. Изменения ограничены R26 и этим evidence-файлом; runtime,
allowlist и scope не менялись. Старых утверждений «не подписано / риск не
принят» в обновлённых документах не осталось.

[ИЗВЛЕЧЕНО] CI для WP-25 отсутствует. Р26 принят как ограниченное временное
решение; production acceptance не наступил.
