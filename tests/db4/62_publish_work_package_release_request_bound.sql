\set ON_ERROR_STOP on

-- DB4-62 / S-MIG #5. DB4-20 creates the first work-package release through
-- the request-bound door after registering a package-owned materialization.
-- A second release stays behind the M4 reviewed-impact gate.
do $strict_work_package_release$
declare v_version record; v_sources jsonb;
begin
  select * into v_version from projectceo_product.production_package_versions
  where project_id = '41111111-1111-4111-8111-111111111111'
    and production_package_version_id = 'release:db4-publish-work-package-v1';
  if not found or v_version.package_id <> '49999999-9999-4999-8999-999999999999'::uuid
     or v_version.baseline_id <> 'baseline:db4-publish-baseline-v1' then
    raise exception 'DB4_WORK_PACKAGE_REQUEST_BOUND_RELEASE_MISSING';
  end if;
  select coalesce(jsonb_agg(revision_id order by ordinal), '[]'::jsonb) into v_sources
  from projectceo_product.production_package_version_refs
  where project_id=v_version.project_id and production_package_version_id=v_version.production_package_version_id
    and target_kind='source_revision';
  if v_sources <> '["revision-source-1"]'::jsonb or not exists (
    select 1 from projectceo_foundation.source_materializations m
    where m.project_id=v_version.project_id and m.package_id=v_version.package_id
      and m.source_revision_id='revision-source-1'
  ) then raise exception 'DB4_WORK_PACKAGE_SOURCE_SCOPE_NOT_STRICT'; end if;
  if not exists (
    select 1 from projectceo_product.command_records c
    where c.project_id=v_version.project_id and c.operation='publish_work_package_release_request_bound'
      and c.logical_result->>'id'=v_version.production_package_version_id
  ) then raise exception 'DB4_WORK_PACKAGE_REQUEST_BOUND_REPLAY_RECORD_MISSING'; end if;
end
$strict_work_package_release$;
select 'DB4_WORK_PACKAGE_RELEASE_REQUEST_BOUND_OK' as result;
