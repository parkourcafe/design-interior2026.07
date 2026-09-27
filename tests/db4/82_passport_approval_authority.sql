\set ON_ERROR_STOP on

-- DB4: полномочия одобрения паспорта (DEC-041 §3, миграция 20260927090000).
--
-- Сид: tests/db3/20_foundation_operations.sql — проект 41111111, владелец
-- 31111111 (owner_lead). Архитектор сида 32222222 к этому моменту отозван
-- Фазой 0 (членство без приглашения), поэтому архитектор, строитель и клиент
-- заводятся здесь. Весь файл — одна транзакция с откатом: следующие файлы DB4 видят
-- базу без этих участников, ревизий и прав.

begin;

create function pg_temp.rev()
returns bigint
language sql
as $function$
  select state_revision from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111'
$function$;

-- Выполнить запрос от имени пользователя через тот же вход, что PostgREST.
create function pg_temp.call_as(p_user uuid, p_sql text)
returns jsonb
language plpgsql
as $function$
declare
  v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);
  execute p_sql into v_result;
  perform pg_catalog.set_config('role', 'postgres', true);
  return v_result;
end
$function$;

create function pg_temp.expect_error(
  p_user uuid, p_sql text, p_state text, p_marker text, p_label text
)
returns void
language plpgsql
as $function$
declare
  v_state text;
  v_text text;
begin
  begin
    perform pg_temp.call_as(p_user, p_sql);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate,
      v_text = pg_exception_detail;
    v_text := coalesce(v_text, '') || ' ' || sqlerrm;
    if v_state <> p_state or v_text not like '%' || p_marker || '%' then
      raise exception 'DB4_82_WRONG_FAILURE:%:%:%', p_label, v_state, v_text;
    end if;
    return;
  end;
  raise exception 'DB4_82_EXPECTED_FAILURE:%', p_label;
end
$function$;

create function pg_temp.create_req(p_user uuid, p_key text, p_capability text)
returns uuid
language sql
as $function$
  select (pg_temp.call_as(p_user, pg_catalog.format(
    'select projectceo_platform_api.create_approval_request(%L, %L, %L, %L, %L, %s, %L)',
    '41111111-1111-4111-8111-111111111111', 'project_passport',
    '41111111-1111-4111-8111-111111111111', p_capability,
    'db4-82 паспорт', pg_temp.rev(), p_key
  )) -> 'result' ->> 'requestId')::uuid
$function$;

create function pg_temp.submit_req(p_user uuid, p_request uuid, p_key text)
returns jsonb
language sql
as $function$
  select pg_temp.call_as(p_user, pg_catalog.format(
    'select projectceo_platform_api.submit_approval_request(%L, %L, %s, %L)',
    '41111111-1111-4111-8111-111111111111', p_request, pg_temp.rev(), p_key
  ))
$function$;

create function pg_temp.decide_sql(p_request uuid, p_decision text, p_key text)
returns text
language sql
as $function$
  select pg_catalog.format(
    'select projectceo_platform_api.decide_approval_request(%L, %L, %L, %L, %s, %L)',
    '41111111-1111-4111-8111-111111111111', p_request, p_decision,
    'db4-82 решение', pg_temp.rev(), p_key
  )
$function$;

create function pg_temp.access_sql(p_function text, p_user uuid, p_key text)
returns text
language sql
as $function$
  select pg_catalog.format(
    'select projectceo_platform_api.%s(%L, %L, %L, %s, %L)',
    p_function, '41111111-1111-4111-8111-111111111111', p_user,
    'db4-82 доступ', pg_temp.rev(), p_key
  )
$function$;

-- === Сид: паспорт, строитель, клиент ========================================

insert into auth.users (id, email, email_confirmed_at) values
  ('82111111-1111-4111-8111-111111111111', 'builder-82@example.invalid', now()),
  ('82222222-2222-4222-8222-222222222222', 'client-82@example.invalid', now()),
  ('82333333-3333-4333-8333-333333333333', 'architect-82@example.invalid', now());

do $seed$
declare
  v_org uuid;
