# RemHaOS — генеральное ТЗ: оркестратор и рабочие агенты доводят продукт до 100 % без остановки сайта

**Дата:** 08.09.2026. **Основание:** `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`,
`docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md` (треки 0–4, решения Р1–Р28).
**Статус:** принято владельцем 08.09.2026 как ТЗ на исполнение; запуск механизма (раздел 14) — отдельное GO.
**Правило старшинства:** журнал решений `docs/canonical/remhaos-v1/REMHAOS_DECISION_LOG_v1.md` старше
любого повествования, включая это ТЗ (`AGENTS.md:18-28`). Подписанные документы не переписываются; новые
решения — записями DEC-040+ силами владельца.

Сопутствующие файлы: `ORCHESTRATOR.md` (инструкция оркестратора), `STATUS.md` (доска пакетов),
`OWNER_QUEUE.md` (очередь решений владельца), `wp/WP-xx-*.md` (пакеты работ — готовые промпты),
`../audits/wp/WP_PROTOCOL.md` и `../audits/wp/WP_EVIDENCE_TEMPLATE.md` (протокол и шаблон evidence).

---

## 0. Цель, границы, ответ на вопрос «возможно ли»

**Цель.** Один агент-оркестратор ведёт программу из 30 пакетов работ (WP), рабочие агенты исполняют
пакеты в отдельных ветках и PR, CI и слепое ревью проверяют результат, владелец принимает решения и
проводит операции с production. Итог программы — треки 0–4 дорожной карты: инфраструктура починена,
production переведён на линию репозитория, M1–M4 доведены до «100 % под текущими подписанными
решениями», выполнена коммерческая валидация.

**Границы.** ТЗ не открывает ничего, что закрыто решениями владельца: Вход Б (Р17), DEC-026/027 (Р18),
M4 V2/V3 в production (Р21), Telegram production (Р24), магазины (Р25) — вне этой программы, пока нет
новых решений.

**Ответ «возможно ли» — да, при пяти условиях.**
1. Владелец восстанавливает GitHub Actions (Р1) до старта: без CI ни один PR агентов недоказуем.
2. Одновременно работают не больше двух рабочих сессий плюс оркестратор; ревью — последовательно
   (общий пятичасовой лимит аккаунта и квота CI).
3. Пакеты, добавляющие миграции, идут строго по одному (единый упорядоченный ledger).
4. Production не трогается агентами вообще: сайт не останавливается именно потому, что до него никто не
   дотягивается; окно adoption проводит владелец руками по runbook после Approvals A–D.
5. «Без остановки» — оркестратор сам будит себя и держит доску в движении, но темп задают ответы
   владельца: без ежедневного закрытия пунктов `OWNER_QUEUE.md` конвейер встанет примерно через неделю.

---

## 1. Роли и полномочия (deny-by-default)

Всё, что не названо в таблице, запрещено. Образец — `selena-OS/docs/control-room/AUTHORIZATION_MATRIX.md`.

| Роль | Кто | Разрешено | Запрещено |
|---|---|---|---|
| Владелец | Селена | всё; единственный оператор production; решения Р*; дашборды и биллинг; слияние PR с миграциями, RLS, грантами, CI-workflow, флагами; продвижение `release` | — |
| Оркестратор | одна постоянная сессия Claude Code Remote | GitHub: открывать/комментировать PR, сливать docs-only и не-миграционные PR при зелёном CI и вердикте ревью (Р31); создавать, будить, останавливать дочерние сессии; править только `docs/execution/*`, `docs/audits/wp/*`, канонические транскрипции WP-C; read-only проверки advisors на стендах | production-секреты; любые операции с `ztnycrchwxqczqbyegnp`; слияние миграций/security/CI; правка подписанных документов; более двух рабочих сессий одновременно |
| Рабочий агент | дочерняя сессия на один WP | своя ветка `wp/WP-xx-<slug>`; файлы из allowlist WP; локальные тесты; PR; evidence-файл | файлы вне allowlist; хотспоты чужих серий; force-push, amend, переписывание истории; пропуск тестов; production-ref; коннектор Supabase; строка `@claude` в PR |
| Ревьюер | дочерняя read-only сессия (blind-review) | чтение diff + evidence + ТЗ; комментарий-вердикт в PR (`BLOCKER/MAJOR/MINOR`) | любые правки; чтение транскрипта рабочего |
| Сторож | существующий `watchdog-loop` | чтение heartbeat | — |

