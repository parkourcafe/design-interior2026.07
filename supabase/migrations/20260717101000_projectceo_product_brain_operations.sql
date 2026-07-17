-- ProjectCEO RU Product Brain commands and delivery projection.
--
-- All human actor/scope/capability values are derived by Foundation helpers.
-- Worker entrypoints use a fixed system actor and are never granted to
-- authenticated human sessions.

begin;

set local check_function_bodies = on;

create function projectceo_product._raise(
  p_sqlstate text,
  p_code text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  raise exception using
    errcode = p_sqlstate,
    message = p_code,
    detail = coalesce(p_detail, '{}'::jsonb)::text;
end
$function$;

create function projectceo_product._assert_text(
  p_value text,
  p_field text,
  p_max integer default 4000
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if length(v_value) < 1 or length(v_value) > p_max
     or v_value is distinct from p_value then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  return v_value;
end
$function$;

create function projectceo_product._assert_semantic_hash(
  p_value text,
  p_field text default 'semanticHash'
)
returns bytea
language plpgsql
immutable
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  if p_value is null or p_value !~ '^sha256:[a-f0-9]{64}$' then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  return decode(substring(p_value from 8), 'hex');
end
$function$;

create function projectceo_product._sorted_unique_text_array(
  p_value jsonb,
  p_field text,
  p_allow_empty boolean default true
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_values text[];
  v_count bigint;
begin
  if jsonb_typeof(p_value) <> 'array' then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  select
    coalesce(array_agg(value order by value collate "C"), array[]::text[]),
    count(*)
  into v_values, v_count
  from jsonb_array_elements_text(p_value) element(value);

  if (not p_allow_empty and v_count = 0)
     or exists (
       select 1
       from unnest(v_values) value
       where value = '' or value <> btrim(value) or length(value) > 160
     )
     or cardinality(v_values) <> (
       select count(distinct value)
       from unnest(v_values) value
     ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object('field', p_field)
    );
  end if;
  return v_values;
end
$function$;

create function projectceo_product._replay_or_null(
  p_organization_id uuid,
  p_project_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_record projectceo_product.command_records%rowtype;
begin
  select * into v_record
  from projectceo_product.command_records cr
  where cr.organization_id = p_organization_id
    and cr.project_id = p_project_id
    and cr.operation = p_operation
    and cr.key_digest = p_key_digest;
  if not found then return null; end if;
  if v_record.request_digest <> p_request_digest then
    perform projectceo_product._raise(
      'P1108',
      'idempotency_conflict',
      jsonb_build_object('operation', p_operation)
    );
  end if;
  return jsonb_build_object(
    'operation', p_operation,
    'replay', true,
    'stateRevision', v_record.resulting_state_revision,
    'result', v_record.logical_result
  );
end
$function$;

create function projectceo_product._complete_command(
  p_organization_id uuid,
  p_project_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea,
  p_actor_type text,
  p_actor_id text,
  p_actor_user_id uuid,
  p_logical_result jsonb,
  p_event_type text,
  p_controlled_metadata jsonb,
  p_previous_state_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_command_id uuid := extensions.gen_random_uuid();
  v_next_state_revision bigint := p_previous_state_revision + 1;
begin
  if p_previous_state_revision >= 9007199254740991 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"STATE_REVISION_EXHAUSTED"}'::jsonb
    );
  end if;
  if current_setting('projectceo.product_test_fail_after_domain', true) = 'on'
  then
    perform projectceo_product._raise(
      'P1112',
      'internal_error',
      '{"reason":"INJECTED_FAILURE_AFTER_DOMAIN"}'::jsonb
    );
  end if;

  insert into projectceo_product.command_records (
    command_id,
    organization_id,
    project_id,
    operation,
    key_digest,
    request_digest,
    actor_type,
    actor_id,
    actor_user_id,
    logical_result,
    resulting_state_revision
  )
  values (
    v_command_id,
    p_organization_id,
    p_project_id,
    p_operation,
    p_key_digest,
    p_request_digest,
    p_actor_type,
    p_actor_id,
    p_actor_user_id,
    p_logical_result,
    v_next_state_revision
  );

  insert into projectceo_product.audit_events (
    organization_id,
    project_id,
    command_id,
    event_type,
    actor_type,
    actor_id,
    request_id,
    controlled_metadata
  )
  values (
    p_organization_id,
    p_project_id,
    v_command_id,
    p_event_type,
    p_actor_type,
    p_actor_id,
    'db:' || extensions.gen_random_uuid()::text,
    coalesce(p_controlled_metadata, '{}'::jsonb)
  );

  update project_intelligence.project_workflows pw
  set state_revision = v_next_state_revision,
      updated_at = statement_timestamp()
  where pw.organization_id = p_organization_id
    and pw.project_id = p_project_id
    and pw.state_revision = p_previous_state_revision;
  if not found then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      '{}'::jsonb
    );
  end if;

  -- The core evidence closure trigger is SECURITY INVOKER by contract. Flush
  -- it before leaving the fixed-definer command boundary so callers never
  -- need direct privileges on the private evidence registry at COMMIT.
  set constraints
    project_intelligence.graph_node_revisions_evidence_closure
    immediate;
  set constraints
    project_intelligence.graph_node_revisions_evidence_closure
    deferred;

  return jsonb_build_object(
    'operation', p_operation,
    'replay', false,
    'stateRevision', v_next_state_revision,
    'result', p_logical_result
  );
end
$function$;

create function projectceo_product._system_context(p_project_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_count bigint;
begin
  select count(*), min(pw.organization_id::text)::uuid
  into v_count, v_organization_id
  from project_intelligence.project_workflows pw
  join project_intelligence.organizations o
    on o.id = pw.organization_id
   and o.cell_code = 'ru'
   and o.status = 'active'
  where pw.project_id = p_project_id;
  if v_count = 0 then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"project"}'::jsonb
    );
  elsif v_count <> 1 then
    perform projectceo_product._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"AMBIGUOUS_PROJECT_SCOPE"}'::jsonb
    );
  end if;
  return v_organization_id;
end
$function$;

create function projectceo_product._validate_evidence_array(
  p_organization_id uuid,
  p_project_id uuid,
  p_evidence jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_count bigint;
begin
  if jsonb_typeof(p_evidence) <> 'array'
     or jsonb_array_length(p_evidence) > 100 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"evidence"}'::jsonb
    );
  end if;
  select count(*) into v_count
  from jsonb_to_recordset(p_evidence) as e(
    "evidenceVersionId" text,
    "evidenceLinkId" text,
    "sourceId" text,
    "sourceNodeId" text,
    "sourceRevisionId" text,
    "fragmentId" text
  )
  join project_intelligence.version_evidence_links vel
    on vel.organization_id = p_organization_id
   and vel.project_id = p_project_id
   and vel.version_id = e."evidenceVersionId"
   and vel.evidence_link_id = e."evidenceLinkId"
  join project_intelligence.evidence_links el
    on el.organization_id = vel.organization_id
   and el.project_id = vel.project_id
   and el.evidence_link_id = vel.evidence_link_id
   and el.source_fragment_id = e."fragmentId"
  join project_intelligence.source_fragments sf
    on sf.organization_id = el.organization_id
   and sf.project_id = el.project_id
   and sf.fragment_id = el.source_fragment_id
   and sf.source_id = e."sourceId"
  join project_intelligence.version_source_fragments vsf
    on vsf.organization_id = sf.organization_id
   and vsf.project_id = sf.project_id
   and vsf.version_id = e."evidenceVersionId"
   and vsf.fragment_id = sf.fragment_id
  join project_intelligence.version_sources vs
    on vs.organization_id = sf.organization_id
   and vs.project_id = sf.project_id
   and vs.version_id = e."evidenceVersionId"
   and vs.source_id = sf.source_id
  join project_intelligence.version_nodes vn
    on vn.organization_id = sf.organization_id
   and vn.project_id = sf.project_id
   and vn.version_id = e."evidenceVersionId"
   and vn.node_id = e."sourceNodeId"
   and vn.revision_id = e."sourceRevisionId"
  join project_intelligence.graph_nodes gn
    on gn.organization_id = vn.organization_id
   and gn.project_id = vn.project_id
   and gn.node_id = vn.node_id
   and gn.kind = 'source'
  join project_intelligence.graph_node_revisions gr
    on gr.organization_id = vn.organization_id
   and gr.project_id = vn.project_id
   and gr.node_id = vn.node_id
   and gr.revision_id = vn.revision_id
   and gr.payload ->> 'sourceId' = e."sourceId";

  if v_count <> jsonb_array_length(p_evidence)
     or (
       select count(*) <> count(distinct
         (item ->> 'evidenceVersionId')
         || ':' || (item ->> 'evidenceLinkId')
       )
       from jsonb_array_elements(p_evidence) item
     ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"VERSION_SCOPED_EVIDENCE_INVALID"}'::jsonb
    );
  end if;
end
$function$;

create function projectceo_product._insert_revision_evidence(
  p_organization_id uuid,
  p_project_id uuid,
  p_revision_id text,
  p_evidence jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  perform projectceo_product._validate_evidence_array(
    p_organization_id,
    p_project_id,
    p_evidence
  );
  insert into projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    claim_revision_id,
    evidence_version_id,
    evidence_link_id,
    source_id,
    source_node_id,
    source_revision_id,
    fragment_id,
    ordinal
  )
  select
    p_organization_id,
    p_project_id,
    p_revision_id,
    e.value ->> 'evidenceVersionId',
    e.value ->> 'evidenceLinkId',
    e.value ->> 'sourceId',
    e.value ->> 'sourceNodeId',
    e.value ->> 'sourceRevisionId',
    e.value ->> 'fragmentId',
    e.ordinality - 1
  from jsonb_array_elements(p_evidence) with ordinality
    as e(value, ordinality)
  order by e.ordinality;
