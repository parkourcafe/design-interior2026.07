-- Persist exact, immutable published LayoutDocument versions for the M2 workspace.

begin;

alter table projectceo_product.m2_workspace_revisions
  drop constraint m2_workspace_revisions_entity_kind_check;
alter table projectceo_product.m2_workspace_revisions
  add constraint m2_workspace_revisions_entity_kind_check
  check (entity_kind in (
    'room', 'variant', 'material', 'budget', 'client_handoff',
    'approved_commit', 'layout_version'
  ));

alter table projectceo_product.m2_workspace_revisions
  drop constraint if exists m2_workspace_revisions_status_check;
alter table projectceo_product.m2_workspace_revisions
  add constraint m2_workspace_revisions_status_check
  check (status in ('draft', 'submitted', 'approved', 'ready', 'rejected', 'published'));

create unique index m2_workspace_layout_version_id_scope_uniq
  on projectceo_product.m2_workspace_revisions (
    organization_id, project_id, package_id, ((payload->>'versionId'))
  )
  where entity_kind = 'layout_version';

alter table projectceo_product.command_records
  drop constraint command_records_operation_check;
alter table projectceo_product.command_records
  add constraint command_records_operation_check
  check (operation in (
    'append_decision_revision', 'append_selection_revision',
    'append_system_decision_revision', 'append_system_selection_revision',
    'append_price_observation', 'create_approval_package',
    'submit_approval_package', 'review_approval_package',
    'publish_project_baseline', 'publish_production_package_version',
    'build_release_artifact', 'distribute_release', 'acknowledge_release',
    'distribute_release_request_bound', 'acknowledge_release_request_bound',
    'approve_no_change', 'submit_change_request', 'calculate_change_impact',
    'review_change_impact', 'define_milestone', 'register_photo_evidence',
    'review_photo_evidence', 'accept_milestone', 'register_handover_document',
    'build_construction_handover', 'append_m2_room_revision',
    'append_m2_variant_revision', 'append_m2_material_revision',
    'append_m2_budget_revision', 'append_m2_client_handoff_revision',
    'append_m2_approved_commit_revision', 'append_m2_layout_version_revision'
  ));

alter table projectceo_product.audit_events
  drop constraint audit_events_event_type_check;
alter table projectceo_product.audit_events
  add constraint audit_events_event_type_check
  check (event_type in (
    'decision_revision_appended', 'selection_revision_appended',
    'price_observation_appended', 'approval_package_created',
    'approval_package_submitted', 'approval_package_reviewed',
    'project_baseline_published', 'production_package_version_published',
    'release_artifact_built', 'release_distributed', 'release_acknowledged',
    'no_change_approved', 'change_request_submitted', 'change_impact_calculated',
    'change_impact_reviewed', 'milestone_defined', 'photo_evidence_registered',
    'photo_evidence_reviewed', 'milestone_accepted',
    'handover_document_registered', 'construction_handover_built',
    'm2_room_revision_appended', 'm2_variant_revision_appended',
    'm2_material_revision_appended', 'm2_budget_revision_appended',
    'm2_client_handoff_revision_appended',
    'm2_approved_commit_revision_appended',
    'm2_layout_version_revision_appended'
  ));

-- Recursively remove the same ephemeral fields as Layout Studio. Entity arrays
-- are sorted separately by id; all other arrays preserve contract order.
create or replace function projectceo_product._m2_layout_canonical_value(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if jsonb_typeof(value) = 'object' then
    select coalesce(jsonb_object_agg(member.key,
      projectceo_product._m2_layout_canonical_value(member.value)
      order by member.key collate "C"), '{}'::jsonb)
      into v_result
    from jsonb_each(value) member
    where member.key not in ('stateRevision', 'updatedAt', 'selection', 'session');
    return v_result;
  elsif jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(
      projectceo_product._m2_layout_canonical_value(element.value)
      order by element.ordinality), '[]'::jsonb)
      into v_result
    from jsonb_array_elements(value) with ordinality element(value, ordinality);
    return v_result;
  end if;
  return value;
end
$function$;

