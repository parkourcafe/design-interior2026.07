# Контакты и бюджет клиента: кто получает поля напрямую через Data API, на каком основании, соответствует ли утверждённым правам

Дата: 11.10.2026. Основание: решение владельца 11.10.2026, п. 5 («Контакты и бюджет пока не меняй. Представь отдельно…»). Код и права **не менялись**. Источник истины — миграции `supabase/migrations/` (состояние после `20261011110000`), `supabase/config.toml` (схемы Data API), приложение `lib/`, `app/`, `components/`. Hosted-БД не опрашивалась; её `[api].schemas` могут отличаться от локального `config.toml`.

Поля: `passport.contact` {name, phone, email} и `passport.budget` {range, risk_level, includes_furniture}. Хранилища: `public.projects.passport` (текущий паспорт) и `public.project_passport_revisions.passport` (версии). Поля `projects.client_contact` в схеме нет. Представлений (views) в миграциях нет.

Заменяет предыдущую заметку `FINDING_contacts_budget_m1_read.md` (она охватывала только RPC M1-чтения).

## 1. Поверхности, которые отдают contact/budget клиентской роли

| № | Поверхность (последняя определяющая миграция) | Кому доступна (итоговые права) | Гейт внутри | Что уходит | Основание |
|---|---|---|---|---|---|
| 1 | **Таблица `public.projects`**, колонка `passport` (`20260716071024`, строки 75–93, 318–322, 497–509) | `grant all privileges … to anon, authenticated, service_role`; RLS включён, не forced | Политика `projects_studio_all`: `is_studio_member(designer_id, auth.uid())` = владелец проекта **или** активный `studio_members` (роль `member`, единственная) | **Паспорт целиком**: contact, budget и всё остальное. `anon` → `auth.uid()` null → 0 строк. `service_role` — без RLS (серверные маршруты) | Production-baseline M1 (16.07.2026, импорт существующей продуктовой схемы): «студия видит свои проекты». Отдельного решения о сужении полей для членов студии нет |
| 2 | **Таблица `public.answers`** (сырые ответы брифа; `question_id` `contact`, `budget`) | те же гранты | `answers_studio_all` через `is_studio_member(p.designer_id, …)` | **Сырые ответы целиком** (`value` jsonb) | тот же baseline |
| 3 | **RPC `projectceo_read_api.get_m1_legacy_project_read(uuid)`** (`20260910090000`, тело `20261011100000`) | execute только `authenticated` (revoke у всех остальных) | `_authorize_project_human(project_id, 'view_project')` + активное `project_memberships.role in ('owner_lead','architect')` + привязка `organizations.legacy_designer_id = projects.designer_id`; **только для `clarifications`** — `_passport_approval_authority` ∈ {owner, delegated_architect} (DEC-041 §3) | `r.passport` или `r.passport - 'clarifications'`: **contact и budget — целиком** владельцу (`owner_lead`) и **любому архитектору проекта**, с правом `approve_passport` или без. client/builder/члены только пакета — отказ P1103 | DEC-040/041 (контракт M1-чтения) задаёт *кто читает паспорт* (owner_lead, architect); о составе полей решение только для `clarifications` (DEC-041 §3, 11.10) |
| 4 | **RPC `public.export_passport_revisions()`** (`20260928100000`, строки 379–390, 577; `auth.uid()` → `_request_user_id()` в `20260928155000`) | execute `authenticated` | `where p.designer_id = <текущий пользователь>` — **только владелец-дизайнер** проекта (не члены студии, не члены проекта) | **Все версии паспорта целиком** (`to_jsonb(r)`), включая contact/budget | DEC-044/045 (хранение аккаунта): полный экспорт собственных данных дизайнера |
| 5 | **Таблица `public.project_handover_drafts`**, колонки `confirmed_passport`, `confirmed_passport_summary` (`20261002100000`, 58–124) | select/insert/update `authenticated`; RLS forced | политики через `is_studio_member` | `confirmed_passport` — **полный паспорт** (триггер требует равенства с `projects.passport`) → contact/budget членам студии. `confirmed_passport_summary` — проекция `contractorPassport()`: **contact отсутствует**, `budget = {range:"undisclosed", risk_level}` — т.е. `risk_level` остаётся | решение владельца 01–02.10.2026 (комплект подрядчика, уровень 1) — в заголовке `20261001101000`: «сводка паспорта без контактов и бюджета» |
| 6 | **Таблица `public.project_handover_kits`**, колонка `passport_summary` (`20261001101000`; guard `20261002100000` 297–358) | select/insert `authenticated` (студия); **select `service_role`** (страница подрядчика по токену, `app/room/[access_token]/page.tsx`) | DB-guard: `passport_summary = draft.confirmed_passport_summary` | та же проекция: без contact; `budget.risk_level` в данных. На экране подрядчика (`PassportView audience="contractor"`, серверный компонент) блок бюджета **не выводится**; в браузер подрядчика поле не уходит | то же решение 01–02.10 |

Поверхности, которые **не** отдают contact/budget (проверено по телам функций): `get_project_workspace_read*` v1–v11 (из паспорта только `areaM2`, `location`=`object.city`, `name` — всем активным ролям проекта/пакета, включая client/builder), `get_external_review`, `get_released_archive_read_v1`, `list_approval_requests`, `count_passport_revisions` (только счётчик), `project_passport_corrections` (whitelist полей без contact/budget), все `projectceo_m3_api`/`m4_api`/`remhaos_*`. Таблица `project_passport_revisions` напрямую недоступна ни одной клиентской роли (`20260829074543`). Анонимные пути (`/i/[token]`, `/p/[public_token]`) паспорт не читают; `/b/[token]` удалён (25.09). Тестовые переключатели `tests/ap1/environment/*.sql` паспортных поверхностей не касаются. Роли `pi_human_executor`/`pi_worker_executor` — NOLOGIN, прав на паспорт не имеют.

