# WP-32 — Прогон AP6 + sanitized receipt + отчёт; цикл 7 зелёный

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 3.1 | W5–W6 | 3–6 РС | S-PE (после WP-31) | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Пройти пакет Ташкент через M2→M3→baseline→release→M4 на одноразовом стеке, получить `EXTERNAL_REAL_PACKAGE_PASS`, закрыть цикл 7.

## Входы (что должно быть выполнено до старта)
- WP-31
- партнёр (данные пакета)
- машина с supabase CLI 2.109.1 + docker + Playwright (локальный `run-local.zsh`); в облачной сессии CLI нет — прогон делает владелец/оркестратор на подходящей машине или через отдельную CI-джобу

## Allowlist файлов (правишь только это)
- H15: манифест (`status: completed`), `allowlist.json`
- `docs/product-intelligence/wave-3/pilot/*` (отчёт `TASHKENT_AP6_RUN_2026-09-xx.md`)
- `.tdd-state.json` (M2-070)
- gate-тест `tests/pilot-evidence/m2-pilot-external-manifest.gate.test.ts` (принимает completed с receipt)
- `docs/audits/wp/WP-32_EVIDENCE.md`

## Запрещено
- H1–H14

## Шаги
1. Bootstrap local → включения DEC-029/039 (`enable-m3-publication.sql`, `enable-m4-increment-1.sql`, `enable-m4-v1-impact.sql`, `enable-m4-v2-v3.sql`) → `ARCHIDOM_EXTERNAL_PILOT_MANIFEST=… zsh tests/pilot-evidence/run-m2-pilot-evidence.zsh` → `PASS.json` → `workflow_dispatch` с `cycle7_receipt_head_sha`/`cycle7_receipt_b64` (`ci.yml:799-848`) → PR.
2. Продолжить цепочку до M3 handoff → baseline → release → M4 distribute/ack/change/impact → двери V2/V3 на disposable (DEC-039 §3.3).
3. Отчёт: import gaps, mapping package/room/discipline, время до baseline, конфликты, downstream use.

## Гейты
- полный CI
- `cycle 7 evidence` зелёный на точном HEAD

## Критерий приёмки
- `npm run test:cycle7` зелёный на main; артефакт `cycle7-sanitized-evidence-<sha>`

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-32-ap6-run-cycle7-green` от свежего `origin/main`; один PR `WP-32: Прогон AP6 + sanitized receipt + отчёт; цикл 7 зелёный`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-32_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-32: <статус> | PR #N | HEAD <sha> | blockers: …`.
