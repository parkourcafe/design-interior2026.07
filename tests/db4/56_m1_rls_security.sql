\set ON_ERROR_STOP on

-- Regression proof for the two hosted security-advisor ERROR findings.
-- The role matrix intentionally preserves the implemented M1 routes:
--   * passport revisions have no direct human or service-role surface;
--   * contract documents are writable/readable only by projects.designer_id;
--   * studio designer, builder, client, outsider and anon stay denied.

do $schema_contract$
declare
  v_policy_count integer;
begin
  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'project_passport_revisions',
        'contract_documents'
      )
      and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ) then
    raise exception 'DB4_M1_RLS_NOT_FORCED';
  end if;

  select count(*) into v_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'project_passport_revisions';
  if v_policy_count <> 1 then
    raise exception 'DB4_M1_PASSPORT_POLICY_COUNT:%', v_policy_count;
  end if;

  select count(*) into v_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'contract_documents';
  if v_policy_count <> 3 then
    raise exception 'DB4_M1_CONTRACT_POLICY_COUNT:%', v_policy_count;
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_name
    where pg_catalog.has_table_privilege(
      role_name,
      'public.project_passport_revisions',
      privilege_name
    )
  ) then
    raise exception 'DB4_M1_PASSPORT_API_GRANT';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'service_role']) role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_name
    where pg_catalog.has_table_privilege(
      role_name,
      'public.contract_documents',
      privilege_name
    )
  ) then
    raise exception 'DB4_M1_CONTRACT_NONHUMAN_GRANT';
  end if;

  if not pg_catalog.has_table_privilege(
    'authenticated', 'public.contract_documents', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.contract_documents', 'DELETE'
  ) or not pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'project_id', 'INSERT'
  ) or not pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'storage_path', 'INSERT'
  ) or not pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'original_name', 'INSERT'
  ) or not pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'sha256', 'INSERT'
  ) or not pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'size_bytes', 'INSERT'
  ) or not pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'status', 'INSERT'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'id', 'INSERT'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'created_at', 'INSERT'
  ) or not pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'status', 'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'sha256', 'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'storage_path', 'UPDATE'
  ) then
    raise exception 'DB4_M1_CONTRACT_LEAST_PRIVILEGE_ACL';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'projectceo_foundation.append_legacy_passport_revision()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_foundation.append_legacy_passport_revision()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'projectceo_foundation.append_legacy_passport_revision()',
    'EXECUTE'
  ) then
    raise exception 'DB4_M1_PASSPORT_TRIGGER_FUNCTION_EXPOSED';
  end if;
end
$schema_contract$;

insert into auth.users (id, email) values
  ('78888888-8888-4888-8888-888888888801', 'm1-owner@example.invalid'),
  ('78888888-8888-4888-8888-888888888802', 'm1-designer@example.invalid'),
  ('78888888-8888-4888-8888-888888888803', 'm1-builder@example.invalid'),
  ('78888888-8888-4888-8888-888888888804', 'm1-client@example.invalid'),
  ('78888888-8888-4888-8888-888888888805', 'm1-other-owner@example.invalid')
on conflict (id) do nothing;

insert into public.designers (id, name, studio_name) values
  (
    '78888888-8888-4888-8888-888888888801',
    'M1 owner',
    'M1 tenant A'
  ),
  (
    '78888888-8888-4888-8888-888888888805',
    'M1 other owner',
    'M1 tenant B'
  )
on conflict (id) do nothing;

insert into public.studio_members (
  owner_id,
  member_id,
  email,
  role,
  status,
  joined_at
) values (
  '78888888-8888-4888-8888-888888888801',
  '78888888-8888-4888-8888-888888888802',
  'm1-designer@example.invalid',
  'member',
  'active',
  statement_timestamp()
)
on conflict (owner_id, email) do nothing;

insert into public.projects (
  id,
  designer_id,
  client_name,
  status,
  intake_token
) values
  (
    '78888888-8888-4888-8888-888888888811',
    '78888888-8888-4888-8888-888888888801',
    'M1 tenant A project',
    'created',
    'db4-m1-rls-tenant-a'
  ),
  (
    '78888888-8888-4888-8888-888888888812',
    '78888888-8888-4888-8888-888888888805',
    'M1 tenant B project',
    'created',
    'db4-m1-rls-tenant-b'
  )
on conflict (id) do nothing;

