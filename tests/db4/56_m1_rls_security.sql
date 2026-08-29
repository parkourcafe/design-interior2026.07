\set ON_ERROR_STOP on

-- DB4: the two hosted-advisor findings are closed without broadening the M1
-- runtime surface. This file proves both ACLs and row-level allow/deny paths.

do $schema_contract$
declare
  v_problem text;
  v_policy_count integer;
begin
  select format('%I:rls=%s', c.relname, c.relrowsecurity)
  into v_problem
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('project_passport_revisions', 'contract_documents')
    and not c.relrowsecurity
  limit 1;
  if v_problem is not null then
    raise exception 'DB4_M1_RLS_DISABLED:%', v_problem;
  end if;

  select count(*) into v_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'project_passport_revisions';
  if v_policy_count <> 0 then
    raise exception 'DB4_M1_PASSPORT_POLICY_SURFACE:%', v_policy_count;
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
    from unnest(array['anon', 'authenticated']) role_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_name
    where pg_catalog.has_table_privilege(
      role_name,
      'public.project_passport_revisions',
      privilege_name
    )
  ) then
    raise exception 'DB4_M1_PASSPORT_PUBLIC_GRANT';
  end if;
  if not pg_catalog.has_table_privilege(
    'service_role', 'public.project_passport_revisions', 'SELECT'
  ) or not pg_catalog.has_table_privilege(
    'service_role', 'public.project_passport_revisions', 'INSERT'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.project_passport_revisions', 'UPDATE'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.project_passport_revisions', 'DELETE'
  ) then
    raise exception 'DB4_M1_PASSPORT_SERVICE_ROLE_ACL';
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
  ) or not pg_catalog.has_table_privilege(
    'authenticated', 'public.contract_documents', 'INSERT'
  ) or pg_catalog.has_table_privilege(
    'authenticated', 'public.contract_documents', 'DELETE'
  ) then
    raise exception 'DB4_M1_CONTRACT_TABLE_ACL';
  end if;
  if not pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'status', 'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'storage_path', 'UPDATE'
  ) or pg_catalog.has_column_privilege(
    'authenticated', 'public.contract_documents', 'sha256', 'UPDATE'
  ) then
    raise exception 'DB4_M1_CONTRACT_COLUMN_ACL';
  end if;
end
$schema_contract$;

insert into auth.users (id, email)
values
  ('78888888-8888-4888-8888-888888888888', 'db4-m1-owner@example.invalid'),
  ('79999999-9999-4999-8999-999999999999', 'db4-m1-outsider@example.invalid')
on conflict (id) do nothing;

insert into public.designers (id, name, studio_name)
values
  ('78888888-8888-4888-8888-888888888888', 'DB4 M1 owner', 'DB4 owner studio'),
  ('79999999-9999-4999-8999-999999999999', 'DB4 M1 outsider', 'DB4 outsider studio')
on conflict (id) do nothing;

insert into public.projects (id, designer_id, client_name, status, intake_token)
values
  (
    '78888888-8888-4888-8888-888888888881',
    '78888888-8888-4888-8888-888888888888',
    'DB4 M1 owner project',
    'created',
    'db4-m1-owner-project-token'
  ),
  (
    '79999999-9999-4999-8999-999999999991',
    '79999999-9999-4999-8999-999999999999',
    'DB4 M1 outsider project',
    'created',
    'db4-m1-outsider-project-token'
  )
on conflict (id) do nothing;

insert into public.project_passport_revisions (
  project_id, revision_no, passport, llm_ok
) values (
  '78888888-8888-4888-8888-888888888881',
  1,
  '{"contact":{"name":"DB4 owner client"}}'::jsonb,
  false
);

insert into public.contract_documents (
  id, project_id, storage_path, original_name, sha256, size_bytes, status
) values
  (
    '78888888-8888-4888-8888-888888888882',
    '78888888-8888-4888-8888-888888888881',
    'contract-documents/78888888-8888-4888-8888-888888888881/' || repeat('a', 64),
    'owner-contract.pdf', repeat('a', 64), 2048, 'uploaded'
  ),
  (
    '79999999-9999-4999-8999-999999999992',
    '79999999-9999-4999-8999-999999999991',
    'contract-documents/79999999-9999-4999-8999-999999999991/' || repeat('b', 64),
    'outsider-contract.pdf', repeat('b', 64), 2048, 'uploaded'
  );