begin
  select organization_id into v_org from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  insert into project_intelligence.organization_members (organization_id, user_id, role, status)
  values (v_org, '82111111-1111-4111-8111-111111111111', 'member', 'active'),
         (v_org, '82222222-2222-4222-8222-222222222222', 'member', 'active'),
         (v_org, '82333333-3333-4333-8333-333333333333', 'member', 'active');
  insert into projectceo_foundation.project_memberships
    (organization_id, project_id, user_id, role, status)
  values
    (v_org, '41111111-1111-4111-8111-111111111111',
     '82111111-1111-4111-8111-111111111111', 'builder', 'active'),
    (v_org, '41111111-1111-4111-8111-111111111111',
     '82222222-2222-4222-8222-222222222222', 'client_approver', 'active'),
    (v_org, '41111111-1111-4111-8111-111111111111',
     '82333333-3333-4333-8333-333333333333', 'architect', 'active');
  insert into projectceo_foundation.project_member_capabilities
    (organization_id, project_id, user_id, capability)
  select v_org, '41111111-1111-4111-8111-111111111111', member.user_id, rc.capability
  from (values
    ('82111111-1111-4111-8111-111111111111'::uuid, 'builder'),
    ('82222222-2222-4222-8222-222222222222'::uuid, 'client_approver'),
    ('82333333-3333-4333-8333-333333333333'::uuid, 'architect')
  ) member(user_id, role)
  cross join lateral projectceo_foundation._role_capabilities(member.role) rc;

  -- Новая ревизия паспорта — через тот же триггер, что и серверный маршрут брифа.
  update public.projects
  set passport = '{"object":{"type":"flat","area_m2":61,"city":"db4-82"}}'::jsonb,
      passport_revision_llm_ok = true
  where id = '41111111-1111-4111-8111-111111111111';
end
$seed$;

-- === 1. Роль одобряющего задаёт сервер, не автор =============================

do $server_derived$
declare
  v_request uuid;
  v_capability text;
  v_revision bigint;
begin
  v_request := pg_temp.create_req(
    '82111111-1111-4111-8111-111111111111', 'db4-82-builder-create', 'view_project');
  select approver_capability, subject_revision_no into v_capability, v_revision
  from projectceo_platform.approval_requests where request_id = v_request;
  if v_capability <> 'approve_passport'
    or v_revision is distinct from projectceo_platform._current_passport_revision(
      '41111111-1111-4111-8111-111111111111') then
    raise exception 'DB4_82_APPROVER_NOT_SERVER_DERIVED:%/%', v_capability, v_revision;
  end if;
  perform set_config('projectceo.db4_82_builder_req', v_request::text, true);
  perform pg_temp.submit_req(
    '82111111-1111-4111-8111-111111111111', v_request, 'db4-82-builder-submit');
end
$server_derived$;

-- Чужой subjectId для project_passport отклоняется.
select pg_temp.expect_error(
  '31111111-1111-4111-8111-111111111111',
  pg_catalog.format(
    'select projectceo_platform_api.create_approval_request(%L, %L, %L, %L, %L, %s, %L)',
    '41111111-1111-4111-8111-111111111111', 'project_passport',
    '42222222-2222-4222-8222-222222222222', 'approve_passport', 'db4-82', pg_temp.rev(),
    'db4-82-foreign-subject'),
  'P1111', 'subjectId', 'foreign_subject');

-- === 2. Строитель, клиент и архитектор без права не одобряют =================

select pg_temp.expect_error(
  '82111111-1111-4111-8111-111111111111',
  pg_temp.decide_sql(current_setting('projectceo.db4_82_builder_req')::uuid,
    'approved', 'db4-82-builder-self'),
  'P1103', 'PASSPORT_APPROVAL_AUTHORITY_REQUIRED', 'builder_self_approval');
select pg_temp.expect_error(
  '82222222-2222-4222-8222-222222222222',
  pg_temp.decide_sql(current_setting('projectceo.db4_82_builder_req')::uuid,
    'approved', 'db4-82-client'),
  'P1103', 'PASSPORT_APPROVAL_AUTHORITY_REQUIRED', 'client_approval');
select pg_temp.expect_error(
  '82333333-3333-4333-8333-333333333333',
  pg_temp.decide_sql(current_setting('projectceo.db4_82_builder_req')::uuid,
    'approved', 'db4-82-architect-no-grant'),
  'P1103', 'PASSPORT_APPROVAL_AUTHORITY_REQUIRED', 'architect_without_grant');

-- Архитектор не выдаёт право сам себе; владелец не выдаёт его строителю.
select pg_temp.expect_error(
  '82333333-3333-4333-8333-333333333333',
  pg_temp.access_sql('grant_passport_approval',
    '82333333-3333-4333-8333-333333333333', 'db4-82-architect-self-grant'),
  'P1103', 'forbidden', 'architect_self_grant');
select pg_temp.expect_error(
  '31111111-1111-4111-8111-111111111111',
  pg_temp.access_sql('grant_passport_approval',
    '82111111-1111-4111-8111-111111111111', 'db4-82-grant-builder'),
  'P1110', 'PASSPORT_APPROVAL_TARGET_NOT_ARCHITECT', 'grant_to_builder');

