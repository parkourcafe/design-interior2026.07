# RemHaOS — план запуска четырёх модулей

**Дата:** 23.08.2026. **Основание:** REMHAOS_FINAL_AUDIT_2026-08-23.md
(аудит по `main` = `3bde317`; PR #97 открыт, CI аккаунта нестабилен).
**Правила плана:** фазы строго последовательны; внутри фазы — параллелизм
по stream'ам A (Data/Auth/API) / B (workspaces/UI) / C (QA/Security/evidence)
из MASTER_EXECUTION_PLAN §5. Ничего из раздела «что НЕ входит» не начинается
ни при каком отставании по срокам. Оценки — в рабочих сессиях (РС),
диапазон P50–P90.

---

## Фаза 0 — закрыть хвосты аудита

**Входной гейт:** восстановленный GitHub Actions (CI на PR зелёный, логи
доступны). Без него фаза не стартует — все доказательства ниже опираются на
обязательный CI.

| # | Работа | Stream | Оценка |
|---|---|---|---|
| 0.1 | Ремонт Actions аккаунта (джобы падали за 2–3 с, runner_id:0, логи 404 с 17.08) | владелец+интегратор | внешняя зависимость |
| 0.2 | Слить PR #97 (docs-only governance: источники истины v0.5, правило старшинства, строки M2/M3 матриц, README канона); перед слиянием — полный гейт на финальном SHA | интегратор | 1 РС |
| 0.3 | BUG-01: ключ идемпотентности в run-concurrency.zsh → единый шаблон с версией политики | A | 1 РС |
| 0.4 | BUG-02: маппинг 23505 → idempotency_conflict (или P1110 из SQL по имени индекса) + тест проигравшего в supersede-гонке | A | 2 РС |
| 0.5 | BUG-03: TTL подписей вложений 3600→≤900 c | B | 0.5 РС |
| 0.6 | BUG-04: единый источник capabilities для UI и сервера (= пункт 6 M4-backlog), убрать обещания builder/client, которых нет в БД | B | 2 РС |
| 0.7 | Документные правки: BUG-09 (runbook :68 две двери), BUG-10 (ci.yml комментарий), BUG-11 (90_default_deny_after.sql :105), DOC-01…DOC-05 (строки платформы в матрице, счётчики) | C | 1 РС |
| 0.8 | BUG-06/07/08: удалить мёртвый acknowledgeImpactTruncation-контур, выровнять типы под фактические поля SQL | A | 1 РС |
| 0.9 | BUG-12: regex на recovery-подсказку в AP5 звене 15 | C | 0.5 РС |

**DoD фазы:** #97 смержен после полного зелёного гейта (lint/typecheck/test/
build + DB4/DB5 PG16+PG17 + cycle7 informational); реестр багов аудита без
открытых major; `git status` чист.

**Решения владельца:** нет блокирующих; достаточно подтвердить план.

---

## Фаза 1 — Authenticated Pilot (AP1–AP5)

**Входной гейт:** Фаза 0 закрыта; disposable Supabase-проект создан и доступен
исполнителям; SMTP test delivery настроен.

Что осталось до снятия **PLATFORM_FOUNDATION = BLOCKED**
(по реконсиляции 01.08 + аудиту):

1. запись владельца о снятии BLOCKED (само решение — Фаза 1 DoD, текст
   готовится интегратором);
2. hosted-часть AP1: Auth redirect allowlist, SMTP, Storage buckets,
   безопасные env-секреты окружения — только владелец/оператор;
3. сверка migration ledger стенда с ledger репозитория (54/54) на фактическом
   disposable-проекте;
4. подтверждение, что blocker `92060e3` (SECURITY DEFINER auth.uid() от
   pi_table_owner) воспроизводится/не воспроизводится на managed Supabase
   текущего тарифа — прогон DB4 на стенде;
5. provision пяти пользователей (`npm run provision:ap1-users`) и прогон
   полной цепочки AP5 звеньями 1–15 отдельными ролевыми сессиями.

| # | Работа | Stream | Оценка |
|---|---|---|---|
| 1.1 | Disposable-стенд: миграции, exposure схем, env-секреты | A + владелец | 3 РС |
| 1.2 | Прогон AP5 (звенья 1–15) на стенде, фиксация прогона | C | 2 РС |
| 1.3 | Решение зафиксированных исключений AP5: photo/milestone V2 и area-selection остаются за пределами (V2 закрыт; area создаёт ingest) — записать как осознанные пропуски, не как долги | C | 0.5 РС |
| 1.4 | Запись владельца «PLATFORM_FOUNDATION = ACTIVE_FOR_DISPOSABLE_PILOT» | владелец | 0.5 РС |

