# AP1 Runbook — authenticated pilot в disposable-окружении

**Основание:** `AGENTS.md` («Закрыть Authenticated Pilot Gate в disposable Supabase, не в production») и `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md` §4 (ворота AP1/AP2/AP3).

**Статус на 01.08.2026:** окружение создано, миграции не применены.

---

## 0. Контекст, который нельзя потерять

Обнаружено 01.08.2026 при первом прямом доступе к Supabase: **production и этот репозиторий — разные архитектурные линии.**

- В проде (`design2026` / `ztnycrchwxqczqbyegnp`) нет ни одной схемы `projectceo_*` или `project_intelligence`.
- Журнал миграций прода — 13 записей, ни одной из них нет в репозитории (`platform_foundation_m1`, `govern_proposal_revisions_and_workflow_commands`, `complete_m1_governed_runtime` и др.).
- Прод живёт собственным «governed M1 runtime»: `workflow_runs`, `approval_requests`, `project_facts`, `ai_calls`, `proposal_revisions`, плюс колонка `proposals.issued_revision_id`, которой нет в схеме репозитория.
- В проде реальные данные: 8 дизайнеров, 27 проектов, 86 ответов, 53 события.

**Решение владельца (вариант 3):** прод остаётся текущим продуктом для клиентов; ProjectCEO/AP1 проверяется в отдельном disposable-окружении; судьба репозитория и миграции решается отдельно после пилота.

Практическое следствие: **AP3-команды репозитория (`create_decision`, `review_selection`, `publish_baseline`) невозможно проверить на проде** — там нет этих RPC. Только в AP1-окружении.

---

## 1. Окружение

| | |
|---|---|
| Проект | `remhaos-ap1-disposable` |
| Ref | `uafvzxdxlxqkpsejgskt` |
| Регион | `ap-northeast-1` (как у прода) |
| Стоимость | **$10/мес — удалить после закрытия AP1** |
| Создан | 01.08.2026 |

> **Правило владельца:** удалить сразу после зелёных тестов, сохранённого отчёта и проверки PR. Если AP1 откладывается — удалить, чтобы не платить за простой. Прод от удаления не страдает.

---

## 2. Применение миграций

> ### ⚠️ Папка миграций не bootstrap-ится подряд — `supabase db push` на чистой базе упадёт
>
> Проверено на практике 01.08.2026. `20260716071024_legacy_production_baseline.sql`
> — это **замена** миграциям `0001`–`0007`, а не их продолжение. В нём стоит
> guard, который падает с `legacy production baseline is clean-bootstrap only;
> application relations already exist`, если таблицы уже созданы.
>
> Из шапки самого файла: baseline воспроизводит проверенную продовую схему на
> момент 2026-07-16 и включает эффекты `0001_init`, `0002_client_briefs`,
> `0003_custom_questions`, `0004_designer_profile`, `0006_team` и точного блоба
> `0007_project_rooms`. Исключены `0005_rate_limits` и `0008_concept_packs`
> (в проде отсутствовали), `0009_project_room_workflow` отвергнут как небезопасный.
>
> **Практические следствия:**
> - на чистом окружении применять **baseline, а не 0001–0007**;
> - `0001`–`0007` в папке — исторические, для окружений, где они уже применены
>   до появления журнала;
> - в репозитории под номером `0007` лежит `invite_tokens`, а baseline включает
>   другой исторический `0007_project_rooms` — то есть 0001–0007 **не создают**
>   таблицы Module 3 (`project_rooms`, `project_participants`, `project_tasks`,
>   `project_task_events`), которые есть в проде и в baseline;
> - после baseline **нет** `rate_limits` — если он понадобится, применять
>   `0005_rate_limits.sql` отдельно поверх.
>
> Это прямо конфликтует с требованием AP1 «exact additive migration ledger»
> (MASTER_EXECUTION_PLAN §4) и требует отдельного решения владельца: либо
> пометить `0001`–`0007` как superseded, либо снабдить папку явной инструкцией
> о двух путях bootstrap.

Порядок для **чистого** окружения (baseline + слой ProjectCEO):

```
 1  20260716071024_legacy_production_baseline.sql
 2  20260716072000_project_intelligence_core.sql
 3  20260716073000_project_intelligence_operations.sql
 4  20260717090000_projectceo_foundation_access.sql
 5  20260717091000_projectceo_foundation_ingestion_read.sql
 6  20260717092000_projectceo_foundation_integration_hardening.sql
 7  20260717100000_projectceo_product_brain_persistence.sql
 8  20260717101000_projectceo_product_brain_operations.sql
 9  20260717101500_projectceo_product_brain_relational_hardening.sql
10  20260717102000_projectceo_m4_execution_persistence.sql
11  20260717103000_projectceo_m4_execution_operations.sql
12  20260718124958_projectceo_ap1_authenticated_reads.sql
13  20260718223000_projectceo_ap1_inventory_duplicate_groups.sql
14  20260718225000_projectceo_ap1_legacy_metadata_bridge.sql
```

