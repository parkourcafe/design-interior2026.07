# RemHaOS — финальный аудит (25.09.2026)

**Первая строка (состояние PR и CI на момент аудита):** открыты только два draft-PR WP-13 — #159
(`wp/wp-13-clone-only-executor`) и #185 (`codex/wp13-atomic-clone-engine`); оба не сливаются этим
аудитом. **CI на `main` не исполняется:** с `07e186d`/`35f115b` (18.09) у всех четырёх workflow
остался только `workflow_dispatch`, Vercel `git.deploymentEnabled=false`. Последний прогон `ci.yml`
— run 733 (20.09, ветка `wp/wp-13-safe-control`) — **failure**; на слияниях #205–#209 в `main`
CI не запускался ни разу.

**Режим:** AUDIT ONLY по `docs/audits/FINAL_AUDIT_TZ_2026-09-25.md` (редакция ТЗ 18.08).
**Снимок:** `main` = `737795d` (merge #209, 23.09.2026); ветка аудита `claude/final-audit-kg4xd8`
отличается только файлами в `docs/audits/`. Миграций 127 (+README), ledger
`tests/ap1/environment/migration-ledger.sha256` сходится **127/127**. Журнал решений DEC-001…DEC-039,
нумерация сплошная.
**Уровни доказательств (DEC-016):** VERIFIED / CI_EVIDENCED / CODE_PRESENT / DOC_TARGET / NOT_BUILT /
NOT_VERIFIED(причина). `DIRTY_SNAPSHOT` — доказательство, снятое с незакоммиченного дерева. Процентов нет.

---

## 1. Резюме

**Вердикт.** Код `737795d` впервые подтверждён **полным локальным прогоном на чистом дереве точного
коммита**: lint, typecheck, 2322/2322 unit-теста без skip, build, DB4 и DB5 на PostgreSQL 16 и 17 (§2.1). Это закрывает
главную слабость свидетельств WP-32/DEPSEC (снимались с грязного дерева и не на объединённом коммите).
Не закрыто AP5 (браузерная матрица) — в этой среде не исполнимо честно.

К **пилоту с реальными клиентами** продукт **не готов** из-за трёх дефектов M1 в публичном контуре
(утечка паспорта с контактами по `/b/`, затирание принятых рисков повторной отправкой брифа,
редактирование уже отправленного/принятого КП) и выключенного CI. К **production** не готов ни
одним слоем: production Supabase по-прежнему живёт на другой линии миграций (23 миграции, ни одной
`projectceo_*`), решения DEC-040 (снятие PLATFORM_FOUNDATION для production) нет.

Отдельно: в `main` влита программа **R1** (22 миграции `r1_*`: AV, карантин, lifecycle, GLB-вьюер,
внешнее ревью), содержательно реализующая **DEC-026, который остаётся PROPOSED**. Приватна и не
подключена к приложению, но стоит в основной цепочке миграций и применится любым `db push`.

**Топ-5 рисков**

1. **BUG-01 (blocker для пилота, 152-ФЗ):** `/b/[token]` отдаёт паспорт с телефоном/email/городом
   по intake-токену **любого** проекта, без фильтра Входа Б и без срока/отзыва.
2. **CI и деплой выключены** — ни один гейт репозитория (включая «обязательный» DB5 по DEC-032 и
   новый dependency-security тест) не исполняется на слияниях (GOV-03).
3. **Код сверх подписанных решений:** R1 = DEC-026 без ратификации; DWG/SKP/GLB в `_module_signatures('m3')`
   вне перечня DEC-024; четыре R1-RPC выданы `authenticated` вне модульного выключателя (DOC-01, SEC-05).
4. **Целостность M1:** повторная отправка брифа откатывает статус и затирает принятые risk-карточки;
   отправленное/принятое КП молча редактируется; approval DEC-010 только в server action (BUG-02…05).
5. **Права пакетных ролей:** architect через enrollment получает 18 прав (включая `publish_release`),
   по приглашению — 6; старые широкие проектные гранты до WP-32 не отозваны и не инвентаризуемы
   (SEC-01/02).

## 2. Сводная таблица по слоям

### 2.1 Гейты (прогон аудита, чистое дерево `737795d`, 25.09.2026 UTC)

| Гейт | Результат | Уровень |
|---|---|---|
| `npm ci` | OK, `npm audit` 0/0/0/0/0 (prod и full) | VERIFIED |
| `npm run lint` | exit 0 | VERIFIED |
| `npm run typecheck` | exit 0 | VERIFIED |
| `npm run test` | **Чистый повтор: 257/257 файлов, 2322/2322 pass, 0 skip** (с zsh и docker). Первый прогон дал 9 ложных падений в 4 файлах, спавнящих `zsh`, которого в среде ещё не было (BUG-17) | VERIFIED |
| `npm run build` | exit 0 | VERIFIED |
| `test:db4` PG16 | exit 0 (`DB4_PRODUCT_BRAIN`, `DB4_IMPACT_UPGRADE`, `DB4_TELEGRAM_UPGRADE` HARNESS_OK) | VERIFIED |
| `test:db5` PG16 | exit 0, `DB5_EXECUTION_HARNESS_OK` | VERIFIED |
| `test:db4` PG17 | exit 0 (`DB4_PRODUCT_BRAIN`, `DB4_IMPACT_UPGRADE`, `DB4_TELEGRAM_UPGRADE` HARNESS_OK) | VERIFIED |
| `test:db5` PG17 | exit 0, `DB5_EXECUTION_HARNESS_OK` | VERIFIED |
| `test:cycle7` | 3/3 pass — но гейт проверяет только контракт манифеста, подготовленного оператором (DOC-06) | VERIFIED (как тест), не приёмка |
| AP5 (Playwright) | не запускалось | NOT_VERIFIED: `run-local.zsh` принимает только Colima-сокет или раннер GitHub Actions; подмена `GITHUB_ACTIONS` дала бы нечестное доказательство |

### 2.2 Слои

| Слой | Статус | Уровень | Ключевые ссылки | Дыры |
|---|---|---|---|---|
| Governance | Журнал DEC-001…039 сплошной; AGENTS.md отстал от DEC-038/039 | VERIFIED | `REMHAOS_DECISION_LOG_v1.md`; `AGENTS.md:178-195` | GOV-01…09 |
| Platform | project_facts, Graph v1, approvals, ai_calls, workflow_templates, action registry (зеркало) — построены; `PLATFORM_FOUNDATION = ACTIVE_FOR_DISPOSABLE_PILOT` (DEC-038), DEC-040 нет | CODE_PRESENT + DB4 VERIFIED | `20260824130000…170000`; `action-registry.ts:10-14` | `ai_calls.cost_rub`/токены всегда NULL; `list_workflow_templates` не вызывается из TS; FK на ревизию в facts нет |
| M1 | Легаси-контур работает в unit-тестах; публичный контур с дефектами | CODE_PRESENT, unit VERIFIED | `lib/brief`, `lib/risks`, `lib/pricing`, `app/api/intake/*`, `app/b`, `app/p` | BUG-01…11; Вход Б частично построен до гейта SMTP без INV-B1…B6 |
| M2 | Шесть шагов конвейера построены; DEC-022 хеш совпадает | CODE_PRESENT + DB4 VERIFIED | `command-contract.ts:367-513`; `canonical-signature.test.ts:25` | AP6 внешний пакет — только до handoff и на DIRTY_SNAPSHOT; ревью executor-скриптов устарело (runner вырос втрое) |
| M3 | P0 без файлов и без conflict review; backlog №8 закрыт кодом | CODE_PRESENT + DB4 VERIFIED | `20260911160000`; `m3-surface-matrix.test.ts` 8/8 | DEC-027 conflict gate NOT_BUILT; baseline/release без persisted handoff (BUG-13); R1 сверх DEC-026 |
| M4 | Инкремент 1/1.5, V1 Impact, recovery DEC-037, production switch построен и **не включён**; V2/V3 закрыты двумя границами | CODE_PRESENT + DB5 VERIFIED | `20260817010000`; `command-service.ts:317-329`; `20260810070000:30` | Worker: классификация отказов (BUG-14/15); DB5 «обязательный» не исполняется в CI; runbook устарел |
| Telegram A7 | TG0/TG1 PASS, TG2/TG3 NOT PROVEN, TG4 BLOCKED_EXTERNAL_CREDENTIALS | DOC + CODE_PRESENT | `REMHAOS_TELEGRAM_BRIDGE_RUNBOOK.md:22-26` | Четыре дыры TG2 открыты; два параллельных контура (`remhaos_channel` / `remhaos_integration`) |
| Security | SECURITY DEFINER с `search_path` — 358/358; RLS + force во внутренних схемах; секретов в истории нет; npm audit 0 | VERIFIED (статически) | см. §3 | SEC-01…11 |
| Production | 23 миграции другой линии; advisors: 11 SECURITY DEFINER исполняемы `authenticated`, 13 таблиц RLS без политик, leaked-password protection выключен | VERIFIED (управляющий API, только метаданные) | Supabase `ztnycrchwxqczqbyegnp` | Ни одна `projectceo_*` не применена; Supabase Preview привязан к production |

## 3. Матрица ролей

| Роль (UI ↔ БД) | Может вызвать (БД) | Предлагает UI | Где закрыто | Доказательство | Расхождение |
|---|---|---|---|---|---|
| owner ↔ owner_lead | 20 capabilities + `manage_project_integrations` | 20 | RPC `_authorize_project_human`/`_authorize_package_human` + `can()` в приложении | CODE_PRESENT (`20260826010550:68-105`, `role-policy.ts:14-72`) | UI-зеркало без `manage_project_integrations`; тест паритета сверяет со старой миграцией `20260802030000` (SEC-09) |
| architect (проект) | 18, включая publish_baseline/release, manage_budget | те же 18 | RPC | CODE_PRESENT | — |
| architect (пакет) | по приглашению 6 (`_package_role_capabilities`), по WP-32 enrollment — **18** (`20260922183823:140-142`) | одна роль на 18 прав; M1 и manage_access скрыты `hasProjectScope` | `_authorize_package_human` | CODE_PRESENT | Два шаблона для одной роли (SEC-01) |
| builder | view, register_source, acknowledge_release, create_change, upload_photo_evidence | те же | `submit_change_request` только builder (`20260828011000`); `command-service.ts:995` | CODE_PRESENT | — |
| client ↔ client_approver | view, review_selection, acknowledge_release, create_change, review_milestone | вкладка changes без кнопки | RPC отклоняет create_change | CODE_PRESENT | «мёртвое» право create_change в карте |
| guest | `read_guest_release(bytea)` (anon+authenticated) | зеркало обещает acknowledge | sha256-дайджест токена, срок ≤ 7 дней CHECK, отзыв | VERIFIED (статически) | ack гостем NOT_BUILT при флаге `allowAcknowledgement` |
| designer (legacy M1) | `public.*` через RLS `is_studio_member`; в ProjectCEO → owner_lead через enroll | дашборд M1 | RLS | CODE_PRESENT | Роль неявная; `is_studio_member` исполним anon (SEC-07) |

Покрытие AP5 настоящими сессиями — NOT_VERIFIED в этом аудите (последнее свидетельство: 31/31
на DIRTY_SNAPSHOT, `docs/audits/wp/WP-32_EVIDENCE.md`).

## 4. Реестр багов

Фиксы **не применены**. Severity: blocker / major / minor.

| ID | Sev | Файл:строка | Что не так | Как воспроизвести | Предлагаемый фикс |
|---|---|---|---|---|---|
| BUG-01 | **blocker** (для пилота) | `app/b/[token]/page.tsx:21-27` | Паспорт с контактами отдаётся по intake-токену любого проекта: нет `designer_id is null`, нет проверки `intake_expires_at`/отзыва. Проекты Входа А видны по `/b/` | Токен проекта Входа А → `/b/<токен>` | Фильтр как в `getProjectByIntakeToken` + `designer_id is null`; не рендерить контакты |
| BUG-02 | major | `app/api/intake/submit/route.ts:26-80`; `app/i/[token]/page.tsx:26` | Нет проверки статуса: повторная отправка удаляет risk_cards (включая accepted) и откатывает статус в `brief_completed` даже после принятия КП | Принять КП → POST `/api/intake/submit` с тем же токеном | Отклонять вне {created, brief_sent, brief_in_progress}; расширить `completed` на странице |
| BUG-03 | major | `app/dashboard/projects/[id]/proposal/actions.ts:61-80` | `saveProposal` без проверки статуса: отправленное/принятое КП молча меняется у клиента | Отправить КП → изменить → сохранить → `/p/` | Отклонять при `status≠draft`; изменения — через version+1 |
| BUG-04 | major | baseline политика `proposals_studio_all`; `actions.ts:190` | Approval DEC-010 только в server action; член студии через PostgREST ставит `sent`; `sendProposal` откатывает `accepted→sent` | `update proposals set status='sent'` клиентом Supabase | Переход draft→sent через RPC/триггер с проверкой approval; `.eq("status","draft")` |
| BUG-05 | major (152-ФЗ) | `app/api/intake/submit/route.ts:21-29` | Сервер не проверяет согласие на ПДн и схему ответов | Прямой POST без `consent` | Zod-схема ответов + серверная проверка согласия |
| BUG-06 | major | `app/api/intake/upload/route.ts:9-49` | Публичная загрузка: без rate limit, лимита размера, MIME allowlist; `file.name` в ключе Storage; `attachments` без ограничения | Серия multipart-POST с одним токеном | Opaque key, лимиты размера/числа, allowlist, rate limit |
| BUG-07 | major | `lib/rate-limit.ts:17-40` | Все лимиты fail-open; таблицы `public.rate_limits` нет в цепочке миграций репозитория (`20260716071024:20`). В production таблица **есть** (advisors 25.09) — значит, лимиты не работают во всех средах, собранных из репо | >10 запросов к `/api/auth/register` на disposable | Аддитивная миграция `rate_limits` (RLS deny) + проверка наличия; fail-closed для LLM-маршрутов |
| BUG-08 | major | `lib/llm/zai.ts:29`, `lib/llm/yandex.ts:35` | `fetch` без таймаута: зависший провайдер роняет функцию до фолбэка на правила; паспорт не сохраняется | Провайдер, отвечающий > maxDuration | `AbortSignal.timeout` + `maxDuration` маршрута |
| BUG-09 | minor | `actions.ts:38-58` | Approval не привязан к ревизии паспорта/версии КП; незачисленный проект получает вводящее в заблуждение `approval_required` | Повторный бриф после approval | `subjectId` = ревизия/версия; отдельная ошибка «не зачислен» |
| BUG-10 | minor | `app/api/proposal/respond/route.ts:52-69` | «Первый ответ окончательный» — на проект, не на версию; TOCTOU без уникального индекса | Два параллельных POST | Частичный уникальный индекс или RPC с блокировкой |
| BUG-11 | minor | `app/p/[public_token]/page.tsx:52`; `proposal/page.tsx:98` | `proposal_viewed` считает просмотры дизайнера; сложность всегда `mid`, `lib/pricing/complexity.ts` мёртвый | — | Исключать владельца; подключить или удалить complexity |
| BUG-12 | major | `lib/project-intelligence/delivery/projectceo/command-service.ts:983-986` | `expectedLatestVersionId` берётся из `latestBaseline.graphVersionId`, а SQL сравнивает с `project_workflows.latest_version_id`: после `publish_source_snapshot` первый baseline из приложения получит `VERSION_STALE`. Вероятная причина остановки внешнего Ташкента на handoff | snapshot → решения → `publish_baseline` через `/api/projectceo` | Отдавать `latestVersionId` в workspace-read и передавать его; DB4-кейс «snapshot → baseline» |
| BUG-13 | major (governance) | `20260825030000`, `20260911150000` | Baseline/release не требуют persisted handoff — противоречит A5 §2 / DEC-024 «без обходов» | Kora публикует baseline без handoff | Гейт по handoff или решение владельца (см. Q4) |
| BUG-14 | minor | `20260911160000:37-74` | Проверка approved до replay и до блокировки: повтор после замены пакета вернёт ошибку вместо сохранённого результата; окно TOCTOU | Baseline → замена пакета → повтор с тем же ключом | Replay-lookup первым, проверка внутри делегата после `FOR UPDATE` |
| BUG-15 | minor | `lib/project-intelligence/workers/change-impact/runner.ts:250-266` | `forbidden`/`unauthenticated` классифицируются как постоянный отказ строки → вся очередь в dead-letter от одной ошибки конфигурации | Отозвать право на policy-bound дверь у service_role | Process-level throw до записи |
| BUG-16 | minor | `runner.ts:297-313`, `:99`; `20260813030000:212-237` | Неудача записи отказа → вечный `failed_retrying` вне `NEEDS_ATTENTION`; upsert может вывести строку из dead-letter без redrive (против DEC-036) | см. ID | Исход `failure_unrecorded`; `where status <> 'dead_letter'` |
| BUG-17 | minor | `tests/pilot-evidence/*.test.ts`, `tests/ap1/environment/environment.contract.test.ts` | Тесты спавнят `zsh` без `skipIf`: в среде без zsh — 9 ложных падений (прогон аудита) | `npm test` без zsh | `describe.skipIf(!zshAvailable)` как в `adopt-production.contract.test.ts:126` |
| BUG-18 | minor | `app/api/integrations/telegram/webhook/route.ts:454-456`; `lib/integration-gateway/telegram/webhook.ts:17-24` | При `REMHAOS_INTEGRATIONS_ENABLED=true` A7-обработчик пропускается целиком; integration-контур отвечает 400 на непривязанный чат и транзиентные ошибки → повторы Telegram | — | Решение о каноническом контуре (Q6); 200/503 по смыслу |

Мелкие дефекты, не вынесенные в таблицу: release-artifact runner без DLQ (`runner.ts:121-124`);
`IMPACT_WORKER_MAX_ROWS=NaN` без валидации; blast-radius guard `open_v1_impact_production` не знает
`record_change_impact_worker_failure`; `session_id` в SQL executor-скрипта без UUID-проверки
(`external-package-runner.zsh:474`, disposable); `publish_version` не отозван у `authenticated`
(`20260716073000:3111`); i18n нарушен (~160 кириллических строк вне `ru.ts`: `passport-view.tsx`,
`wizard.tsx`, `setup/form.tsx`, `proposal/editor.tsx`).

### 4.1 Безопасность (SEC)

| ID | Sev | Где | Что | Фикс |
|---|---|---|---|---|
| SEC-01 | major | `20260922183823:140-142` vs `20260802090000:16-40` | Пакетный architect через enrollment — 18 прав, по приглашению — 6 | Решение владельца (Q2) + DB-тест паритета шаблонов |
| SEC-02 | major | `WP-32_RECONCILIATION_2026-09-22.md:314-318,364` | Широкие проектные гранты до WP-32 не отозваны, происхождение не записано | Инвентаризация по `command_records` + отзыв по списку владельца |
| SEC-03 | major | Supabase `ztnycrchwxqczqbyegnp` (advisors) | В production 11 SECURITY DEFINER-функций M1-runtime исполнимы `authenticated`; 13 таблиц `market_harvest`+`rate_limits` с RLS без политик (deny — допустимо, если намеренно); leaked-password protection выключен | Сверить с намерением; включить leaked-password protection (дашборд) |
| SEC-04 | minor | `lib/supabase/token-scoped.ts:6-26`; `plan-upload/route.ts:48-53,82` | service_role для аутентифицированных операций человека (plan-upload, account-delete, invite-accept, task-status); сырое `uploadError.message` клиенту | Request-bound клиент/RPC; коды ошибок |
| SEC-05 | minor | `20260912100000:318-319`, `20260920150000:156`, `20260920160000:78` | Четыре R1-RPC выданы `authenticated` вне `_module_signatures` и матриц поверхности | Модульный гейт или revoke до решения (Q1) |
| SEC-06 | minor | `tests/ap1/environment/enable-*.sql` | Скрипты «только для disposable» не отсекают production сами (только обёртки) — касается и DEC-039 V2/V3 | Guard по маркеру disposable-БД внутри скрипта |
| SEC-07 | minor | `20260716071024:497-512` | Унаследовано: `grant all` на `public.*` для anon, `is_studio_member` исполним anon, токены в открытом виде без срока | Аддитивный revoke; дайджесты токенов; TTL |
| SEC-08 | minor | `app/api/health/route.ts:18-27` | Публичный health отдаёт SHA, LLM-провайдера, наличие service key | Урезать до `status` |
| SEC-09 | minor | `tests/projectceo-ui/roles.test.ts:13-15` | Тест паритета ролей закреплён на устаревшей миграции | Сверять с последним `create or replace` |
| SEC-10 | minor | `lib/integration-gateway/telegram/observability.ts:58-63` | `chatRef` — sha256 без соли, обрезанный до 12 hex — обратим словарём | HMAC с серверным ключом |
| SEC-11 | minor | `lib/supabase/admin.ts:1` | Нет `import "server-only"` (сейчас в клиент не попадает — VERIFIED grep) | Добавить |

Проверено и в порядке (VERIFIED статически): `set search_path` у всех SECURITY DEFINER; RLS + force
во внутренних схемах и revoke схем у anon/authenticated; append-only триггеры; идемпотентность
`_replay_or_null`; CSRF same-origin; fixture mode запрещён в production; signed URL TTL ≤ 900 с;
`timingSafeEqual` для секретов вебхуков; в логах нет токенов/PII; **секретов в дереве и в 271
доступной ревизии нет** (клон shallow); `npm audit` 0.

## 5. Реестр расхождений документов и кода

По правилу старшинства (`AGENTS.md:18-28`) журнал решений старше повествования.

| ID | Документ | Код | Кто прав | Что править |
|---|---|---|---|---|
| DOC-01 | DEC-026 PROPOSED; DEC-024 (форматы M3: PDF/JPG/PNG/CSV/XLSX) | R1: 22 миграции `r1_*`, AV/карантин/lifecycle/GLB/внешнее ревью; DWG-пары и sidecar в `_module_signatures('m3')` (`20260915191820:21`, `20260916023137:19`, `20260912110000:955`); основание — «единое ТЗ §6.1 / INT-R1», которого в репо нет, и «owner accepted in this conversation» | Журнал | Записать DEC (ратифицировать DEC-026 или «R1 только private/disposable»); вывести DWG/SKP/GLB из M3-сигнатур до решения |
| DOC-02 | `AGENTS.md:178-195` (V2/V3 NOT AUTHORIZED ни в одной среде; PLATFORM_FOUNDATION=BLOCKED) | DEC-038/039 + `enable-m4-v2-v3.sql`, флаг `REMHAOS_M4_V2_V3_ENABLED` | Журнал | Переписать абзацы со ссылками на DEC-038/039; заголовок «Charter v0.4» → v0.5 |
| DOC-03 | DEC-032 «DB5 — обязательное задание CI»; `ci.yml:154` | Все workflow только `workflow_dispatch` (`07e186d`) | Журнал (решения об отмене нет) | DEC об отключении CI или вернуть `pull_request` для gates+database |
| DOC-04 | `ci.yml:720,745` (90 миграций), `ci.yml:444` (захардкожен ref стенда) | 127 миграций | Код | Число из ledger, ref из `vars` |
| DOC-05 | `REMHAOS_READINESS_MATRIX_v1.csv` | Строки 8/20/21 ломают CSV; строки 10/12/16 ложны (registry, ai_calls, integration gateway есть); строка 19 «83/100» против DEC-016 | Код / журнал | Пересобрать матрицу по коду, без процентов |
| DOC-06 | `AGENTS.md:146`, DEC-024 «`test:cycle7` красный намеренно»; комментарий `vitest.cycle7.config.ts` «подтверждает завершённость M2 P0» | Зелёный 3/3 на манифесте оператора; runtime не запускается | Журнал | Решение (Q5): вернуть гейт в красный до runtime-приёмки или уточнить смысл |
| DOC-07 | `M4_V1_PRODUCTION_RUNBOOK.md` §4, `:136`; `worker-change-impact.yml:10-16` | Поле `calculatedBlocked`; три строки вместо «ровно двух»; нет `failedDeadLetter` и redrive; расписания нет | Код | Обновить runbook и комментарий workflow |
| DOC-08 | `M3_PRODUCTION_HARDENING_BACKLOG.md` №8, `M4_PRODUCTION_HARDENING_BACKLOG.md` №2/4/5/6 | Закрыты кодом (`20260911160000`, `20260911170000`, WP-36) | Код | Закрыть строки со ссылками на коммиты |
| DOC-09 | `CLAUDE.md` (исторический): P4 «до готового КП», S3 «нет accepted», Вход Б «только после SMTP» | `ru.ts:35` «до брифа, цены и КП»; `accepted` + `/api/proposal/respond` есть; `/b/` и self-brief построены без INV-B1…B6 | AGENTS.md / журнал | Решение по Входу Б (Q3); CLAUDE.md не переписывать — пометить в AGENTS.md |
| DOC-10 | Carry-over 23.08: BUG-11 (`tests/db5/90_default_deny_after.sql:105` «три двери V1»), BUG-12 (AP5 не проверяет текст `ru.ts:1729`), BUG-13/DOC-04 (матрица «24-file»), DOC-05 (`M2_CLOSEOUT:25` «четыре»), DOC-08 (DEC-027 gate — заглушка) | Не исправлены | — | Исправить формулировки; DEC-027 — см. M3 |
| DOC-11 | `R1_09_EXTERNAL_REVIEW_STORAGE_EVIDENCE.md:9` → `20260913023000` | Файл `20260920140000_r1_external_review_storage_context.sql` | Код | Поправить ссылку |
| DOC-12 | Миграции `20260826056000…059000` (минуты 60–90) и 20 миграций, добавленных после более поздних меток | Требуют `--include-all` на применённой базе | — | Зафиксировать в runbook adoption |

### 5.1 Судьба находок прошлых аудитов (23.08 и 08.09)

| Находка | Статус на `737795d` | Доказательство |
|---|---|---|
| BUG-01/02/03 (23.08) | FIXED | `6ea2dfd`; `run-concurrency.zsh:139`; `runner.ts:216`; TTL 900 + тест `fcc32f2` |
| BUG-04 (роли списком) | FIXED | WP-36, `command-service.ts:1097-1102` → `can()` |
| BUG-05 (service_role в страницах) | CHANGED | прямых `createAdminClient` нет; 45 вызовов `createScopedServiceClient` с теми же правами; риск принят (RISK_ACCEPTANCE 09-09) |
| BUG-06/07/08 (мёртвый контур) | FIXED | `f08c018`, `7ed4b11`; grep → 0 |
| BUG-09/10 | FIXED | `M4_V1_PRODUCTION_RUNBOOK.md:98`; `ci.yml:340-341` |
| BUG-11/12/13, DOC-05, DOC-08 | OPEN | см. DOC-10 |
| DOC-09 (#97) | FIXED | `eff333f` |
| 08.09 №1 (Actions заблокирован биллингом) | CHANGED | CI и Vercel выключены намеренно (`07e186d`, `35f115b`) — DOC-03 |
| 08.09 №3 (production на другой линии миграций) | OPEN | 23 миграции, ни одной `projectceo_*` (Supabase API, 25.09) |
| Roadmap 0.6 (ref стенда в CI) | OPEN | `ci.yml:444` |
| Roadmap 0.12, 0.13 | FIXED | `e5e8d79`; `fd7b0fe` |
| Roadmap 2.3 (sendProposal → approval) | FIXED в приложении | `c91c5b3`; но БД-граница нет — BUG-04 |
| Roadmap 3.4 | FIXED | `7ed4b11` |
| Трек 1 (production adoption) | NOT_BUILT | DEC-040 нет |
| 0.3–0.5, 0.7–0.11 (внешние панели) | UNVERIFIABLE | нет доступа сессии |

## 6. Реестр «не проверено»

| Что | Причина |
|---|---|
| AP5 браузерная матрица на `737795d` | Скрипт принимает только Colima или GitHub Actions; CI выключен |
| Hosted-приёмка, внешний пакет M2→M3→M4 целиком | Требует стенда и исходников Ташкента (BLOCKED_FACT) |
| Какой коммит задеплоен на remhaos.com | Vercel недоступен из сессии; автодеплой выключен |
| ACL/гранты/схемы API production по существу | Разрешено только чтение метаданных; SQL к production не выполнялся |
| Живой LLM-прогон (S2), реальная почта `NEXT_PUBLIC_SUPPORT_EMAIL`, юрстраницы (§18 п.7) | Нужен владелец / production |
| Гонки BUG-10/14/16, BUG-12 в runtime | Выведены из кода, не воспроизведены |
| Коммиты вне shallow-клона (секреты) | Клон ограничен 271 ревизией |

## 7. Вопросы владельцу (блокирующие)

1. **R1 и DEC-026.** (а) Ратифицировать DEC-026 и принять R1 как его исполнение; (б) записать DEC
   «R1 — только private/disposable» и вывести R1-двери и DWG/SKP/GLB из M3-сигнатур; (в) откатить R1 из `main`.
2. **Пакетный architect (SEC-01).** (а) 6 прав по пакетному шаблону; (б) 18 прав — выровнять шаблон ADR-ом.
   И: инвентаризировать и отозвать старые проектные гранты (SEC-02) — да/нет.
3. **Вход Б сейчас.** `/b/` и self-brief построены до гейта SMTP. (а) Закрыть `/b/` до Фазы 4;
   (б) оставить, но немедленно ввести INV-B1/B6 и фикс BUG-01.
4. **Baseline/release без handoff (BUG-13).** (а) Требовать persisted handoff; (б) решение, что
   baseline/release — платформенные, не вход в M3.
5. **cycle7 (DOC-06).** (а) Вернуть в красный до runtime-приёмки внешнего пакета; (б) принять зелёный на
   манифесте оператора с уточнением смысла гейта.
6. **Telegram.** Канонический контур: (а) A7 `remhaos_channel`; (б) `remhaos_integration`.
7. **CI (DOC-03).** (а) Вернуть `pull_request` для lint/typecheck/test/build/DB4/DB5; (б) записать DEC
   о ручном `workflow_dispatch` с обязательным прогоном перед merge.