**DoD фазы:** полная цепочка Kora без ручной записи в базу на disposable
Supabase; пять отдельных role sessions; PRODUCTION_READY остаётся false.
**Решения владельца:** создание/доступ к disposable Supabase; SMTP; при
желании — креды TG4 для параллельного снятия TG2/TG3 (см. Фазу 4).

---

## Фаза 2 — Платформенный P0 под M1 + доведение M1 до «Расширения»

**Входной гейт:** Фаза 1 закрыта, PLATFORM_FOUNDATION снят записью.

Платформа (сегодня NOT_BUILT, аудит §2): `project_facts`/provenance ledger;
`ai_calls` (DEC-009 обязателен с Sprint 1); Action/Skill Registry;
переиспользуемый Approval Requests gate (обобщить M2 approval_packages);
Workflow Catalog persistence поверх существующего application service.

M1 до лестницы S1–S4 (целевой P0 из плана §6): immutable Contracted Project
Passport (сейчас `passport jsonb` перезаписывается — submit/route.ts:46-48);
версии КП (сейчас жёстко `.eq("version",1)`); upload/status внешнего договора;
защищённый brief поверх токена (auth-gate для клиентской стороны).

| # | Работа | Stream | Оценка |
|---|---|---|---|
| 2.1 | project_facts + provenance (миграция, read-контракты, тесты) | A | 8–14 РС |
| 2.2 | ai_calls таблица + обвязка LLM-вызовов | A | 4–6 РС |
| 2.3 | Action/Skill Registry + Approval Requests gate | A | 6–10 РС |
| 2.4 | Immutable Passport + версии КП + договор upload/status | A+B | 8–12 РС |
| 2.5 | Negative tenancy/RLS тесты на новые таблицы, DB4-наборы | C | 3–5 РС |
| 2.6 | S1–S4 критерии лестницы фиксируются документом с измеримыми гейтами (сейчас S1–S4 существуют только как DOC_TARGET) | C | 1 РС |

**DoD фазы:** платформенные строки матрицы переводятся из NOT_STARTED в
CODE_PRESENT с тестами; immutable Passport доказан тестом неизменяемости;
полный гейт зелёный.
**Решения владельца:** модель хранения паспорта/файлов M1 согласуется с
решением по DEC-026 §1.6 (один вопрос — одно решение); провайдер SMTP
production-класса остаётся за Фазой 4.

---

## Фаза 3 — AP6 внешний реальный пакет через M2→M3 + hardening-backlog'и

**Входной гейт:** Фаза 2 закрыта; найден реальный внешний пакет покупателя.

AP6 закрывает цикл 7 и удержанные 17 баллов M2 (15 — внешний пакет, −2 —
непрочитанные executor-скрипты: их чтение входит в 3.5).

| # | Работа | Stream | Оценка |
|---|---|---|---|
| 3.1 | Реализация DEC-026 (после решения владельца): хранение байтов, карантин/AV, серверная SHA-256, лимит 100 МБ, retention | A | 10–16 РС |
| 3.2 | Реализация DEC-027: серверное определение конфликта, блокировка публикации именно в A′-пути (DOC-08), capability разрешения, append-only разбор | A | 8–12 РС |
| 3.3 | M3 hardening backlog №№2,4,5,6,7,8 (все открыты): п.5 активируется воркерным `ingest_source_graph`, п.6/7 — SQL-дверь одной транзакцией + 4 теста семантики, п.8 — грантная полнота orchestration-двери | A | 10–15 РС |
| 3.4 | M4 hardening backlog №№2–6: сведение двух дверей выдачи, авторитетный DB-state включения модуля, возврат тестов приёмки вехи, предложение публикации при устаревшей ревизии, общий источник ролей (=BUG-04) | A+B | 6–10 РС |
| 3.5 | Чтение executor-скриптов M2 pilot-evidence (закрытие −2 балла) + прогон внешнего пакета через contracts с фиксацией import gaps | C | 4–6 РС + время партнёра |
| 3.6 | Снятие red-цикла 7: manifest внешнего пакета → `test:cycle7` зелёный → гейт остаётся обязательным | C | 1 РС |

**DoD фазы:** один внешний реальный пакет прошёл M2→M3→baseline без ручной
записи; цикл 7 закрыт; backlog'и M3/M4 без открытых пунктов, помеченных
«обязателен до production-пилота».
**Решения владельца:** DEC-026 §1.6 (бизнес-модель хранения) — без него 3.1
не начинается; авторитетный DB-state включения M3/M4 (единое решение на оба
модуля); доступ к реальному пакету покупателя.

