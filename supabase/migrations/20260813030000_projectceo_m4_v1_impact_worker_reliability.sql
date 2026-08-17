-- V1 Impact: durable worker reliability — bounded retry, dead-letter,
-- operator redrive, and poison-item exclusion from the active backlog.
--
-- Основание: OWNER REVIEW 12.08.2026 (поверх DEC-034/DEC-035). Исходный
-- OWNER GO на V1 Impact требовал этот контур с самого начала; ни PR #94, ни
-- моя более ранняя (несостоявшаяся) параллельная реализация его не довезли —
-- `20260813010000` прямо фиксирует потерю: «Durable operator failure /
-- dead-letter / redrive воркера … не восстанавливается». Эта миграция его
-- строит — additive, поверх неизменяемых `20260812010000/020000/030000`,
-- `20260813010000`, `20260813020000`.
--
-- ЧТО УЖЕ БЫЛО И ОСТАЁТСЯ БЕЗ ИЗМЕНЕНИЙ. Ключ идемпотентности выводится из
-- заявки (`worker:change-impact:${changeRequestId}`), и повтор по нему не
-- создаёт второй прогон — это и есть «безопасный эквивалент» leases/claim для
-- САМОГО РАСЧЁТА: два параллельных воркера, взявшие одну заявку, оба вызывают
-- `calculate_change_impact_policy_bound` с одним и тем же ключом, и один из
-- них получает `replay`, а не второй прогон. Этот контур её НЕ трогает и НЕ
-- заменяет — он про то, что происходит, когда вызов ЗАВЕРШАЕТСЯ ОТКАЗОМ, а не
-- успехом, а такого пути раньше не было вовсе.
--
-- ЧТО ДОБАВЛЯЕТ ЭТА МИГРАЦИЯ.
--
-- 1. `projectceo_m4.impact_worker_failures` — по одной строке на заявку с
--    неуспешной попыткой расчёта. `attempt_count` живёт в таблице, а не в
--    памяти процесса: перезапуск воркера ничего не сбрасывает, потому что
--    сбрасывать нечего — состояние уже на диске. Форма строки закреплена
--    constraint'ом, а не соглашением: `retrying` обязана нести
--    `next_attempt_at` и не нести `dead_lettered_at`, `dead_letter` —
--    наоборот. Разошедшаяся строка не попадёт в базу ни при каком будущем
--    изменении кода вокруг нее.
--
-- 2. `projectceo_m4_api.record_change_impact_worker_failure(...)` — дверь
--    воркера, симметричная `calculate_change_impact_policy_bound`: тот же
--    системный вызывающий (`service_role`), тот же принцип «сервер решает
--    числа, вызывающий их не передаёт». `upsert` по первичному ключу
--    (organization_id, project_id, change_request_id) с атомарным
--    инкрементом — два параллельных воркера, узнавшие об одном и том же
--    отказе одновременно, оба увеличат счётчик (Postgres сериализует запись
--    через блокировку строки), и это осознанный выбор: два независимых
--    неудачных вызова — это два потраченных попытки, а не одна, даже если
--    отказ технически один и тот же.
--
--    `failure_kind='permanent'` уходит в `dead_letter` немедленно, минуя
--    бюджет попыток целиком: постоянный отказ не станет успешным от того,
--    что его попробовали ещё четыре раза. `failure_kind='transient'`
--    получает ограниченный бюджет (`max_attempts=5`) и растущую, но
--    ОГРАНИЧЕННУЮ паузу (2s → 4s → 8s → 16s, потолок 5 минут) — не «бесконечный
--    отказ до перезапуска», а именно ограниченный повтор.
--
-- 3. `projectceo_m4.redrive_change_impact_worker_failure(...)` — операторское
--    действие, НЕ человеческая команда продукта и не дверь воркера. Живёт в
--    приватной схеме (`projectceo_m4`, не `_api`) и `revoke all` от каждой
--    роли, включая `service_role` — той же формой, что
--    `open_v1_impact_production`/`close_v1_impact_production`
--    (`20260812030000`): вызывается напрямую SQL-доступом операционной
--    команды, не продуктовым контрактом и не UI. Работает ТОЛЬКО на строке в
--    `dead_letter` — редрайв «retrying»-строки был бы не операторским
--    решением, а вмешательством в обычный повтор.
--
-- 4. `create or replace function calculate_change_impact_policy_bound(...)` —
--    единственное функциональное изменение: успешный (в т.ч. replay) вызов
--    удаляет свою запись из `impact_worker_failures`, если она есть. Успех
--    после ряда неудач не должен оставлять по себе вечный след «была
--    ошибка» — DEC-036 про то, что происходит ДО успеха, а не про то, что
--    остаётся после него.
--
-- 5. `create or replace function list_change_impact_backlog(...)` —
--    добавлено ровно одно условие: заявка с `dead_letter` исключена из
--    активной очереди СОВСЕМ (это и есть «ядовитый элемент исчезает из
--    active backlog» — требование 8), а заявка в `retrying` исключена ТОЛЬКО
--    пока не наступил `next_attempt_at` (пауза между попытками — свойство
--    самой очереди, а не памяти воркера, который её мог не досчитать после
--    перезапуска). `dead_letter`-строка остаётся видима — через прямой запрос
--    к `impact_worker_failures` операционной командой, не через продуктовую
--    поверхность.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни PostgREST-доступа к `impact_worker_failures` — таблица
-- лежит в приватной схеме, как `impact_runs`/`impacts`, и Data API её не
-- видит вовсе. Ни человеческой команды редрайва — это операционное действие,
-- как создание `range_confirmations` в проекте Входа Б (историческая
-- параллель из CLAUDE.md), не продуктовая RPC. Ни изменения самого расчёта —
-- `calculate_change_impact`/`calculate_change_impact_policy_bound` считают
-- ровно так же, как считали; этот контур решает, что делать, когда вызов
-- ЗАВЕРШАЕТСЯ ОШИБКОЙ, а не как он работает при успехе.

