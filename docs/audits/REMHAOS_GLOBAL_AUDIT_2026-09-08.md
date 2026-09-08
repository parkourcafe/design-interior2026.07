# RemHaOS — глобальный аудит продукта и инфраструктуры (08.09.2026)

**Снимок:** `main` = `cfe1caa` (30.08.2026, merge PR #121). Рабочее дерево чистое.
**Предшественники:** `REMHAOS_FINAL_AUDIT_2026-08-23.md` (по `3bde317`),
`REMHAOS_AUTONOMOUS_STAGING_ACCEPTANCE_2026-08-29.md`. Этот документ не переписывает их, а
фиксирует состояние на 08.09 и расхождения с ними.
**Парный документ:** `REMHAOS_COMPLETION_ROADMAP_2026-09-08.md` (план до «100 %» и запуск),
`REMHAOS_INFRA_INVENTORY_2026-09-08.csv` (инвентарь ресурсов с вердиктами).

**Метод.** Прочитаны `AGENTS.md`, канонический пакет `docs/canonical/remhaos-v1/`, `MASTER_EXECUTION_PLAN.md`,
план запуска 23.08, adoption checklist, миграции, командный контракт и матрицы поверхностей, флаги,
CI-workflows. Вживую (только чтение) через управляющие API: Supabase (проекты, таблицы, миграции,
security advisors, ветки, edge-функции), Railway (проекты, сервисы, конфигурация, деплои, метрики),
GitHub (PR, ветки, прогоны Actions, задания). Секреты нигде не читались и не воспроизводятся.

**Границы.** Сайт `remhaos.com` из среды аудита недоступен (сетевая политика): какой коммит задеплоен
в production на Vercel — неизвестно. Второй аккаунт Supabase, репозитории `Selena-AI-projects/design2026ru`
и `parkourcafe/hermes-telegram-bridge`, настройки Auth/SMTP production, биллинг Vercel/GitHub/Firecrawl —
вне доступа сессии; помечены как «проверяет владелец».

Маркировка: [ИЗВЛЕЧЕНО] — факт из кода/API; [ИНТЕРПРЕТИРОВАНО] — вывод аудитора.

---

## 1. Резюме: десять главных находок

1. **GitHub Actions заблокирован с 31.08 15:50 UTC** [ИЗВЛЕЧЕНО]. Прогоны CI по PR #124 в 15:37 прошли
   успешно за ~5 минут (run 566/567), а с 15:52 все прогоны (571–574) и Claude Code Review (run 33)
   падают за 2–33 с на уровне job без единого шага; логи заданий отдают 404. PR #124 прямо называет
   причину: «failed recent account payments or an insufficient spending limit». Тот же режим отказа
   уже был 17.08 (план 23.08, п.0.1). Ни один гейт репозитория сейчас не исполняется.
2. **Vercel блокирует деплои** [ИЗВЛЕЧЕНО]: единственный статус на HEAD PR #124 — «Vercel: Deployment
   was blocked» (команда `yulaboober`, проект `design-interior2026-07`). Живой коммит production
   неизвестен [ИНТЕРПРЕТИРОВАНО: до его определения legacy-RPC production трогать нельзя].
3. **Production Supabase живёт на другой линии миграций, чем репозиторий** [ИЗВЛЕЧЕНО]. В проекте
   `ztnycrchwxqczqbyegnp` («remhaos.com», ap-northeast-1) применено 23 миграции: legacy `0007–0009`,
   июльский «M1 governed runtime» в схеме `public` (`workflow_definitions/runs/step_runs`,
   `approval_requests`, `audit_events`, `ai_calls`, `project_facts`, `project_sources`,
   `proposal_revisions`, `project_overrides`, `studio_standards`) и десять миграций `market_harvest`.
   **Ни одна из 90 миграций репозитория (`projectceo_*`) в production не применена.** Это ровно
   состояние, для которого принят путь historical incremental (`AP1_MIGRATION_PATH_DECISION_2026-08-01.md`),
   и reconciliation PR по-прежнему не существует.
4. **В production-базе продукта живёт посторонняя схема `market_harvest`** [ИЗВЛЕЧЕНО]: 3 633 компании,
   6 358 контактов, 5 811 страниц, 23 801 запись расхода кредитов, 17 683 записи поиска. Пишет её
   Railway-сервис `remhaos-market-harvest/collector` (создан 19.08, в тот же день — первые миграции
   схемы), запускаемый с volume `/data/remhaos-control/worker-guard.mjs`, с переменными `FIRECRAWL_*`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Кода этого сервиса нет ни в одном репозитории сессии;
   ни одного упоминания `market_harvest`/`firecrawl` в репо продукта. Сейчас сервис простаивает
   (CPU ≈ 0, память 128 МБ). [ИНТЕРПРЕТИРОВАНО: service_role production выдан внешнему процессу вне
   периметра продукта; чужие ПДн (контакты) хранятся в продуктовой базе — риск по 152-ФЗ и смешение
   периметров.]
5. **Supabase Branching на production сломан** [ИЗВЛЕЧЕНО]: production-ветка привязана к git-ветке
   `claude/new-session-gsayp3` (PR #33), которой в репозитории больше нет, статус `MIGRATIONS_FAILED`
   (обновлено 10.08). Две preview-ветки: `remhaos-unified-staging-phase1-20260828` — **ACTIVE_HEALTHY**
   (платная, `MIGRATIONS_FAILED`) и `archidom-sprint1-pilot` (27.07, inactive).
   [ИНТЕРПРЕТИРОВАНО: перепривязка интеграции к `main` без reconciliation опасна — интеграция попытается
   применить 90 миграций поверх чужой линии.]
6. **Одноразовый стенд `ukkzasfsmannjprfkaxp`** (приёмка 29.08 пройдена, PR #121 влит) остаётся активным
   и жёстко зашит в `.github/workflows/ci.yml:450` (`EXPECTED_STAGING_REF`) и
   `tests/ap1/environment/ci-secret-log.contract.test.ts:93` [ИЗВЛЕЧЕНО].
7. **Ещё два одноразовых проекта из документов не видны текущему аккаунту** [ИЗВЛЕЧЕНО]:
   `uafvzxdxlxqkpsejgskt` (`remhaos-ap1-disposable`, пауза 02.08, `AP1_RUNBOOK.md:29,164,573,658`) и
   `qoyemgoskhuqdexlejhp` (`remhaos-ap1-pilot`, орг `huqbxcmbidfqverftqrk`, платный,
   `docs/audits/REMHAOS_AP1_PILOT_EVIDENCE_2026-08-24.md:3-4,20`). Аудит 12.08
   (`REMHAOS_M4_V1_PRODUCTION_READINESS_AUDIT_2026-08-12.md:29`) видел из-под аккаунта сессии три
   посторонних проекта (`bali-privilege`, `mydoki`, личный проект владельца), которых сейчас тоже нет.
   [ИНТЕРПРЕТИРОВАНО: задействованы минимум два аккаунта Supabase; «невидимые» платные проекты могут
   продолжать списывать.]
8. **Security advisors production** [ИЗВЛЕЧЕНО]: 13 таблиц с RLS без политик (12 `market_harvest` +
   `public.rate_limits`); 11 SECURITY DEFINER RPC legacy-runtime вызываемы ролью `authenticated`
   (`adopt_legacy_m1_workflow`, `approve_project_override`, `authorize_proposal_revision`,
   `complete_m1_human_review`, `get_or_create_m1_proposal_draft`, `issue_proposal_revision`,
   `persist_m1_proposal_draft_steps`, `reserve_m1_risk_rerun`, `reserve_m1_risk_retry`,
   `review_project_fact`, `save_and_persist_m1_proposal_draft`); защита от утёкших паролей выключена.
   Ошибок уровня ERROR нет. Стенд: 6 функций с mutable `search_path`, `is_studio_member` вызываема `anon`.
9. **Открытые PR** [ИЗВЛЕЧЕНО]: #122 добавляет миграцию `20260829072313_…` с теми же политиками
   `contract_documents_owner_select/insert/update`, что уже в `main` через #121
   (`20260829074543_secure_m1_passport_and_contract_rls.sql:121-148`) — при слиянии clean-bootstrap
   упадёт на дубле политик; #123 (только `ci.yml`, убирает дублирующие push-прогоны) — зелёный;
   #124 (первый мост M1 → ProjectCEO) — CI на финальном HEAD не исполнялся. В репозитории 84 ветки,
   включая лишнюю `Main` рядом с `main`.
10. **Личные данные оператора ПДн захардкожены** [ИЗВЛЕЧЕНО]: `.env.example` и `lib/env.ts:16,30-33`
    содержат реальные ФИО, адрес, телефон и почту как значения по умолчанию (репозиторий приватный,
    но комментарий в том же файле утверждает обратное).

---

## 2. Модули

Правило старшинства (`AGENTS.md:18-28`): журнал решений старше повествования. Ниже отделено
«подписано» от «построено» и «доказано».

### 2.1 M1 · Заказчик

- **P0 (a).** Charter §4/§15/§18 (`docs/canonical/remhaos-v1/REMHAOS_CHARTER_v0.5_CANONICAL.md:84-89,386-401`):
  единственный обязательный полный модуль ближайшего запуска; brief → passport → risks → scope →
  proposal; ProjectCheck; Evidence; approval; immutable Contracted Project Passport (MEP §6,
  `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md:230-234`).
- **Построено и доказано (b).** Legacy-контур (`lib/brief/*`, `lib/risks/*`, `lib/pricing/calc.ts`,
  `lib/proposal/build.ts`, маршруты `app/dashboard/**`, `app/i/[token]`, `app/p/[public_token]`,
  `app/b/[token]`); B-блок Фазы 2 — `supabase/migrations/20260824170000_projectceo_m1_passport_versions_contract.sql`
  (immutable `project_passport_revisions`, версии КП, `contract_documents`, `intake_expires_at`, PR #113);
  RLS этих таблиц — `20260829074543` + `tests/db4/56_m1_rls_security.sql`; hosted advisor 29.08:
  `errors=0 rls_disabled=0`; маскирование PII до LLM — `lib/risks/llm.ts`.
- **Разрешено, не построено (c).** M1 отсутствует в командной шине: `PlatformModule = "access"|"m2"|"m3"|"m4"|"platform"`
  (`lib/project-intelligence/platform/action-registry.ts:17-22`), 33 команды контракта — ни одной M1;
  PR #124 — первый мост (4 команды, вкладка Passport, миграция `20260831170000`). `sendProposal`
  (`app/dashboard/projects/[id]/proposal/actions.ts:117-140`) не требует platform approval.
  Legacy-поверхности на service_role (BUG-05): `app/dashboard/projects/[id]/page.tsx`,
  `app/join/[token]/actions.ts`, `app/api/pilot/route.ts`, `lib/intake.ts`. S1–S4 — только черновик
  `docs/product-intelligence/M1_EXPANSION_LADDER_DRAFT.md`. Из старой лестницы `CLAUDE.md`: S3
  (завершение сделки в публичном КП) и S4 (петля обратной связи) не построены.
  Статус багов аудита 23.08 на `main` [ИЗВЛЕЧЕНО]: BUG-01 закрыт (`tests/db5/run-concurrency.zsh:139`),
  BUG-02 закрыт (`lib/project-intelligence/workers/change-impact/runner.ts:216`), BUG-03 закрыт
  (TTL 900, `app/dashboard/projects/[id]/page.tsx:238`); BUG-04/05/06/07/08 открыты.
- **Не разрешено (d).** Вход Б / маркетплейс (`CLAUDE.md` guardrails, `BACKLOG.md`); собственная ЭП;
  биллинг, мультивалютность, ML-pricing, анализ планов, PDF-библиотеки; Anthropic/OpenAI в runtime
  (runtime — `zai`/GLM как задокументированное отступление, `HANDOFF.md:17`).
- **Гейты (e).** S1–S4 не подписаны; Launch Gate §18 п.7 (юрблок, self-service удаление аккаунта —
  `PREFLIGHT_APP_STORE_AUDIT.md`), п.12 (себестоимость прохода — измерима после `ai_calls` в production);
  SMTP production-класса не настроен.

### 2.2 M2 · Дизайнер

- **P0 (a).** DEC-021 / Addendum A4 (`REMHAOS_ADDENDUM_A4_CAD_SCOPE.md`), ADR-0006; редактор явно разрешён
  (2D-план, 3D-просмотр, размерные цепи, DXF-экспорт, DWG-подложка серверно).
- **(b).** Decisions/Selections/Approvals, три варианта, immutable Approved Commit, RUB-бюджет, exact-version
  handoff `publish_m2_m3_handoff` (миграции `20260802010000`–`20260802090000`,
  `MODULE_2_READINESS_REPORT_2026-08-02.md`); канонизация подписи заморожена (DEC-022, ADR-001,
  `canonical-signature.test.ts:26-27`); Layout Studio за флагом `ARCHIDOM_LAYOUT_STUDIO_ENABLED`
  (`lib/layout-studio/feature-flag.ts`); executor-скрипты прочитаны, D1/D2 исправлены
  (`docs/product-intelligence/M2_EXECUTOR_SCRIPTS_REVIEW_STREAM3_2026-08-24.md`). Оценка владельца 83/100
  (`docs/product-intelligence/M2_CLOSEOUT_2026-08-08.md`).
- **(c).** Внешний реальный пакет (AP6): пакет Ташкент подготовлен
  (`docs/product-intelligence/wave-3/pilot/TASHKENT_AP6_PACKAGE_2026-08-27.md`, манифест
  `tests/fixtures/cycle7/external-package.manifest.json`, `status: "pending"`) — прогон не выполнен;
  `.tdd-state.json`: слайс M2-070 `in_progress`/`red`. Нет m2-surface матрицы (в отличие от M3/M4);
  клиентский handoff UX; мобильный QA пяти форм.
- **(d).** Паритет с CAD/BIM, запись DWG, IFC/RVT; WebAssembly-разбор DWG; облачная конвертация третьей
  стороной; слово «CAD» наружу (DEC-023); широкий AI Router / credits billing.
- **(e).** Цикл 7: `npm run test:cycle7` красный намеренно (`vitest.cycle7.config.ts`,
  `tests/pilot-evidence/m2-pilot-external-manifest.gate.test.ts`); синтетика запрещена кодом
  (`CYCLE7_EXTERNAL_SYNTHETIC_FORBIDDEN`, `CYCLE7_KORA_CLONE_FORBIDDEN`); в CI job
  `cycle 7 evidence (informational)` мерж не блокирует (`.github/workflows/ci.yml:780-798`).

### 2.3 M3 · Архитектор

- **P0 (a).** DEC-024 / Addendum A5: intake PDF/JPG/PNG/CSV/XLSX, связи room/sheet/specification, ревизии,
  completeness/conflict review, baseline, immutable Released Production Package; вход только через
  persisted handoff; DEC-028 — отдельного маршрута нет (вкладки `documentation/baseline/releases`,
  `lib/project-intelligence/delivery/projectceo/documentation-flag.ts:10-13`).
- **(b).** Sheets + ревизии + baseline + append-only пакеты (`20260810010000`, guardrail `20260811010000`);
  Фаза 3a (24.08): авторитетный DB-state включения модулей (`20260825010000`,
  `tests/db4/49_platform_module_switch.sql`), read-only проекция released archive (`20260825020000`),
  атомарная дверь `publish_baseline_atomic` (`20260825030000`, `tests/db4/51_publish_baseline_door.sql`),
  воркер `ingest_source_graph` (`20260825040000`, `tests/db4/52_source_ingest_worker.sql`), read-gate
  (`20260825050000`, `tests/db4/53_m3_read_gate.sql`). Матрица поверхности —
  `lib/project-intelligence/delivery/projectceo/m3-surface.ts`: 5 из 6 команд `revoked_from_authenticated`,
  `register_source` — `app_gate_only` (`m3-surface.ts:76-79`).
- **(c).** DEC-027 (LOCKED) не реализован: `semanticConflict` — булев вход клиента
  (`lib/project-intelligence/delivery/projectceo/command-contract.ts:575`), блокировка живёт в устаревшей
  ветке `orchestration.ts:356-365`, не в A′-пути. Backlog №8 (`docs/product-intelligence/M3_PRODUCTION_HARDENING_BACKLOG.md`).
- **(d).** **DEC-026 PROPOSED, не LOCKED** (`REMHAOS_OWNER_DECISION_M3_P0_FILES_AND_CONFLICTS_2026-08-11.md:5-8`):
  приём байтов файлов, AV, серверная SHA-256, лимит 100 МБ, retention — не авторизованы; контрольная сумма
  сейчас приходит от клиента (`command-service.ts:398`). Native CAD/BIM authoring; генерация листов —
  пост-P0.
- **(e).** Ратификация DEC-026 §1.6 блокирует весь этап 3b; выбор AV-сервиса; DEC-027 после DEC-026;
  внешний пакет через M2→M3; модуль выключен (`REMHAOS_DOCUMENTATION_ENABLED=false`).

### 2.4 M4 · ГлавПрораб

- **P0 (a).** DEC-025 / A6 — только инкремент 1 (`distribute_release`, `acknowledge_release`,
  `create_change`) + `review_change_impact` (DEC-033); DEC-032 — целевой контракт десять команд;
  DEC-030 — Release Artifact Worker; DEC-039 — V2/V3 только disposable за `REMHAOS_M4_V2_V3_ENABLED`.
- **(b).** Инкремент 1 обеими границами (`M4_BROWSER_PROVEN`, AP5 прогон 195; revoke `20260810070000`,
  `20260811020000`); Release Artifact Worker (`M4_RELEASE_WORKER_PROVEN`); E0R (`tests/db5/`, CI PG16/17);
  V1 Impact целиком — DEC-033…037 (`20260813010000/020000/030000`, `20260817010000`;
  `tests/db5/26,28,29,31,32*.sql`; `tests/db4/run-impact-upgrade.zsh`); production-выключатель с
  журналом и ровно двумя дверями (`20260812030000`, `tests/db5/28_v1_production_switch.sql`) —
  построен, **не включён**; hosted AP5 29.08: 27/0/0 по шести ролям. Матрица —
  `lib/project-intelligence/delivery/projectceo/m4-surface.ts` (8 команд; `acknowledge_impact_truncation`
  и `build_handover` — `increment_not_authorized`).
- **(c).** Backlog `docs/product-intelligence/M4_PRODUCTION_HARDENING_BACKLOG.md`: №2 (физическое удаление
  выведенных сигнатур), №4, №5 (TS-половина `approvalSupersededEntities`), №6 (роли списком в
  `command-service.ts:1070` = BUG-04). Мёртвый контур `acknowledgeImpactTruncation`
  (`adapters/postgres/execution.ts:442-463,53-56`, `live-read-port.ts:1049-1052`). Команды
  `define_milestone`, `register_handover_document`, `build_handover` в контракте приложения отсутствуют.
  HTTP-маршрута enroll для входа вертикали нет (`app/api/projectceo/`).
- **(d).** V2 Field Evidence и V3 Handover в production — NOT AUTHORIZED до M4 IMPLEMENTATION GO;
  `acknowledge_impact_truncation` закрыта навсегда (DEC-034); сырая `calculate_change_impact` закрыта
  даже для `service_role`; расширенный платный M4 — после wedge validation; ERP/склад/бухгалтерия.
- **(e).** Три предпосылки DEC-033 §4: `PLATFORM_FOUNDATION` снят только для disposable (DEC-038);
  вход вертикали в production недостижим; доступа к production-базе у исполнителей нет.

### 2.5 Сквозные гейты (на 08.09)

| Гейт | Состояние | Источник |
|---|---|---|
| PLATFORM_FOUNDATION | `ACTIVE_FOR_DISPOSABLE_PILOT` (DEC-038); production-половина BLOCKED — reconciliation PR не существует | `REMHAOS_OWNER_DECISION_PLATFORM_FOUNDATION_2026-08-24.md`, `AP1_MIGRATION_PATH_DECISION_2026-08-01.md` |
| Платформенный P0 | построен 24–25.08 (`project_facts`, `ai_calls`, approval requests, workflow templates) — вопреки аудиту 23.08 | миграции `20260824130000…160000` |
| Authenticated Pilot Gate AP1–AP5 | закрыт на disposable: 24.08 (54 миграции) и 29.08 (90 миграций, AP5 27/0/0, advisor errors=0); AP5 — обязательный job CI | `docs/audits/REMHAOS_AP1_PILOT_EVIDENCE_2026-08-24.md`, `…STAGING_ACCEPTANCE_2026-08-29.md` |
| Цикл 7 / AP6 | красный; пакет Ташкент `pending` | `tests/fixtures/cycle7/external-package.manifest.json` |
| Kora end-to-end | локально PASS (`487e993`); hosted звенья 1–15 PASS | `docs/product-intelligence/wave-3/pilot/*` |
| Production adoption checklist | пуст полностью (13 разделов, ни одной подписи); `PRODUCTION_READY=false` | `docs/product-intelligence/wave-3/production-adoption/ADOPTION_CHECKLIST.md` |
| Backup/restore rehearsal | не выполнялся | там же, §4 |
| SMTP / Auth / Storage | SMTP не настроен (Resend отложен); hook `20260824120000` читает `email_verified` из `auth.users` (FIND-01); TTL подписей ядра ≤900 | `LAUNCH_CHECKLIST.md`, `HANDOFF.md` |
| Monitoring / kill switch | не настроены | checklist §12 |
| 152-ФЗ / data plane | открытый owner gate №7 Charter §19; данные в Tokyo + Vercel | `REMHAOS_CHARTER_v0.5_CANONICAL.md:288-301,411` |
| Telegram bridge | TG0/TG1 PASS, TG2/TG3 NOT PROVEN, TG4 BLOCKED_EXTERNAL_CREDENTIALS; production — отдельный OWNER GO | `REMHAOS_TELEGRAM_BRIDGE_RUNBOOK.md:22-26,475-485` |
| CI / GitHub Actions | заблокирован с 31.08 (см. §1 п.1) | прогоны 33410947754…33411515327 |
| AP7 коммерческая валидация | не начата; wedge не выбран | `MASTER_EXECUTION_PLAN.md:186-196` |

---

## 3. Код против документов

- **Маршруты.** 60 `page.tsx`, 55 `route.ts`. M1 — legacy `public`-схема вне ProjectCEO; M2 — `app/dashboard/projectceo/projects/[projectId]`
  + Layout Studio; M3/M4 — вкладки того же workspace без своих URL; единая точка мутаций
  `app/api/projectceo/commands/route.ts` (лимит 96 KB, same-origin CSRF). Маршрутов Входа Б
  (`/start`, `/s/`, `/c/`) не существует — только `/b/[token]`. QA-песочница `app/projectceo-qa/[role]`
  в production отдаёт 404. Реальных TODO/заглушек в `app/`/`components/` нет.
- **Флаги** (все `=== "true"`, default закрыто): `ARCHIDOM_LAYOUT_STUDIO_ENABLED`, `REMHAOS_DOCUMENTATION_ENABLED`,
  `REMHAOS_EXECUTION_ENABLED`, `REMHAOS_M4_V2_V3_ENABLED`, `REMHAOS_INTEGRATIONS_ENABLED`,
  `REMHAOS_PROJECT_LINKS_ENABLED`, `REMHAOS_FILE_INTAKE_ENABLED`, `REMHAOS_GOOGLE_DRIVE_ENABLED`,
  `REMHAOS_TELEGRAM_BRIDGE_ENABLED`, `REMHAOS_TELEGRAM_WORKER_ENABLED`; `REMHAOS_SECRET_STORE_ADAPTER=fail_closed`,
  `REMHAOS_WORKER_TRANSPORT=disabled`, `REMHAOS_FILE_SCANNER_ADAPTER=fail_closed`. Порядок гейтов —
  `command-service.ts:295-334`. В `.env.example` отсутствуют: `REMHAOS_M4_V2_V3_ENABLED`,
  `REMHAOS_GOOGLE_DRIVE_REVOKE_ENABLED`, `*_MAX_ROWS`, `AP1_ROTATE_EXISTING_PASSWORD`, `NEXT_DIST_DIR`.
- **База.** 90 SQL-миграций + README (ledger `tests/ap1/environment/migration-ledger.sha256` — 90);
  18 схем; 137 `create table` (`public` — 15, все с RLS); приватные `projectceo_*`/`remhaos_*` не в Data API
  (`supabase/config.toml`, `auto_expose_new_tables=false`); `grant … to anon` — только legacy-ACL
  `20260716071024:495-509` и usage на `projectceo_api`. Edge-функций нет.
- **Воркеры.** `worker:release-artifacts`, `worker:change-impact`, `worker:ingest-source-graph`,
  `bridge:telegram-*`; единственный cron — `.github/workflows/worker-change-impact.yml` (`*/15`, environment
  `production`, выполняется только при `vars.REMHAOS_M4_V1_PRODUCTION_ENABLED == 'true'`; сейчас `skipped` —
  норма).
- **Тесты и CI.** 196 файлов vitest, 85 SQL-сценариев (`tests/db4` 47, `tests/db5` 16, `tests/ap1` 46,
  `tests/ap5` 10 Playwright); CI — 7 джоб (`scope`, `gates`, DB4 и DB5 на PG16/17, `ap5` обязательный,
  `cycle7-evidence` informational, `cycle7-sanitized-receipt`, `hosted-staging` только `workflow_dispatch`).
  `.tdd-state.json`: M2-070 `in_progress`/`red`.
- **Локализация.** `CLAUDE.md` обещает RU/EN/ID; фактически `lib/i18n/ru.ts` (~1 842 ключа) + частичный EN
  только для публичного лендинга (`lib/i18n/public.ts`); отдельных `en.ts`/`id.ts` нет; хардкод русских
  строк вне i18n — `app/dashboard/analytics/page.tsx:53-75`, `app/not-found.tsx:8-16`,
  `app/dashboard/setup/team.tsx:46` и ещё ~30 файлов.
- **Мобильное.** `capacitor.config.ts` — тонкая обёртка над `https://www.remhaos.com/app`; `ios/` — Xcode-проект
  (bundle `space.arhidom.ios`); `android-twa/` — TWA; в `npm run build`/CI не входит.
- **Безопасность (сканирование).** Литеральных секретов нет; `.env`/`.env.local` не закоммичены;
  `createAdminClient()` (`lib/supabase/admin.ts`) импортируется в 14 местах — публичные token-scoped маршруты
  и несколько аутентифицированных страниц (BUG-05); `dangerouslySetInnerHTML` — одно место
  (`components/faq-json-ld.tsx:16`, JSON-LD); `eval` — нет; `proxy.ts` защищает `/dashboard/*`;
  `next.config.mjs` — `noindex` на приватных путях, `nosniff`, `SAMEORIGIN`.

---

## 4. Инфраструктура и аккаунты (вживую, 08.09)

### 4.1 Supabase — организация «Remhaos+ Pet ID» (тариф Pro)

| Проект | Регион | Что это | Состояние |
|---|---|---|---|
| `ztnycrchwxqczqbyegnp` «remhaos.com» | ap-northeast-1 | **production** RemHaOS | 23 таблицы `public` (8 designers, 30 projects, 86 answers, 3 proposals, 56 events, 4 risk_cards); 23 миграции (см. §1 п.3); схема `market_harvest` (12 таблиц); 3 записи branching; advisors — §1 п.8 |
| `ukkzasfsmannjprfkaxp` «remhaos-autonomous-staging-20260829» | ap-southeast-1 | одноразовый стенд | 90 миграций репо, 15 таблиц `public` (5 designers, 1 project); active; хардкод в CI |
| `iztqbgyytgcokfdpmfan` «aether-medium» | eu-central-1 | другой продукт (Elmo/Aether) | не RemHaOS |
| `ljrvadwwqkqocqstvjrf` «Petid.care» | ap-northeast-2 | другой продукт | не RemHaOS |

Ветки production: `claude/new-session-gsayp3` (default, `git_branch` = удалённая ветка, PR #33,
`MIGRATIONS_FAILED`, обновлено 10.08); `remhaos-unified-staging-phase1-20260828`
(`powmsggvacbzqfkqazyv`, `MIGRATIONS_FAILED`, preview **ACTIVE_HEALTHY**); `archidom-sprint1-pilot`
(`udtjczcnemndubsyuqxc`, 27.07, inactive). У стенда веток нет. Edge-функций нет ни в одном проекте.

Документы называют иную организацию для production (`HANDOFF.md:26` — личная орг владельца, проект
`design2026`): орг переименована либо проект перенесён; `HANDOFF.md` устарел.

### 4.2 Railway — workspace «parkourcafe's Projects» (8 проектов)

| Проект | Сервисы | Отношение к RemHaOS |
|---|---|---|
| `remhaos-market-harvest` (19.08) | `collector` (RAILPACK, старт `node /data/remhaos-control/worker-guard.mjs`, healthcheck `/health`, restart ALWAYS, регион sfo, volume `/data`); переменные `FIRECRAWL_API_KEY`, `FIRECRAWL_HTTP_TIMEOUT_MS`, `FIRECRAWL_RESERVE_CREDITS`, `HARVEST_*`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; последний деплой SUCCESS 21.08; CPU ≈ 0 | сборщик лидов, пишет в production-базу продукта |
| `selena-os`, `selena-os-staging`, `selena-ai-visibility`, `OS Selena agent systems` | Elmo / Selena OS | нет |
| `profound-acceptance`, `amusing-creativity` | по одному одинаковому сервису `services-marketing-machine` | нет; дубликаты — кандидаты на чистку отдельно |
| `vivacious-courage` | `@bai/web` | нет |

В репозитории продукта Railway не упоминается ни разу (нет `railway.json`, Dockerfile, nixpacks).

### 4.3 GitHub — `parkourcafe/design-interior2026.07` (private)

- Default branch `main`; 84 ветки (в т.ч. `Main`, `claude/*` ×~35, `codex/*` ×~20, `feat/*`, `docs/*`, `phase*`).
- Workflows: `CI`, `Claude Code Review`, `Claude Code`, `change-impact worker`; всего 1 172 прогона.
- Секреты по именам: `AP1_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (environment `disposable-staging`); `PRODUCTION_SUPABASE_URL`,
  `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` (environment `production`); `CLAUDE_CODE_OAUTH_TOKEN`;
  переменные `REMHAOS_M4_V1_PRODUCTION_ENABLED`, `IMPACT_WORKER_MAX_ROWS`.
- Открытые PR: #122 (29.08, RLS — перекрыт #121), #123 (30.08, CI-триггеры), #124 (31.08, M1 workspace contracts).
- Смежные репозитории вне доступа сессии: `Selena-AI-projects/design2026ru` (push 02.07 — вероятный
  исходный клон продукта; production-проект Supabase назывался `design2026`), `parkourcafe/hermes-telegram-bridge`
  (27.08). Репозиторий `selena-OS` RemHaOS не упоминает.

### 4.4 Хостинг, домены, внешние сервисы

| Ресурс | Факт | Источник |
|---|---|---|
| Vercel `yulaboober/design-interior2026-07` | единственный хостинг; `vercel.json` отсутствует; preview-протекция выключена; деплой заблокирован (31.08) | `HANDOFF_CINEMATIC.md:41-57`, `ARCHITECTURE.md:24`, статус PR #124 |
| `remhaos.com` / `www` | канонический домен (DEC-019) | `.env.example`, `lib/env.ts:4`, `capacitor.config.ts:8` |
| `arhidom.space` | legacy-домен на Vercel; на нём DNS Resend (SPF/DKIM/DMARC), отправитель `noreply@arhidom.space` | `supabase/email-templates/README.md:21,30-32`, `LAUNCH_CHECKLIST.md:1` |
| `arhidom.com` | не привязан | `HANDOFF_CINEMATIC.md:46,176` |
| LLM | `LLM_PROVIDER` yandex\|gigachat\|zai; `.env.example:39` ставит `yandex`, `HANDOFF.md:17` — боевой `zai`/glm-4.6 (расхождение; проверить Vercel env) | `lib/llm/*` |
| Google OAuth (вход, Drive) | ключей в репо нет; Drive `BLOCKED_EXTERNAL_CREDENTIALS` | `app/login/page.tsx:89-90`, `lib/integration-gateway/google-drive/*` |
| Telegram | только тестовый бот (`TELEGRAM_TEST_*`), мост выключен | `lib/integration-gateway/telegram/config.ts` |
| Resend / SMTP | не настроен (ключ вводится в Supabase, env нет) | `LAUNCH_CHECKLIST.md:53`, `HANDOFF.md:50` |
| CDN медиа лендинга | CloudFront (Higgsfield), `NEXT_PUBLIC_MEDIA_BASE` | `components/landing/media.ts:6`, `scripts/fetch-landing-media.mjs` |
| Apple Developer (`KB7VPWHTTM`, `space.arhidom.ios`) | $99/год; релиз NO-GO | `APP_STORE_RELEASE.md`, `PREFLIGHT_APP_STORE_AUDIT.md` |
| Google Play / RuStore | аккаунты не заведены | `STORE_SETUP.md:34`, `RUSTORE_RELEASE.md:75` |
| Firecrawl | ключ в Railway; 23 801 запись расхода кредитов в `market_harvest.credit_ledger` | Railway variables |
| Аналитика, платежи, капча, push, карты, э-подпись | отсутствуют полностью (аналитика — только таблица `events`) | grep по репо |

### 4.5 Оценка лишних расходов [ИНТЕРПРЕТИРОВАНО]

Стенд `ukkzasfsmannjprfkaxp` ~$10/мес; активная preview-ветка ~$10/мес; Railway collector ~$2–5/мес;
возможные одноразовые проекты во втором аккаунте ~$10/мес каждый; Firecrawl — тариф неизвестен;
Apple Developer $99/год. Точные суммы — только из биллинга владельца.

---

## 5. Противоречия между документами

| # | Документ A | Документ B | Кто прав |
|---|---|---|---|
| К-1 | `REMHAOS_FINAL_AUDIT_2026-08-23.md:62` — платформа NOT_BUILT | миграции `20260824130000…160000`, `action-registry.ts` (25.08) | код: построено после аудита |
| К-2 | `M4_V1_PRODUCTION_RUNBOOK.md:11-14`, `REMHAOS_READINESS_MATRIX_v1.csv` — BLOCKED не снят | DEC-038 | DEC-038 (снята половина) |
| К-3 | `…STAGING_ACCEPTANCE_2026-08-29.md:107,136` — «PR #121 remains open» | `git log`: #121 слит (`cfe1caa`) | git |
| К-4 | `REMHAOS_FEATURE_READINESS_MATRIX_2026-08-02.csv:3` — «24-file clean replay» | ledger 90 | ledger |
| К-5 | `M4_V1_PRODUCTION_RUNBOOK.md:68` — три сигнатуры | DEC-034 — две двери | DEC-034 |
| К-6 | DEC-027 §2.5.4 — блокировка на A′-пути | `orchestration.ts:356-365` (устаревшая ветка) | DEC-027 — править код |
| К-7 | DEC-026 PROPOSED — байты файлов не авторизованы | Integration Gateway (26–28.08) построил `file_intakes` с байтами, карантином, checksum | конфликт объёма не зафиксирован ни одним DEC |
| К-8 | `REMHAOS_INTEGRATION_PR0_DECISION_PACKAGE_2026-08-26.md:20-21,61` — «канон отсутствует в checkout» | канон существует с 27.07 | Gateway спроектирован без канона; авторизующего DEC нет |
| К-9 | `components/projectceo/role-policy.ts:50-67` — builder/client capability | `20260802030000:43-51` — таких capability нет | БД (BUG-04, backlog M4 №6) |
| К-10 | `LAUNCH_CHECKLIST.md` — `arhidom.space` | DEC-019 — `remhaos.com` | DEC-019 |
| К-11 | `HANDOFF.md` — «Свод», личная орг Supabase, ветка `claude/new-session-gsayp3` | `AGENTS.md`, живой Supabase, `main` | `AGENTS.md`; HANDOFF устарел |
| К-12 | корневые `MODULE_3_REPORT.md`, `MODULE_2_CONCEPT_PACK_REPORT.md`, `RELEASE_CONTROL.md` — «Модуль N» эпохи M1 | Charter §4 — M2 Дизайнер, M3 Архитектор | двойная нумерация; читать как ролевые модули — ошибка |
| К-13 | `REMHAOS_CONFLICT_REGISTER_2026-08-02.csv` C-001 — default branch `claude/new-session-gsayp3` | сегодня `main` | разрешено де-факто, реестр не обновлён; Supabase Branching всё ещё привязан к старой ветке |
| К-14 | A6 — «A1–A3 отсутствуют» | A5 ссылается как на существующие | не закрыто |
| К-15 | `docs/canonical/remhaos-v1/README.md:21-23` — `REMHAOS_READINESS_UPDATE_v1.md` отсутствует | есть только `archidom-v1` предшественник | дыра канона |
| К-16 | `MASTER_EXECUTION_PLAN.md:10-17` — `PUBLIC_PRODUCT=ArchiDom`, `AUTHENTICATED_BROWSER_QA=pending` | DEC-019, AP5 hosted PASS | шапка MEP устарела |

---

## 6. Мобильный scope

Магазины не упоминаются ни в Charter §4/§15, ни в MEP, ни в плане запуска 23.08 — отдельная ветка
уровня лендинга. Состояние: веб-часть под TWA/Capacitor готова (`STORE_SETUP.md`, `app/manifest.ts`,
`app/api/assetlinks/route.ts`, `public/sw.js`); RuStore — код готов, блокеры внешние (аккаунт,
keystore, скриншоты, реквизиты оператора ПДн, `RUSTORE_RELEASE.md`); App Store — NO-GO
(`APP_STORE_RELEASE.md`, `PREFLIGHT_APP_STORE_AUDIT.md`: нет self-service удаления аккаунта, privacy —
пилотный текст). Единственное пересечение с продуктовыми гейтами — юрблок и удаление аккаунта
(требуются и для стадии «Публичный запуск» L1).

## 7. Что не удалось проверить из этой сессии

- Живой коммит production на Vercel и причина блокировки деплоя.
- Настройки Auth/SMTP production, redirect allowlist, биллинг Supabase/Vercel/GitHub/Firecrawl.
- Второй аккаунт Supabase (проекты `uafvzxdxlxqkpsejgskt`, `qoyemgoskhuqdexlejhp`, орг `huqbxcmbidfqverftqrk`).
- Содержимое volume Railway `/data/remhaos-control` (код коллектора) и назначение `HARVEST_MODE`.
- Репозитории `Selena-AI-projects/design2026ru`, `parkourcafe/hermes-telegram-bridge`.

## Поправка 08.09 (после декомпозиции на пакеты работ)

- Идентификаторы BUG-06/07/08 (`acknowledgeImpactTruncation`, `allImpactsReviewed`,
  `truncationAcknowledged`, `unacknowledgedTruncatedRunId`) на `main` = `cfe1caa` отсутствуют
  (`rg` → 0). Остаток мёртвого контура — сырая дверь `calculateChangeImpact` в
  `lib/project-intelligence/adapters/postgres/execution.ts:441-463` (закрыта DEC-034; runner зовёт
  `calculateChangeImpactPolicyBound`). Раздел 2.4 (c) читать с этой поправкой; пакет WP-38.
- BUG-04 в части обещаний builder/client закрыт: `components/projectceo/role-policy.ts:58-70` совпадает
  с `20260802030000:43-51` (тест `tests/projectceo-ui/roles.test.ts`). Остаток — список ролей в
  `lib/project-intelligence/delivery/projectceo/command-service.ts:1062-1071` (backlog M4 №6, WP-36).
- Число миграций «90» захардкожено в hosted-джобе `.github/workflows/ci.yml:726,752`; AP5 выполняется и
  на docs-only PR (`ci.yml:210`). Учтено в ТЗ `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md` §5.
- Бюджет GitHub Actions аккаунта (скриншот владельца 08.09): $30/мес с жёсткой остановкой, в сентябре
  потрачено $6.97; падения 31.08 совпадают с исчерпанием августовского бюджета. Работоспособность CI
  в сентябре не проверена реальным прогоном.