-- The server-only passport path remains alive and append-only.
begin;
set local role service_role;
insert into public.project_passport_revisions (
  project_id, revision_no, passport, llm_ok
) values (
  '78888888-8888-4888-8888-888888888881',
  2,
  '{"contact":{"name":"DB4 owner client"},"revision":2}'::jsonb,
  true
);
do $passport_service_role$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.project_passport_revisions
  where project_id = '78888888-8888-4888-8888-888888888881';
  if v_count <> 2 then
    raise exception 'DB4_M1_PASSPORT_SERVICE_READ:%', v_count;
  end if;
  begin
    update public.project_passport_revisions
    set llm_ok = false
    where project_id = '78888888-8888-4888-8888-888888888881'
      and revision_no = 2;
    raise exception 'DB4_M1_PASSPORT_SERVICE_UPDATE_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;
  begin
    delete from public.project_passport_revisions
    where project_id = '78888888-8888-4888-8888-888888888881'
      and revision_no = 2;
    raise exception 'DB4_M1_PASSPORT_SERVICE_DELETE_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;
end
$passport_service_role$;
commit;

-- Authenticated users cannot reach passport revisions at all.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888888';
do $passport_human_denied$
begin
  begin
    perform 1 from public.project_passport_revisions limit 1;
    raise exception 'DB4_M1_PASSPORT_HUMAN_SELECT_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;
  begin
    insert into public.project_passport_revisions (
      project_id, revision_no, passport, llm_ok
    ) values (
      '78888888-8888-4888-8888-888888888881', 3, '{}'::jsonb, false
    );
    raise exception 'DB4_M1_PASSPORT_HUMAN_INSERT_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;
end
$passport_human_denied$;
commit;

-- The owner can see and operate only the owner's contract rows.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888888';
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
    id, project_id, storage_path, original_name, sha256, size_bytes, status
  ) values (
    '78888888-8888-4888-8888-888888888883',
    '78888888-8888-4888-8888-888888888881',
    'contract-documents/78888888-8888-4888-8888-888888888881/' || repeat('c', 64),
    'owner-contract-2.pdf', repeat('c', 64), 4096, 'uploaded'
  );

  update public.contract_documents
  set status = 'received'
  where id = '78888888-8888-4888-8888-888888888883';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'DB4_M1_CONTRACT_OWNER_UPDATE:%', v_rows;
  end if;

  update public.contract_documents
  set status = 'received'
  where id = '79999999-9999-4999-8999-999999999992';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'DB4_M1_CONTRACT_CROSS_TENANT_UPDATE:%', v_rows;
  end if;

  begin
    insert into public.contract_documents (
      project_id, storage_path, original_name, sha256, size_bytes, status
    ) values (
      '79999999-9999-4999-8999-999999999991',
      'contract-documents/79999999-9999-4999-8999-999999999991/' || repeat('d', 64),
      'cross-tenant.pdf', repeat('d', 64), 1024, 'uploaded'
    );
    raise exception 'DB4_M1_CONTRACT_CROSS_TENANT_INSERT_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.contract_documents (
      project_id, storage_path, original_name, sha256, size_bytes, status
    ) values (
      '78888888-8888-4888-8888-888888888881',
      'contract-documents/78888888-8888-4888-8888-888888888881/' || repeat('e', 64),
      'invalid-initial-status.pdf', repeat('e', 64), 1024, 'signed'
    );
    raise exception 'DB4_M1_CONTRACT_NONUPLOADED_INSERT_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.contract_documents
    set sha256 = repeat('f', 64)
    where id = '78888888-8888-4888-8888-888888888882';
    raise exception 'DB4_M1_CONTRACT_METADATA_UPDATE_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from public.contract_documents
    where id = '78888888-8888-4888-8888-888888888882';
    raise exception 'DB4_M1_CONTRACT_DELETE_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;
end
$contract_owner$;
commit;

-- The anonymous Data API role has no table surface.
begin;
set local role anon;
do $anon_denied$
begin
  begin
    perform 1 from public.contract_documents limit 1;
    raise exception 'DB4_M1_CONTRACT_ANON_SELECT_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.project_passport_revisions limit 1;
    raise exception 'DB4_M1_PASSPORT_ANON_SELECT_ACCEPTED';
  exception
    when insufficient_privilege then null;
  end;
end
$anon_denied$;
commit;

select 'DB4_M1_RLS_SECURITY_OK' as result;