---

## 2. Протокол пакета работ и статусы

Статусы (словарь из `STAGE1_EXECUTION_PLAN.md` §4): `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED_ON_OWNER`,
`BLOCKED_HOTSPOT`, `BLOCKED_PLAN_LIMIT`, `CODE_COMPLETE`, `PR_OPEN`, `CI_GREEN`, `CHANGES_REQUESTED`,
`REVIEW_PASSED`, `READY_FOR_OWNER_MERGE`, `MERGED`. `MERGED` ≠ production acceptance.

1. Оркестратор выбирает WP из `STATUS.md` по волне и свободным хотспотам, проверяет входы (решения
   владельца, слитые предшественники, `OWNED_PATH_OVERLAP=0` с активными WP), резервирует слот
   миграции/номер DB4 при необходимости, создаёт рабочую сессию с промптом из `wp/WP-xx-*.md`.
2. Рабочий: ветка от свежего `origin/main`; правит только allowlist; коммиты маленькие; локально
   `npm run release:check` (+ DB4/DB5, если задет SQL); пишет `docs/audits/wp/WP-xx_EVIDENCE.md`;
   открывает PR по шаблону протокола; завершает сессию строкой статуса.
3. Оркестратор по событию CI/ревью: красное — будит рабочего `SendMessage` с логом; зелёное — назначает
   ревью (blind-review обязателен для миграций, security, CI, канона — Р37), затем применяет правило
   слияния (Р31). Новый SHA инвалидирует прежний вердикт.
4. После слияния: `STATUS.md` обновлён, ветка удалена, следующий WP той же серии стартует с rebase.
5. Ежедневно оркестратор пишет одну строку отчёта в `STATUS.md` (закрыто, в работе, блокеры, расход) и
   heartbeat-файл (раздел 14).

---

## 3. Правила без исключений

- Ни одна сессия, кроме владельца, не получает production-секреты; строка `ztnycrchwxqczqbyegnp`
  в промптах рабочих запрещена и проверяется оркестратором при создании сессии.
- Миграции: один активный WP с миграцией в любой момент (серия S-MIG); ledger и count-pinned тесты правит
  только он.
- Хотспот принадлежит ровно одному активному WP; второй ждёт слияния первого.
- Рабочий, которому нужен запрещённый файл, останавливается со статусом `BLOCKED_HOTSPOT` и пишет в PR:
  файл, строки, причину, минимальный diff. Границу расширяет только оркестратор.
- Никаких force-push, amend, переписывания подписанных документов, пропуска или ослабления тестов.
- Бюджет: ≤2 рабочих + 1 оркестратор одновременно; ревью последовательно; при `rate_limit_info.status =
  rejected` оркестратор ставит паузу до `resetsAt` и не порождает новых сессий.
- Классы доказательств не смешиваются: юнит-тест ≠ DB4/DB5 ≠ AP5 ≠ hosted ≠ production. Пропущенная,
  отменённая или отсутствующая проверка — не «зелёная».

---

## 4. Защита production и параллельная работа над сайтом

- **Предусловие первого слияния.** Сегодня Production Branch на Vercel = `main` (`HANDOFF.md`): после
  снятия блока Vercel каждое слияние в `main` уедет на сайт. Шаг 0.2(в) карты — Production Branch =
  `release` на живом SHA — выполняется владельцем **до** первого слияния агентами. До этого оркестратор
  только открывает PR.
- Production стоит на `release`; все флаги модулей `false` (fail-closed: только строка `"true"`
  открывает модуль); агенты пишут только в ветки → сайт не может сломаться от их работы.
- Откат: Vercel rollback на прежний deployment; для модулей — независимые рычаги
  `M4_V1_PRODUCTION_RUNBOOK.md` §5 и `docs/product-intelligence/wave-3/production-adoption/ROLLBACK_RUNBOOK.md` §3.