-- === 3. Владелец выдаёт право архитектору; выдача в журнале ================

do $grant$
declare
  v_result jsonb;
  v_ledger integer;
begin
  v_result := pg_temp.call_as('31111111-1111-4111-8111-111111111111',
    pg_temp.access_sql('grant_passport_approval',
      '82333333-3333-4333-8333-333333333333', 'db4-82-grant-architect'));
  if (v_result -> 'result' ->> 'changed')::boolean is distinct from true then
    raise exception 'DB4_82_GRANT_NOT_APPLIED:%', v_result;
  end if;
  select count(*) into v_ledger
  from projectceo_foundation.capability_grant_ledger l
  where l.project_id = '41111111-1111-4111-8111-111111111111'
    and l.user_id = '82333333-3333-4333-8333-333333333333'
    and l.capability = 'approve_passport'
    and l.action = 'granted'
    and l.reason like 'grant_passport_approval: %'
    and l.actor_user_id = '31111111-1111-4111-8111-111111111111';
  if v_ledger <> 1 then
    raise exception 'DB4_82_GRANT_NOT_LEDGERED:%', v_ledger;
  end if;
  if exists (select 1 from projectceo_foundation.verify_capability_grants() v
             where v.project_id = '41111111-1111-4111-8111-111111111111'
               and v.capability = 'approve_passport') then
    raise exception 'DB4_82_GRANT_FAILS_VERIFICATION';
  end if;
end
$grant$;

-- === 4. При втором одобряющем владелец не одобряет сам себя ================

do $owner_not_sole$
declare
  v_request uuid;
begin
  v_request := pg_temp.create_req(
    '31111111-1111-4111-8111-111111111111', 'db4-82-owner-create', 'view_project');
  perform pg_temp.submit_req(
    '31111111-1111-4111-8111-111111111111', v_request, 'db4-82-owner-submit');
  perform set_config('projectceo.db4_82_owner_req', v_request::text, true);
end
$owner_not_sole$;

select pg_temp.expect_error(
  '31111111-1111-4111-8111-111111111111',
  pg_temp.decide_sql(current_setting('projectceo.db4_82_owner_req')::uuid,
    'approved', 'db4-82-owner-self-not-sole'),
  'P1103', 'SELF_APPROVAL_REQUIRES_SOLE_OWNER', 'owner_self_with_second_approver');

-- === 5. Архитектор с правом одобряет; КП отправляется ======================

do $architect_approves$
declare
  v_result jsonb;
  v_status text;
begin
  v_result := pg_temp.call_as('82333333-3333-4333-8333-333333333333',
    pg_temp.decide_sql(current_setting('projectceo.db4_82_owner_req')::uuid,
      'approved', 'db4-82-architect-approve'));
  if (v_result -> 'result' ->> 'selfApproved')::boolean is distinct from false then
    raise exception 'DB4_82_ARCHITECT_APPROVAL_MARKED_SELF:%', v_result;
  end if;

  insert into public.proposals (id, project_id, version, sections, status, public_token)
  values ('82a00000-0000-4000-8000-000000000001', '41111111-1111-4111-8111-111111111111',
          82, '[]'::jsonb, 'draft', 'db4-82-token-a');
  perform pg_temp.call_as('31111111-1111-4111-8111-111111111111',
    $sql$
      with sent as (
        update public.proposals set status = 'sent'
        where id = '82a00000-0000-4000-8000-000000000001'
        returning status
      )
      select to_jsonb(status) from sent
    $sql$);
  select status into v_status from public.proposals
  where id = '82a00000-0000-4000-8000-000000000001';
  if v_status <> 'sent' then
    raise exception 'DB4_82_APPROVED_SEND_FAILED:%', v_status;
  end if;
end
$architect_approves$;

-- === 6. Новая ревизия паспорта делает одобрение недействительным ===========

do $revision_invalidates$
declare
  v_requests jsonb;
begin
  update public.projects
  set passport = '{"object":{"type":"flat","area_m2":62,"city":"db4-82"}}'::jsonb,
      passport_revision_llm_ok = true
  where id = '41111111-1111-4111-8111-111111111111';

  v_requests := pg_temp.call_as('31111111-1111-4111-8111-111111111111',
    'select projectceo_platform_api.list_approval_requests(''41111111-1111-4111-8111-111111111111'', ''approved'')'
  ) -> 'requests';
  if exists (
    select 1 from jsonb_array_elements(v_requests) r
    where r ->> 'subjectKind' = 'project_passport'
      and r -> 'subjectRevisionCurrent' = 'true'::jsonb
  ) then
    raise exception 'DB4_82_STALE_APPROVAL_STILL_CURRENT:%', v_requests;
  end if;

  insert into public.proposals (id, project_id, version, sections, status, public_token)
  values ('82a00000-0000-4000-8000-000000000002', '41111111-1111-4111-8111-111111111111',
          83, '[]'::jsonb, 'draft', 'db4-82-token-b');
