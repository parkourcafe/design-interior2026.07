# ArchiDom — аудит фактической готовности M1, M2, M3 и сквозного ядра

Дата: 2026-07-23  
Ветка: `claude/arhidom-cinematic-website-t2zfdc`  
Commit: `9470fceb0912b5546d2d53b297a6a01c8c3d28a8`

## Executive Summary

[ИЗВЛЕЧЕНО] Репозиторий содержит два существенно разных продуктовых контура:

1. legacy M1: `projects/answers/risk_cards/proposals/events`, публичный бриф, Review Board и КП;
2. ProjectCEO compatibility foundation: Organization/Project/Package, sources, decisions, selections, approvals, baselines, releases, distribution, changes, evidence и thin M4.

[ИНТЕРПРЕТИРОВАНО] Ни один модуль сегодня нельзя честно классифицировать как `READY_FOR_USERS` по текущей ветке без оговорок. M1 ближе всех к пользовательскому вертикальному сценарию, но authoritative migration chain не содержит таблицу `concept_packs`, а production adoption отдельно имеет `NO-GO`. M2 имеет доменную и persistence-основу, read UI и узкий текстовый Concept Pack, но не имеет room/variant/design workflow и часть обязательных команд отключена. M3 имеет наиболее сильное сквозное backend-ядро для revisions/baseline/release, но intake/review/publish UI-команды отключены, поэтому архитектор не может пройти полный сценарий самостоятельно.

| Область | Что работает end-to-end | Что частично | Что отсутствует/сломано | Готовность пользователям | Главный блокер |
|---|---|---|---|---|---|
| M1 | Создание проекта; token brief; server submit; паспорт; risks; Review Board; pricing/КП; публичный ответ — цепочка представлена кодом | Черновик только localStorage; upload и план-assist; версия КП фактически фиксирована `version=1`; договор только как будущий gate | `concept_packs` вызывается UI, но отсутствует в authoritative migrations; текущий реальный E2E не воспроизведён | `INTERNAL_ONLY` | Невоспроизводимый legacy baseline/production adoption `NO-GO` |
| M2 | Узкий детерминированный текстовый Concept Pack из M1 — только при наличии отсутствующей таблицы | Decisions, selections, approvals, price observations и read views заложены в DB/backend | Нет rooms/variants/images/AI edits/material budget workflow; review selection и source commands unavailable | `BLOCKED_FOR_USERS` | Нет полного write surface и предметного M2 UX |
| M3 | Backend contracts для exact revisions, baseline, immutable package release, distribution/acknowledgement; disposable evidence в документах | Workspace показывает sources/releases/decisions/evidence | Register/review source, publish baseline/release и build handover отключены; нет document authoring/completeness user flow | `BLOCKED_FOR_USERS` | Архитектор не может собрать и выпустить пакет через основной UI |
| Сквозное ядро | Organization/Project/Package, provenance, immutable versions, audit, role-bound reads, change/impact foundation | Approval, source invalidation и role views существуют не во всех legacy/M1 связях | Нет единого M1→M2→M3 handoff; Project Check READY/CONDITIONAL/BLOCKED как продуктовая функция не найден | `INTERNAL_ONLY` | Два параллельных project/data контура и незакрытые commands |

## Состояние репозитория

- [ИЗВЛЕЧЕНО] Git root: `repo/`; верхний каталог не является git repository.
- [ИЗВЛЕЧЕНО] Технологии: Next.js 16.2.10, React 18, TypeScript strict, Supabase, Zod, Vitest, Tailwind; `package.json` всё ещё называет пакет `design-intake-mvp`.
- [ИЗВЛЕЧЕНО] Рабочая копия содержит большой набор ранее существовавших untracked AP1, migration, mobile и test-файлов. Они не изменялись аудитом.
- [ИЗВЛЕЧЕНО] `npm run lint`, `npm run typecheck`, `npm run test` были запущены, но не завершились и не дали диагностического вывода за несколько минут; остановлены кодом 130. Результат: `NOT_VERIFIABLE`, не PASS/FAIL.
- [НЕТ ДАННЫХ] `npm run build` не запускался после зависания трёх менее дорогих gates, чтобы не оставлять ещё один бесконтрольный процесс.
- [ИЗВЛЕЧЕНО] Полный browser E2E текущим аудитом не выполнялся: нет подтверждённой disposable Supabase-сессии и безопасного seeded environment. Документ `LOCAL_CLONE_ADOPTION_DECISION_2026-07-20.md` содержит прошлое evidence, но не заменяет fresh run.

