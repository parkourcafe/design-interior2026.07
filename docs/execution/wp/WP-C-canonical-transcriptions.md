# WP-C — Канонические транскрипции подписанных решений — только оркестратор

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 1.10, 2.8, К-2, К-15, К-16 | по событию (после подписи владельца) | 0,5 РС за транскрипцию; 1–2 РС readiness update | S-CANON | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Перенести подписанные владельцем решения в журнал и каноническую матрицу без искажений.

## Входы (что должно быть выполнено до старта)
- подписанные документы владельца: DEC-040 (Р15), S1–S4 (Р16)

## Allowlist файлов (правишь только это)
- H9: `AGENTS.md` (абзац по журналу)
- H10: `REMHAOS_DECISION_LOG_v1.md` (append строки), `REMHAOS_READINESS_MATRIX_v1.csv` (К-2), `MASTER_EXECUTION_PLAN.md:10-17` (К-16), новый `REMHAOS_READINESS_UPDATE_v1.md` (К-15)
- `docs/audits/wp/WP-C_EVIDENCE.md`

## Запрещено
- всё остальное
- любая транскрипция без подписанного документа

## Шаги
1. Строка журнала = подписанному документу дословно; при rebase — «сложение» строк (`DECISION_LOG:9-18`); blind review обязателен.

## Гейты
- docs-only
- blind review (канон)

## Критерий приёмки
- каждая строка журнала ссылается на подписанный документ

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-c-canonical-transcriptions` от свежего `origin/main`; один PR `WP-C: Канонические транскрипции подписанных решений — только оркестратор`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-C_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-C: <статус> | PR #N | HEAD <sha> | blockers: …`.