---

## Фаза 4 — AP7 + production adoption

**Входной гейт:** Фаза 3 закрыта; выбран wedge; есть доступ к производственному
Supabase `ztnycrchwxqczqbyegnp`.

| # | Работа | Stream | Оценка |
|---|---|---|---|
| 4.1 | AP7: два оплаченных concierge/pilot-сценария по выбранному wedge + второй проект той же компании + измеримый downstream result | бизнес+C | 2–4 недели календарно |
| 4.2 | Production boundary по плану §8: snapshot schema/grants/policies/ledger, backup/restore rehearsal, clone и review истории миграций, 152-ФЗ data-plane решение, Auth/SMTP/rate-limit, monitoring+kill switch+rollback commander, adoption checklist, человеческий GO | A+C+владелец | 10–16 РС |
| 4.3 | Включение V1 Impact строго по M4_V1_PRODUCTION_RUNBOOK.md (после BUG-09): предпосылки §4 решения DEC-033 сняты в Фазах 1–3; вызов open_v1_impact_production(actor,basis) с записью в журнал | оператор+владелец | 1 РС |
| 4.4 | Telegram: TG2 (вложения в channel_attachments, migrate_to_chat_id, HTTP-boundary пруф, sender/projector против живой границы) → TG3 AP5-вертикаль → TG4 снимается кредами; production моста — отдельный OWNER GO после legal/data-plane/consent/retention gate | A+C | 8–12 РС |
| 4.5 | Легаци-поверхности (BUG-05): миграция dashboard/intake/join/pilot на request-bound клиентов либо документированный риск-приём | B | 4–8 РС |

**DoD фазы:** два оплаченных сценария; V1 Impact включён управляемо и
журналировано; решение по TG2–TG4 принято и зафиксировано; production
adoption — отдельным контролируемым решением владельца.
**Решения владельца:** вход V1 в production (расширение GO или операционный
порядок прямого заведения проектов); доступ к производственной базе; выбор
wedge AP7; OWNER GO на Telegram production; финальный human GO.

---

## Что НЕ входит в запуск

Абсолютные guardrails репозитория — не пересматриваются этим планом:

* V2 Field Evidence и V3 Handover — до отдельного **M4 IMPLEMENTATION GO**
  (команды недостижимы в приложении и отозваны в базе, двойная граница);
* расширенный платный M4 (WBS, schedule, split estimate, procurement,
  Change Order) — до wedge validation;
* ERP, бухгалтерия, склад, payroll, marketplace, универсальный task/calendar;
* US/multi-region runtime и отдельная американская кодовая база;
* паритет с CAD/BIM, DWG-запись, IFC/RVT; импорт DWG сверх серверной подложки
  по A4 §3; облачная конвертация третьих сторон (152-ФЗ);
* собственная юридически значимая ЭП без провайдера и legal review;
* широкий AI Model Router, безлимитный AI, credits billing до provider
  benchmark / unit economics / privacy gate;
* внутренний мессенджер; массовый приём переписки третьих лиц в Telegram до
  production OWNER GO моста;
* переписывание подписанных документов и переименование `projectceo_*`
  контрактов без отдельного ADR.

## Сводка решений владельца по фазам

| Фаза | Решение |
|---|---|
| 0 | — (подтвердить план) |
| 1 | disposable Supabase + доступ; SMTP test; (опционально) TG4-креды staging |
| 2 | модель хранения паспортов/файлов M1 (совместно с DEC-026 §1.6) |
| 3 | ратификация DEC-026; авторитетный DB-state включения M3/M4; внешний пакет |
| 4 | доступ к производственному Supabase; порядок входа V1; wedge AP7; OWNER GO Telegram; финальный production GO |

## Порядок PR

Фаза 0: PR(#97 merge) → PR(fix BUG-01/02) → PR(BUG-03..06..08) →
PR(docs BUG-09..11, DOC-01..05). Фаза 1: PR(provision/ap1 стенд-скрипты) →
PR(AP5 evidence). Фаза 2: по одному PR на платформенную единицу
(project_facts → ai_calls → registry/approvals → M1 passport/versions/
contract) + PR(DB4 наборы). Фаза 3: PR(DEC-026 files) → PR(DEC-027 conflicts)
→ PR(M3 backlog пачками по 2 пункта) → PR(M4 backlog) → PR(cycle7 manifest).
Каждый PR проходит полный гейт; миграции только additive; ничего не
переписывает принятые timestamped миграции.