-- Record real ProjectCEO roles for the non-owner identities. Their active
-- membership must not accidentally widen the legacy M1 table boundary.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888801';
select projectceo_api.enroll_organization_project(
  '78888888-8888-4888-8888-888888888811',
  'db4-m1-rls-enroll-owner'
);
commit;

insert into project_intelligence.organization_members (
  organization_id,
  user_id,
  role,
  status
)
select
  workflow.organization_id,
  actor.user_id,
  'member',
  'active'
from project_intelligence.project_workflows workflow
cross join (values
  ('78888888-8888-4888-8888-888888888802'::uuid),
  ('78888888-8888-4888-8888-888888888803'::uuid),
  ('78888888-8888-4888-8888-888888888804'::uuid)
) actor(user_id)
where workflow.project_id = '78888888-8888-4888-8888-888888888811'
on conflict (organization_id, user_id) do nothing;

insert into projectceo_foundation.project_memberships (
  organization_id,
  project_id,
  user_id,
  role,
  status
)
select
  workflow.organization_id,
  workflow.project_id,
  actor.user_id,
  actor.role,
  'active'
from project_intelligence.project_workflows workflow
cross join (values
  ('78888888-8888-4888-8888-888888888802'::uuid, 'architect'::text),
  ('78888888-8888-4888-8888-888888888803'::uuid, 'builder'::text),
  ('78888888-8888-4888-8888-888888888804'::uuid, 'client_approver'::text)
) actor(user_id, role)
where workflow.project_id = '78888888-8888-4888-8888-888888888811'
on conflict (organization_id, project_id, user_id) do nothing;

insert into public.contract_documents (
  id,
  project_id,
  storage_path,
  original_name,
  sha256,
  size_bytes,
  status
) values
  (
    '78888888-8888-4888-8888-888888888821',
    '78888888-8888-4888-8888-888888888811',
    'contract-documents/78888888-8888-4888-8888-888888888811/' || repeat('a', 64),
    'tenant-a.pdf',
    repeat('a', 64),
    2048,
    'uploaded'
  ),
  (
    '78888888-8888-4888-8888-888888888822',
    '78888888-8888-4888-8888-888888888812',
    'contract-documents/78888888-8888-4888-8888-888888888812/' || repeat('b', 64),
    'tenant-b.pdf',
    repeat('b', 64),
    2048,
    'uploaded'
  );

-- Existing server intake can update the project, but service_role cannot read
-- or append the revision table directly. The protected trigger owns the only
-- append path and preserves llm_ok, same-passport resubmission and numbering.
begin;
set local role service_role;
update public.projects
set passport = '{"contact":{"name":"M1 client"}}'::jsonb,
    passport_revision_llm_ok = true
where id = '78888888-8888-4888-8888-888888888811';
update public.projects
set passport_revision_llm_ok = false
where id = '78888888-8888-4888-8888-888888888811';
do $service_role_direct_denied$
begin
  begin
    perform 1 from public.project_passport_revisions limit 1;
    raise exception 'DB4_M1_PASSPORT_SERVICE_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.project_passport_revisions (
      project_id, revision_no, passport, llm_ok
    ) values (
      '78888888-8888-4888-8888-888888888811', 99, '{}'::jsonb, false
    );
    raise exception 'DB4_M1_PASSPORT_SERVICE_INSERT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$service_role_direct_denied$;
commit;

do $passport_trigger_result$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.project_passport_revisions
  where project_id = '78888888-8888-4888-8888-888888888811';
  if v_count <> 2 then
    raise exception 'DB4_M1_PASSPORT_TRIGGER_COUNT:%', v_count;
  end if;
  if not exists (
    select 1
    from public.project_passport_revisions
    where project_id = '78888888-8888-4888-8888-888888888811'
      and revision_no = 1
      and llm_ok is true
  ) or not exists (
    select 1
    from public.project_passport_revisions
    where project_id = '78888888-8888-4888-8888-888888888811'
      and revision_no = 2
      and llm_ok is false
  ) then
    raise exception 'DB4_M1_PASSPORT_TRIGGER_CONTENT';
  end if;
  if exists (
    select 1
    from public.projects
    where id = '78888888-8888-4888-8888-888888888811'
      and passport_revision_llm_ok is not null
  ) then
    raise exception 'DB4_M1_PASSPORT_TRANSIENT_VALUE_PERSISTED';
  end if;
end
$passport_trigger_result$;

-- Exact owner/designer identity: own row only, initial upload only, status-only
-- mutation only. Cross-tenant and immutable metadata attempts are denied.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888801';
do $contract_owner$
declare
  v_count integer;
  v_rows integer;
