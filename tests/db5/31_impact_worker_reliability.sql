\set ON_ERROR_STOP on

-- V1 Impact worker reliability (OWNER REVIEW 12.08.2026, поверх DEC-034/035,
-- DEC-036): bounded retry, durable dead-letter, operator redrive, poison
-- exclusion from the active backlog — доказательство на управляемой заявке,
-- не на золотом проекте (у него уже есть настоящий прогон, и очередь бы
-- исключила его по причине «уже посчитано», а не по причине этого контура).
--
-- Сценарий откатывается целиком: следующие файлы DB5 обязаны видеть прежнее
-- состояние.

begin;

select
  cr.organization_id::text as org,
  cr.package_id::text as pkg,
  cr.proposed_baseline_id as to_baseline,
  cr.from_production_package_version_id as from_version
from projectceo_m4.change_requests cr
where cr.project_id = '41111111-1111-4111-8111-111111111111'
order by cr.requested_at
limit 1
\gset wr_

set local session_replication_role = replica;

-- Собственная заявка, не золотого проекта: у неё нет ни прогона, ни истории —
-- контур должен наблюдать её с абсолютного нуля. `proposed_baseline_id`
-- переиспользует РЕАЛЬНЫЙ, уже опубликованный baseline золотого проекта
-- (иначе раздел 6 не сможет реально посчитать влияние — `project_baselines`
-- не сфабриковать здесь без нарушения его собственных ограничений).
-- `from_baseline_id` — синтетика, единственная роль которой — не совпасть с
-- реальным переходом золотого проекта в `m4_change_request_transition_key`
-- (тот же приём, что уже доказан в `29_impact_coverage_dec034.sql`).
insert into projectceo_m4.change_requests (
  organization_id, project_id, change_request_id, package_id,
  from_baseline_id, proposed_baseline_id, from_production_package_version_id,
  protected_reason, reason_digest, initiator_role, delta_cost_rub, delta_days,
  requested_by_user_id
) values (
  :'wr_org'::uuid, '41111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001'::uuid, :'wr_pkg'::uuid,
  'wr-baseline-worker-reliability-from', :'wr_to_baseline', :'wr_from_version',
  'worker reliability test request',
  pg_catalog.sha256(convert_to('worker reliability test request', 'UTF8')),
  'architect', 0, 0, '31111111-1111-4111-8111-111111111111'
);

commit;

-- === 1. Свежая заявка — в активной очереди, следа отказов ещё нет =========

