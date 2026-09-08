# RemHaOS — план завершения M1–M4 и запуска (08.09.2026)

**Основание:** `REMHAOS_GLOBAL_AUDIT_2026-09-08.md` (по `main` = `cfe1caa`). Заменяет
`REMHAOS_LAUNCH_PLAN_2026-08-23.md` как действующий план; фазы 0–2 того плана исполнены
(CI восстанавливался, AP1–AP5 закрыт на disposable, платформенный P0 и B-блок M1 построены),
фазы 3–4 перенесены сюда как треки 3–4 с уточнениями.
**Единицы:** РС — рабочая сессия, диапазон P50–P90, как в плане 23.08.
**Правило старшинства:** журнал решений `docs/canonical/remhaos-v1/REMHAOS_DECISION_LOG_v1.md` старше
любого повествования, включая этот план (`AGENTS.md:18-28`). Подписанные документы не переписываются;
новые решения — новыми записями DEC-040+.
**Теги шагов:** [owner] — только владелец (дашборды, биллинг, второй аккаунт); [eng] — инженер, PR в репо;
[destructive] — необратимо или вне репо, выполняется только после отдельного письменного «да» на пункт.

## Дорожная карта

### Определение «100 %» по модулям

Правило старшинства: журнал решений старше повествования (`AGENTS.md:18-28`). «100 %» здесь = всё,
что разрешено подписанными решениями, построено, доказано authenticated-прогоном и **работает в
production**. Всё, что требует нового решения владельца, вынесено в правую колонку и в оценках
показано отдельной строкой.

