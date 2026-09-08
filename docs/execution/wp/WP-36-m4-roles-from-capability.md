# WP-36 — M4 №6 + закрытие BUG-04: роли из capability, тест паритета `role-policy` ↔ миграция

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 3.3 | W2 | 1–2 РС | S-CS (после WP-21) | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Список ролей выдачи в `command-service.ts:1062-1071` заменить выводом из capability; закрепить тестом паритет UI-политики и миграции `20260802030000:20-51`.

## Входы (что должно быть выполнено до старта)
- WP-21 слит (командная шина свободна)

## Allowlist файлов (правишь только это)
- H3 — блок `distribute_release` в `command-service.ts`
- H13 — `components/projectceo/role-policy.ts`, `tests/projectceo-ui/roles.test.ts`
- H5 — при необходимости
- `tests/projectceo-integration/command-service.test.ts`
- `docs/audits/wp/WP-36_EVIDENCE.md`

## Запрещено
- H1, H2, H4, H6, H7, H8, H11, H14

## Шаги
1. `can(scope.role, capability)` из реестра/`role-policy` вместо списка; тест парсит миграцию (образец `m4-surface-matrix.test.ts`) и сверяет с `role-policy.ts`; evidence, что builder/client уже совпадают (`role-policy.ts:58-70`).

## Гейты
- полный CI

## Критерий приёмки
- списка ролей в `command-service.ts` нет; тест паритета зелёный

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-36-m4-roles-from-capability` от свежего `origin/main`; один PR `WP-36: M4 №6 + закрытие BUG-04: роли из capability, тест паритета `role-policy` ↔ миграция`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-36_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-36: <статус> | PR #N | HEAD <sha> | blockers: …`.
