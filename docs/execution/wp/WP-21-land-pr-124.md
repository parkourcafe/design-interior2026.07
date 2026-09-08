# WP-21 — Посадка PR #124: rebase после #123, CI на HEAD, blind review, merge

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 2.1 | W1 | 1 РС | S-MIG #1 | да (`20260831170000` из PR; ledger → 91) |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Перенести изменения открытого PR #124 (первый мост M1 → ProjectCEO) на ветку пакета и довести до слияния без расширения объёма; чужая ветка не переписывается.

## Входы (что должно быть выполнено до старта)
- Р1 (CI)
- #123 слит
- Р11 — решение о модели моста (автор PR требует его до merge)

## Allowlist файлов (правишь только это)
- только diff PR #124: миграция `20260831170000`, ledger → 91, `preExisting`, `command-contract.ts`, `command-service.ts`, `action-registry.ts`, `components/projectceo/project-workspace.tsx`, `contracts.ts`, `lib/i18n/ru.ts`
- `docs/audits/wp/WP-21_EVIDENCE.md`

## Запрещено
- новые файлы и правки сверх diff PR
- H9, H10

## Шаги
1. `git fetch origin codex/m1-project-workspace-contracts`; ветка `wp/wp-21-land-pr-124` от `origin/main` (после #123); перенести коммиты #124 через `git merge origin/codex/m1-project-workspace-contracts` или cherry-pick с сохранением авторства — чужую ветку не rebase-ить и не force-push-ить; конфликты H1/H5/H8/H13 разрешать «сложением»; открыть новый PR `WP-21: land #124` со ссылкой на #124; после слияния #124 закрывается как superseded.
2. Проверить `validModules` в `tests/platform/action-registry.test.ts:50` содержит `m1`; ledger 91; `preExisting` содержит миграцию.
3. CI на точном HEAD: 7 джоб зелёные; Claude Code Review; blind review. На ревью запросить вынос вкладки Passport в `components/projectceo/m1-passport-panel.tsx` как follow-up (не в этом PR).
4. Слияние — владелец (миграция) после Р11; оркестратор ставит `READY_FOR_OWNER_MERGE`.

## Гейты
- полный CI + Claude review + blind review

## Критерий приёмки
- ledger 91; все обязательные проверки зелёные на HEAD; статус `READY_FOR_OWNER_MERGE` или `MERGED`

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-21-land-pr-124` от свежего `origin/main`; один PR `WP-21: Посадка PR #124: rebase после #123, CI на HEAD, blind review, merge`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-21_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-21: <статус> | PR #N | HEAD <sha> | blockers: …`.
