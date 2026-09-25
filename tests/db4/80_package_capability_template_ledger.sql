\set ON_ERROR_STOP on

-- DB4: DEC-040 — пакетный architect получает ровно шесть прав пакетного
-- шаблона; унаследованные широкие права отзываются; каждое изменение прав
-- попадает в append-only журнал, а verify_capability_grants() доказывает, что
-- состояние совпадает с журналом и правилами
-- (миграция 20260925091000; финальный аудит 25.09.2026, SEC-01/SEC-02).

-- 0. Поверхность журнала и сверки закрыта от API-ролей. Глобальную чистоту
--    здесь не требуем: фикстуры R1 прямым привилегированным SQL пишут пакетные
--    права вне шаблона — это видно в verify_capability_grants(), но не
--    относится к продуктовым путям. Проверки ниже ограничены проектом 80.
do $surface_closed$
begin
  if pg_catalog.has_function_privilege(
    'authenticated', 'projectceo_foundation.verify_capability_grants()', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', 'projectceo_foundation._revoke_legacy_capability_grants(text,uuid)', 'EXECUTE'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'projectceo_foundation.capability_grant_ledger', 'SELECT'
  ) then
    raise exception 'DB4_80_LEDGER_SURFACE_EXPOSED';
  end if;
end
$surface_closed$;

begin;

insert into auth.users(id,email,email_confirmed_at) values
 ('80111111-1111-4111-8111-111111111111','owner-80@example.invalid',now()),
 ('80222222-2222-4222-8222-222222222222','architect-80@example.invalid',now()),
 ('80333333-3333-4333-8333-333333333333','legacy-80@example.invalid',now()),
 ('80999999-9999-4999-8999-999999999999','invited-80@example.invalid',now());
insert into public.designers(id,name) values
 ('80111111-1111-4111-8111-111111111111','DB4 owner 80');
insert into public.projects(id,designer_id,client_name,intake_token) values
 ('80555555-5555-4555-8555-555555555555','80111111-1111-4111-8111-111111111111',
  'DB4 capability template 80','db4-capability-80');

-- 1. Владелец зачисляет проект, приглашает проектного architect (законный
--    проектный доступ) и заводит пакетного architect через enrollment.
do $enroll$
declare
  v_state bigint;
  v_token bytea := extensions.digest('db4-80-project-architect', 'sha256');
begin
  set local role authenticated;
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  perform projectceo_api.enroll_organization_project('80555555-5555-4555-8555-555555555555','db4-80-base');
  reset role;
  select state_revision into v_state from project_intelligence.project_workflows
  where project_id='80555555-5555-4555-8555-555555555555';
  set local role authenticated;
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  perform projectceo_api.create_invitation('80555555-5555-4555-8555-555555555555',null,
    'invited-80@example.invalid','architect',statement_timestamp()+interval '1 day',
    v_token,v_state,'db4-80-project-invite');
  set local request.jwt.claim.sub='80999999-9999-4999-8999-999999999999';
  set local request.jwt.claims='{"email":"invited-80@example.invalid","email_verified":true,"amr":[{"method":"magiclink","timestamp":1770000000}]}';
  perform projectceo_api.accept_invitation(v_token,'db4-80-project-accept');
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  perform projectceo_api.enroll_organization_project_scope(
    '80555555-5555-4555-8555-555555555555','80666666-6666-4666-8666-666666666666',
    'package-80','Package 80',jsonb_build_array(
      jsonb_build_object('userId','80222222-2222-4222-8222-222222222222','role','architect')
    ),'db4-80-package');
  reset role;
end
$enroll$;

-- 2. Пакетный architect: ровно шесть прав шаблона, отказ по остальным
--    записан в журнал, publish_release/publish_baseline/manage_budget на
--    уровне пакета недоступны.
do $package_architect_minimal$
declare
  v_caps text[];
  v_denied integer;
  v_capability text;
