\set ON_ERROR_STOP on

-- DB4-59 / S-MIG #6: request-bound M1 legacy read contract.
do $contract_shape$
declare
  v_oid oid;
  v_proconfig text[];
begin
  select p.oid, p.proconfig
    into v_oid, v_proconfig
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'projectceo_read_api.get_m1_legacy_project_read(uuid)'
  );
  if v_oid is null then raise exception 'DB4_M1_LEGACY_READ_RPC_MISSING'; end if;
  if pg_get_userbyid((select proowner from pg_proc where oid = v_oid)) <> 'pi_table_owner'
     or not (select prosecdef from pg_proc where oid = v_oid)
     or coalesce(array_to_string(v_proconfig, ','), '') !~ '(^|,)search_path=""(,|$)' then
    raise exception 'DB4_M1_LEGACY_READ_RPC_UNSAFE_DEFINER';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'DB4_M1_LEGACY_READ_RPC_AUTHENTICATED_GRANT';
  end if;
  if exists (
    select 1 from unnest(array['public','anon','service_role','pi_human_executor','pi_worker_executor']) r
    where pg_catalog.has_function_privilege(r, v_oid, 'EXECUTE')
  ) then
    raise exception 'DB4_M1_LEGACY_READ_RPC_WRONG_ROLE_GRANT';
  end if;
end
$contract_shape$;

-- The fixture gives the architect the same server-derived view_project
-- capability as the owner; the RPC still performs its explicit role gate.
insert into projectceo_foundation.project_member_capabilities (
  organization_id, project_id, user_id, capability
)
select pm.organization_id, pm.project_id, pm.user_id, capability.capability
from projectceo_foundation.project_memberships pm
cross join lateral projectceo_foundation._role_capabilities('architect') capability
where pm.project_id = '78888888-8888-4888-8888-888888888811'
  and pm.user_id = '78888888-8888-4888-8888-888888888802'
on conflict do nothing;

do $owner_read$
declare v_result jsonb;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888801';
  select projectceo_read_api.get_m1_legacy_project_read(
    '78888888-8888-4888-8888-888888888811'
  ) into v_result;
  if v_result->>'contractVersion' <> 'project-ceo-m1-legacy-read/0.1'
     or v_result#>>'{scope,accessScope}' <> 'project'
     or v_result#>>'{scope,projectId}' <> '78888888-8888-4888-8888-888888888811'
     or (v_result#>>'{data,passportRevision,revisionNo}')::bigint <> 2
     or v_result#>>'{data,passportRevision,llmOk}' <> 'false'
     or v_result#>>'{data,contractDocument,status}' <> 'received'
     or v_result#>>'{data,contractDocument,documentId}' is null
     or (v_result #> '{data,contractDocument}') ? 'storagePath'
     or (v_result #> '{data,contractDocument}') ? 'originalName' then
    raise exception 'DB4_M1_LEGACY_READ_OWNER_CONTENT:%', v_result;
  end if;
end
$owner_read$;

do $architect_read$
declare v_result jsonb;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888802';
  select projectceo_read_api.get_m1_legacy_project_read(
    '78888888-8888-4888-8888-888888888811'
  ) into v_result;
  if v_result#>>'{scope,actorUserId}' <> '78888888-8888-4888-8888-888888888802'
     or v_result#>>'{data,passportRevision,revisionNo}' <> '2' then
    raise exception 'DB4_M1_LEGACY_READ_ARCHITECT_CONTENT:%', v_result;
  end if;
end
$architect_read$;

do $role_denials$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888803';
  begin
    perform projectceo_read_api.get_m1_legacy_project_read(
      '78888888-8888-4888-8888-888888888811'
    );
    raise exception 'DB4_M1_LEGACY_READ_BUILDER_ACCEPTED';
  exception when others then
    if sqlstate not in ('P1103', '42501') then raise; end if;
  end;
  set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888804';
  begin
    perform projectceo_read_api.get_m1_legacy_project_read(
      '78888888-8888-4888-8888-888888888811'
    );
    raise exception 'DB4_M1_LEGACY_READ_CLIENT_ACCEPTED';
  exception when others then
    if sqlstate not in ('P1103', '42501') then raise; end if;
  end;
end
$role_denials$;

do $anon_denial$
begin
  set local role anon;
  begin
    perform projectceo_read_api.get_m1_legacy_project_read(
      '78888888-8888-4888-8888-888888888811'
    );
    raise exception 'DB4_M1_LEGACY_READ_ANON_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end;
$anon_denial$;

select 'DB4_M1_LEGACY_READ_RPC_OK' as result;
