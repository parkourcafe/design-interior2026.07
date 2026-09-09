# WP-36 — M4 №6 + закрытие BUG-04 — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-36-m4-roles-from-capability`. Implementation HEAD: `43c8369` + evidence `4b18697`. PR: #137 (draft). Сессия: Codex repository-only.

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-36-m4-roles-from-capability.md`: заменить ручной список ролей для `distribute_release` на capability policy и закрепить паритет UI-политики с миграцией `20260802030000`.

## Allowlist по факту

Изменены только разрешённые файлы WP-36:

```text
lib/project-intelligence/delivery/projectceo/command-service.ts
tests/projectceo-integration/command-service.test.ts
tests/projectceo-ui/roles.test.ts
docs/audits/wp/WP-36_EVIDENCE.md
```

Проверка: `git diff --name-only origin/main...HEAD` до commit не показывала кодовых изменений; рабочий diff перечислял только три allowlisted исходника и этот evidence-файл (плюс уже существующие незакоммиченные `docs/execution/STATUS.md` и `OWNER_QUEUE.md`, которые в WP-36 не включались).

## Хотспоты

Затронут H3 (серверный guard `distribute_release`) и H13 (role policy/tests). H5 и запрещённые H1, H2, H4, H6, H7, H8, H11, H14 не тронуты. SQL и миграции не изменялись.

## Пины

| пин (файл:строка) | было | стало | основание |
|---|---|---|---|
| `command-service.ts:1062-1071` | ручной allowlist `owner_lead`/`architect` | `can(uiRole, "distribute_release")` с server-derived role mapping | карточка WP-36, capability parity |

## Миграция

Миграционных изменений нет. Миграция `20260802030000` читается тестом как источник parity; S-MIG не назначается.

## Локальные гейты

- `npm exec vitest run tests/projectceo-ui/roles.test.ts tests/projectceo-integration/command-service.test.ts` — exit 0, 2 файла, 12 тестов.
- Первый `npm ci` — exit 1 из-за root-owned файлов в пользовательском npm cache (`EPERM`); код не затронут. Повтор: `npm ci --cache /private/tmp/remhaos-npm-cache` — exit 0.
- `npm run release:check` — exit 0: lint (13 существующих warnings, 0 errors), typecheck, 195 test files / 1565 passed / 10 skipped, Next build 45/45 страниц.
- DB4/DB5 не запускались: SQL не задет.

## CI

PR #137 открыт после локальной фиксации evidence; hosted CI/AP5/DB4/DB5/Claude review для WP-36 — UNKNOWN до завершения проверок.

## Grep-проверки

- `rg -n "scope\\.role !== \"owner_lead\"|scope\\.role !== \"architect\"" lib/project-intelligence/delivery/projectceo/command-service.ts` — ручной список ролей отсутствует.
- `rg -n "can\\(uiRole, \"distribute_release\"\\)" lib/project-intelligence/delivery/projectceo/command-service.ts` — capability guard присутствует.
- Тест паритета извлекает `when '<role>' then array[...]` из `20260802030000_projectceo_m2_workspace_revisions.sql` и сравнивает owner/architect/builder/client с `role-policy.ts`.

## Не сделано / вынесено

Merge и production не выполнялись. Blind review WP-36 не завершён: доступные reviewer sessions ранее остановились на usage limit (`WAITING_RATE_LIMIT`); нужен независимый read-only review после публикации PR.

## Blind review

`review_wp36_clean` — не запущен (доступные reviewer sessions остановились на usage limit); статус `UNKNOWN`, не трактуется как PASS.

## Безопасность

Production, release, shared DB, credentials и миграции не использовались. Секретов в diff/evidence нет. Изменение authorization guard выполнено после явного owner-разрешения в текущем диалоге; merge остаётся owner gate.
