-- Project Intelligence DB2 operations.
--
-- Local additive candidate only. This migration must not be applied to production
-- until the adoption baseline, core DDL and disposable concurrency harness have
-- all been accepted.

begin;

set check_function_bodies = on;

create or replace function project_intelligence._raise_contract_error(
  p_sqlstate text,
  p_message text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = p_sqlstate,
    message = p_message,
    detail = coalesce(p_detail, '{}'::jsonb)::text;
end;
$function$;

create or replace function project_intelligence._sha256_text(p_value text)
returns bytea
language sql
immutable
strict
set search_path = ''
as $function$
  select extensions.digest(convert_to(p_value, 'UTF8'), 'sha256');
$function$;

create or replace function project_intelligence._canonical_jsonb(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
set extra_float_digits = 3
as $function$
declare
  v_type text := jsonb_typeof(p_value);
  v_result text;
  v_number double precision;
  v_number_text text;
  v_sign text := '';
  v_mantissa text;
  v_digits text;
  v_exponent integer;
  v_e_position integer;
  v_decimal_position integer;
begin
  case v_type
    when 'null' then
      return 'null';
    when 'boolean' then
      return p_value::text;
    when 'number' then
      -- The application contract hashes JavaScript Numbers through
      -- JSON.stringify. Convert to IEEE-754 binary64 first, then apply the same
      -- decimal/scientific thresholds (decimal for 1e-6 <= abs < 1e21).
      begin
        v_number := (p_value #>> '{}')::double precision;
      exception
        when numeric_value_out_of_range then
          perform project_intelligence._raise_contract_error(
            'P1011',
            'DOMAIN_CONTRACT_VIOLATION',
            '{"reason":"JSON_NUMBER_OUTSIDE_IEEE754"}'::jsonb
          );
      end;
      v_number_text := v_number::text;
      if v_number_text in ('Infinity', '-Infinity', 'NaN') then
        perform project_intelligence._raise_contract_error(
          'P1011',
          'DOMAIN_CONTRACT_VIOLATION',
          '{"reason":"NON_FINITE_JSON_NUMBER"}'::jsonb
        );
      end if;
      if v_number = 0 then
        return '0';
      end if;

      v_e_position := strpos(lower(v_number_text), 'e');
      if v_e_position = 0 then
        return v_number_text;
      end if;

      v_mantissa := left(v_number_text, v_e_position - 1);
      v_exponent := substring(v_number_text from v_e_position + 1)::integer;
      if left(v_mantissa, 1) = '-' then
        v_sign := '-';
        v_mantissa := substring(v_mantissa from 2);
      end if;
      v_digits := replace(v_mantissa, '.', '');

      if v_exponent >= 21 or v_exponent <= -7 then
        return v_sign
          || left(v_digits, 1)
          || case
               when length(v_digits) > 1 then '.' || substring(v_digits from 2)
               else ''
             end
          || 'e'
          || case when v_exponent >= 0 then '+' else '' end
          || v_exponent::text;
      end if;

      v_decimal_position := v_exponent + 1;
      if v_decimal_position <= 0 then
        return v_sign
          || '0.'
          || repeat('0', -v_decimal_position)
          || v_digits;
      end if;
      if v_decimal_position >= length(v_digits) then
        return v_sign
          || v_digits
          || repeat('0', v_decimal_position - length(v_digits));
      end if;
      return v_sign
        || left(v_digits, v_decimal_position)
        || '.'
        || substring(v_digits from v_decimal_position + 1);
    when 'string' then
      return p_value::text;
    when 'array' then
      select '[' || coalesce(string_agg(
        project_intelligence._canonical_jsonb(element.value),
        ',' order by element.ordinality
      ), '') || ']'
        into v_result
      from jsonb_array_elements(p_value) with ordinality as element(value, ordinality);
      return v_result;
    when 'object' then
      select '{' || coalesce(string_agg(
        to_jsonb(member.key)::text
        || ':'
        || project_intelligence._canonical_jsonb(member.value),
        ',' order by member.key collate "C"
      ), '') || '}'
        into v_result
      from jsonb_each(p_value) as member(key, value);
      return v_result;
    else
      perform project_intelligence._raise_contract_error(
        'P1011',
        'DOMAIN_CONTRACT_VIOLATION',
        '{"reason":"UNSUPPORTED_JSON_TYPE"}'::jsonb
      );
      return null;
  end case;
end;
$function$;

create or replace function project_intelligence._sha256_jsonb(p_value jsonb)
returns bytea
language sql
immutable
strict
set search_path = ''
as $function$
  select project_intelligence._sha256_text(
    project_intelligence._canonical_jsonb(p_value)
  );
$function$;

create or replace function project_intelligence._assert_domain_id(
  p_value text,
  p_field text
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null or length(p_value) < 1 or length(p_value) > 160 then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      jsonb_build_object('field', p_field)
    );
  end if;
  return p_value;
end;
$function$;

create or replace function project_intelligence._assert_idempotency_key(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if length(v_value) < 1 or length(v_value) > 512 then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"field":"idempotency_key"}'::jsonb
    );
  end if;
  return v_value;
end;
$function$;

create or replace function project_intelligence._assert_state_revision(p_value bigint)
returns bigint
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null
     or p_value < 0
     or p_value > 9007199254740991 then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"field":"expected_state_revision"}'::jsonb
    );
  end if;
  return p_value;
end;
$function$;

