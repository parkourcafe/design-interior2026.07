-- Persist provider usage independently before business output is finalized.
-- This prevents a later passport/risk validation error from rolling back cost evidence.

create or replace function public.record_m1_risk_ai_usage(
  p_workflow_step_run_id uuid,
  p_ai_call_id uuid,
  p_provider text,
  p_model text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_duration_ms integer,
  p_provider_cost_estimate numeric(14,6),
  p_estimate_source text,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ai_call public.ai_calls;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select a.* into v_ai_call
  from public.ai_calls a
  join public.workflow_step_runs s on s.id = a.workflow_step_run_id
  join public.workflow_runs w on w.id = s.workflow_run_id
  join public.projects p on p.id = w.project_id
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = p_workflow_step_run_id
    and a.lifecycle_state in ('reserved', 'completed')
    and a.action_key = 'generate_risk_register'
    and s.status = 'running'
    and private.is_studio_member(p.designer_id)
  for update of a;
  if not found then
    raise exception 'risk AI reservation not found or access denied';
  end if;

  if nullif(btrim(p_provider), '') is null
    or nullif(btrim(p_model), '') is null
    or p_tokens_in is null
    or p_tokens_out is null
    or p_duration_ms is null
    or p_provider_cost_estimate is null
    or p_tokens_in < 0
    or p_tokens_out < 0
    or p_duration_ms < 0
    or p_provider_cost_estimate < 0
    or p_estimate_source not in ('static_table', 'provider_response')
    or p_outcome not in ('success', 'schema_fail', 'provider_error', 'timeout') then
    raise exception 'completed provider usage is invalid';
  end if;

  if v_ai_call.lifecycle_state = 'completed' then
    if v_ai_call.provider is distinct from btrim(p_provider)
      or v_ai_call.model is distinct from btrim(p_model)
      or v_ai_call.tokens_in is distinct from p_tokens_in
      or v_ai_call.tokens_out is distinct from p_tokens_out
      or v_ai_call.duration_ms is distinct from p_duration_ms
      or v_ai_call.provider_cost_estimate is distinct from p_provider_cost_estimate
      or v_ai_call.estimate_source is distinct from p_estimate_source
      or v_ai_call.outcome is distinct from p_outcome then
      raise exception 'completed AI usage is immutable';
    end if;
    return;
  end if;

  update public.ai_calls
  set provider = btrim(p_provider),
      model = btrim(p_model),
      tokens_in = p_tokens_in,
      tokens_out = p_tokens_out,
      duration_ms = p_duration_ms,
      provider_cost_estimate = p_provider_cost_estimate,
      estimate_source = p_estimate_source,
      outcome = p_outcome,
      lifecycle_state = 'completed'
  where id = v_ai_call.id;
end;
$$;

revoke all on function public.record_m1_risk_ai_usage(
  uuid, uuid, text, text, integer, integer, integer, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.record_m1_risk_ai_usage(
  uuid, uuid, text, text, integer, integer, integer, numeric, text, text
) to authenticated;

-- Atomically finalize authenticated M1 business output after usage is durable.

create or replace function public.finalize_m1_risk_rerun(
  p_workflow_step_run_id uuid,
  p_ai_call_id uuid,
  p_passport jsonb,
  p_risk_cards jsonb,
  p_output_snapshot jsonb,
  p_provider text,
  p_model text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_duration_ms integer,
  p_provider_cost_estimate numeric(14,6),
  p_estimate_source text,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_step public.workflow_step_runs;
  v_ai_call public.ai_calls;
  v_run public.workflow_runs;
  v_project_id uuid;
  v_card jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select s.* into v_step
  from public.workflow_step_runs s
  join public.workflow_runs w on w.id = s.workflow_run_id
  join public.projects p on p.id = w.project_id
  where s.id = p_workflow_step_run_id
    and s.step_key = 'generate_risk_register'
    and s.status = 'running'
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and private.is_studio_member(p.designer_id)
  for update of s;

  if not found then
    raise exception 'running risk workflow step not found or access denied';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  where w.id = v_step.workflow_run_id
  for update;
  if not found then
    raise exception 'workflow run not found for risk step';
  end if;
  v_project_id := v_run.project_id;

  select a.* into v_ai_call
  from public.ai_calls a
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = v_step.id
    and a.workflow_run_id = v_step.workflow_run_id
    and a.project_id = v_project_id
    and a.lifecycle_state = 'completed'
    and a.action_key = 'generate_risk_register'
  for update;

  if not found then
    raise exception 'measured risk AI call not found for workflow step';
  end if;

  if p_passport is null or jsonb_typeof(p_passport) <> 'object' then
    raise exception 'passport must be a JSON object';
  end if;
  if p_risk_cards is null or jsonb_typeof(p_risk_cards) <> 'array' then
    raise exception 'risk cards must be a JSON array';
  end if;
  if p_output_snapshot is null or jsonb_typeof(p_output_snapshot) <> 'object' then
    raise exception 'output snapshot must be a JSON object';
  end if;
  if nullif(btrim(p_provider), '') is null
    or nullif(btrim(p_model), '') is null then
    raise exception 'provider and model are required';
  end if;
  if p_tokens_in is null
    or p_tokens_out is null
    or p_duration_ms is null
    or p_provider_cost_estimate is null
    or p_tokens_in < 0
    or p_tokens_out < 0
    or p_duration_ms < 0
    or p_provider_cost_estimate < 0 then
    raise exception 'AI usage values cannot be negative';
  end if;
  if p_estimate_source is null
    or p_estimate_source not in ('static_table', 'provider_response') then
    raise exception 'invalid estimate source';
  end if;
  if p_outcome is null
    or p_outcome not in ('success', 'schema_fail', 'provider_error', 'timeout') then
    raise exception 'invalid AI outcome';
  end if;

  for v_card in
    select value from jsonb_array_elements(p_risk_cards)
  loop
    if jsonb_typeof(v_card) <> 'object' then
      raise exception 'each risk card must be a JSON object';
    end if;
    if not (
      v_card ?& array[
        'risk_type',
        'evidence',
        'impact',
        'confidence',
        'designer_action',
        'proposal_implication',
        'source'
      ]
    ) then
      raise exception 'risk card is missing required fields';
    end if;
    if exists (
      select 1
      from jsonb_object_keys(v_card) as field_name
      where field_name <> all (
        array[
          'risk_type',
          'evidence',
          'impact',
          'confidence',
          'designer_action',
          'proposal_implication',
          'source'
        ]::text[]
      )
    ) then
      raise exception 'risk card contains unsupported fields';
    end if;
    if jsonb_typeof(v_card->'risk_type') <> 'string'
      or jsonb_typeof(v_card->'evidence') <> 'array'
      or jsonb_typeof(v_card->'impact') <> 'string'
      or jsonb_typeof(v_card->'confidence') <> 'string'
      or jsonb_typeof(v_card->'designer_action') <> 'string'
      or jsonb_typeof(v_card->'proposal_implication') <> 'string'
      or jsonb_typeof(v_card->'source') <> 'string' then
      raise exception 'risk card fields have invalid JSON types';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_card->'evidence') as evidence(value)
      where jsonb_typeof(evidence.value) <> 'string'
    ) then
      raise exception 'risk card evidence must contain only strings';
    end if;
    if v_card->>'risk_type' not in (
      'budget', 'timeline', 'function', 'style', 'technical'
    ) then
      raise exception 'invalid risk type';
    end if;
    if v_card->>'confidence' not in ('low', 'medium', 'high') then
      raise exception 'invalid risk confidence';
    end if;
    if v_card->>'source' not in ('rule', 'llm') then
      raise exception 'invalid risk source';
    end if;
  end loop;

  update public.projects
  set passport = p_passport
  where id = v_project_id;

  delete from public.risk_cards
  where project_id = v_project_id
    and status = 'proposed';

  insert into public.risk_cards(
    project_id,
    risk_type,
    evidence,
    impact,
    confidence,
    designer_action,
    proposal_implication,
    status,
    source
  )
  select
    v_project_id,
    card.risk_type,
    array(
      select evidence.value
      from jsonb_array_elements_text(card.evidence) as evidence(value)
    ),
    card.impact,
    card.confidence,
    card.designer_action,
    card.proposal_implication,
    'proposed',
    card.source
  from jsonb_to_recordset(p_risk_cards) as card(
    risk_type text,
    evidence jsonb,
    impact text,
    confidence text,
    designer_action text,
    proposal_implication text,
    source text
  );

  update public.workflow_step_runs
  set status = 'completed',
      output_snapshot = p_output_snapshot,
      error = null,
      completed_at = now()
  where id = p_workflow_step_run_id;

  if v_run.status = 'retrying' then
    update public.workflow_runs
    set status = 'running',
        error_state = null
    where id = v_run.id
      and status = 'retrying';
    if not found then
      raise exception 'retry workflow changed concurrently';
    end if;

    update public.workflow_runs
    set status = 'waiting_for_human',
        current_step = 'human_review'
    where id = v_run.id
      and status = 'running';
    if not found then
      raise exception 'retry workflow could not enter human review';
    end if;

    insert into public.audit_events(
      project_id,
      actor_id,
      actor_type,
      event_type,
      entity_type,
      entity_id,
      workflow_run_id,
      payload
    )
    values (
      v_project_id,
      v_actor,
      'human',
      'workflow_retry_completed',
      'WorkflowStepRun',
      p_workflow_step_run_id,
      v_run.id,
      jsonb_build_object(
        'step_key', 'generate_risk_register',
        'attempt', v_step.attempt
      )
    );
  end if;

  insert into public.audit_events(
    project_id,
    actor_id,
    actor_type,
    event_type,
    entity_type,
    entity_id,
    workflow_run_id,
    payload
  )
  values (
    v_project_id,
    v_actor,
    'human',
    'risk_register_generated',
    'WorkflowStepRun',
    p_workflow_step_run_id,
    v_step.workflow_run_id,
    jsonb_build_object(
      'ai_call_id', p_ai_call_id,
      'risk_card_count', jsonb_array_length(p_risk_cards),
      'outcome', p_outcome
    )
  );

  return jsonb_build_object(
    'workflow_step_run_id', p_workflow_step_run_id,
    'ai_call_id', p_ai_call_id,
    'risk_card_count', jsonb_array_length(p_risk_cards)
  );
end;
$$;

revoke all on function public.finalize_m1_risk_rerun(
  uuid, uuid, jsonb, jsonb, jsonb, text, text,
  integer, integer, integer, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_m1_risk_rerun(
  uuid, uuid, jsonb, jsonb, jsonb, text, text,
  integer, integer, integer, numeric, text, text
) to authenticated;

create or replace function public.close_m1_risk_ai_reservation(
  p_workflow_step_run_id uuid,
  p_ai_call_id uuid,
  p_provider_completed boolean,
  p_provider text,
  p_model text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_duration_ms integer,
  p_provider_cost_estimate numeric(14,6),
  p_estimate_source text,
  p_outcome text,
  p_error jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_step public.workflow_step_runs;
  v_run public.workflow_runs;
  v_ai_call public.ai_calls;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_error is null or jsonb_typeof(p_error) <> 'object' then
    raise exception 'error payload must be a JSON object';
  end if;

  select s.* into v_step
  from public.workflow_step_runs s
  join public.workflow_runs w on w.id = s.workflow_run_id
  join public.projects p on p.id = w.project_id
  where s.id = p_workflow_step_run_id
    and s.step_key = 'generate_risk_register'
    and s.status = 'running'
    and private.is_studio_member(p.designer_id)
  for update of s;
  if not found then
    raise exception 'running risk workflow step not found or access denied';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  where w.id = v_step.workflow_run_id
  for update;
  if not found then
    raise exception 'workflow run not found for risk step';
  end if;

  select a.* into v_ai_call
  from public.ai_calls a
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = v_step.id
    and a.workflow_run_id = v_run.id
    and a.project_id = v_run.project_id
    and a.lifecycle_state in ('reserved', 'completed')
    and a.action_key = 'generate_risk_register'
  for update;
  if not found then
    raise exception 'risk AI call not found for workflow step';
  end if;

  if p_provider_completed and v_ai_call.lifecycle_state = 'reserved' then
    if nullif(btrim(p_provider), '') is null
      or nullif(btrim(p_model), '') is null
      or p_tokens_in is null
      or p_tokens_out is null
      or p_duration_ms is null
      or p_provider_cost_estimate is null
      or p_tokens_in < 0
      or p_tokens_out < 0
      or p_duration_ms < 0
      or p_provider_cost_estimate < 0
      or p_estimate_source not in ('static_table', 'provider_response')
      or p_outcome not in ('success', 'schema_fail', 'provider_error', 'timeout') then
      raise exception 'completed provider usage is invalid';
    end if;

    update public.ai_calls
    set provider = btrim(p_provider),
        model = btrim(p_model),
        tokens_in = p_tokens_in,
        tokens_out = p_tokens_out,
        duration_ms = p_duration_ms,
        provider_cost_estimate = p_provider_cost_estimate,
        estimate_source = p_estimate_source,
        outcome = p_outcome,
        lifecycle_state = 'completed'
    where id = v_ai_call.id;
  elsif not p_provider_completed and v_ai_call.lifecycle_state = 'reserved' then
    update public.ai_calls
    set outcome = 'abandoned',
        lifecycle_state = 'abandoned'
    where id = v_ai_call.id;
  end if;

  update public.workflow_step_runs
  set status = 'failed',
      error = p_error,
      completed_at = now()
  where id = v_step.id;

  if v_run.status = 'retrying' then
    update public.workflow_runs
    set status = 'failed',
        error_state = p_error
    where id = v_run.id
      and status = 'retrying';
    if not found then
      raise exception 'retry workflow changed concurrently';
    end if;
  end if;

  insert into public.audit_events(
    project_id,
    actor_id,
    actor_type,
    event_type,
    entity_type,
    entity_id,
    workflow_run_id,
    payload
  )
  values (
    v_run.project_id,
    v_actor,
    'human',
    'risk_ai_reservation_closed',
    'WorkflowStepRun',
    v_step.id,
    v_run.id,
    jsonb_build_object(
      'ai_call_id', v_ai_call.id,
      'provider_completed', p_provider_completed,
      'outcome', case when p_provider_completed then p_outcome else 'abandoned' end,
      'error', p_error
    )
  );
end;
$$;

revoke all on function public.close_m1_risk_ai_reservation(
  uuid, uuid, boolean, text, text, integer, integer, integer,
  numeric, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.close_m1_risk_ai_reservation(
  uuid, uuid, boolean, text, text, integer, integer, integer,
  numeric, text, text, jsonb
) to authenticated;