- **Поток S (сайт).** Лендинг, гайды, страницы для клиентов, юрблок из env — отдельные WP низкого риска.
  Все строки живут в `lib/i18n/ru.ts`, `lib/i18n/public.ts`, `lib/i18n/ru-intents-*.ts`: WP потока S
  владеет этими файлами эксклюзивно на время работы; инженерные WP, которым нужны строки, ждут.
  Выпуск контента: слияние в `main` оркестратором при зелёном CI (Р32), продвижение в `release` —
  владелец раз в неделю.

---

## 5. Бюджеты и лимиты

**GitHub Actions.** Бюджет аккаунта `parkourcafe` = $30/мес с жёсткой остановкой (скриншот владельца
08.09; в сентябре потрачено $6.97 при молчании этого репозитория — бюджет общий для всех приватных
репозиториев). Падения CI 31.08 совпадают с исчерпанием августовского бюджета и сбоем оплаты (PR #124).
Модель: один push с кодом = `gates` + DB4 ×2 + DB5 ×2 + AP5 ≈ 75–80 раннер-минут ≈ $0.6 (≈ $0.008/мин
сверх включённых минут — сверить с биллингом); до слияния PR #123 каждый push считается дважды; AP5 бежит
и на docs-only (≈ 30 минут). Два рабочих по 3–4 push в день = 130–175 push/мес → реалистично $50–100 при
экономии, худший случай $150–300. Обязательная экономия: PR #123 первым; `npm run release:check` перед
каждым push; один push на веху; DB4/DB5 локально для WP с SQL; де-пин счётчика ledger в `ci.yml` (WP-02);
AP5 не на docs-only (Р36). Рекомендация: бюджет $100/мес, пересмотр через месяц (Р29).

**Claude-сессии.** Пятичасовой лимит общий для всех сессий аккаунта (07.09 сессия владельца остановилась с
«session limit»); стоимость длинной сессии в истории — от $5 до $206. Правило: ≤2 рабочих + оркестратор,
ревью последовательно; ожидание CI через `send_later`, не активным опросом; сессии рабочих возобновляются,
а не пересоздаются; недельный потолок в долларах назначает владелец (Р29), при 80 % — новые сессии не
создаются.

---

## 6. Хотспоты (single-writer файлы)

| H | Файлы | Что пинится / почему | Правило |
|---|---|---|---|
| H1 | `supabase/migrations/*`, `tests/ap1/environment/migration-ledger.sha256`, `tests/layout-studio/integration/integration.test.ts` (список `preExisting`), `tests/ap1/environment/environment.contract.test.ts:139-163` | точный список и sha; реальный инцидент параллельной сессии (`20260812010000` записала 8 вместо 7) | серия S-MIG: один держатель; слот timestamp резервирует оркестратор |
| H2 | `tests/db4/run.zsh:52-91`, `tests/db5/run.zsh:84-98` | упорядоченные списки сценариев; дубли префиксов `49_…53_` от двух агентов | номер набора выдаёт оркестратор |
| H3 | `lib/project-intelligence/delivery/projectceo/command-service.ts` | гейты :298-334; payload `register_source` :385-400; роли :1062-1071 | серия S-CS |
| H4 | `…/command-contract.ts` | kind :261; `semanticConflict` :575 (DEC-027 — не трогать до Р18) | только по подписанному решению |
| H5 | `lib/project-intelligence/platform/action-registry.ts` + `tests/platform/action-registry.test.ts` | полнота/призраки; `validModules` :50 | правится в одном коммите с H4 |
| H6 | `…/m3-surface.ts` + `tests/projectceo-integration/m3-surface-matrix.test.ts`, `tests/db4/06_*.sql`, `tests/ap1/environment/enable-m3-publication.sql`, `verify-m3-data-api-closed.mjs` | матрица M3 запинена | один агент на модуль |
| H7 | `…/m4-surface.ts` + `m4-surface-matrix.test.ts` (:93 `closed=2`, :124, :150, :202), `tests/db4/07`, `08`, `20:962-973`, `enable-m4-increment-1.sql:36-62` | legacy-двери перечислены во всех | один агент на модуль |
| H8 | `lib/i18n/ru.ts` (2 397 строк, 125 импортов) | один объект строк | ключи в конец своего namespace; серия S-RU |
| H9 | `AGENTS.md` | повествование | только WP-C |
| H10 | `docs/canonical/remhaos-v1/REMHAOS_DECISION_LOG_v1.md`, `README.md`, `REMHAOS_READINESS_MATRIX_v1.csv`, `MASTER_EXECUTION_PLAN.md:10-17` | канон и транскрипции | только WP-C по подписанному документу |
| H11 | `tests/ap5/02-kora-chain.spec.ts`, `01-*.spec.ts`, `global-setup.ts`, `ap5-env.ts` | `retries: 0`; `passed=27` в приёмке | серия S-AP5 |
| H12 | `.github/workflows/ci.yml`, `tests/ap1/environment/ci-secret-log.contract.test.ts` | любая правка = полная матрица; литерал стенда :93 | серия S-CI |
| H13 | `components/projectceo/project-workspace.tsx`, `contracts.ts`, `role-policy.ts` + `tests/projectceo-ui/roles.test.ts` | вкладки и capability | серия S-UI |
| H14 | `…/live-read-port.ts` + `tests/projectceo-integration/live-read-sanitization.test.ts` | санитизация чтения | серия S-LRP |
| H15 | `tests/pilot-evidence/executors/allowlist.json`, `tests/fixtures/cycle7/external-package.manifest.json` | digests; `status: pending` пинит gate-тест | серия S-PE |
| H16 | `.env.example`, `lib/env.ts`, `supabase/config.toml` | схемы API пинятся `environment.contract.test.ts:53-60`, `verify-runtime.mjs:13-18` | WP-03 без `config.toml` |
| H17 | `lib/project-intelligence/adapters/postgres/execution.ts` + `tests/projectceo-integration/static-request-bound-boundary.test.ts` | граница request-bound | WP-38 |
| H18 | ветка `release`; `tests/ap1/environment/bootstrap-disposable.zsh` (контракт `reject_production` :225) | production-граница | только владелец / не трогать |

---

## 7. Каталог пакетов работ (30 WP, P50 ≈ 55 РС инженера)

Полные карточки — `wp/WP-xx-*.md`. Владелец-only шаги карты (0.1, 0.2, 0.4, 0.5, 0.7, 0.8, 0.9б–г, 0.10
дашборд, 1.1, 1.5, 1.6, 1.8 подписи, 1.9 окно, 1.10, 2.2 решение, 2.8, 3.2, 3.5 переключение, 3.6) —
не WP, а входы в `OWNER_QUEUE.md`.

| WP | Название | Трек/шаг | Миграция | РС | Волна | Ждёт владельца |
|---|---|---|---|---|---|---|
| WP-01 | PR-триаж, `/api/health` отдаёт commit, dry-run список веток | 0.3, 0.11 | нет | 0,5 | W1 | Р1, Р10; удаление веток — Р8 |
| WP-02 | Хардкод стенда → `vars`, де-пин счётчика ledger в `ci.yml`, runbook «стенд на прогон» | 0.6 | нет (S-CI) | 1 | W1 | var в env `disposable-staging` |
| WP-03 | ПДн из `lib/env.ts`/`.env.example` → плейсхолдеры + полнота env-примера + тест | 0.12 | нет | 0,5–1 | W1 | Р9, значения в Vercel |
| WP-05 | Скрипт экспорта `market_harvest` с fail-closed на production + runbook | 0.9а | нет | 1 | W2 | Р6, исполняет владелец |
| WP-11 | Snapshot-tooling v2 (все схемы, детерминированный fingerprint, генератор дрейфа) | 1.2 | нет | 2 | W2 | Р12, запуск SQL |
| WP-12 | Reconciliation-пакет документов (классификация 23 миграций, коллизии, rollback, post-verify, мониторинг) | 1.3, 1.7 | нет | 3 | W3–W4 | снапшот |
| WP-13 | `adopt-production.zsh` + `baseline-adoption.sql` + контракт-тест | 1.3 | нет | 3–4 | W2–W3 | — |
| WP-14 | Миграция `legacy_adopted_hardening` + DB4 №57 | 1.3, 0.10 | **S-MIG #2** | 2–3 | W3 | Р7 |
| WP-16 | CI-джоба `adoption-rehearsal` + прогон на клоне | 1.4 | нет (S-CI) | 2–3 | W4→W5 | клон из backup, секреты env |
| WP-18 | Пакет Human GO: хеши RC, индекс evidence, черновики Approvals A–D | 1.8 | нет | 0,5 | W6 | Р14 |
| WP-21 | Посадка PR #124: rebase после #123, CI на HEAD, blind review, merge | 2.1 | **S-MIG #1** | 1 | W1 | Р11 |
| WP-22 | Предложение по модели моста M1 (enrollment vs legacy-id) | 2.2 | нет | 0,5 | W1 | Р11 |
| WP-23 | `sendProposal` требует platform approval, self-approval маркирован, UI «Согласовать КП» | 2.3 | нет (иначе S-MIG #6) | 3–5 | W3–W4 | Р11 |
| WP-24 | Адаптер читает legacy-паспорт и договор request-bound под RLS | 2.4 | нет | 3–5 | W4–W5 | — |
| WP-25 | BUG-05 (а): helper token-scoped + allowlist-тест + черновик принятия риска | 2.5а | нет | 2–3 | W2–W3 | Р26 |
| WP-26 | BUG-05 (б): страницы дизайнера → request-bound + RLS | 2.5б | возможно (S-MIG #5) | 4–6 | W5–W6 | — |
| WP-27 | Static-boundary тест TTL подписей ≤900 | 2.6 | нет | 0,5 | W1 | — |
| WP-28 | События ошибок, activation-отчёт, скрипт метрик AP7, шаблоны evidence | 2.7, 4.1 | нет | 2–4 | W3/W8 | Р22, adoption |
| WP-31 | AP6-инструменты: загрузчик пакета Ташкент, cookie-jar пяти ролей, digests | 3.1 | нет | 3–4 | W3–W4 | — |
| WP-32 | Прогон AP6 + sanitized receipt + отчёт; цикл 7 зелёный | 3.1 | нет | 3–6 | W5–W6 | партнёр, машина с supabase CLI |
| WP-33 | M3 №8: флип на `publish_baseline_atomic`, `_module_signatures('m3')` без сырых RPC | 3.3 | **S-MIG #3** | 2–3 | W5 | — |
| WP-34 | M4 №5 (TS `prerequisite_missing`) + №4 (тесты вехи под флагом V2/V3) | 3.3 | нет | 2 | W2 | — |
| WP-35 | M4 №2: замена `_module_signatures('m4_increment_1')`, DROP legacy-дверей | 3.3 | **S-MIG #4** | 2–3 | W6 | — |
| WP-36 | M4 №6 + BUG-04: роли из capability, тест паритета | 3.3 | нет | 1–2 | W2 | — |
| WP-38 | Мёртвый контур: grep-доказательство, удаление сырой `calculateChangeImpact`, «Поправка» к аудиту 12.08 | 3.4 | нет | 1 | W1 | — |
| WP-39 | HTTP-маршрут enroll (Р20 (а)) request-bound, CSRF, тесты | 3.5 | нет | 2–3 | W6–W7 | Р20 |
| WP-41 | Юрблок: privacy/terms/support из env, subprocessors, тест удаления аккаунта | 4.2 | нет | 1–2 | W5–W7 | текст юриста, Р23 |
| WP-K1 | HANDOFF / LAUNCH_CHECKLIST / conflict register / email README → актуальные факты | 0.13 | нет | 0,5–1 | W1 | Р2, Р13 |
| WP-K2 | Поправки К-1…К-5, К-12 в неканонические документы; runbook M4 под Р19/Р20 | 0.13, 3.5 | нет | 1 | W2 | — |
| WP-C | Канонические транскрипции подписанных решений — только оркестратор | 1.10, 2.8, К-15/16 | нет | 0,5–2 | по событию | Р15, Р16 |

---

## 8. Серийные группы (в полёте ровно один держатель)

- **S-MIG** (H1, H2): WP-21 → WP-14 → WP-33 → WP-35 → (WP-26) → (WP-23). Остальные с миграцией ждут в
  draft и при rebase переименовывают timestamp.
- **S-CI** (H12): WP-02 → WP-16 → (WP-02b по Р36).
- **S-CS** (H3): WP-21 → WP-36 → WP-23 → WP-33 → WP-39.
- **S-UI** (H13): WP-21 → WP-23 → WP-24.
- **S-RU** (H8): WP-21 → WP-23 → WP-28 → WP-41; один namespace в полёте.
- **S-LRP** (H14): WP-34 → (WP-39). **S-AP5** (H11): WP-33 → WP-35 → WP-39.
- **S-PE** (H15): WP-31 → WP-32. **S-CANON** (H9, H10): только WP-C.

---

## 9. План по неделям (A и B — рабочие сессии, ≤2 одновременно)

| Нед. | A | B | Филлеры | Гейты владельца |
|---|---|---|---|---|
| W0 | оркестратор: протокол и шаблон evidence (этот PR), метки в GitHub, merge #123 | — | — | Р1 |
| W1 | WP-21 → ждёт Р11 | WP-01 → WP-02 | WP-38, WP-27, WP-22, WP-K1 | Р2, Р3, Р10, Р11 |
| W2 | WP-11 → WP-13 | WP-36 → WP-34 → WP-03 | WP-K2, WP-05 | Р4, Р5, Р6, запуск snapshot SQL, Р12 |
| W3 | WP-14 (S-MIG #2) → WP-13 | WP-25 → WP-23 | WP-12, WP-28 | Р7; SMTP на клоне |
| W4 | WP-12 → WP-16 (PR) | WP-23 → WP-31 | — | клон из backup, секреты, dispatch |
| W5 | WP-33 (S-MIG #3), итерации репетиции | WP-24 → WP-26 | WP-41 | Auth; Р19, Р20 |
| W6 | WP-35 (S-MIG #4) → WP-18 | WP-26 → WP-32 / WP-39 | — | Approvals A, B |
| W7 | **freeze слияний в `main`** (окно adoption + 48 ч) | WP-39 / WP-41 в ветках | — | окно на prod, C → D |
| W8 | WP-C (DEC-040), readiness update | WP-K2, отчёт WP-32, WP-28 | — | DEC-040; Т3.5 по runbook |

Правило слота: освободившийся рабочий берёт филлер без хотспотов, а не тяжёлый WP чужой группы.

---

## 10. Правила разрешения конфликтов

1. Ветка `wp/WP-xx-slug` от `origin/main`; один PR на WP; squash-merge; draft до локальных гейтов.
2. Rebase только `git rebase origin/main`, перед «ready» и перед слиянием, если `main` тронул allowlist
   или любой хотспот; лишних rebase нет (каждый — прогон CI).
3. Ledger принадлежит держателю S-MIG. Регенерация только командой
   `sha256sum supabase/migrations/*.sql > tests/ap1/environment/migration-ledger.sha256`, затем
   `npx vitest run tests/ap1/environment/environment.contract.test.ts tests/layout-studio/integration/integration.test.ts`.
   Новая миграция — в `preExisting` с комментарием «К Layout Studio отношения не имеет». Timestamp новее
   последнего в `main`; при rebase — `git mv` на новый timestamp с пометкой в PR. Применённые миграции
   не переименовываются никогда.
4. `BLOCKED_HOTSPOT`: рабочий останавливается без правок, пишет в PR файл, строки, причину, минимальный
   diff; оркестратор расширяет allowlist (если хотспот свободен), выделяет follow-up или ждёт слияния
   держателя. Правка «пока никто не видит» = отказ в ревью.
5. Count-pinned тесты меняет только WP, который меняет считаемое множество, в том же PR, с таблицей
   «пин: было → стало → основание (документ/DEC)». Без основания пин не меняется (A6 §5.1).
6. Drive-by запрещён: чужой lint-fail → `BLOCKED_HOTSPOT`; гонка одинаковых правок — первый влитый
   побеждает, второй при rebase удаляет дубль.
7. Канон (H9, H10) — только WP-C по подписанному документу; исключение — append-раздел «Поправка …» в
   дата-документах, явно названный в allowlist.
8. `ru.ts`: ключи только в конец своего namespace; не переформатировать; один WP на namespace.
9. Production и `release`: рабочим не выдаются prod-секреты и Supabase MCP; контракты `reject_production`
   и `HOSTED_STAGING_PRODUCTION_REF_REJECTED` остаются тестами; `release` двигает только владелец
   (оркестратор готовит команду `git push origin <RC_SHA>:release`).
10. Экономия CI: `npm run release:check` перед каждым push; DB4/DB5 локально для WP с SQL
    (`apt-get install zsh ripgrep`, `PI_DB_IMAGE=postgres:16-alpine zsh tests/db4/run.zsh`, затем 17);
    один push на веху; строка `@claude` в PR запрещена; недельный контроль расхода через `actions_list`.
11. AP5 (`retries: 0`): красный классифицирует оркестратор — инфраструктура (`supabase start`,
    `playwright install`, сеть) → один re-run с пометкой в evidence; продукт → чинит WP; повторная
    нестабильность звена → отдельный WP по харнессу, не ретраи.

---

## 11. Definition of Done на WP

Файл `docs/audits/wp/WP-xx_EVIDENCE.md` по шаблону `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`: основание
(трек/шаг, DEC/Р); allowlist по факту (`git diff --name-only origin/main...HEAD`); хотспоты, которых
коснулся, с обоснованием, и подтверждение «остальные не тронуты»; таблица пинов; миграция (timestamp,
строка ledger, DB4/DB5-сценарий, S-MIG #); локальные гейты с кодами выхода и версиями node/npm; CI — run id
каждой джобы; grep-проверки там, где карта ссылается на код; «не сделано / вынесено» с причиной; blind
review (сессия, дата, вердикт, закрытие замечаний). Тело PR — те же секции коротко.
Обязательные проверки: `lint / typecheck / test / build`, `DB4 on postgres:16-alpine`,
`DB4 on postgres:17-alpine`, `DB5 on postgres:16-alpine`, `DB5 on postgres:17-alpine`,
`AP5 authenticated browser matrix`; `cycle 7 evidence (informational)` — красный ожидаем до WP-32; замечания
Claude Code Review закрыты или отклонены с причиной. Blind review обязателен для WP с миграцией и меткой
security (WP-14, WP-23, WP-26, WP-33, WP-35, WP-39) и для WP-C; docs-only — gates + ревью оркестратора.

---

## 12. Риски исполнения агентами

| Риск | Митигация |
|---|---|
| Биллинг Actions не восстановлен | W1 верифицируется локально; PR в draft; «ready» только после Р1; первым — merge #123 |
| Исчерпание квоты (двойные прогоны до #123, AP5 на docs-only) | #123 первым; локальный `release:check`; один push на веху; де-пин ledger в `ci.yml`; Р36; недельный контроль |
| Два агента чинят одно и то же | allowlist-дисциплина, запрет drive-by, К-пункты распределены, «первый влитый побеждает» |
| Дрейф ledger / коллизия timestamp | S-MIG; регенерация командой; переименование при rebase; `environment.contract.test.ts` |
| Нестабильность AP5 | классификация оркестратором; один re-run; повтор → WP по харнессу |
| Карта ссылается на уже несуществующий код | правило grep-first: «цель не найдена → no-op с доказательством» (образец WP-38) |
| Рабочий касается production | prod-секретов нет; Supabase MCP не подключается; контракты `reject_production` остаются тестами |
| Пятичасовой лимит сессий | ≤2 рабочих + оркестратор; ревью последовательно; WP > 3 РС режутся по коммитам; `send_later` вместо опроса; resume, не пересоздание |
| «Подгонка» count-pinned тестов | таблица пинов с основанием; ревьюер проверяет каждый |
| Шторм конфликтов в `ru.ts` / workspace | S-RU / S-UI; панель Passport в отдельном компоненте (запрос при ревью #124) |
| Очередь стоит на `BLOCKED_ON_OWNER` | пул филлеров ≥3 на каждую неделю |
| Клон production с живыми ПДн в репетиции | environment `adoption-rehearsal`, секреты только в CI, удаление клона после receipt |
| `@claude` в PR запускает лишние прогоны | запрет строки в шаблоне PR; ревью только blind-сессией |
| WP-33 расползается в DEC-027 | явный запрет `command-contract.ts:575` и `modules/package/orchestration.ts` |
| Freeze-неделя ломает поток | объявлена заранее; рабочие в ветках; после окна — rebase-волна под контролем оркестратора |

---

## 13. Решения владельца

Р1–Р28 — в `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Дополнительно для этого ТЗ:

| # | Решение | Рекомендация |
|---|---|---|
| Р29 | Потолок бюджета: одновременных сессий, расход Claude-сессий в неделю и бюджет GitHub Actions | 2 рабочих + 1 оркестратор; недельный потолок Claude-сессий назначает владелец, при 80 % новые сессии не создаются; бюджет Actions $100/мес с жёсткой остановкой |
| Р30 | Исключение из правила роста Loops HQ для `remhaos-orchestrator-loop` | да, с датой заката (закрытие Трека 3 или 90 дней) и строкой в реестре |
| Р31 | Полномочия слияния оркестратора | docs-only и не-миграционные PR при зелёном CI + ревью; остальное — владелец |
| Р32 | Поток S: кто выпускает контент на production | контентные PR при зелёном CI сливает оркестратор в `main`; продвижение в `release` — владелец раз в неделю |
| Р33 | Модели по ролям | оркестратор и ревью — самая сильная доступная; рабочие — по сложности WP |
| Р34 | Коннекторы рабочих сессий | без Supabase и без production-секретов; GitHub только через `outcome_branch` |
| Р35 | Ежедневное окно владельца на `OWNER_QUEUE.md` | 15 минут в день |
| Р36 | WP-02b: AP5 не запускать на docs-only PR | да: детектор `ci.yml:103-107` консервативен |
| Р37 | Blind-review обязателен для миграций/security/CI/канона | да |

---

## 14. Запуск механизма (отдельное GO владельца после Р1 и слияния этого PR)

1. **Регистрация петли (после Р30).** Строка в Notion «📋 Реестр петель»: `remhaos-orchestrator-loop`;
   частота — по будням каждые 6 часов в рабочем окне и раз в выходные; ворота полезности «≥1 закрытый WP
   или ≥1 снятый блокер за 7 дней»; дата заката. Heartbeat `YYYY-MM-DD-remhaos-orchestrator-loop-ok|fail.md`
   в Drive `Selena Loops/_system/heartbeat`.
2. **Сессия оркестратора.** `create_session` в среде `Default`: репо продукта, `permission_mode: auto`,
   тег `remhaos-orchestrator`, промпт = `docs/execution/ORCHESTRATOR.md`; коннекторы — GitHub, Google Drive
   (heartbeat), Supabase только для read-only advisors на стендах.
3. **Routine.** `create_trigger` с `persistent_session_id` = сессия оркестратора и расписанием из п.1;
   между срабатываниями оркестратор сам ставит `send_later` на 60–120 минут, пока есть активные WP.
4. **Подписки.** `subscribe_pr_activity` на каждый открытый PR программы.
5. **Рабочие сессии.** Только оркестратор: `create_session` с промптом из `wp/WP-xx-*.md`,
   `outcome_branch = wp/WP-xx-<slug>`, теги `remhaos-wp`, `WP-xx`, `permission_mode: auto`, без
   production-секретов и без коннектора Supabase; модель по Р33.
6. **Ревью-сессии.** Read-only blind-review по образцу владельца (теги `blind-review`, `WP-xx`).

---

## 15. Проверка

- ТЗ принято: файлы раздела «Сопутствующие» в репо; PR docs-only зелёный; строка в реестре петель (после Р30).
- Механизм жив: `list_triggers` — `remhaos-orchestrator-loop`, `last_run SUCCEEDED`; `list_sessions` —
  оркестратор `RUNNING/IDLE`, рабочие с тегами `WP-xx`; heartbeat за день есть.
- Конвейер работает: за первую неделю ≥3 WP `MERGED`, `STATUS.md` обновляется ежедневно, ни одного
  конфликта ledger, ни одного обращения к production (в `docs/audits/wp/*` и логах сессий нет production-ref).
- Сайт не останавливался: Vercel production deployment неизменен между окнами adoption; `/api/health` отвечает.
- Гейты: каждый слитый WP — `lint/typecheck/test/build`, DB4/DB5 PG16+17, AP5 без skip; для миграций —
  вердикт blind-review в PR.