end
$function$;

create function projectceo_product._append_claim_revision(
  p_organization_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_actor_user_id uuid,
  p_operation text,
  p_kind text,
  p_project_id uuid,
  p_package_id uuid,
  p_node_id text,
  p_revision_id text,
  p_expected_revision_id text,
  p_claim_status text,
  p_title text,
  p_area_node_id text,
  p_decision_revision_id text,
  p_payload jsonb,
  p_evidence jsonb,
  p_reason text,
  p_expected_state_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_current_revision_id text;
  v_current_kind text;
  v_revision_no bigint;
  v_reason text;
  v_result jsonb;
begin
  perform projectceo_foundation._assert_state_revision(
    p_expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(p_idempotency_key);
  perform projectceo_product._assert_text(p_node_id, 'nodeId', 160);
  perform projectceo_product._assert_text(p_revision_id, 'revisionId', 160);
  perform projectceo_product._assert_text(p_title, 'title', 1000);
  v_reason := projectceo_product._assert_text(p_reason, 'reason', 4000);

  if p_kind not in ('decision', 'selection')
     or p_claim_status not in (
       'extracted',
       'interpreted',
       'unknown',
       'human_origin'
     )
     or jsonb_typeof(p_payload) <> 'object'
     or (
       p_actor_type = 'system'
       and p_claim_status = 'human_origin'
     )
     or (
       p_claim_status <> 'human_origin'
       and (
         jsonb_typeof(p_evidence) <> 'array'
         or jsonb_array_length(p_evidence) = 0
       )
     ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"CLAIM_REVISION_CONTRACT_INVALID"}'::jsonb
    );
  end if;
  if p_kind = 'selection' and (
    p_area_node_id is null
    or p_decision_revision_id is null
    or jsonb_typeof(p_payload -> 'specification') <> 'object'
    or p_payload -> 'specification' = '{}'::jsonb
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"SELECTION_CONTRACT_INVALID"}'::jsonb
    );
  end if;
  if not exists (
    select 1
    from projectceo_foundation.project_packages pp
    where pp.organization_id = p_organization_id
      and pp.project_id = p_project_id
      and pp.id = p_package_id
      and pp.status = 'active'
  ) then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"package"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    btrim(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'areaNodeId', p_area_node_id,
      'claimStatus', p_claim_status,
      'decisionRevisionId', p_decision_revision_id,
      'evidence', p_evidence,
      'expectedRevisionId', p_expected_revision_id,
      'expectedStateRevision', p_expected_state_revision,
      'kind', p_kind,
      'nodeId', p_node_id,
      'packageId', p_package_id,
      'payload', p_payload,
      'projectId', p_project_id,
      'reason', v_reason,
      'revisionId', p_revision_id,
      'title', p_title
    )
  );

  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = p_organization_id
    and pw.project_id = p_project_id
  for update;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"project"}'::jsonb
    );
  end if;

  v_replay := projectceo_product._replay_or_null(
    p_organization_id,
    p_project_id,
    p_operation,
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> p_expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select gn.kind, gn.current_revision_id
  into v_current_kind, v_current_revision_id
  from project_intelligence.graph_nodes gn
  where gn.organization_id = p_organization_id
    and gn.project_id = p_project_id
    and gn.node_id = p_node_id
  for update;

  if found then
    if v_current_kind <> p_kind then
      perform projectceo_product._raise(
        'P1109',
        'scope_conflict',
        '{"reason":"GRAPH_NODE_KIND_MISMATCH"}'::jsonb
      );
    end if;
    if v_current_revision_id is distinct from p_expected_revision_id then
      perform projectceo_product._raise(
        'P1107',
        'stale_state',
        jsonb_build_object('currentRevisionId', v_current_revision_id)
      );
    end if;
    select crd.revision_no + 1 into v_revision_no
    from projectceo_product.claim_revision_descriptors crd
    where crd.organization_id = p_organization_id
      and crd.project_id = p_project_id
      and crd.revision_id = v_current_revision_id
      and crd.kind = p_kind;
    if not found then
      perform projectceo_product._raise(
        'P1109',
        'scope_conflict',
        '{"reason":"PREVIOUS_PRODUCT_REVISION_MISSING"}'::jsonb
      );
    end if;
  else
    if p_expected_revision_id is not null then
      perform projectceo_product._raise(
        'P1107',
        'stale_state',
        '{"currentRevisionId":null}'::jsonb
      );
    end if;
    v_revision_no := 1;
    insert into project_intelligence.graph_nodes (
      organization_id,
      project_id,
      node_id,
      kind,
      stable_key,
      current_revision_id
    )
    values (
      p_organization_id,
      p_project_id,
      p_node_id,
      p_kind,
      p_node_id,
      p_revision_id
    );
  end if;

  if p_area_node_id is not null and not exists (
    select 1
    from project_intelligence.graph_nodes area
    where area.organization_id = p_organization_id
      and area.project_id = p_project_id
      and area.node_id = p_area_node_id
      and area.kind = 'area'
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"AREA_NODE_INVALID"}'::jsonb
    );
  end if;
  if p_decision_revision_id is not null and not exists (
    select 1
    from projectceo_product.claim_revision_descriptors decision_revision
    where decision_revision.organization_id = p_organization_id
      and decision_revision.project_id = p_project_id
      and decision_revision.revision_id = p_decision_revision_id
      and decision_revision.kind = 'decision'
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"DECISION_REVISION_INVALID"}'::jsonb
    );
  end if;

  perform projectceo_product._validate_evidence_array(
    p_organization_id,
    p_project_id,
    coalesce(p_evidence, '[]'::jsonb)
  );

  insert into project_intelligence.graph_node_revisions (
    organization_id,
    project_id,
    revision_id,
    node_id,
    revision_no,
    title,
    payload,
    origin,
    claim_status,
    unknown_reason,
    replaces_revision_id,
    content_digest,
    created_by_type,
    created_by_id
  )
  values (
    p_organization_id,
    p_project_id,
    p_revision_id,
    p_node_id,
    v_revision_no,
    p_title,
    p_payload,
    case when p_actor_type = 'human' then 'human' else 'system' end,
    p_claim_status,
    case when p_claim_status = 'unknown' then v_reason else null end,
    v_current_revision_id,
    project_intelligence._sha256_jsonb(p_payload),
    p_actor_type,
    p_actor_id
  );

  if v_revision_no > 1 then
    update project_intelligence.graph_nodes gn
    set current_revision_id = p_revision_id
    where gn.organization_id = p_organization_id
      and gn.project_id = p_project_id
      and gn.node_id = p_node_id
      and gn.current_revision_id = v_current_revision_id;
    if not found then
      perform projectceo_product._raise(
        'P1107',
        'stale_state',
        '{}'::jsonb
      );
    end if;
  end if;

  insert into projectceo_product.claim_revision_descriptors (
    organization_id,
    project_id,
    revision_id,
    node_id,
    kind,
    revision_no,
    replaces_revision_id,
    package_id,
    area_node_id,
    decision_revision_id,
    reason,
    reason_digest,
    created_by_type,
    created_by_user_id,
    created_by_id
  )
  values (
    p_organization_id,
    p_project_id,
    p_revision_id,
    p_node_id,
    p_kind,
    v_revision_no,
    v_current_revision_id,
    p_package_id,
    p_area_node_id,
    p_decision_revision_id,
    v_reason,
    project_intelligence._sha256_text(v_reason),
    p_actor_type,
    p_actor_user_id,
    p_actor_id
  );

  perform projectceo_product._insert_revision_evidence(
    p_organization_id,
    p_project_id,
    p_revision_id,
    coalesce(p_evidence, '[]'::jsonb)
  );

  v_result := jsonb_build_object(
    'kind', p_kind,
    'nodeId', p_node_id,
    'packageId', p_package_id,
    'projectId', p_project_id,
    'replacesRevisionId', v_current_revision_id,
    'revisionId', p_revision_id,
    'revisionNo', v_revision_no
  );
  return projectceo_product._complete_command(
    p_organization_id,
    p_project_id,
    p_operation,
    v_key_digest,
    v_request_digest,
    p_actor_type,
    p_actor_id,
    p_actor_user_id,
    v_result,
    case
      when p_kind = 'decision' then 'decision_revision_appended'
      else 'selection_revision_appended'
    end,
    jsonb_build_object(
      'kind', p_kind,
      'node_id', p_node_id,
      'package_id', p_package_id,
      'replaces_revision_id', v_current_revision_id,
      'revision_id', p_revision_id,
      'revision_no', v_revision_no
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.append_decision_revision(
  project_id uuid,
  package_id uuid,
  node_id text,
  revision_id text,
  expected_revision_id text,
  claim_status text,
  title text,
  resolution text,
  area_node_id text,
  decision_status text,
  evidence jsonb,
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
begin
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    package_id,
    'revise_decision'
  );
  if decision_status not in ('proposed', 'confirmed', 'superseded') then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"decisionStatus"}'::jsonb
    );
  end if;
  return projectceo_product._append_claim_revision(
    v_context.organization_id,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    'append_decision_revision',
    'decision',
    project_id,
    package_id,
    node_id,
    revision_id,
    expected_revision_id,
    claim_status,
    title,
    area_node_id,
    null,
    jsonb_build_object(
      'areaId', area_node_id,
      'packageId', package_id,
      'resolution', projectceo_product._assert_text(
        resolution,
        'resolution',
        8000
      ),
      'schemaVersion', 'project-ceo-decision/0.1',
      'status', decision_status,
      'title', title
    ),
    evidence,
    reason,
    expected_state_revision,
    idempotency_key
  );