begin;

-- === Durable failure ledger ================================================

create table projectceo_m4.impact_worker_failures (
  organization_id uuid not null,
  project_id uuid not null,
  change_request_id uuid not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  status text not null default 'retrying',
  failure_kind text not null,
  error_code text not null,
  error_detail jsonb,
  first_attempted_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now(),
  next_attempt_at timestamptz,
  dead_lettered_at timestamptz,
  redriven_at timestamptz,
  redriven_by text,
  redrive_reason text,
  primary key (organization_id, project_id, change_request_id),
  constraint impact_worker_failures_status_check
    check (status in ('retrying', 'dead_letter')),
  constraint impact_worker_failures_failure_kind_check
    check (failure_kind in ('transient', 'permanent')),
  constraint impact_worker_failures_attempt_count_check
    check (attempt_count >= 0),
  constraint impact_worker_failures_max_attempts_check
    check (max_attempts >= 1),
  -- Форма — constraint, не соглашение (тот же приём, что
  -- `m4_impact_runs_coverage_shape_check` из DEC-034): retrying обязана нести
  -- next_attempt_at и не нести dead_lettered_at, dead_letter — наоборот. Ни
  -- одна строка, где это не так, не попадёт в базу.
  constraint impact_worker_failures_status_shape_check
    check (
      (status = 'retrying'
        and next_attempt_at is not null
        and dead_lettered_at is null)
      or (status = 'dead_letter'
        and dead_lettered_at is not null
        and next_attempt_at is null)
    )
);

-- Тот же приём, что закрепляет `20260717102000` для остальных таблиц схемы
-- `projectceo_m4` (там — одноразовым циклом по всем таблицам схемы на момент
-- её применения; моя таблица создана позже и под тот цикл не попадает,
-- поэтому те же четыре шага — здесь, вручную, для одной новой таблицы).
-- `force row level security` действует и на владельца: без явной политики
-- ниже собственные `security definer`-функции этой миграции (выполняющиеся
-- от имени `pi_table_owner`) не увидели бы ни одной строки этой же таблицы.
alter table projectceo_m4.impact_worker_failures owner to pi_table_owner;
alter table projectceo_m4.impact_worker_failures enable row level security;
alter table projectceo_m4.impact_worker_failures force row level security;
revoke all on table projectceo_m4.impact_worker_failures
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy impact_worker_failures_internal_owner
  on projectceo_m4.impact_worker_failures
  for all to pi_table_owner using (true) with check (true);