create or replace function project_intelligence._human_context(
  p_project_id uuid,
  p_capability text
)
returns table (
  organization_id uuid,
  actor_user_id uuid,
  actor_id text
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    perform project_intelligence._raise_contract_error(
      'P1001',
      'ACCESS_DENIED',
      '{"reason":"AUTHENTICATED_HUMAN_REQUIRED"}'::jsonb
    );
  end if;

  select count(*), (array_agg(pw.organization_id order by pw.organization_id::text))[1]
    into v_count, organization_id
  from project_intelligence.project_workflows pw
  join project_intelligence.organizations o
    on o.id = pw.organization_id
   and o.status = 'active'
  join project_intelligence.organization_members om
    on om.organization_id = pw.organization_id
   and om.user_id = v_user_id
   and om.status = 'active'
  join project_intelligence.member_capabilities mc
    on mc.organization_id = om.organization_id
   and mc.user_id = om.user_id
   and mc.capability = p_capability
  where pw.project_id = p_project_id;

  if v_count = 0 then
    perform project_intelligence._raise_contract_error(
      'P1001',
      'ACCESS_DENIED',
      '{"reason":"PROJECT_CAPABILITY_REQUIRED"}'::jsonb
    );
  elsif v_count <> 1 then
    perform project_intelligence._raise_contract_error(
      'P1003',
      'PROJECT_SCOPE_VIOLATION',
      '{"reason":"AMBIGUOUS_PROJECT_SCOPE"}'::jsonb
    );
  end if;

  actor_user_id := v_user_id;
  actor_id := v_user_id::text;
  return next;
end;
$function$;

create or replace function project_intelligence._worker_context(p_project_id uuid)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_count integer;
begin
  select count(*), (array_agg(pw.organization_id order by pw.organization_id::text))[1]
    into v_count, v_organization_id
  from project_intelligence.project_workflows pw
  join project_intelligence.organizations o
    on o.id = pw.organization_id
   and o.status = 'active'
  where pw.project_id = p_project_id;

  if v_count = 0 then
    perform project_intelligence._raise_contract_error(
      'P1002',
      'PROJECT_NOT_FOUND',
      '{}'::jsonb
    );
  elsif v_count <> 1 then
    perform project_intelligence._raise_contract_error(
      'P1003',
      'PROJECT_SCOPE_VIOLATION',
      '{"reason":"AMBIGUOUS_PROJECT_SCOPE"}'::jsonb
    );
  end if;
  return v_organization_id;
end;
$function$;

create or replace function project_intelligence._replay_or_null(
  p_organization_id uuid,
  p_project_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_record project_intelligence.command_records%rowtype;
begin
  select *
    into v_record
  from project_intelligence.command_records cr
  where cr.organization_id = p_organization_id
    and cr.project_id = p_project_id
    and cr.operation = p_operation
    and cr.key_digest = p_key_digest;

  if not found then
    return null;
  end if;
  if v_record.request_digest <> p_request_digest then
    perform project_intelligence._raise_contract_error(
      'P1007',
      'IDEMPOTENCY_CONFLICT',
      jsonb_build_object('operation', p_operation)
    );
  end if;

  return jsonb_build_object(
    'operation', p_operation,
    'replay', true,
    'stateRevision', v_record.resulting_state_revision,
    'result', v_record.logical_result
  );
end;
$function$;

create or replace function project_intelligence._lock_workflow(
  p_organization_id uuid,
  p_project_id uuid
)
returns table (
  state_revision bigint,
  latest_version_id text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  return query
  select pw.state_revision, pw.latest_version_id
  from project_intelligence.project_workflows pw
  where pw.organization_id = p_organization_id
    and pw.project_id = p_project_id
  for update;

  if not found then
    perform project_intelligence._raise_contract_error(
      'P1002',
      'PROJECT_NOT_FOUND',
      '{}'::jsonb
    );
  end if;
end;
$function$;

create or replace function project_intelligence._json_pointer_segment(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select replace(replace(p_value, '~', '~0'), '/', '~1');
$function$;

create or replace function project_intelligence._jsonb_diff_paths(
  p_from jsonb,
  p_to jsonb,
  p_path text default ''
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_paths text[] := array[]::text[];
  v_child_paths text[];
  v_key text;
  v_index integer;
  v_max integer;
  v_child_path text;
begin
  if p_from = p_to then
    return v_paths;
  end if;

  if jsonb_typeof(p_from) = 'object' and jsonb_typeof(p_to) = 'object' then
    for v_key in
      select key
      from (
        select jsonb_object_keys(p_from) as key
        union
        select jsonb_object_keys(p_to) as key
      ) keys
      order by key collate "C"
    loop
      v_child_path := p_path || '/' || project_intelligence._json_pointer_segment(v_key);
      if not (p_from ? v_key) or not (p_to ? v_key) then
        v_paths := array_append(v_paths, v_child_path);
      else
        v_child_paths := project_intelligence._jsonb_diff_paths(
          p_from -> v_key,
          p_to -> v_key,
          v_child_path
        );
        v_paths := v_paths || v_child_paths;
      end if;
    end loop;
    return v_paths;
  end if;

  if jsonb_typeof(p_from) = 'array' and jsonb_typeof(p_to) = 'array' then
    v_max := greatest(jsonb_array_length(p_from), jsonb_array_length(p_to));
    if v_max = 0 then
      return array[p_path];
    end if;
    for v_index in 0..v_max - 1 loop
      v_child_path := p_path || '/' || v_index::text;
      if v_index >= jsonb_array_length(p_from)
         or v_index >= jsonb_array_length(p_to) then
        v_paths := array_append(v_paths, v_child_path);
      else
        v_child_paths := project_intelligence._jsonb_diff_paths(
          p_from -> v_index,
          p_to -> v_index,
          v_child_path
        );
        v_paths := v_paths || v_child_paths;
      end if;
    end loop;
    return v_paths;
  end if;

  return array[p_path];
end;
$function$;

create or replace function project_intelligence._complete_command(
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
  p_previous_state_revision bigint,
  p_set_latest_version boolean default false,
  p_latest_version_id text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_command_id uuid := pg_catalog.gen_random_uuid();
  v_next_state_revision bigint := p_previous_state_revision + 1;
  v_row_count integer;
begin
  if p_previous_state_revision >= 9007199254740991 then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"reason":"STATE_REVISION_EXHAUSTED"}'::jsonb
    );
  end if;

  -- Disposable harness fault injection. The setting is transaction-local and the
  -- exception proves that preceding normalized inserts are rolled back with the
  -- command/audit/root update.
  if current_setting('project_intelligence.test_fail_after_domain', true) = 'on' then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"reason":"INJECTED_FAILURE_AFTER_DOMAIN"}'::jsonb
    );
  end if;

  insert into project_intelligence.command_records (
    command_id,
    organization_id,
    project_id,
    operation,
    key_digest,
    request_digest,
    digest_version,
    actor_type,
    actor_id,
    actor_user_id,
    logical_result,
    resulting_state_revision,
    completed_at
  )
  values (
    v_command_id,
    p_organization_id,
    p_project_id,
    p_operation,
    p_key_digest,
    p_request_digest,
    'project-intelligence-jsonb/1',
    p_actor_type,
    p_actor_id,
    p_actor_user_id,
    p_logical_result,
    v_next_state_revision,
    statement_timestamp()
  );

  insert into project_intelligence.audit_events (
    audit_event_id,
    organization_id,
    project_id,
    command_id,
    event_type,
    actor_type,
    actor_id,
    request_id,
    controlled_metadata,
    occurred_at
  )
  values (
    pg_catalog.gen_random_uuid(),
    p_organization_id,
    p_project_id,
    v_command_id,
    p_event_type,
    p_actor_type,
    p_actor_id,
    'db:' || pg_catalog.gen_random_uuid()::text,
    coalesce(p_controlled_metadata, '{}'::jsonb),
    statement_timestamp()
  );

  update project_intelligence.project_workflows pw
  set state_revision = v_next_state_revision,
      latest_version_id = case
        when p_set_latest_version then p_latest_version_id
        else pw.latest_version_id
      end,
      updated_at = statement_timestamp()
  where pw.organization_id = p_organization_id
    and pw.project_id = p_project_id
    and pw.state_revision = p_previous_state_revision;

  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    perform project_intelligence._raise_contract_error(
      'P1006',
      'STATE_STALE',
      jsonb_build_object('currentStateRevision', null)
    );
  end if;

  -- Core closure checks are DEFERRABLE so multi-row normalized writes can be
  -- assembled atomically. Force them while the NOLOGIN executor is still the
  -- effective SECURITY DEFINER role; otherwise a caller transaction that used
  -- SET LOCAL ROLE would reach COMMIT after the definer context has ended.
  set constraints
    project_intelligence.graph_node_revisions_evidence_closure,
    project_intelligence.project_versions_closure,
    project_intelligence.change_set_publications_closure,
    project_intelligence.impacts_path_closure
    immediate;
  set constraints
    project_intelligence.graph_node_revisions_evidence_closure,
    project_intelligence.project_versions_closure,
    project_intelligence.change_set_publications_closure,
    project_intelligence.impacts_path_closure
    deferred;

  return jsonb_build_object(
    'operation', p_operation,
    'replay', false,
    'stateRevision', v_next_state_revision,
    'result', p_logical_result
  );
end;
$function$;

-- The six wrappers are intentionally created in this first materialization so the
-- interface is parseable while the exact core columns are being reconciled. Their
-- bodies are replaced below in this same migration before DB2 acceptance.

create or replace function project_intelligence_api.review_claim(
  project_id uuid,
  target_revision_id text,
  expected_revision_id text,
  expected_state_revision bigint,
  decision text,
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
  v_actor_user_id uuid;
  v_actor_id text;
  v_key text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_state_revision bigint;
  v_latest_version_id text;
  v_replay jsonb;
  v_node_id text;
  v_current_revision_id text;
  v_review_id text := 'review:' || pg_catalog.gen_random_uuid()::text;
  v_result jsonb;
begin
  select hc.organization_id, hc.actor_user_id, hc.actor_id
    into v_organization_id, v_actor_user_id, v_actor_id
  from project_intelligence._human_context(project_id, 'review_claim') hc;

  perform project_intelligence._assert_domain_id(target_revision_id, 'target_revision_id');
  perform project_intelligence._assert_domain_id(expected_revision_id, 'expected_revision_id');
  perform project_intelligence._assert_state_revision(expected_state_revision);
  if decision not in ('confirmed', 'rejected') then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      '{"reason":"INVALID_REVIEW_DECISION"}'::jsonb
    );
  end if;
  v_key := project_intelligence._assert_idempotency_key(idempotency_key);
  v_key_digest := project_intelligence._sha256_text(v_key);
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'decision', decision,
      'expectedRevisionId', expected_revision_id,
      'expectedStateRevision', expected_state_revision,
      'operation', 'review_claim',
      'projectId', project_id,
      'targetRevisionId', target_revision_id
    )
  );

  select lw.state_revision, lw.latest_version_id
    into v_state_revision, v_latest_version_id
  from project_intelligence._lock_workflow(v_organization_id, project_id) lw;

  v_replay := project_intelligence._replay_or_null(
    v_organization_id,
    project_id,
    'review_claim',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_state_revision <> expected_state_revision then
    perform project_intelligence._raise_contract_error(
      'P1006',
      'STATE_STALE',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;
  if target_revision_id <> expected_revision_id then
    perform project_intelligence._raise_contract_error(
      'P1004',
      'REVISION_STALE',
      jsonb_build_object('currentRevisionId', target_revision_id)
    );
  end if;

  select n.node_id, n.current_revision_id
    into v_node_id, v_current_revision_id
  from project_intelligence.graph_nodes n
  join project_intelligence.graph_node_revisions r
    on r.organization_id = n.organization_id
   and r.project_id = n.project_id
   and r.node_id = n.node_id
   and r.revision_id = target_revision_id
  where n.organization_id = v_organization_id
    and n.project_id = project_id
  order by n.node_id collate "C"
  for update of n, r;

  if not found or v_current_revision_id <> expected_revision_id then
    perform project_intelligence._raise_contract_error(
      'P1004',
      'REVISION_STALE',
      jsonb_build_object('currentRevisionId', v_current_revision_id)
    );
  end if;

  insert into project_intelligence.human_reviews (
    organization_id,
    project_id,
    review_id,
    target_revision_id,
    decision,
    actor_user_id,
    reviewed_at
  )
  values (
    v_organization_id,
    project_id,
    v_review_id,
    target_revision_id,
    decision,
    v_actor_user_id,
    statement_timestamp()
  );

  v_result := jsonb_build_object(
    'effectiveClaimStatus',
    case decision
      when 'confirmed' then 'human_confirmed'
      else 'human_rejected'
    end,
    'review',
    jsonb_build_object(
      'actor', jsonb_build_object('id', v_actor_id, 'type', 'human'),
      'decision', decision,
      'id', v_review_id,
      'projectId', project_id,
      'reviewedAt', statement_timestamp(),
      'targetRevisionId', target_revision_id
    ),
    'stateRevision', v_state_revision + 1
  );

  return project_intelligence._complete_command(
    v_organization_id,
    project_id,
    'review_claim',
    v_key_digest,
    v_request_digest,
    'human',
    v_actor_id,
    v_actor_user_id,
    v_result,
    case decision
      when 'confirmed' then 'claim_review_confirmed'
      else 'claim_review_rejected'
    end,
    jsonb_build_object(
      'decision', decision,
      'review_id', v_review_id,
      'target_revision_id', target_revision_id
    ),
    v_state_revision
  );
end;
$function$;

create or replace function project_intelligence_api.publish_version(
  project_id uuid,
  expected_latest_version_id text,
  expected_state_revision bigint,
  label text,
  selected_revisions jsonb,
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
  v_actor_user_id uuid;
  v_actor_id text;
  v_key text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_state_revision bigint;
  v_current_latest_version_id text;
  v_replay jsonb;
  v_selected jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_version_id text := 'version:' || pg_catalog.gen_random_uuid()::text;
  v_version_no bigint;
  v_label text := nullif(btrim(label), '');
  v_graph_snapshot jsonb;
  v_graph_digest bytea;
  v_linked_change_set_ids jsonb := '[]'::jsonb;
  v_published_at timestamptz := statement_timestamp();
  v_result jsonb;
begin
  select hc.organization_id, hc.actor_user_id, hc.actor_id
    into v_organization_id, v_actor_user_id, v_actor_id
  from project_intelligence._human_context(project_id, 'publish_version') hc;

  perform project_intelligence._assert_state_revision(expected_state_revision);
  if expected_latest_version_id is not null then
    perform project_intelligence._assert_domain_id(
      expected_latest_version_id,
      'expected_latest_version_id'
    );
  end if;
  if selected_revisions is not null
     and jsonb_typeof(selected_revisions) <> 'array' then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"field":"selected_revisions"}'::jsonb
    );
  end if;
  for v_entry in
    select value
    from jsonb_array_elements(coalesce(selected_revisions, '[]'::jsonb))
  loop
    if jsonb_typeof(v_entry) <> 'object'
       or nullif(v_entry ->> 'nodeId', '') is null
       or nullif(v_entry ->> 'revisionId', '') is null then
      perform project_intelligence._raise_contract_error(
        'P1011',
        'DOMAIN_CONTRACT_VIOLATION',
        '{"field":"selected_revisions"}'::jsonb
      );
    end if;
    perform project_intelligence._assert_domain_id(v_entry ->> 'nodeId', 'node_id');
    perform project_intelligence._assert_domain_id(v_entry ->> 'revisionId', 'revision_id');
    v_selected := v_selected || jsonb_build_array(jsonb_build_object(
      'nodeId', v_entry ->> 'nodeId',
      'revisionId', v_entry ->> 'revisionId'
    ));
  end loop;

  if (
    select count(*) <> count(distinct item ->> 'nodeId')
    from jsonb_array_elements(v_selected) as selected_item(item)
  ) then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      '{"reason":"DUPLICATE_NODE_SELECTION"}'::jsonb
    );
  end if;
  select coalesce(jsonb_agg(item order by item ->> 'nodeId' collate "C",
                                          item ->> 'revisionId' collate "C"), '[]'::jsonb)
    into v_selected
  from jsonb_array_elements(v_selected) as selected_item(item);

  v_key := project_intelligence._assert_idempotency_key(idempotency_key);
  v_key_digest := project_intelligence._sha256_text(v_key);
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'expectedLatestVersionId', expected_latest_version_id,
      'expectedStateRevision', expected_state_revision,
      'label', v_label,
      'operation', 'publish_version',
      'projectId', project_id,
      'selectedRevisions', v_selected
    )
  );

  select lw.state_revision, lw.latest_version_id
    into v_state_revision, v_current_latest_version_id
  from project_intelligence._lock_workflow(v_organization_id, project_id) lw;

  v_replay := project_intelligence._replay_or_null(
    v_organization_id,
    project_id,
    'publish_version',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_state_revision <> expected_state_revision then
    perform project_intelligence._raise_contract_error(
      'P1006',
      'STATE_STALE',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;
  if v_current_latest_version_id is distinct from expected_latest_version_id then
    perform project_intelligence._raise_contract_error(
      'P1005',
      'VERSION_STALE',
      jsonb_build_object('currentVersionId', v_current_latest_version_id)
    );
  end if;

  -- Root is already locked. Lock the exact current graph in bytewise ID order.
  perform n.node_id
  from project_intelligence.graph_nodes n
  join project_intelligence.graph_node_revisions r
    on r.organization_id = n.organization_id
   and r.project_id = n.project_id
   and r.node_id = n.node_id
   and r.revision_id = n.current_revision_id
  where n.organization_id = v_organization_id
    and n.project_id = project_id
  order by n.node_id collate "C", r.revision_id collate "C"
  for update of n, r;

  if exists (
    select 1
    from jsonb_array_elements(v_selected) as selected_item(item)
    left join project_intelligence.graph_nodes n
      on n.organization_id = v_organization_id
     and n.project_id = project_id
     and n.node_id = item ->> 'nodeId'
     and n.current_revision_id = item ->> 'revisionId'
    where n.node_id is null
  ) then
    perform project_intelligence._raise_contract_error(
      'P1004',
      'REVISION_STALE',
      '{"reason":"EXPLICIT_SELECTION_NOT_CURRENT"}'::jsonb
    );
  end if;

  if exists (
    select 1
    from project_intelligence.graph_nodes n
    join project_intelligence.graph_node_revisions r
      on r.organization_id = n.organization_id
     and r.project_id = n.project_id
     and r.node_id = n.node_id
     and r.revision_id = n.current_revision_id
    where n.organization_id = v_organization_id
      and n.project_id = project_id
      and n.kind in ('decision', 'requirement')
      and r.origin = 'ai'
      and not exists (
        select 1
        from project_intelligence.human_reviews hr
        where hr.organization_id = n.organization_id
          and hr.project_id = n.project_id
          and hr.target_revision_id = r.revision_id
          and hr.decision = 'confirmed'
      )
  ) then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      '{"reason":"UNCONFIRMED_REQUIRED_CLAIM"}'::jsonb
    );
  end if;

  select coalesce(max(pv.version_no), 0) + 1
    into v_version_no
  from project_intelligence.project_versions pv
  where pv.organization_id = v_organization_id
    and pv.project_id = project_id;
  if v_version_no > 9007199254740991 then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"reason":"VERSION_NUMBER_EXHAUSTED"}'::jsonb
    );
  end if;

  select jsonb_build_object(
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'edgeId', e.edge_id,
        'fromNodeId', e.from_node_id,
        'relation', e.relation,
        'toNodeId', e.to_node_id
      ) order by e.edge_id collate "C")
      from project_intelligence.graph_edges e
      where e.organization_id = v_organization_id
        and e.project_id = project_id
    ), '[]'::jsonb),
    'evidenceLinks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'evidenceLinkId', el.evidence_link_id,
        'nodeRevisionId', el.node_revision_id,
        'sourceFragmentId', el.source_fragment_id
      ) order by el.evidence_link_id collate "C")
      from project_intelligence.evidence_links el
      where el.organization_id = v_organization_id
        and el.project_id = project_id
    ), '[]'::jsonb),
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', n.kind,
        'nodeId', n.node_id,
        'revisionId', r.revision_id,
        'stableKey', n.stable_key,
        'title', r.title,
        'payload', r.payload,
        'origin', r.origin,
        'claimStatus', r.claim_status
      ) order by n.node_id collate "C")
      from project_intelligence.graph_nodes n
      join project_intelligence.graph_node_revisions r
        on r.organization_id = n.organization_id
       and r.project_id = n.project_id
       and r.node_id = n.node_id
       and r.revision_id = n.current_revision_id
      where n.organization_id = v_organization_id
        and n.project_id = project_id
    ), '[]'::jsonb),
    'projectId', project_id,
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'decision', hr.decision,
        'reviewId', hr.review_id,
        'targetRevisionId', hr.target_revision_id
      ) order by hr.review_id collate "C")
      from project_intelligence.human_reviews hr
      join project_intelligence.graph_nodes n
        on n.organization_id = hr.organization_id
       and n.project_id = hr.project_id
       and n.current_revision_id = hr.target_revision_id
      where hr.organization_id = v_organization_id
        and hr.project_id = project_id
    ), '[]'::jsonb),
    'sourceFragments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fragmentId', sf.fragment_id,
        'locator', sf.locator,
        'locatorKind', sf.locator_kind,
        'sourceId', sf.source_id
      ) order by sf.fragment_id collate "C")
      from project_intelligence.source_fragments sf
      where sf.organization_id = v_organization_id
        and sf.project_id = project_id
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'checksum', encode(s.checksum, 'hex'),
        'kind', s.kind,
        'sourceId', s.source_id
      ) order by s.source_id collate "C")
      from project_intelligence.sources s
      where s.organization_id = v_organization_id
        and s.project_id = project_id
    ), '[]'::jsonb)
  )
    into v_graph_snapshot;
  v_graph_digest := project_intelligence._sha256_jsonb(v_graph_snapshot);

  insert into project_intelligence.project_versions (
    organization_id,
    project_id,
    version_id,
    version_no,
    base_version_id,
    label,
    graph_digest,
    contract_version,
    published_by_user_id,
    published_at
  )
  values (
    v_organization_id,
    project_id,
    v_version_id,
    v_version_no,
    v_current_latest_version_id,
    v_label,
    v_graph_digest,
    'project-intelligence-vertical-slice/0.1',
    v_actor_user_id,
    v_published_at
  );

  insert into project_intelligence.version_nodes (
    organization_id, project_id, version_id, node_id, revision_id
  )
  select n.organization_id, n.project_id, v_version_id, n.node_id, n.current_revision_id
  from project_intelligence.graph_nodes n
  where n.organization_id = v_organization_id
    and n.project_id = project_id
  order by n.node_id collate "C";

  insert into project_intelligence.version_reviews (
    organization_id, project_id, version_id, review_id
  )
  select hr.organization_id, hr.project_id, v_version_id, hr.review_id
  from project_intelligence.human_reviews hr
  join project_intelligence.graph_nodes n
    on n.organization_id = hr.organization_id
   and n.project_id = hr.project_id
   and n.current_revision_id = hr.target_revision_id
  where hr.organization_id = v_organization_id
    and hr.project_id = project_id
  order by hr.review_id collate "C";

  insert into project_intelligence.version_sources (
    organization_id, project_id, version_id, source_id
  )
  select distinct s.organization_id, s.project_id, v_version_id, s.source_id
  from project_intelligence.sources s
  join project_intelligence.source_fragments sf
    on sf.organization_id = s.organization_id
   and sf.project_id = s.project_id
   and sf.source_id = s.source_id
  join project_intelligence.evidence_links el
    on el.organization_id = sf.organization_id
   and el.project_id = sf.project_id
   and el.source_fragment_id = sf.fragment_id
  join project_intelligence.graph_nodes n
    on n.organization_id = el.organization_id
   and n.project_id = el.project_id
   and n.current_revision_id = el.node_revision_id
  where s.organization_id = v_organization_id
    and s.project_id = project_id;

  insert into project_intelligence.version_source_fragments (
    organization_id, project_id, version_id, fragment_id
  )
  select distinct sf.organization_id, sf.project_id, v_version_id, sf.fragment_id
  from project_intelligence.source_fragments sf
  join project_intelligence.evidence_links el
    on el.organization_id = sf.organization_id
   and el.project_id = sf.project_id
   and el.source_fragment_id = sf.fragment_id
  join project_intelligence.graph_nodes n
    on n.organization_id = el.organization_id
   and n.project_id = el.project_id
   and n.current_revision_id = el.node_revision_id
  where sf.organization_id = v_organization_id
    and sf.project_id = project_id;

  insert into project_intelligence.version_evidence_links (
    organization_id, project_id, version_id, evidence_link_id
  )
  select el.organization_id, el.project_id, v_version_id, el.evidence_link_id
  from project_intelligence.evidence_links el
  join project_intelligence.graph_nodes n
    on n.organization_id = el.organization_id
   and n.project_id = el.project_id
   and n.current_revision_id = el.node_revision_id
  where el.organization_id = v_organization_id
    and el.project_id = project_id
  order by el.evidence_link_id collate "C";

  insert into project_intelligence.version_edges (
    organization_id, project_id, version_id, edge_id
  )
  select e.organization_id, e.project_id, v_version_id, e.edge_id
  from project_intelligence.graph_edges e
  where e.organization_id = v_organization_id
    and e.project_id = project_id
  order by e.edge_id collate "C";

  perform cs.change_set_id
  from project_intelligence.change_sets cs
  join project_intelligence.graph_nodes n
    on n.organization_id = cs.organization_id
   and n.project_id = cs.project_id
   and n.node_id = cs.node_id
   and n.current_revision_id = cs.to_revision_id
  where cs.organization_id = v_organization_id
    and cs.project_id = project_id
    and cs.from_version_id is not distinct from v_current_latest_version_id
    and not exists (
      select 1
      from project_intelligence.change_set_publications csp
      where csp.organization_id = cs.organization_id
        and csp.project_id = cs.project_id
        and csp.change_set_id = cs.change_set_id
    )
  order by cs.change_set_id collate "C"
  for update of cs;

  with linked as (
    insert into project_intelligence.change_set_publications (
      organization_id, project_id, change_set_id, to_version_id, published_at
    )
    select
      cs.organization_id,
      cs.project_id,
      cs.change_set_id,
      v_version_id,
      v_published_at
    from project_intelligence.change_sets cs
    join project_intelligence.graph_nodes n
      on n.organization_id = cs.organization_id
     and n.project_id = cs.project_id
     and n.node_id = cs.node_id
     and n.current_revision_id = cs.to_revision_id
    where cs.organization_id = v_organization_id
      and cs.project_id = project_id
      and cs.from_version_id is not distinct from v_current_latest_version_id
      and not exists (
        select 1
        from project_intelligence.change_set_publications csp
        where csp.organization_id = cs.organization_id
          and csp.project_id = cs.project_id
          and csp.change_set_id = cs.change_set_id
      )
    order by cs.change_set_id collate "C"
    returning change_set_id
  )
  select coalesce(jsonb_agg(change_set_id order by change_set_id collate "C"), '[]'::jsonb)
    into v_linked_change_set_ids
  from linked;

  v_result := jsonb_build_object(
    'linkedChangeSetIds', v_linked_change_set_ids,
    'stateRevision', v_state_revision + 1,
    'version', jsonb_build_object(
      'baseVersionId', v_current_latest_version_id,
      'graphDigest', 'sha256:' || encode(v_graph_digest, 'hex'),
      'id', v_version_id,
      'label', v_label,
      'projectId', project_id,
      'publishedAt', v_published_at,
      'publishedBy', jsonb_build_object('actorId', v_actor_id, 'actorType', 'human'),
      'versionNo', v_version_no
    )
  );

  return project_intelligence._complete_command(
    v_organization_id,
    project_id,
    'publish_version',
    v_key_digest,
    v_request_digest,
    'human',
    v_actor_id,
    v_actor_user_id,
    v_result,
    'project_version_published',
    jsonb_build_object(
      'base_version_id', v_current_latest_version_id,
      'linked_change_set_ids', v_linked_change_set_ids,
      'selected_revision_count', (
        select count(*) from project_intelligence.version_nodes vn
        where vn.organization_id = v_organization_id
          and vn.project_id = project_id
          and vn.version_id = v_version_id
      ),
      'version_id', v_version_id,
      'version_no', v_version_no
    ),
    v_state_revision,
    true,
    v_version_id
  );