Историческая последовательность (только для окружений, где она уже применена):

```
 1  0001_init.sql
 2  0002_client_briefs.sql
 3  0003_custom_questions.sql
 4  0004_designer_profile.sql
 5  0005_rate_limits.sql
 6  0006_team.sql
 7  0007_invite_tokens.sql
 8  20260716071024_legacy_production_baseline.sql
 9  20260716072000_project_intelligence_core.sql
10  20260716073000_project_intelligence_operations.sql
11  20260717090000_projectceo_foundation_access.sql
12  20260717091000_projectceo_foundation_ingestion_read.sql
13  20260717092000_projectceo_foundation_integration_hardening.sql
14  20260717100000_projectceo_product_brain_persistence.sql
15  20260717101000_projectceo_product_brain_operations.sql
16  20260717101500_projectceo_product_brain_relational_hardening.sql
17  20260717102000_projectceo_m4_execution_persistence.sql
18  20260717103000_projectceo_m4_execution_operations.sql
19  20260718124958_projectceo_ap1_authenticated_reads.sql
20  20260718223000_projectceo_ap1_inventory_duplicate_groups.sql
21  20260718225000_projectceo_ap1_legacy_metadata_bridge.sql
```

Предпочтительный способ — Supabase CLI (не тянет SQL через контекст агента):

```bash
supabase link --project-ref uafvzxdxlxqkpsejgskt
supabase db push
```

**Проверка после применения** — должны появиться схемы `project_intelligence`, `projectceo_foundation`, `projectceo_product`, `projectceo_product_api`, `projectceo_read_api`, `projectceo_m4`, `projectceo_m4_api`:

```sql
select nspname from pg_namespace where nspname like 'projectceo%' or nspname = 'project_intelligence' order by 1;
```

---

## 2a. Предусловие по ролям — обязательно на стандартном Supabase

Проверено 01.08.2026. Миграции слоя Project Intelligence **не применяются** на
обычном проекте Supabase без ручной подготовки ролей.

Причина: `postgres` в Supabase — не superuser. В PostgreSQL 16+ роль с
`CREATEROLE`, создавая новую роль, получает `admin_option`, но **не**
`set_option` и не `inherit_option`. Замерено на живой базе: `admin_option: true`,
`set_option: false`. При этом `create schema … authorization pi_table_owner`
требует `SET ROLE`, а `alter default privileges for role …` — членства с
наследованием.

Симптомы без предусловия (оба воспроизведены):
```
ERROR: 42501: must be able to SET ROLE "pi_table_owner"
ERROR: 42501: permission denied to change default privileges
```

**Выполнить ОДИН раз до первой миграции слоя:**

```sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname='pi_table_owner') then
    create role pi_table_owner nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname='pi_human_executor') then
    create role pi_human_executor nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname='pi_worker_executor') then
    create role pi_worker_executor nologin noinherit nobypassrls;
  end if;
end $$;

grant pi_table_owner     to postgres with inherit true, set true;
grant pi_human_executor  to postgres with inherit true, set true;
grant pi_worker_executor to postgres with inherit true, set true;
```

Роли остаются `NOLOGIN NOINHERIT NOBYPASSRLS` — guard внутри миграции это
проверяет и пропускает их создание. Членство `postgres` атрибуты ролей не меняет.

Проверка (все три должны быть `true`):
```sql
select rolname,
       pg_has_role('postgres', oid, 'SET')   as can_set,
       pg_has_role('postgres', oid, 'USAGE') as can_use
from pg_roles where rolname like 'pi_%' order by rolname;
```

## 2b. 🔴 БЛОКЕР: авторизация ProjectCEO не работает на Supabase — и падает молча

Найдено 01.08.2026 при первом реальном вызове RPC. Это самая серьёзная находка
пилота: **вся аутентифицированная поверхность ProjectCEO нерабочая на стандартном
Supabase**, при этом миграции отчитываются об успехе.

### Симптом

```
ERROR: 42501: permission denied for schema auth
QUERY:  auth.uid()
CONTEXT: PL/pgSQL function projectceo_foundation._authorize_project_human(uuid,text)
         line 3 during statement block local variable initialization
```

### Причина