create or replace function projectceo_product._m2_layout_semantic_hash(layout_content jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_normalized jsonb := layout_content;
  v_collection text;
  v_sorted jsonb;
begin
  foreach v_collection in array array[
    'nodes', 'walls', 'openings', 'columns', 'objects', 'clearanceZones',
    'materials', 'materialAssignments', 'lights'
  ]::text[] loop
    select coalesce(jsonb_agg(element.value order by element.value->>'id' collate "C"), '[]'::jsonb)
      into v_sorted
    from jsonb_array_elements(v_normalized->v_collection) element(value);
    v_normalized := jsonb_set(v_normalized, array[v_collection], v_sorted, false);
  end loop;
  v_normalized := projectceo_product._m2_layout_canonical_value(v_normalized);
  return 'sha256:' || encode(
    extensions.digest(
      convert_to(project_intelligence._canonical_jsonb(v_normalized), 'utf8'),
      'sha256'
    ),
    'hex'
  );
end
$function$;

-- Small, fail-closed predicates used by the authoritative LayoutDocument
-- validator.  Keeping these in SQL makes the database trust boundary match
-- Layout Studio rather than trusting the TypeScript command envelope.
create or replace function projectceo_product._m2_json_exact_keys(
  value jsonb, required_keys text[], optional_keys text[] default '{}'::text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select jsonb_typeof(value) = 'object'
    and not exists (
      select 1 from unnest(required_keys) required_key
      where not value ? required_key
    )
    and not exists (
      select 1 from jsonb_object_keys(value) actual_key
      where not (actual_key = any(required_keys || optional_keys))
    )
$function$;

create or replace function projectceo_product._m2_require_nonempty_string(value jsonb)
returns boolean language sql immutable set search_path = ''
as $function$
  select jsonb_typeof(value) = 'string' and length(value #>> '{}') > 0
$function$;

create or replace function projectceo_product._m2_require_boolean(value jsonb)
returns boolean language sql immutable set search_path = ''
as $function$ select jsonb_typeof(value) = 'boolean' $function$;

create or replace function projectceo_product._m2_require_finite_number(value jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $function$
declare v_number numeric;
begin
  if jsonb_typeof(value) <> 'number' then return false; end if;
  begin v_number := (value #>> '{}')::numeric;
  exception when others then return false; end;
  return v_number not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and abs(v_number) <= 9007199254740991; -- finite safe_integer
end
$function$;

create or replace function projectceo_product._m2_layout_json_depth(
  value jsonb, current_depth integer default 1
)
returns integer
language plpgsql
immutable
set search_path = ''
as $function$
declare v_child jsonb; v_depth integer := current_depth; v_child_depth integer;
begin
  if current_depth > 24 then return current_depth; end if;
  if jsonb_typeof(value) = 'array' then
    for v_child in select item from jsonb_array_elements(value) item loop
      v_child_depth := projectceo_product._m2_layout_json_depth(v_child, current_depth + 1);
      v_depth := greatest(v_depth, v_child_depth);
    end loop;
  elsif jsonb_typeof(value) = 'object' then
    for v_child in select member.value from jsonb_each(value) member loop
      v_child_depth := projectceo_product._m2_layout_json_depth(v_child, current_depth + 1);
      v_depth := greatest(v_depth, v_child_depth);
    end loop;
  end if;
  return v_depth;
end
$function$;

create or replace function projectceo_product._m2_validate_layout_document(layout_content jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_collection text;
  v_entity jsonb;
  v_required text[];
  v_optional text[];
  v_ids text[] := '{}'::text[];
  v_node_ids text[] := '{}'::text[];
  v_wall_ids text[] := '{}'::text[];
  v_target_ids text[] := '{}'::text[];
  v_material_ids text[] := '{}'::text[];
  v_wall jsonb;
  v_start jsonb;
  v_finish jsonb;
  v_wall_length numeric;
  v_key text;
begin
  -- Exact-shape manifest. Every row is enforced below through
  -- _m2_json_exact_keys; spelling it out here keeps DB/TS parity auditable.
  -- root: jsonb_object_keys(layout_content) array['canonicalUnits','clearanceZones','columns','contractVersion','documentId','floor','lights','materialAssignments','materials','metadata','name','nodes','objects','openings','projectId','stateRevision','variant','walls']
  -- floor jsonb_object_keys array['clearHeightMm','elevationMm','id','label']
  -- variant jsonb_object_keys array['id','label','status']
  -- metadata jsonb_object_keys array['sourceRefs','warnings']
  -- nodes jsonb_object_keys array['id','locked','xMm','yMm']
  -- walls jsonb_object_keys array['endNodeId','heightMm','id','kind','label','locked','startNodeId','thicknessMm']
  -- openings jsonb_object_keys array['handing','heightMm','id','kind','label','locked','offsetMm','parentWallId','sillMm','widthMm']
  -- columns jsonb_object_keys array['baseZMm','depthMm','heightMm','id','label','locked','rotationDeg','widthMm','xMm','yMm']
  -- objects jsonb_object_keys array['depthMm','heightMm','id','kind','label','locked','rotationDeg','widthMm','xMm','yMm','zMm']
  -- clearanceZones jsonb_object_keys array['depthMm','heightMm','id','kind','label','locked','rotationDeg','targetId','widthMm','xMm','yMm','zMm']
  -- materials jsonb_object_keys array['baseColor','emissive','emissiveIntensity','id','labelRu','metalness','provenance','roughness']
  -- Both baseColor and emissive use exact #a0b1c2 / #RRGGBB values.
  -- materialAssignments jsonb_object_keys array['id','materialId','surfaceRole','targetId']
  -- lights jsonb_object_keys array['color','decay','distanceMm','groundColor','id','intensity','kind','label','targetId','xMm','yMm','zMm']
  if not projectceo_product._m2_json_exact_keys(layout_content, array[
    'canonicalUnits', 'clearanceZones', 'columns', 'contractVersion',
    'documentId', 'floor', 'lights', 'materialAssignments', 'materials',
    'metadata', 'name', 'nodes', 'objects', 'openings', 'projectId',
    'stateRevision', 'variant', 'walls'
  ]) then return false; end if;

  if not projectceo_product._m2_json_exact_keys(layout_content->'floor',
       array['clearHeightMm', 'elevationMm', 'id', 'label'])
     or not projectceo_product._m2_json_exact_keys(layout_content->'variant',
       array['id', 'label', 'status'])
     or not projectceo_product._m2_json_exact_keys(layout_content->'metadata',
       array['sourceRefs', 'warnings'])
  then return false; end if;

  if layout_content->>'contractVersion' is distinct from 'archidom.layout-document/0.1'
     or layout_content->>'canonicalUnits' is distinct from 'mm'
     or not projectceo_product._m2_require_nonempty_string(layout_content->'documentId')
     or not projectceo_product._m2_require_nonempty_string(layout_content->'projectId')
     or not projectceo_product._m2_require_nonempty_string(layout_content->'name')
     or not projectceo_product._m2_require_nonempty_string(layout_content#>'{floor,id}')
     or not projectceo_product._m2_require_nonempty_string(layout_content#>'{floor,label}')
     or not projectceo_product._m2_require_nonempty_string(layout_content#>'{variant,id}')
     or not projectceo_product._m2_require_nonempty_string(layout_content#>'{variant,label}')
     or not projectceo_product._m2_require_nonempty_string(layout_content#>'{variant,status}')
     or not projectceo_product._m2_require_finite_number(layout_content->'stateRevision')
     or (layout_content->>'stateRevision')::numeric <> trunc((layout_content->>'stateRevision')::numeric)
     or (layout_content->>'stateRevision')::numeric < 0
     or (layout_content->>'stateRevision')::numeric > 9007199254740991
     or not projectceo_product._m2_require_finite_number(layout_content#>'{floor,elevationMm}')
     or not projectceo_product._m2_require_finite_number(layout_content#>'{floor,clearHeightMm}')
     or (layout_content#>>'{floor,elevationMm}')::numeric <> trunc((layout_content#>>'{floor,elevationMm}')::numeric)
     or (layout_content#>>'{floor,clearHeightMm}')::numeric <> trunc((layout_content#>>'{floor,clearHeightMm}')::numeric)
     or jsonb_typeof(layout_content#>'{metadata,sourceRefs}') <> 'array'
     or jsonb_typeof(layout_content#>'{metadata,warnings}') <> 'array'
     or exists (select 1 from jsonb_array_elements(layout_content#>'{metadata,sourceRefs}') x where jsonb_typeof(x) <> 'string')
     or exists (select 1 from jsonb_array_elements(layout_content#>'{metadata,warnings}') x where jsonb_typeof(x) <> 'string')
  then return false; end if;

  v_ids := array[layout_content#>>'{floor,id}', layout_content#>>'{variant,id}'];
  foreach v_collection in array array[
    'nodes', 'walls', 'openings', 'columns', 'objects', 'clearanceZones',
    'materials', 'materialAssignments', 'lights'
  ]::text[] loop
    if jsonb_typeof(layout_content->v_collection) <> 'array' then return false; end if;
    case v_collection
      when 'nodes' then v_required := array['id','locked','xMm','yMm']; v_optional := '{}';
      when 'walls' then v_required := array['endNodeId','heightMm','id','kind','locked','startNodeId','thicknessMm']; v_optional := array['label'];
      when 'openings' then v_required := array['heightMm','id','kind','locked','offsetMm','parentWallId','sillMm','widthMm']; v_optional := array['handing','label'];
      when 'columns' then v_required := array['baseZMm','depthMm','heightMm','id','locked','rotationDeg','widthMm','xMm','yMm']; v_optional := array['label'];
      when 'objects' then v_required := array['depthMm','heightMm','id','kind','locked','rotationDeg','widthMm','xMm','yMm','zMm']; v_optional := array['label'];
      when 'clearanceZones' then v_required := array['id']; v_optional := array['depthMm','heightMm','kind','label','locked','rotationDeg','targetId','widthMm','xMm','yMm','zMm'];
      when 'materials' then v_required := array['baseColor','emissive','emissiveIntensity','id','labelRu','metalness','provenance','roughness']; v_optional := '{}';
      when 'materialAssignments' then v_required := array['id','materialId','surfaceRole','targetId']; v_optional := '{}';
      when 'lights' then v_required := array['color','id','intensity','kind','label','xMm','yMm','zMm']; v_optional := array['decay','distanceMm','groundColor','targetId'];
    end case;
    for v_entity in select item from jsonb_array_elements(layout_content->v_collection) item loop
      if not projectceo_product._m2_json_exact_keys(v_entity, v_required, v_optional)
         or not projectceo_product._m2_require_nonempty_string(v_entity->'id')
         or (v_entity->>'id') = any(v_ids)
      then return false; end if;
      v_ids := array_append(v_ids, v_entity->>'id'); -- duplicate_stable_id / global unique id

      for v_key in select key from jsonb_object_keys(v_entity) key loop
        if v_key ~ '(Mm|Mm2)$' then
          if not projectceo_product._m2_require_finite_number(v_entity->v_key)
             or (v_entity->>v_key)::numeric <> trunc((v_entity->>v_key)::numeric)
          then return false; end if; -- integer Mm / Mm2
        end if;
      end loop;
      if v_entity ? 'locked' and not projectceo_product._m2_require_boolean(v_entity->'locked') then return false; end if;
      if v_collection = 'walls' and (
        not projectceo_product._m2_require_nonempty_string(v_entity->'startNodeId')
        or not projectceo_product._m2_require_nonempty_string(v_entity->'endNodeId')
        or not projectceo_product._m2_require_nonempty_string(v_entity->'kind')
      ) then return false; end if;
      if v_collection = 'openings' and (
        not projectceo_product._m2_require_nonempty_string(v_entity->'parentWallId')
        or not projectceo_product._m2_require_nonempty_string(v_entity->'kind')
      ) then return false; end if;
      if v_collection in ('columns','objects') and
         not projectceo_product._m2_require_finite_number(v_entity->'rotationDeg')
      then return false; end if;
      if v_collection = 'objects' and
         not projectceo_product._m2_require_nonempty_string(v_entity->'kind')
      then return false; end if;
      if v_collection = 'nodes' then v_node_ids := array_append(v_node_ids, v_entity->>'id'); end if;
      if v_collection = 'walls' then v_wall_ids := array_append(v_wall_ids, v_entity->>'id'); end if;
      if v_collection = 'materials' then v_material_ids := array_append(v_material_ids, v_entity->>'id'); end if;
      if v_collection in ('walls','openings','columns','objects','clearanceZones') then
        v_target_ids := array_append(v_target_ids, v_entity->>'id');
      end if;

      if v_collection = 'materials' and (
        not projectceo_product._m2_require_nonempty_string(v_entity->'labelRu')
        or not projectceo_product._m2_require_nonempty_string(v_entity->'provenance')
        or (v_entity->>'baseColor') !~ '^#[0-9a-fA-F]{6}$'
        or (v_entity->>'emissive') !~ '^#[0-9a-fA-F]{6}$'
        or not projectceo_product._m2_require_finite_number(v_entity->'roughness')
        or not ((v_entity->>'roughness')::numeric between 0 and 1)
        or not projectceo_product._m2_require_finite_number(v_entity->'metalness')
        or not ((v_entity->>'metalness')::numeric between 0 and 1)
        or not projectceo_product._m2_require_finite_number(v_entity->'emissiveIntensity')
        or not ((v_entity->>'emissiveIntensity')::numeric between 0 and 100)
      ) then return false; end if;
      if v_collection = 'lights' and (
        v_entity->>'kind' not in ('ambient','directional','hemisphere','point')
        or not projectceo_product._m2_require_nonempty_string(v_entity->'label')
        or (v_entity->>'color') !~ '^#[0-9a-fA-F]{6}$'
        or not projectceo_product._m2_require_finite_number(v_entity->'intensity')
        or (v_entity->>'intensity')::numeric not between 0 and 100000
        or (v_entity ? 'groundColor' and (v_entity->>'groundColor') !~ '^#[0-9a-fA-F]{6}$')
        or (v_entity ? 'targetId' and not projectceo_product._m2_require_nonempty_string(v_entity->'targetId'))
        or (v_entity ? 'decay' and not projectceo_product._m2_require_finite_number(v_entity->'decay'))
      ) then return false; end if;
      if v_collection = 'materialAssignments' and (
        not projectceo_product._m2_require_nonempty_string(v_entity->'materialId')
        or not projectceo_product._m2_require_nonempty_string(v_entity->'surfaceRole')
        or not projectceo_product._m2_require_nonempty_string(v_entity->'targetId')
      ) then return false; end if;
    end loop;
  end loop;

  v_target_ids := array_prepend(layout_content#>>'{floor,id}', v_target_ids);
  for v_entity in select item from jsonb_array_elements(layout_content->'walls') item loop
    if not ((v_entity->>'startNodeId') = any(v_node_ids))
       or not ((v_entity->>'endNodeId') = any(v_node_ids))
       or (v_entity->>'thicknessMm')::numeric <= 0
       or (v_entity->>'heightMm')::numeric <= 0
    then return false; end if; -- missing_node / node_ids
  end loop;
  for v_entity in select item from jsonb_array_elements(layout_content->'openings') item loop
    if not ((v_entity->>'parentWallId') = any(v_wall_ids)) then return false; end if; -- missing_opening_parent / wall_ids
    select wall into v_wall from jsonb_array_elements(layout_content->'walls') wall
      where wall->>'id' = v_entity->>'parentWallId';
    select node into v_start from jsonb_array_elements(layout_content->'nodes') node
      where node->>'id' = v_wall->>'startNodeId';
    select node into v_finish from jsonb_array_elements(layout_content->'nodes') node
      where node->>'id' = v_wall->>'endNodeId';
    v_wall_length := sqrt(power((v_finish->>'xMm')::numeric-(v_start->>'xMm')::numeric,2)
      + power((v_finish->>'yMm')::numeric-(v_start->>'yMm')::numeric,2));
    if (v_entity->>'offsetMm')::numeric < 0 or (v_entity->>'widthMm')::numeric <= 0
       or (v_entity->>'offsetMm')::numeric + (v_entity->>'widthMm')::numeric > v_wall_length
    then return false; end if; -- opening_outside_wall / wall_length
  end loop;
  for v_entity in select item from jsonb_array_elements(layout_content->'materialAssignments') item loop
    if not ((v_entity->>'materialId') = any(v_material_ids)) then return false; end if; -- missing_assigned_material / material_ids
    if not ((v_entity->>'targetId') = any(v_target_ids)) then return false; end if; -- missing_assignment_target / target_ids
  end loop;
  for v_entity in select item from jsonb_array_elements(layout_content->'lights') item loop
    if v_entity ? 'targetId' and not ((v_entity->>'targetId') = any(v_target_ids)) then return false; end if; -- missing_light_target / target_ids
  end loop;
  return true;
exception when others then
  return false;
end
$function$;

create or replace function projectceo_product._m2_layout_json_safe(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_child jsonb;
  v_number numeric;
begin
  if jsonb_typeof(value) = 'number' then
    begin
      v_number := (value#>>'{}')::numeric;
      -- PostgreSQL numeric accepts NaN/Infinity even though JSON does not.
      return v_number not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and abs(v_number) <= 9007199254740991; -- JavaScript safe_integer bound
    exception when others then
      return false;
    end;
  elsif jsonb_typeof(value) = 'string'
    and value#>>'{}' in ('NaN', 'Infinity', '-Infinity') then
    return false;
  elsif jsonb_typeof(value) = 'array' then
    for v_child in select item from jsonb_array_elements(value) item loop
      if not projectceo_product._m2_layout_json_safe(v_child) then return false; end if;
    end loop;
  elsif jsonb_typeof(value) = 'object' then
    for v_child in select member.value from jsonb_each(value) member loop
      if not projectceo_product._m2_layout_json_safe(v_child) then return false; end if;
    end loop;
  end if;
  return true;
end
$function$;

alter function projectceo_product._m2_layout_canonical_value(jsonb) owner to pi_table_owner;
alter function projectceo_product._m2_layout_semantic_hash(jsonb) owner to pi_table_owner;
alter function projectceo_product._m2_layout_json_safe(jsonb) owner to pi_table_owner;
alter function projectceo_product._m2_json_exact_keys(jsonb, text[], text[]) owner to pi_table_owner;
alter function projectceo_product._m2_require_nonempty_string(jsonb) owner to pi_table_owner;
alter function projectceo_product._m2_require_boolean(jsonb) owner to pi_table_owner;
alter function projectceo_product._m2_require_finite_number(jsonb) owner to pi_table_owner;
alter function projectceo_product._m2_layout_json_depth(jsonb, integer) owner to pi_table_owner;
alter function projectceo_product._m2_validate_layout_document(jsonb) owner to pi_table_owner;
revoke all on function projectceo_product._m2_layout_canonical_value(jsonb) from public;
revoke all on function projectceo_product._m2_layout_semantic_hash(jsonb) from public;
revoke all on function projectceo_product._m2_layout_json_safe(jsonb) from public;
revoke all on function projectceo_product._m2_json_exact_keys(jsonb, text[], text[]) from public;
revoke all on function projectceo_product._m2_require_nonempty_string(jsonb) from public;
revoke all on function projectceo_product._m2_require_boolean(jsonb) from public;
revoke all on function projectceo_product._m2_require_finite_number(jsonb) from public;
revoke all on function projectceo_product._m2_layout_json_depth(jsonb, integer) from public;
revoke all on function projectceo_product._m2_validate_layout_document(jsonb) from public;

-- Preserve the complete v4 implementation for every pre-existing entity kind;
-- the public wrapper below owns only the new layout branch and its extra commit
-- lineage invariant. Rewriting the captured definition avoids duplicating the
-- established approved-commit provenance checks.
do $block$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'projectceo_product_api.append_m2_workspace_revision(uuid,uuid,text,text,text,text,text,jsonb,text,bigint,text)'::regprocedure
  ) into v_definition;
  v_definition := replace(
    v_definition,
    'projectceo_product_api.append_m2_workspace_revision',
    'projectceo_product_api._append_m2_workspace_revision_v4'
  );
  v_definition := replace(
    v_definition,
    'append_m2_workspace_revision.entity_kind',
    '_append_m2_workspace_revision_v4.entity_kind'
  );
  v_definition := replace(
    v_definition,
    'append_m2_workspace_revision.entity_id',
    '_append_m2_workspace_revision_v4.entity_id'
  );
  execute v_definition;
end
$block$;

alter function projectceo_product_api._append_m2_workspace_revision_v4(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) owner to pi_table_owner;
revoke all on function projectceo_product_api._append_m2_workspace_revision_v4(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) from public, anon, authenticated, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_product_api._append_m2_workspace_revision_v4(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) to pi_table_owner;

create or replace function projectceo_product_api.append_m2_workspace_revision(
  project_id uuid,
  package_id uuid,
  entity_kind text,
  entity_id text,
  revision_id text,
  expected_revision_id text,
  status text,
  payload jsonb,
  reason text,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_current record;
  v_revision_no bigint;
  v_result jsonb;
  v_payload_keys text[];
  v_layout_keys text[];
  v_layout_revision record;
  v_json_depth integer;
  v_json_value_count bigint;
  v_entity_count bigint;
  v_reused_version_id text;
begin
  if entity_kind <> 'layout_version' then
    if entity_kind = 'approved_commit' then
      select * into v_layout_revision
      from projectceo_product.m2_workspace_revisions layout_revision
      where layout_revision.organization_id = (
          select context.organization_id
          from projectceo_foundation._authorize_package_human(
            project_id, package_id, 'review_selection'
          ) context
        )
        and layout_revision.project_id = append_m2_workspace_revision.project_id
        and layout_revision.entity_kind = 'layout_version'
        and layout_revision.entity_id = payload #>> '{chosenVariant,layoutDocumentId}'
        and layout_revision.payload->>'versionId' = payload #>> '{chosenVariant,layoutVersionId}'
        and layout_revision.payload->>'semanticHash' = payload #>> '{chosenVariant,semanticHash}'
        and layout_revision.payload->>'variantId' = payload #>> '{chosenVariant,variantId}'
        and layout_revision.payload->>'roomId' = payload->>'roomId'
        and layout_revision.payload->>'role' = payload #>> '{chosenVariant,role}'
        and layout_revision.status = 'published'
        and layout_revision.package_id = package_id
      order by layout_revision.revision_no desc
      limit 1;
      if v_layout_revision is null then
        perform projectceo_product._raise(
          'P1111', 'validation_failed',
          '{"reason":"APPROVED_COMMIT_LAYOUT_LINEAGE_INVALID"}'::jsonb
        );
      end if;
    end if;
    return projectceo_product_api._append_m2_workspace_revision_v4(
      project_id, package_id, entity_kind, entity_id, revision_id,
      expected_revision_id, status, payload, reason,
      expected_state_revision, idempotency_key
    );
  end if;

  if status <> 'published' or jsonb_typeof(payload) <> 'object' then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"status"}'::jsonb);
  end if;
  perform projectceo_product._assert_text(entity_id, 'entityId', 160);
  perform projectceo_product._assert_text(revision_id, 'revisionId', 160);
  perform projectceo_product._assert_text(reason, 'reason', 4000);
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id, package_id, 'revise_decision'
  );

  select array_agg(key order by key) into v_payload_keys
  from jsonb_object_keys(payload) key;
  if v_payload_keys is distinct from array[
    'layoutContent', 'role', 'roomId', 'schemaVersion',
    'semanticHash', 'variantId', 'versionId'
  ]::text[] then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"LAYOUT_VERSION_KEYS_INVALID"}'::jsonb);
  end if;
  if payload->>'role' is null
     or payload->>'role' not in ('preferred', 'value_engineered', 'premium')
     or payload->>'schemaVersion' is distinct from 'project-ceo-m2-layout/0.1'
     or payload->>'semanticHash' is null
     or payload->>'semanticHash' !~ '^sha256:[0-9a-f]{64}$'
     or jsonb_typeof(payload->'layoutContent') <> 'object' then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"LAYOUT_VERSION_ENVELOPE_INVALID"}'::jsonb);
  end if;
  perform projectceo_product._assert_text(payload->>'versionId', 'versionId', 160);
  perform projectceo_product._assert_text(payload->>'roomId', 'roomId', 160);
  perform projectceo_product._assert_text(payload->>'variantId', 'variantId', 160);

  select array_agg(key order by key collate "C") into v_layout_keys
  from jsonb_object_keys(payload->'layoutContent') key;
  if not (v_layout_keys @> array[
      'canonicalUnits', 'clearanceZones', 'columns', 'contractVersion',
      'documentId', 'floor', 'lights', 'materialAssignments', 'materials',
      'metadata', 'name', 'nodes', 'objects', 'openings', 'projectId',
      'stateRevision', 'variant', 'walls'
    ]::text[])
     or payload#>>'{layoutContent,contractVersion}' <> 'archidom.layout-document/0.1'
     or payload#>>'{layoutContent,canonicalUnits}' <> 'mm'
     or payload#>>'{layoutContent,documentId}' <> entity_id
     or payload#>>'{layoutContent,projectId}' <> project_id::text
     or payload#>>'{layoutContent,variant,id}' <> payload->>'variantId'
     or payload#>>'{layoutContent,variant,status}' <> 'published'
     or jsonb_typeof(payload#>'{layoutContent,floor}') <> 'object'
     or jsonb_typeof(payload#>'{layoutContent,variant}') <> 'object'
     or jsonb_typeof(payload#>'{layoutContent,nodes}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,walls}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,openings}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,columns}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,objects}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,clearanceZones}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,materials}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,materialAssignments}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,lights}') <> 'array'
     or jsonb_typeof(payload#>'{layoutContent,metadata}') <> 'object' then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"LAYOUT_DOCUMENT_INVALID"}'::jsonb);
  end if;
  -- Cheap byte and cardinality bounds run before validator/canonical recursion.
  if octet_length((payload->'layoutContent')::text) > 65536 then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"LAYOUT_DOCUMENT_UNSAFE"}'::jsonb);
  end if;
  v_json_depth := projectceo_product._m2_layout_json_depth(payload->'layoutContent');
  select count(*) into v_json_value_count
  from jsonb_path_query(payload->'layoutContent', 'strict $.**') value;
  select coalesce(sum(jsonb_array_length(payload->'layoutContent'->collection_name)), 0)
    into v_entity_count
  from unnest(array[
    'nodes','walls','openings','columns','objects','clearanceZones',
    'materials','materialAssignments','lights'
  ]::text[]) collection_name;
  if v_json_depth > 16 or v_json_value_count > 8192 or v_entity_count > 2048 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"LAYOUT_DOCUMENT_LIMIT_EXCEEDED"}'::jsonb
    );
  end if;
  if not projectceo_product._m2_layout_json_safe(payload->'layoutContent')
     or not projectceo_product._m2_validate_layout_document(payload->'layoutContent') then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"LAYOUT_DOCUMENT_UNSAFE"}'::jsonb);
  end if;
  if payload->>'semanticHash' is distinct from
     projectceo_product._m2_layout_semantic_hash(payload->'layoutContent') then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"LAYOUT_SEMANTIC_HASH_MISMATCH"}'::jsonb);
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'entityId', entity_id, 'entityKind', entity_kind,
    'expectedRevisionId', expected_revision_id,
    'expectedStateRevision', expected_state_revision, 'packageId', package_id,
    'payload', payload, 'projectId', project_id, 'reason', reason,
    'revisionId', revision_id, 'status', status
  ));
  select workflow.state_revision into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id
    and workflow.project_id = append_m2_workspace_revision.project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id, project_id,
    'append_m2_layout_version_revision', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentStateRevision', v_state_revision));
  end if;

  -- A published versionId is immutable and cannot be reused by another
  -- document lineage within the same tenant/project/package boundary.
  select revision.revision_id into v_reused_version_id
  from projectceo_product.m2_workspace_revisions revision
  where revision.entity_kind = 'layout_version'
    and revision.payload->>'versionId' = payload->>'versionId'
    and revision.organization_id = v_context.organization_id
    and revision.project_id = append_m2_workspace_revision.project_id
    and revision.package_id = append_m2_workspace_revision.package_id
    and (revision.entity_id <> entity_id or revision.revision_id <> revision_id)
  limit 1;
  if v_reused_version_id is not null then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"VERSION_ID_ALREADY_EXISTS_CANNOT_BE_REUSED"}'::jsonb
    );
  end if;

  select * into v_current
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = v_context.organization_id
    and revision.project_id = append_m2_workspace_revision.project_id
    and revision.entity_kind = 'layout_version'
    and revision.entity_id = append_m2_workspace_revision.entity_id
  order by revision.revision_no desc limit 1 for update;
  if v_current is null then
    if expected_revision_id is not null then
      perform projectceo_product._raise('P1107', 'stale_state', '{"currentRevisionId":null}'::jsonb);
    end if;
    v_revision_no := 1;
  else
    if v_current.package_id is distinct from package_id then
      perform projectceo_product._raise('P1107', 'stale_state', '{"reason":"CROSS_PACKAGE_LINEAGE"}'::jsonb);
    end if;
    if v_current.revision_id is distinct from expected_revision_id then
      perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentRevisionId', v_current.revision_id));
    end if;
    v_revision_no := v_current.revision_no + 1;
  end if;

  insert into projectceo_product.m2_workspace_revisions (
    organization_id, project_id, package_id, entity_kind, entity_id, revision_id,
    revision_no, supersedes_revision_id, status, payload, reason, reason_digest,
    created_by_user_id
  ) values (
    v_context.organization_id, project_id, package_id, 'layout_version',
    entity_id, revision_id, v_revision_no,
    case when v_current is null then null else v_current.revision_id end,
    'published', payload, reason, project_intelligence._sha256_text(reason),
    v_context.actor_user_id
  );
  v_result := jsonb_build_object(
    'entityKind', 'layout_version', 'entityId', entity_id,
    'revisionId', revision_id, 'revisionNo', v_revision_no,
    'packageId', package_id, 'status', 'published'
  );
  return projectceo_product._complete_command(
    v_context.organization_id, project_id,
    'append_m2_layout_version_revision', v_key_digest, v_request_digest,
    'human', v_context.actor_id, v_context.actor_user_id, v_result,
    'm2_layout_version_revision_appended',
    jsonb_build_object('entity_kind', 'layout_version',
      'entity_id', entity_id, 'revision_no', v_revision_no),
    v_state_revision
  );
end
$function$;

alter function projectceo_product_api.append_m2_workspace_revision(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) owner to pi_table_owner;
revoke all on function projectceo_product_api.append_m2_workspace_revision(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_product_api.append_m2_workspace_revision(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) to authenticated;

create function projectceo_read_api.get_project_workspace_read_v5(
  project_id uuid,
  package_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_base jsonb;
  v_organization_id uuid;
  v_actor_user_id uuid;
  v_role text;
  v_rows jsonb;
begin
  v_base := projectceo_read_api.get_project_workspace_read_v4(project_id, package_id);
  if v_base -> 'error' is not null and v_base -> 'error' <> 'null'::jsonb then
    return v_base;
  end if;
  v_organization_id := (v_base #>> '{scope,organizationId}')::uuid;
  v_actor_user_id := (v_base #>> '{scope,actorUserId}')::uuid;
  select membership.role into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_organization_id
    and membership.project_id = get_project_workspace_read_v5.project_id
    and membership.user_id = v_actor_user_id
    and membership.status = 'active'
  limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', revision.entity_id,
    'documentId', revision.entity_id,
    'versionId', revision.payload->>'versionId',
    'packageId', revision.package_id,
    'revisionId', revision.revision_id,
    'revisionNo', revision.revision_no,
    'semanticHash', revision.payload->>'semanticHash',
    'roomId', revision.payload->>'roomId',
    'variantId', revision.payload->>'variantId',
    'role', revision.payload->>'role',
    'schemaVersion', revision.payload->>'schemaVersion',
    'status', revision.status,
    'payload', case
      when v_role = 'builder' then revision.payload - 'layoutContent'
      -- owner is represented by owner_lead in the compatibility namespace.
      when v_role in ('owner', 'owner_lead', 'architect', 'client_approver') then revision.payload
      else revision.payload
    end,
    'createdAt', revision.created_at
  ) order by
    revision.entity_id collate "C",
    revision.revision_no,
    revision.revision_id collate "C"
  ), '[]'::jsonb)
  into v_rows
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = v_organization_id
    and revision.project_id = get_project_workspace_read_v5.project_id
    and (get_project_workspace_read_v5.package_id is null
      or revision.package_id = get_project_workspace_read_v5.package_id)
    and revision.entity_kind = 'layout_version'
    and revision.status = 'published';
  return jsonb_set(v_base, '{data,m2LayoutVersions}', v_rows, true);
end
$function$;

alter function projectceo_read_api.get_project_workspace_read_v5(uuid, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_read_api.get_project_workspace_read_v5(uuid, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_read_api.get_project_workspace_read_v5(uuid, uuid)
  to authenticated;

revoke all on function projectceo_product_api._append_m2_workspace_revision_v4(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) from service_role;

commit;