end;
$function$;

create or replace function project_intelligence_api.revise_decision(
  project_id uuid,
  node_id text,
  base_version_id text,
  expected_revision_id text,
  expected_state_revision bigint,
  title text,
  payload jsonb,
  reason_code text,
  protected_reason text,
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
  v_actor_user_id uuid;
  v_actor_id text;
  v_key text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_state_revision bigint;
  v_current_latest_version_id text;
  v_replay jsonb;
  v_node_kind text;
  v_current_revision_id text;
  v_current_payload jsonb;
  v_revision_no bigint;
  v_revision_id text := 'revision:' || pg_catalog.gen_random_uuid()::text;
  v_review_id text := 'review:' || pg_catalog.gen_random_uuid()::text;
  v_change_set_id text := 'change-set:' || pg_catalog.gen_random_uuid()::text;
  v_title text := btrim(coalesce(title, ''));
  v_reason text := btrim(coalesce(protected_reason, ''));
  v_occurred_at timestamptz := statement_timestamp();
  v_result jsonb;
begin
  select hc.organization_id, hc.actor_user_id, hc.actor_id
    into v_organization_id, v_actor_user_id, v_actor_id
  from project_intelligence._human_context(project_id, 'revise_decision') hc;

  perform project_intelligence._assert_domain_id(node_id, 'node_id');
  perform project_intelligence._assert_domain_id(base_version_id, 'base_version_id');
  perform project_intelligence._assert_domain_id(expected_revision_id, 'expected_revision_id');
  perform project_intelligence._assert_state_revision(expected_state_revision);
  if v_title = '' then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      '{"reason":"DECISION_TITLE_REQUIRED"}'::jsonb
    );
  end if;
  if reason_code not in (
    'schedule_constraint',
    'budget_constraint',
    'client_preference',
    'scope_change',
    'technical_constraint',
    'regulatory_requirement',
    'correction'
  ) or v_reason = '' then
    perform project_intelligence._raise_contract_error(
      'P1009',
      'CHANGE_REASON_REQUIRED',
      jsonb_build_object('nodeId', node_id)
    );
  end if;
  if payload is null then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"field":"payload"}'::jsonb
    );
  end if;

  v_key := project_intelligence._assert_idempotency_key(idempotency_key);
  v_key_digest := project_intelligence._sha256_text(v_key);
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'baseVersionId', base_version_id,
      'expectedRevisionId', expected_revision_id,
      'expectedStateRevision', expected_state_revision,
      'nodeId', node_id,
      'operation', 'revise_decision',
      'payload', payload,
      'projectId', project_id,
      'protectedReason', v_reason,
      'reasonCode', reason_code,
      'title', v_title
    )
  );

  select lw.state_revision, lw.latest_version_id
    into v_state_revision, v_current_latest_version_id
  from project_intelligence._lock_workflow(v_organization_id, project_id) lw;

  v_replay := project_intelligence._replay_or_null(
    v_organization_id,
    project_id,
    'revise_decision',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_state_revision <> expected_state_revision then
    perform project_intelligence._raise_contract_error(
      'P1006',
      'STATE_STALE',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;
  if v_current_latest_version_id is distinct from base_version_id then
    perform project_intelligence._raise_contract_error(
      'P1005',
      'VERSION_STALE',
      jsonb_build_object('currentVersionId', v_current_latest_version_id)
    );
  end if;

  select n.kind, n.current_revision_id, r.payload
    into v_node_kind, v_current_revision_id, v_current_payload
  from project_intelligence.graph_nodes n
  join project_intelligence.graph_node_revisions r
    on r.organization_id = n.organization_id
   and r.project_id = n.project_id
   and r.node_id = n.node_id
   and r.revision_id = n.current_revision_id
  where n.organization_id = v_organization_id
    and n.project_id = project_id
    and n.node_id = node_id
  order by n.node_id collate "C", r.revision_id collate "C"
  for update of n, r;

  if not found then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      jsonb_build_object('reason', 'DECISION_NODE_NOT_FOUND', 'nodeId', node_id)
    );
  end if;
  if v_node_kind <> 'decision' then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      jsonb_build_object('reason', 'NODE_NOT_DECISION', 'nodeId', node_id)
    );
  end if;
  if v_current_revision_id <> expected_revision_id then
    perform project_intelligence._raise_contract_error(
      'P1004',
      'REVISION_STALE',
      jsonb_build_object('currentRevisionId', v_current_revision_id)
    );
  end if;
  if not exists (
    select 1
    from project_intelligence.version_nodes vn
    where vn.organization_id = v_organization_id
      and vn.project_id = project_id
      and vn.version_id = base_version_id
      and vn.node_id = node_id
      and vn.revision_id = expected_revision_id
  ) then
    perform project_intelligence._raise_contract_error(
      'P1005',
      'VERSION_STALE',
      jsonb_build_object(
        'currentVersionId', v_current_latest_version_id,
        'reason', 'BASE_REVISION_MISMATCH'
      )
    );
  end if;
  if not exists (
    select 1
    from project_intelligence.human_reviews hr
    where hr.organization_id = v_organization_id
      and hr.project_id = project_id
      and hr.target_revision_id = expected_revision_id
      and hr.decision = 'confirmed'
  ) then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      jsonb_build_object(
        'reason', 'CONFIRMED_DECISION_REQUIRED',
        'revisionId', expected_revision_id
      )
    );
  end if;
  if v_current_payload = payload then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      jsonb_build_object('reason', 'NO_SEMANTIC_CHANGE', 'nodeId', node_id)
    );
  end if;

  select coalesce(max(r.revision_no), 0) + 1
    into v_revision_no
  from project_intelligence.graph_node_revisions r
  where r.organization_id = v_organization_id
    and r.project_id = project_id
    and r.node_id = node_id;
  if v_revision_no > 9007199254740991 then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"reason":"REVISION_NUMBER_EXHAUSTED"}'::jsonb
    );
  end if;

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
    created_by_id,
    created_at
  )
  values (
    v_organization_id,
    project_id,
    v_revision_id,
    node_id,
    v_revision_no,
    v_title,
    payload,
    'human',
    'interpreted',
    null,
    expected_revision_id,
    project_intelligence._sha256_jsonb(jsonb_build_object(
      'claimStatus', 'interpreted',
      'nodeId', node_id,
      'origin', 'human',
      'payload', payload,
      'title', v_title
    )),
    'human',
    v_actor_id,
    v_occurred_at
  );

  insert into project_intelligence.human_reviews (
    organization_id,
    project_id,
    review_id,
    target_revision_id,
    decision,
    actor_user_id,
    reviewed_at
  )
  values (
    v_organization_id,
    project_id,
    v_review_id,
    v_revision_id,
    'confirmed',
    v_actor_user_id,
    v_occurred_at
  );

  insert into project_intelligence.change_sets (
    organization_id,
    project_id,
    change_set_id,
    node_id,
    from_version_id,
    from_revision_id,
    to_revision_id,
    reason_code,
    actor_user_id,
    occurred_at
  )
  values (
    v_organization_id,
    project_id,
    v_change_set_id,
    node_id,
    base_version_id,
    expected_revision_id,
    v_revision_id,
    reason_code,
    v_actor_user_id,
    v_occurred_at
  );

  insert into project_intelligence.change_set_reasons (
    organization_id,
    project_id,
    change_set_id,
    protected_reason
  )
  values (
    v_organization_id,
    project_id,
    v_change_set_id,
    v_reason
  );

  update project_intelligence.graph_nodes n
  set current_revision_id = v_revision_id
  where n.organization_id = v_organization_id
    and n.project_id = project_id
    and n.node_id = node_id
    and n.current_revision_id = expected_revision_id;

  if not found then
    perform project_intelligence._raise_contract_error(
      'P1004',
      'REVISION_STALE',
      jsonb_build_object('currentRevisionId', v_current_revision_id)
    );
  end if;

  v_result := jsonb_build_object(
    'changeSet', jsonb_build_object(
      'actor', jsonb_build_object('actorId', v_actor_id, 'actorType', 'human'),
      'fromRevisionId', expected_revision_id,
      'fromVersionId', base_version_id,
      'id', v_change_set_id,
      'nodeId', node_id,
      'occurredAt', v_occurred_at,
      'projectId', project_id,
      'reasonCode', reason_code,
      'status', 'pending_publication',
      'toRevisionId', v_revision_id,
      'toVersionId', null
    ),
    'review', jsonb_build_object(
      'actor', jsonb_build_object('id', v_actor_id, 'type', 'human'),
      'decision', 'confirmed',
      'id', v_review_id,
      'projectId', project_id,
      'reviewedAt', v_occurred_at,
      'targetRevisionId', v_revision_id
    ),
    'revision', jsonb_build_object(
      'claimStatus', 'interpreted',
      'id', v_revision_id,
      'nodeId', node_id,
      'origin', 'human',
      'payload', payload,
      'projectId', project_id,
      'replacesRevisionId', expected_revision_id,
      'title', v_title
    ),
    'stateRevision', v_state_revision + 1
  );

  return project_intelligence._complete_command(
    v_organization_id,
    project_id,
    'revise_decision',
    v_key_digest,
    v_request_digest,
    'human',
    v_actor_id,
    v_actor_user_id,
    v_result,
    'confirmed_decision_revised',
    jsonb_build_object(
      'change_set_id', v_change_set_id,
      'from_revision_id', expected_revision_id,
      'node_id', node_id,
      'reason_code', reason_code,
      'to_revision_id', v_revision_id
    ),
    v_state_revision
  );