1. `_authorize_project_human` — `SECURITY DEFINER`, владелец `pi_table_owner`.
   Значит внутри она выполняется от имени `pi_table_owner`, а не вызывающего.
2. Она зовёт `auth.uid()`, но у `pi_table_owner` **нет `USAGE` на схему `auth`**.
3. Миграции этот грант выдают — трижды:
   - `20260716072000_project_intelligence_core.sql:2622` (для `pi_human_executor`)
   - `20260717090000_projectceo_foundation_access.sql:2426`
   - `20260717092000_projectceo_foundation_integration_hardening.sql:11`
4. **Но грант молча не срабатывает.** Схема `auth` принадлежит `supabase_admin`;
   у `postgres` на неё только `U` без права передачи, и в `supabase_admin` он не
   входит (проверено: `pg_has_role('postgres','supabase_admin','USAGE') = false`).
   PostgreSQL в таком случае выдаёт `WARNING: no privileges were granted`, а не
   ошибку — миграция проходит «успешно», грант не применяется. ACL схемы `auth`
   после применения всех миграций `pi_table_owner` не содержит.

Именно поэтому дефект не ловится ничем, кроме реального вызова: ни билд, ни
тесты, ни успешное применение миграций его не показывают.

### Радиус поражения

6 функций `SECURITY DEFINER`, владелец `pi_table_owner`, зовущих `auth.uid()`.
Среди них точки входа `projectceo_api.accept_invitation`,
`projectceo_api.enroll_organization_project`, `projectceo_api.list_projects`
плюс общий `_authorize_project_human`, который вызывают все остальные RPC.
То есть заблокированы AP1, AP2 и AP3 целиком.

### Исторический обходной путь (не применять)

```sql
grant authenticated to pi_table_owner with inherit true;
```

Ранее этот грант использовался только для доказательства причины сбоя. Он
искусственно маскирует несовместимость managed Supabase и не входит в текущий
фикс. Disposable verifier теперь, наоборот, отзывает `USAGE` на `auth`, ACL на
`auth.users` и любую policy для `pi_*`, чтобы тестировать hosted-поведение.

> ⚠️ Это обход для disposable-окружения, **не исправление продукта**.

### ✅ Проверено: это ЕДИНСТВЕННЫЙ блокер

После применения обхода прогнаны реальные вызовы под симулированной сессией
(`request.jwt.claims` + `set local role authenticated`). Результаты:

| Проверка | Результат |
|---|---|
| `projectceo_read_api.get_project_workspace_read` | ✅ вернул корректный scope: `organizationId`, `actorUserId`, `accessScope='project'` |
| `projectceo_product_api.append_decision_revision` | ✅ ревизия создана, `revisionNo=1`, `stateRevision` 0 → 1 |
| Идемпотентность (повтор с тем же ключом) | ✅ `replay=true`, повторной записи нет |
| Deny-by-default | ✅ `authenticated` не может читать `project_intelligence.*` и `projectceo_foundation.*` напрямую |

Вывод: за грантом вся модель — авторизация, запись, идемпотентность,
изоляция схем — работает как задумано. Объём исправления **узкий**: это одна
проблема доступа, а не архитектурный дефект.

Попутно подтверждено, что команда `create_decision`, подключённая в PR #55,
реально работает против настоящей БД, а не только против моков.

Отдельная деталь: корневой пакет создаётся автоматически при регистрации
проекта (`id` = `project_id`, `stable_key='project-root'`) — вставлять его
вручную не нужно.

### Что нужно исправить в продукте (решение владельца)

Решение в additive-миграции — request-bound claims helpers. Грант членства
`authenticated → pi_table_owner` и доступ к managed `auth` не нужны и не должны
возвращаться. Три исторические попытки выдать такие права остаются неизменной
историей миграций, но не используются runtime.

### 2c. Подготовленный additive fix (не считать проверенным до живого RPC)

В ветке подготовлена миграция
`20260801120000_projectceo_request_claim_authorization.sql`. Она:

- добавляет закрытые helpers для `request.jwt.claim.sub` и
  `request.jwt.claims`;
- переписывает сохранённые Project Intelligence/ProjectCEO function bodies,
  которые ссылались на managed `auth.uid()`/`auth.jwt()`, не меняя публичные
  сигнатуры и владельцев;
- переводит затронутые RLS policies на тот же role-neutral actor source;
- добавляет fail-fast guard, если хотя бы одна auth-ссылка осталась;
- не выдаёт `authenticated` членство `pi_table_owner` и не пытается отзывать
  ACL, владельцем которых является `supabase_admin`.