## Архитектурная карта

Legacy M1 идёт по цепочке `app/dashboard/*` → server actions / `app/api/intake/*` → public Supabase tables и private `client-uploads`. ProjectCEO идёт через `app/dashboard/projectceo/*` → request-bound Auth client → API-schema RPC → private schemas. Fixture-mode допустим только локально и запрещён при `NODE_ENV=production` (`server-port.ts`).

Ключевое расхождение: legacy `public.projects.id` используется как compatibility project id, но ProjectCEO добавляет собственные Organization/Package/Membership contracts. Additive bridge существует, однако продуктовый M1 Concept Pack не становится автоматически M2 Decision/Selection, а Approved Selection не материализуется в legacy `concept_packs`.

## Аудит M1

| Capability | Статус | Доказательство и проверка |
|---|---|---|
| Создание проекта | `WORKING_WITH_LIMITATIONS` | `app/dashboard/actions.ts:createProject`; insert `projects`, event `intake_link_created`; требует live Auth/RLS |
| Публичный бриф | `WORKING_WITH_LIMITATIONS` | `/i/[token]`, `app/api/intake/start`, `submit`; token проверяется server-side через admin client |
| Черновик/повторное открытие | `WORKING_WITH_LIMITATIONS` | `wizard.tsx` сохраняет `brief_${token}` в localStorage; нет серверного draft и cross-device persistence |
| Файлы | `WORKING_WITH_LIMITATIONS` | `api/intake/upload`, private `client-uploads`, metadata в answers; size/type UX зависит от route validation |
| Извлечение из плана | `PARTIAL` | `plan-upload`, `plan-assist`, PDF text/OCR helpers; не является общим автоматическим анализом всех attachments |
| Паспорт | `WORKING_END_TO_END` по коду | `buildPassport` → `runRiskPipeline` → `projects.passport`; unit tests присутствуют, fresh run не завершён |
| Факты/предположения/unknown | `PARTIAL` | паспорт структурирован, но явной типизированной evidence-классификации каждого поля M1 нет |
| Вопросы и риски | `WORKING_WITH_LIMITATIONS` | deterministic rules + LLM fallback; designer status/edit actions; LLM зависит от env/provider |
| Scope/pricing | `WORKING_WITH_LIMITATIONS` | deterministic package recommendation и `calcPrice`; нет договорного baseline scope |
| КП и клиентский ответ | `WORKING_WITH_LIMITATIONS` | editable sections, public token, print CSS, accept/discuss/changes; ответ — event, не юридическая подпись |
| Версии КП | `PARTIAL` | schema имеет version, но UI/actions жёстко работают с `version=1`; полноценного version lifecycle нет |
| Договор | `NOT_IMPLEMENTED` | route/entity/export contract не найден |
| Права owner/member/client | `WORKING_WITH_LIMITATIONS` | studio RLS и token routes; публичные human operations legacy используют service-role в intake/proposal respond |
| Полный реальный сценарий | `NOT_VERIFIABLE` | fresh DB/browser run не выполнен; current migrations имеют known legacy drift |

[ИНТЕРПРЕТИРОВАНО] Ответ на вопрос «можно ли дать M1 реальной студии сегодня»: только как контролируемый internal/concierge pilot после развертывания проверенного legacy baseline, настройки Auth/Storage/SMTP/LLM и ручного smoke E2E. Публичный self-service запуск — нет.

## Аудит M2

