# RemHaOS — финальный аудит перед этапом запуска четырёх модулей

**Первая строка (состояние PR #97 и CI на момент аудита):** PR #97
(`claude/analyze-module-status-98iu2u`) **открыт и MERGEABLE, не слит**;
GitHub Actions НЕ восстановлен: workflow `CI` на ветке #97 падает за 4–5 с с
недоступными логами (последние прогоны 19–20.08.2026, run 32326466567 — failure,
лог 404); scheduled `change-impact worker` на `main` завершается статусом
`skipped`, но его журналы тоже недоступны через API. Аудит выполнен по правилу
старшинства: журнал решений старше повествования файлов; подписанные документы
не переписывались.

**Дата аудита:** 23.08.2026. **Режим:** AUDIT ONLY.
**Снимок:** `main` = `3bde317` (merge PR #77), рабочее дерево чистое,
миграций 54, ledger `tests/ap1/environment/migration-ledger.sha256`
сходится 54/54 (`sha256sum -c`, прогон аудита).

Уровни доказательств — по словарю DEC-016: VERIFIED / CI_EVIDENCED /
CODE_PRESENT / DOC_TARGET / NOT_BUILT.

---

## 1. Резюме

Вердикт: **репозиторий готов к Фазе 0–1 плана запуска (см.
REMHAOS_LAUNCH_PLAN_2026-08-23.md) при условии восстановления CI и закрытия
перечисленных ниже major-находок; к production не готов ни одним слоем — и это
состояние честно зафиксировано самим репозиторием** (DEC-033 §4,
PLATFORM_FOUNDATION=BLOCKED). Кодовая база существенно оперирует свои
документы: M4 V1 Impact доказан целиком (включая recovery DEC-037), границы
V2/V3 двойные и кодом проверенные, production-выключатель построен и закрыт;
при этом платформа под M1 (project_facts, ai_calls, реестры) не построена,
M3 P0 «intake файлов» существует только как метаданные без байтов (DEC-026/027
не реализованы), а Telegram-мост имеет четыре названных же репозиторием дыры
TG2. Blocker-уровня багов не найдено; найдено 4 major и 9 minor.

Топ-5 рисков:

1. **CI/Actions аккаунта нестабилен** — без него невозможен обязательный
   гейт для #97 и любых будущих PR; последний полный зелёный прогон — голова
   #95 `a79dbb1` (проверено: check-runs включают lint/typecheck/test/build,
   DB4+DB5 PG16/17, «AP5 authenticated browser matrix»).
2. **PLATFORM_FOUNDATION = BLOCKED не снят владельцем** — блокирует не только
   AP1-фазу, но и любое будущее production-включение M3/M4 по их же правилам
   (`REMHAOS_OWNER_DECISION_M4_V1_PRODUCTION_2026-08-12.md` §4.1).
3. **Расхождение «UI обещает больше, чем база»**: role-policy показывает
   builder/client команды, которых нет в capability-наборах БД → клик ведёт к
   P1103 forbidden из базы (BUG-04) — нарушает собственный принцип A6 §4.2.5
   и повторяет класс уже исправлявшейся ошибки.
4. **Легаци-поверхности обходят RLS-дисциплину**: dashboard/intake/join/pilot
   используют service-role клиент для человеческих страниц + подпись вложений
   на TTL 3600 c вместо ≤900 c (BUG-03, BUG-05).
5. **Семантический разрыв M3**: модуль объявлен построенным по P0, но приём
   файлов (байты, антивирус, серверная контрольная сумма) и серверное
   определение конфликтов (DEC-026 PROPOSED / DEC-027) не реализованы;
   backlog hardening — все 6 пунктов открыты.

## 2. Сводная таблица по слоям

| Слой | Статус | Уровень | Ключевые доказательства | Дыры |
|---|---|---|---|---|
| Governance | ЗДОРОВ | VERIFIED | DEC-001…037 непрерывны (`REMHAOS_DECISION_LOG_v1.md:22-58`); DEC-026=PROPOSED (:47); DEC-033=«ИСПОЛНЕНО ЧАСТИЧНО» (:54); errata-правило текст/поведение (`REMHAOS_MIGRATION_ERRATA.md:1-11`); ledger 54/54 OK | Дрейф счётчиков в старых матрицах (DOC-04, DOC-05) |
| Platform | ЧАСТИЧНО | CODE_PRESENT/NOT_BUILT | Project Graph v1: `graph_nodes/_revisions` (`20260716072000…sql:398`); Workflow Engine: сервис + `project_workflows` (`application/workflow/service.ts:1289`; тест 994 строки). NOT_BUILT: project_facts, Action/Skill Registry, ai_calls (grep по миграциям/lib — пусто) | PLATFORM_FOUNDATION=BLOCKED не снят; blocker `92060e3` (SECURITY DEFINER auth.uid() от pi_table_owner) |
| M1 · Заказчик | LEGACY ЖИВ, P0 НЕ ПОСТРОЕН | VERIFIED (82 теста локально) | brief/passport/risks/pricing/proposal/events — код+тесты; принятие КП `respond/route.ts:61-63` | immutable Passport NOT_BUILT (`passport jsonb` перезаписывается, `submit/route.ts:46-48`); договор upload/status NOT_BUILT; версии КП жёстко `.eq("version",1)` |
| M2 · Дизайнер | ПОСТРОЕН (P0), цикл 7 открыт намеренно | VERIFIED | 6 шагов конвейера + handoff RPC `publish_m2_m3_handoff` (`20260802090000:494-553`); флаг Layout Studio default off (`documentation-flag.ts:15-19`); DEC-022 pinned hash (`canonical-signature.test.ts:26-27`); cycle7 informational `continue-on-error` (`ci.yml:356-372`) | Нет m2-surface-матрицы; TS-зеркало handoff вне продакшн-пути; RPC не перепроверяет staleness selections/budget |
| M3 · Архитектор | ЯДРО ПОСТРОЕНО, intake-байтов НЕТ | CODE_PRESENT/NOT_BUILT | sheet-сущность+ревизии (`20260810010000:86-193`); baseline A′ + append-only пакеты (`20260717100000:1751-1797`); guardrail `20260811010000` отзывает 6 функций с self-checks; вход только через handoff (`_require_published_handoff`, `:273-321`); единственный остаток app_gate_only = register_source_inventory (доказано матрицей+DB4 06) | DEC-026: байты/AV/checksum НЕ реализованы (checksum от клиента — `command-service.ts:340`); DEC-027: серверного конфликта нет, semanticConflict остался входом клиента (`command-contract.ts:575`); backlog 2/4/5/6/7/8 — все ОТКРЫТЫ |
| M4 · ГлавПрораб | V1 IMPACT ДОКАЗАН, PRODUCTION ЗАКРЫТ | VERIFIED (локально DB4/DB5 PG16+PG17) | Инкремент 1 обе границы (`command-service.ts:257-271`; revoke `20260810070000:30`, `20260811020000:40-45`); DEC-034 CHECK трёх исходов (`20260813010000:188-210`); DEC-036 dead-letter/redrive (`20260813030000`); DEC-037 ранняя остановка до shaped-CTE (`20260817010000:354-362` против walk :374+), частичный индекс (:76-78), ключ с версией политики (`planner.ts:81-85`); выключатель ровно 2 двери, guard'ы, невидим ролям (`28_v1_production_switch.sql:39-50,149-161`) | Runbook :68 «три сигнатуры» (устарело); комментарий ci.yml:296; комментарий `90_default_deny_after.sql:105` |
| Telegram (A7) | TG0/TG1 PASS; TG2 NOT PROVEN (все 4 дыры живы); TG4 BLOCKED | VERIFIED/CODE_PRESENT | Флаг default off, webhook отдаёт 404 до чтения тела (`route.ts:455-466`); уникальность связей — частичные индексы (`foundation.sql:101,107`); lease-fencing (`operations.sql:697-730`); железные правила — нарушений нет (classifier только кандидаты, порты типизированы) | channel_attachments без писателей (`foundation.sql:268` создана, insert — ноль); migrate_to_chat_id — ноль совпадений в репо; HTTP-boundary пруфа нет (тесты на моках `telegram-webhook-route.test.ts:42-107`) |
| Security | ЯДРО ВЕРИФИЦИРОВАНО, ЛЕГАЦИ ШУМИТ | VERIFIED/PARTIAL | RLS deny-by-default + force (`20260716072000…sql:2551-2574`); негативные tenancy-тесты (db2/31, db4/31, db4/33); append-only повсеместно, `reject_impact_run_mutation` ровно один переход с побайтовой идентичностью (`20260817010000:89-121`); идемпотентность UI/воркер/webhook; PII-allowlist в observability моста (`observability.ts:1-74`); Storage opaque keys + TTL≤900 throw (`storage/policy.ts:92-105`, `storage.ts:89-95`); секреты CLEAN (дерево+история 545 коммитов); деньги bigint/safe integer | BUG-03 TTL 3600c; BUG-05 admin-client на человеческих страницах |

Локальные гейты аудита (VERIFIED, прогон 23.08.2026 на `3bde317`):
lint PASS (0 ошибок / 13 warnings) · typecheck PASS · test **1368/1368 PASS**
(159 файлов) · build PASS · `test:cycle7` красный НАМЕРЕННО
(CYCLE7_EXTERNAL_MANIFEST_REQUIRED) · DB4 PASS PG16+PG17 · DB5 PASS PG16+PG17.
AP5 локально не гонялся (требует браузерного стека) — CI_EVIDENCED прогоном
головы #95 `a79dbb1`.

## 3. Матрица ролей

Роли выводятся серверно (JWT + `project_member_capabilities`,
`20260717090000:697-756`); различимые в БД: owner_lead, architect, builder,
client_approver; guest — вне членств, через grants. Отказ происходит по слоям:
(а) флаг модуля → `operation_unavailable` (`command-service.ts:248-262`);
(б) неавторизованный инкремент → `increment_not_authorized`, независимо от
флага (`:269-271`); (в) роль/capability в приложении → `capability_missing`;
(г) роль-проверка distribute_release (`:978-980`); (д) revoke в базе;
(е) capability-check RPC → P1103.

| Команда (модуль) | owner | architect | builder | client | guest |
|---|---|---|---|---|---|
| M1 brief/КП | сессия¹ | сессия¹ | сессия¹ | сессия¹ | — |
| M2 create_decision/selection, m2_room/variant/material | ✅ | ✅ | ⚠️UI✅/БД❌² | ⚠️UI✅/БД❌² | — |
| M2 set_m2_budget, commit_m2_approval, client_handoff | ✅ | ✅ | — | — | — |
| M3 register_source | ✅ | ✅ | ✅³ | — | — |
| M3 review_source | ✅ | ✅ | ❌³ | — | — |
| M2 approval package / review_selection | ✅ | ✅ | — | ✅⁴ | — |
| publish_baseline / publish_release | ✅ (guardrail: только через A′-оркестрацию) | ✅ | — | — | — |
| distribute_release / acknowledge_release / create_change | ✅ | ✅ | ✅ (ack/change) | ✅ (ack/change) | по гранту |
| review_change_impact (+replay) | ✅ | ✅ | — | — | — |
| V2/V3 (photo/milestone/handover) | increment_not_authorized на поверхности + revoke в БД — у всех ролей | | | | |

¹ Маршруты M1 вне командного контракта ProjectCEO — проверяют лишь сессию
(`app/api/brief/custom-question/generate/route.ts:45`); ролевой модели нет.
² **BUG-04**: `components/projectceo/role-policy.ts:50-67` обещает builder
create_selection/revise_decision/review_milestone и client revise_decision; в
БД этих capability нет (`20260802030000:43-51`), RPC отвечает P1103.
³ Builder: register есть, review нет — UI отражает корректно
(`role-policy.ts:112-114`).
⁴ Право `review_selection` у client_approver в БД есть, но в цепочке AP5 пакет
одобряет архитектор — право не исполнено ни разу (пробел покрытия).

Guest: хешированный токен (sha256-digest unique, `guest-link.ts:88-138`),
срок ≤7 дней constraint'ом (`20260717090000:437-443`), scope org+project+
package+version (`read_guest_release`, `20260717091000:1666-1745`),
отзыв append-only событием → P1106 — контракт выполнен, тесты есть.

Покрытие AP5 (звенья 1–15, отдельные authenticated browser-сессии):
подтверждено; известные два пропуска воспроизведены как `test.fixme`:
фото/веха V2 (`02-kora-chain.spec.ts:1117-1122`) и selection на area-узле,
который создаёт только ingest (`:379-395`). Дополнительно не покрыто:
client-сессия не исполняет ни одной команды цепочки; M2-вертикаль (rooms/
variants/layout) и документационные листы M3 в chain не участвуют.

## 4. Реестр багов

| ID | Severity | Файл:строка | Что не так | Как воспроизвести | Предлагаемый фикс (НЕ применять) |
|---|---|---|---|---|---|
| BUG-01 | major | tests/db5/run-concurrency.zsh:134 | Ключ идемпотентности `'worker:change-impact:${id}'` без версии политики, при комментарии :125-127 о паритете с `changeImpactIdempotencyKey` | `npm run test:db5` — гонка проходит, но фиксирует формат, которым продукт не ходит | Строить ключ тем же шаблоном `planChangeImpactWork` с версией политики из конверта очереди |
| BUG-02 | major | lib/project-intelligence/workers/change-impact/errors.ts:110-118 + runner.ts:204-255 | Сырой SQLSTATE 23505 (unique_violation частичного индекса) отсутствует в таблице маппинга → классифицируется internal_error→transient→5 ретраев→dead-letter вместо семантики «уже посчитано» | Искусственно разнести версии политики у двух воркеров на одной заявке без активного прогона | Добавить `"23505"→idempotency_conflict` либо ловить unique_violation по имени `m4_impact_runs_one_active_key` в SQL и поднимать P1110 |
| BUG-03 | major | app/dashboard/projects/[id]/page.tsx:187 | `createSignedUrl(path, 3600)` — TTL 1 час, нарушает инвариант ≤15 мин | Открыть страницу проекта, проверить срок подписи вложения | Снизить до ≤900 c |
| BUG-04 | major | components/projectceo/role-policy.ts:50-67 vs 20260802030000:43-51 | UI предлагает builder/client команды, запрещённые БД (P1103 после клика) — нарушение A6 §4.2.5 | Войти builder-сессией, открыть поверхность M2, нажать create_selection | Единый источник capabilities для UI и сервера (это же M4-backlog п.6) |
| BUG-05 | major | app/dashboard/projects/[id]/page.tsx:4,182; lib/intake.ts:1; app/join/[token]/actions.ts:4; app/api/pilot/route.ts:2 | Легаци-страницы обслуживают людей через service-role `createAdminClient` — обход RLS-принципа «human ops без service role» | Код-ревью импортов; любой запрос этих страниц | План миграции на request-bound клиент; до пилота — минимум BUG-03 и аудит путей |
| BUG-06 | minor | lib/project-intelligence/adapters/postgres/execution.ts:442-463 | Мёртвый `acknowledgeImpactTruncation` зовёт навсегда отозванный RPC (DEC-034) | Вызов метода → permission denied | Удалить метод/интерфейс и недостижимую ветку command-service.ts:1040-1055 |
| BUG-07 | minor | execution.ts:53-56 | Тип `ImpactReviewMutation` требует allImpactsReviewed/truncationAcknowledged, которых SQL больше не возвращает | Сравнить с `review_change_impact` (20260817010000:854-872) | Обновить интерфейс под фактические поля |
| BUG-08 | minor | live-read-port.ts:1049-1052,1144-1146,1311-1320 | `unacknowledgedTruncatedRunId` читает несуществующее поле `truncationAcknowledged`; комментарий описывает удалённую дверь | Чтение усечённого прогона; эффект маскирован loop'ом NOT_AUTHORIZED | Удалить переменную и состояние acknowledge_impact_truncation из states |
| BUG-09 | minor | M4_V1_PRODUCTION_RUNBOOK.md:68 | «open_now = true, три сигнатуры» противоречит DEC-034 (две двери) и строке :20 того же файла | Прочитать §ожидаемого состояния после включения | Исправить на две двери со ссылкой на 20260813010000 |
| BUG-10 | minor | .github/workflows/ci.yml:295-297 | Комментарий «операция выдаёт ровно три права» — до-DEC-034 формулировка | Прочитать шаг описания DB5-сценария | Поправить текст комментария |
| BUG-11 | minor | tests/db5/90_default_deny_after.sql:105 | Комментарий «ровно два воркерных вызова», allowlist ниже содержит четыре | Прочитать блок | Поправить комментарий |
| BUG-12 | minor | tests/ap5/02-kora-chain.spec.ts (звено 15) | Текст recovery-подсказки ru.ts:1611-1612 («Карточки влияний не сохранены…») не покрыт ни одним тестом | Регрессия формулировки пройдёт незамеденно | Добавить regex рядом с :1080 |
| BUG-13 | minor | REMHAOS_FEATURE_READINESS_MATRIX_2026-08-02.csv:3 | «24-file clean replay» при фактических 54 миграциях | Сравнить с ledger | Обновить счётчик или сослаться на ledger |

Blocker-багов не обнаружено. Границы авторизации M4/M3, append-only,
идемпотентность и RLS-ядро нарушений не показали.

## 5. Реестр расхождений документов и кода

| ID | Документ | Код | Кто прав по правилу старшинства | Что править |
|---|---|---|---|---|
| DOC-01 | Матрица готовности CSV, строка 8: Project Graph v1 NOT_STARTED | `graph_nodes/_revisions`+FK+тесты существуют | Код (матрица — гипотеза, занижена) | Обновить строку матрицы (по образцу правки M2/M3 в #97) |
| DOC-02 | Там же, строка 9: Workflow Engine NOT_STARTED | Application service + персистентный state + 994-строчный тест | Код | То же |
| DOC-03 | Там же, строка 11: Approval Requests NOT_STARTED | approval_packages + self_approved маркер есть (общего гейта нет) | Частично код | Переформулировать на «частично, M2-specific» |
| DOC-04 | REMHAOS_FEATURE_READINESS_MATRIX_2026-08-02.csv:3 | ledger 54/54 | Ledger (=код) | См. BUG-13 |
| DOC-05 | M2_CLOSEOUT_2026-08-08.md:25 «четыре DB4-набора» | Наборов пять (30,31,32,33,36) | Код | Обновить счётчик при следующей правке файла |
| DOC-06 | M4_V1_PRODUCTION_RUNBOOK.md:68 | Ровно две двери (`20260813010000:1109-1120`, тест 28) | DEC-034 (ратифицирован 17.08, старше по решению) | BUG-09; правило старшинства: позднее уточнение > ранний документ |
| DOC-07 | ТЗ аудита: «семь пунктов hardening-backlog» M3 | В файле шесть открытых строк №№2,4,5,6,7,8 (№1,3 закрыты в #79) | Файл backlog | Не дефект репозитория; учесть в плане запуска |
| DOC-08 | DEC-027 §2.5.4: блокировка публикации подключается к пути A′ | Блокировка живёт в устаревшей ветке orchestration.ts:356-365; A′-путь блокировки не содержит | DEC-027 LOCKED — править надо код при реализации | При реализации DEC-027 переносить блокировку именно в A′-путь |
| DOC-09 | AGENTS.md: правило старшинства журнала заявлено «после #97 явно» | #97 не смержен; пока правило действует де-факто через шапку журнала | Журнал (де-факто уже применяется) | Слияние #97 делает правило явным |

Конфликтов «подписанный документ vs код» с более поздней семантикой кода не
найдено: во всех точках (три двери→две, truncate-and-keep→blocked-nihil,
maxDepth 8→7) код соответствует позднему решению, а не раннему тексту.

## 6. Реестр «не проверено»

| Что | Почему | Компенсация |
|---|---|---|
| AP5 браузерная матрица локально | Требует поднятого Supabase-стека и Playwright-окружения; среда аудита ограничена одноразовым docker-postgres | CI_EVIDENCED: check-runs коммита `a79dbb1` включают job «AP5 authenticated browser matrix» (success) |
| Состояние производственного Supabase `ztnycrchwxqczqbyegnp` | Запрещено ТЗ §6 | Не требуется: все production-заявки репозитория помечены NOT_PRODUCTION_ADOPTED |
| Наличие реальных кредов Telegram (TG4) | Внешние секреты | Статус BLOCKED_EXTERNAL_CREDENTIALS подтверждён отсутствием env-значений в дереве |
| «Непрочитанность executor-скриптов» (−2 балла M2) | Процессное утверждение closeout, из репозитория неверифицируемо | Скрипты присутствуют; упомянутый баг zsh исправлен в коде (`run-m2-pilot-evidence.zsh:18-27`) |
| Production-инвентарь (workflow_runs/project_facts/ai_calls в чужой модели) | Нет доступа к внешнему проекту | Зафиксировано как DOC_TARGET по реконсиляции 01.08 |
| Полнота git-археологии секретов за пределами паттернов | Ограничение метода | Паттерны sbp_/eyJ/sk-/bot-token/AIza/ghp_ + diff-filter=A по .env* — чисто |

## 7. Вопросы владельцу

Каждый вопрос блокирующий, с вариантами ответа.

1. **Снять ли PLATFORM_FOUNDATION = BLOCKED?** (A6 §7, DEC-025, §4.1 решения
   DEC-033.) Варианты: (а) да, отдельной записью после Фазы 1; (б) отвести
   предпосылку для V1 Impact отдельно, оставив блок для остальных модулей;
   (в) оставить BLOCKED до конца Фазы 2.
2. **Как входит вертикаль V1 Impact в production?** (§4.2 того же решения.)
   Варианты: (а) расширить GO до enroll-маршрута + инкремента 1; (б) принять
   «проекты заводит оператор напрямую в базе» как осознанный операционный
   порядок и записать его; (в) отложить включение V1 до Фазы 4.
3. **Кому и когда выдаётся доступ к производственному Supabase?** Без этого
   ни один production-шаг Фазы 4 неисполним (включая backup rehearsal).
4. **Подтвердить ли бизнес-модель хранения файлов DEC-026 §1.6?** Пока
   DEC-026 PROPOSED, реализация приёма байтов M3 не может начаться, а M3 P0
   нельзя считать завершённым. Варианты: подтвердить как записано / изменить
   модель / отложить файлы из P0 отдельным решением.
5. **SMTP для верификации Auth** (AP1): какой провайдер и чья учётная запись?
6. **Креды TG4**: выдаётся ли бот-токен хотя бы для закрытого staging, чтобы
   снять BLOCKED_EXTERNAL_CREDENTIALS и выполнить TG2/TG3? Варианты: да,
   disposable-бот; нет, Telegram остаётся за пределами запуска.
7. **Выбор wedge по AP7** из трёх (платный аудит пакета / платный M1→M2 цикл /
   платное управление объектом в M4) — какой запускается первым в Фазе 4?
8. **Авторитетный DB-state включения модулей M3/M4** (общая предпосылка
   backlog'ов обоих модулей): принять единое решение «кто/когда/на каком
   основании включает модуль в production» до Фазы 3?
9. **Судьба легаци-поверхностей** (dashboard/intake/join/pilot на
   service-role + TTL 3600c): мигрировать до пилота или принять документально
   как известный риск первого пилота?

---
*Аудит выполнен строго читающим: изменения ограничены этим файлом и
REMHAOS_LAUNCH_PLAN_2026-08-23.md; `git status` чист помимо них.*


## Поправка 2026-09 — К-1: Platform после даты аудита

[ИЗВЛЕЧЕНО] На baseline `64b23e83bfc028aa3daa25ce07fc9da8a34c87b8`
утверждение §2 `NOT_BUILT: project_facts, Action/Skill Registry, ai_calls`
является историческим: появились [project_facts](../../supabase/migrations/20260824130000_projectceo_platform_facts.sql),
[ai_calls](../../supabase/migrations/20260824140000_projectceo_platform_ai_calls.sql),
[Approval requests](../../supabase/migrations/20260824150000_projectceo_platform_approval_requests.sql),
[workflow templates](../../supabase/migrations/20260824160000_projectceo_platform_workflow_templates.sql)
и [Action Registry](../../lib/project-intelligence/platform/action-registry.ts).
Это подтверждает CODE_PRESENT; проверки и результаты аудита от 23.08
не переносятся автоматически на более новый код.

[ИЗВЛЕЧЕНО] [DEC-038](../canonical/remhaos-v1/REMHAOS_OWNER_DECISION_PLATFORM_FOUNDATION_2026-08-24.md)
открывает repository/disposable platform foundation. Production adoption,
M4 production и PRODUCTION_READY этим решением не открыты.
[ИНТЕРПРЕТИРОВАНО] Поправка устраняет устаревшее NOT_BUILT, не объявляет
весь Platform завершённым или production-ready.