Статические contract tests проходят. Это ещё **не** доказательство фикса:
нужны clean replay, реальный request-bound RPC как authenticated session,
negative tenant/package checks и restart replay на disposable Supabase.

### 2c.1. Локальная проверка после фикса (01.08.2026)

На уже развернутом disposable PostgreSQL после отзыва всех `auth` ACL:

- `list_projects` от authenticated owner отработал успешно;
- `get_project_workspace_read` от своего проекта отработал успешно;
- запрос к чужому проекту отклонён `P1103 PROJECT_CAPABILITY_REQUIRED`;
- `accept_invitation` с несуществующим токеном вернул штатный `P1104 not_found`,
  без `permission denied for schema auth`;
- verifier подтвердил `AP1_DB_OK`, private runtime grants = 0 и закрытое Storage.

Это подтверждает устранение authorization blocker в runtime-коде, но не заменяет
чистый replay: он по-прежнему останавливается на migration-order guard (раздел
2d).

### 2d. Live Preview подтвердил отдельный migration-order blocker

01.08.2026 Supabase Preview для PR #60 остановился **до** новой auth-миграции:

```text
ERROR: legacy production baseline is clean-bootstrap only;
application relations already exist (SQLSTATE P0001)
```

Причина подтверждена живым replay: CLI применяет `0001`–`0007`, затем запускает
`20260716071024_legacy_production_baseline.sql`, который намеренно отказывается
работать поверх уже созданных legacy relations.

Это нельзя исправлять снятием guard или переписыванием timestamped migration.
Перед следующим AP1 replay нужен отдельный migration-path decision:

- clean-bootstrap ledger: baseline + Project Intelligence/ProjectCEO;
- historical incremental ledger: `0001`–`0007` + только additive migrations;
- явный disposable runner/manifest, который выбирает ровно один путь.

Пока этот decision не materialized, Preview failure считается ожидаемым
`MIGRATION_ORDER_BLOCKED`, а не дефектом новой auth-миграции.

## 3. Пять ролевых пользователей

```bash
AP1_CONFIRM_DISPOSABLE=yes npm run provision:ap1
```

Требует в `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (от AP1-проекта, **не от прода**), `AP1_TEST_PASSWORD`, опционально `AP1_EMAIL_DOMAIN`.

Скрипт создаёт только auth-identity с подтверждённым email. **Членства он намеренно не выдаёт** — по инварианту `AGENTS.md` «human operations не выполняются через service role». Роли раздаются штатным invitation-потоком от лица owner:

| Ключ | Целевая роль | Как получает доступ |
|---|---|---|
| `owner` | `owner_lead` | создаёт Organization и Project |
| `designer` | `architect` | invitation от owner |
| `builder` | `builder` | invitation от owner |
| `client` | `client_approver` | invitation от owner |
| `guest` | — | отдельный guest grant, без членства |

---

## 4. Что именно проверяем (главное)

### 4.1 Semantic hash у `publish_baseline` — основной открытый вопрос

`publish_baseline` подключён (PR #57), но принимает `semanticHash` от клиента и только валидирует формат. RPC пересобирает канонический объект сам и сверяет побайтово, подмешивая `organizationId` и текущие строки `project_packages` — то есть клиент не может вычислить хэш «из воздуха».

Готовый хелпер: `lib/project-intelligence/modules/decisions/baseline-semantic-hash.ts` (PR #58, в `main` не влит на момент написания).

**Прогон:**
1. Создать Organization/Project/Package и хотя бы одну approved `ApprovalPackage` с decision/selection-ревизией.
2. Посчитать хэш хелпером из данных `projectceo_read_api.get_project_workspace_read` (`scope.organizationId` + `data.packages`).
3. Вызвать `publish_baseline` с этим хэшем.

**Ожидаемо:** команда проходит. **Если `BASELINE_SEMANTIC_HASH_MISMATCH`** — сравнить `actualSemanticHash` из ответа RPC с локально посчитанным и найти расхождение в канонизации. Две известные ловушки уже учтены в хелпере: read-RPC отдаёт packages в порядке `stable_key`, а хэш считается в порядке `id`; `_sorted_unique_text_array` дубли не схлопывает, а отвергает.

> **✅ Канонизация проверена на живом PostgreSQL 17.6 (01.08.2026).**
> Прогнаны `project_intelligence._canonical_jsonb` и `_sha256_jsonb` на тестовом
> объекте, результат сверен с TS-хелпером: канонический текст **побайтово
> идентичен**, хэш идентичен —
> `sha256:b9548edd5ff1b2141c224e5e039e239141e61735cdcf6c6d3d88c5118df49799`.
> Значение закреплено литералом в `baseline-semantic-hash.test.ts` как
> регрессия против расхождения TS и Postgres.
>
> Это снимает главный риск, но **не** заменяет сквозной прогон: остаётся
> проверить, что `publish_baseline` проходит целиком при живых
> org/project/package и одобренном `ApprovalPackage`.

### 4.1a Сквозной прогон — что потребуется

API-функций для создания Organization/Project/Package **нет** — они заполняются
прямыми вставками (операторский путь). Порядок:

1. `project_intelligence.organizations` → `organization_members`
2. `project_intelligence.project_workflows` (несёт `state_revision`)
3. `projectceo_foundation.project_packages` → `project_memberships` (роль `owner_lead`)
4. `project_intelligence.project_versions` + `version_nodes`
5. далее уже через RPC: `append_decision_revision`, `append_selection_revision`,
   `create_approval_package`, `submit_approval_package`, `review_approval_package`
6. и наконец `publish_project_baseline`

Все `user_id` ссылаются на `project_intelligence.organization_members`, а не
напрямую на `auth.users` — то есть пользователя надо сперва завести в организацию.

RPC выводят актора из request-bound claims helper, поэтому вызывать их из
SQL-редактора нужно с подменой контекста:
```sql
select set_config('request.jwt.claims',
  '{"sub":"<user-uuid>","role":"authenticated"}', true);
