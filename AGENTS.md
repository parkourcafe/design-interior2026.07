# AGENTS.md — RemHaOS RU / Product Charter v0.4

## Текущий активный контракт

С 18 июля 2026 года источниками продуктовой и delivery-истины являются:

- `docs/product-intelligence/ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md`;
- `docs/product-intelligence/adr/0005-remhaos-public-brand.md`;
- `docs/product-intelligence/architecture-v1.md` с compatibility-решением ADR-0004;
- `docs/product-intelligence/adr/0004-one-archidom-four-workspaces.md`;
- `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md`.

Публичный российский продукт называется **RemHaOS**. `ProjectCEO` сохраняется
только как внутренний compatibility namespace существующего кода, API и database
contracts до отдельно принятой безопасной миграции. `ProUp` как отдельный продукт
отменён.

Текущий исполняемый delivery scope — только RU. Kora Food Hall около 1 800 м²
остаётся полноразмерным эталонным проектом, но до заморозки широкого P0 через ту же
модель данных должен пройти минимум один внешний реальный пакет.

## Четыре публичных рабочих пространства

1. **M1 · Заказчик** → `Contracted Project Passport`.
2. **M2 · Дизайнер** → `Approved Design Intent + Approved Selections`.
3. **M3 · Архитектор** → `Released Production Package`.
4. **M4 · ГлавПрораб** → `As-built & Warranty Archive`.

Это четыре ролевых пространства одного аккаунта, одной Organization, одного Project
и одной модели данных, а не четыре приложения. Один человек может совмещать роли.

## Разрешённая последовательность

1. Сохранить принятый локальный baseline через commit `88b1442` и evidence commit
   `487e993`; существующие green gates не переобъявлять production evidence.
2. Закрыть **Authenticated Pilot Gate** в disposable Supabase, не в production:
   request-bound Auth/PostgREST, additive read contracts, обязательный command
   surface, Storage и пять отдельных role sessions.
3. Пройти Kora end-to-end без ручной записи в базу: invitation → sources → human
   review → approvals → baseline → release → distribution → change/impact → photo
   evidence → acceptance → handover.
4. Пройти внешний реальный пакет через те же Organization/Project/Package contracts.
5. Повторить lint/typecheck/test/build, PG16/PG17, RLS, concurrency, idempotency,
   rollback, restart replay и authenticated browser QA.
6. Проверить минимум два платных concierge/pilot-сценария и второй проект одной
   организации до широкой разработки M2/M4.
7. Production adoption выполнять только отдельным контролируемым решением.

## Неподвижные технические правила

- Existing timestamped migrations immutable; изменения только additive.
- Не переименовывать существующие `projectceo_*` schemas, RPC, routes или internal
  TypeScript namespaces ради публичного ребрендинга без отдельного ADR и migration plan.
- Application runtime не получает direct access к private Project Intelligence tables.
- Human operations не выполняются через service role.
- Actor, organization, project, package, role и effective scope выводятся server-side.
- Один Project принадлежит ровно одной Organization.
- Source provenance и exact revision обязательны для extracted/interpreted facts.
- Published versions, approvals, releases, handoffs и audit append-only/immutable.
- Любая опубликованная версия Layout Document открывается и выгружается вечно,
  ровно в той модели данных, в которой была опубликована (A4 §5). Схема
  версионируется, читатели прошлых версий сохраняются бессрочно, миграция
  применяется только к черновикам и только явно. Отсюда: канонизация и способ
  вычисления подписи версии не меняются после первой публикации — реализация
  этого механизма предшествует любой новой возможности редактора.
- Guest grants hashed, scoped, expiring и revocable.
- Повторные requests/jobs/webhooks идемпотентны.
- AI не утверждает, не выпускает и не согласовывает решения автоматически.
- AI получает только минимально разрешённый контекст; PII, source text, original
  filenames, raw tokens и signed URLs не попадают в structured logs.
- Все пользовательские строки находятся в `lib/i18n/ru.ts`; публичный copy использует
  RemHaOS и названия четырёх рабочих пространств после отдельного UI acceptance gate.
- Деньги хранятся как safe integer RUB; signed deltas типизируются явно.

## Что не строить сейчас