end
$function$;

create function projectceo_product_api.append_selection_revision(
  project_id uuid,
  package_id uuid,
  node_id text,
  revision_id text,
  expected_revision_id text,
  claim_status text,
  title text,
  area_node_id text,
  decision_revision_id text,
  specification jsonb,
  evidence jsonb,
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
begin
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    package_id,
    'create_selection'
  );
  return projectceo_product._append_claim_revision(
    v_context.organization_id,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    'append_selection_revision',
    'selection',
    project_id,
    package_id,
    node_id,
    revision_id,
    expected_revision_id,
    claim_status,
    title,
    area_node_id,
    decision_revision_id,
    jsonb_build_object(
      'areaId', area_node_id,
      'decisionRevisionId', decision_revision_id,
      'packageId', package_id,
      'schemaVersion', 'project-ceo-selection/0.1',
      'specification', specification,
      'title', title
    ),
    evidence,
    reason,
    expected_state_revision,
    idempotency_key
  );
end
$function$;

create function projectceo_product_api.append_system_decision_revision(
  project_id uuid,
  package_id uuid,
  node_id text,
  revision_id text,
  expected_revision_id text,
  claim_status text,
  title text,
  resolution text,
  area_node_id text,
  decision_status text,
  evidence jsonb,
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
  v_organization_id uuid;
begin
  v_organization_id :=
    projectceo_product._system_context(project_id);
  if decision_status not in ('proposed', 'confirmed', 'superseded') then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"decisionStatus"}'::jsonb
    );
  end if;
  return projectceo_product._append_claim_revision(
    v_organization_id,
    'system',
    'system:projectceo-product-worker',
    null,
    'append_system_decision_revision',
    'decision',
    project_id,
    package_id,
    node_id,
    revision_id,
    expected_revision_id,
    claim_status,
    title,
    area_node_id,
    null,
    jsonb_build_object(
      'areaId', area_node_id,
      'packageId', package_id,
      'resolution', projectceo_product._assert_text(
        resolution,
        'resolution',
        8000
      ),
      'schemaVersion', 'project-ceo-decision/0.1',
      'status', decision_status,
      'title', title
    ),
    evidence,
    reason,
    expected_state_revision,
    idempotency_key
  );
end
$function$;

