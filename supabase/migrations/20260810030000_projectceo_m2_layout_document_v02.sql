-- Layout document contract v0.2 alongside frozen v0.1.
--
-- Additive: the publish validator learns to accept BOTH declared versions,
-- each by its own rules. 0.1 stays byte-for-byte the shape this function
-- enforced since 20260802080000 — published 0.1 versions keep opening
-- forever (A4 §5). 0.2 is the editor's shape: required labels, catalogKey
-- and notes on objects, polygon clearance zones with severity and related
-- objects, and the linear_proxy light kind instead of hemisphere.
--
-- The TS side mirrors this split in lib/layout-studio/domain: the schema
-- registry holds one JSON schema per version and validates every document
-- against the version it declares.

begin;

set local check_function_bodies = on;

create or replace function projectceo_product._m2_validate_layout_document(layout_content jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_version text;
  v_v02 boolean;
  v_collection text;
  v_point jsonb;
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

  v_version := layout_content->>'contractVersion';
  -- 0.1 заморожена как есть; 0.2 — форма редактора (обязательные label,
  -- catalogKey/notes у объектов, полигональные зоны, linear_proxy-свет).
  if v_version not in ('archidom.layout-document/0.1', 'archidom.layout-document/0.2')
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

  v_v02 := v_version = 'archidom.layout-document/0.2';
  v_ids := array[layout_content#>>'{floor,id}', layout_content#>>'{variant,id}'];
  foreach v_collection in array array[
    'nodes', 'walls', 'openings', 'columns', 'objects', 'clearanceZones',
    'materials', 'materialAssignments', 'lights'
  ]::text[] loop
    if jsonb_typeof(layout_content->v_collection) <> 'array' then return false; end if;
    case v_collection
      when 'nodes' then v_required := array['id','locked','xMm','yMm']; v_optional := '{}';
      when 'walls' then
        if v_v02 then v_required := array['endNodeId','heightMm','id','kind','label','locked','startNodeId','thicknessMm']; v_optional := '{}';
        else v_required := array['endNodeId','heightMm','id','kind','locked','startNodeId','thicknessMm']; v_optional := array['label']; end if;
      when 'openings' then
        if v_v02 then v_required := array['heightMm','id','kind','label','locked','offsetMm','parentWallId','sillMm','widthMm']; v_optional := array['handing'];
        else v_required := array['heightMm','id','kind','locked','offsetMm','parentWallId','sillMm','widthMm']; v_optional := array['handing','label']; end if;
      when 'columns' then
        if v_v02 then v_required := array['baseZMm','depthMm','heightMm','id','label','locked','rotationDeg','widthMm','xMm','yMm']; v_optional := '{}';
        else v_required := array['baseZMm','depthMm','heightMm','id','locked','rotationDeg','widthMm','xMm','yMm']; v_optional := array['label']; end if;
      when 'objects' then
        if v_v02 then v_required := array['depthMm','heightMm','id','kind','label','locked','rotationDeg','widthMm','xMm','yMm','zMm']; v_optional := array['catalogKey','notes'];
        else v_required := array['depthMm','heightMm','id','kind','locked','rotationDeg','widthMm','xMm','yMm','zMm']; v_optional := array['label']; end if;
      when 'clearanceZones' then
        if v_v02 then v_required := array['id','label','polygon','relatedObjectIds','severity']; v_optional := '{}';
        else v_required := array['id']; v_optional := array['depthMm','heightMm','kind','label','locked','rotationDeg','targetId','widthMm','xMm','yMm','zMm']; end if;
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
        (v_v02 and v_entity->>'kind' not in ('ambient','directional','point','linear_proxy'))
        or (not v_v02 and v_entity->>'kind' not in ('ambient','directional','hemisphere','point'))
        or not projectceo_product._m2_require_nonempty_string(v_entity->'label')
        or (v_entity->>'color') !~ '^#[0-9a-fA-F]{6}$'
        or not projectceo_product._m2_require_finite_number(v_entity->'intensity')
        or (v_entity->>'intensity')::numeric not between 0 and 100000
        or (v_entity ? 'groundColor' and (v_entity->>'groundColor') !~ '^#[0-9a-fA-F]{6}$')
        or (v_entity ? 'targetId' and not projectceo_product._m2_require_nonempty_string(v_entity->'targetId'))
        or (v_entity ? 'decay' and not projectceo_product._m2_require_finite_number(v_entity->'decay'))
      ) then return false; end if;
      if v_v02 and v_collection in ('walls','openings','columns','objects')
         and not projectceo_product._m2_require_nonempty_string(v_entity->'label')
      then return false; end if;
      if v_v02 and v_collection = 'objects' and (
        (v_entity ? 'catalogKey' and not projectceo_product._m2_require_nonempty_string(v_entity->'catalogKey'))
        or (v_entity ? 'notes' and not projectceo_product._m2_require_nonempty_string(v_entity->'notes'))
      ) then return false; end if;
      if v_v02 and v_collection = 'clearanceZones' then
        if not projectceo_product._m2_require_nonempty_string(v_entity->'label')
           or v_entity->>'severity' not in ('info','warning','blocking')
           or jsonb_typeof(v_entity->'polygon') <> 'array'
           or jsonb_array_length(v_entity->'polygon') < 3
           or jsonb_typeof(v_entity->'relatedObjectIds') <> 'array'
        then return false; end if;
        for v_point in select item from jsonb_array_elements(v_entity->'polygon') item loop
          if not projectceo_product._m2_json_exact_keys(v_point, array['xMm','yMm'])
             or not projectceo_product._m2_require_finite_number(v_point->'xMm')
             or not projectceo_product._m2_require_finite_number(v_point->'yMm')
             or (v_point->>'xMm')::numeric <> trunc((v_point->>'xMm')::numeric)
             or (v_point->>'yMm')::numeric <> trunc((v_point->>'yMm')::numeric)
          then return false; end if;
        end loop;
        if exists (
          select 1 from jsonb_array_elements(v_entity->'relatedObjectIds') rel
          where not projectceo_product._m2_require_nonempty_string(rel)
        ) then return false; end if;
      end if;
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

alter function projectceo_product._m2_validate_layout_document(jsonb) owner to pi_table_owner;
revoke all on function projectceo_product._m2_validate_layout_document(jsonb)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

commit;