- [ИЗВЛЕЧЕНО] `concept-pack` строит текстовый style direction, palette, zones и summary из M1 passport (`lib/concept/build.ts`).
- [ИЗВЛЕЧЕНО] UI/action пишет `public.concept_packs`, но `20260716071024_legacy_production_baseline.sql` прямо говорит, что migration `0008_concept_packs` отсутствовала в production; таблица есть только как recovered evidence text. Текущая цепочка с нуля функцию не гарантирует: `BROKEN`/`NOT_VERIFIABLE` в live environment.
- [ИЗВЛЕЧЕНО] Product Brain persistence содержит Decisions/Selections, approval packages, price observations, evidence refs и baselines; authenticated read workspace их отображает.
- [ИЗВЛЕЧЕНО] `command-service.ts` объявляет `review_selection` unavailable. Product UX для создания комнаты, трёх вариантов, загрузки/генерации visual variants, точечных AI edits, материалов и room budget не найден.
- [ИНТЕРПРЕТИРОВАНО] M2 — `PARTIAL`, `BLOCKED_FOR_USERS`: это foundation и демонстрационный/read surface, не рабочее место дизайнера.

## Аудит M3

- [ИЗВЛЕЧЕНО] Foundation хранит source inventory, revisions/materializations и package scope; Product Brain хранит immutable package versions, release artifacts, distributions и acknowledgements.
- [ИЗВЛЕЧЕНО] Workspace отображает sources, review state, baseline, releases, decisions, evidence и history через request-bound read port.
- [ИЗВЛЕЧЕНО] `register_source`, `review_source`, `publish_baseline`, `publish_release`, `build_handover` отключены в deployable command service.
- [ИЗВЛЕЧЕНО] Не найден отдельный пользовательский workflow для drawings/specifications/schedules, привязки документа к комнате/листу, completeness checklist и исправления замечаний.
- [ИНТЕРПРЕТИРОВАНО] M3 backend foundation — `WORKING_WITH_LIMITATIONS` в disposable harness по прошлому evidence; пользовательский M3 — `DISCONNECTED`, `BLOCKED_FOR_USERS`.

## Задел M4

[ИЗВЛЕЧЕНО] В `projectceo_m4` реализованы persistence и операции ChangeRequest, impact, photo evidence/review, milestones/acceptance и handover; часть команд подключена к UI. Это thin M4 dependency surface. Полноценные WBS, закупки, склад, ERP и warranty operations не аудировались и не должны считаться реализованными.

## Сквозное ядро

| Механизм | Статус | Вывод |
|---|---|---|
| Project Memory | `PARTIAL` | Сильный Project Intelligence graph/audit; legacy M1 остаётся отдельным JSON/table контуром |
| Project Check | `NOT_IMPLEMENTED` | READY/CONDITIONAL/BLOCKED, hard/soft blockers как единый механизм не найдены |
| Evidence Layer | `WORKING_WITH_LIMITATIONS` | revisions/evidence links/provenance есть в PI; M1 passport/risks не имеют той же строгой revision provenance |
| Decision Log | `WORKING_WITH_LIMITATIONS` | Decision/Selection и audit существуют в Product Brain; нет полного M1/M2 UX write lifecycle |
| Approval Model | `PARTIAL` | approval packages/baseline approvals и proposal response есть, но уровни согласования не собраны в единый product flow |
| Responsibility Model | `WORKING_WITH_LIMITATIONS` | DB capabilities и server-derived scope сильны в ProjectCEO; legacy client tokens/service-role проще |
| Change Control | `WORKING_WITH_LIMITATIONS` | change/impact/review/baseline foundation есть; M1/M2 изменения автоматически не порождают CR |
| Version Control | `WORKING_WITH_LIMITATIONS` | PI immutable versions сильны; M1 proposal/Concept Pack version lifecycle слабый/отсутствует |
| Source Invalidation | `PARTIAL` | exact source revisions и impact contracts есть; автоматический invalidation всех downstream views не доказан UI-сценарием |
| Role-based Views | `WORKING_WITH_LIMITATIONS` | request-bound ProjectCEO roles + RLS/RPC; fixture QA route существует только local; нет четырёх завершённых public workspaces |

## Полные пользовательские сценарии

