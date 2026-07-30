\set ON_ERROR_STOP on

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset ap1_duplicate_inventory_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_api.register_source_inventory(
  '41111111-1111-4111-8111-111111111111',
  jsonb_build_array(
    jsonb_build_object(
      'physicalRecordId', '81111111-1111-4111-8111-111111111111',
      'sanitizedName', 'source-duplicate-copy-a.pdf',
      'hierarchy', jsonb_build_object(
        'projectId', '41111111-1111-4111-8111-111111111111',
        'packageId', '41111111-1111-4111-8111-111111111111',
        'floorId', 'floor-second',
        'zoneId', 'zone-food-hall',
        'disciplineId', 'architecture'
      ),
      'availability', 'materialized',
      'documentStatus', 'current',
      'sizeBytes', 1024,
      'checksum', repeat('ab', 32),
      'sourceRevisionId', 'revision-ap1-duplicate-r1',
      'semanticConflict', false
    ),
    jsonb_build_object(
      'physicalRecordId', '81111111-1111-4111-8111-111111111112',
      'sanitizedName', 'source-duplicate-copy-b.pdf',
      'hierarchy', jsonb_build_object(
        'projectId', '41111111-1111-4111-8111-111111111111',
        'packageId', '41111111-1111-4111-8111-111111111111',
        'floorId', 'floor-second',
        'zoneId', 'zone-food-hall',
        'disciplineId', 'architecture'
      ),
      'availability', 'materialized',
      'documentStatus', 'current',
      'sizeBytes', 1024,
      'checksum', repeat('ab', 32),
      'sourceRevisionId', 'revision-ap1-duplicate-r1',
      'semanticConflict', false
    )
  ),
  jsonb_build_object(
    'projectId', '41111111-1111-4111-8111-111111111111'
  ),
  :'ap1_duplicate_inventory_state_revision'::bigint,
  'ap1-inventory-duplicate-group'
) as response
\gset ap1_duplicate_inventory_
commit;

select set_config(
  'projectceo.ap1_duplicate_inventory_response',
  :'ap1_duplicate_inventory_response',
  false
);

do $ap1_inventory_duplicate_groups$
declare
  v_response jsonb := current_setting(
    'projectceo.ap1_duplicate_inventory_response'
  )::jsonb;
  v_inventory_count bigint;
  v_materialization_count bigint;
  v_reference_count bigint;
  v_mutation_rejected boolean := false;
begin
  if (v_response #>> '{result,registeredPhysicalRecords}')::bigint <> 2 then
    raise exception 'AP1_DUPLICATE_INVENTORY_REGISTRATION_FAILED';
  end if;

  select count(*) into v_inventory_count
  from projectceo_foundation.source_inventory_records inventory
  where inventory.project_id =
        '41111111-1111-4111-8111-111111111111'::uuid
    and inventory.source_revision_id = 'revision-ap1-duplicate-r1';
  if v_inventory_count <> 2 then
    raise exception 'AP1_DUPLICATE_PHYSICAL_RECORDS_NOT_PRESERVED';
  end if;

  select count(*) into v_materialization_count
  from projectceo_foundation.source_materializations materialization
  where materialization.project_id =
        '41111111-1111-4111-8111-111111111111'::uuid
    and materialization.source_revision_id = 'revision-ap1-duplicate-r1';
  if v_materialization_count <> 1 then
    raise exception 'AP1_LOGICAL_MATERIALIZATION_NOT_DEDUPLICATED';
  end if;

  select count(*) into v_reference_count
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conname in (
      'm4_photo_inventory_fkey',
      'm4_handover_docs_inventory_fkey'
    )
    and constraint_row.confrelid =
        'projectceo_foundation.source_materializations'::regclass;
  if v_reference_count <> 2 then
    raise exception 'AP1_M4_MATERIALIZATION_REFERENCE_INVALID';
  end if;

  begin
    update projectceo_foundation.source_materializations
    set registered_at = registered_at
    where source_revision_id = 'revision-ap1-duplicate-r1';
  exception
    when sqlstate '55000' then
      v_mutation_rejected := true;
  end;
  if not v_mutation_rejected then
    raise exception 'AP1_MATERIALIZATION_APPEND_ONLY_MISSING';
  end if;
end
$ap1_inventory_duplicate_groups$;

select 'AP1_INVENTORY_DUPLICATE_GROUPS_OK' as result;
