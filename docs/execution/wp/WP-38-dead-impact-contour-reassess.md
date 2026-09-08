# WP-38 — Мёртвый контур impact: grep-доказательство, удаление сырой `calculateChangeImpact`, «Поправка» к аудиту 12.08

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 3.4 | W1 (филлер) | 1 РС | — | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Доказать grep-ом отсутствие BUG-06/07/08 на `main`, удалить оставшуюся сырую дверь адаптера и оставить именованные отказы поверхности нетронутыми.

## Входы (что должно быть выполнено до старта)
- —

## Allowlist файлов (правишь только это)
- H17: `lib/project-intelligence/adapters/postgres/execution.ts` (метод `calculateChangeImpact` :441-463), `tests/projectceo-integration/static-request-bound-boundary.test.ts`
- `docs/canonical/remhaos-v1/REMHAOS_M4_V1_PRODUCTION_READINESS_AUDIT_2026-08-12.md` — только append «Поправка 2026-09» к §7.2
- `docs/audits/wp/WP-38_EVIDENCE.md`

## Запрещено
- H3, H4, H5, H11, H14
- `command-contract.ts:261`, `action-registry.ts:79`, `execution-flag.ts:106`, `live-read-port.ts:1320` — оставить (AP5 звено 12 утверждает отказ `operation_unavailable`)
- `isTruncated`/`truncationReason` (runner :346, AP5 :678) — оставить

## Шаги
1. `rg 'acknowledgeImpactTruncation|allImpactsReviewed|truncationAcknowledged|unacknowledgedTruncatedRunId'` → вывод в evidence.
2. Удалить метод `calculateChangeImpact` адаптера (runner зовёт `calculateChangeImpactPolicyBound`, `runner.ts:337`); поправить пин в static-boundary тесте.
3. Append к §7.2 аудита 12.08: ссылка на `coverage_status` вместо `is_truncated`/`impact_truncation_acknowledgements`.

## Гейты
- полный CI (scope m4_v1)

## Критерий приёмки
- метод удалён; AP5 звенья 12–15 зелёные

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-38-dead-impact-contour-reassess` от свежего `origin/main`; один PR `WP-38: Мёртвый контур impact: grep-доказательство, удаление сырой `calculateChangeImpact`, «Поправка» к аудиту 12.08`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-38_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-38: <статус> | PR #N | HEAD <sha> | blockers: …`.