set role authenticated;
```

### 4.2 Остальные ворота

- **AP1** — request-bound Auth/PostgREST, Storage, пять ролевых сессий, redirect allowlist, test-only mail.
- **AP2** — read-контракты не раскрывают private relation names, оригинальные имена файлов, абсолютные пути, signed URLs, чужие пакеты и другую Organization.
- **AP3** — сквозной сценарий Kora: invitation → sources → human review → approvals → baseline → release → distribution → change/impact → photo evidence → acceptance → handover.

Команды, всё ещё недоступные и потому вне сценария: `register_source`, `review_source` (RPC не существуют — нужна новая миграция), `publish_release`, `build_handover` (последняя ведёт в схему `projectceo_m4_api`, куда command-service не маршрутизируется).

### 4.3 Постусловия против молчаливого возврата auth-дефекта (02.08.2026)

Дефект §2b был невидим потому, что `grant usage on schema auth` отвечает
`WARNING`, а не `ERROR`: миграция «успешна», функция падает только у живого
аутентифицированного клиента. Три уровня защиты, чтобы это не повторилось:

1. **Момент применения** — `do $guard$` в самой миграции
   `20260801120000` (`PROJECTCEO_MANAGED_AUTH_REFERENCE_REMAINS`). Покрывает
   семь схем и срабатывает один раз.
2. **Состояние базы** — `verify-db.sql`:
   `AP1_MANAGED_AUTH_REFERENCE_REMAINS` (девять схем, включая
   `project_intelligence_api` и `projectceo_read_api`, которых в guard'е
   миграции нет) и `AP1_REQUEST_CLAIM_READERS_INVALID` (обе функции
   `_request_*` существуют, `security definer`, владелец `pi_table_owner`,
   `search_path` пришпилен). Срабатывает после **любой** последующей миграции.
3. **Исходники** — `auth-regression.contract.test.ts`: ни одна миграция после
   `20260801120000` не вводит `auth.uid/jwt/users` в PI-схему, и набор
   инертных `grant usage on schema auth` не растёт.

Обе SQL-проверки прогнаны на живом Postgres 17: негативный случай —
`_request_*:MISSING` на базе без слоя ProjectCEO; позитивный — регулярка
находит 19 из 28 функций там, где обращения к `auth` действительно есть.

---

## 5. Definition of Done

Из `AGENTS.md`:

```
npm run lint
npm run typecheck
npm run test
npm run build
```

Плюс для слоёв БД: disposable PostgreSQL 16 и 17, RLS, negative tenancy/package scope, concurrency, idempotency, rollback, restart replay. Browser acceptance разделяет sanitized fixture QA и настоящую authenticated Auth/PostgREST/RLS matrix — первое не заменяет второе.

`PRODUCTION_READY=true` запрещено до заполненного adoption checklist, свежего production snapshot, backup/restore rehearsal, проверок SMTP/Auth/Storage, monitoring и отдельного человеческого GO.

---

## 6. Закрытие

1. Зафиксировать результаты прогона в отчёте.
2. Проверить и слить PR #58 (или переработать по итогам прогона).
3. **Удалить проект `uafvzxdxlxqkpsejgskt`.**
4. Отдельным решением — судьба репозитория относительно прода (см. §0).
