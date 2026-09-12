\set ON_ERROR_STOP on

begin;

do $r1_attestation_private_acl$
declare
  v_function oid := 'projectceo_foundation.assert_external_attestation_pair()'::regprocedure;
  v_role text;
begin
  -- Check effective privileges, including PUBLIC inheritance and explicit
  -- runtime grants. Table RLS alone does not close a private routine's ACL.
  foreach v_role in array array[
    'anon', 'authenticated', 'service_role', 'pi_human_executor', 'pi_worker_executor'
  ] loop
    if has_function_privilege(v_role, v_function, 'EXECUTE') then
      raise exception 'DB4_R1_ATTESTATION_RUNTIME_EXECUTE: %', v_role;
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc p
    where p.oid = v_function
      and pg_get_userbyid(p.proowner) = 'pi_table_owner'
      and not p.prosecdef
      and p.proconfig = array['search_path=""']::text[]
  ) then
    raise exception 'DB4_R1_ATTESTATION_FUNCTION_BOUNDARY_CHANGED';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'projectceo_foundation.external_representation_attestations'::regclass
      and t.tgname = 'external_representation_attestations_pair'
      and t.tgfoid = v_function
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'DB4_R1_ATTESTATION_TRIGGER_NOT_BOUND';
  end if;
end
$r1_attestation_private_acl$;

-- The private table owner must still execute the bound trigger successfully
-- and reject a mismatched pair after all runtime execution grants are revoked.
set local role pi_table_owner;

do $r1_asset_identity_contract$
declare
  v_organization_id uuid;
  v_project_id uuid := '41111111-1111-4111-8111-111111111111';
  v_package_id uuid := '41111111-1111-4111-8111-111111111111';
  v_owner_id uuid := '31111111-1111-4111-8111-111111111111';
  v_outsider_id uuid := '33333333-3333-4333-8333-333333333333';
  v_asset_id uuid := 'a1111111-1111-4111-8111-111111111111';
  v_asset_version_id uuid := 'a2222222-2222-4222-8222-222222222222';
  v_representation_version_id uuid := 'a3333333-3333-4333-8333-333333333333';
  v_checked integer;
  v_table text;
