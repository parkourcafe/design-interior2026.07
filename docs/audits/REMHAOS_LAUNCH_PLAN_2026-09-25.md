# RemHaOS — план запуска четырёх модулей (25.09.2026)

**Основание:** `REMHAOS_FINAL_AUDIT_2026-09-25.md` (снимок `737795d`). Заменяет как действующий план
`REMHAOS_COMPLETION_ROADMAP_2026-09-08.md` в части последовательности; его «определение 100 %» по
модулям сохраняется. **Правило старшинства:** журнал решений старше этого плана; новые решения —
записями DEC-040+.
**Единицы:** РС — рабочая сессия (P50–P90). **Теги:** [owner] — только владелец; [eng] — инженер, PR;
[destructive] — необратимо/вне репо, только после отдельного письменного «да».
Фазы строго последовательны; внутри фазы — параллельные потоки A/B/C (MASTER_EXECUTION_PLAN §5).

---

## Фаза 0 — вернуть гейты и закрыть дефекты пилотного контура

**Входной гейт:** этот аудит принят владельцем. **Объём:** 4–7 РС.

| # | Шаг | Кто | Поток | DoD |
|---|---|---|---|---|
| 0.1 | Решение по CI (Q7): вернуть `pull_request` для lint/typecheck/test/build/DB4/DB5 **или** DEC о ручном dispatch перед merge | [owner] | — | DEC-040 или правка `ci.yml`; первый зелёный прогон на `main` |
| 0.2 | Исправить `ci.yml`: число миграций из ledger, ref стенда из `vars` (DOC-04); починить или удалить мёртвые `claude*.yml` | [eng] | A | `ci-secret-log.contract.test.ts` обновлён; dispatch-прогон зелёный |
| 0.3 | BUG-01: закрыть `/b/` (или фильтр Входа Б + срок/отзыв + без контактов) — по Q3 | [owner] решение, [eng] | B | Тест: токен Входа А → 404; отозванный/истёкший → 404 |
| 0.4 | BUG-02/03/04: статус-гейты submit/saveProposal/sendProposal; переход draft→sent в БД | [eng] | B | Unit + DB4-кейсы на каждый переход |
| 0.5 | BUG-05/06/07/08: серверная схема ответов и согласие; лимиты upload; миграция `rate_limits`; таймаут LLM | [eng] | B | Тесты: POST без consent → 400; 429 на disposable; таймаут → фолбэк на правила |
| 0.6 | BUG-12 (baseline после snapshot) + DB4-кейс | [eng] | C | DB4 зелёный на PG16/17 |
| 0.7 | BUG-15/16 (классификация отказов воркера, dead-letter) + DOC-07 runbook | [eng] | C | Unit-тесты на новые исходы |
| 0.8 | Доки: AGENTS.md под DEC-038/039 (DOC-02), матрица без процентов (DOC-05), backlog'и M3/M4 (DOC-08), carry-over DOC-10/11, BUG-17 | [eng] | A | Grep-проверки; CSV парсится |
| 0.9 | Решения Q1 (R1/DEC-026), Q2 (architect), Q4 (handoff), Q5 (cycle7), Q6 (Telegram) | [owner] | — | DEC-040+ в журнале |
| 0.10 | Исполнить решения 0.9 в коде (revoke R1-RPC / DWG из M3-сигнатур; шаблон ролей; SEC-02 инвентаризация) | [eng] | C | DB4 паритет ролей; `m3-surface-matrix` обновлена |
| 0.11 | Supabase: включить leaked-password protection; отвязать Supabase Preview от production | [owner] | — | Advisors без WARN по auth; check «Supabase Preview» не ссылается на prod |

**Выход:** CI исполняется, blocker/major из аудита закрыты или риск принят письменно, AP5 31/31
на **точном коммите** (CI или Colima) с receipt.

## Фаза 1 — Authenticated Pilot (AP1–AP5) на точном коммите

**Входной гейт:** Фаза 0. **Объём:** 2–4 РС.

* AP1–AP5 повторить на hosted disposable (`workflow_dispatch hosted_staging`) по чистому коммиту;
  receipt с `git rev-parse HEAD` и пустым `git status` [eng].
* Доступ к disposable Supabase, секреты окружений [owner].
* **DoD:** AP5 без skip, DB4/DB5 PG16/17, hosted-приёмка PASS на одном SHA.
* **Решение владельца:** PLATFORM_FOUNDATION → ACTIVE для пилота (уже DEC-038 для disposable) —
  подтвердить, что пилот с реальными бюро идёт на hosted-стенде, а не на production.

## Фаза 2 — Платформенный P0 под M1 + M1 до «Расширения»

**Входной гейт:** Фаза 1. **Объём:** 5–9 РС.

* `ai_calls`: токены и `cost_rub` реально пишутся; `projectId` в risks-вызове (Launch Gate §18 п.11–12) [eng].
* Approval привязан к ревизии паспорта / версии КП (BUG-09); FK/проверка ревизии в facts [eng].
* S1 — по итогам WTP [owner]; S2 — прогон эталонных противоречий на живом провайдере [owner+eng];
  S3 — статусы declined/changes по версии КП (BUG-10); S4 — уведомление дизайнеру о брифе [eng].
* i18n: вынести ~160 строк в `ru.ts` [eng].
* **Решения владельца:** SMTP для верификации (гейт Входа Б); судьба Входа Б (Q3).

## Фаза 3 — AP6: внешний реальный пакет через M2→M3→M4

**Входной гейт:** Фаза 2 + решение Q1 (DEC-026) и Q5 (cycle7). **Объём:** 6–12 РС.

* Ташкент: baseline → release → distribution → M4 через те же authenticated-контракты;
  происхождение исходников подтверждено [owner — исходники, eng — прогон].
* Повторное ревью executor-скриптов (runner вырос втрое после 24.08).
* DEC-027 conflict review — построить (после DEC-026).
* Hardening-backlog'и M3/M4 — предпилотные обязательства.
* **DoD:** cycle7 зелёный на runtime-прогоне, не на манифесте; внешний M4 PASS.

## Фаза 4 — AP7 + production adoption

**Входной гейт:** Фаза 3. **Объём:** 6–10 РС + время владельца.

* **Решения владельца:** DEC-040 (production); доступ к production Supabase; выбор wedge по AP7
  (два оплаченных сценария); креды TG4; решения TG2–TG3.
* Adoption production: перенос линии `projectceo_*` на `ztnycrchwxqczqbyegnp` по WP-13
  (clone-only rehearsal → adoption) [destructive]; учесть миграции с `--include-all` (DOC-12).
* Включение V1 Impact по обновлённому `M4_V1_PRODUCTION_RUNBOOK.md` с журналом [destructive].
* Юрблок Launch Gate §18 п.7, аналитика п.9, себестоимость п.12.

## Что НЕ входит в запуск

* V2/V3 M4 в production (DEC-039 — только disposable); `build_handover`, `define_milestone`,
  `register_handover_document` — до M4 IMPLEMENTATION GO.
* R1 в production — до записи DEC по Q1.
* Каталог дизайнеров, матчинг, ленты пула, кредиты/карма как код (guardrails Входа Б).
* ERP/склад, US-runtime, биллинг/тарифы, мультивалютность.
* Включение CI/Vercel/флагов этим планом — только решениями владельца по шагам.