begin
  select pg_catalog.array_agg(capability order by capability) into v_caps
  from projectceo_foundation.package_member_capabilities
  where project_id='80555555-5555-4555-8555-555555555555'
    and package_id='80666666-6666-4666-8666-666666666666'
    and user_id='80222222-2222-4222-8222-222222222222';
  if v_caps is distinct from array[
    'acknowledge_release','create_change','register_source',
    'review_milestone','upload_photo_evidence','view_project'
  ]::text[] then
    raise exception 'DB4_80_PACKAGE_ARCHITECT_CAPABILITIES:%', v_caps;
  end if;

  select count(*) into v_denied
  from projectceo_foundation.capability_grant_ledger
  where project_id='80555555-5555-4555-8555-555555555555'
    and user_id='80222222-2222-4222-8222-222222222222'
    and action='denied_by_template'
    and capability in ('publish_release','publish_baseline','manage_budget');
  if v_denied <> 3 then
    raise exception 'DB4_80_TEMPLATE_DENIAL_NOT_RECORDED:%', v_denied;
  end if;

  foreach v_capability in array array['publish_release','publish_baseline','manage_budget'] loop
    perform pg_catalog.set_config('request.jwt.claim.sub','80222222-2222-4222-8222-222222222222',true);
    begin
      perform projectceo_foundation._authorize_package_human(
        '80555555-5555-4555-8555-555555555555',
        '80666666-6666-4666-8666-666666666666', v_capability);
      raise exception 'DB4_80_PACKAGE_ARCHITECT_%_AUTHORIZED', upper(v_capability);
    exception when sqlstate 'P1103' then null;
    end;
  end loop;

  if exists (select 1 from projectceo_foundation.verify_capability_grants()
             where project_id = '80555555-5555-4555-8555-555555555555') then
    raise exception 'DB4_80_GRANTS_NOT_CLEAN_AFTER_ENROLLMENT';
  end if;
end
$package_architect_minimal$;

-- 3. Унаследованное состояние (как после enrollment до WP-32): проектное
--    членство без приглашения и пакетное право вне шаблона. Проверка его
--    видит, отзыв убирает, проектный architect по приглашению сохраняется.
do $legacy_revoke$
declare
  v_org uuid;
  v_violations text[];
  v_result jsonb;
  v_project_template integer;