end;
$function$;

create or replace function project_intelligence_api.calculate_impact(
  project_id uuid,
  change_set_id text,
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
  v_key text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_state_revision bigint;
  v_latest_version_id text;
  v_replay jsonb;
  v_from_version_id text;
  v_to_version_id text;
  v_to_base_version_id text;
  v_reason_code text;
  v_target_graph_digest bytea;
  v_impact_run_id text := 'impact-run:' || pg_catalog.gen_random_uuid()::text;
  v_algorithm jsonb := jsonb_build_object(
    'cyclePolicy', 'shortest_path_per_changed_root',
    'direction', 'reverse_dependency',
    'ordering', 'unicode_code_point',
    'propagatingRelations', jsonb_build_array(
      'depends_on', 'derived_from', 'satisfies', 'specified_by'
    ),
    'version', 'project-intelligence-impact/0.1'
  );
  v_changes jsonb;
  v_impacts jsonb;
  v_result_digest bytea;
  v_created_at timestamptz := statement_timestamp();
  v_result jsonb;
begin
  v_organization_id := project_intelligence._worker_context(project_id);
  perform project_intelligence._assert_domain_id(change_set_id, 'change_set_id');
  perform project_intelligence._assert_state_revision(expected_state_revision);
  v_key := project_intelligence._assert_idempotency_key(idempotency_key);
  v_key_digest := project_intelligence._sha256_text(v_key);
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'changeSetId', change_set_id,
      'expectedStateRevision', expected_state_revision,
      'operation', 'calculate_impact',
      'projectId', project_id
    )
  );

  select lw.state_revision, lw.latest_version_id
    into v_state_revision, v_latest_version_id
  from project_intelligence._lock_workflow(v_organization_id, project_id) lw;

  v_replay := project_intelligence._replay_or_null(
    v_organization_id,
    project_id,
    'calculate_impact',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_state_revision <> expected_state_revision then
    perform project_intelligence._raise_contract_error(
      'P1006',
      'STATE_STALE',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select
    cs.from_version_id,
    csp.to_version_id,
    to_version.base_version_id,
    cs.reason_code,
    to_version.graph_digest
  into
    v_from_version_id,
    v_to_version_id,
    v_to_base_version_id,
    v_reason_code,
    v_target_graph_digest
  from project_intelligence.change_sets cs
  join project_intelligence.change_set_publications csp
    on csp.organization_id = cs.organization_id
   and csp.project_id = cs.project_id
   and csp.change_set_id = cs.change_set_id
  join project_intelligence.project_versions from_version
    on from_version.organization_id = cs.organization_id
   and from_version.project_id = cs.project_id
   and from_version.version_id = cs.from_version_id
  join project_intelligence.project_versions to_version
    on to_version.organization_id = csp.organization_id
   and to_version.project_id = csp.project_id
   and to_version.version_id = csp.to_version_id
  where cs.organization_id = v_organization_id
    and cs.project_id = project_id
    and cs.change_set_id = change_set_id
  order by cs.change_set_id collate "C"
  for update of cs, csp, from_version, to_version;

  if not found then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      '{"reason":"FINALIZED_CHANGE_SET_REQUIRED"}'::jsonb
    );
  end if;
  if v_to_base_version_id is distinct from v_from_version_id then
    perform project_intelligence._raise_contract_error(
      'P1005',
      'VERSION_STALE',
      jsonb_build_object(
        'fromVersionId', v_from_version_id,
        'toVersionId', v_to_version_id
      )
    );
  end if;
  if exists (
    select 1
    from project_intelligence.impact_runs ir
    where ir.organization_id = v_organization_id
      and ir.project_id = project_id
      and ir.change_set_id = change_set_id
      and ir.to_version_id = v_to_version_id
  ) then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      '{"reason":"IMPACT_ALREADY_CALCULATED"}'::jsonb
    );
  end if;

  with node_ids as (
    select vn.node_id
    from project_intelligence.version_nodes vn
    where vn.organization_id = v_organization_id
      and vn.project_id = project_id
      and vn.version_id = v_from_version_id
    union
    select vn.node_id
    from project_intelligence.version_nodes vn
    where vn.organization_id = v_organization_id
      and vn.project_id = project_id
      and vn.version_id = v_to_version_id
  ),
  paired as (
    select
      ids.node_id,
      from_node.revision_id as from_revision_id,
      to_node.revision_id as to_revision_id,
      from_revision.payload as from_payload,
      to_revision.payload as to_payload
    from node_ids ids
    left join project_intelligence.version_nodes from_node
      on from_node.organization_id = v_organization_id
     and from_node.project_id = project_id
     and from_node.version_id = v_from_version_id
     and from_node.node_id = ids.node_id
    left join project_intelligence.graph_node_revisions from_revision
      on from_revision.organization_id = from_node.organization_id
     and from_revision.project_id = from_node.project_id
     and from_revision.revision_id = from_node.revision_id
    left join project_intelligence.version_nodes to_node
      on to_node.organization_id = v_organization_id
     and to_node.project_id = project_id
     and to_node.version_id = v_to_version_id
     and to_node.node_id = ids.node_id
    left join project_intelligence.graph_node_revisions to_revision
      on to_revision.organization_id = to_node.organization_id
     and to_revision.project_id = to_node.project_id
     and to_revision.revision_id = to_node.revision_id
  ),
  classified as (
    select
      p.*,
      case
        when p.from_revision_id is null then 'added'
        when p.to_revision_id is null then 'removed'
        when cardinality(project_intelligence._jsonb_diff_paths(
          p.from_payload, p.to_payload
        )) > 0 then 'changed'
        else 'revision_transition'
      end as change_type,
      case
        when p.from_revision_id is null or p.to_revision_id is null then array['']::text[]
        else project_intelligence._jsonb_diff_paths(p.from_payload, p.to_payload)
      end as changed_paths
    from paired p
    where p.from_revision_id is distinct from p.to_revision_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'changedPaths', to_jsonb(c.changed_paths),
    'changeType', c.change_type,
    'fromRevisionId', c.from_revision_id,
    'impactRelevant', c.change_type <> 'revision_transition',
    'nodeId', c.node_id,
    'toRevisionId', c.to_revision_id
  ) order by c.node_id collate "C"), '[]'::jsonb)
    into v_changes
  from classified c;

  if not exists (
    select 1
    from jsonb_array_elements(v_changes) as changed(change)
    where (change ->> 'impactRelevant')::boolean
  ) then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      '{"reason":"NO_IMPACT_RELEVANT_CHANGE"}'::jsonb
    );
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_changes) as changed(change)
    where (change ->> 'impactRelevant')::boolean
      and not exists (
        select 1
        from project_intelligence.version_nodes vn
        where vn.organization_id = v_organization_id
          and vn.project_id = project_id
          and vn.version_id = v_to_version_id
          and vn.node_id = change ->> 'nodeId'
      )
  ) then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"reason":"CHANGED_NODE_MISSING_FROM_TARGET"}'::jsonb
    );
  end if;

  with recursive roots as (
    select change ->> 'nodeId' as changed_node_id
    from jsonb_array_elements(v_changes) as changed(change)
    where (change ->> 'impactRelevant')::boolean
  ),
  walk as (
    select
      r.changed_node_id,
      r.changed_node_id as current_node_id,
      array[r.changed_node_id]::text[] as node_path,
      array[]::text[] as edge_path
    from roots r
    union all
    select
      w.changed_node_id,
      e.from_node_id,
      w.node_path || e.from_node_id,
      w.edge_path || e.edge_id
    from walk w
    join project_intelligence.version_edges ve
      on ve.organization_id = v_organization_id
     and ve.project_id = project_id
     and ve.version_id = v_to_version_id
    join project_intelligence.graph_edges e
      on e.organization_id = ve.organization_id
     and e.project_id = ve.project_id
     and e.edge_id = ve.edge_id
     and e.to_node_id = w.current_node_id
     and e.relation in ('depends_on', 'derived_from', 'specified_by', 'satisfies')
    where not e.from_node_id = any(w.node_path)
  ),
  ranked as (
    select
      w.*,
      row_number() over (
        partition by w.changed_node_id, w.current_node_id
        order by
          cardinality(w.edge_path),
          w.node_path collate "C",
          w.edge_path collate "C"
      ) as path_rank
    from walk w
    where w.current_node_id <> w.changed_node_id
  ),
  best as (
    select *
    from ranked
    where path_rank = 1
  ),
  shaped as (
    select jsonb_build_object(
      'changedNodeId', b.changed_node_id,
      'distance', cardinality(b.edge_path),
      'edgePath', coalesce((
        select jsonb_agg(jsonb_build_object(
          'edgeId', path_edge.edge_id,
          'fromNodeId', path_edge.from_node_id,
          'relation', path_edge.relation,
          'stepNo', path_edge.ordinality - 1,
          'toNodeId', path_edge.to_node_id
        ) order by path_edge.ordinality)
        from (
          select
            edge_ids.ordinality,
            e.edge_id,
            e.from_node_id,
            e.relation,
            e.to_node_id
          from unnest(b.edge_path) with ordinality as edge_ids(edge_id, ordinality)
          join project_intelligence.graph_edges e
            on e.organization_id = v_organization_id
           and e.project_id = project_id
           and e.edge_id = edge_ids.edge_id
        ) path_edge
      ), '[]'::jsonb),
      'impactId', 'impact:' || substr(encode(
        project_intelligence._sha256_jsonb(
          jsonb_build_array(
            v_impact_run_id,
            b.changed_node_id,
            b.current_node_id
          )
        ),
        'hex'
      ), 1, 32),
      'impactedNodeId', b.current_node_id,
      'initialStatus', 'needs_review',
      'nodePath', to_jsonb(b.node_path)
    ) as impact
    from best b
  )
  select coalesce(jsonb_agg(s.impact order by
    s.impact ->> 'changedNodeId' collate "C",
    (s.impact ->> 'distance')::bigint,
    s.impact ->> 'impactedNodeId' collate "C"
  ), '[]'::jsonb)
    into v_impacts
  from shaped s;

  v_result_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'algorithm', v_algorithm,
    'changeContext', jsonb_build_object(
      'changeSetId', change_set_id,
      'fromVersionId', v_from_version_id,
      'projectId', project_id,
      'reasonCode', v_reason_code,
      'toVersionId', v_to_version_id
    ),
    'changes', v_changes,
    'impacts', v_impacts,
    'targetGraphDigest', 'sha256:' || encode(v_target_graph_digest, 'hex')
  ));

  insert into project_intelligence.impact_runs (
    organization_id,
    project_id,
    impact_run_id,
    change_set_id,
    from_version_id,
    to_version_id,
    target_graph_digest,
    algorithm,
    result_digest,
    created_by_type,
    created_by_id,
    created_at
  )
  values (
    v_organization_id,
    project_id,
    v_impact_run_id,
    change_set_id,
    v_from_version_id,
    v_to_version_id,
    v_target_graph_digest,
    v_algorithm,
    v_result_digest,
    'system',
    'system:project-intelligence-db2',
    v_created_at
  );

  insert into project_intelligence.impact_run_changes (
    organization_id,
    project_id,
    impact_run_id,
    node_id,
    change_type,
    from_revision_id,
    to_revision_id,
    changed_paths,
    impact_relevant
  )
  select
    v_organization_id,
    project_id,
    v_impact_run_id,
    change ->> 'nodeId',
    change ->> 'changeType',
    change ->> 'fromRevisionId',
    change ->> 'toRevisionId',
    array(
      select jsonb_array_elements_text(change -> 'changedPaths')
    ),
    (change ->> 'impactRelevant')::boolean
  from jsonb_array_elements(v_changes) as changed(change)
  order by change ->> 'nodeId' collate "C";

  insert into project_intelligence.impacts (
    organization_id,
    project_id,
    impact_id,
    impact_run_id,
    changed_node_id,
    impacted_node_id,
    distance,
    node_path,
    initial_status
  )
  select
    v_organization_id,
    project_id,
    impact ->> 'impactId',
    v_impact_run_id,
    impact ->> 'changedNodeId',
    impact ->> 'impactedNodeId',
    (impact ->> 'distance')::bigint,
    array(select jsonb_array_elements_text(impact -> 'nodePath')),
    'needs_review'
  from jsonb_array_elements(v_impacts) as shaped_impact(impact)
  order by impact ->> 'changedNodeId' collate "C",
           (impact ->> 'distance')::bigint,
           impact ->> 'impactedNodeId' collate "C";

  insert into project_intelligence.impact_path_steps (
    organization_id,
    project_id,
    impact_id,
    step_no,
    impact_run_id,
    edge_id,
    relation,
    from_node_id,
    to_node_id
  )
  select
    v_organization_id,
    project_id,
    impact ->> 'impactId',
    (step ->> 'stepNo')::bigint,
    v_impact_run_id,
    step ->> 'edgeId',
    step ->> 'relation',
    step ->> 'fromNodeId',
    step ->> 'toNodeId'
  from jsonb_array_elements(v_impacts) as shaped_impact(impact)
  cross join lateral jsonb_array_elements(impact -> 'edgePath') as shaped_step(step)
  order by impact ->> 'impactId' collate "C", (step ->> 'stepNo')::bigint;

  v_result := jsonb_build_object(
    'algorithm', v_algorithm,
    'changeContext', jsonb_build_object(
      'changeSetId', change_set_id,
      'fromVersionId', v_from_version_id,
      'projectId', project_id,
      'reasonCode', v_reason_code,
      'toVersionId', v_to_version_id
    ),
    'changedNodeIds', coalesce((
      select jsonb_agg(change ->> 'nodeId' order by change ->> 'nodeId' collate "C")
      from jsonb_array_elements(v_changes) as changed(change)
      where (change ->> 'impactRelevant')::boolean
    ), '[]'::jsonb),
    'changes', v_changes,
    'createdAt', v_created_at,
    'createdBy', jsonb_build_object(
      'actorId', 'system:project-intelligence-db2',
      'actorType', 'system'
    ),
    'fromVersionId', v_from_version_id,
    'id', v_impact_run_id,
    'impacts', v_impacts,
    'projectId', project_id,
    'resultDigest', 'sha256:' || encode(v_result_digest, 'hex'),
    'stateRevision', v_state_revision + 1,
    'targetGraphDigest', 'sha256:' || encode(v_target_graph_digest, 'hex'),
    'targetGraphVersionId', v_to_version_id,
    'toVersionId', v_to_version_id
  );

  return project_intelligence._complete_command(
    v_organization_id,
    project_id,
    'calculate_impact',
    v_key_digest,
    v_request_digest,
    'system',
    'system:project-intelligence-db2',
    null,
    v_result,
    'impact_run_created',
    jsonb_build_object(
      'change_set_id', change_set_id,
      'changed_node_count', (
        select count(*)
        from jsonb_array_elements(v_changes) as changed(change)
        where (change ->> 'impactRelevant')::boolean
      ),
      'from_version_id', v_from_version_id,
      'impact_count', jsonb_array_length(v_impacts),
      'impact_run_id', v_impact_run_id,
      'to_version_id', v_to_version_id
    ),
    v_state_revision
  );
