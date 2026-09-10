\set ON_ERROR_STOP on

-- DB4: переиспользуемый Approval Requests gate (Фаза 2, A4; DEC-010).
-- Жизненный цикл draft→submitted→decided, динамическая capability решения,
-- честный маркер самоодобрения (DEC-010), append-only события,
-- негативная аренда.

\echo >>> 1-create
-- === 1. Архитектор создаёт заявку (решающий — owner через manage_budget) ====

begin;
select state_revision as rev1
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_platform_api.create_approval_request(
  '41111111-1111-4111-8111-111111111111',
  'material_change', 'subject-001', 'manage_budget',
  'Замена плитки дороже рамки — нужно решение по бюджету',
  :'rev1', 'db4-approval-1'
) as req1 \gset
select set_config('projectceo.db4_req1', :'req1'::jsonb -> 'result' ->> 'requestId', false) as b1 \gset
select set_config('projectceo.db4_rev1', :'rev1', false) as b1r \gset
commit;

do $assert_created$
declare
  v_status text;
  v_self boolean;
  v_req1 uuid := current_setting('projectceo.db4_req1')::uuid;
begin
  set local role pi_table_owner;
  select status, self_approved into v_status, v_self
  from projectceo_platform.approval_requests
  where project_id = '41111111-1111-4111-8111-111111111111'
    and request_id = v_req1;
  if v_status <> 'draft' or v_self <> false then
    raise exception 'DB4_APPROVAL_CREATE_STATE_INVALID:%/%', v_status, v_self;
  end if;
end
$assert_created$;

\echo >>> 2-replay
-- === 2. Replay — тот же requestId ===========================================

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $replay_created$
declare
  v_result jsonb;
  v_req1 uuid := current_setting('projectceo.db4_req1')::uuid;
begin
  select projectceo_platform_api.create_approval_request(
    '41111111-1111-4111-8111-111111111111',
    'material_change', 'subject-001', 'manage_budget',
    'Замена плитки дороже рамки — нужно решение по бюджету',
    current_setting('projectceo.db4_rev1')::bigint,
    'db4-approval-1'
  ) into v_result;
  if v_result ->> 'requestId' <> v_req1::text then
    raise exception 'DB4_APPROVAL_REPLAY_ID_MISMATCH';
  end if;
end
$replay_created$;
commit;

\echo >>> 3-submit
-- === 3. Подача заявителем ===================================================

begin;
select state_revision as rev2
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_platform_api.submit_approval_request(
  '41111111-1111-4111-8111-111111111111',
  current_setting('projectceo.db4_req1')::uuid,
  :'rev2', 'db4-approval-submit-1'
) as submitted \gset
commit;

-- Не заявитель подать не может (строитель вообще чужой → P1103).
begin;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';
do $foreign_submit_denied$
begin
  perform projectceo_platform_api.submit_approval_request(
    '41111111-1111-4111-8111-111111111111',
    current_setting('projectceo.db4_req1')::uuid,
    1, 'db4-approval-neg-1');
  raise exception 'DB4_APPROVAL_FOREIGN_SUBMIT_ACCEPTED';
exception when sqlstate 'P1103' then null;
end
$foreign_submit_denied$;
rollback;

\echo >>> 4-builder-denied
-- === 4. Решение без нужной capability — P1103 (динамическая проверка) =======

begin;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';
do $builder_decide_denied$
begin
  perform projectceo_platform_api.decide_approval_request(
    '41111111-1111-4111-8111-111111111111',
    current_setting('projectceo.db4_req1')::uuid,
    'approved', 'одобряю', 1, 'db4-approval-neg-2');
  raise exception 'DB4_APPROVAL_BUILDER_DECIDE_ACCEPTED';
exception when sqlstate 'P1103' then null;
end
$builder_decide_denied$;
rollback;

\echo >>> 5-owner-decides
-- === 5. Owner решает (manage_budget есть) — самоодобрения нет ===============

begin;
select state_revision as rev3
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_platform_api.decide_approval_request(
  '41111111-1111-4111-8111-111111111111',
  current_setting('projectceo.db4_req1')::uuid,
  'approved', 'Бюджет подтверждён, меняем',
  :'rev3', 'db4-approval-decide-1'
) as decided \gset
commit;

do $assert_decided$
declare
  v_status text;
  v_self boolean;
  v_events integer;
begin
  set local role pi_table_owner;
  select status, self_approved into v_status, v_self
  from projectceo_platform.approval_requests
  where project_id = '41111111-1111-4111-8111-111111111111'
    and request_id = current_setting('projectceo.db4_req1')::uuid;
  if v_status <> 'approved' or v_self <> false then
    raise exception 'DB4_APPROVAL_DECIDED_INVALID:%/%', v_status, v_self;
  end if;
  select count(*) into v_events
  from projectceo_platform.approval_request_events
  where project_id = '41111111-1111-4111-8111-111111111111'
    and request_id = current_setting('projectceo.db4_req1')::uuid;
  if v_events <> 3 then
    raise exception 'DB4_APPROVAL_EVENTS_COUNT:%', v_events;
  end if;
end
$assert_decided$;

-- Повторное решение решённой — P1110 (свежая ревизия, чтобы дойти
-- именно до проверки статуса, а не застрять на state-гейте).
begin;
select state_revision as rev3b
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
select set_config('projectceo.db4_rev3b', :'rev3b', false) as b3b \gset
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $redecide_denied$
begin
  perform projectceo_platform_api.decide_approval_request(
    '41111111-1111-4111-8111-111111111111',
    current_setting('projectceo.db4_req1')::uuid,
    'rejected', 'передумал',
    current_setting('projectceo.db4_rev3b')::bigint, 'db4-approval-neg-3');
  raise exception 'DB4_APPROVAL_REDECIDE_ACCEPTED';
