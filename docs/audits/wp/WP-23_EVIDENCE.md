# WP-23 — `sendProposal` требует platform approval — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-23-send-proposal-requires-approval`. Implementation HEAD: `30b0135`. Evidence commit и PR будут добавлены после публикации. Сессия: Codex repository-only.

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-23-send-proposal-requires-approval.md`: отправка КП разрешается только при approved platform approval request; self-approval остаётся явно маркированным по DEC-010.

## Allowlist по факту

Изменены allowlisted файлы WP-23:

```text
app/dashboard/projects/[id]/proposal/actions.ts
app/dashboard/projects/[id]/proposal/editor.tsx
lib/i18n/ru.ts
tests/projectceo-integration/m1-proposal-approval.test.ts
docs/audits/wp/WP-23_EVIDENCE.md
```

`page.tsx`, `m1-project-panel.tsx` и DB4 SQL не менялись: существующая M1 Approval UI уже отображает `selfApproved`, а DB4 51 уже покрывает создание, submit, decision и проекцию self-approval.

## Хотспоты

Затронут только M1 proposal action/editor и RU copy. H3 command-service не менялся; вызов approval использует существующую request-bound platform RPC. Запрещённые H1, H2, H4–H7, H11, H14 не тронуты. Миграции и RLS не изменялись.

## Пины

| пин (файл:строка) | было | стало | основание |
|---|---|---|---|
| `proposal/actions.ts:117-164` | `sendProposal` сразу писал `status='sent'` | перед записью требуется approved `project_passport` request через `list_approval_requests` | WP-23, DEC-010 |
| `proposal/editor.tsx` | ошибка отправки терялась | показывается локализованный approval-required feedback | WP-23 UX |

## Миграция

Миграционных изменений нет. Используется существующая `20260824150000_projectceo_platform_approval_requests.sql`; новый migration slot не нужен.

## Локальные гейты

- `npm ci --cache /private/tmp/remhaos-wp23-npm-cache` — exit 0.
- `npm exec vitest run tests/projectceo-integration/m1-proposal-approval.test.ts` — exit 0, 2 теста.
- `npm run release:check` — exit 0: lint (13 существующих warnings, 0 errors), typecheck, 200 test files / 1600 passed / 10 skipped, Next build 45/45 страниц.
- DB4 не запускался отдельно: существующий SQL-тест не менялся; hosted DB4/DB5 требуется после PR.

## Grep-проверки

- `rg -n "list_approval_requests|approval_required|status: \"sent\"" app/dashboard/projects/[id]/proposal/actions.ts` — gate стоит до update `status='sent'`.
- Проверка denial: отсутствие approved request возвращает `{ ok: false, reason: "approval_required" }` и не вызывает `supabase.from`.
- Проверка allow: approved `project_passport` разрешает существующий proposal/project/event write path.
- Self-approval UI/DB coverage уже подтверждена `components/projectceo/m1-project-panel.tsx` и `tests/db4/51_platform_approval_requests_operations.sql`.

## Не сделано / вынесено

Merge и production не выполнялись. Hosted CI/AP5/DB4/DB5/Claude review будут UNKNOWN до публикации PR.

## Blind review

Независимый blind review — pending; reviewer sessions ранее достигли usage limit. Статус не трактуется как PASS.

## Безопасность

Отправка блокируется fail-closed при ошибке или отсутствии approved request. Production, shared DB, credentials и новые миграции не использовались. Секретов в diff/evidence нет.