create function projectceo_product_api.append_system_selection_revision(
  project_id uuid,
  package_id uuid,
  node_id text,
  revision_id text,
  expected_revision_id text,
  claim_status text,
  title text,
  area_node_id text,
  decision_revision_id text,
  specification jsonb,
  evidence jsonb,
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
  v_organization_id uuid;
begin
  v_organization_id :=
    projectceo_product._system_context(project_id);
  return projectceo_product._append_claim_revision(
    v_organization_id,
    'system',
    'system:projectceo-product-worker',
    null,
    'append_system_selection_revision',
    'selection',
    project_id,
    package_id,
    node_id,
    revision_id,
    expected_revision_id,
    claim_status,
    title,
    area_node_id,
    decision_revision_id,
    jsonb_build_object(
      'areaId', area_node_id,
      'decisionRevisionId', decision_revision_id,
      'packageId', package_id,
      'schemaVersion', 'project-ceo-selection/0.1',
      'specification', specification,
      'title', title
    ),
    evidence,
    reason,
    expected_state_revision,
    idempotency_key
  );
end
$function$;

create function projectceo_product_api.append_price_observation(
  project_id uuid,
  selection_revision_id text,
  observation_id text,
  amount_rub bigint,
  evidence jsonb,
  supplier_ref text,
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
  v_selection projectceo_product.claim_revision_descriptors%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_evidence record;
  v_result jsonb;
begin
  perform projectceo_product._assert_text(
    selection_revision_id,
    'selectionRevisionId',
    160
  );
  perform projectceo_product._assert_text(
    observation_id,
    'observationId',
    160
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if amount_rub is null
     or amount_rub < 0
     or amount_rub > 9007199254740991
     or jsonb_typeof(evidence) <> 'object' then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"PRICE_OBSERVATION_CONTRACT_INVALID"}'::jsonb
    );
  end if;

  select * into v_selection
  from projectceo_product.claim_revision_descriptors crd
  where crd.project_id = project_id
    and crd.revision_id = selection_revision_id
    and crd.kind = 'selection';
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"selectionRevision"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_selection.package_id,
    'create_selection'
  );

  perform projectceo_product._validate_evidence_array(
    v_context.organization_id,
    project_id,
    jsonb_build_array(evidence)
  );

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'amountRub', amount_rub,
      'evidence', evidence,
      'expectedStateRevision', expected_state_revision,
      'observationId', observation_id,
      'projectId', project_id,
      'selectionRevisionId', selection_revision_id,
      'supplierRef', supplier_ref
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'append_price_observation',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select
    evidence ->> 'evidenceVersionId' as evidence_version_id,
    evidence ->> 'evidenceLinkId' as evidence_link_id,
    evidence ->> 'sourceId' as source_id,
    evidence ->> 'sourceNodeId' as source_node_id,
    evidence ->> 'sourceRevisionId' as source_revision_id,
    evidence ->> 'fragmentId' as fragment_id
  into v_evidence;

  insert into projectceo_product.price_observations (
    organization_id,
    project_id,
    observation_id,
    selection_revision_id,
    amount_rub,
    evidence_version_id,
    evidence_link_id,
    source_id,
    source_node_id,
    source_revision_id,
    fragment_id,
    supplier_ref,
    observed_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    observation_id,
    selection_revision_id,
    amount_rub,
    v_evidence.evidence_version_id,
    v_evidence.evidence_link_id,
    v_evidence.source_id,
    v_evidence.source_node_id,
    v_evidence.source_revision_id,
    v_evidence.fragment_id,
    case
      when supplier_ref is null then null
      else projectceo_product._assert_text(
        supplier_ref,
        'supplierRef',
        500
      )
    end,
    v_context.actor_user_id
  );

  v_result := jsonb_build_object(
    'amountRub', amount_rub,
    'observationId', observation_id,
    'observedAt', statement_timestamp(),
    'projectId', project_id,
    'selectionRevisionId', selection_revision_id
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'append_price_observation',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'price_observation_appended',
    jsonb_build_object(
      'amount_rub', amount_rub,
      'observation_id', observation_id,
      'selection_revision_id', selection_revision_id
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.create_approval_package(
  project_id uuid,
  package_id uuid,
  approval_package_id text,
  items jsonb,
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
  v_item_count bigint;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'review_claim'
  );
  perform projectceo_product._assert_text(
    approval_package_id,
    'approvalPackageId',
    160
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if jsonb_typeof(items) <> 'array'
     or jsonb_array_length(items) < 1
     or jsonb_array_length(items) > 500 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"items"}'::jsonb
    );
  end if;
  if not exists (
    select 1
    from projectceo_foundation.project_packages pp
    where pp.organization_id = v_context.organization_id
      and pp.project_id = project_id
      and pp.id = package_id
      and pp.status = 'active'
  ) then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"package"}'::jsonb
    );
  end if;

  select count(*) into v_item_count
  from jsonb_to_recordset(items) as item(
    "targetKind" text,
    "entityId" text,
    "revisionId" text
  )
  join project_intelligence.graph_node_revisions gr
    on gr.organization_id = v_context.organization_id
   and gr.project_id = project_id
   and gr.node_id = item."entityId"
   and gr.revision_id = item."revisionId"
  join project_intelligence.graph_nodes gn
    on gn.organization_id = gr.organization_id
   and gn.project_id = gr.project_id
   and gn.node_id = gr.node_id
  where item."targetKind" in (
    'requirement_revision',
    'assumption_revision',
    'decision_revision',
    'selection_revision'
  )
    and gn.kind = replace(item."targetKind", '_revision', '')
    and (
      (
        item."targetKind" in (
          'requirement_revision',
          'assumption_revision'
        )
        and gr.payload ->> 'packageId' = package_id::text
      )
      or (
        item."targetKind" in (
          'decision_revision',
          'selection_revision'
        )
        and exists (
          select 1
          from projectceo_product.claim_revision_descriptors crd
          where crd.organization_id = gr.organization_id
            and crd.project_id = gr.project_id
            and crd.revision_id = gr.revision_id
            and crd.package_id = package_id
            and crd.kind = gn.kind
        )
      )
    );
  if v_item_count <> jsonb_array_length(items)
     or (
       select count(*) <> count(distinct
         (item ->> 'targetKind') || ':' || (item ->> 'revisionId')
       )
       from jsonb_array_elements(items) item
     ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"APPROVAL_ITEMS_INVALID"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'approvalPackageId', approval_package_id,
      'expectedStateRevision', expected_state_revision,
      'items', items,
      'packageId', package_id,
      'projectId', project_id
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'create_approval_package',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  insert into projectceo_product.approval_packages (
    organization_id,
    project_id,
    approval_package_id,
    package_id,
    created_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    approval_package_id,
    package_id,
    v_context.actor_user_id
  );
  insert into projectceo_product.approval_package_items (
    organization_id,
    project_id,
    approval_package_id,
    target_kind,
    entity_id,
    revision_id,
    ordinal
  )
  select
    v_context.organization_id,
    project_id,
    approval_package_id,
    item.value ->> 'targetKind',
    item.value ->> 'entityId',
    item.value ->> 'revisionId',
    item.ordinality - 1
  from jsonb_array_elements(items) with ordinality
    as item(value, ordinality)
  order by item.ordinality;
  insert into projectceo_product.approval_package_events (
    organization_id,
    project_id,
    approval_package_id,
    sequence_no,
    from_status,
    to_status,
    actor_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    approval_package_id,
    1,
    null,
    'draft',
    v_context.actor_user_id
  );

  v_result := jsonb_build_object(
    'approvalPackageId', approval_package_id,
    'itemCount', jsonb_array_length(items),
    'packageId', package_id,
    'projectId', project_id,
    'status', 'draft'
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'create_approval_package',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'approval_package_created',
    jsonb_build_object(
      'approval_package_id', approval_package_id,
      'item_count', jsonb_array_length(items),
      'package_id', package_id
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product._transition_approval_package(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_actor_id text,
  p_operation text,
  p_project_id uuid,
  p_approval_package_id text,
  p_expected_status text,
  p_to_status text,
  p_reason text,
  p_expected_state_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_current_status text;
  v_sequence_no bigint;
  v_reason text;
  v_result jsonb;
begin
  perform projectceo_product._assert_text(
    p_approval_package_id,
    'approvalPackageId',
    160
  );
  perform projectceo_foundation._assert_state_revision(
    p_expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(p_idempotency_key);
  if p_operation = 'submit_approval_package' then
    if p_expected_status <> 'draft'
       or p_to_status <> 'submitted'
       or p_reason is not null then
      perform projectceo_product._raise(
        'P1111',
        'validation_failed',
        '{"reason":"APPROVAL_SUBMIT_TRANSITION_INVALID"}'::jsonb
      );
    end if;
    v_sequence_no := 2;
  else
    if p_expected_status <> 'submitted'
       or p_to_status not in (
         'approved',
         'rejected',
         'change_requested'
       ) then
      perform projectceo_product._raise(
        'P1111',
        'validation_failed',
        '{"reason":"APPROVAL_REVIEW_TRANSITION_INVALID"}'::jsonb
      );
    end if;
    v_reason := projectceo_product._assert_text(
      p_reason,
      'reason',
      4000
    );
    v_sequence_no := 3;
  end if;

  v_key_digest := project_intelligence._sha256_text(
    btrim(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'approvalPackageId', p_approval_package_id,
      'expectedStateRevision', p_expected_state_revision,
      'expectedStatus', p_expected_status,
      'projectId', p_project_id,
      'reason', v_reason,
      'toStatus', p_to_status
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = p_organization_id
    and pw.project_id = p_project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    p_organization_id,
    p_project_id,
    p_operation,
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> p_expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select ape.to_status into v_current_status
  from projectceo_product.approval_package_events ape
  where ape.organization_id = p_organization_id
    and ape.project_id = p_project_id
    and ape.approval_package_id = p_approval_package_id
  order by ape.sequence_no desc
  limit 1
  for update;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"approvalPackage"}'::jsonb
    );
  end if;
  if v_current_status <> p_expected_status then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStatus', v_current_status)
    );
  end if;

  insert into projectceo_product.approval_package_events (
    organization_id,
    project_id,
    approval_package_id,
    sequence_no,
    from_status,
    to_status,
    actor_user_id,
    reason,
    reason_digest
  )
  values (
    p_organization_id,
    p_project_id,
    p_approval_package_id,
    v_sequence_no,
    p_expected_status,
    p_to_status,
    p_actor_user_id,
    v_reason,
    case
      when v_reason is null then null
      else project_intelligence._sha256_text(v_reason)
    end
  );

  v_result := jsonb_build_object(
    'approvalPackageId', p_approval_package_id,
    'projectId', p_project_id,
    'status', p_to_status
  );
  return projectceo_product._complete_command(
    p_organization_id,
    p_project_id,
    p_operation,
    v_key_digest,
    v_request_digest,
    'human',
    p_actor_id,
    p_actor_user_id,
    v_result,
    case
      when p_to_status = 'submitted'
        then 'approval_package_submitted'
      else 'approval_package_reviewed'
    end,
    jsonb_build_object(
      'approval_package_id', p_approval_package_id,
      'from_status', p_expected_status,
      'to_status', p_to_status
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.submit_approval_package(
  project_id uuid,
  approval_package_id text,
  expected_status text,
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
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'review_claim'
  );
  return projectceo_product._transition_approval_package(
    v_context.organization_id,
    v_context.actor_user_id,
    v_context.actor_id,
    'submit_approval_package',
    project_id,
    approval_package_id,
    expected_status,
    'submitted',
    null,
    expected_state_revision,
    idempotency_key
  );
end
$function$;

create function projectceo_product_api.review_approval_package(
  project_id uuid,
  approval_package_id text,
  expected_status text,
  decision text,
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
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'review_selection'
  );
  return projectceo_product._transition_approval_package(
    v_context.organization_id,
    v_context.actor_user_id,
    v_context.actor_id,
    'review_approval_package',
    project_id,
    approval_package_id,
    expected_status,
    decision,
    reason,
    expected_state_revision,
    idempotency_key
  );
end
$function$;

create function projectceo_product_api.publish_project_baseline(
  project_id uuid,
  descriptor jsonb,
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
  v_baseline_id text;
  v_graph_version_id text;
  v_previous_baseline_id text;
  v_current_baseline_id text;
  v_version_no bigint;
  v_package_ids text[];
  v_source_ids text[];
  v_requirement_ids text[];
  v_assumption_ids text[];
  v_decision_ids text[];
  v_selection_ids text[];
  v_approval_ids text[];
  v_semantic_content jsonb;
  v_semantic_digest bytea;
  v_expected_digest bytea;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'publish_baseline'
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if jsonb_typeof(descriptor) <> 'object' then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"descriptor"}'::jsonb
    );
  end if;

  v_baseline_id := projectceo_product._assert_text(
    descriptor ->> 'id',
    'descriptor.id',
    160
  );
  v_graph_version_id := projectceo_product._assert_text(
    descriptor ->> 'graphVersionId',
    'descriptor.graphVersionId',
    160
  );
  v_previous_baseline_id := nullif(
    btrim(coalesce(descriptor ->> 'previousBaselineId', '')),
    ''
  );
  v_package_ids := projectceo_product._sorted_unique_text_array(
    descriptor -> 'packageIds',
    'descriptor.packageIds',
    false
  );
  v_source_ids := projectceo_product._sorted_unique_text_array(
    descriptor -> 'sourceRevisionIds',
    'descriptor.sourceRevisionIds'
  );
  v_requirement_ids := projectceo_product._sorted_unique_text_array(
    descriptor -> 'requirementRevisionIds',
    'descriptor.requirementRevisionIds'
  );
  v_assumption_ids := projectceo_product._sorted_unique_text_array(
    descriptor -> 'assumptionRevisionIds',
    'descriptor.assumptionRevisionIds'
  );
  v_decision_ids := projectceo_product._sorted_unique_text_array(
    descriptor -> 'decisionRevisionIds',
    'descriptor.decisionRevisionIds'
  );
  v_selection_ids := projectceo_product._sorted_unique_text_array(
    descriptor -> 'selectionRevisionIds',
    'descriptor.selectionRevisionIds'
  );
  v_approval_ids := projectceo_product._sorted_unique_text_array(
    descriptor -> 'approvalPackageIds',
    'descriptor.approvalPackageIds',
    (
      cardinality(v_requirement_ids)
      + cardinality(v_assumption_ids)
      + cardinality(v_decision_ids)
      + cardinality(v_selection_ids)
    ) = 0
  );
  v_expected_digest := projectceo_product._assert_semantic_hash(
    descriptor ->> 'semanticHash'
  );

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'descriptor', descriptor,
      'expectedStateRevision', expected_state_revision,
      'projectId', project_id
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'publish_project_baseline',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select pb.baseline_id into v_current_baseline_id
  from projectceo_product.project_baselines pb
  where pb.organization_id = v_context.organization_id
    and pb.project_id = project_id
  order by pb.version_no desc
  limit 1
  for update;
  if v_current_baseline_id is distinct from v_previous_baseline_id then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object(
        'currentBaselineId',
        v_current_baseline_id
      )
    );
  end if;
  select coalesce(max(pb.version_no), 0) + 1 into v_version_no
  from projectceo_product.project_baselines pb
  where pb.organization_id = v_context.organization_id
    and pb.project_id = project_id;

  if not exists (
    select 1
    from project_intelligence.project_versions pv
    where pv.organization_id = v_context.organization_id
      and pv.project_id = project_id
      and pv.version_id = v_graph_version_id
  ) then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"graphVersion"}'::jsonb
    );
  end if;
  if (
    select count(*)
    from projectceo_foundation.project_packages pp
    where pp.organization_id = v_context.organization_id
      and pp.project_id = project_id
      and pp.id = any(v_package_ids::uuid[])
      and pp.status = 'active'
  ) <> cardinality(v_package_ids) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"BASELINE_PACKAGE_SCOPE_INVALID"}'::jsonb
    );
  end if;

  if exists (
    select 1
    from (
      select 'source'::text as kind, unnest(v_source_ids) as revision_id
      union all
      select 'requirement', unnest(v_requirement_ids)
      union all
      select 'assumption', unnest(v_assumption_ids)
      union all
      select 'decision', unnest(v_decision_ids)
      union all
      select 'selection', unnest(v_selection_ids)
    ) required
    where not exists (
      select 1
      from project_intelligence.version_nodes vn
      join project_intelligence.graph_nodes gn
        on gn.organization_id = vn.organization_id
       and gn.project_id = vn.project_id
       and gn.node_id = vn.node_id
       and gn.kind = required.kind
      where vn.organization_id = v_context.organization_id
        and vn.project_id = project_id
        and vn.version_id = v_graph_version_id
        and vn.revision_id = required.revision_id
    )
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"BASELINE_REVISION_NOT_IN_GRAPH_VERSION"}'::jsonb
    );
  end if;
  if exists (
    select 1
    from (
      select 'decision'::text as kind, unnest(v_decision_ids) revision_id
      union all
      select 'selection', unnest(v_selection_ids)
    ) product_ref
    where not exists (
      select 1
      from projectceo_product.claim_revision_descriptors crd
      where crd.organization_id = v_context.organization_id
        and crd.project_id = project_id
        and crd.kind = product_ref.kind
        and crd.revision_id = product_ref.revision_id
        and crd.package_id::text = any(v_package_ids)
    )
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"BASELINE_PRODUCT_REVISION_SCOPE_INVALID"}'::jsonb
    );
  end if;

  if (
    select count(*)
    from unnest(v_approval_ids) approval_id
    where exists (
      select 1
      from projectceo_product.approval_packages ap
      join lateral (
        select ape.to_status
        from projectceo_product.approval_package_events ape
        where ape.organization_id = ap.organization_id
          and ape.project_id = ap.project_id
          and ape.approval_package_id = ap.approval_package_id
        order by ape.sequence_no desc
        limit 1
      ) current_event on true
      where ap.organization_id = v_context.organization_id
        and ap.project_id = project_id
        and ap.approval_package_id = approval_id
        and ap.package_id::text = any(v_package_ids)
        and current_event.to_status = 'approved'
    )
  ) <> cardinality(v_approval_ids) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"BASELINE_APPROVAL_PACKAGE_INVALID"}'::jsonb
    );
  end if;
  if exists (
    select required.target_kind, required.revision_id
    from (
      select
        'requirement_revision'::text target_kind,
        unnest(v_requirement_ids) revision_id
      union all
      select 'assumption_revision', unnest(v_assumption_ids)
      union all
      select 'decision_revision', unnest(v_decision_ids)
      union all
      select 'selection_revision', unnest(v_selection_ids)
    ) required
    where not exists (
      select 1
      from projectceo_product.approval_package_items api
      join projectceo_product.approval_package_events approved
        on approved.organization_id = api.organization_id
       and approved.project_id = api.project_id
       and approved.approval_package_id = api.approval_package_id
       and approved.to_status = 'approved'
      where api.organization_id = v_context.organization_id
        and api.project_id = project_id
        and api.approval_package_id = any(v_approval_ids)
        and api.target_kind = required.target_kind
        and api.revision_id = required.revision_id
    )
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"BASELINE_REVISION_NOT_APPROVED"}'::jsonb
    );
  end if;

  select jsonb_build_object(
    'approvalPackageIds', to_jsonb(v_approval_ids),
    'assumptionRevisionIds', to_jsonb(v_assumption_ids),
    'decisionRevisionIds', to_jsonb(v_decision_ids),
    'graphVersionId', v_graph_version_id,
    'organizationId', v_context.organization_id,
    'packageIds', to_jsonb(v_package_ids),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pp.id,
        'kind', pp.kind,
        'parentPackageId', pp.parent_package_id,
        'stableKey', pp.stable_key
      ) order by pp.id::text collate "C")
      from projectceo_foundation.project_packages pp
      where pp.organization_id = v_context.organization_id
        and pp.project_id = project_id
        and pp.id = any(v_package_ids::uuid[])
    ), '[]'::jsonb),
    'previousBaselineId', v_previous_baseline_id,
    'projectId', project_id,
    'requirementRevisionIds', to_jsonb(v_requirement_ids),
    'schemaVersion', 'project-ceo-baseline/0.1',
    'selectionRevisionIds', to_jsonb(v_selection_ids),
    'sourceRevisionIds', to_jsonb(v_source_ids)
  ) into v_semantic_content;
  v_semantic_digest :=
    project_intelligence._sha256_jsonb(v_semantic_content);
  if v_semantic_digest <> v_expected_digest then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object(
        'actualSemanticHash',
        'sha256:' || encode(v_semantic_digest, 'hex'),
        'reason',
        'BASELINE_SEMANTIC_HASH_MISMATCH'
      )
    );
  end if;

  insert into projectceo_product.project_baselines (
    organization_id,
    project_id,
    baseline_id,
    version_no,
    previous_baseline_id,
    graph_version_id,
    semantic_content,
    semantic_digest,
    published_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    v_baseline_id,
    v_version_no,
    v_previous_baseline_id,
    v_graph_version_id,
    v_semantic_content,
    v_semantic_digest,
    v_context.actor_user_id
  );
  insert into projectceo_product.project_baseline_packages (
    organization_id,
    project_id,
    baseline_id,
    package_id
  )
  select
    v_context.organization_id,
    project_id,
    v_baseline_id,
    package_id::uuid
  from unnest(v_package_ids) package_id
  order by package_id collate "C";
  insert into projectceo_product.project_baseline_refs (
    organization_id,
    project_id,
    baseline_id,
    target_kind,
    entity_id,
    revision_id,
    ordinal
  )
  select
    v_context.organization_id,
    project_id,
    v_baseline_id,
    refs.target_kind,
    vn.node_id,
    refs.revision_id,
    refs.ordinal
  from (
    select
      'source_revision'::text target_kind,
      revision_id,
      ordinality - 1 ordinal
    from unnest(v_source_ids) with ordinality source_ref(
      revision_id,
      ordinality
    )
    union all
    select
      'requirement_revision',
      revision_id,
      ordinality - 1
    from unnest(v_requirement_ids) with ordinality requirement_ref(
      revision_id,
      ordinality
    )
    union all
    select
      'assumption_revision',
      revision_id,
      ordinality - 1
    from unnest(v_assumption_ids) with ordinality assumption_ref(
      revision_id,
      ordinality
    )
    union all
    select
      'decision_revision',
      revision_id,
      ordinality - 1
    from unnest(v_decision_ids) with ordinality decision_ref(
      revision_id,
      ordinality
    )
    union all
    select
      'selection_revision',
      revision_id,
      ordinality - 1
    from unnest(v_selection_ids) with ordinality selection_ref(
      revision_id,
      ordinality
    )
  ) refs
  join project_intelligence.version_nodes vn
    on vn.organization_id = v_context.organization_id
   and vn.project_id = project_id
   and vn.version_id = v_graph_version_id
   and vn.revision_id = refs.revision_id
  order by refs.target_kind collate "C", refs.ordinal;
  insert into projectceo_product.project_baseline_approvals (
    organization_id,
    project_id,
    baseline_id,
    approval_package_id
  )
  select
    v_context.organization_id,
    project_id,
    v_baseline_id,
    approval_id
  from unnest(v_approval_ids) approval_id
  order by approval_id collate "C";

  v_result := jsonb_build_object(
    'graphVersionId', v_graph_version_id,
    'id', v_baseline_id,
    'organizationId', v_context.organization_id,
    'previousBaselineId', v_previous_baseline_id,
    'projectId', project_id,
    'publishedAt', statement_timestamp(),
    'publishedBy', jsonb_build_object(
      'actorId', v_context.actor_id,
      'actorType', 'human'
    ),
    'semanticContent', v_semantic_content,
    'semanticHash', 'sha256:' || encode(v_semantic_digest, 'hex'),
    'status', 'published',
    'versionNo', v_version_no
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'publish_project_baseline',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'project_baseline_published',
    jsonb_build_object(
      'baseline_id', v_baseline_id,
      'graph_version_id', v_graph_version_id,
      'semantic_hash',
        'sha256:' || encode(v_semantic_digest, 'hex'),
      'version_no', v_version_no
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.publish_production_package_version(
  project_id uuid,
  descriptor jsonb,
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
  v_version_id text;
  v_package_id uuid;
  v_package_kind text;
  v_baseline_id text;
  v_previous_version_id text;
  v_current_version_id text;
  v_version_no bigint;
  v_source_ids text[];
  v_requirement_ids text[];
  v_assumption_ids text[];
  v_decision_ids text[];
  v_selection_ids text[];
  v_total_ref_count bigint;
  v_baseline_ref_count bigint;
  v_semantic_content jsonb;
  v_semantic_digest bytea;
  v_expected_digest bytea;
  v_result jsonb;
begin
  if jsonb_typeof(descriptor) <> 'object'
     or jsonb_typeof(descriptor -> 'exactRevisionRefs') <> 'object' then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"descriptor"}'::jsonb
    );
  end if;
  v_version_id := projectceo_product._assert_text(
    descriptor ->> 'id',
    'descriptor.id',
    160
  );
  begin
    v_package_id := (descriptor ->> 'packageId')::uuid;
  exception when others then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"descriptor.packageId"}'::jsonb
    );
  end;
  v_baseline_id := projectceo_product._assert_text(
    descriptor ->> 'baselineId',
    'descriptor.baselineId',
    160
  );
  v_previous_version_id := nullif(
    btrim(coalesce(descriptor ->> 'previousVersionId', '')),
    ''
  );
  v_source_ids := projectceo_product._sorted_unique_text_array(
    descriptor #> '{exactRevisionRefs,sources}',
    'descriptor.exactRevisionRefs.sources'
  );
  v_requirement_ids := projectceo_product._sorted_unique_text_array(
    descriptor #> '{exactRevisionRefs,requirements}',
    'descriptor.exactRevisionRefs.requirements'
  );
  v_assumption_ids := projectceo_product._sorted_unique_text_array(
    descriptor #> '{exactRevisionRefs,assumptions}',
    'descriptor.exactRevisionRefs.assumptions'
  );
  v_decision_ids := projectceo_product._sorted_unique_text_array(
    descriptor #> '{exactRevisionRefs,decisions}',
    'descriptor.exactRevisionRefs.decisions'
  );
  v_selection_ids := projectceo_product._sorted_unique_text_array(
    descriptor #> '{exactRevisionRefs,selections}',
    'descriptor.exactRevisionRefs.selections'
  );
  v_total_ref_count :=
    cardinality(v_source_ids)
    + cardinality(v_requirement_ids)
    + cardinality(v_assumption_ids)
    + cardinality(v_decision_ids)
    + cardinality(v_selection_ids);
  if v_total_ref_count = 0 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"PACKAGE_VERSION_REFS_REQUIRED"}'::jsonb
    );
  end if;
  v_expected_digest := projectceo_product._assert_semantic_hash(
    descriptor ->> 'semanticHash'
  );

  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_package_id,
    'publish_release'
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'descriptor', descriptor,
      'expectedStateRevision', expected_state_revision,
      'projectId', project_id
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'publish_production_package_version',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select pp.kind into v_package_kind
  from projectceo_foundation.project_packages pp
  where pp.organization_id = v_context.organization_id
    and pp.project_id = project_id
    and pp.id = v_package_id
    and pp.status = 'active'
  for update;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"package"}'::jsonb
    );
  end if;
  if not exists (
    select 1
    from projectceo_product.project_baseline_packages pbp
    where pbp.organization_id = v_context.organization_id
      and pbp.project_id = project_id
      and pbp.baseline_id = v_baseline_id
      and pbp.package_id = v_package_id
  ) then
    perform projectceo_product._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"PACKAGE_NOT_IN_BASELINE"}'::jsonb
    );
  end if;

  select ppv.production_package_version_id
  into v_current_version_id
  from projectceo_product.production_package_versions ppv
  where ppv.organization_id = v_context.organization_id
    and ppv.project_id = project_id
    and ppv.package_id = v_package_id
  order by ppv.version_no desc
  limit 1
  for update;
  if v_current_version_id is distinct from v_previous_version_id then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentVersionId', v_current_version_id)
    );
  end if;
  select coalesce(max(ppv.version_no), 0) + 1
  into v_version_no
  from projectceo_product.production_package_versions ppv
  where ppv.organization_id = v_context.organization_id
    and ppv.project_id = project_id
    and ppv.package_id = v_package_id;

  if exists (
    select 1
    from (
      select 'source_revision'::text target_kind,
        unnest(v_source_ids) revision_id
      union all
      select 'requirement_revision', unnest(v_requirement_ids)
      union all
      select 'assumption_revision', unnest(v_assumption_ids)
      union all
      select 'decision_revision', unnest(v_decision_ids)
      union all
      select 'selection_revision', unnest(v_selection_ids)
    ) requested
    where not exists (
      select 1
      from projectceo_product.project_baseline_refs pbr
      where pbr.organization_id = v_context.organization_id
        and pbr.project_id = project_id
        and pbr.baseline_id = v_baseline_id
        and pbr.target_kind = requested.target_kind
        and pbr.revision_id = requested.revision_id
    )
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"PACKAGE_REF_NOT_IN_BASELINE"}'::jsonb
    );
  end if;

  select count(*) into v_baseline_ref_count
  from projectceo_product.project_baseline_refs pbr
  where pbr.organization_id = v_context.organization_id
    and pbr.project_id = project_id
    and pbr.baseline_id = v_baseline_id;
  if v_package_kind = 'project_root'
     and v_total_ref_count <> v_baseline_ref_count then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"ROOT_PACKAGE_REQUIRES_FULL_BASELINE"}'::jsonb
    );
  end if;

  v_semantic_content := jsonb_build_object(
    'baselineId', v_baseline_id,
    'exactRevisionRefs', jsonb_build_object(
      'assumptions', to_jsonb(v_assumption_ids),
      'decisions', to_jsonb(v_decision_ids),
      'requirements', to_jsonb(v_requirement_ids),
      'selections', to_jsonb(v_selection_ids),
      'sources', to_jsonb(v_source_ids)
    ),
    'organizationId', v_context.organization_id,
    'packageId', v_package_id,
    'previousVersionId', v_previous_version_id,
    'projectId', project_id,
    'schemaVersion', 'project-ceo-production-package/0.1'
  );
  v_semantic_digest :=
    project_intelligence._sha256_jsonb(v_semantic_content);
  if v_semantic_digest <> v_expected_digest then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object(
        'actualSemanticHash',
        'sha256:' || encode(v_semantic_digest, 'hex'),
        'reason',
        'PACKAGE_VERSION_SEMANTIC_HASH_MISMATCH'
      )
    );
  end if;

  insert into projectceo_product.production_package_versions (
    organization_id,
    project_id,
    production_package_version_id,
    package_id,
    baseline_id,
    version_no,
    previous_version_id,
    semantic_content,
    semantic_digest,
    published_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    v_version_id,
    v_package_id,
    v_baseline_id,
    v_version_no,
    v_previous_version_id,
    v_semantic_content,
    v_semantic_digest,
    v_context.actor_user_id
  );
  insert into projectceo_product.production_package_version_refs (
    organization_id,
    project_id,
    production_package_version_id,
    baseline_id,
    target_kind,
    revision_id,
    ordinal
  )
  select
    v_context.organization_id,
    project_id,
    v_version_id,
    v_baseline_id,
    refs.target_kind,
    refs.revision_id,
    refs.ordinal
  from (
    select 'source_revision'::text target_kind,
      revision_id, ordinality - 1 ordinal
    from unnest(v_source_ids) with ordinality source_ref(
      revision_id, ordinality
    )
    union all
    select 'requirement_revision',
      revision_id, ordinality - 1
    from unnest(v_requirement_ids) with ordinality requirement_ref(
      revision_id, ordinality
    )
    union all
    select 'assumption_revision',
      revision_id, ordinality - 1
    from unnest(v_assumption_ids) with ordinality assumption_ref(
      revision_id, ordinality
    )
    union all
    select 'decision_revision',
      revision_id, ordinality - 1
    from unnest(v_decision_ids) with ordinality decision_ref(
      revision_id, ordinality
    )
    union all
    select 'selection_revision',
      revision_id, ordinality - 1
    from unnest(v_selection_ids) with ordinality selection_ref(
      revision_id, ordinality
    )
  ) refs
  order by refs.target_kind collate "C", refs.ordinal;

  v_result := jsonb_build_object(
    'baselineId', v_baseline_id,
    'exactRevisionRefs', v_semantic_content -> 'exactRevisionRefs',
    'id', v_version_id,
    'organizationId', v_context.organization_id,
    'packageId', v_package_id,
    'previousVersionId', v_previous_version_id,
    'projectId', project_id,
    'publishedAt', statement_timestamp(),
    'publishedBy', jsonb_build_object(
      'actorId', v_context.actor_id,
      'actorType', 'human'
    ),
    'semanticHash', 'sha256:' || encode(v_semantic_digest, 'hex'),
    'status', 'published',
    'versionNo', v_version_no
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'publish_production_package_version',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'production_package_version_published',
    jsonb_build_object(
      'baseline_id', v_baseline_id,
      'package_id', v_package_id,
      'production_package_version_id', v_version_id,
      'semantic_hash',
        'sha256:' || encode(v_semantic_digest, 'hex'),
      'version_no', v_version_no
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.build_release_artifact(
  project_id uuid,
  artifact jsonb,
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
  v_organization_id uuid;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_artifact_id text;
  v_version_id text;
  v_version projectceo_product.production_package_versions%rowtype;
  v_logical_content jsonb;
  v_semantic_digest bytea;
  v_expected_digest bytea;
  v_existing projectceo_product.release_artifacts%rowtype;
  v_outcome text := 'created';
  v_result jsonb;
begin
  v_organization_id := projectceo_product._system_context(project_id);
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if jsonb_typeof(artifact) <> 'object'
     or artifact ->> 'format' is distinct from 'logical_json' then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"RELEASE_ARTIFACT_CONTRACT_INVALID"}'::jsonb
    );
  end if;
  v_artifact_id := projectceo_product._assert_text(
    artifact ->> 'artifactId',
    'artifact.artifactId',
    160
  );
  v_version_id := projectceo_product._assert_text(
    artifact ->> 'productionPackageVersionId',
    'artifact.productionPackageVersionId',
    160
  );
  v_expected_digest := projectceo_product._assert_semantic_hash(
    artifact ->> 'semanticHash',
    'artifact.semanticHash'
  );

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'artifact', artifact,
      'expectedStateRevision', expected_state_revision,
      'projectId', project_id
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_organization_id,
    project_id,
    'build_release_artifact',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select * into v_version
  from projectceo_product.production_package_versions ppv
  where ppv.organization_id = v_organization_id
    and ppv.project_id = project_id
    and ppv.production_package_version_id = v_version_id
  for update;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"productionPackageVersion"}'::jsonb
    );
  end if;

  v_logical_content := jsonb_build_object(
    'artifacts', jsonb_build_array(jsonb_build_object(
      'contentHash',
        'sha256:' || encode(v_version.semantic_digest, 'hex'),
      'kind',
        'logical_json'
    )),
    'baselineId', v_version.baseline_id,
    'exactRevisionRefs',
      v_version.semantic_content -> 'exactRevisionRefs',
    'organizationId', v_organization_id,
    'packageId', v_version.package_id,
    'productionPackageSemanticHash',
      'sha256:' || encode(v_version.semantic_digest, 'hex'),
    'productionPackageVersionId', v_version_id,
    'projectId', project_id,
    'schemaVersion', 'project-ceo-release/0.1'
  );
  v_semantic_digest :=
    project_intelligence._sha256_jsonb(v_logical_content);
  if v_semantic_digest <> v_expected_digest then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      jsonb_build_object(
        'actualSemanticHash',
        'sha256:' || encode(v_semantic_digest, 'hex'),
        'reason',
        'RELEASE_SEMANTIC_HASH_MISMATCH'
      )
    );
  end if;

  select * into v_existing
  from projectceo_product.release_artifacts ra
  where ra.organization_id = v_organization_id
    and ra.project_id = project_id
    and ra.package_id = v_version.package_id
    and ra.production_package_version_id = v_version_id
    and ra.format = 'logical_json'
    and ra.semantic_digest = v_semantic_digest
  for update;
  if found then
    v_outcome := 'existing_artifact';
  else
    if exists (
      select 1
      from projectceo_product.release_artifacts ra
      where ra.organization_id = v_organization_id
        and ra.project_id = project_id
        and ra.artifact_id = v_artifact_id
    ) then
      perform projectceo_product._raise(
        'P1108',
        'idempotency_conflict',
        '{"reason":"ARTIFACT_ID_REUSED"}'::jsonb
      );
    end if;
    insert into projectceo_product.release_artifacts (
      organization_id,
      project_id,
      artifact_id,
      package_id,
      production_package_version_id,
      format,
      logical_content,
      semantic_digest,
      created_by_type,
      created_by_user_id,
      created_by_id
    )
    values (
      v_organization_id,
      project_id,
      v_artifact_id,
      v_version.package_id,
      v_version_id,
      'logical_json',
      v_logical_content,
      v_semantic_digest,
      'system',
      null,
      'system:projectceo-product-worker'
    )
    returning * into v_existing;
  end if;

  v_result := jsonb_build_object(
    'artifact', jsonb_build_object(
      'format', v_existing.format,
      'id', v_existing.artifact_id,
      'productionPackageVersionId',
        v_existing.production_package_version_id,
      'semanticHash',
        'sha256:' || encode(v_existing.semantic_digest, 'hex')
    ),
    'kind', v_outcome,
    'logicalContent', v_existing.logical_content
  );
  return projectceo_product._complete_command(
    v_organization_id,
    project_id,
    'build_release_artifact',
    v_key_digest,
    v_request_digest,
    'system',
    'system:projectceo-product-worker',
    null,
    v_result,
    'release_artifact_built',
    jsonb_build_object(
      'artifact_id', v_existing.artifact_id,
      'outcome', v_outcome,
      'package_id', v_existing.package_id,
      'production_package_version_id',
        v_existing.production_package_version_id,
      'semantic_hash',
        'sha256:' || encode(v_existing.semantic_digest, 'hex')
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.distribute_release(
  project_id uuid,
  artifact_id text,
  recipient_user_id uuid,
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
  v_artifact projectceo_product.release_artifacts%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_distribution projectceo_product.release_distributions%rowtype;
  v_outcome text := 'created';
  v_result jsonb;
begin
  perform projectceo_product._assert_text(
    artifact_id,
    'artifactId',
    160
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  select * into v_artifact
  from projectceo_product.release_artifacts ra
  where ra.project_id = project_id
    and ra.artifact_id = artifact_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"releaseArtifact"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_artifact.package_id,
    'distribute_release'
  );

  if not (
    exists (
      select 1
      from projectceo_foundation.project_memberships pm
      where pm.organization_id = v_context.organization_id
        and pm.project_id = project_id
        and pm.user_id = recipient_user_id
        and pm.status = 'active'
    )
    or exists (
      select 1
      from projectceo_foundation.package_memberships pm
      where pm.organization_id = v_context.organization_id
        and pm.project_id = project_id
        and pm.package_id = v_artifact.package_id
        and pm.user_id = recipient_user_id
        and pm.status = 'active'
    )
  ) then
    perform projectceo_product._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"RECIPIENT_SCOPE_REQUIRED"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'artifactId', artifact_id,
      'expectedStateRevision', expected_state_revision,
      'projectId', project_id,
      'recipientUserId', recipient_user_id
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'distribute_release',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select * into v_distribution
  from projectceo_product.release_distributions rd
  where rd.organization_id = v_context.organization_id
    and rd.project_id = project_id
    and rd.package_id = v_artifact.package_id
    and rd.production_package_version_id =
      v_artifact.production_package_version_id
    and rd.recipient_user_id = recipient_user_id
  for update;
  if found then
    v_outcome := 'existing_distribution';
  else
    insert into projectceo_product.release_distributions (
      organization_id,
      project_id,
      package_id,
      artifact_id,
      production_package_version_id,
      artifact_semantic_digest,
      recipient_user_id,
      distributed_by_user_id
    )
    values (
      v_context.organization_id,
      project_id,
      v_artifact.package_id,
      v_artifact.artifact_id,
      v_artifact.production_package_version_id,
      v_artifact.semantic_digest,
      recipient_user_id,
      v_context.actor_user_id
    )
    returning * into v_distribution;
  end if;

  v_result := jsonb_build_object(
    'artifactId', v_distribution.artifact_id,
    'distributionId', v_distribution.distribution_id,
    'kind', v_outcome,
    'packageId', v_distribution.package_id,
    'productionPackageVersionId',
      v_distribution.production_package_version_id,
    'recipientUserId', v_distribution.recipient_user_id
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'distribute_release',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'release_distributed',
    jsonb_build_object(
      'artifact_id', v_distribution.artifact_id,
      'distribution_id', v_distribution.distribution_id,
      'outcome', v_outcome,
      'package_id', v_distribution.package_id,
      'production_package_version_id',
        v_distribution.production_package_version_id
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.acknowledge_release(
  project_id uuid,
  distribution_id uuid,
  expected_semantic_hash text,
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
  v_distribution projectceo_product.release_distributions%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_expected_digest bytea;
  v_ack projectceo_product.release_acknowledgements%rowtype;
  v_result jsonb;
begin
  v_expected_digest := projectceo_product._assert_semantic_hash(
    expected_semantic_hash
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  select * into v_distribution
  from projectceo_product.release_distributions rd
  where rd.project_id = project_id
    and rd.distribution_id = distribution_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"releaseDistribution"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_distribution.package_id,
    'acknowledge_release'
  );
  if v_context.actor_user_id <> v_distribution.recipient_user_id then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"DISTRIBUTION_RECIPIENT_REQUIRED"}'::jsonb
    );
  end if;
  if v_expected_digest <> v_distribution.artifact_semantic_digest then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      '{"reason":"RELEASE_HASH_STALE"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'distributionId', distribution_id,
      'expectedSemanticHash', expected_semantic_hash,
      'expectedStateRevision', expected_state_revision,
      'projectId', project_id
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'acknowledge_release',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;
  if exists (
    select 1
    from projectceo_product.release_acknowledgements ra
    where ra.organization_id = v_context.organization_id
      and ra.project_id = project_id
      and ra.distribution_id = distribution_id
  ) then
    perform projectceo_product._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"RELEASE_ALREADY_ACKNOWLEDGED"}'::jsonb
    );
  end if;

  insert into projectceo_product.release_acknowledgements (
    organization_id,
    project_id,
    distribution_id,
    package_id,
    production_package_version_id,
    artifact_semantic_digest,
    acknowledged_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    distribution_id,
    v_distribution.package_id,
    v_distribution.production_package_version_id,
    v_distribution.artifact_semantic_digest,
    v_context.actor_user_id
  )
  returning * into v_ack;
  v_result := jsonb_build_object(
    'acknowledgedAt', v_ack.acknowledged_at,
    'acknowledgementId', v_ack.acknowledgement_id,
    'distributionId', v_ack.distribution_id,
    'packageId', v_ack.package_id,
    'productionPackageVersionId',
      v_ack.production_package_version_id,
    'semanticHash',
      'sha256:' || encode(v_ack.artifact_semantic_digest, 'hex')
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'acknowledge_release',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'release_acknowledged',
    jsonb_build_object(
      'acknowledgement_id', v_ack.acknowledgement_id,
      'distribution_id', v_ack.distribution_id,
      'package_id', v_ack.package_id,
      'production_package_version_id',
        v_ack.production_package_version_id,
      'semantic_hash',
        'sha256:' || encode(v_ack.artifact_semantic_digest, 'hex')
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.approve_no_change(
  project_id uuid,
  production_package_version_id text,
  baseline_id text,
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
  v_version projectceo_product.production_package_versions%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_reason text;
  v_terminal projectceo_product.no_change_terminals%rowtype;
  v_result jsonb;
begin
  perform projectceo_product._assert_text(
    production_package_version_id,
    'productionPackageVersionId',
    160
  );
  perform projectceo_product._assert_text(
    baseline_id,
    'baselineId',
    160
  );
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  select * into v_version
  from projectceo_product.production_package_versions ppv
  where ppv.project_id = project_id
    and ppv.production_package_version_id =
      production_package_version_id
    and ppv.baseline_id = baseline_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"productionPackageVersion"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_version.package_id,
    'review_change_impact'
  );

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'baselineId', baseline_id,
      'expectedStateRevision', expected_state_revision,
      'productionPackageVersionId', production_package_version_id,
      'projectId', project_id,
      'reason', v_reason
    )
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'approve_no_change',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  insert into projectceo_product.no_change_terminals (
    organization_id,
    project_id,
    package_id,
    baseline_id,
    production_package_version_id,
    reason,
    reason_digest,
    approved_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    v_version.package_id,
    baseline_id,
    production_package_version_id,
    v_reason,
    project_intelligence._sha256_text(v_reason),
    v_context.actor_user_id
  )
  returning * into v_terminal;
  v_result := jsonb_build_object(
    'approvedAt', v_terminal.approved_at,
    'approvedBy', jsonb_build_object(
      'actorId', v_context.actor_id,
      'actorType', 'human'
    ),
    'baselineId', baseline_id,
    'productionPackageVersionId', production_package_version_id,
    'status', 'approved_no_change'
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'approve_no_change',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'no_change_approved',
    jsonb_build_object(
      'baseline_id', baseline_id,
      'no_change_id', v_terminal.no_change_id,
      'package_id', v_version.package_id,
      'production_package_version_id',
        production_package_version_id
    ),
    v_state_revision
  );
end
$function$;

create or replace function projectceo_api.get_project_delivery(
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
  v_context record;
  v_project_wide boolean;
  v_baseline_id text;
  v_data jsonb;
begin
  if package_id is null then
    select *, true as project_wide into v_context
    from projectceo_foundation._authorize_project_human(
      project_id,
      'view_project'
    );
    v_project_wide := true;
    select pb.baseline_id into v_baseline_id
    from projectceo_product.project_baselines pb
    where pb.organization_id = v_context.organization_id
      and pb.project_id = project_id
    order by pb.version_no desc
    limit 1;
  else
    select * into v_context
    from projectceo_foundation._authorize_package_human(
      project_id,
      package_id,
      'view_project'
    );
    v_project_wide := v_context.project_wide;
    select ppv.baseline_id into v_baseline_id
    from projectceo_product.production_package_versions ppv
    where ppv.organization_id = v_context.organization_id
      and ppv.project_id = project_id
      and ppv.package_id = package_id
    order by ppv.version_no desc
    limit 1;
  end if;

  select jsonb_build_object(
    'acknowledgements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acknowledgedAt', ra.acknowledged_at,
        'distributionId', ra.distribution_id,
        'packageId', ra.package_id,
        'productionPackageVersionId',
          ra.production_package_version_id,
        'semanticHash',
          'sha256:' || encode(ra.artifact_semantic_digest, 'hex')
      ) order by ra.acknowledged_at desc)
      from projectceo_product.release_acknowledgements ra
      where ra.organization_id = v_context.organization_id
        and ra.project_id = project_id
        and (package_id is null or ra.package_id = package_id)
    ), '[]'::jsonb),
    'distributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acknowledged', exists (
          select 1
          from projectceo_product.release_acknowledgements ack
          where ack.organization_id = rd.organization_id
            and ack.project_id = rd.project_id
            and ack.distribution_id = rd.distribution_id
        ),
        'artifactId', rd.artifact_id,
        'distributedAt', rd.distributed_at,
        'distributionId', rd.distribution_id,
        'packageId', rd.package_id,
        'productionPackageVersionId',
          rd.production_package_version_id,
        'semanticHash',
          'sha256:' || encode(rd.artifact_semantic_digest, 'hex')
      ) order by rd.distributed_at desc)
      from projectceo_product.release_distributions rd
      where rd.organization_id = v_context.organization_id
        and rd.project_id = project_id
        and (package_id is null or rd.package_id = package_id)
    ), '[]'::jsonb),
    'extensionStatus', jsonb_build_object(
      'guestAcknowledgement', 'deferred_exact_grant_command',
      'productionPackageVersions', 'durable',
      'projectBaselines', 'durable',
      'releaseArtifacts', 'logical_json_p0'
    ),
    'latestBaseline', (
      select jsonb_build_object(
        'graphVersionId', pb.graph_version_id,
        'id', pb.baseline_id,
        'previousBaselineId', pb.previous_baseline_id,
        'publishedAt', pb.published_at,
        'semanticContent', pb.semantic_content,
        'semanticHash',
          'sha256:' || encode(pb.semantic_digest, 'hex'),
        'status', 'published',
        'versionNo', pb.version_no
      )
      from projectceo_product.project_baselines pb
      where pb.organization_id = v_context.organization_id
        and pb.project_id = project_id
        and pb.baseline_id = v_baseline_id
    ),
    'noChangeTerminals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'approvedAt', nct.approved_at,
        'baselineId', nct.baseline_id,
        'packageId', nct.package_id,
        'productionPackageVersionId',
          nct.production_package_version_id,
        'status', 'approved_no_change'
      ) order by nct.approved_at desc)
      from projectceo_product.no_change_terminals nct
      where nct.organization_id = v_context.organization_id
        and nct.project_id = project_id
        and (package_id is null or nct.package_id = package_id)
    ), '[]'::jsonb),
    'package', case
      when package_id is null then null
      else (
        select jsonb_build_object(
          'id', pp.id,
          'kind', pp.kind,
          'name', pp.name,
          'parentPackageId', pp.parent_package_id,
          'stableKey', pp.stable_key,
          'status', pp.status
        )
        from projectceo_foundation.project_packages pp
        where pp.organization_id = v_context.organization_id
          and pp.project_id = project_id
          and pp.id = package_id
      )
    end,
    'packageVersions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'baselineId', ppv.baseline_id,
        'exactRevisionRefs',
          ppv.semantic_content -> 'exactRevisionRefs',
        'id', ppv.production_package_version_id,
        'packageId', ppv.package_id,
        'previousVersionId', ppv.previous_version_id,
        'publishedAt', ppv.published_at,
        'semanticHash',
          'sha256:' || encode(ppv.semantic_digest, 'hex'),
        'status', 'published',
        'versionNo', ppv.version_no
      ) order by ppv.package_id::text collate "C", ppv.version_no)
      from projectceo_product.production_package_versions ppv
      where ppv.organization_id = v_context.organization_id
        and ppv.project_id = project_id
        and (package_id is null or ppv.package_id = package_id)
    ), '[]'::jsonb),
    'projectId', project_id,
    'releaseArtifacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'format', ra.format,
        'id', ra.artifact_id,
        'packageId', ra.package_id,
        'productionPackageVersionId',
          ra.production_package_version_id,
        'semanticHash',
          'sha256:' || encode(ra.semantic_digest, 'hex')
      ) order by ra.created_at desc)
      from projectceo_product.release_artifacts ra
      where ra.organization_id = v_context.organization_id
        and ra.project_id = project_id
        and (package_id is null or ra.package_id = package_id)
    ), '[]'::jsonb),
    'unresolvedImpactReviewCount', case
      when v_project_wide then (
        select count(*)
        from project_intelligence.impacts i
        where i.organization_id = v_context.organization_id
          and i.project_id = project_id
          and not exists (
            select 1
            from project_intelligence.impact_reviews ir
            where ir.organization_id = i.organization_id
              and ir.project_id = i.project_id
              and ir.impact_id = i.impact_id
          )
      )
      else 0
    end
  ) into v_data;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