end
$revision_invalidates$;

select pg_temp.expect_error(
  '31111111-1111-4111-8111-111111111111',
  $sql$
    with sent as (
      update public.proposals set status = 'sent'
      where id = '82a00000-0000-4000-8000-000000000002'
      returning status
    )
    select to_jsonb(status) from sent
  $sql$,
  '42501', 'PROPOSAL_APPROVAL_REQUIRED', 'send_with_stale_approval');

-- Заявка на прежнюю ревизию не подаётся и не одобряется.
do $stale_request$
declare
  v_request uuid;
begin
  v_request := pg_temp.create_req(
    '31111111-1111-4111-8111-111111111111', 'db4-82-stale-create', 'view_project');
  perform set_config('projectceo.db4_82_stale_req', v_request::text, true);
  update public.projects
  set passport = '{"object":{"type":"flat","area_m2":63,"city":"db4-82"}}'::jsonb,
      passport_revision_llm_ok = true
  where id = '41111111-1111-4111-8111-111111111111';
end
$stale_request$;

select pg_temp.expect_error(
  '31111111-1111-4111-8111-111111111111',
  pg_catalog.format(
    'select projectceo_platform_api.submit_approval_request(%L, %L, %s, %L)',
    '41111111-1111-4111-8111-111111111111',
    current_setting('projectceo.db4_82_stale_req'), pg_temp.rev(), 'db4-82-stale-submit'),
  'P1110', 'PASSPORT_REVISION_STALE', 'submit_stale_request');

-- === 7. Отзыв права: архитектор больше не одобряет, владелец снова один ====

do $revoke$
declare
  v_result jsonb;
  v_request uuid;
begin
  v_result := pg_temp.call_as('31111111-1111-4111-8111-111111111111',
    pg_temp.access_sql('revoke_passport_approval',
      '82333333-3333-4333-8333-333333333333', 'db4-82-revoke-architect'));
  if (v_result -> 'result' ->> 'changed')::boolean is distinct from true then
    raise exception 'DB4_82_REVOKE_NOT_APPLIED:%', v_result;
  end if;
  if not exists (
    select 1 from projectceo_foundation.capability_grant_ledger l
    where l.project_id = '41111111-1111-4111-8111-111111111111'
      and l.user_id = '82333333-3333-4333-8333-333333333333'
      and l.capability = 'approve_passport'
      and l.action = 'revoked'
      and l.reason like 'revoke_passport_approval: %'
  ) then
    raise exception 'DB4_82_REVOKE_NOT_LEDGERED';
  end if;

  v_request := pg_temp.create_req(
    '31111111-1111-4111-8111-111111111111', 'db4-82-sole-create', 'view_project');
  perform pg_temp.submit_req(
    '31111111-1111-4111-8111-111111111111', v_request, 'db4-82-sole-submit');
  perform set_config('projectceo.db4_82_sole_req', v_request::text, true);
end
$revoke$;

select pg_temp.expect_error(
  '82333333-3333-4333-8333-333333333333',
  pg_temp.decide_sql(current_setting('projectceo.db4_82_sole_req')::uuid,
    'approved', 'db4-82-architect-after-revoke'),
  'P1103', 'PASSPORT_APPROVAL_AUTHORITY_REQUIRED', 'architect_after_revoke');

do $sole_owner_self_approval$
declare
  v_result jsonb;
  v_self boolean;
begin
  v_result := pg_temp.call_as('31111111-1111-4111-8111-111111111111',
    pg_temp.decide_sql(current_setting('projectceo.db4_82_sole_req')::uuid,
      'approved', 'db4-82-sole-owner'));
  select self_approved into v_self from projectceo_platform.approval_requests
  where request_id = current_setting('projectceo.db4_82_sole_req')::uuid;
  if v_self is distinct from true
    or (v_result -> 'result' ->> 'selfApproved')::boolean is distinct from true then
    raise exception 'DB4_82_SOLE_OWNER_SELF_APPROVAL_NOT_MARKED:%', v_result;
  end if;
end
$sole_owner_self_approval$;

rollback;
