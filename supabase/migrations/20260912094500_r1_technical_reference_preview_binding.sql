begin;
set local search_path = pg_catalog, projectceo_foundation;

-- A technical reference must name the exact preview representation used for a
-- DWG source. PDF sources use their server-hashed asset bytes directly. The
-- transform is part of the immutable coordinate contract, not UI state.
create function projectceo_foundation.is_r1_affine_matrix(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select jsonb_typeof(p_value) = 'object'
    and jsonb_typeof(p_value->'matrix') = 'array'
    and jsonb_array_length(p_value->'matrix') = 6
    and not exists (
      select 1
      from jsonb_array_elements(p_value->'matrix') element(value)
      where jsonb_typeof(element.value) <> 'number'
    )
$function$;

alter table projectceo_foundation.technical_reference_versions
  add column preview_representation_version_id uuid,
  add column view_transform jsonb not null
    check (projectceo_foundation.is_r1_affine_matrix(view_transform));

alter table projectceo_foundation.technical_reference_versions
  add constraint technical_reference_versions_preview_pair_fkey
  foreign key (
    organization_id, project_id, package_id,
    reference_asset_version_id, preview_representation_version_id
  ) references projectceo_foundation.external_representation_versions (
    organization_id, project_id, package_id,
    asset_version_id, representation_version_id
  ) on delete restrict;

create function projectceo_foundation.assert_r1_technical_reference_preview_binding()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_asset_format text;
  v_asset_sha bytea;
  v_representation_sha bytea;
begin
  select asset_version.validated_format, asset_version.server_sha256
    into v_asset_format, v_asset_sha
  from projectceo_foundation.external_asset_versions asset_version
  where asset_version.organization_id = new.organization_id
    and asset_version.project_id = new.project_id
    and asset_version.package_id = new.package_id
    and asset_version.asset_version_id = new.reference_asset_version_id;

  if not found then
    raise exception 'R1_TECHNICAL_REFERENCE_PREVIEW_MISMATCH';
  end if;

  if v_asset_format = 'pdf' then
    if new.preview_representation_version_id is not null
      or new.preview_sha256 is distinct from v_asset_sha then
      raise exception 'R1_TECHNICAL_REFERENCE_PREVIEW_MISMATCH';
    end if;
    return new;
  end if;

  if v_asset_format <> 'dwg' or new.preview_representation_version_id is null then
    raise exception 'R1_TECHNICAL_REFERENCE_PREVIEW_MISMATCH';
  end if;

  select representation.server_sha256 into v_representation_sha
  from projectceo_foundation.external_representation_versions representation
  where representation.organization_id = new.organization_id
    and representation.project_id = new.project_id
    and representation.package_id = new.package_id
    and representation.asset_version_id = new.reference_asset_version_id
    and representation.representation_version_id = new.preview_representation_version_id;

  if not found or new.preview_sha256 is distinct from v_representation_sha then
    raise exception 'R1_TECHNICAL_REFERENCE_PREVIEW_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger technical_reference_versions_preview_binding
before insert on projectceo_foundation.technical_reference_versions
for each row execute function projectceo_foundation.assert_r1_technical_reference_preview_binding();

alter function projectceo_foundation.assert_r1_technical_reference_preview_binding() owner to pi_table_owner;
alter function projectceo_foundation.is_r1_affine_matrix(jsonb) owner to pi_table_owner;
revoke all on function projectceo_foundation.assert_r1_technical_reference_preview_binding()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_foundation.is_r1_affine_matrix(jsonb)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

commit;