begin
  select count(*) into v_count from public.contract_documents;
  if v_count <> 1 then
    raise exception 'DB4_M1_CONTRACT_OWNER_SCOPE:%', v_count;
  end if;

  insert into public.contract_documents (
    project_id, storage_path, original_name, sha256, size_bytes, status
  ) values (
    '78888888-8888-4888-8888-888888888811',
    'contract-documents/78888888-8888-4888-8888-888888888811/' || repeat('c', 64),
    'tenant-a-second.pdf',
    repeat('c', 64),
    4096,
    'uploaded'
  );

  update public.contract_documents
  set status = 'received'
  where project_id = '78888888-8888-4888-8888-888888888811'
    and sha256 = repeat('c', 64);
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'DB4_M1_CONTRACT_OWNER_UPDATE:%', v_rows;
  end if;

  update public.contract_documents
  set status = 'received'
  where id = '78888888-8888-4888-8888-888888888822';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'DB4_M1_CONTRACT_CROSS_TENANT_UPDATE:%', v_rows;
  end if;

  begin
    insert into public.contract_documents (
      project_id, storage_path, original_name, sha256, size_bytes, status
    ) values (
      '78888888-8888-4888-8888-888888888812',
      'contract-documents/78888888-8888-4888-8888-888888888812/' || repeat('d', 64),
      'cross-tenant.pdf', repeat('d', 64), 1024, 'uploaded'
    );
    raise exception 'DB4_M1_CONTRACT_CROSS_TENANT_INSERT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.contract_documents (
      project_id, storage_path, original_name, sha256, size_bytes, status
    ) values (
      '78888888-8888-4888-8888-888888888811',
      'contract-documents/78888888-8888-4888-8888-888888888811/' || repeat('e', 64),
      'invalid-state.pdf', repeat('e', 64), 1024, 'signed'
    );
    raise exception 'DB4_M1_CONTRACT_NONUPLOADED_INSERT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.contract_documents
    set sha256 = repeat('f', 64)
    where id = '78888888-8888-4888-8888-888888888821';
    raise exception 'DB4_M1_CONTRACT_METADATA_UPDATE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.contract_documents
    where id = '78888888-8888-4888-8888-888888888821';
    raise exception 'DB4_M1_CONTRACT_DELETE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.project_passport_revisions limit 1;
    raise exception 'DB4_M1_PASSPORT_OWNER_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$contract_owner$;
commit;

-- Active studio designer, builder and client memberships do not inherit the
-- exact-owner contract route or the internal passport registry.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888802';
do $designer_denied$
declare v_count integer;
begin
  select count(*) into v_count from public.contract_documents;
  if v_count <> 0 then raise exception 'DB4_M1_CONTRACT_DESIGNER_LEAK'; end if;
  begin
    perform 1 from public.project_passport_revisions limit 1;
    raise exception 'DB4_M1_PASSPORT_DESIGNER_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$designer_denied$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888803';
do $builder_denied$
declare v_count integer;
begin
  select count(*) into v_count from public.contract_documents;
  if v_count <> 0 then raise exception 'DB4_M1_CONTRACT_BUILDER_LEAK'; end if;
  begin
    perform 1 from public.project_passport_revisions limit 1;
    raise exception 'DB4_M1_PASSPORT_BUILDER_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$builder_denied$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888804';
do $client_denied$
declare v_count integer;
begin
  select count(*) into v_count from public.contract_documents;
  if v_count <> 0 then raise exception 'DB4_M1_CONTRACT_CLIENT_LEAK'; end if;
  begin
    perform 1 from public.project_passport_revisions limit 1;
    raise exception 'DB4_M1_PASSPORT_CLIENT_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$client_denied$;
commit;

-- Other tenant and unauthenticated callers are independently denied.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888805';
do $other_tenant$
declare v_count integer;
begin
  select count(*) into v_count from public.contract_documents;
  if v_count <> 1 then
    raise exception 'DB4_M1_CONTRACT_OTHER_TENANT_SCOPE:%', v_count;
  end if;
end
$other_tenant$;
commit;

begin;
set local role anon;
do $anon_denied$
begin
  begin
    perform 1 from public.contract_documents limit 1;
    raise exception 'DB4_M1_CONTRACT_ANON_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.project_passport_revisions limit 1;
    raise exception 'DB4_M1_PASSPORT_ANON_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$anon_denied$;
commit;

select 'DB4_M1_RLS_SECURITY_OK' as result;