- US/multi-region runtime или отдельную американскую кодовую базу;
- паритет с CAD/BIM: узлы и конструктивные детали, спецификации САПР, расчётные
  разделы, фотореалистичный рендер, запись DWG, а IFC и RVT — целиком; дисциплины
  вне интерьера и ремонта; собственный формат обмена как продукт; продажу
  редактора отдельно от RemHaOS;
- обмен и импорт (решение владельца 08.08.2026, вариант B — A4 §3): наружу
  продукт пишет только открытый DXF; входящие DWG читаются бесплатной
  библиотекой только на сервере и только как подложка для обводки; разбор DWG в
  браузере через WebAssembly запрещён (GPL срабатывает при раздаче бинарника);
  облачная конвертация третьей стороной запрещена (152-ФЗ); значение, снятое с
  подложки, — предложение, не подтверждённое до явного действия дизайнера, и
  обводка не порождает подписанных размеров (A4 §3.3); до получения живого
  .dwg реализация подложки не начинается (A4 §3.2); запасной вариант — A,
  только DXF. Платная лицензия DWG не приобретается; любая внешняя зависимость,
  требующая платной или ограничительной лицензии у конечного пользователя, —
  препятствие, а не деталь реализации;
- полный ERP, бухгалтерию, склад, payroll, marketplace или универсальный task/calendar;
- юридически значимую собственную ЭП без выбранного провайдера и legal review;
- широкий AI Model Router, безлимитный AI или credits billing до provider benchmark,
  unit economics, privacy/legal gate и отдельного принятого execution spec.

**Геометрический редактор разрешён явно** (A4 §1.1): 2D-план, 3D-просмотр, ввод
геометрии мышью, размерные цепи, слои видимости, обмен через DXF и чтение DWG
на сервере как подложки (границы — A4 §3). Размеры — это
и есть зафиксированное решение, без них план не выдать. «Слои» здесь означают
слои видимости, а не систему уровня AutoCAD со стилями линий и весами.

**Правило обоснования функции редактора** (A4 §2.0), обязательное при
планировании любой работы по нему:

> Функция обосновывается тем, насколько она помогает зафиксировать решение,
> а не наличием её в ArchiCAD. Отсутствие CAD-функции само по себе не дефект.

Аргумент «в ArchiCAD это есть» не принимается ни в постановке задачи, ни в
отчёте о готовности. Обоснование — ответ на вопрос, какое решение функция
позволяет зафиксировать и что без неё останется незафиксированным.