begin
  select count(*) into v_project_template
  from projectceo_foundation._role_capabilities('architect');
  select organization_id into v_org from project_intelligence.project_workflows
  where project_id='80555555-5555-4555-8555-555555555555';

  insert into project_intelligence.organization_members (organization_id, user_id, role, status)
  values (v_org, '80333333-3333-4333-8333-333333333333', 'member', 'active')
  on conflict do nothing;
  insert into projectceo_foundation.project_memberships (organization_id, project_id, user_id, role, status)
  values (v_org, '80555555-5555-4555-8555-555555555555', '80333333-3333-4333-8333-333333333333', 'architect', 'active');
  insert into projectceo_foundation.project_member_capabilities (organization_id, project_id, user_id, capability)
  select v_org, '80555555-5555-4555-8555-555555555555', '80333333-3333-4333-8333-333333333333', rc.capability
  from projectceo_foundation._role_capabilities('architect') rc;
  -- Enrollment до WP-32 заводил и пакетное членство, но без пакетных прав.
  insert into projectceo_foundation.package_memberships
    (organization_id, project_id, package_id, user_id, role, status)
  values (v_org, '80555555-5555-4555-8555-555555555555', '80666666-6666-4666-8666-666666666666',
          '80333333-3333-4333-8333-333333333333', 'architect', 'active');

  -- Прямая привилегированная запись (не продуктовый путь) не блокируется,
  -- но журналируется и видна сверке.
  insert into projectceo_foundation.package_member_capabilities
    (organization_id, project_id, package_id, user_id, capability)
  values (v_org, '80555555-5555-4555-8555-555555555555', '80666666-6666-4666-8666-666666666666',
          '80222222-2222-4222-8222-222222222222', 'publish_release');

  select pg_catalog.array_agg(distinct violation order by violation) into v_violations
  from projectceo_foundation.verify_capability_grants()
  where project_id='80555555-5555-4555-8555-555555555555';
  if v_violations is distinct from array[
    'package_capability_outside_template','project_member_without_invitation'
  ]::text[] then
    raise exception 'DB4_80_LEGACY_NOT_DETECTED:%', v_violations;
  end if;

  v_result := projectceo_foundation._revoke_legacy_capability_grants(
    'db4-80-legacy-revoke', '80555555-5555-4555-8555-555555555555');
  if (v_result->>'packageCapabilitiesRevoked')::int <> 1
     or (v_result->>'projectCapabilitiesRevoked')::int <> v_project_template
     or (v_result->>'projectMembershipsDeactivated')::int <> 1
     or (v_result->>'packageTemplateBackfilled')::int <> 6 then
    raise exception 'DB4_80_LEGACY_REVOKE_COUNTS:%', v_result;
  end if;

  if exists (select 1 from projectceo_foundation.verify_capability_grants()
             where project_id = '80555555-5555-4555-8555-555555555555') then
    raise exception 'DB4_80_GRANTS_NOT_CLEAN_AFTER_REVOKE';
  end if;
  if (select status from projectceo_foundation.project_memberships
      where project_id='80555555-5555-4555-8555-555555555555'
        and user_id='80333333-3333-4333-8333-333333333333') <> 'inactive' then
    raise exception 'DB4_80_LEGACY_MEMBERSHIP_STILL_ACTIVE';
  end if;
  -- Отозванный участник сохраняет ровно шесть минимальных пакетных прав.
  if (select count(*) from projectceo_foundation.package_member_capabilities
      where project_id='80555555-5555-4555-8555-555555555555'
        and package_id='80666666-6666-4666-8666-666666666666'
        and user_id='80333333-3333-4333-8333-333333333333') <> 6 then
    raise exception 'DB4_80_REVOKED_MEMBER_PACKAGE_TEMPLATE_MISSING';
  end if;
  if not exists (
    select 1 from projectceo_foundation.project_member_capabilities
    where project_id='80555555-5555-4555-8555-555555555555'
      and user_id='80999999-9999-4999-8999-999999999999'
      and capability='publish_release'
  ) then
    raise exception 'DB4_80_INVITED_PROJECT_ARCHITECT_REVOKED';
  end if;
  if (select count(*) from projectceo_foundation.capability_grant_ledger
      where project_id='80555555-5555-4555-8555-555555555555'
        and action='revoked' and reason='db4-80-legacy-revoke') <> v_project_template + 1 then
    raise exception 'DB4_80_REVOKE_NOT_LEDGERED';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub','80333333-3333-4333-8333-333333333333',true);
  begin
    perform projectceo_foundation._authorize_project_human(
      '80555555-5555-4555-8555-555555555555', 'view_project');
    raise exception 'DB4_80_REVOKED_MEMBER_STILL_AUTHORIZED';
  exception when sqlstate 'P1103' then null;
  end;
end
$legacy_revoke$;

-- 4. Журнал неизменяем.
do $ledger_append_only$
begin
  begin
    update projectceo_foundation.capability_grant_ledger set reason = 'tampered'
    where project_id='80555555-5555-4555-8555-555555555555';
    raise exception 'DB4_80_LEDGER_UPDATE_ACCEPTED';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from projectceo_foundation.capability_grant_ledger
    where project_id='80555555-5555-4555-8555-555555555555';
    raise exception 'DB4_80_LEDGER_DELETE_ACCEPTED';
  exception when sqlstate '55000' then null;
  end;
end
$ledger_append_only$;

rollback;

select 'DB4_PACKAGE_CAPABILITY_TEMPLATE_LEDGER_OK' result;