Не определено: тела production-only функций, перечисленных в `20260911110000` (`adopt_legacy_m1_workflow`, `get_or_create_m1_proposal_draft`, …) — в репозитории их нет; что они возвращают, по коду установить нельзя.

## 2. Что из этого реально читает приложение

| Поверхность | Где читается | Что показывает |
|---|---|---|
| `projects.passport` (RLS студии) | `app/dashboard/projects/[id]/page.tsx` → `PassportView` | дизайнеру и членам студии: contact (имя, телефон, email), budget (коридор, мебель) — это рабочий экран дизайнера |
| `answers` | тот же экран, `proposal/page.tsx`, `concept-pack/actions.ts`, `handover-state.ts` | сырые ответы |
| RPC M1-чтения | `live-read-port.ts` → `M1PassportPanel` (только owner/architect) | на экран — тип объекта, площадь, город, уточнения; **contact/budget получены, но не выводятся** (присутствуют в данных клиентского компонента и в прямом ответе RPC токеном архитектора) |
| `export_passport_revisions` | `app/api/account/export/route.ts` | полный экспорт владельцу |
| `project_handover_kits.passport_summary` | `app/room/[access_token]/page.tsx` (service_role, серверный рендер) | подрядчику: без контактов, без бюджета на экране; `risk_level` в строке БД |

## 3. Какие правила существуют в письменном виде

Прямое правило «какие роли проекта (owner_lead / architect / client / builder / член студии) могут читать `contact` и `budget`» **в журнале решений и документах отсутствует** (поиск по `docs/`, `CLAUDE.md`, `AGENTS.md`, заголовкам миграций). Что есть:

1. **DEC-041 §3 / DEC-043 (d)** — полномочие *одобрения* паспорта (owner_lead; архитектор с `approve_passport`). Правило о чтении — только для `clarifications` (11.10, `20261011100000`): «Контакты и бюджет этой миграцией не меняются (отдельная находка)».
2. **Решение 01–02.10.2026 (комплект подрядчика, уровень 1)** — заголовок `20261001101000`: «суммы подрядчику не показываются… сводка паспорта без контактов и бюджета». Это единственное письменное правило, прямо называющее contact/budget, и оно про поверхность подрядчика.
3. **152-ФЗ / LLM** (`CLAUDE.md` P3, `OWNER_LAWYER_DECISIONS_2026-09-28.md`): контакты и город вырезаются перед вызовом LLM — про передачу провайдеру, не про чтение внутри студии.
4. **BUG-01 (аудит 25.09)**: паспорт с телефоном/email по intake-токену — закрыт удалением `/b/[token]`; правило — «анонимные/токенные пути не рендерят контакты».
5. **INV-B1/B5 (CLAUDE.md)** — про публичные URL и ценовую вилку *дизайнера*, не про бюджет клиента.

## 4. Соответствие

| Поверхность | Утверждённое право | Соответствие |
|---|---|---|
| 1, 2 — владелец и члены студии через таблицы | baseline M1: студия работает со своими проектами; дизайнер — обработчик ПДн клиента | **Соответствует**: это основной рабочий контур; отдельного правила о сужении полей для членов студии не принято |
| 3 — `owner_lead` через RPC M1 | DEC-040/041: владелец — законный читатель паспорта | **Соответствует** |
| 3 — **любой `architect`** через RPC M1 (в т.ч. без `approve_passport`) | DEC-040/041 называют архитектора читателем M1-паспорта; состав полей не ограничен; правило о составе есть только для `clarifications` | **Правилу не противоречит — правила нет.** Пробел: решение о том, нужны ли архитектору контакты и коридор бюджета, не принималось; механизм сужения уже существует (та же развилка, что для `clarifications`) |
| 4 — экспорт владельцу | DEC-044/045 | **Соответствует** (владелец получает свои данные) |
| 5 — `confirmed_passport` членам студии | тот же контур студии | **Соответствует** (та же аудитория, что у таблицы `projects`) |
| 5, 6 — `budget.risk_level` в сводке подрядчика (данные, не экран) | решение 01–02.10: «сводка паспорта без контактов и бюджета» | **Расхождение на уровне данных, не экрана**: `contractorPassport()` оставляет `budget.risk_level` (low/mid/high) в `confirmed_passport_summary` и `passport_summary`; на экран подрядчика блок бюджета не выводится и в браузер не передаётся (серверный рендер). Нужно решение владельца: считать ли `risk_level` «бюджетом» (тогда убрать из проекции и добавить DB-guard на ключи сводки) или допустимым признаком сложности |
| client / builder — любые поверхности | — | contact/budget **не получают** (workspace-read отдаёт из паспорта только площадь, город, название) |

## 5. Вывод

Нарушений утверждённых прав по контактам и бюджету не найдено. Две точки для решения владельца, без которых менять код нельзя:

1. **Архитектор проекта** получает контакты и коридор бюджета через RPC M1-чтения (и, если он одновременно член студии, — через таблицу `projects`). Это не запрещено, но и не решено. Если владелец решит ограничить — реализация такая же, как для уточнений (`20261011100000`): флаги по `_passport_approval_authority` или по роли, DB4-тест, запись в журнал решений.
2. **`budget.risk_level` в сводке для подрядчика** — слово «бюджет» в решении 01.10 буквально не выполнено на уровне данных, хотя подрядчик этого поля не видит. Решение: уточнить формулировку или убрать поле.

Отдельно (не про права): членство в студии имеет единственную роль `member` без градаций — любой приглашённый сотрудник студии читает контакты и бюджеты всех проектов владельца. Это свойство baseline M1, не отклонение.