begin;
set local role service_role;
do $wr_fresh$
begin
  if not exists (
    select 1
    from jsonb_array_elements(
      (projectceo_m4_api.list_change_impact_backlog(1000) ->> 'data')::jsonb
    ) data
    where data ->> 'changeRequestId' = 'd1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'DB5_WORKER_RELIABILITY_FRESH_NOT_IN_BACKLOG';
  end if;
end
$wr_fresh$;
commit;

-- === 2. Транзиентные отказы копят попытки с ограниченной, растущей паузой =

begin;
set local role service_role;
select projectceo_m4_api.record_change_impact_worker_failure(
  '41111111-1111-4111-8111-111111111111'::uuid,
  'd1000000-0000-4000-8000-000000000001'::uuid,
  'transient', 'internal_error', '{"detail":"first attempt"}'::jsonb
);
commit;

do $wr_attempt1$
declare
  v_row projectceo_m4.impact_worker_failures%rowtype;
begin
  select * into v_row
  from projectceo_m4.impact_worker_failures
  where project_id = '41111111-1111-4111-8111-111111111111'
    and change_request_id = 'd1000000-0000-4000-8000-000000000001';
  if not found then
    raise exception 'DB5_WORKER_RELIABILITY_ROW_NOT_CREATED';
  end if;
  if v_row.attempt_count <> 1
     or v_row.status <> 'retrying'
     or v_row.next_attempt_at is null
     or v_row.next_attempt_at <= now()
     or v_row.dead_lettered_at is not null then
    raise exception 'DB5_WORKER_RELIABILITY_ATTEMPT1_SHAPE_UNEXPECTED:%/%/%',
      v_row.attempt_count, v_row.status, v_row.next_attempt_at;
  end if;
end
$wr_attempt1$;

-- Пока пауза не наступила, заявка временно исключена из активной очереди —
-- иначе воркер тут же попробует снова, и «ограниченная пауза» была бы только
-- числом в таблице, не свойством очереди.
begin;
set local role service_role;
do $wr_not_due$
begin
  if exists (
    select 1
    from jsonb_array_elements(
      (projectceo_m4_api.list_change_impact_backlog(1000) ->> 'data')::jsonb
    ) data
    where data ->> 'changeRequestId' = 'd1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'DB5_WORKER_RELIABILITY_RETRYING_NOT_DUE_STILL_IN_BACKLOG';
  end if;
end
$wr_not_due$;
commit;

-- Пауза наступила (перевод часов вперёд, а не ожидание в реальном времени) —
-- заявка снова в очереди.
update projectceo_m4.impact_worker_failures
set next_attempt_at = now() - interval '1 second'
where project_id = '41111111-1111-4111-8111-111111111111'
  and change_request_id = 'd1000000-0000-4000-8000-000000000001';

begin;
set local role service_role;
do $wr_due$
begin
  if not exists (
    select 1
    from jsonb_array_elements(
      (projectceo_m4_api.list_change_impact_backlog(1000) ->> 'data')::jsonb
    ) data
    where data ->> 'changeRequestId' = 'd1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'DB5_WORKER_RELIABILITY_RETRYING_DUE_NOT_IN_BACKLOG';
  end if;
end
$wr_due$;
commit;

-- === 3. Бюджет попыток исчерпан -> dead_letter, ядовитый элемент исчезает =

begin;
set local role service_role;
-- Уже была 1 попытка (раздел 2) -> нужно ЕЩЁ 4, чтобы attempt_count дошёл
-- до 5 и сравнялся с max_attempts (условие исчерпания в миграции —
-- `f.attempt_count + 1 >= f.max_attempts`).
select projectceo_m4_api.record_change_impact_worker_failure(
  '41111111-1111-4111-8111-111111111111'::uuid,
  'd1000000-0000-4000-8000-000000000001'::uuid,
  'transient', 'internal_error', null
);
select projectceo_m4_api.record_change_impact_worker_failure(
  '41111111-1111-4111-8111-111111111111'::uuid,
  'd1000000-0000-4000-8000-000000000001'::uuid,
  'transient', 'internal_error', null
);
select projectceo_m4_api.record_change_impact_worker_failure(
  '41111111-1111-4111-8111-111111111111'::uuid,
  'd1000000-0000-4000-8000-000000000001'::uuid,
  'transient', 'internal_error', null
);
select projectceo_m4_api.record_change_impact_worker_failure(
  '41111111-1111-4111-8111-111111111111'::uuid,
  'd1000000-0000-4000-8000-000000000001'::uuid,
  'transient', 'internal_error', null
);
commit;

do $wr_dead_letter$
declare
  v_row projectceo_m4.impact_worker_failures%rowtype;
begin
  select * into v_row
  from projectceo_m4.impact_worker_failures
  where project_id = '41111111-1111-4111-8111-111111111111'
    and change_request_id = 'd1000000-0000-4000-8000-000000000001';
  if v_row.attempt_count <> 5
     or v_row.status <> 'dead_letter'
     or v_row.next_attempt_at is not null
     or v_row.dead_lettered_at is null then
    raise exception 'DB5_WORKER_RELIABILITY_DEAD_LETTER_SHAPE_UNEXPECTED:%/%/%',
      v_row.attempt_count, v_row.status, v_row.dead_lettered_at;
  end if;
end
$wr_dead_letter$;

-- Ядовитый элемент исчез из активной очереди СОВСЕМ, а не «пока не наступит
-- пауза»: пункт 8 исходного OWNER GO — терминальный отказ не воскресает сам.
begin;
set local role service_role;
do $wr_poison_excluded$
begin
  if exists (
    select 1
    from jsonb_array_elements(
      (projectceo_m4_api.list_change_impact_backlog(1000) ->> 'data')::jsonb
    ) data
    where data ->> 'changeRequestId' = 'd1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'DB5_WORKER_RELIABILITY_POISON_STILL_IN_BACKLOG';
  end if;
end
$wr_poison_excluded$;
commit;

-- === 4. Постоянный (permanent) отказ уходит в dead_letter немедленно,
--        минуя бюджет попыток целиком =====================================

do $wr_permanent$
declare
  v_response jsonb;
  v_row projectceo_m4.impact_worker_failures%rowtype;
begin
  delete from projectceo_m4.impact_worker_failures
  where project_id = '41111111-1111-4111-8111-111111111111'
    and change_request_id = 'd1000000-0000-4000-8000-000000000001';

  set local role service_role;
  v_response := projectceo_m4_api.record_change_impact_worker_failure(
    '41111111-1111-4111-8111-111111111111'::uuid,
    'd1000000-0000-4000-8000-000000000001'::uuid,
    'permanent', 'not_found', '{"entity":"changeRequest"}'::jsonb
  );
  reset role;

  if (v_response ->> 'status') is distinct from 'dead_letter'
     or (v_response ->> 'attemptCount')::integer <> 1 then
    raise exception 'DB5_WORKER_RELIABILITY_PERMANENT_NOT_IMMEDIATE_DEAD_LETTER:%',
      v_response;
  end if;

  select * into v_row
  from projectceo_m4.impact_worker_failures
  where project_id = '41111111-1111-4111-8111-111111111111'
    and change_request_id = 'd1000000-0000-4000-8000-000000000001';
  if v_row.failure_kind <> 'permanent' or v_row.dead_lettered_at is null then
    raise exception 'DB5_WORKER_RELIABILITY_PERMANENT_ROW_SHAPE_UNEXPECTED:%/%',
      v_row.failure_kind, v_row.dead_lettered_at;
  end if;
end
$wr_permanent$;

-- === 5. Редрайв — только оператор, только на dead_letter ===================

-- Недостижим никакой ролью, включая service_role: операторское SQL-действие,
-- не системная дверь и не человеческая RPC (та же форма, что
-- `open_v1_impact_production`).
do $wr_redrive_unreachable$
declare
  v_reachable text;
begin
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4.redrive_change_impact_worker_failure(uuid, uuid, text, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_WORKER_RELIABILITY_REDRIVE_REACHABLE_BY_ROLE:%', v_reachable;
  end if;
end
$wr_redrive_unreachable$;

-- Редрайв на НЕ dead_letter строку отклоняется.
do $wr_redrive_wrong_status$
begin
  begin
    perform projectceo_m4.redrive_change_impact_worker_failure(
      '41111111-1111-4111-8111-111111111111'::uuid,
      'd1000000-0000-4000-8000-000000000001'::uuid,
      '', 'missing actor'
    );
    raise exception 'DB5_WORKER_RELIABILITY_REDRIVE_EMPTY_ACTOR_ALLOWED';
  exception when others then
    if sqlerrm !~ 'PROJECTCEO_M4_IMPACT_REDRIVE_ACTOR_REQUIRED' then
      raise;
    end if;
  end;
end
$wr_redrive_wrong_status$;

-- Настоящий редрайв: дверь в dead_letter, обязательные actor/reason,
-- сбрасывает бюджет попыток и возвращает заявку в очередь немедленно.
do $wr_redrive$
declare
  v_response jsonb;
begin
  v_response := projectceo_m4.redrive_change_impact_worker_failure(
    '41111111-1111-4111-8111-111111111111'::uuid,
    'd1000000-0000-4000-8000-000000000001'::uuid,
    'db5-ops-team', 'DB5 proof: manual redrive after root-cause fix'
  );
  if (v_response ->> 'status') is distinct from 'retrying'
     or (v_response ->> 'attemptCount')::integer <> 0 then
    raise exception 'DB5_WORKER_RELIABILITY_REDRIVE_UNEXPECTED_RESULT:%', v_response;
  end if;
end
$wr_redrive$;

begin;
set local role service_role;
do $wr_redriven_in_backlog$
begin
  if not exists (
    select 1
    from jsonb_array_elements(
      (projectceo_m4_api.list_change_impact_backlog(1000) ->> 'data')::jsonb
    ) data
    where data ->> 'changeRequestId' = 'd1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'DB5_WORKER_RELIABILITY_REDRIVEN_NOT_IN_BACKLOG';
  end if;
end
$wr_redriven_in_backlog$;
commit;

-- Повторный редрайв на теперь-уже-`retrying` строку отклоняется — оператор не
-- может «повторно подтвердить» то, что уже не dead_letter.
do $wr_redrive_again_fails$
begin
  begin
    perform projectceo_m4.redrive_change_impact_worker_failure(
      '41111111-1111-4111-8111-111111111111'::uuid,
      'd1000000-0000-4000-8000-000000000001'::uuid,
      'db5-ops-team', 'second redrive attempt'
    );
    raise exception 'DB5_WORKER_RELIABILITY_DOUBLE_REDRIVE_ALLOWED';
  exception when others then
    if sqlerrm !~ 'PROJECTCEO_M4_IMPACT_REDRIVE_NOT_DEAD_LETTERED' then
      raise;
    end if;
  end;
end
$wr_redrive_again_fails$;

-- === 6. Успех снимает след прежних отказов =================================

do $wr_success_clears$
declare
  v_org uuid;
  v_graph_version text;
  v_state bigint;
  v_response jsonb;
begin
  select cr.organization_id, pb.graph_version_id
  into v_org, v_graph_version
  from projectceo_m4.change_requests cr
  join projectceo_product.project_baselines pb
    on pb.organization_id = cr.organization_id
   and pb.project_id = cr.project_id
   and pb.baseline_id = cr.from_baseline_id
  where cr.project_id = '41111111-1111-4111-8111-111111111111'
    and cr.change_request_id = 'd1000000-0000-4000-8000-000000000001';

  -- Заявка без корней: обход законно пуст, `calculate_change_impact` считает
  -- ноль влияний — успех, не отказ. Этого достаточно, чтобы доказать очистку
  -- следа: полнота самого расчёта здесь не предмет проверки — она уже доказана
  -- `26_impact_policy_benchmark.sql`/`29_impact_coverage_dec034.sql`.
  select state_revision into v_state
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';

  set local role service_role;
  v_response := projectceo_m4_api.calculate_change_impact_policy_bound(
    '41111111-1111-4111-8111-111111111111'::uuid,
    'd1000000-0000-4000-8000-000000000001'::uuid,
    v_state,
    'db5-worker-reliability-success'
  );
  reset role;

  if (v_response #>> '{result,coverageStatus}') is distinct from 'complete' then
    raise exception 'DB5_WORKER_RELIABILITY_SUCCESS_UNEXPECTED_COVERAGE:%',
      v_response #>> '{result,coverageStatus}';
  end if;

  if exists (
    select 1
    from projectceo_m4.impact_worker_failures
    where project_id = '41111111-1111-4111-8111-111111111111'
      and change_request_id = 'd1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'DB5_WORKER_RELIABILITY_SUCCESS_DID_NOT_CLEAR_FAILURE_ROW';
  end if;
end
$wr_success_clears$;

-- Настоящая гонка двух параллельных процессов (не двух вызовов в одной
-- сессии — та не докажет ничего про блокировку строки) — в
-- `run-concurrency.zsh`, тем же приёмом, что уже доказывает «один прогон»
-- для успешного расчёта.

select 'DB5_WORKER_RELIABILITY_OK' as result;

rollback;
