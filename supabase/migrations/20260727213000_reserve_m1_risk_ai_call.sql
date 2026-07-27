-- Reserve the governed M1 risk step and its non-billable AI ledger entry
-- before any provider request can start.

alter table public.ai_calls
  add column if not exists lifecycle_state text not null default 'completed'
  check (lifecycle_state in ('reserved', 'completed', 'abandoned'));

alter table public.ai_calls
  drop constraint if exists ai_calls_outcome_check;
alter table public.ai_calls
  add constraint ai_calls_outcome_check
  check (outcome in ('reserved', 'success', 'schema_fail', 'provider_error', 'timeout', 'abandoned'));

create or replace function public.reserve_m1_risk_rerun(
  p_project_id uuid,
  p_workflow_run_id uuid,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.workflow_runs;
  v_step_id uuid;
  v_ai_call_id uuid;
  v_attempt integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if nullif(btrim(p_provider), '') is null
    or nullif(btrim(p_model), '') is null then
    raise exception 'provider and model are required';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  join public.projects p on p.id = w.project_id
  where w.id = p_workflow_run_id
    and w.project_id = p_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.status in ('running', 'waiting_for_human')
    and private.is_studio_member(p.designer_id)
  for update of w;

  if not found then
    raise exception 'project/workflow identity invalid or access denied';
  end if;

  select coalesce(max(s.attempt), 0) + 1 into v_attempt
  from public.workflow_step_runs s
  where s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register';

  insert into public.workflow_step_runs(
    workflow_run_id, step_key, attempt, status, input_snapshot, started_at
  )
  values (
    v_run.id, 'generate_risk_register', v_attempt, 'running',
    jsonb_build_object('requested_by', v_actor), now()
  )
  returning id into v_step_id;

  insert into public.ai_calls(
    project_id, workflow_run_id, workflow_step_run_id,
    action_key, cost_class, provider, model,
    tokens_in, tokens_out, duration_ms, provider_cost_estimate,
    estimate_source, outcome, lifecycle_state
  )
  values (
    p_project_id, v_run.id, v_step_id,
    'generate_risk_register', 'metered_ai', btrim(p_provider), btrim(p_model),
    0, 0, 0, 0,
    'static_table', 'reserved', 'reserved'
  )
  returning id into v_ai_call_id;

  return jsonb_build_object(
    'workflow_step_run_id', v_step_id,
    'ai_call_id', v_ai_call_id
  );
end;
$$;

revoke all on function public.reserve_m1_risk_rerun(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_m1_risk_rerun(uuid, uuid, text, text)
  to authenticated;

create or replace function public.reserve_m1_risk_retry(
  p_workflow_run_id uuid,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.workflow_runs;
  v_step_id uuid;
  v_ai_call_id uuid;
  v_retry_of_id uuid;
  v_attempt integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if nullif(btrim(p_provider), '') is null
    or nullif(btrim(p_model), '') is null then
    raise exception 'provider and model are required';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  join public.projects p on p.id = w.project_id
  where w.id = p_workflow_run_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.status = 'failed'
    and w.current_step = 'generate_risk_register'
    and private.is_studio_member(p.designer_id)
  for update of w;

  if not found then
    raise exception 'failed risk workflow not found or access denied';
  end if;

  select coalesce(max(s.attempt), 0) + 1 into v_attempt
  from public.workflow_step_runs s
  where s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register';

  select a.id into v_retry_of_id
  from public.ai_calls a
  where a.workflow_run_id = v_run.id
    and a.action_key = 'generate_risk_register'
  order by a.created_at desc
  limit 1;

  update public.workflow_runs
  set status = 'retrying',
      current_step = 'generate_risk_register',
      error_state = null
  where id = v_run.id;

  insert into public.workflow_step_runs(
    workflow_run_id, step_key, attempt, status, input_snapshot, started_at
  )
  values (
    v_run.id, 'generate_risk_register', v_attempt, 'running',
    jsonb_build_object('requested_by', v_actor), now()
  )
  returning id into v_step_id;

  insert into public.ai_calls(
    project_id, workflow_run_id, workflow_step_run_id,
    action_key, cost_class, provider, model,
    tokens_in, tokens_out, duration_ms, provider_cost_estimate,
    estimate_source, retry_of_id, outcome, lifecycle_state
  )
  values (
    v_run.project_id, v_run.id, v_step_id,
    'generate_risk_register', 'metered_ai', btrim(p_provider), btrim(p_model),
    0, 0, 0, 0,
    'static_table', v_retry_of_id, 'reserved', 'reserved'
  )
  returning id into v_ai_call_id;

  insert into public.audit_events(
    project_id, actor_id, actor_type, event_type, entity_type,
    entity_id, workflow_run_id, payload
  )
  values (
    v_run.project_id, v_actor, 'human', 'workflow_retry_started',
    'WorkflowStepRun', v_step_id, v_run.id,
    jsonb_build_object('step_key', 'generate_risk_register', 'attempt', v_attempt)
  );

  return jsonb_build_object(
    'workflow_step_run_id', v_step_id,
    'ai_call_id', v_ai_call_id,
    'attempt', v_attempt
  );
end;
$$;

revoke all on function public.reserve_m1_risk_retry(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_m1_risk_retry(uuid, text, text)
  to authenticated;