- A/M1: `NOT_VERIFIABLE`. Кодовая цепочка почти полная до принятого КП и project room, но fresh authenticated DB/browser proof отсутствует.
- B/M2: `BROKEN`. Нет room/variants/materials/budget/approval vertical slice; Concept Pack зависит от отсутствующей authoritative table.
- C/M3: `DISCONNECTED`. Read projection есть, обязательные create/review/publish commands отключены.
- D/межмодульный: `PARTIAL`. Общий `project_id`/compatibility bridge и ProjectCEO Project/Package есть, но M1 passport → approved M2 → released M3 автоматически не проходит.

## Расхождения документов и кода

1. [ИЗВЛЕЧЕНО] `README.md` всё ещё описывает Next.js 14 и старые `0001/0002`, тогда `package.json` использует Next 16 и timestamped chain.
2. [ИЗВЛЕЧЕНО] `ARCHITECTURE.md` утверждает «готово и работает в проде», но позднейший adoption decision говорит `PRODUCTION_ADOPTION=NO-GO`.
3. [ИЗВЛЕЧЕНО] AP1 E2E документ подтверждает supported slice, но command service сейчас намеренно не поддерживает source review/baseline/release через UI; seeded preconditions не равны полному user-created flow.
4. [ИЗВЛЕЧЕНО] Charter называет M2/M3 целевыми workspaces; код в основном представляет foundation/read workspace, а не заявленные предметные UX.
5. [ИЗВЛЕЧЕНО] Реализован ProjectCEO guest exact-release route и invitation acceptance, но top-level legacy README их не документирует.

## Блокеры и замечания

Технические P0: authoritative legacy migration drift (`concept_packs`, `rate_limits`), production adoption `NO-GO`, отключённые write commands, отсутствие свежего воспроизводимого quality/browser run. Продуктовые P0: нет M2 room/variant/selection slice, нет M3 document/revision/completeness/release slice, нет Contracted Project Passport handoff.

Security/data access:

- [ИЗВЛЕЧЕНО] ProjectCEO правильно использует request-bound JWT, private schemas и server-derived scope.
- [ИЗВЛЕЧЕНО] Legacy intake/proposal/project-room token routes используют admin/service client после token lookup; это compatibility behavior, но требует rate-limit, token entropy, revocation/expiry и audit проверки.
- [ИЗВЛЕЧЕНО] Production snapshot отмечает broad `rate_limits` grants и нерешённый `is_studio_member` compatibility bridge.
- [ИЗВЛЕЧЕНО] `lib/llm/zai.ts` существует, что расходится с активным RU guardrail о runtime provider policy и требует отдельного provider/legal решения до public launch.

## Прямые ответы и итоговый вердикт

1. M1 реальной студии: только controlled internal pilot; публично — нет.
2. M2 реальному дизайнеру: нет.
3. M3 архитектору: read/demo/concierge — да; самостоятельный production workflow — нет.
4. Полностью представленные кодом сценарии: M1 brief→passport→risks→proposal→public response; ProjectCEO request-bound reads; отдельные change/ack/photo operations. Fresh E2E не подтверждён.
5. UI, выглядящий готовым: ProjectCEO source/review/baseline/release/handover tabs и legacy Concept Pack.
6. Backend-only: Decision/Selection persistence, approval packages, exact source revisions, baseline/package release contracts, impact/handover operations.
7. Общие данные: compatibility `project_id`, ProjectCEO Organization/Project/Package. Разрозненные: M1 JSON passport/proposal/Concept Pack против Product Brain revisions/selections.
8. До запуска: воспроизводимый migration ledger, hosted Auth/Storage/SMTP gates, P0 write commands, M1→M2→M3 handoff, five-role negative/browser regression.
9. После запуска controlled wedge можно оставить: широкий AI generation, credits, CAD/BIM authoring, расширенный M4/ERP.
10. Полная rewrite migration не требуется. Нужны additive compatibility migrations/bridges и локальные product slices; production adoption требует отдельного контролируемого migration plan.

Рекомендуемый порядок: (1) frozen reproducible DB/Auth/Storage baseline; (2) доказать M1 current E2E; (3) завершить один M3 source→review→baseline→release slice; (4) завершить один M2 room→variant→selection→approval handoff; (5) соединить immutable M1 passport и M2 selection с M3 package; (6) только затем расширять M4/AI.