-- === Дверь воркера: записать отказ =========================================

-- Параметры с префиксом `p_`, а не bare-имена столбцов, как у соседних дверей
-- воркера (`calculate_change_impact_policy_bound` и т.п.) — НЕ стилистическая
-- вольность. `#variable_conflict use_variable` подставляет переменную вместо
-- голого идентификатора ВЕЗДЕ в тексте запроса, включая список целевых
-- колонок `on conflict (...)` — что превращает `on conflict (organization_id,
-- project_id, change_request_id)` в `on conflict (organization_id, $2, $3)` с
-- ЗНАЧЕНИЯМИ параметров вместо имён столбцов и валит запрос ошибкой Postgres
-- «no unique or exclusion constraint matching the ON CONFLICT specification»
-- — воспроизведено и проверено вручную. Префикс убирает совпадение имён
-- целиком, `#variable_conflict` этой функции не нужен вовсе.
create function projectceo_m4_api.record_change_impact_worker_failure(
  p_project_id uuid,
  p_change_request_id uuid,
  p_failure_kind text,
  p_error_code text,
  p_error_detail jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
  v_row projectceo_m4.impact_worker_failures%rowtype;
  v_max_attempts constant integer := 5;
begin
  if p_failure_kind is null or p_failure_kind not in ('transient', 'permanent') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"failureKind"}'::jsonb
    );
  end if;
  if p_error_code is null or btrim(p_error_code) = '' then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"errorCode"}'::jsonb
    );
  end if;

  select cr.organization_id into v_organization_id
  from projectceo_m4.change_requests cr
  where cr.project_id = p_project_id
    and cr.change_request_id = p_change_request_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"changeRequest"}'::jsonb
    );
  end if;

  insert into projectceo_m4.impact_worker_failures as f (
    organization_id, project_id, change_request_id,
    attempt_count, max_attempts, status, failure_kind, error_code, error_detail,
    first_attempted_at, last_attempted_at, next_attempt_at, dead_lettered_at
  ) values (
    v_organization_id, p_project_id, p_change_request_id,
    1, v_max_attempts,
    case when p_failure_kind = 'permanent' then 'dead_letter' else 'retrying' end,
    p_failure_kind, p_error_code, p_error_detail,
    now(), now(),
    case when p_failure_kind = 'permanent' then null
      else now() + least(power(2, 1)::integer * interval '1 second', interval '5 minutes')
    end,
    case when p_failure_kind = 'permanent' then now() else null end
  )
  on conflict (organization_id, project_id, change_request_id) do update set
    attempt_count = f.attempt_count + 1,
    failure_kind = excluded.failure_kind,
    error_code = excluded.error_code,
    error_detail = excluded.error_detail,
    last_attempted_at = now(),
    status = case
      when excluded.failure_kind = 'permanent' then 'dead_letter'
      when f.attempt_count + 1 >= f.max_attempts then 'dead_letter'
      else 'retrying'
    end,
    next_attempt_at = case
      when excluded.failure_kind = 'permanent' then null
      when f.attempt_count + 1 >= f.max_attempts then null
      else now() + least(
        power(2, f.attempt_count + 1)::integer * interval '1 second',
        interval '5 minutes'
      )
    end,
    dead_lettered_at = case
      when excluded.failure_kind = 'permanent' then now()
      when f.attempt_count + 1 >= f.max_attempts then now()
      else null
    end
  returning f.* into v_row;

  return jsonb_build_object(
    'status', v_row.status,
    'attemptCount', v_row.attempt_count,
    'maxAttempts', v_row.max_attempts,
    'nextAttemptAt', v_row.next_attempt_at,
    'deadLetteredAt', v_row.dead_lettered_at
  );
end
$function$;