end;
$function$;

create or replace function project_intelligence_api.review_impact(
  project_id uuid,
  impact_run_id text,
  impact_id text,
  expected_impact_status text,
  disposition text,
  reason_code text,
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
  v_actor_user_id uuid;
  v_actor_id text;
  v_key text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_state_revision bigint;
  v_latest_version_id text;
  v_replay jsonb;
  v_current_status text;
  v_impact_review_id text := 'impact-review:' || pg_catalog.gen_random_uuid()::text;
  v_reviewed_at timestamptz := statement_timestamp();
  v_result jsonb;
begin
  select hc.organization_id, hc.actor_user_id, hc.actor_id
    into v_organization_id, v_actor_user_id, v_actor_id
  from project_intelligence._human_context(project_id, 'review_change_impact') hc;

  perform project_intelligence._assert_domain_id(impact_run_id, 'impact_run_id');
  perform project_intelligence._assert_domain_id(impact_id, 'impact_id');
  perform project_intelligence._assert_state_revision(expected_state_revision);
  if expected_impact_status not in (
    'needs_review', 'accepted', 'resolved', 'dismissed'
  ) then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"field":"expected_impact_status"}'::jsonb
    );
  end if;
  if disposition not in ('accepted', 'resolved', 'dismissed') then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"field":"disposition"}'::jsonb
    );
  end if;
  if reason_code not in (
    'downstream_update_required',
    'cost_recalculation_required',
    'schedule_updated',
    'downstream_update_completed',
    'not_applicable_to_impacted_node',
    'not_applicable_to_deliverable'
  ) then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"field":"reason_code"}'::jsonb
    );
  end if;

  v_key := project_intelligence._assert_idempotency_key(idempotency_key);
  v_key_digest := project_intelligence._sha256_text(v_key);
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'disposition', disposition,
      'expectedImpactStatus', expected_impact_status,
      'expectedStateRevision', expected_state_revision,
      'impactId', impact_id,
      'impactRunId', impact_run_id,
      'operation', 'review_impact',
      'projectId', project_id,
      'reasonCode', reason_code
    )
  );

  select lw.state_revision, lw.latest_version_id
    into v_state_revision, v_latest_version_id
  from project_intelligence._lock_workflow(v_organization_id, project_id) lw;

  v_replay := project_intelligence._replay_or_null(
    v_organization_id,
    project_id,
    'review_impact',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_state_revision <> expected_state_revision then
    perform project_intelligence._raise_contract_error(
      'P1006',
      'STATE_STALE',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  perform i.impact_id
  from project_intelligence.impact_runs ir
  join project_intelligence.impacts i
    on i.organization_id = ir.organization_id
   and i.project_id = ir.project_id
   and i.impact_run_id = ir.impact_run_id
   and i.impact_id = impact_id
  where ir.organization_id = v_organization_id
    and ir.project_id = project_id
    and ir.impact_run_id = impact_run_id
  order by ir.impact_run_id collate "C", i.impact_id collate "C"
  for update of ir, i;

  if not found then
    perform project_intelligence._raise_contract_error(
      'P1012',
      'IMPACT_STALE',
      '{"reason":"IMPACT_NOT_IN_RUN"}'::jsonb
    );
  end if;

  select coalesce(
    (
      select review.disposition
      from project_intelligence.impact_reviews review
      where review.organization_id = v_organization_id
        and review.project_id = project_id
        and review.impact_run_id = impact_run_id
        and review.impact_id = impact_id
        and review.previous_status = 'accepted'
      limit 1
    ),
    (
      select review.disposition
      from project_intelligence.impact_reviews review
      where review.organization_id = v_organization_id
        and review.project_id = project_id
        and review.impact_run_id = impact_run_id
        and review.impact_id = impact_id
        and review.previous_status = 'needs_review'
      limit 1
    ),
    'needs_review'
  )
    into v_current_status;

  if v_current_status <> expected_impact_status then
    perform project_intelligence._raise_contract_error(
      'P1012',
      'IMPACT_STALE',
      jsonb_build_object('currentImpactStatus', v_current_status)
    );
  end if;
  if not (
    (v_current_status = 'needs_review'
      and disposition in ('accepted', 'resolved', 'dismissed'))
    or
    (v_current_status = 'accepted'
      and disposition in ('resolved', 'dismissed'))
  ) then
    perform project_intelligence._raise_contract_error(
      'P1012',
      'IMPACT_STALE',
      jsonb_build_object(
        'currentImpactStatus', v_current_status,
        'reason', 'IMPACT_STATUS_TERMINAL_OR_DUPLICATE'
      )
    );
  end if;

  insert into project_intelligence.impact_reviews (
    organization_id,
    project_id,
    impact_review_id,
    impact_run_id,
    impact_id,
    previous_status,
    disposition,
    reason_code,
    actor_user_id,
    reviewed_at
  )
  values (
    v_organization_id,
    project_id,
    v_impact_review_id,
    impact_run_id,
    impact_id,
    v_current_status,
    disposition,
    reason_code,
    v_actor_user_id,
    v_reviewed_at
  );

  v_result := jsonb_build_object(
    'actor', jsonb_build_object('actorId', v_actor_id, 'actorType', 'human'),
    'disposition', disposition,
    'id', v_impact_review_id,
    'impactId', impact_id,
    'impactRunId', impact_run_id,
    'previousStatus', v_current_status,
    'projectId', project_id,
    'reasonCode', reason_code,
    'reviewedAt', v_reviewed_at,
    'stateRevision', v_state_revision + 1
  );

  return project_intelligence._complete_command(
    v_organization_id,
    project_id,
    'review_impact',
    v_key_digest,
    v_request_digest,
    'human',
    v_actor_id,
    v_actor_user_id,
    v_result,
    'impact_reviewed',
    jsonb_build_object(
      'disposition', disposition,
      'impact_id', impact_id,
      'impact_review_id', v_impact_review_id,
      'impact_run_id', impact_run_id,
      'previous_status', v_current_status,
      'reason_code', reason_code
    ),
    v_state_revision
  );
end;
$function$;

create or replace function project_intelligence_api.build_handoff(
  project_id uuid,
  impact_run_id text,
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
  v_key text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_state_revision bigint;
  v_latest_version_id text;
  v_replay jsonb;
  v_version_id text;
  v_version_no bigint;
  v_base_version_id text;
  v_label text;
  v_change_set_id text;
  v_reason_code text;
  v_handoff_id text := 'handoff:' || pg_catalog.gen_random_uuid()::text;
  v_created_at timestamptz := statement_timestamp();
  v_logical_content jsonb;
  v_semantic_digest bytea;
  v_artifact_descriptor jsonb;
  v_unresolved_count bigint;
  v_resolved_count bigint;
  v_result jsonb;
begin
  v_organization_id := project_intelligence._worker_context(project_id);
  perform project_intelligence._assert_domain_id(impact_run_id, 'impact_run_id');
  perform project_intelligence._assert_state_revision(expected_state_revision);
  v_key := project_intelligence._assert_idempotency_key(idempotency_key);
  v_key_digest := project_intelligence._sha256_text(v_key);
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'expectedStateRevision', expected_state_revision,
      'impactRunId', impact_run_id,
      'operation', 'build_handoff',
      'projectId', project_id
    )
  );

  select lw.state_revision, lw.latest_version_id
    into v_state_revision, v_latest_version_id
  from project_intelligence._lock_workflow(v_organization_id, project_id) lw;

  v_replay := project_intelligence._replay_or_null(
    v_organization_id,
    project_id,
    'build_handoff',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_state_revision <> expected_state_revision then
    perform project_intelligence._raise_contract_error(
      'P1006',
      'STATE_STALE',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select
    ir.to_version_id,
    pv.version_no,
    pv.base_version_id,
    coalesce(pv.label, ''),
    ir.change_set_id,
    cs.reason_code
  into
    v_version_id,
    v_version_no,
    v_base_version_id,
    v_label,
    v_change_set_id,
    v_reason_code
  from project_intelligence.impact_runs ir
  join project_intelligence.project_versions pv
    on pv.organization_id = ir.organization_id
   and pv.project_id = ir.project_id
   and pv.version_id = ir.to_version_id
  join project_intelligence.change_sets cs
    on cs.organization_id = ir.organization_id
   and cs.project_id = ir.project_id
   and cs.change_set_id = ir.change_set_id
  where ir.organization_id = v_organization_id
    and ir.project_id = project_id
    and ir.impact_run_id = impact_run_id
  order by ir.impact_run_id collate "C", pv.version_id collate "C"
  for update of ir, pv, cs;

  if not found then
    perform project_intelligence._raise_contract_error(
      'P1012',
      'IMPACT_STALE',
      '{"reason":"EXACT_IMPACT_RUN_REQUIRED"}'::jsonb
    );
  end if;

  -- Every impact needs a valid completed review chain. Accepted remains unresolved;
  -- resolved/dismissed are terminal and included in the resolved projection.
  if exists (
    select 1
    from project_intelligence.impacts i
    left join lateral (
      select coalesce(
        (
          select r.disposition
          from project_intelligence.impact_reviews r
          where r.organization_id = i.organization_id
            and r.project_id = i.project_id
            and r.impact_run_id = i.impact_run_id
            and r.impact_id = i.impact_id
            and r.previous_status = 'accepted'
          limit 1
        ),
        (
          select r.disposition
          from project_intelligence.impact_reviews r
          where r.organization_id = i.organization_id
            and r.project_id = i.project_id
            and r.impact_run_id = i.impact_run_id
            and r.impact_id = i.impact_id
            and r.previous_status = 'needs_review'
          limit 1
        ),
        'needs_review'
      ) as current_status
    ) status on true
    where i.organization_id = v_organization_id
      and i.project_id = project_id
      and i.impact_run_id = impact_run_id
      and status.current_status = 'needs_review'
  ) then
    perform project_intelligence._raise_contract_error(
      'P1008',
      'INVALID_TRANSITION',
      '{"reason":"IMPACT_REVIEW_INCOMPLETE"}'::jsonb
    );
  end if;

  with selected as (
    select
      vn.node_id,
      vn.revision_id,
      n.kind,
      n.stable_key,
      r.title,
      r.payload,
      r.origin,
      r.claim_status
    from project_intelligence.version_nodes vn
    join project_intelligence.graph_nodes n
      on n.organization_id = vn.organization_id
     and n.project_id = vn.project_id
     and n.node_id = vn.node_id
    join project_intelligence.graph_node_revisions r
      on r.organization_id = vn.organization_id
     and r.project_id = vn.project_id
     and r.node_id = vn.node_id
     and r.revision_id = vn.revision_id
    where vn.organization_id = v_organization_id
      and vn.project_id = project_id
      and vn.version_id = v_version_id
  ),
  evidence_roles as (
    select
      el.evidence_link_id,
      el.node_revision_id,
      el.source_fragment_id,
      'direct'::text as evidence_role
    from selected s
    join project_intelligence.evidence_links el
      on el.organization_id = v_organization_id
     and el.project_id = project_id
     and el.node_revision_id = s.revision_id
    where s.kind in ('requirement', 'decision', 'item')
    union
    select
      el.evidence_link_id,
      el.node_revision_id,
      el.source_fragment_id,
      'superseded_input'::text as evidence_role
    from project_intelligence.impact_run_changes change
    join project_intelligence.graph_nodes n
      on n.organization_id = change.organization_id
     and n.project_id = change.project_id
     and n.node_id = change.node_id
     and n.kind = 'decision'
    join project_intelligence.evidence_links el
      on el.organization_id = change.organization_id
     and el.project_id = change.project_id
     and el.node_revision_id = change.from_revision_id
    where change.organization_id = v_organization_id
      and change.project_id = project_id
      and change.impact_run_id = impact_run_id
      and not exists (
        select 1
        from selected direct_selected
        where direct_selected.revision_id = el.node_revision_id
      )
  ),
  evidence_projection as (
    select distinct on (er.evidence_link_id)
      er.evidence_link_id,
      er.node_revision_id,
      er.source_fragment_id,
      er.evidence_role,
      'source-reference:' || substr(encode(
        project_intelligence._sha256_jsonb(
          jsonb_build_array(er.evidence_link_id, er.evidence_role)
        ),
        'hex'
      ), 1, 32) as reference_id
    from evidence_roles er
    order by er.evidence_link_id,
             case er.evidence_role when 'direct' then 0 else 1 end
  ),
  current_impact_status as (
    select
      i.impact_id,
      i.changed_node_id,
      i.impacted_node_id,
      i.node_path,
      coalesce(
        (
          select r.disposition
          from project_intelligence.impact_reviews r
          where r.organization_id = i.organization_id
            and r.project_id = i.project_id
            and r.impact_run_id = i.impact_run_id
            and r.impact_id = i.impact_id
            and r.previous_status = 'accepted'
          limit 1
        ),
        (
          select r.disposition
          from project_intelligence.impact_reviews r
          where r.organization_id = i.organization_id
            and r.project_id = i.project_id
            and r.impact_run_id = i.impact_run_id
            and r.impact_id = i.impact_id
            and r.previous_status = 'needs_review'
          limit 1
        )
      ) as status,
      coalesce((
        select jsonb_agg(ps.edge_id order by ps.step_no)
        from project_intelligence.impact_path_steps ps
        where ps.organization_id = i.organization_id
          and ps.project_id = i.project_id
          and ps.impact_id = i.impact_id
      ), '[]'::jsonb) as edge_ids
    from project_intelligence.impacts i
    where i.organization_id = v_organization_id
      and i.project_id = project_id
      and i.impact_run_id = impact_run_id
  )
  select jsonb_build_object(
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(nullif(s.payload ->> 'name', ''), s.title),
        'nodeId', s.node_id,
        'revisionId', s.revision_id,
        'stableKey', s.stable_key
      ) order by s.node_id collate "C")
      from selected s
      where s.kind = 'area'
    ), '[]'::jsonb),
    'canonicalMetadata', '{}'::jsonb,
    'decisions', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'claimStatus', coalesce((
          select case hr.decision
            when 'confirmed' then 'human_confirmed'
            else 'human_rejected'
          end
          from project_intelligence.version_reviews vr
          join project_intelligence.human_reviews hr
            on hr.organization_id = vr.organization_id
           and hr.project_id = vr.project_id
           and hr.review_id = vr.review_id
          where vr.organization_id = v_organization_id
            and vr.project_id = project_id
            and vr.version_id = v_version_id
            and hr.target_revision_id = s.revision_id
          limit 1
        ), s.claim_status),
        'contentOrigin', s.origin,
        'material', coalesce(s.payload ->> 'material', ''),
        'nodeId', s.node_id,
        'provenance', (
          select jsonb_build_object(
            'changeSetId', v_change_set_id,
            'previousRevisionId', change.from_revision_id,
            'previousSourceReferenceIds', coalesce((
              select jsonb_agg(ep.reference_id order by ep.reference_id collate "C")
              from evidence_projection ep
              where ep.node_revision_id = change.from_revision_id
            ), '[]'::jsonb),
            'reasonCode', v_reason_code
          )
          from project_intelligence.impact_run_changes change
          where change.organization_id = v_organization_id
            and change.project_id = project_id
            and change.impact_run_id = impact_run_id
            and change.node_id = s.node_id
            and change.from_revision_id is not null
          limit 1
        ),
        'revisionId', s.revision_id,
        'summary', s.title
      )) order by s.node_id collate "C")
      from selected s
      where s.kind = 'decision'
    ), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nodeId', s.node_id,
        'revisionId', s.revision_id,
        'title', s.title
      ) order by s.node_id collate "C")
      from selected s
      where s.kind = 'deliverable'
    ), '[]'::jsonb),
    'displayMetadata', '{}'::jsonb,
    'impacts', jsonb_build_object(
      'resolved', coalesce((
        select jsonb_agg(jsonb_build_object(
          'changedNodeId', status.changed_node_id,
          'edgeIds', status.edge_ids,
          'impactId', status.impact_id,
          'impactedNodeId', status.impacted_node_id,
          'nodePath', to_jsonb(status.node_path),
          'status', status.status
        ) order by status.changed_node_id collate "C",
                   status.impacted_node_id collate "C")
        from current_impact_status status
        where status.status in ('resolved', 'dismissed')
      ), '[]'::jsonb),
      'unresolved', coalesce((
        select jsonb_agg(jsonb_build_object(
          'changedNodeId', status.changed_node_id,
          'edgeIds', status.edge_ids,
          'impactId', status.impact_id,
          'impactedNodeId', status.impacted_node_id,
          'nodePath', to_jsonb(status.node_path),
          'status', status.status
        ) order by status.changed_node_id collate "C",
                   status.impacted_node_id collate "C")
        from current_impact_status status
        where status.status = 'accepted'
      ), '[]'::jsonb)
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'areaNodeId', coalesce(s.payload ->> 'areaId', ''),
        'name', coalesce(nullif(s.payload ->> 'name', ''), s.title),
        'nodeId', s.node_id,
        'revisionId', s.revision_id,
        'sourceReferenceIds', coalesce((
          select jsonb_agg(ep.reference_id order by ep.reference_id collate "C")
          from evidence_projection ep
          where ep.node_revision_id = s.revision_id
        ), '[]'::jsonb)
      ) order by s.node_id collate "C")
      from selected s
      where s.kind = 'item'
    ), '[]'::jsonb),
    'project', jsonb_build_object(
      'baseVersionId', v_base_version_id,
      'label', v_label,
      'projectId', project_id,
      'versionId', v_version_id,
      'versionNo', v_version_no
    ),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimStatus', coalesce((
          select case hr.decision
            when 'confirmed' then 'human_confirmed'
            else 'human_rejected'
          end
          from project_intelligence.version_reviews vr
          join project_intelligence.human_reviews hr
            on hr.organization_id = vr.organization_id
           and hr.project_id = vr.project_id
           and hr.review_id = vr.review_id
          where vr.organization_id = v_organization_id
            and vr.project_id = project_id
            and vr.version_id = v_version_id
            and hr.target_revision_id = s.revision_id
          limit 1
        ), s.claim_status),
        'contentOrigin', s.origin,
        'nodeId', s.node_id,
        'revisionId', s.revision_id,
        'sourceReferenceIds', coalesce((
          select jsonb_agg(ep.reference_id order by ep.reference_id collate "C")
          from evidence_projection ep
          where ep.node_revision_id = s.revision_id
        ), '[]'::jsonb),
        'summary', s.title
      ) order by s.node_id collate "C")
      from selected s
      where s.kind = 'requirement'
    ), '[]'::jsonb),
    'schemaVersion', 'project-intelligence-handoff/0.1',
    'sourceReferences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'evidenceRole', ep.evidence_role,
        'fragmentId', sf.fragment_id,
        'id', ep.reference_id,
        'locator', sf.locator,
        'sourceId', sf.source_id
      ) order by ep.reference_id collate "C")
      from evidence_projection ep
      join project_intelligence.source_fragments sf
        on sf.organization_id = v_organization_id
       and sf.project_id = project_id
       and sf.fragment_id = ep.source_fragment_id
    ), '[]'::jsonb)
  )
    into v_logical_content;

  if v_logical_content::text ~ '"(artifactId|generatedAt|jobStatus|signedUrl)"[[:space:]]*:'
  then
    perform project_intelligence._raise_contract_error(
      'P1011',
      'DOMAIN_CONTRACT_VIOLATION',
      '{"reason":"VOLATILE_FIELD_IN_LOGICAL_CONTENT"}'::jsonb
    );
  end if;

  v_semantic_digest := project_intelligence._sha256_jsonb(v_logical_content);
  v_artifact_descriptor := jsonb_build_object(
    'artifactId', v_handoff_id,
    'format', 'logical_json',
    'generatedAt', v_created_at,
    'jobStatus', 'ready',
    'semanticContentHash', 'sha256:' || encode(v_semantic_digest, 'hex')
  );

  insert into project_intelligence.logical_handoffs (
    organization_id,
    project_id,
    handoff_id,
    version_id,
    impact_run_id,
    logical_content,
    semantic_content_digest,
    contract_version,
    hash_contract_version,
    artifact_descriptor,
    created_by_type,
    created_by_id,
    created_at
  )
  values (
    v_organization_id,
    project_id,
    v_handoff_id,
    v_version_id,
    impact_run_id,
    v_logical_content,
    v_semantic_digest,
    'project-intelligence-vertical-slice/0.1',
    'recursive-sorted-object-keys-arrays-preserve-contract-order/1',
    v_artifact_descriptor,
    'system',
    'system:project-intelligence-db2',
    v_created_at
  );

  insert into project_intelligence.handoff_impact_reviews (
    organization_id,
    project_id,
    handoff_id,
    impact_review_id
  )
  select
    review.organization_id,
    review.project_id,
    v_handoff_id,
    review.impact_review_id
  from project_intelligence.impact_reviews review
  where review.organization_id = v_organization_id
    and review.project_id = project_id
    and review.impact_run_id = impact_run_id
  order by review.impact_review_id collate "C";

  select
    jsonb_array_length(v_logical_content #> '{impacts,unresolved}'),
    jsonb_array_length(v_logical_content #> '{impacts,resolved}')
  into v_unresolved_count, v_resolved_count;

  v_result := jsonb_build_object(
    'artifact', v_artifact_descriptor,
    'contractVersion', 'project-intelligence-vertical-slice/0.1',
    'hashContract', jsonb_build_object(
      'algorithm', 'sha256',
      'canonicalization', 'recursive_sorted_object_keys_arrays_preserve_contract_order',
      'encoding', 'utf-8',
      'excludedVolatileFields', jsonb_build_array(
        'artifactId', 'generatedAt', 'jobStatus'
      ),
      'hashedField', 'logicalContent'
    ),
    'logicalContent', v_logical_content,
    'stateRevision', v_state_revision + 1
  );

  return project_intelligence._complete_command(
    v_organization_id,
    project_id,
    'build_handoff',
    v_key_digest,
    v_request_digest,
    'system',
    'system:project-intelligence-db2',
    null,
    v_result,
    'logical_handoff_built',
    jsonb_build_object(
      'handoff_id', v_handoff_id,
      'impact_run_id', impact_run_id,
      'resolved_impact_count', v_resolved_count,
      'unresolved_impact_count', v_unresolved_count,
      'version_id', v_version_id
    ),
    v_state_revision
  );
end;
$function$;

alter function project_intelligence._raise_contract_error(text, text, jsonb)
  owner to pi_table_owner;
alter function project_intelligence._sha256_text(text)
  owner to pi_table_owner;
alter function project_intelligence._canonical_jsonb(jsonb)
  owner to pi_table_owner;
alter function project_intelligence._sha256_jsonb(jsonb)
  owner to pi_table_owner;
alter function project_intelligence._assert_domain_id(text, text)
  owner to pi_table_owner;
alter function project_intelligence._assert_idempotency_key(text)
  owner to pi_table_owner;
alter function project_intelligence._assert_state_revision(bigint)
  owner to pi_table_owner;
alter function project_intelligence._human_context(uuid, text)
  owner to pi_table_owner;
alter function project_intelligence._worker_context(uuid)
  owner to pi_table_owner;
alter function project_intelligence._replay_or_null(uuid, uuid, text, bytea, bytea)
  owner to pi_table_owner;
alter function project_intelligence._lock_workflow(uuid, uuid)
  owner to pi_table_owner;
alter function project_intelligence._json_pointer_segment(text)
  owner to pi_table_owner;
alter function project_intelligence._jsonb_diff_paths(jsonb, jsonb, text)
  owner to pi_table_owner;
alter function project_intelligence._complete_command(
  uuid,
  uuid,
  text,
  bytea,
  bytea,
  text,
  text,
  uuid,
  jsonb,
  text,
  jsonb,
  bigint,
  boolean,
  text
)
  owner to pi_table_owner;

revoke all on all functions in schema project_intelligence
  from public, anon, authenticated, service_role;

grant execute on function
  project_intelligence._raise_contract_error(text, text, jsonb),
  project_intelligence._sha256_text(text),
  project_intelligence._canonical_jsonb(jsonb),
  project_intelligence._sha256_jsonb(jsonb),
  project_intelligence._assert_domain_id(text, text),
  project_intelligence._assert_idempotency_key(text),
  project_intelligence._assert_state_revision(bigint),
  project_intelligence._replay_or_null(uuid, uuid, text, bytea, bytea),
  project_intelligence._lock_workflow(uuid, uuid),
  project_intelligence._complete_command(
    uuid,
    uuid,
    text,
    bytea,
    bytea,
    text,
    text,
    uuid,
    jsonb,
    text,
    jsonb,
    bigint,
    boolean,
    text
  )
  to pi_human_executor, pi_worker_executor;

grant execute on function
  project_intelligence._human_context(uuid, text)
  to pi_human_executor;

grant execute on function
  project_intelligence._worker_context(uuid),
  project_intelligence._json_pointer_segment(text),
  project_intelligence._jsonb_diff_paths(jsonb, jsonb, text)
  to pi_worker_executor;

grant usage on schema extensions
  to pi_table_owner, pi_human_executor, pi_worker_executor;
grant execute on function extensions.digest(bytea, text)
  to pi_table_owner, pi_human_executor, pi_worker_executor;

-- A function's new owner needs CREATE on its schema during ALTER OWNER. Keep that
-- capability only for this ownership handoff and revoke it before commit.
grant create on schema project_intelligence_api
  to pi_human_executor, pi_worker_executor;

alter function project_intelligence_api.review_claim(
  uuid, text, text, bigint, text, text
) owner to pi_human_executor;
alter function project_intelligence_api.publish_version(
  uuid, text, bigint, text, jsonb, text
) owner to pi_human_executor;
alter function project_intelligence_api.revise_decision(
  uuid, text, text, text, bigint, text, jsonb, text, text, text
) owner to pi_human_executor;
alter function project_intelligence_api.review_impact(
  uuid, text, text, text, text, text, bigint, text
) owner to pi_human_executor;

alter function project_intelligence_api.calculate_impact(
  uuid, text, bigint, text
) owner to pi_worker_executor;
alter function project_intelligence_api.build_handoff(
  uuid, text, bigint, text
) owner to pi_worker_executor;

revoke all on all functions in schema project_intelligence_api
  from public, anon, authenticated, service_role;
revoke create on schema project_intelligence_api
  from pi_human_executor, pi_worker_executor;
revoke all on schema project_intelligence_api
  from public, anon;
grant usage on schema project_intelligence_api
  to authenticated, service_role;

grant execute on function
  project_intelligence_api.review_claim(uuid, text, text, bigint, text, text),
  project_intelligence_api.publish_version(uuid, text, bigint, text, jsonb, text),
  project_intelligence_api.revise_decision(
    uuid, text, text, text, bigint, text, jsonb, text, text, text
  ),
  project_intelligence_api.review_impact(
    uuid, text, text, text, text, text, bigint, text
  )
  to authenticated;

grant execute on function
  project_intelligence_api.calculate_impact(uuid, text, bigint, text),
  project_intelligence_api.build_handoff(uuid, text, bigint, text)
  to service_role;

commit;