exception when sqlstate 'P1110' then null;
end
$redecide_denied$;
rollback;

\echo >>> 6-self
-- === 6. Самоодобрение — разрешено и ЧЕСТНО помечено (DEC-010) ===============

begin;
select state_revision as rev4
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_platform_api.create_approval_request(
  '41111111-1111-4111-8111-111111111111',
  'scope_note', 'subject-002', 'review_source',
  'Согласую собственную пометку по scope — маркер обязателен',
  :'rev4', 'db4-approval-self'
) as selfreq \gset
select set_config('projectceo.db4_selfreq', :'selfreq'::jsonb -> 'result' ->> 'requestId', false) as b3 \gset
commit;

-- Подача поднимает state_revision, поэтому решение — в отдельной
-- транзакции со свежей ревизией (тот же гейт, что у всех команд).
begin;
select state_revision as rev5
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_platform_api.submit_approval_request(
  '41111111-1111-4111-8111-111111111111',
  current_setting('projectceo.db4_selfreq')::uuid,
  :'rev5', 'db4-approval-self-submit'
) as selfsub \gset
commit;

begin;
select state_revision as rev6
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_platform_api.decide_approval_request(
  '41111111-1111-4111-8111-111111111111',
  current_setting('projectceo.db4_selfreq')::uuid,
  'approved', 'Сам согласовал как source-reviewer',
  :'rev6', 'db4-approval-self-decide'
) as selfdec \gset
commit;

do $assert_self$
declare
  v_status text;
  v_self boolean;
begin
  set local role pi_table_owner;
  select status, self_approved into v_status, v_self
  from projectceo_platform.approval_requests
  where project_id = '41111111-1111-4111-8111-111111111111'
    and request_id = current_setting('projectceo.db4_selfreq')::uuid;
  if v_status <> 'approved' or v_self <> true then
    raise exception 'DB4_APPROVAL_SELF_MARKER_INVALID:%/%', v_status, v_self;
  end if;
end
$assert_self$;

\echo >>> 7-events
-- === 7. События append-only, прямой переход статуса запрещён ================

begin;
do $events_immutable$
begin
  begin
    update projectceo_platform.approval_request_events set reason = 'переписано';
    raise exception 'DB4_APPROVAL_EVENTS_UPDATE_ACCEPTED';
  exception
    when object_not_in_prerequisite_state then null;
    when insufficient_privilege then null;
  end;
  begin
    delete from projectceo_platform.approval_request_events;
    raise exception 'DB4_APPROVAL_EVENTS_DELETE_ACCEPTED';
  exception
    when object_not_in_prerequisite_state then null;
    when insufficient_privilege then null;
  end;
  -- Мимо машины: draft → approved напрямую.
  begin
    insert into projectceo_platform.approval_requests (
      organization_id, project_id, request_id,
      subject_kind, subject_id, approver_capability,
      status, requested_by, requested_reason
    ) values (
      'c8ee447c-212b-4f91-9ba1-55fc353273aa',
      '41111111-1111-4111-8111-111111111111',
      '11111111-2222-4333-8444-555555555555',
      'probe', 'probe-1', 'view_project',
      'approved', '31111111-1111-4111-8111-111111111111', 'мимо машины'
    );
    raise exception 'DB4_APPROVAL_ILLEGAL_INITIAL_STATE_ACCEPTED';
  exception when check_violation then null;
  end;
end
$events_immutable$;
rollback;

\echo >>> 8-read
-- === 8. Чужой проект и чтение ===============================================

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $foreign_read_denied$
begin
  perform projectceo_platform_api.list_approval_requests(
    '99999999-9999-4999-8999-999999999999');
  raise exception 'DB4_APPROVAL_FOREIGN_READ_ACCEPTED';
exception when sqlstate 'P1103' then null;
end
$foreign_read_denied$;

do $read_filter$
declare
  v_approved jsonb;
  v_count integer;
begin
  v_approved := projectceo_platform_api.list_approval_requests(
    '41111111-1111-4111-8111-111111111111', 'approved');
  v_count := jsonb_array_length(v_approved -> 'requests');
  if v_count <> 2 then
    raise exception 'DB4_APPROVAL_READ_FILTER_INVALID:%', v_count;
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(v_approved -> 'requests') request
    where request ->> 'requestId' = current_setting('projectceo.db4_req1')
      and request ? 'requestedByCurrentActor'
      and (request ->> 'requestedByCurrentActor')::boolean = true
  ) then
    raise exception 'DB4_APPROVAL_REQUESTER_PROJECTION_MISSING';
  end if;
end
$read_filter$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $owner_read_projection$
declare
  v_approved jsonb;
begin
  v_approved := projectceo_platform_api.list_approval_requests(
    '41111111-1111-4111-8111-111111111111', 'approved');
  if not exists (
    select 1
    from jsonb_array_elements(v_approved -> 'requests') request
    where request ->> 'requestId' = current_setting('projectceo.db4_selfreq')
      and (request ->> 'requestedByCurrentActor')::boolean = true
  ) then
    raise exception 'DB4_APPROVAL_CURRENT_ACTOR_PROJECTION_INVALID';
  end if;
end
$owner_read_projection$;
commit;

begin;
set local role anon;
do $anon_denied$
begin
  perform projectceo_platform_api.list_approval_requests(
    '41111111-1111-4111-8111-111111111111');
  raise exception 'DB4_APPROVAL_ANON_READ_ACCEPTED';
exception when insufficient_privilege then null;
end
$anon_denied$;
rollback;

select 'DB4_APPROVAL_REQUESTS_OK' as result;