alter function projectceo_m4_api.record_change_impact_worker_failure(
  uuid, uuid, text, text, jsonb
) owner to pi_table_owner;

revoke all on function projectceo_m4_api.record_change_impact_worker_failure(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role,
     pi_human_executor, pi_worker_executor;

grant execute on function projectceo_m4_api.record_change_impact_worker_failure(
  uuid, uuid, text, text, jsonb
) to service_role;

-- === Операторское действие: редрайв (не продуктовая дверь) ================

create function projectceo_m4.redrive_change_impact_worker_failure(
  p_project_id uuid,
  p_change_request_id uuid,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row projectceo_m4.impact_worker_failures%rowtype;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'PROJECTCEO_M4_IMPACT_REDRIVE_ACTOR_REQUIRED';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'PROJECTCEO_M4_IMPACT_REDRIVE_REASON_REQUIRED';
  end if;

  update projectceo_m4.impact_worker_failures f
  set status = 'retrying',
      attempt_count = 0,
      next_attempt_at = now(),
      dead_lettered_at = null,
      redriven_at = now(),
      redriven_by = btrim(p_actor),
      redrive_reason = btrim(p_reason)
  where f.project_id = p_project_id
    and f.change_request_id = p_change_request_id
    and f.status = 'dead_letter'
  returning f.* into v_row;

  if not found then
    raise exception 'PROJECTCEO_M4_IMPACT_REDRIVE_NOT_DEAD_LETTERED:%/%',
      p_project_id, p_change_request_id;
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'attemptCount', v_row.attempt_count,
    'redrivenAt', v_row.redriven_at,
    'redrivenBy', v_row.redriven_by,
    'redriveReason', v_row.redrive_reason
  );
end
$function$;

alter function projectceo_m4.redrive_change_impact_worker_failure(uuid, uuid, text, text)
  owner to pi_table_owner;
revoke all on function projectceo_m4.redrive_change_impact_worker_failure(uuid, uuid, text, text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- === Успех снимает след прежних отказов ====================================

create or replace function projectceo_m4_api.calculate_change_impact_policy_bound(
  project_id uuid,
  change_request_id uuid,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_max_depth integer := (projectceo_m4._impact_policy() ->> 'maxDepth')::integer;
  v_result jsonb;
begin
  v_result := projectceo_m4_api.calculate_change_impact(
    project_id,
    change_request_id,
    v_max_depth,
    expected_state_revision,
    idempotency_key
  );

  -- Успех (в т.ч. replay по идемпотентности) — не только новый расчёт —
  -- обязан снять след прежних отказов: DEC-036 про путь ДО успеха, а не про
  -- то, что остаётся вечно после него.
  delete from projectceo_m4.impact_worker_failures failures
  using projectceo_m4.change_requests cr
  where cr.project_id = project_id
    and cr.change_request_id = change_request_id
    and failures.organization_id = cr.organization_id
    and failures.project_id = cr.project_id
    and failures.change_request_id = cr.change_request_id;

  return v_result;
end
$function$;

-- === Ядовитый элемент исчезает из активной очереди =========================

create or replace function projectceo_m4_api.list_change_impact_backlog(
  max_rows integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_limit integer;
  v_data jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 1000 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"IMPACT_BACKLOG_LIMIT_INVALID"}'::jsonb
    );
  end if;
  v_limit := max_rows;

  select coalesce(jsonb_agg(item order by item ->> 'changeRequestId'), '[]'::jsonb)
  into v_data
  from (
    select jsonb_build_object(
      'organizationId', cr.organization_id,
      'projectId', cr.project_id,
      'packageId', cr.package_id,
      'changeRequestId', cr.change_request_id,
      'proposedBaselineId', cr.proposed_baseline_id,
      'rootCount', (
        select count(*)
        from projectceo_m4.change_request_roots root
        where root.organization_id = cr.organization_id
          and root.project_id = cr.project_id
          and root.change_request_id = cr.change_request_id
      ),
      'stateRevision', pw.state_revision
    ) item
    from projectceo_m4.change_requests cr
    join project_intelligence.project_workflows pw
      on pw.organization_id = cr.organization_id
     and pw.project_id = cr.project_id
    where not exists (
      select 1
      from projectceo_m4.impact_runs ir
      where ir.organization_id = cr.organization_id
        and ir.project_id = cr.project_id
        and ir.change_request_id = cr.change_request_id
    )
    -- DEC-036: `dead_letter` исключена из активной очереди СОВСЕМ — она не
    -- «работа», а операторская находка (видна через прямой запрос к
    -- `impact_worker_failures`, не через эту очередь). `retrying` исключена
    -- ТОЛЬКО пока не наступил `next_attempt_at` — пауза между попытками
    -- живёт в данных, а не в памяти воркера, который мог перезапуститься и
    -- ничего не забыть только потому, что помнить нечего.
    and not exists (
      select 1
      from projectceo_m4.impact_worker_failures f
      where f.organization_id = cr.organization_id
        and f.project_id = cr.project_id
        and f.change_request_id = cr.change_request_id
        and (f.status = 'dead_letter' or f.next_attempt_at > now())
    )
    order by cr.organization_id,
      cr.project_id,
      cr.change_request_id::text collate "C"
    limit v_limit
  ) rows;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-impact-worker/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'policy', projectceo_m4._impact_policy(),
    'data', v_data,
    'error', null
  );
end
$function$;

do $guard$
declare
  v_problem text;
begin
  -- 1. Таблица и её форма-constraint существуют на живой базе.
  if not exists (
    select 1 from pg_catalog.pg_class
    where relname = 'impact_worker_failures'
      and relnamespace = 'projectceo_m4'::regnamespace
  ) then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_FAILURES_TABLE_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'impact_worker_failures_status_shape_check'
      and conrelid = 'projectceo_m4.impact_worker_failures'::regclass
  ) then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_FAILURES_SHAPE_CHECK_MISSING';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = 'projectceo_m4.impact_worker_failures'::regclass
      and pg_get_userbyid(relation.relowner) = 'pi_table_owner'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_FAILURES_ROW_SECURITY_MISSING';
  end if;

  -- 2. Дверь записи отказа — только `service_role`, никому человеческому.
  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.record_change_impact_worker_failure(uuid, uuid, text, text, jsonb)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_FAILURE_RPC_LEAKED_TO_HUMAN_ROLE:%', v_problem;
  end if;
  if not pg_catalog.has_function_privilege(
    'service_role',
    'projectceo_m4_api.record_change_impact_worker_failure(uuid, uuid, text, text, jsonb)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_FAILURE_RPC_LOST_SYSTEM_GRANT';
  end if;

  -- 3. Редрайв недостижим НИ ОДНОЙ ролью, включая `service_role` — это
  --    операторское SQL-действие, не системная дверь и не человеческая RPC.
  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4.redrive_change_impact_worker_failure(uuid, uuid, text, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_REDRIVE_REACHABLE_BY_ROLE:%', v_problem;
  end if;

  -- 4. Замена `calculate_change_impact_policy_bound`/`list_change_impact_
  --    backlog` не имеет права задеть их права: те же двери, та же
  --    системная identity.
  select signature into v_problem
  from unnest(array[
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_RPC_LOST_SYSTEM_GRANT:%', v_problem;
  end if;
  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_RPC_LEAKED_TO_HUMAN_ROLE:%', v_problem;
  end if;

  -- 5. Синтетическая строка, нарушающая форму (retrying без next_attempt_at),
  --    не проходит constraint — не просто «не должна».
  begin
    insert into projectceo_m4.impact_worker_failures (
      organization_id, project_id, change_request_id,
      attempt_count, max_attempts, status, failure_kind, error_code,
      next_attempt_at, dead_lettered_at
    ) values (
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
      1, 5, 'retrying', 'transient', 'guard',
      null, -- ЗАВЕДОМО НЕВЕРНО: retrying обязана нести next_attempt_at.
      null
    );
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_FAILURES_BAD_SHAPE_ALLOWED';
  exception
    when check_violation then null;
  end;
end
$guard$;

commit;