| Модуль | «100 %» под текущими подписанными решениями | Требует нового решения владельца |
|---|---|---|
| **M1** (Charter §4 — единственный обязательный полный модуль; §15 MVP; §18 Launch Gate п.1–12) | (a) legacy-контур бриф → паспорт → риски → цена → КП → `/p/` → respond работает в production; (b) B-блок применён и доказан (`20260824170000`, `20260829074543`); (c) M1 в командной шине/реестре — PR #124 слит; (d) `sendProposal` (`app/dashboard/projects/[id]/proposal/actions.ts:117-140`) требует утверждённый platform approval request (DEC-010: self-approval маркируется); (e) адаптер читает legacy-ревизии паспорта и договор request-bound маршрутом; (f) BUG-05 закрыт или риск принят письменно; (g) Launch Gate §18 п.7 (юрблок), п.9 (аналитика activation/errors), п.11 (metered AI — `lib/llm/recording.ts` пишет в `ai_calls` после adoption), п.12 (себестоимость прохода по ≥3 реальным брифам); (h) всё это в production (Трек 1) | S1–S4 (`docs/product-intelligence/M1_EXPANSION_LADDER_DRAFT.md` — DRAFT); Вход Б (гейт SMTP + конфликт с Charter §12/§19.7: массовый приём PII третьих лиц); SMTP-провайдер |
| **M2** (DEC-021/A4, ADR-0006, DEC-023) | P0 построен (PR #66, Layout Studio под флагом); «100 %» = **цикл 7 зелёный**: пакет Ташкент прошёл `tests/pilot-evidence/run-m2-pilot-evidence.zsh` → `EXTERNAL_REAL_PACKAGE_PASS` → `npm run test:cycle7` зелёный, гейт остаётся обязательным (`.github/workflows/ci.yml:780-798`) | Production-включение Layout Studio (флаг); следующий продуктовый P0 — после wedge (AP7) |
| **M3** (A5/DEC-024, DEC-028) | Потолок = «P0 без файлов и конфликтов»: backlog №2/4/5/6/7 закрыты 24.08; остаток №8 (флип `command-service.ts` → `publish_baseline_atomic`, убрать сырые RPC из `_module_signatures('m3')`); вход только через `publish_m2_m3_handoff`; выключатель `module_switch_log` (`20260825010000`) построен. **По решению 11.08 §3 M3 P0 «завершён только после приёма файлов и разбора конфликтов» — без ратификации DEC-026 «100 %» M3 недостижим** | DEC-026 §1.6 (PROPOSED) + выбор AV без выноса байтов третьей стороне; затем DEC-027 (зависит от серверной SHA-256); production-включение `m3` |
| **M4** (A6/DEC-025, DEC-029…037, DEC-039) | Инкремент 1 + 1.5 + V1 Impact + recovery доказаны; «100 %» = (a) backlog №2 (физическое удаление выведенных сигнатур), №4 (тесты приёмки вехи под `REMHAOS_M4_V2_V3_ENABLED`, disposable), №5 (TS: `approvalSupersededEntities` → `prerequisite_missing` в `live-read-port.ts`), №6 (роли из capability, не список `command-service.ts:1070` = BUG-04); (b) мёртвый контур BUG-06/07/08 удалён; (c) V1 + инкремент 1 включены в production по `M4_V1_PRODUCTION_RUNBOOK.md` с журналом; (d) V2/V3 доказаны **только** на disposable (DEC-039 §3). **Не включает** V2/V3 в production и команды `build_handover` / `define_milestone` / `register_handover_document` — до M4 IMPLEMENTATION GO (DEC-032, `AGENTS.md:178-186`) | M4 IMPLEMENTATION GO (десять команд); вход вертикали в production (HTTP-маршрута enroll нет); включение `m4_increment_1` в production; расширенный платный M4 — после wedge |

Горизонталь (не модуль): Telegram-мост A7 — TG2/TG3 не доказаны, TG4 без кредов; production — отдельный
OWNER GO после legal/data-plane/consent/retention (Трек 4).

### Трек 0 — гигиена инфраструктуры (эта неделя)

Теги: [owner] — только владелец (дашборды, биллинг, второй аккаунт); [eng] — инженер, PR в репо;
[destructive] — необратимо или вне репо, выполняется только после отдельного «да» на пункт.
Порядок важен: 0.4 раньше 0.5, 0.6 раньше 0.7, 0.9а раньше 0.9б–г.

| # | Шаг | Кто | Проверка |
|---|---|---|---|
| 0.1 | GitHub → Settings → Billing: восстановить платёж / поднять spending limit Actions. Признак блокировки: job падает за 2–3 с без шагов, логи 404 (повтор инцидента 17.08 из плана 23.08, п.0.1). Затем re-run CI на HEAD PR #124 (`1a7ae0b`) и #123 | [owner] | прогон CI длится минуты, а не секунды; логи открываются |
| 0.2 | Vercel `yulaboober/design-interior2026-07`: (а) записать SHA живого production-билда; (б) снять «Deployment was blocked» (usage limit / Git-интеграция); (в) **Production Branch = `release`** (ветка на живом SHA) — мержи в `main` перестают автодеплоиться в production до Approval C Трека 1; (г) preview-деплои PR выключить (Ignored Build Step) — доказательства даёт GitHub CI; (д) сверить production env: все `REMHAOS_*_ENABLED=false`, `ARCHIDOM_LAYOUT_STUDIO_ENABLED=false`, нет `PROJECTCEO_DEMO_ROLE`/`PROJECTCEO_LOCAL_FIXTURE_*` | [owner] | SHA записан; Production Branch = `release` |
| 0.3 | PR-триаж (после 0.1): закрыть #122 (перекрыт #121, иначе две RLS-миграции); слить #123 (только `ci.yml`, экономит минуты Actions); #124 — в Трек 2. Плюс маленький PR: `app/api/health/route.ts` отдаёт `commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null` — чтобы живой коммит впредь был виден | [eng] | #122 closed; #123 merged после зелёного CI; `/api/health` показывает commit |
| 0.4 | Supabase production → Integrations → GitHub / Branching: **отключить** (привязка к удалённой ветке `claude/new-session-gsayp3`, `MIGRATIONS_FAILED`). Не перепривязывать к `main` — интеграция попытается применить 90 миграций поверх чужой линии | [owner] | `list_branches` показывает только default без `git_branch` |
| 0.5 | Удалить preview-ветки `remhaos-unified-staging-phase1-20260828` (ACTIVE, платная) и `archidom-sprint1-pilot` (MCP `delete_branch`) | [destructive] | `list_branches` → пусто |
| 0.6 | Убрать хардкод одноразового стенда: `.github/workflows/ci.yml:450` (`EXPECTED_STAGING_REF`) и `tests/ap1/environment/ci-secret-log.contract.test.ts:93` → ref берётся из `vars`/`secrets` окружения `disposable-staging`; в `AP1_RUNBOOK.md` — порядок «создать стенд на прогон → удалить после приёмки» | [eng] | `rg ukkzasfsmannjprfkaxp --glob '!docs/**'` → 0; тест зелёный |
| 0.7 | Стенд `ukkzasfsmannjprfkaxp`: пауза сразу (MCP `pause_project`, обратимо), удаление в дашборде после 0.6; удалить секреты окружения `disposable-staging`, указывающие на него | [destructive] → [owner] | `list_projects` без стенда; окружение пустое |
| 0.8 | Второй Supabase-аккаунт (где видны `bali-privilege`, `mydoki`, `parkourcafe@gmail.com's Project`): найти `uafvzxdxlxqkpsejgskt`, `qoyemgoskhuqdexlejhp`, орг `huqbxcmbidfqverftqrk` → удалить, проверить счета; убедиться, что других баз RemHaOS там нет | [owner] | скриншот/запись в инвентаре |
| 0.9а | `market_harvest`: экспорт схемы и данных (pg_dump `--schema=market_harvest` через Supabase connection string) в отдельный проект Supabase «remhaos-market-harvest» или в файл в Drive владельца; копия кода с volume `/data/remhaos-control` в отдельный приватный репо | [owner решение] + [eng] | dump проверен восстановлением в новый проект |
| 0.9б | Railway `remhaos-market-harvest/collector`: снять `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_URL`, остановить сервис, затем удалить сервис и volume | [destructive] | `list-services` → пусто |
| 0.9в | **Ротировать service_role-ключ production** (Supabase → Settings → API) и обновить в законных местах: Vercel env, GitHub environment `production` (`PRODUCTION_SUPABASE_SERVICE_ROLE_KEY`), локальные `.env` | [owner] + [eng] | health-роут `/api/health` на проде отвечает; воркер-workflow при ручном запуске проходит auth |
| 0.9г | Удалить схему `market_harvest` из production — только после 0.9а, подтверждения и снапшота Трека 1.2 (порядок: снапшот со схемой → drop → второй снапшот, оба в evidence); 10 её строк в `supabase_migrations.schema_migrations` остаются и классифицируются как LEGACY_ADOPTED-no-op | [destructive] | advisor: 12 findings `market_harvest` исчезли |
| 0.10 | Advisors production — только безопасная часть: `public.rate_limits` (приложение ходит service_role, `lib/rate-limit.ts`) → запрещающая policy для `anon, authenticated` в **legacy-adopted миграции Трека 1** (в clean-bootstrap таблицы нет → guard `to_regclass`); 11 SECURITY DEFINER RPC legacy-runtime: `revoke from anon` сразу в той же миграции, от `authenticated` — после аудита вызовов (grep репо по именам, 7 дней `query_logs` postgrest без вызовов); `is_studio_member` не трогать (нужна RLS-политикам); leaked-password protection включать **после SMTP** (Трек 1.5), иначе пользователь с «утёкшим» паролем не получит письмо сброса. Плановый воркер `skipped` — норма (`if: vars.REMHAOS_M4_V1_PRODUCTION_ENABLED`), не симптом | [owner] + [eng] | advisor: 0 ERROR; WARN только по SECURITY DEFINER для `authenticated` |
| 0.11 | GitHub-ветки: dry-run (`git fetch --prune origin && git branch -r --merged origin/main`, исключить головы открытых PR) → владельцу список → удалить только влитые; `Main` — после `git diff origin/main..origin/Main --stat`; незавершённые `codex/*`, `claude/*` — список на решение. Затем branch protection на `main`: required checks `lint / typecheck / test / build`, `DB4 on postgres:16/17-alpine`, `DB5 on postgres:16/17-alpine`, `AP5 authenticated browser matrix`; запрет force-push | [eng] → [destructive] | ≤10 живых веток; protection включена |
| 0.12 | ПДн оператора из `.env.example` и `lib/env.ts:16,30-33` → плейсхолдеры; реальные значения только в Vercel env; юнит-тест, что `lib/env.ts` не содержит дефолтов с телефоном/адресом | [eng] | тест зелёный; grep по телефону → 0 |
| 0.13 | Документы: `HANDOFF.md` (орг/проект Supabase, ветка `main`, имя «Свод» → RemHaOS), `LAUNCH_CHECKLIST.md` (домен), `REMHAOS_CONFLICT_REGISTER` (C-001 resolved), пометка устаревания `HANDOFF_CINEMATIC.md`; К-1…К-16 из аудита — там, где это не подписанные документы | [eng] | PR docs-only |

Оценка Трека 0: 5–8 РС инженера + 3–4 сессии владельца в дашбордах.

### Трек 1 — production adoption (historical incremental, `AP1_MIGRATION_PATH_DECISION_2026-08-01.md`)

Вход: Трек 0 п.0.1, 0.2, 0.4, 0.9; PR #124 слит → RC = один SHA `main` (91 миграция, ledger 91).
Правило: один migration operator (владелец); production — только по Approvals A–D
`docs/product-intelligence/wave-3/production-adoption/ADOPTION_CHECKLIST.md` §13.

1. [owner] Модель доступа: владелец — единственный оператор prod; исполнителю — read-only SQL по каталогам.
2. [eng готовит, owner исполняет] **Свежий снапшот**: `docs/product-intelligence/agent-runs/db-wave/PRODUCTION_READONLY_AUDIT.sql` (scope — все не-системные схемы, включая `market_harvest` до дропа), ledger (23 строки), advisors security+performance, инвентарь Storage `client-uploads`, экспорт Auth-настроек → `production-adoption/PRODUCTION_SNAPSHOT_2026-09-xx.md` + `PRODUCTION_READ_ONLY_FINGERPRINT_2026-09-xx.md`; дрейф против 19.07 — в новый `docs/audits/REMHAOS_CONFLICT_REGISTER_2026-09-xx.csv`.
3. [eng] **Reconciliation PR** — каталог `production-adoption/reconciliation-2026-09/`:
   - `FINGERPRINT_COMPARISON.md`: все 23 применённые миграции и объекты вне репо: legacy `0007–0009` ↔ `agent-runs/db-wave/legacy-migrations/*.sql.txt`; июльский «M1 governed runtime» (`public.workflow_*`, `project_facts`, `approval_requests`, `ai_calls`, `audit_events`, `proposal_revisions`, `project_overrides`, `studio_standards`, RPC `issue_proposal_revision`…, hook 02.08) — **fingerprint, оставить, класс LEGACY_ADOPTED**, репо их не создаёт и не трогает; 10 миграций `market_harvest` — LEGACY_ADOPTED-no-op;
   - `COLLISION_CHECK.md`: репо-миграции, пишущие в `public`, против prod: `20260801150000` (hook уже зарегистрирован: `create` vs `create or replace`), `20260824170000` (unique `proposals(project_id, version)` при 3 КП; `intake_expires_at`), `20260829074543`, `20260808050000`, `20260716072000` — каждая проверяется на клоне;
   - `baseline-adoption.sql`: одна транзакция — assert fingerprint (counts по снапшоту → `raise exception`) → запись `20260716071024` как applied **без DDL** (`supabase migration repair --status applied`); 23 существующие строки не трогаются;
   - `tests/ap1/environment/adopt-production.zsh` — новый операторский скрипт (НЕ трогать `bootstrap-disposable.zsh`: его `reject_production` — контракт): `supabase/roles.sql`, additive-миграции со второй строки `migration-ledger.sha256` с проверкой хеша (запись baseline уже создана `baseline-adoption.sql` на Approval A; скрипт проверяет её наличие и DDL baseline не исполняет), `verify-db.sql`, `apply-hosted-role-precondition.sql`; требует `AP1_APPROVAL_RECORD` и allowlist ref; контрактный тест — отказ без записи одобрения и на чужом ref;
   - `REPLAY_LOG.md` (90 additive, stop-on-first-failure), `POST_VERIFY.md` (`verify-db.sql`, `verify-runtime.mjs`, `verify-m3-data-api-closed.mjs`, `verify-m4-data-api-closed.mjs`, advisors errors=0, `module_production_state()` закрыто, `v1_impact_production_state()` `open_now=false`);
   - `20260909xxxxxx_legacy_adopted_hardening.sql` (additive, no-op на clean bootstrap через `to_regclass`/`to_regprocedure`): deny-policy `rate_limits`; `revoke execute from anon` на 11 SECURITY DEFINER RPC; `force row level security` на `public.project_facts`; DB4-сценарий `tests/db4/57_legacy_adopted_hardening.sql`;
   - `ROLLBACK_EVIDENCE.md`: down-миграций нет; откат = PITR/backup на точку окна (`ROLLBACK_RUNBOOK.md` §3) + Vercel rollback на прежний deployment; измеренные RTO/RPO из п.4.
4. [eng + owner] **Репетиция на клоне**: новый disposable-проект → восстановить prod backup (`pg_restore`; Supabase branch клоном не является) → `baseline-adoption.sql` → `adopt-production.zsh` → `POST_VERIFY` → `npm run provision:ap1` → hosted AP5 (`ci.yml` job `hosted-staging`, секреты на клон) 27/27, 0 skipped → legacy-смоук на реальных данных клона → клон удалить (живые PII). Итерировать п.3 до зелёного.
5. [owner] **SMTP**: Resend, домен `remhaos.com` (обновить `supabase/email-templates/README.md`, написанный под `arhidom.space`), DNS в Vercel, Supabase Custom SMTP (`smtp.resend.com`, 465, sender `noreply@remhaos.com`), шаблоны magic link / confirm signup, redirect allowlist = `NEXT_PUBLIC_APP_URL` + `/auth/callback`; сначала на клоне с реальным ящиком (§6 чек-листа).
6. [owner] Auth: leaked-password ON (после SMTP); hook = версия `20260824120000` (FIND-01); `app/api/auth/register/route.ts` без `email_confirm: true`.
7. [eng] Мониторинг и kill switch: adoption ничего не открывает пользователю (все флаги `false`, выключатели закрыты); kill switch приложения = Vercel rollback на записанный deployment, базы = `close_module_production` / `close_v1_impact_production`; минимум алертов Supabase (CPU/connections/errors), `query_logs` ежедневно в окне наблюдения, GitHub issue как incident channel; §12 чек-листа заполняется честно.
8. [owner + eng] Human GO: §1–§12 с evidence; §2 хеши на RC (ledger 91 + `.env.example`/`.vercelignore`/`next.config.mjs`/`package.json`); Approval A (history repair) → B (additive) → C (deploy RC: `release` → RC) → D (traffic: projectceo-маршруты уже задеплоенного билда; модули закрыты).
9. [owner исполняет] **Окно на prod**: freeze мержей → backup/PITR timestamp → Approval A: `baseline-adoption.sql` (запись baseline как applied без DDL) → проверка единственной новой записи → Approval B: `adopt-production.zsh` (только additive, со второй строки ledger) → Data API exposed schemas (список, который пиннит `tests/ap1/environment/environment.contract.test.ts`) → reload schema cache → `verify-runtime.mjs` против prod → advisors errors=0 → deploy RC → смоук legacy M1 тестовым дизайнером → 48 ч наблюдения → §14 execution record. Итог ledger = 23 существующие записи + число строк ledger репозитория (baseline считается один раз, как repaired): при 91 строке — 114, при 92 — 115.
10. [owner] Запись `docs/canonical/remhaos-v1/REMHAOS_OWNER_DECISION_PRODUCTION_ADOPTION_2026-09-xx.md` + **DEC-040**: `PLATFORM_FOUNDATION = ACTIVE`, `PRODUCTION_APPLIED=true`; `PRODUCTION_READY` — только по чек-листу; абзац `AGENTS.md` правится вслед за журналом.

### Трек 2 — M1 до 100 %

1. **PR #124** (`codex/m1-project-workspace-contracts`, HEAD `1a7ae0b`): после 0.1 — прогон на точном HEAD (gates, DB4×2, DB5×2, AP5, Claude review); после мержа #123 — перенос коммитов на новую ветку `wp/wp-21-land-pr-124` от `main` (merge или cherry-pick, без rebase чужой ветки) и новый PR, #124 закрывается как superseded; ledger 91; merge только после решения Р11 (автор PR сам это требует). 1 РС.
2. **Решение о модели моста M1** (Р11): (а) enrollment — legacy-проект серверно зачисляется в ProjectCEO-проект студии при первой команде M1 (одна модель данных, `AGENTS.md:46-47`); (б) ключ по legacy id без FK (образец `20260824170000`). Рекомендация — (а). 0,5 РС на предложение.
3. **`sendProposal` требует platform approval** (`app/dashboard/projects/[id]/proposal/actions.ts:117-140`): перед `status='sent'` — approved approval request из `20260824150000`; self-approval маркируется (DEC-010); UI — вкладка Passport (#124) → «Согласовать КП» → отправка; тесты `tests/projectceo-integration/m1-platform-command-service.test.ts` + `tests/db4/51_platform_approval_requests_operations.sql`. 3–5 РС.
4. **Адаптер читает legacy-таблицы M1** (`project_passport_revisions`, `contract_documents`) request-bound маршрутом: «Contracted Project Passport» = последняя ревизия + статус договора `uploaded→received→signed`; тесты `tests/db4/53_…`, `56_…`, UI. 3–5 РС.
5. **BUG-05**: классификация по `grep createAdminClient`: (а) token-scoped публичные маршруты (`app/api/intake/*`, `app/api/client/create`, `app/api/proposal/respond`, `app/p/`, `app/b/`, `app/room/`, `plan-upload`) — паттерн правила 3 CLAUDE.md: оставить, обернуть в helper `lib/supabase/token-scoped.ts` с allowlist + static-boundary тест (образец `tests/ap1/guest/static-boundary.test.ts`), риск принять письменно (Р26); (б) аутентифицированные страницы дизайнера (`app/dashboard/projects/[id]/page.tsx`, `app/join/[token]/*`, `app/api/pilot`, `app/api/dashboard/contracts`, `lib/designer.ts`, `lib/studio.ts`, `lib/intake.ts`) → request-bound `lib/supabase/server.ts` + RLS. 4–8 РС.
6. Static-boundary тест «нет `createSignedUrl(` с TTL > 900 вне `adapters/storage`». 0,5 РС.
7. Launch Gate §18: п.9 события ошибок + activation-отчёт из `events`; п.11 подтвердить запись `ai_calls` в prod; п.12 отчёт себестоимости по 3 брифам → `docs/audits/REMHAOS_M1_COST_REPORT_2026-xx.md`. 2–4 РС.
8. S1–S4: владелец подписывает черновик → `docs/canonical/remhaos-v1/REMHAOS_OWNER_DECISION_M1_EXPANSION_LADDER_2026-09-xx.md` + DEC-строка; измерения — с первого реального клиента на production. 0,5 РС + календарь.
9. Вход Б — только по Р17 (после SMTP): объём строго P1 §4 CLAUDE.md (`/start`, `/s/[share_token]`, `/c/[token]`, S-B5 верификация, автосейв), DoD P1 §6; предварительно снять конфликт с Charter §12/§19.7. 10–16 РС.

### Трек 3 — M2 / M3 / M4 до 100 %

1. **AP6 / цикл 7 с пакетом Ташкент**: стенд (`bootstrap-disposable.zsh --target hosted` или `--target local`) → включения по DEC-029/039 (`enable-m3-publication.sql`, `enable-m4-increment-1.sql`, `enable-m4-v1-impact.sql`, `enable-m4-v2-v3.sql`) → достроить NOT_BUILT из `REMHAOS_PHASE3A_EVIDENCE_2026-08-24.md` §3a.7 (загрузка пакета + cookie-jar пяти ролей для `tests/pilot-evidence/executors/external-package-runner.zsh`, образец `kora-five-session-producer.zsh`) → `ARCHIDOM_EXTERNAL_PILOT_MANIFEST=tests/fixtures/cycle7/external-package.manifest.json zsh tests/pilot-evidence/run-m2-pilot-evidence.zsh` → `PASS.json` → `workflow_dispatch` с `cycle7_receipt_head_sha`/`cycle7_receipt_b64` (`ci.yml:799-840`) → PR: манифест `status: completed` + receipt → `npm run test:cycle7` зелёный, job остаётся обязательным → продолжить цепочку до M3 handoff → baseline → release → M4 distribute/ack/change/impact → V2/V3 двери на disposable (DEC-039 §3.3) → отчёт `wave-3/pilot/TASHKENT_AP6_RUN_2026-09-xx.md` (import gaps, mapping, время до baseline, конфликты). 6–10 РС + время партнёра.
2. **DEC-026 (после Р18) → DEC-027**: файлы — маршрут загрузки + экран, `adapters/storage`, состояния `quarantined→clean|infected` серверно, серверный SHA-256 (`checksum` уходит из входа `register_source`), лимит 100 МБ, retention как поле проекта + отложенное удаление 90 дней, AV без выноса байтов третьей стороне — 10–16 РС; конфликты — серверное определение, capability для `owner_lead`/`architect`, команда разрешения с причиной, append-only, гейт в `publish_baseline_atomic` («после replay, до записей», `20260825030000`), убрать `semanticConflict` из `command-contract.ts` — 8–12 РС.
3. **Координационные остатки** (без решений): M3 №8 флип 2–3 РС; M4 №5 TS 1–2 РС; M4 №2 физическое удаление (`m4-surface.ts`, `enable-m4-increment-1.sql`, `m4-surface-matrix.test.ts`, затем DROP-миграция) 1–2 РС; M4 №6 + BUG-04 одним корнем — `components/projectceo/role-policy.ts` и `command-service.ts:1070` читают capability из `lib/project-intelligence/platform/action-registry.ts`, сверка с `20260802030000:43-51` 1–2 РС; M4 №4 — три утверждения в `live-read-sanitization.test.ts` под `REMHAOS_M4_V2_V3_ENABLED` 1 РС.
4. **Мёртвый контур impact** (по поправке аудита 08.09 идентификаторы BUG-06/07/08 на `main` отсутствуют): удалить сырую дверь `calculateChangeImpact` в `lib/project-intelligence/adapters/postgres/execution.ts:441-463` и её пин в `static-request-bound-boundary.test.ts`; **оставить** kind в `command-contract.ts:261`, `not_authorized` в `action-registry.ts:79`, `execution-flag.ts:106`, `live-read-port.ts:1320` — AP5 звено 12 утверждает отказ `operation_unavailable` до базы; «Поправка» к §7.2 `REMHAOS_M4_V1_PRODUCTION_READINESS_AUDIT_2026-08-12.md` (не переписывать). 1 РС.
5. **Production-переключение V1 + инкремент 1** по `M4_V1_PRODUCTION_RUNBOOK.md` (после Трека 1 GO D): предпосылки §9 — (1) снята DEC-040, (2) вход вертикали — Р20, (3) доступ — Трек 1; далее GitHub Environment `production` (ключ из 0.9в) + `vars.REMHAOS_M4_V1_PRODUCTION_ENABLED=true` → `Run workflow` change-impact worker → SQL `open_module_production('m3'|'m4_increment_1', actor, basis)` (Р19) и `open_v1_impact_production(actor, 'DEC-033')` → `v1_impact_production_state()` = две сигнатуры → Vercel `REMHAOS_DOCUMENTATION_ENABLED=true`, `REMHAOS_EXECUTION_ENABLED=true` → redeploy → смоук §3 на **отдельном smoke-проекте**; откат §5. 1–2 РС.
6. **V2/V3 в production — только под M4 IMPLEMENTATION GO (Р21)**: `upload_photo_evidence`/`review_photo_evidence`/`accept_milestone` → `active`, добавить `define_milestone`/`register_handover_document`/`build_handover` в контракт, воркер сборки архива, выключатель `m4_increment_2`. 12–20 РС. Вне «100 %».

### Трек 4 — коммерческая валидация и публичный запуск

1. **AP7** (`MASTER_EXECUTION_PLAN.md` §4): wedge (Р22, default — «платный M1→M2 цикл для дизайнера»); стартует **сразу на живом legacy M1** (concierge), инструментированные метрики — после Трека 1; два оплаченных сценария с письменными scope/success criteria, второй проект той же компании, измеримый downstream (time-to-passport, AI cost из `ai_calls`); evidence `docs/audits/REMHAOS_AP7_EVIDENCE_2026-xx.md` без PII. 2–4 РС + 2–4 недели календаря.
2. **Юрблок** (Charter §18 п.7; CLAUDE.md L1; `APP_STORE_RELEASE.md` P0): `app/legal/privacy`, `app/legal/terms` из env (0.12), subprocessors (Supabase Tokyo, Vercel, Resend, LLM по env, Higgsfield CDN), сроки хранения (после DEC-026), удаление (`app/api/account/delete/route.ts` — охват user/projects/answers/files), `app/support`; решение по data plane 152-ФЗ (Р23). Владелец + юрист; 1–2 РС инженера.
3. **Telegram gate** (`REMHAOS_TELEGRAM_BRIDGE_RUNBOOK.md` §0): TG2 — вложения в `remhaos_channel.channel_attachments` + карантин, `migrate_to_chat_id`, HTTP-граница webhook против живой базы, sender/projector отдельным процессом — 6–10 РС; TG3 — AP5-вертикаль M3→M4 с мостом — 2–3 РС; TG4 — креды disposable-бота (Р24) — 1–2 РС; production — отдельный OWNER GO (A7 §1.11); в «100 %» модулей не входит.
4. **Мобильные магазины** — опциональная параллель (`APP_STORE_RELEASE.md`, `RUSTORE_RELEASE.md`, `STORE_SETUP.md`); зависят от п.2 и 0.12; QA на устройствах 2–4 РС на магазин.
5. **Гейт публичного запуска**: Charter §18 п.1–12 с evidence; CLAUDE.md L1–L3; S4 открыт; создать отсутствующий `docs/canonical/remhaos-v1/REMHAOS_READINESS_UPDATE_v1.md` как Implementation Report. 1–2 РС.

### Последовательность и оценки

```
Неделя 1        │ Трек 0: 0.1 CI ─► 0.3 PR-триаж (#122, #123) ─► Т2.1 CI на #124
(параллельно)   │         0.2 Vercel (SHA, release-ветка) ─┐
                │         0.4 branching off ───────────────┼─► вход Трека 1
                │         0.9 market_harvest export+rotate ┘
                │         0.6 hardcode ─► 0.7 pause/delete staging; 0.8 второй аккаунт; 0.11 ветки; 0.12 PII
Недели 2–6      │ Трек 1: 1.1 ─► 1.2 snapshot ─► 1.3 recon PR ⇄ 1.4 клон (итерации)
                │         1.5 SMTP ─► 1.6 Auth; 1.7 monitoring ─► 1.8 GO A→B→C→D ─► 1.9 окно ─► 1.10 DEC-040
                │ Трек 2: Р11 ─► 2.1 merge #124 ─► 2.3 sendProposal ─► 2.4 адаптер ─► 2.5 BUG-05 ─► 2.6/2.7
                │ Трек 3: 3.1 AP6 (disposable, независим от prod); 3.3 координация; 3.4 мёртвый контур
                │ Трек 4: 4.2 юрблок (owner + юрист); 4.1 AP7 concierge на живом M1; 4.3 TG2/TG3 (disposable)
После Т1 GO D   │ Т2.8 S1 измерения (реальные клиенты) ─► S2 ─► S3 ─► S4
                │ Т3.5 V1 + инкремент 1 production switch (Р19, Р20) ─► smoke-проект
По решениям     │ Р18 DEC-026 ─► Т3.2 файлы ─► DEC-027 ─► M3 «100 %»
                │ Р17 Вход Б (после SMTP + Charter §12) ─► Т2.9
                │ Р21 M4 IMPLEMENTATION GO (после AP7) ─► Т3.6 V2/V3
                │ Р24 / OWNER GO Telegram production (после 4.2 + data plane) ─► TG4 ─► production
```

Жёсткие зависимости: ничего в Треке 1 до 0.1, 0.2, 0.4, 0.9 и мержа #124 (RC = один SHA); 1.9 только
после Approvals A–B; Т3.5 только после 1.10; Т3.2 только после DEC-026 (DEC-027 после DEC-026);
Т2.9 только после 1.5 и Р17; Т3.6 только после Р21; leaked-password только после SMTP; drop
`market_harvest` только после экспорта и снапшота 1.2.

| Трек | P50 РС | P90 РС |
|---|---|---|
| Трек 0 (инженер 5–8 + владелец 3–4 сессии) | 8 | 12 |
| Трек 1 | 18 | 30 |
| Трек 2 (ядро, без Входа Б) | 14 | 24 |
| Трек 3 (ядро, без DEC-026/027 и V2/V3) | 13 | 23 |
| Трек 4 (ядро: AP7, юрблок, readiness update) | 4 | 8 |
| **Итого «100 % под текущими решениями»** | **≈ 57** | **≈ 97** |
| + Вход Б (Р17) | +10 | +16 |
| + DEC-026/027 (Р18) | +18 | +28 |
| + V2/V3 production (Р21) | +12 | +20 |
| + Telegram TG2–TG4 (Р24) | +9 | +15 |
| + магазины (Р25) | +4 | +8 |
| **Итого полный объём** | **≈ 110** | **≈ 184** |

Календарно при ~5 РС/нед: ядро 12–20 недель; Трек 0 — 1 неделя; AP7 и S1–S3 добавляют календарное
время (клиенты), не РС.

## Решения владельца (с рекомендацией по умолчанию)

Нумерация Р1–Р28 используется в треках выше.

| # | Решение | Рекомендация (default) |
|---|---|---|
| Р1 | Восстановить биллинг GitHub Actions, умеренный spending limit (полный матричный прогон в августе выбирал квоту за 1,5 недели) | да, сразу |
| Р2 | Vercel: Production Branch = `release`; preview-деплои PR выключить | да |
| Р3 | Prod Supabase: отключить GitHub-интеграцию и Branching, удалить 2 preview-ветки | да |
| Р4 | Стенд `ukkzasfsmannjprfkaxp`: пауза → удаление после снятия хардкода; пересоздание скриптом по требованию | да |
| Р5 | `uafvzxdxlxqkpsejgskt`, `qoyemgoskhuqdexlejhp`, орг `huqbxcmbidfqverftqrk` — удалить (второй аккаунт) | да |
| Р6 | `market_harvest`: экспорт в отдельный проект/организацию → drop из prod → ротация service_role; Railway collector остановить; код с volume — в отдельный репо при желании | экспорт + drop + ротация |
| Р7 | Advisors: deny-policy `rate_limits` в legacy-adopted миграции; 11 SECURITY DEFINER — revoke от `anon` сразу, от `authenticated` после аудита вызовов; `is_studio_member` не трогать; leaked-password ON после SMTP | как описано |
| Р8 | Удалить merged-ветки и `Main`; branch protection на `main` с required checks | да |
| Р9 | ПДн из `.env.example` / `lib/env.ts`; реальные значения — в Vercel env | да |
| Р10 | #122 закрыть; #123 слить; #124 слить после CI на точном HEAD и Р11 | да |
| Р11 | Модель моста M1: (а) enrollment legacy-проекта в ProjectCEO-проект / (б) legacy-id без FK | (а) |
| Р12 | Доступ к prod: владелец — единственный оператор; исполнитель read-only | да |
| Р13 | SMTP = Resend на `remhaos.com` | да |
| Р14 | Подписи Approvals A–D чек-листа (8 ролей могут совпадать в одном лице — фиксируется явно) | по факту evidence |
| Р15 | Запись DEC-040 `PLATFORM_FOUNDATION = ACTIVE` после окна | да |
| Р16 | Ратифицировать S1–S4 как в черновике | да |
| Р17 | Вход Б | **не сейчас**: после S2 и снятия конфликта с Charter §12/§19.7 |
| Р18 | DEC-026 §1.6 ратифицировать + AV self-hosted в регионе базы (без облачной конвертации третьей стороной) | ратифицировать |
| Р19 | Включение `m3` и `m4_increment_1` в production через `module_switch_log` — одним решением, после AP6 PASS и DEC-040, со smoke-проектом | да, вместе с V1 |
| Р20 | Вход вертикали V1 в production: (а) HTTP-маршрут enroll (нет в коде, 2–3 РС) / (б) операционный порядок | (а), если Т3.5 не раньше Т2.4; иначе (б) временно |
| Р21 | M4 IMPLEMENTATION GO (V2/V3, десять команд) | **не раньше** подтверждения wedge по AP7 |
| Р22 | Wedge AP7 | «платный M1→M2 цикл для дизайнера» |
| Р23 | Data plane 152-ФЗ (Charter §19.7) | честно задокументировать текущее (Tokyo + LLM по env) в privacy для закрытого пилота; RU data plane — до публичного запуска отдельным решением (у Supabase нет региона РФ → self-hosted или другой провайдер) |
| Р24 | Креды disposable-бота для TG4 сейчас; production Telegram — после юрблока | да / отложить |
| Р25 | Магазины и Apple Developer ($99/год) | после гейта публичного запуска; не продлевать до готовности |
| Р26 | Принять риск token-scoped service_role маршрутов (класс (а) BUG-05) с allowlist-helper и тестом | принять |
| Р27 | Консолидация аккаунтов: один Supabase-аккаунт/орг для RemHaOS; Petid.care и Aether — в свои организации; один владелец GitHub/Vercel | да |
| Р28 | Формат результата: документы в репо + PR; артефакт-страница для чтения — опционально | документы + PR |

## Проверка (verification)

**Трек 0 (через MCP и репо):** `Supabase.list_branches(prod)` → пусто; `list_projects` → стенда нет
или `INACTIVE`; `get_advisors(prod, security)` → нет findings по `market_harvest` и `rate_limits`; `Railway.list-services(remhaos-market-harvest)` → сервиса нет;
`github.list_pull_requests` → #122 closed, #123 merged; `actions_list` → прогоны CI на PR-HEAD
длятся минуты и зелёные; `rg ukkzasfsmannjprfkaxp --glob '!docs/**'` → 0; `git branch -r | wc -l` ≤ 10.

**Треки 1–4 (репозиторные гейты, как в `AGENTS.md` «Definition of Done»):**
`npm run release:check` (lint/typecheck/test/build) · `npm run test:db4` и `npm run test:db5` на
PG16 и PG17 · `npm run test:ap5` локально и `workflow_dispatch hosted_staging=true` на свежем стенде
(AP5 без skip, `assert-no-skips.mjs`) · `npm run test:cycle7` зелёный только с реальным manifest
(`tests/fixtures/cycle7/external-package.manifest.json`, `status: pass`) · adoption checklist
`docs/product-intelligence/wave-3/production-adoption/ADOPTION_CHECKLIST.md` — Approvals A–D подписаны
· Supabase advisor production после reconciliation: 0 ERROR · `M4_V1_PRODUCTION_RUNBOOK.md` —
журнал `production_switch_log` содержит запись открытия V1.

## Допущения

- Реальная стоимость ресурсов берётся из биллинга владельца; в плане — оценки.
- Живой коммит на remhaos.com неизвестен; до его определения (0.2) legacy-RPC production не трогаются.
- Второй Supabase-аккаунт и репозитории `design2026ru`, `hermes-telegram-bridge` — вне доступа
  сессии; проверяет владелец.
- Все подписанные документы (`docs/canonical/remhaos-v1/*`) не переписываются; новые решения —
  новыми записями DEC-040+ в журнале (это отдельные документы владельца, не часть этой сессии).