do $function_owners$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (
      'projectceo_product',
      'projectceo_product_api'
    )
  loop
    execute format(
      'alter function %s owner to pi_table_owner',
      v_function
    );
  end loop;
end
$function_owners$;

alter function projectceo_api.get_project_delivery(uuid, uuid)
  owner to pi_table_owner;

revoke all on all functions in schema projectceo_product
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on all functions in schema projectceo_product_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on function projectceo_api.get_project_delivery(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant usage on schema projectceo_product_api
  to authenticated, service_role;

grant execute on function
  projectceo_product_api.append_decision_revision(
    uuid, uuid, text, text, text, text, text, text, text, text,
    jsonb, text, bigint, text
  ),
  projectceo_product_api.append_selection_revision(
    uuid, uuid, text, text, text, text, text, text, text,
    jsonb, jsonb, text, bigint, text
  ),
  projectceo_product_api.append_price_observation(
    uuid, text, text, bigint, jsonb, text, bigint, text
  ),
  projectceo_product_api.create_approval_package(
    uuid, uuid, text, jsonb, bigint, text
  ),
  projectceo_product_api.submit_approval_package(
    uuid, text, text, bigint, text
  ),
  projectceo_product_api.review_approval_package(
    uuid, text, text, text, text, bigint, text
  ),
  projectceo_product_api.publish_project_baseline(
    uuid, jsonb, bigint, text
  ),
  projectceo_product_api.publish_production_package_version(
    uuid, jsonb, bigint, text
  ),
  projectceo_product_api.distribute_release(
    uuid, text, uuid, bigint, text
  ),
  projectceo_product_api.acknowledge_release(
    uuid, uuid, text, bigint, text
  ),
  projectceo_product_api.approve_no_change(
    uuid, text, text, text, bigint, text
  )
  to authenticated;

grant execute on function
  projectceo_product_api.append_system_decision_revision(
    uuid, uuid, text, text, text, text, text, text, text, text,
    jsonb, text, bigint, text
  ),
  projectceo_product_api.append_system_selection_revision(
    uuid, uuid, text, text, text, text, text, text, text,
    jsonb, jsonb, text, bigint, text
  ),
  projectceo_product_api.build_release_artifact(
    uuid, jsonb, bigint, text
  )
  to service_role;

grant execute on function
  projectceo_api.get_project_delivery(uuid, uuid)
  to authenticated;

commit;
