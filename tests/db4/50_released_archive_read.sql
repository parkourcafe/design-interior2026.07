\set ON_ERROR_STOP on

-- Read-only проекция released archive (`20260824160000`, M3 backlog #4):
-- владелец видит свой архив; участник без студийной роли не видит листов;
-- чужая организация — P1103; выключенный модуль — P1113 module_disabled;
-- DTO не содержит приватных имён, исходных имён файлов и signed URL.
--
-- Сценарий стоит после 49: к этому моменту цепочка 20/34 уже выпустила
-- версию пакета с артефактом и завела листы, а выключатель модулей прошёл
-- свой цикл и оставил M3 открытым.

-- Фикстура: участник с view_project, но без студийной роли — листы
-- документации ему не положены. Вставка фикстуры — суперпользователем,
-- как в 47_impact_upgrade_seed: контракт прикладных ролей проверяют
-- вызовы ниже, а не путь заведения фикстуры.
do $seed_client_member$
declare
  v_org uuid;
begin
  select workflow.organization_id into v_org
  from project_intelligence.project_workflows workflow
  where workflow.project_id = '41111111-1111-4111-8111-111111111111';

  insert into auth.users (id, email, email_confirmed_at)
  values (
    '35555555-5555-4555-8555-555555555555',
    'db4-archive-client@example.test',
    clock_timestamp()
  )
  on conflict (id) do nothing;

  insert into project_intelligence.organization_members (
    organization_id, user_id, role, status
  )
  values (v_org, '35555555-5555-4555-8555-555555555555', 'member', 'active')
  on conflict do nothing;

  insert into projectceo_foundation.project_memberships (
    organization_id, project_id, user_id, role, status
  )
  values (
    v_org,
    '41111111-1111-4111-8111-111111111111',
    '35555555-5555-4555-8555-555555555555',
    'client_approver',
    'active'
  )
  on conflict do nothing;

  insert into projectceo_foundation.project_member_capabilities (
    organization_id, project_id, user_id, capability
  )
  select
    v_org,
    '41111111-1111-4111-8111-111111111111',
    '35555555-5555-4555-8555-555555555555',
    rc.capability
  from projectceo_foundation._role_capabilities('client_approver') rc
  on conflict do nothing;
end
$seed_client_member$;

-- 1. Владелец (owner_lead) видит версии, артефакты и листы; DTO чист.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $owner_sees_archive$
declare
  v_read jsonb;
  v_text text;
begin
  v_read := projectceo_read_api.get_released_archive_read_v1(
    '41111111-1111-4111-8111-111111111111'
  );

  if v_read->'error' is distinct from 'null'::jsonb then
    raise exception 'DB4_ARCHIVE_OWNER_READ_ERROR:%', v_read->'error';
  end if;
  if jsonb_array_length(v_read#>'{data,versions}') < 1 then
    raise exception 'DB4_ARCHIVE_NO_VERSIONS';
  end if;
  if jsonb_array_length(v_read#>'{data,artifacts}') < 1 then
    raise exception 'DB4_ARCHIVE_NO_ARTIFACTS';
  end if;
  if v_read#>'{data,sheets}' is null then
    raise exception 'DB4_ARCHIVE_OWNER_SHEETS_MISSING';
  end if;
  if jsonb_array_length(v_read#>'{data,sheets}') < 1 then
    raise exception 'DB4_ARCHIVE_OWNER_SHEETS_EMPTY';
  end if;

  -- Санитизация DTO: ни приватных имён отношений, ни содержимого выпуска,
  -- ни следов файловой кухни.
  v_text := v_read::text;
  if v_text like '%signedUrl%'
    or v_text like '%originalFilename%'
    or v_text like '%logical_content%'
    or v_text like '%logicalContent%'
    or v_text like '%semantic_content%'
    or v_text like '%semanticContent%'
    or v_text like '%release_artifacts%'
    or v_text like '%production_package_versions%'
    or v_text like '%documentation_sheet_revisions%' then
    raise exception 'DB4_ARCHIVE_DTO_LEAK';
  end if;

  -- Версии и артефакты сцеплены: каждый артефакт указывает на версию из
  -- этой же выдачи.
  if exists (
    select 1
    from jsonb_array_elements(v_read#>'{data,artifacts}') artifact
    where not exists (
      select 1
      from jsonb_array_elements(v_read#>'{data,versions}') version
      where version->>'productionPackageVersionId'
        = artifact->>'productionPackageVersionId'
    )
  ) then
    raise exception 'DB4_ARCHIVE_ARTIFACT_WITHOUT_VERSION';
  end if;
end
$owner_sees_archive$;
rollback;

-- 2. Участник без студийной роли: версии и артефакты видит, ключа sheets нет.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '35555555-5555-4555-8555-555555555555';
do $client_no_sheets$
declare
  v_read jsonb;
begin
  v_read := projectceo_read_api.get_released_archive_read_v1(
    '41111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_read#>'{data,versions}') < 1 then
    raise exception 'DB4_ARCHIVE_CLIENT_NO_VERSIONS';
  end if;
  if v_read#>'{data,sheets}' is not null then
    raise exception 'DB4_ARCHIVE_CLIENT_SHEETS_LEAKED';
  end if;
end
$client_no_sheets$;
rollback;

-- 3. Чужая организация — P1103, как у любого чтения.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $cross_tenant_denied$
begin
  begin
    perform projectceo_read_api.get_released_archive_read_v1(
      '41111111-1111-4111-8111-111111111111'
    );
    raise exception 'DB4_ARCHIVE_CROSS_TENANT_ALLOWED';
  exception when sqlstate 'P1103' then null;
  end;
end
$cross_tenant_denied$;
rollback;

-- 4. Выключенный модуль — module_disabled (P1113). Закрываем выключателем,
-- проверяем отказ, открываем обратно: среда харнесса остаётся открытой.
select projectceo_platform.close_module_production(
  'm3', 'DB4 harness', 'сценарий 50: проверка module_disabled архива'
);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $module_disabled$
begin
  begin
    perform projectceo_read_api.get_released_archive_read_v1(
      '41111111-1111-4111-8111-111111111111'
    );
    raise exception 'DB4_ARCHIVE_SERVED_WITH_MODULE_OFF';
  exception when sqlstate 'P1113' then null;
  end;
end
$module_disabled$;
rollback;

select projectceo_platform.open_module_production(
  'm3', 'DB4 harness', 'сценарий 50: возврат среды харнесса к открытому M3'
);

-- 5. anon и service_role двери не имеют.
do $roles_denied$
declare
  v_leaked text;
begin
  select role_name into v_leaked
  from unnest(array['anon', 'service_role']) role_name
  where pg_catalog.has_function_privilege(
    role_name,
    'projectceo_read_api.get_released_archive_read_v1(uuid)',
    'EXECUTE'
  )
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_ARCHIVE_READ_LEAKED:%', v_leaked;
  end if;
end
$roles_denied$;

select 'DB4_RELEASED_ARCHIVE_READ_OK' as result;
