# WP-39 — HTTP-маршрут enroll (Р20 (а)) request-bound, CSRF, тесты — EVIDENCE

Дата: 2026-09-11. Ветка: `wp/wp-39-enroll-http-route`. HEAD: `0dc9030`. PR: #150 (draft).

## Основание

[ИЗВЛЕЧЕНО] `docs/execution/wp/WP-39-enroll-http-route.md`: HTTP-дверь к
существующей `projectceo_api.enroll_organization_project(uuid,text)` из
`20260717090000_projectceo_foundation_access.sql`; Р20=(а) — прямой маршрут.
Решение владельца от 2026-09-11 подтверждает Р20(a).

## Allowlist по факту

[ИЗВЛЕЧЕНО] Изменены новый маршрут, его contract/route tests и этот evidence
file. Все файлы входят в allowlist карточки WP-39.

## Хотспоты

[ИЗВЛЕЧЕНО] H1, H2, H6, H7, H11, H13, H14 и
`tests/ap5/global-setup.ts` не изменялись.

## Пины

| пин (файл:строка) | было | стало | основание |
|---|---|---|---|
| `20260717090000_projectceo_foundation_access.sql:1217` | RPC существовал без HTTP-двери | вызывается только request-bound маршрутом | WP-39, Р20(a) |

## Миграция

Нет. Используется существующий additive RPC без изменения SQL/RLS/ACL.

## Локальные гейты

[ИЗВЛЕЧЕНО] `npm ci` с isolated npm cache — PASS. Focused route tests —
4/4 PASS. `npm run release:check` на изменении: lint 0 errors / 13 existing
warnings, typecheck PASS, Vitest 206 files: 1646 PASS / 10 skipped, build PASS.

## CI

[ИЗВЛЕЧЕНО] Draft PR #150 создан. Run id каждой job будет добавлен после CI
на точном final HEAD.

## Grep-проверки

[ИЗВЛЕЧЕНО] Поиск `enroll_organization_project` подтвердил: существующий RPC
выводит actor из `auth.uid()`, проверяет `public.projects.designer_id` и создаёт
organization/project scope в базе. Новый маршрут не принимает actor,
organization, role или client idempotency key.

## Не сделано / вынесено

[ИНТЕРПРЕТИРОВАНО] UI-кнопка enrolment и AP5 change исключены из карточки;
маршрут предоставляет безопасную HTTP-дверь, но не меняет существующий browser
flow. Follow-up: подключить UI только отдельным WP с его UX/AP5 контрактом.

## Blind review

[ИЗВЛЕЧЕНО] Независимое review exact SHA `4f9c3bf` — вердикт «no actionable
security/contract findings». Проверены строгий body, порядок CSRF, request-bound
client/identity, server-derived idempotency, controlled errors и `no-store`.
Отдельный Codex Security diff scan `312b235b-fed9-45d7-8675-051574578f5d`
завершён: 5 surfaces reviewed, 0 findings. Реальный Auth/PostgREST owner/foreign
execution остаётся CI/disposable доказательством.

## Безопасность

[ИЗВЛЕЧЕНО] Production, shared DB, credentials и service role не использовались.
CSRF same-origin, strict body, request-bound Auth, controlled error envelope и
`Cache-Control: private, no-store` покрыты route tests.