begin
  select organization_id into v_organization_id
  from project_intelligence.project_workflows
  where project_id = v_project_id;

  if v_organization_id is null then
    raise exception 'DB4_R1_FIXTURE_ORGANIZATION_MISSING';
  end if;

  insert into projectceo_foundation.external_assets (
    organization_id, project_id, package_id, asset_id, source_kind, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_id, 'dwg', v_owner_id
  );

  insert into projectceo_foundation.external_asset_versions (
    organization_id, project_id, package_id, asset_id, asset_version_id, revision_no,
    server_sha256, byte_length, validated_format, private_storage_locator,
    origin_intake_generation, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_id, v_asset_version_id, 1,
    decode(repeat('a', 64), 'hex'), 1024, 'dwg', 'r1/private/source/a222',
    'intake-generation-1', v_owner_id
  );

  insert into projectceo_foundation.external_representation_versions (
    organization_id, project_id, package_id, asset_version_id, representation_version_id,
    server_sha256, byte_length, validated_format, private_storage_locator,
    producer_kind, producer_version, units, axes, transform, manifest_schema_version,
    provenance, resource_manifest, created_by_user_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_version_id, v_representation_version_id,
    decode(repeat('b', 64), 'hex'), 2048, 'svg', 'r1/private/representation/a333',
    'contract-fixture', '1', 'mm', 'z-up', '{}'::jsonb, 'r1/0.1',
    '{}'::jsonb, '{}'::jsonb, v_owner_id
  );

  insert into projectceo_foundation.external_representation_attestations (
    organization_id, project_id, package_id, asset_version_id, representation_version_id,
    source_sha256, representation_sha256, confirmed_units, confirmed_axes,
    architect_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_version_id, v_representation_version_id,
    decode(repeat('a', 64), 'hex'), decode(repeat('b', 64), 'hex'), 'mm', 'z-up',
    v_owner_id, 'db4-r1-attestation', 'db4-r1-request'
  );

  begin
    insert into projectceo_foundation.external_representation_attestations (
      organization_id, project_id, package_id, asset_version_id, representation_version_id,
      source_sha256, representation_sha256, confirmed_units, confirmed_axes,
      architect_user_id, causation_id, request_id
    ) values (
      v_organization_id, v_project_id, v_package_id, v_asset_version_id, v_representation_version_id,
      decode(repeat('c', 64), 'hex'), decode(repeat('b', 64), 'hex'), 'mm', 'z-up',
      v_owner_id, 'db4-r1-attestation-mismatch', 'db4-r1-request-mismatch'
    );
    raise exception 'DB4_R1_ATTESTATION_MISMATCH_ALLOWED';
  exception when others then
    if sqlerrm not like '%R1_ATTESTATION_PAIR_MISMATCH%' then raise; end if;
  end;

  insert into projectceo_foundation.external_asset_events (
    organization_id, project_id, package_id, asset_id, sequence_no, event_type,
    actor_type, actor_id, actor_user_id, causation_id, request_id
  ) values (
    v_organization_id, v_project_id, v_package_id, v_asset_id, 1, 'registered',
    'human', v_owner_id::text, v_owner_id, 'db4-r1-event', 'db4-r1-event-request'
  );

  begin
    insert into projectceo_foundation.external_asset_events (
      organization_id, project_id, package_id, asset_id, sequence_no, event_type,
      actor_type, actor_id, actor_user_id, causation_id, request_id
    ) values (
      v_organization_id, v_project_id, v_package_id, v_asset_id, 2, 'invalid-human',
      'human', 'missing-user', null, 'db4-r1-event', 'db4-r1-event-missing-user'
    );
    raise exception 'DB4_R1_HUMAN_ACTOR_SHAPE_ALLOWED';
  exception when check_violation then null;
  end;

  begin
    insert into projectceo_foundation.external_asset_events (
      organization_id, project_id, package_id, asset_id, sequence_no, event_type,
      actor_type, actor_id, actor_user_id, causation_id, request_id
    ) values (
      v_organization_id, v_project_id, v_package_id, v_asset_id, 3, 'invalid-member',
      'human', v_outsider_id::text, v_outsider_id, 'db4-r1-event', 'db4-r1-event-outsider'
    );
    raise exception 'DB4_R1_CROSS_ORGANIZATION_ACTOR_ALLOWED';
  exception when foreign_key_violation then null;
  end;

  begin
    update projectceo_foundation.external_assets
    set source_kind = 'pdf'
    where organization_id = v_organization_id
      and project_id = v_project_id
      and package_id = v_package_id
      and asset_id = v_asset_id;
    raise exception 'DB4_R1_APPEND_ONLY_UPDATE_ALLOWED';
  exception when sqlstate '55000' then null;
  end;

  select count(*) into v_checked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'projectceo_foundation'
    and c.relname in (
      'external_assets', 'external_asset_versions', 'external_representation_versions',
      'external_representation_attestations', 'external_asset_events'
    )
    and c.relrowsecurity
    and c.relforcerowsecurity;
  if v_checked <> 5 then raise exception 'DB4_R1_RLS_FORCE_MISSING'; end if;

  foreach v_table in array array[
    'external_assets', 'external_asset_versions', 'external_representation_versions',
    'external_representation_attestations', 'external_asset_events'
  ] loop
    if has_table_privilege('authenticated', format('projectceo_foundation.%I', v_table), 'select')
      or has_table_privilege('authenticated', format('projectceo_foundation.%I', v_table), 'insert')
      or has_table_privilege('authenticated', format('projectceo_foundation.%I', v_table), 'update')
      or has_table_privilege('authenticated', format('projectceo_foundation.%I', v_table), 'delete') then
      raise exception 'DB4_R1_AUTHENTICATED_TABLE_ACCESS: %', v_table;
    end if;
  end loop;
end
$r1_asset_identity_contract$;

select 'DB4_R1_ASSET_IDENTITY_VERSIONS_OK' as result;

rollback;