**M2 Design Workspace открыт решением ADR-0006 от 08.08.2026.** Его
Decisions/Selections/Approvals реализованы (PR #66), редактор планировок
внедряется отдельно и выключен флагом `ARCHIDOM_LAYOUT_STUDIO_ENABLED`.
Это НЕ снимает требование провести через те же contracts минимум один внешний
реальный пакет до заморозки широкого M2–M4: цикл 7 остаётся открытым.

**M3 Documentation Workspace открыт подписанным Addendum A5 от 09.08.2026**
(`docs/canonical/remhaos-v1/REMHAOS_ADDENDUM_A5_M3_OPENING.md`, DEC-024).
Объём — только P0 по `MASTER_EXECUTION_PLAN` §M3: intake PDF/JPG/PNG/CSV/XLSX,
связи room/sheet/specification, ревизии, completeness/conflict review, baseline
и immutable Released Production Package. Native CAD/BIM authoring в M3 не
строится; генерация листов из подписанной версии планировки — пост-P0 и требует
отдельного решения. Вход в модуль — **только** persisted exact handoff
(`publish_m2_m3_handoff` / `createM2ToM3Handoff`), обходов не строится. Как и в
случае M2, это НЕ снимает требование внешнего реального пакета: цикл 7 остаётся
открытым, `npm run test:cycle7` красный намеренно.

**M4 Execution Workspace открыт подписанным Addendum A6 от 10.08.2026**
(`docs/canonical/remhaos-v1/REMHAOS_ADDENDUM_A6_M4_OPENING.md`, DEC-025) —
**в объёме инкремента 1**: `distribute_release`, `acknowledge_release`,
`create_change`. С 12.08.2026 (DEC-033, см. ниже «V1 Impact») к ним добавлен
`review_change_impact` — расчёт остаётся воркерным, но его ревью человеком
теперь тоже инкремент 1. Остальные четыре команды модуля —
`upload_photo_evidence`, `review_photo_evidence`, `accept_milestone`,
`build_handover` — **закрыты** (V2/V3, `NOT AUTHORIZED`). Вход в модуль —
**только** подтверждённая выдача Released Production Package, обходов не
строится.

**Целевой человеческий контракт модуля — десять команд (DEC-032 LOCKED,**
`docs/canonical/remhaos-v1/REMHAOS_A6_CLARIFICATION_M4_EXECUTION_LAYER_2026-08-12.md`**).**
К восьми командам A6 добавляются `define_milestone` и
`register_handover_document`: обе — человеческие RPC с capability
`review_milestone` (`20260717103000`), воркером не вызываются, и без них цепочка
не замыкается. Здесь же A6 §1.1 поправлен по факту: он относил вехи к
воркерному плану — это неверно. `build_handover` уточнён как человеческий запрос
**необратимой** финализации, порождающий durable build request; воркер не
закрывает версию по одному лишь наличию `warranty` и принятых вех.
Расчёт влияния и `build_construction_handover` остаются **worker-only**
и в число десяти команд НЕ входят — ревью расчёта человеком (`review_change_
impact`) в счёт входит, сам расчёт нет. С 12.08.2026 (DEC-033) единственная
системная дверь расчёта — `calculate_change_impact_policy_bound`; прежняя
дверь с произвольной глубиной от вызывающего (`calculate_change_impact`)
закрыта даже для `service_role` — см. «V1 Impact» ниже. Требование A6 §5.1 —
тест, роняющий CI при неучтённой команде — сохраняется и сверяется с числом
10; подгонять ожидание без ссылки на уточнение запрещено. Подписанный A6 не
переписывается.

**Что из этого разрешено строить: E0R и, с 12.08.2026, V1 (Impact) — DEC-033
LOCKED, см. ниже.** Уточнение фиксирует целевую архитектуру; отдельные OWNER
GO авторизуют реализацию по частям. **V2 (Field Evidence) и V3 (Handover) —
по-прежнему `NOT AUTHORIZED`** до отдельного **M4 IMPLEMENTATION GO**
владельца. До него команды `upload_photo_evidence`, `review_photo_evidence`,
`accept_milestone`, `build_handover` в контракте приложения недостижимы,
воркеры вех и сборки архива передачи не строятся, права V2/V3 не выдаются ни
одной PostgREST-роли ни в одной среде, а поверхность V2/V3 продолжает отдавать
`increment_not_authorized`.

Порядок жёсткий: код начинается после гейта 1 (`publish_baseline →
publish_release` пройдены через браузер отдельными ролевыми сессиями), а
инкремент доказывается гейтом 2, где `acknowledge_release` подтверждает
**получатель своей сессией**, а не отправитель. Флаг модуля
`REMHAOS_EXECUTION_ENABLED` выключен по умолчанию и заведён отдельным
guardrail-решением (`REMHAOS_GUARDRAIL_DECISION_M4_FLAG.md`), а не аддендумом:
запрет не должен зависеть от разрешения. Включение флага в рабочем окружении —
отдельное решение и не раньше снятия `PLATFORM_FOUNDATION = BLOCKED`.

Состояние на 11.08.2026: гейт 1 пройден и влит (#79), интерфейс инкремента 1
построен, гейт 2 доказан в блокирующем AP5 (звенья 9–11, прогон 195) —
состояние `M4_BROWSER_PROVEN`. Границ у запрета
по-прежнему две, и обе — кодом:

* приложение — `REMHAOS_EXECUTION_ENABLED` закрывает модуль целиком, а пять
  команд инкремента 2 закрыты **отдельной проверкой, не зависящей от флага**:
  включение модуля не открывает того, чего никто не авторизовал;
* база — командные RPC модуля отозваны у `authenticated` (`20260810070000` по
  схеме M4 и `20260811020000` по продуктовой схеме, где живут выдача и
  подтверждение получения). Инкремент 1 открывается ЯВНО и только там, где
  модуль намеренно открыт (`tests/ap1/environment/enable-m4-increment-1.sql`:
  локальные стенды, CI, DB4/AP1). Это механизм одноразовой непроизводственной
  среды — **не** production feature flag и **не** entitlement (DEC-029 LOCKED,
  `REMHAOS_A6_CLARIFICATION_M4_GRANT_MECHANISM_2026-08-11.md`: постоянные
  миграции таких прав не возвращают, production-включение — отдельный OWNER GO
  плюс аудируемый DB-state). Матрица поверхности — `m4-surface.ts`, и всё, что в
  ней написано, проверяется тестами (`m4-surface-matrix.test.ts`, DB4 07 и 08).

**M4 Worker Foundation / Increment 1.5 открыт и построен 11.08.2026**
(DEC-030) в объёме **одного** системного воркера — Release Artifact Worker
(`npm run worker:release-artifacts`, отчёт
`docs/product-intelligence/M4_INCREMENT_1_5_WORKER_REPORT_2026-08-11.md`).
Основание — находка гейта 2: выдача опирается на артефакт выпуска, который
собирает только система, то есть у инкремента 1 воркерная предпосылка всё-таки
есть. Impact calculation, milestones, photo processing и handover **не
разрешены**; инкремент 2 не начинается. Воркер работает только системной
identity, не создаёт человеческого HTTP/RPC-доступа и не открывает M4 в
production. Итоговое состояние этапа — `M4_RELEASE_WORKER_PROVEN`.

**E0R исполнен 12.08.2026** (DEC-032): харнесс `tests/db5/` восстановлен и
подключён обязательным заданием CI на PostgreSQL 16 и 17. Он доказывает
**цепочку операций базы** инкремента 2 — заявка, воркерный расчёт влияния,
ревью, веха, фотодоказательство, приёмка, документ передачи, сборка архива, — и
доказывает её **не ценой открытия**: запрет проверяется до и после цепочки
(`05_default_deny_before.sql`, `90_default_deny_after.sql`), а человеческие RPC
инкремента 2 вызывает отдельная `nologin`-роль, создаваемая внутри одноразового
контейнера, отсутствующая в миграциях и не состоящая ни в одном членстве.
Прикладные команды, воркеры, реальный source intake и браузерное E2E **не
построены**. Постоянные гранты не изменены.

**V1 Impact открыт 12.08.2026 (DEC-033 LOCKED, PR #94/#96) и скорректирован
тем же днём дважды — контракт покрытия (DEC-034 LOCKED) и числовое значение
политики (DEC-035 LOCKED), обе поверх DEC-032, обе OWNER CONTINUE
«ЗАВЕРШИТЬ СУЩЕСТВУЮЩИЙ V1».** Единственная системная дверь расчёта —
`calculate_change_impact_policy_bound`; глубина и лимит — ЗАФИКСИРОВАННАЯ
серверная политика, вызывающий их не передаёт и повлиять на них не может.
**Активная политика — `maxDepth = 7`, `maxImpacts = 5000`, версия
`project-ceo-impact-policy/0.2`** (DEC-035): исходный OWNER GO зафиксировал
`maxDepth = 7`; слитая параллельной сессией миграция `20260812010000`
записала туда `8` — числовая ошибка переноса, не переоткрытие вопроса.
Исправлено аддитивно, `20260813020000`: `create or replace function` на
`_impact_policy()`, новая версия политики, старая (`0.1`/`maxDepth = 8`)
остаётся подписью уже сохранённых (на момент коррекции — не существовавших)
прогонов, а не текущим поведением. Сырая `calculate_change_impact`
(произвольная глубина от вызывающего) продолжает существовать как внутренний
примитив, вызываемый обёрткой под `security definer`, но закрыта даже для
`service_role` — доступ снаружи только через policy-bound дверь.

Три durable terminal исхода: `complete` (обход исчерпан в границе глубины),
`partial_depth` (упёрся в глубину — `hasMoreBeyondDepth`/
`cutoffReason='depth_boundary'`/`knownImpactCountLowerBound =
returnedImpactCount + 1`), `blocked_result_limit` (найдено больше 5000 — ни
одно влияние не сохраняется, `returnedImpactCount = 0`,
`knownImpactCountLowerBound = 5001`); при совмещённом срабатывании глубины и
лимита побеждает лимит, без зонда глубины и без второго полного обхода.
Старое булево `allImpactsReviewed` разделено на `allReturnedImpactsReviewed`
/ `coverageComplete` / `impactReviewComplete = allReturnedImpactsReviewed AND
coverageComplete` — просмотреть все ПОКАЗАННЫЕ карточки не значит «анализ
завершён» для partial/blocked, и человеческого способа обойти это нет.
`review_change_impact` перешёл из закрытого множества V2/V3 в инкремент 1.

**Что исправила DEC-034.** PR #94 (`20260812020000`) заменил прежний отказ
при превышении лимита на «truncate-and-keep»: сохранял первые 5000 карточек с
признаком неполноты и открывал третью человеческую дверь
(`acknowledge_impact_truncation`) для подтверждения незавершённости — оба
решения прямо противоречили DEC-033 («первые 5000 не показываются как
частичный результат ни при каком раскладе», «human override запрещён»).
Коррекция — ОДНА аддитивная миграция (`20260813010000`) поверх неизменяемых
`20260812010000/020000/030000`: `create or replace function` на
`calculate_change_impact` (при превышении лимита результат обнуляется до
вставки, короткое замыкание до зонда глубины), `review_change_impact` (без
шлюза подтверждения), `get_execution_delivery` (отдаёт точный контракт
покрытия) и `projectceo_m4._v1_impact_signatures()` (список дверей
production-переключателя сократился с трёх до двух — та же точка правит и
открытие, и закрытие). `acknowledge_impact_truncation` закрыта явным
`revoke` на каждом уровне и не возвращается ни одним состоянием
production-переключателя DEC-033. Старые колонки (`is_truncated`,
`truncation_reason`, `calculated_depth`, `policy_max_depth`) не удалены —
новые добавлены рядом, инвариант трёх исходов закреплён CHECK-констрейнтом.

Доказательство — оба на PostgreSQL 16 и 17: `tests/db5/26_impact_policy_
benchmark.sql` (детерминированность, честный сигнал усечения, время на
реальной RPC, регрессия blocked_result_limit на реальном широком графе, без
ручного подтверждения) и `tests/db5/29_impact_coverage_dec034.sql` (точная
граница — ровно 5000 не блокирует, ровно 5001 блокирует терминально,
приоритет лимита на графе, одновременно широком и глубоком, персистентность
на таблицах, исчезновение из очереди воркера) — плюс parallel-worker
(`27_impact_concurrency_fixture.sql` + `run-concurrency.zsh`) и restart/replay
(`30_restart_replay.sql`) пробы, и production-переключатель
(`28_v1_production_switch.sql`: ровно две двери, третья недостижима ни при
каком состоянии). AP5 звено 12 (`tests/ap5/02-kora-chain.spec.ts`): настоящий
воркер (`npm run worker:change-impact`, не мост) считает влияние заявки звена
11, АРХИТЕКТОР ОТДЕЛЬНОЙ аутентифицированной сессией рассматривает результат
и видит `allReturnedImpactsReviewed`/`coverageComplete`/`impactReviewComplete`,
а попытка вызвать `acknowledge_impact_truncation` отклоняется
`operation_unavailable` до обращения к базе. Звенья 13–15 (тот же файл,
OWNER REVIEW 12.08.2026) закрывают три оставшихся блокера отдельно от
основной цепочки: звено 13 — три системные двери расчёта недостижимы
человеческой сессией через настоящий Data API (401/403/404, не 400); звено
14 — `partial_depth` на настоящей странице (`page`, не `context.request`):
точный текст «Показаны найденные влияния. Анализ ограничен глубиной и не
является полным», рассмотрены ВСЕ показанные карточки настоящими кликами, и
DOM всё равно показывает «Рассмотрение не закрыто» — ни одной кнопки
человеческого override нигде на странице; звено 15 — `blocked_result_limit`
на настоящей странице: точный текст «Обнаружено не менее N влияния. Сузьте
изменение», ПОЛНОЕ отсутствие кнопок рассмотрения (рассматривать нечего, а не
недоступно), и заявка исчезает из воркерной очереди совсем при повторном
проходе. Фикстуры звеньев 14/15 — глубокая цепочка и широкая звезда узлов —
собраны настоящей RPC `ingest_source_graph` токеном архитектора (тот же
класс отступления, что у звена 5б), не service role и не прямым SQL.

**Надёжность воркера расчёта влияния — DEC-036 LOCKED (OWNER REVIEW
12.08.2026, поверх DEC-034/035).** До этого решения неизвестный отказ внутри
`calculateOne` выбрасывался исключением, прерывал цикл `runChangeImpactWorker`
и блокировал обработку ВСЕХ последующих заявок прохода — один сломанный
элемент держал очередь целиком. Теперь `calculateOne` — тотальная функция:
отказ по одной заявке классифицируется (транзиентный — сеть/`internal_error`;
постоянный — неразрешимый baseline/структурный код) и записывается durable в
новую таблицу `projectceo_m4.impact_worker_failures` через новую дверь
`record_change_impact_worker_failure` (только `service_role`). Транзиентный
отказ копит ограниченный бюджет попыток (`max_attempts = 5`) с растущей, но
ограниченной паузой (`least(2^attempt · 1s, 5m)`) и временно выпадает из
активной очереди до наступления `next_attempt_at`; исчерпание бюджета — как и
постоянный отказ немедленно — уходит в durable dead-letter и исчезает из
очереди СОВСЕМ, не на паузу. Возврат в работу — только операторский редрайв
(`projectceo_m4.redrive_change_impact_worker_failure`, приватная схема,
недостижим НИ ОДНОЙ ролью включая `service_role`, та же форма, что у
`open_v1_impact_production`), не автоматическое воскрешение. Успешный расчёт
снимает след прежних отказов. Итоговое состояние этапа — `M4_V1_IMPACT_PROVEN`.

Расширенный платный M4 из Charter (WBS, schedule, split estimate, procurement,
Change Order) остаётся целевым состоянием и **A6 его не открывает**: не раньше
wedge validation. ERP, склад и бухгалтерия не входят. Как и в случае M2 и M3,
это НЕ снимает требование внешнего реального пакета: цикл 7 остаётся открытым.

**Telegram Chat Bridge открыт подписанным Addendum A7 от 11.08.2026**
(`docs/canonical/remhaos-v1/REMHAOS_ADDENDUM_A7_TELEGRAM_CHAT_BRIDGE.md`,
DEC-031) в объёме P0. Мост — **один горизонтальный адаптер**
`Integration Gateway → Messaging`, а не Module 5 и не бот на каждый модуль.

Железные правила моста:

* **Telegram не переносит полномочия.** Членство в группе не создаёт роль
  RemHaOS; «получил» не выполняет `acknowledge_release`; фото не является
  приёмкой; callback и deep link не выполняют mutation. Официальное действие —
  только существующая команда RemHaOS от человеческой сессии.
* **Из чата приходит только кандидат.** Сообщения, вложения и выводы AI
  создают неподтверждённые записи в Project Inbox и ничего больше.
* **Идентификаторы Telegram живут только в слое моста.** Добавлять
  `telegram_chat_id` / `telegram_user_id` в доменные таблицы M1–M4, писать из
  webhook в business tables, звать human RPC через `service_role`, выполнять
  команды из текста сообщения или давать LLM tool-доступ к mutations —
  запрещено.
* **Бот не создаёт группу.** Человек создаёт или выбирает её и добавляет бота
  через `startgroup`; текст действия в UI — «Создать или подключить
  Telegram-чат».
* **Выключен по умолчанию:** `REMHAOS_TELEGRAM_BRIDGE_ENABLED=false`.
  Выключенный мост не принимает, не классифицирует и не отправляет.

A7 меняет Charter §12 ровно настолько, чтобы разрешить разработку и
тестирование в local, CI и закрытом staging с тестовыми участниками. Он **не**
включает production, **не** разрешает массовый приём переписки третьих лиц,
**не** обходит гейт российского data plane, **не** закрывает 152-ФЗ и **не**
открывает M4 Increment 2. Production — отдельный OWNER GO после
legal/data-plane/consent/retention gate. Внутренний мессенджер не строится.

## Definition of Done

Для каждого принятого слоя:

```text
npm run lint
npm run typecheck
npm run test
npm run build
```

Database layers дополнительно проходят disposable PostgreSQL 16 и 17, RLS,
negative tenancy/package scope, concurrency, idempotency, rollback и restart replay.
Browser acceptance разделяет sanitized fixture QA и настоящую authenticated
Auth/PostgREST/RLS matrix; первое не заменяет второе.

Любое утверждение `PRODUCTION_READY=true` запрещено до заполненного adoption
checklist, свежего production snapshot, backup/restore rehearsal, SMTP/Auth/Storage
проверок, monitoring и отдельного человеческого GO.
