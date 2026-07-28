-- ArchiDom Sprint 1 governed runtime completion.
-- Additive implementation follows in the GREEN phase.

create or replace function private.enforce_project_fact_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_predecessor public.project_facts%rowtype;
  v_source_project_id uuid;
begin
  if new.project_id is null
    or new.fact_type is null
    or new.value is null
    or new.source_id is null
    or new.evidence_locator is null
    or new.status is null
    or new.confidence is null
    or new.created_by_type is null
    or new.version is null
    or new.created_at is null then
    raise exception 'project facts require complete provenance and version metadata';
  end if;

  select source.project_id
  into v_source_project_id
  from public.project_sources source
  where source.id = new.source_id
    and source.project_id = new.project_id
  for key share;
  if not found then
    raise exception 'project fact source belongs to another project or is missing';
  end if;

  if 'ai' = new.created_by_type
    and new.status not in ('extracted', 'interpreted', 'unknown') then
    raise exception 'AI-authored project facts cannot confirm or reject evidence';
  end if;

  if new.supersedes_id is null then
    if new.version <> 1 then
      raise exception 'the first project fact version must be 1';
    end if;
  else
    select predecessor.*
    into v_predecessor
    from public.project_facts predecessor
    where predecessor.id = new.supersedes_id
    for update;

    if not found then
      raise exception 'project fact predecessor not found';
    end if;
    if v_predecessor.project_id is distinct from new.project_id then
      raise exception 'project fact predecessor belongs to another project';
    end if;
    if v_predecessor.fact_type is distinct from new.fact_type then
      raise exception 'project fact predecessor has another fact type';
    end if;
    if v_predecessor.evidence_locator is distinct from new.evidence_locator then
      raise exception 'project fact predecessor has another evidence locator';
    end if;
    if new.version <> v_predecessor.version + 1 then
      raise exception 'project fact version must increment its predecessor by one';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_project_fact_insert()
  from public, anon, authenticated;

create unique index if not exists project_facts_single_successor_idx
  on public.project_facts(supersedes_id)
  where supersedes_id is not null;

create trigger project_facts_enforce_insert
  before insert on public.project_facts
  for each row
  execute function private.enforce_project_fact_insert();

create or replace function private.reject_project_fact_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and not exists (
      select 1
      from public.projects project
      where project.id = old.project_id
    ) then
    return old;
  end if;

  raise exception 'project facts are immutable';
  return null;
end;
$$;

revoke all on function private.reject_project_fact_mutation()
  from public, anon, authenticated;

create trigger project_facts_reject_mutation
  before update or delete on public.project_facts
  for each row
  execute function private.reject_project_fact_mutation();

create or replace function private.enforce_studio_standard_version_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_predecessor public.studio_standards%rowtype;
begin
  if new.supersedes_id is null then
    if new.version <> 1 then
      raise exception 'the first studio standard version must be 1';
    end if;
  else
    select predecessor.*
    into v_predecessor
    from public.studio_standards predecessor
    where predecessor.id = new.supersedes_id
    for update;

    if not found then
      raise exception 'studio standard predecessor not found';
    end if;
    if v_predecessor.studio_id is distinct from new.studio_id then
      raise exception 'studio standard predecessor belongs to another studio';
    end if;
    if v_predecessor.standard_key is distinct from new.standard_key then
      raise exception 'studio standard predecessor has another key';
    end if;
    if new.version <> v_predecessor.version + 1 then
      raise exception 'studio standard version must increment its predecessor by one';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_studio_standard_version_chain()
  from public, anon, authenticated;

create unique index if not exists studio_standards_single_successor_idx
  on public.studio_standards(supersedes_id)
  where supersedes_id is not null;

create trigger studio_standards_enforce_version_chain
  before insert on public.studio_standards
  for each row
  execute function private.enforce_studio_standard_version_chain();

create or replace function private.append_standard_drift_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.supersedes_id is not null then
    insert into public.audit_events (
      project_id,
      actor_id,
      actor_type,
      event_type,
      entity_type,
      entity_id,
      payload
    )
    select
      po.project_id,
      new.created_by,
      'human',
      'standard_drift',
      'project_override',
      po.id,
      pg_catalog.jsonb_build_object(
        'standard_key', new.standard_key,
        'old_standard_version_id', pinned_standard.id,
        'new_standard_version_id', new.id,
        'old_standard_version', pinned_standard.version,
        'new_standard_version', new.version
      )
    from public.project_overrides po
    join public.studio_standards pinned_standard
      on pinned_standard.id = po.standard_version_id
    where po.approved is true
      and pinned_standard.studio_id = new.studio_id
      and pinned_standard.standard_key = new.standard_key
      and pinned_standard.version < new.version;
  end if;

  return new;
end;
$$;

revoke all on function private.append_standard_drift_audit()
  from public, anon, authenticated;

create trigger studio_standards_append_standard_drift
  after insert on public.studio_standards
  for each row
  execute function private.append_standard_drift_audit();

-- Guarded bridge for adopting persisted pre-platform M1 projects.
create or replace function public.adopt_legacy_m1_workflow(
  p_project_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects;
  v_run public.workflow_runs;
  v_answer_count integer;
  v_risk_card_count integer;
  v_proposed_risk_count integer;
  v_accepted_risk_count integer;
  v_rejected_risk_count integer;
  v_answer_fact_count integer := 0;
  v_risk_fact_count integer := 0;
  v_fact_count integer := 0;
  v_step_count integer;
  v_answers_snapshot jsonb;
  v_passport_snapshot jsonb;
  v_risk_snapshot jsonb;
  v_answers_digest text;
  v_passport_digest text;
  v_risk_digest text;
  v_pgcrypto_schema text;
  v_answers_source_id uuid;
  v_passport_source_id uuid;
  v_risk_source_id uuid;
  v_answer record;
  v_risk record;
  v_evidence_locator text;
  v_fact_type text;
  v_fact_status text;
  v_fact_confidence numeric(4,3);
  v_previous_fact_id uuid;
  v_previous_fact_version integer;
  v_previous_fact_type text;
  v_previous_fact_status text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select project.* into v_project
  from public.projects project
  where project.id = p_project_id
  for update;

  if not found then
    raise exception 'project not found';
  end if;
  if not private.is_studio_member(v_project.designer_id) then
    raise exception 'project access denied';
  end if;
  if v_project.passport is null then
    raise exception 'legacy project passport is required';
  end if;
  if v_project.status not in ('brief_completed', 'proposal_draft') then
    raise exception 'only an unsent completed legacy brief can be adopted';
  end if;
  if exists (
    select 1
    from public.proposals proposal
    where proposal.project_id = p_project_id
      and proposal.status = 'sent'
  ) then
    raise exception 'sent proposals cannot be adopted into a new workflow';
  end if;

  select workflow.* into v_run
  from public.workflow_runs workflow
  where workflow.project_id = p_project_id
    and workflow.workflow_key = 'client_intake_to_issued_proposal'
    and workflow.workflow_version = 1
    and workflow.status in (
      'queued',
      'running',
      'waiting_for_human',
      'pending_cost_confirmation',
      'retrying',
      'failed'
    )
  for update of workflow;

  if found then
    if v_run.status <> 'waiting_for_human'
      or v_run.current_step <> 'human_review' then
      raise exception 'active governed workflow cannot be adopted as legacy';
    end if;

    select pg_catalog.count(distinct step.step_key)
    into v_step_count
    from public.workflow_step_runs step
    where step.workflow_run_id = v_run.id
      and step.step_key in (
        'extract_client_brief',
        'build_project_passport',
        'generate_risk_register'
      )
      and step.status = 'completed';

    if v_step_count <> 3
      or not exists (
        select 1
        from public.approval_requests approval
        where approval.project_id = p_project_id
          and approval.workflow_run_id = v_run.id
          and approval.subject_type = 'project_facts'
          and approval.subject_id is null
          and approval.approval_type = 'INTERNAL_REVIEWED'
          and approval.status = 'pending'
      )
      or not exists (
        select 1
        from public.project_sources source
        where source.project_id = p_project_id
      )
      or not exists (
        select 1
        from public.project_facts fact
        where fact.project_id = p_project_id
          and fact.source_id is not null
      ) then
      raise exception 'existing human-review workflow evidence is incomplete';
    end if;

    return v_run.id;
  end if;

  if exists (
    select 1
    from public.workflow_runs workflow
    where workflow.project_id = p_project_id
      and workflow.workflow_key = 'client_intake_to_issued_proposal'
      and workflow.workflow_version = 1
  ) then
    raise exception 'existing governed workflow cannot be adopted as legacy';
  end if;

  perform answer.id
  from public.answers answer
  where answer.project_id = p_project_id
  order by answer.id
  for update;

  perform risk.id
  from public.risk_cards risk
  where risk.project_id = p_project_id
  order by risk.id
  for update;

  select
    coalesce(
      pg_catalog.jsonb_object_agg(
        answer.question_id,
        answer.value
        order by answer.question_id
      ),
      '{}'::jsonb
    ),
    pg_catalog.count(*)::integer
  into v_answers_snapshot, v_answer_count
  from public.answers answer
  where answer.project_id = p_project_id;

  v_passport_snapshot := v_project.passport;

  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', risk.id,
          'risk_type', risk.risk_type,
          'evidence', risk.evidence,
          'impact', risk.impact,
          'confidence', risk.confidence,
          'designer_action', risk.designer_action,
          'proposal_implication', risk.proposal_implication,
          'status', risk.status,
          'source', risk.source
        )
        order by risk.id
      ),
      '[]'::jsonb
    ),
    pg_catalog.count(*)::integer,
    (pg_catalog.count(*) filter (
      where risk.status = 'proposed'
    ))::integer,
    (pg_catalog.count(*) filter (
      where risk.status = 'accepted'
    ))::integer,
    (pg_catalog.count(*) filter (
      where risk.status = 'rejected'
    ))::integer
  into
    v_risk_snapshot,
    v_risk_card_count,
    v_proposed_risk_count,
    v_accepted_risk_count,
    v_rejected_risk_count
  from public.risk_cards risk
  where risk.project_id = p_project_id;

  if v_answer_count < 1 or v_answer_count > 100 then
    raise exception 'legacy brief answer count is unsupported';
  end if;
  if pg_catalog.pg_column_size(v_answers_snapshot) > 262144 then
    raise exception 'legacy brief answers are too large';
  end if;
  if exists (
    select 1
    from public.answers answer
    where answer.project_id = p_project_id
      and (
        pg_catalog.length(pg_catalog.btrim(answer.question_id)) < 1
        or pg_catalog.length(answer.question_id) > 100
      )
  ) then
    raise exception 'legacy brief answer key is unsupported';
  end if;
  if pg_catalog.pg_column_size(v_passport_snapshot) > 131072 then
    raise exception 'legacy passport is too large';
  end if;
  if v_risk_card_count > 50
    or pg_catalog.pg_column_size(v_risk_snapshot) > 262144 then
    raise exception 'legacy risk register is too large';
  end if;

  select namespace.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_answers_digest
  using v_answers_snapshot::text;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_passport_digest
  using v_passport_snapshot::text;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_risk_digest
  using v_risk_snapshot::text;

  insert into public.project_sources(
    project_id,
    source_type,
    source_ref,
    title,
    checksum,
    ingested_at,
    created_by
  )
  values (
    p_project_id,
    'client_brief',
    'legacy-m1:answers:' || v_answers_digest,
    'Legacy M1 · клиентский бриф',
    v_answers_digest,
    now(),
    v_actor
  )
  on conflict (project_id, source_type, source_ref) do update
  set title = excluded.title,
      checksum = excluded.checksum,
      ingested_at = excluded.ingested_at
  returning id into v_answers_source_id;

  insert into public.project_sources(
    project_id,
    source_type,
    source_ref,
    title,
    checksum,
    ingested_at,
    created_by
  )
  values (
    p_project_id,
    'system',
    'legacy-m1:passport:' || v_passport_digest,
    'Legacy M1 · паспорт проекта',
    v_passport_digest,
    now(),
    v_actor
  )
  on conflict (project_id, source_type, source_ref) do update
  set title = excluded.title,
      checksum = excluded.checksum,
      ingested_at = excluded.ingested_at
  returning id into v_passport_source_id;

  insert into public.project_sources(
    project_id,
    source_type,
    source_ref,
    title,
    checksum,
    ingested_at,
    created_by
  )
  values (
    p_project_id,
    'system',
    'legacy-m1:risk-cards:' || v_risk_digest,
    'Legacy M1 · реестр рисков',
    v_risk_digest,
    now(),
    v_actor
  )
  on conflict (project_id, source_type, source_ref) do update
  set title = excluded.title,
      checksum = excluded.checksum,
      ingested_at = excluded.ingested_at
  returning id into v_risk_source_id;

  for v_answer in
    select
      answer.question_id,
      answer.value
    from public.answers answer
    where answer.project_id = p_project_id
    order by answer.question_id
  loop
    v_evidence_locator := 'answers.' || v_answer.question_id;
    v_fact_type := case
      when v_answer.question_id in ('budget', 'timeline', 'object')
        then 'constraint'
      else 'requirement'
    end;
    v_fact_status := case
      when v_answer.value is null
        or v_answer.value = 'null'::jsonb
        or (
          pg_catalog.jsonb_typeof(v_answer.value) = 'string'
          and pg_catalog.btrim(v_answer.value #>> '{}') = ''
        )
        then 'unknown'
      else 'extracted'
    end;
    v_fact_confidence := case
      when v_fact_status = 'unknown' then 0
      else 1
    end;
    v_previous_fact_id := null;
    v_previous_fact_version := null;
    v_previous_fact_type := null;
    v_previous_fact_status := null;

    select
      fact.id,
      fact.version,
      fact.fact_type,
      fact.status
    into
      v_previous_fact_id,
      v_previous_fact_version,
      v_previous_fact_type,
      v_previous_fact_status
    from public.project_facts fact
    where fact.project_id = p_project_id
      and fact.evidence_locator = v_evidence_locator
    order by fact.version desc
    limit 1
    for update;

    if v_previous_fact_status in ('human_confirmed', 'rejected') then
      raise exception 'legacy fact requires explicit reconciliation';
    end if;

    v_fact_type := coalesce(v_previous_fact_type, v_fact_type);

    insert into public.project_facts(
      project_id,
      fact_type,
      value,
      source_id,
      evidence_locator,
      status,
      confidence,
      created_by_type,
      created_by_id,
      version,
      supersedes_id
    )
    values (
      p_project_id,
      v_fact_type,
      pg_catalog.jsonb_build_object(
        'question_id', v_answer.question_id,
        'answer', v_answer.value,
        'snapshot_digest', v_answers_digest
      ),
      v_answers_source_id,
      v_evidence_locator,
      v_fact_status,
      v_fact_confidence,
      'system',
      null,
      coalesce(v_previous_fact_version, 0) + 1,
      v_previous_fact_id
    );

    v_answer_fact_count := v_answer_fact_count + 1;
    v_fact_count := v_fact_count + 1;
  end loop;

  v_evidence_locator := 'projects.passport';
  v_previous_fact_id := null;
  v_previous_fact_version := null;
  v_previous_fact_type := null;
  v_previous_fact_status := null;

  select
    fact.id,
    fact.version,
    fact.fact_type,
    fact.status
  into
    v_previous_fact_id,
    v_previous_fact_version,
    v_previous_fact_type,
    v_previous_fact_status
  from public.project_facts fact
  where fact.project_id = p_project_id
    and fact.evidence_locator = v_evidence_locator
  order by fact.version desc
  limit 1
  for update;

  if v_previous_fact_status in ('human_confirmed', 'rejected') then
    raise exception 'legacy fact requires explicit reconciliation';
  end if;

  insert into public.project_facts(
    project_id,
    fact_type,
    value,
    source_id,
    evidence_locator,
    status,
    confidence,
    created_by_type,
    created_by_id,
    version,
    supersedes_id
  )
  values (
    p_project_id,
    coalesce(v_previous_fact_type, 'assumption'),
    pg_catalog.jsonb_build_object(
      'passport', v_passport_snapshot,
      'snapshot_digest', v_passport_digest
    ),
    v_passport_source_id,
    v_evidence_locator,
    'interpreted',
    1,
    'system',
    null,
    coalesce(v_previous_fact_version, 0) + 1,
    v_previous_fact_id
  );
  v_fact_count := v_fact_count + 1;

  for v_risk in
    select
      risk.id,
      risk.risk_type,
      risk.evidence,
      risk.impact,
      risk.confidence,
      risk.designer_action,
      risk.proposal_implication,
      risk.status,
      risk.source
    from public.risk_cards risk
    where risk.project_id = p_project_id
    order by risk.id
  loop
    v_evidence_locator := 'risk_cards.' || v_risk.id::text;
    v_previous_fact_id := null;
    v_previous_fact_version := null;
    v_previous_fact_type := null;
    v_previous_fact_status := null;

    select
      fact.id,
      fact.version,
      fact.fact_type,
      fact.status
    into
      v_previous_fact_id,
      v_previous_fact_version,
      v_previous_fact_type,
      v_previous_fact_status
    from public.project_facts fact
    where fact.project_id = p_project_id
      and fact.evidence_locator = v_evidence_locator
    order by fact.version desc
    limit 1
    for update;

    if v_previous_fact_status in ('human_confirmed', 'rejected') then
      raise exception 'legacy fact requires explicit reconciliation';
    end if;

    v_fact_confidence := case v_risk.confidence
      when 'high' then 1
      when 'medium' then 0.667
      else 0.333
    end;

    insert into public.project_facts(
      project_id,
      fact_type,
      value,
      source_id,
      evidence_locator,
      status,
      confidence,
      created_by_type,
      created_by_id,
      version,
      supersedes_id
    )
    values (
      p_project_id,
      coalesce(v_previous_fact_type, 'assumption'),
      pg_catalog.jsonb_build_object(
        'risk_card_id', v_risk.id,
        'risk_type', v_risk.risk_type,
        'evidence', v_risk.evidence,
        'impact', v_risk.impact,
        'designer_action', v_risk.designer_action,
        'proposal_implication', v_risk.proposal_implication,
        'legacy_status', v_risk.status,
        'legacy_source', v_risk.source,
        'snapshot_digest', v_risk_digest
      ),
      v_risk_source_id,
      v_evidence_locator,
      'interpreted',
      v_fact_confidence,
      case when v_risk.source = 'llm' then 'ai' else 'system' end,
      null,
      coalesce(v_previous_fact_version, 0) + 1,
      v_previous_fact_id
    );

    v_risk_fact_count := v_risk_fact_count + 1;
    v_fact_count := v_fact_count + 1;
  end loop;

  insert into public.workflow_runs(
    project_id,
    workflow_key,
    workflow_version,
    status,
    current_step,
    initiated_by,
    input_snapshot,
    output_snapshot,
    started_at
  )
  values (
    p_project_id,
    'client_intake_to_issued_proposal',
    1,
    'waiting_for_human',
    'human_review',
    v_actor,
    pg_catalog.jsonb_build_object(
      'adoption_source', 'legacy_m1',
      'project_status', v_project.status,
      'answers_digest', v_answers_digest,
      'passport_digest', v_passport_digest,
      'risk_digest', v_risk_digest
    ),
    pg_catalog.jsonb_build_object(
      'legacy_adoption',
      pg_catalog.jsonb_build_object(
        'answer_count', v_answer_count,
        'risk_card_count', v_risk_card_count,
        'fact_count', v_fact_count,
        'passport_present', true,
        'answers_digest', v_answers_digest,
        'passport_digest', v_passport_digest,
        'risk_digest', v_risk_digest,
        'answers_source_id', v_answers_source_id,
        'passport_source_id', v_passport_source_id,
        'risk_source_id', v_risk_source_id
      )
    ),
    now()
  )
  returning * into v_run;

  insert into public.workflow_step_runs(
    workflow_run_id,
    step_key,
    attempt,
    status,
    input_snapshot,
    output_snapshot,
    started_at,
    completed_at
  )
  values (
    v_run.id,
    'extract_client_brief',
    1,
    'completed',
    pg_catalog.jsonb_build_object(
      'source', 'persisted_legacy_answers',
      'answers_digest', v_answers_digest
    ),
    pg_catalog.jsonb_build_object(
      'answer_count', v_answer_count,
      'fact_count', v_answer_fact_count,
      'source_id', v_answers_source_id,
      'answers_digest', v_answers_digest
    ),
    now(),
    now()
  );

  insert into public.workflow_step_runs(
    workflow_run_id,
    step_key,
    attempt,
    status,
    input_snapshot,
    output_snapshot,
    started_at,
    completed_at
  )
  values (
    v_run.id,
    'build_project_passport',
    1,
    'completed',
    pg_catalog.jsonb_build_object(
      'source', 'persisted_legacy_project',
      'passport_digest', v_passport_digest
    ),
    pg_catalog.jsonb_build_object(
      'passport_present', true,
      'fact_count', 1,
      'source_id', v_passport_source_id,
      'passport_digest', v_passport_digest
    ),
    now(),
    now()
  );

  insert into public.workflow_step_runs(
    workflow_run_id,
    step_key,
    attempt,
    status,
    input_snapshot,
    output_snapshot,
    started_at,
    completed_at
  )
  values (
    v_run.id,
    'generate_risk_register',
    1,
    'completed',
    pg_catalog.jsonb_build_object(
      'source', 'persisted_legacy_risk_cards',
      'risk_digest', v_risk_digest
    ),
    pg_catalog.jsonb_build_object(
      'risk_card_count', v_risk_card_count,
      'fact_count', v_risk_fact_count,
      'proposed_count', v_proposed_risk_count,
      'accepted_count', v_accepted_risk_count,
      'rejected_count', v_rejected_risk_count,
      'metering_provenance', 'unavailable_legacy',
      'source_id', v_risk_source_id,
      'risk_digest', v_risk_digest
    ),
    now(),
    now()
  );

  insert into public.approval_requests(
    project_id,
    workflow_run_id,
    subject_type,
    subject_id,
    approval_type,
    required_role,
    requested_by,
    status,
    decision_by,
    decision_at,
    self_approved
  )
  values (
    p_project_id,
    v_run.id,
    'project_facts',
    null,
    'INTERNAL_REVIEWED',
    'member',
    v_actor,
    'pending',
    null,
    null,
    false
  );

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
    p_project_id,
    v_actor,
    'human',
    'legacy_m1_workflow_adopted',
    'workflow_run',
    v_run.id,
    v_run.id,
    pg_catalog.jsonb_build_object(
      'answer_count', v_answer_count,
      'risk_card_count', v_risk_card_count,
      'fact_count', v_fact_count,
      'passport_present', true,
      'review_required', true,
      'answers_digest', v_answers_digest,
      'passport_digest', v_passport_digest,
      'risk_digest', v_risk_digest,
      'answers_source_id', v_answers_source_id,
      'passport_source_id', v_passport_source_id,
      'risk_source_id', v_risk_source_id
    )
  );

  return v_run.id;
end;
$$;

revoke all on function public.adopt_legacy_m1_workflow(uuid)
  from public, anon, authenticated;
grant execute on function public.adopt_legacy_m1_workflow(uuid)
  to authenticated;

alter table public.approval_requests
  add column if not exists reviewed_fact_count integer,
  add column if not exists reviewed_fact_digest text;

alter table public.approval_requests
  drop constraint if exists approval_requests_reviewed_fact_binding_check;
alter table public.approval_requests
  add constraint approval_requests_reviewed_fact_binding_check
  check (
    approval_type <> 'INTERNAL_REVIEWED'
    or status <> 'approved'
    or (
      reviewed_fact_count > 0
      and reviewed_fact_digest ~ '^[0-9a-f]{64}$'
    )
  ) not valid;

-- Human fact decisions are immutable successor versions, written and audited
-- atomically through one guarded command.
create or replace function public.review_project_fact(
  p_fact_id uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
  v_fact public.project_facts;
  v_new_fact_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_status not in ('human_confirmed', 'rejected') then
    raise exception 'unsupported human fact decision';
  end if;

  select fact.project_id
  into v_project_id
  from public.project_facts fact
  join public.projects project on project.id = fact.project_id
  where fact.id = p_fact_id
    and private.is_studio_member(project.designer_id);
  if not found then
    raise exception 'project fact not found or access denied';
  end if;

  perform project.id
  from public.projects project
  where project.id = v_project_id
    and private.is_studio_member(project.designer_id)
  for update;
  if not found then
    raise exception 'project fact access changed concurrently';
  end if;

  select fact.*
  into v_fact
  from public.project_facts fact
  where fact.id = p_fact_id
    and fact.project_id = v_project_id
    and not exists (
      select 1
      from public.project_facts successor
      where successor.supersedes_id = fact.id
    )
  for update;
  if not found then
    raise exception 'only the current project fact version can be reviewed';
  end if;

  if v_fact.status = p_status
    and v_fact.created_by_type = 'human'
    and v_fact.created_by_id = v_actor then
    return v_fact.id;
  end if;

  insert into public.project_facts(
    project_id,
    fact_type,
    value,
    source_id,
    evidence_locator,
    status,
    confidence,
    created_by_type,
    created_by_id,
    version,
    supersedes_id
  )
  values (
    v_fact.project_id,
    v_fact.fact_type,
    v_fact.value,
    v_fact.source_id,
    v_fact.evidence_locator,
    p_status,
    v_fact.confidence,
    'human',
    v_actor,
    v_fact.version + 1,
    v_fact.id
  )
  returning id into v_new_fact_id;

  insert into public.audit_events(
    project_id,
    actor_id,
    actor_type,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    v_fact.project_id,
    v_actor,
    'human',
    case
      when p_status = 'human_confirmed' then 'fact_confirmed'
      else 'fact_rejected'
    end,
    'ProjectFact',
    v_new_fact_id,
    pg_catalog.jsonb_build_object(
      'evidence_locator', v_fact.evidence_locator,
      'version', v_fact.version + 1,
      'supersedes_id', v_fact.id
    )
  );

  return v_new_fact_id;
end;
$$;

revoke all on function public.review_project_fact(uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_project_fact(uuid, text)
  to authenticated;

revoke insert, update, delete on table public.project_facts
  from anon, authenticated;
grant select on table public.project_facts to authenticated;

-- Complete the explicit human-review gate before proposal drafting can begin.
create or replace function public.complete_m1_human_review(
  p_project_id uuid,
  p_workflow_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.workflow_runs;
  v_approval public.approval_requests;
  v_step_id uuid;
  v_attempt integer;
  v_self_approved boolean;
  v_fact_count integer;
  v_unreviewed_fact_count integer;
  v_fact_canonical text;
  v_fact_digest text;
  v_pgcrypto_schema text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  perform project.id
  from public.projects project
  where project.id = p_project_id
    and private.is_studio_member(project.designer_id)
  for update;
  if not found then
    raise exception 'project not found or access denied';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  where w.id = p_workflow_run_id
    and w.project_id = p_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and w.status = 'waiting_for_human'
    and w.current_step = 'human_review'
  for update of w;

  if not found then
    raise exception 'human-review workflow gate not found or access denied';
  end if;

  if not exists (
    select 1
    from public.workflow_step_runs prerequisite
    where prerequisite.workflow_run_id = v_run.id
      and prerequisite.step_key = 'extract_client_brief'
      and prerequisite.status = 'completed'
  ) then
    raise exception 'client brief extraction must be completed before review';
  end if;

  if not exists (
    select 1
    from public.workflow_step_runs prerequisite
    where prerequisite.workflow_run_id = v_run.id
      and prerequisite.step_key = 'build_project_passport'
      and prerequisite.status = 'completed'
  ) then
    raise exception 'project passport must be completed before review';
  end if;

  if not exists (
    select 1
    from public.workflow_step_runs prerequisite
    where prerequisite.workflow_run_id = v_run.id
      and prerequisite.step_key = 'generate_risk_register'
      and prerequisite.status = 'completed'
  ) then
    raise exception 'risk register must be completed before review';
  end if;

  if exists (
    select 1
    from public.risk_cards risk
    where risk.project_id = p_project_id
      and risk.status = 'proposed'
  ) then
    raise exception 'all proposed risks must be reviewed';
  end if;

  perform fact.id
  from public.project_facts fact
  where fact.project_id = p_project_id
    and not exists (
      select 1
      from public.project_facts successor
      where successor.supersedes_id = fact.id
    )
  order by fact.id
  for update;

  select
    pg_catalog.count(*)::integer,
    (pg_catalog.count(*) filter (
      where fact.status not in ('human_confirmed', 'rejected')
    ))::integer,
    coalesce(
      pg_catalog.string_agg(
        pg_catalog.octet_length(fact.id::text)::text
          || ':' || fact.id::text
          || pg_catalog.octet_length(fact.version::text)::text
          || ':' || fact.version::text
          || pg_catalog.octet_length(fact.status)::text
          || ':' || fact.status
          || pg_catalog.octet_length(fact.fact_type)::text
          || ':' || fact.fact_type
          || pg_catalog.octet_length(fact.evidence_locator)::text
          || ':' || fact.evidence_locator
          || pg_catalog.octet_length(fact.source_id::text)::text
          || ':' || fact.source_id::text
          || pg_catalog.octet_length(fact.value::text)::text
          || ':' || fact.value::text,
        '' order by fact.id
      ),
      ''
    )
  into v_fact_count, v_unreviewed_fact_count, v_fact_canonical
  from public.project_facts fact
  where fact.project_id = p_project_id
    and not exists (
      select 1
      from public.project_facts successor
      where successor.supersedes_id = fact.id
    );

  if v_fact_count < 1 or v_unreviewed_fact_count > 0 then
    raise exception 'all current project facts must be reviewed';
  end if;

  select namespace.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';
  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_fact_digest
  using v_fact_canonical;

  select approval.* into v_approval
  from public.approval_requests approval
  where approval.project_id = p_project_id
    and approval.workflow_run_id = v_run.id
    and approval.subject_type = 'project_facts'
    and approval.subject_id is null
    and approval.approval_type = 'INTERNAL_REVIEWED'
    and approval.status = 'pending'
  for update;

  if found then
    v_self_approved := v_approval.requested_by = v_actor;

    update public.approval_requests
    set status = 'approved',
        decision_by = v_actor,
        decision_at = now(),
        self_approved = v_self_approved,
        reviewed_fact_count = v_fact_count,
        reviewed_fact_digest = v_fact_digest
    where id = v_approval.id
      and workflow_run_id = v_run.id
      and status = 'pending'
    returning * into v_approval;

    if not found then
      raise exception 'human-review approval changed concurrently';
    end if;
  else
    if exists (
      select 1
      from public.approval_requests stale
      where stale.project_id = p_project_id
        and stale.subject_type = 'project_facts'
        and stale.approval_type = 'INTERNAL_REVIEWED'
        and stale.status = 'pending'
    ) then
      raise exception 'pending human-review approval belongs to another run';
    end if;

    v_self_approved := coalesce(v_run.initiated_by, v_actor) = v_actor;

    insert into public.approval_requests(
      project_id,
      workflow_run_id,
      subject_type,
      subject_id,
      approval_type,
      required_role,
      requested_by,
      status,
      decision_by,
      decision_at,
      self_approved,
      reviewed_fact_count,
      reviewed_fact_digest
    )
    values (
      p_project_id,
      v_run.id,
      'project_facts',
      null,
      'INTERNAL_REVIEWED',
      'member',
      coalesce(v_run.initiated_by, v_actor),
      'approved',
      v_actor,
      now(),
      v_self_approved,
      v_fact_count,
      v_fact_digest
    )
    returning * into v_approval;
  end if;

  select coalesce(pg_catalog.max(step.attempt), 0) + 1
  into v_attempt
  from public.workflow_step_runs step
  where step.workflow_run_id = v_run.id
    and step.step_key = 'human_review';

  insert into public.workflow_step_runs(
    workflow_run_id,
    step_key,
    attempt,
    status,
    input_snapshot,
    output_snapshot,
    started_at,
    completed_at
  )
  values (
    v_run.id,
    'human_review',
    v_attempt,
    'completed',
    pg_catalog.jsonb_build_object(
      'approval_request_id', v_approval.id,
      'reviewed_by', v_actor,
      'reviewed_fact_count', v_fact_count,
      'reviewed_fact_digest', v_fact_digest
    ),
    pg_catalog.jsonb_build_object(
      'approval_request_id', v_approval.id,
      'self_approved', v_self_approved,
      'reviewed_fact_count', v_fact_count,
      'reviewed_fact_digest', v_fact_digest
    ),
    now(),
    now()
  )
  returning id into v_step_id;

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
    p_project_id,
    v_actor,
    'human',
    'human_review_completed',
    'workflow_step_run',
    v_step_id,
    v_run.id,
    pg_catalog.jsonb_build_object(
      'approval_request_id', v_approval.id,
      'self_approved', v_self_approved,
      'reviewed_fact_count', v_fact_count,
      'reviewed_fact_digest', v_fact_digest,
      'attempt', v_attempt
    )
  );

  update public.workflow_runs
  set status = 'running',
      current_step = 'generate_clarifying_questions',
      error_state = null,
      output_snapshot = output_snapshot || pg_catalog.jsonb_build_object(
        'human_review',
        pg_catalog.jsonb_build_object(
          'approval_request_id', v_approval.id,
          'self_approved', v_self_approved,
          'reviewed_fact_count', v_fact_count,
          'reviewed_fact_digest', v_fact_digest
        )
      )
  where id = v_run.id
    and project_id = p_project_id
    and status = 'waiting_for_human'
    and current_step = 'human_review';

  if not found then
    raise exception 'human-review workflow changed concurrently';
  end if;

  return v_run.id;
end;
$$;

revoke all on function public.complete_m1_human_review(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_m1_human_review(uuid, uuid)
  to authenticated;

-- Persist the canonical proposal-draft workflow checkpoints through one guarded command.
create or replace function public.persist_m1_proposal_draft_steps(
  p_project_id uuid,
  p_proposal_id uuid,
  question_count integer,
  package_key text,
  has_fee boolean,
  section_count integer,
  content_digest text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_designer_id uuid;
  v_proposal public.proposals;
  v_run public.workflow_runs;
  v_step_key text;
  v_attempt integer;
  v_step_id uuid;
  v_step_snapshot jsonb;
  v_question_count integer;
  v_question record;
  v_question_canonical text;
  v_question_digest text;
  v_question_source_id uuid;
  v_question_locator text;
  v_question_value jsonb;
  v_previous_question_id uuid;
  v_previous_question_version integer;
  v_question_fact_id uuid;
  v_question_fact_version integer;
  v_persisted_question_count integer := 0;
  v_package_key text;
  v_has_fee boolean;
  v_section_count integer;
  v_content_digest text;
  v_canonical_content text;
  v_pgcrypto_schema text;
  v_progress_complete boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_proposal_id is null then
    raise exception 'proposal is required';
  end if;
  if question_count is null or question_count < 0 then
    raise exception 'question count must be non-negative';
  end if;
  if package_key is null
    or package_key not in ('concept', 'full', 'full_plus_supervision') then
    raise exception 'unsupported package';
  end if;
  if has_fee is null then
    raise exception 'fee-presence flag is required';
  end if;
  if section_count is null or section_count < 1 then
    raise exception 'section count must be positive';
  end if;
  if content_digest is null
    or content_digest !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'content digest must be a SHA-256 hex string';
  end if;

  select
    p.designer_id,
    coalesce(nullif(p.passport #>> '{scope,package}', ''), 'full')
  into v_designer_id, v_package_key
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'project not found';
  end if;
  if not private.is_studio_member(v_designer_id) then
    raise exception 'project access denied';
  end if;

  select pr.* into v_proposal
  from public.proposals pr
  where pr.id = p_proposal_id
    and pr.project_id = p_project_id
    and pr.status = 'draft'
  for update;

  if not found then
    raise exception 'draft proposal not found for project';
  end if;
  if pg_catalog.jsonb_typeof(v_proposal.sections) <> 'array'
    or pg_catalog.jsonb_array_length(v_proposal.sections) < 1 then
    raise exception 'proposal sections must be a non-empty array';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_proposal.sections) item(section)
    where pg_catalog.jsonb_typeof(item.section) is distinct from 'object'
      or pg_catalog.jsonb_typeof(item.section -> 'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(item.section -> 'title') is distinct from 'string'
      or pg_catalog.jsonb_typeof(item.section -> 'body') is distinct from 'string'
  ) then
    raise exception 'proposal section shape is invalid';
  end if;

  if exists (
    select 1
    from public.risk_cards rc
    where rc.project_id = p_project_id
      and rc.status = 'accepted'
      and rc.designer_action !~ '^[[:space:]]*$'
      and pg_catalog.length(
        pg_catalog.btrim(rc.designer_action)
      ) > 4000
  ) then
    raise exception 'clarifying question exceeds the persisted value limit';
  end if;

  perform rc.id
  from public.risk_cards rc
  where rc.project_id = p_project_id
    and rc.status = 'accepted'
    and rc.designer_action !~ '^[[:space:]]*$'
  order by rc.id
  for update;

  select
    pg_catalog.count(*)::integer,
    coalesce(
      pg_catalog.string_agg(
        pg_catalog.octet_length(rc.id::text)::text
          || ':' || rc.id::text
          || pg_catalog.octet_length(
            pg_catalog.btrim(rc.designer_action)
          )::text
          || ':' || pg_catalog.btrim(rc.designer_action),
        '' order by rc.id
      ),
      ''
    )
  into v_question_count, v_question_canonical
  from public.risk_cards rc
  where rc.project_id = p_project_id
    and rc.status = 'accepted'
    and rc.designer_action !~ '^[[:space:]]*$';

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_proposal.sections) item(section)
    where item.section ->> 'id' = 'price'
  )
  into v_has_fee;

  v_section_count := pg_catalog.jsonb_array_length(v_proposal.sections);

  select coalesce(
    pg_catalog.string_agg(
      pg_catalog.octet_length(item.section ->> 'id')::text
        || ':' || (item.section ->> 'id')
        || pg_catalog.octet_length(item.section ->> 'title')::text
        || ':' || (item.section ->> 'title')
        || pg_catalog.octet_length(item.section ->> 'body')::text
        || ':' || (item.section ->> 'body'),
      '' order by item.ordinality
    ),
    ''
  )
  into v_canonical_content
  from pg_catalog.jsonb_array_elements(v_proposal.sections)
    with ordinality as item(section, ordinality);

  select n.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_content_digest
  using v_canonical_content;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_question_digest
  using v_question_canonical;

  if question_count <> v_question_count
    or package_key <> v_package_key
    or has_fee <> v_has_fee
    or section_count <> v_section_count
    or pg_catalog.lower(content_digest) <> v_content_digest then
    raise exception 'proposal evidence does not match persisted draft';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  where w.project_id = p_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and exists (
      select 1
      from public.approval_requests approval
      where approval.workflow_run_id = w.id
        and approval.project_id = p_project_id
        and approval.subject_type = 'project_facts'
        and approval.subject_id is null
        and approval.approval_type = 'INTERNAL_REVIEWED'
        and approval.status = 'approved'
    )
    and (
      (
        w.status = 'running'
        and w.current_step = 'generate_clarifying_questions'
      )
      or (w.status = 'waiting_for_human' and w.current_step = 'approval')
      or (w.status = 'running' and w.current_step = 'issue_proposal')
    )
  for update of w;

  if not found then
    raise exception 'approved human-review workflow gate not found';
  end if;

  if not exists (
    select 1
    from public.workflow_step_runs extract_step
    where extract_step.workflow_run_id = v_run.id
      and extract_step.step_key = 'extract_client_brief'
      and extract_step.status = 'completed'
  ) then
    raise exception 'client brief extraction prerequisite is incomplete';
  end if;

  if not exists (
    select 1
    from public.workflow_step_runs passport_step
    where passport_step.workflow_run_id = v_run.id
      and passport_step.step_key = 'build_project_passport'
      and passport_step.status = 'completed'
  ) then
    raise exception 'project passport prerequisite is incomplete';
  end if;

  if not exists (
    select 1
    from public.workflow_step_runs risk_step
    where risk_step.workflow_run_id = v_run.id
      and risk_step.step_key = 'generate_risk_register'
      and risk_step.status = 'completed'
  ) then
    raise exception 'risk register prerequisite is incomplete';
  end if;

  select pg_catalog.count(distinct completed_step.step_key) = 4
  into v_progress_complete
  from public.workflow_step_runs completed_step
  where completed_step.workflow_run_id = v_run.id
    and completed_step.step_key = any (array[
      'generate_clarifying_questions',
      'build_scope_draft',
      'calculate_fee',
      'generate_proposal_draft'
    ])
    and completed_step.status = 'completed'
    and completed_step.output_snapshot ->> 'proposal_id' = v_proposal.id::text
    and completed_step.output_snapshot ->> 'content_digest' = v_content_digest
    and completed_step.output_snapshot ->> 'question_digest' =
      v_question_digest;

  if v_run.status = 'waiting_for_human'
    and v_run.current_step = 'approval'
    and v_progress_complete then
    return v_run.id;
  end if;

  if v_run.status = 'running'
    and v_run.current_step = 'issue_proposal'
    and v_progress_complete
    and exists (
      select 1
      from public.approval_requests approval
      join public.proposal_revisions revision
        on revision.id = approval.proposal_revision_id
      where approval.workflow_run_id = v_run.id
        and approval.project_id = p_project_id
        and approval.subject_type = 'proposal'
        and approval.subject_id = v_proposal.id
        and approval.approval_type = 'RELEASE_AUTHORIZED'
        and approval.status = 'approved'
        and revision.proposal_id = v_proposal.id
        and revision.project_id = p_project_id
        and revision.sections = v_proposal.sections
    ) then
    return v_run.id;
  end if;

  if v_run.status = 'waiting_for_human'
    and v_run.current_step = 'approval' then
    update public.workflow_runs
    set status = 'running',
        current_step = 'generate_clarifying_questions',
        error_state = null
    where id = v_run.id
      and project_id = p_project_id
      and status = 'waiting_for_human'
      and current_step = 'approval';

    if not found then
      raise exception 'proposal redraft workflow changed concurrently';
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
      p_project_id,
      v_actor,
      'human',
      'proposal_redraft_started',
      'proposal',
      v_proposal.id,
      v_run.id,
      pg_catalog.jsonb_build_object(
        'proposal_id', v_proposal.id,
        'content_digest', v_content_digest,
        'question_digest', v_question_digest
      )
    );

    v_run.status := 'running';
    v_run.current_step := 'generate_clarifying_questions';
  elsif v_run.status = 'running'
    and v_run.current_step = 'issue_proposal' then
    update public.workflow_runs
    set status = 'running',
        current_step = 'generate_clarifying_questions',
        error_state = null
    where id = v_run.id
      and project_id = p_project_id
      and status = 'running'
      and current_step = 'issue_proposal';

    if not found then
      raise exception 'approved proposal redraft workflow changed concurrently';
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
      p_project_id,
      v_actor,
      'human',
      'proposal_release_invalidated_by_redraft',
      'proposal',
      v_proposal.id,
      v_run.id,
      pg_catalog.jsonb_build_object(
        'proposal_id', v_proposal.id,
        'previous_approval_request_id',
          v_run.output_snapshot #>> '{proposal_issue,approval_request_id}',
        'content_digest', v_content_digest,
        'question_digest', v_question_digest
      )
    );

    v_run.status := 'running';
    v_run.current_step := 'generate_clarifying_questions';
  else
    update public.workflow_runs
    set error_state = null
    where id = v_run.id
      and project_id = p_project_id
      and status = 'running'
      and current_step = 'generate_clarifying_questions';

    if not found then
      raise exception 'proposal drafting workflow changed concurrently';
    end if;
  end if;

  insert into public.project_sources(
    project_id,
    source_type,
    source_ref,
    title,
    checksum,
    ingested_at,
    created_by
  )
  values (
    p_project_id,
    'designer_input',
    'clarifying_questions:run=' || v_run.id::text
      || ':proposal=' || v_proposal.id::text
      || ':content=' || v_content_digest
      || ':questions=' || v_question_digest,
    'Уточняющие вопросы по принятым рискам',
    v_question_digest,
    pg_catalog.now(),
    v_actor
  )
  on conflict (project_id, source_type, source_ref) do update
  set title = excluded.title,
      checksum = excluded.checksum,
      ingested_at = excluded.ingested_at
  returning id into v_question_source_id;

  for v_question in
    select
      rc.id,
      pg_catalog.btrim(rc.designer_action) as question
    from public.risk_cards rc
    where rc.project_id = p_project_id
      and rc.status = 'accepted'
      and rc.designer_action !~ '^[[:space:]]*$'
    order by rc.id
  loop
    v_question_locator := 'risk_cards.' || v_question.id::text
      || '.designer_action';
    v_question_value := pg_catalog.jsonb_build_object(
      'risk_card_id', v_question.id,
      'question', v_question.question,
      'workflow_run_id', v_run.id,
      'proposal_id', v_proposal.id,
      'content_digest', v_content_digest,
      'question_digest', v_question_digest
    );
    v_previous_question_id := null;
    v_previous_question_version := null;

    select fact.id, fact.version
    into v_previous_question_id, v_previous_question_version
    from public.project_facts fact
    where fact.project_id = p_project_id
      and fact.fact_type = 'open_question'
      and fact.evidence_locator = v_question_locator
    order by fact.version desc
    limit 1
    for update;

    v_question_fact_version := coalesce(v_previous_question_version, 0) + 1;
    v_question_fact_id := null;

    insert into public.project_facts(
      project_id,
      fact_type,
      value,
      source_id,
      evidence_locator,
      status,
      confidence,
      created_by_type,
      created_by_id,
      version,
      supersedes_id
    )
    values (
      p_project_id,
      'open_question',
      v_question_value,
      v_question_source_id,
      v_question_locator,
      'interpreted',
      1.000,
      'system',
      null,
      coalesce(v_previous_question_version, 0) + 1,
      v_previous_question_id
    )
    returning id into v_question_fact_id;

    v_persisted_question_count := v_persisted_question_count + 1;

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
      p_project_id,
      null,
      'system',
      'clarifying_question_persisted',
      'project_fact',
      v_question_fact_id,
      v_run.id,
      pg_catalog.jsonb_build_object(
        'risk_card_id', v_question.id,
        'question', v_question.question,
        'requested_by', v_actor,
        'proposal_id', v_proposal.id,
        'content_digest', v_content_digest,
        'question_digest', v_question_digest,
        'evidence_locator', v_question_locator,
        'version', v_question_fact_version,
        'supersedes_id', v_previous_question_id
      )
    );
  end loop;

  if v_persisted_question_count <> v_question_count then
    raise exception 'persisted clarifying-question set changed concurrently';
  end if;

  foreach v_step_key in array array[
    'generate_clarifying_questions',
    'build_scope_draft',
    'calculate_fee',
    'generate_proposal_draft'
  ] loop
    if exists (
      select 1
      from public.workflow_step_runs s
      where s.workflow_run_id = v_run.id
        and s.step_key = v_step_key
        and s.status = 'completed'
        and s.output_snapshot ->> 'proposal_id' = v_proposal.id::text
        and s.output_snapshot ->> 'content_digest' = v_content_digest
        and s.output_snapshot ->> 'question_digest' = v_question_digest
    ) then
      continue;
    end if;

    select coalesce(pg_catalog.max(s.attempt), 0) + 1
    into v_attempt
    from public.workflow_step_runs s
    where s.workflow_run_id = v_run.id
      and s.step_key = v_step_key;

    v_step_snapshot := case v_step_key
      when 'generate_clarifying_questions' then
        pg_catalog.jsonb_build_object(
          'proposal_id', v_proposal.id,
          'question_count', v_persisted_question_count,
          'content_digest', v_content_digest,
          'question_digest', v_question_digest
        )
      when 'build_scope_draft' then
        pg_catalog.jsonb_build_object(
          'proposal_id', v_proposal.id,
          'package_key', v_package_key,
          'content_digest', v_content_digest,
          'question_digest', v_question_digest
        )
      when 'calculate_fee' then
        pg_catalog.jsonb_build_object(
          'proposal_id', v_proposal.id,
          'has_fee', v_has_fee,
          'content_digest', v_content_digest,
          'question_digest', v_question_digest
        )
      else
        pg_catalog.jsonb_build_object(
          'proposal_id', v_proposal.id,
          'section_count', v_section_count,
          'content_digest', v_content_digest,
          'question_digest', v_question_digest
        )
    end;

    v_step_id := null;
    insert into public.workflow_step_runs(
      workflow_run_id, step_key, attempt, status,
      input_snapshot, output_snapshot, started_at, completed_at
    )
    values (
      v_run.id, v_step_key, v_attempt, 'completed',
      pg_catalog.jsonb_build_object(
        'requested_by', v_actor,
        'proposal_id', v_proposal.id
      ),
      v_step_snapshot, now(), now()
    )
    on conflict (workflow_run_id, step_key, attempt) do nothing
    returning id into v_step_id;

    if v_step_id is not null then
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
        p_project_id,
        v_actor,
        'human',
        'workflow_step_completed',
        'workflow_step_run',
        v_step_id,
        v_run.id,
        pg_catalog.jsonb_build_object(
          'step_key', v_step_key,
          'attempt', v_attempt,
          'proposal_id', v_proposal.id,
          'content_digest', v_content_digest,
          'question_digest', v_question_digest
        )
      );
    end if;
  end loop;

  v_step_snapshot := pg_catalog.jsonb_build_object(
    'proposal_id', v_proposal.id,
    'question_count', v_persisted_question_count,
    'package_key', v_package_key,
    'has_fee', v_has_fee,
    'section_count', v_section_count,
    'content_digest', v_content_digest,
    'question_digest', v_question_digest
  );

  update public.workflow_runs
  set status = 'waiting_for_human',
      current_step = 'approval',
      output_snapshot = output_snapshot
        || pg_catalog.jsonb_build_object('proposal_draft', v_step_snapshot)
  where id = v_run.id
    and project_id = p_project_id
    and status = 'running'
    and current_step = 'generate_clarifying_questions';

  if not found then
    raise exception 'proposal drafting workflow changed concurrently';
  end if;

  return v_run.id;
end;
$$;

revoke all on function public.persist_m1_proposal_draft_steps(
  uuid, uuid, integer, text, boolean, integer, text
)
  from public, anon, authenticated;
grant execute on function public.persist_m1_proposal_draft_steps(
  uuid, uuid, integer, text, boolean, integer, text
)
  to authenticated;

-- Save edited sections and reconcile their workflow evidence atomically.
create or replace function public.save_and_persist_m1_proposal_draft(
  p_project_id uuid,
  p_proposal_id uuid,
  p_sections jsonb,
  question_count integer,
  package_key text,
  has_fee boolean,
  section_count integer,
  content_digest text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_sections is null
    or pg_catalog.jsonb_typeof(p_sections) <> 'array' then
    raise exception 'proposal sections must be an array';
  end if;

  perform project.id
  from public.projects project
  where project.id = p_project_id
    and private.is_studio_member(project.designer_id)
  for update;
  if not found then
    raise exception 'project not found or access denied';
  end if;

  perform proposal.id
  from public.proposals proposal
  where proposal.id = p_proposal_id
    and proposal.project_id = p_project_id
    and proposal.status = 'draft'
    and proposal.issued_revision_id is null
  for update;
  if not found then
    raise exception 'editable proposal draft not found';
  end if;

  update public.proposals
  set sections = p_sections
  where id = p_proposal_id
    and project_id = p_project_id
    and status = 'draft'
    and issued_revision_id is null;
  if not found then
    raise exception 'proposal draft changed concurrently';
  end if;

  return public.persist_m1_proposal_draft_steps(
    p_project_id,
    p_proposal_id,
    question_count,
    package_key,
    has_fee,
    section_count,
    content_digest
  );
end;
$$;

revoke all on function public.save_and_persist_m1_proposal_draft(
  uuid, uuid, jsonb, integer, text, boolean, integer, text
) from public, anon, authenticated;
grant execute on function public.save_and_persist_m1_proposal_draft(
  uuid, uuid, jsonb, integer, text, boolean, integer, text
) to authenticated;

-- Create or recover the first proposal draft together with all legacy and
-- governed side effects. The project-row lock serializes concurrent page
-- renders, so a retry either reuses the exact draft or fails closed when its
-- computed content is stale.
create or replace function public.get_or_create_m1_proposal_draft(
  p_project_id uuid,
  p_sections jsonb,
  p_public_token text,
  p_question_count integer,
  p_package_key text,
  p_has_fee boolean,
  p_section_count integer,
  p_content_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects;
  v_proposal public.proposals;
  v_draft_count integer;
  v_run_id uuid;
  v_created boolean := false;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_sections is null
    or pg_catalog.jsonb_typeof(p_sections) <> 'array'
    or pg_catalog.jsonb_array_length(p_sections) < 1 then
    raise exception 'proposal sections must be a non-empty array';
  end if;
  if p_public_token is null
    or p_public_token !~ '^[A-Za-z0-9_-]{24,128}$' then
    raise exception 'proposal public token is invalid';
  end if;

  select project.*
  into v_project
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception 'project not found';
  end if;
  if not private.is_studio_member(v_project.designer_id) then
    raise exception 'project access denied';
  end if;
  if v_project.status not in (
    'brief_completed',
    'proposal_draft',
    'proposal_sent'
  ) then
    raise exception 'project is not ready for a proposal draft';
  end if;

  select pg_catalog.count(*)::integer
  into v_draft_count
  from public.proposals proposal
  where proposal.project_id = p_project_id
    and proposal.status = 'draft';
  if v_draft_count > 1 then
    raise exception 'duplicate proposal drafts require reconciliation';
  end if;

  select proposal.*
  into v_proposal
  from public.proposals proposal
  where proposal.project_id = p_project_id
    and proposal.status = 'draft'
  order by proposal.created_at desc, proposal.id desc
  limit 1
  for update;

  if not found then
    select proposal.*
    into v_proposal
    from public.proposals proposal
    where proposal.project_id = p_project_id
      and proposal.status = 'sent'
    order by proposal.created_at desc, proposal.id desc
    limit 1
    for update;

    if found then
      if v_project.status <> 'proposal_sent' then
        raise exception 'sent proposal conflicts with project status';
      end if;
      return pg_catalog.jsonb_build_object(
        'id', v_proposal.id,
        'sections', v_proposal.sections,
        'status', v_proposal.status,
        'public_token', v_proposal.public_token
      );
    end if;

    insert into public.proposals(
      project_id,
      version,
      sections,
      status,
      public_token
    )
    values (
      p_project_id,
      1,
      p_sections,
      'draft',
      p_public_token
    )
    returning * into v_proposal;
    v_created := true;
  elsif v_proposal.issued_revision_id is not null then
    raise exception 'issued proposal cannot be recovered as a draft';
  elsif pg_catalog.jsonb_typeof(v_proposal.sections) <> 'array' then
    raise exception 'existing proposal sections are invalid';
  elsif pg_catalog.jsonb_array_length(v_proposal.sections) < 1 then
    update public.proposals
    set sections = p_sections
    where id = v_proposal.id
      and project_id = p_project_id
      and status = 'draft'
      and issued_revision_id is null
    returning * into v_proposal;
    if not found then
      raise exception 'proposal draft changed concurrently';
    end if;
  elsif v_proposal.sections is distinct from p_sections then
    raise exception 'proposal draft changed concurrently';
  end if;

  if v_project.status <> 'proposal_draft' then
    update public.projects
    set status = 'proposal_draft'
    where id = p_project_id
      and status = 'brief_completed';
    if not found then
      raise exception 'project status changed concurrently';
    end if;
  end if;

  if v_created then
    insert into public.events(
      designer_id,
      project_id,
      type
    )
    values (
      v_project.designer_id,
      p_project_id,
      'proposal_created'
    );
  end if;

  v_run_id := public.persist_m1_proposal_draft_steps(
    p_project_id,
    v_proposal.id,
    p_question_count,
    p_package_key,
    p_has_fee,
    p_section_count,
    p_content_digest
  );
  if v_run_id is null then
    raise exception 'proposal workflow persistence failed';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_proposal.id,
    'sections', v_proposal.sections,
    'status', v_proposal.status,
    'public_token', v_proposal.public_token
  );
end;
$$;

revoke all on function public.get_or_create_m1_proposal_draft(
  uuid, jsonb, text, integer, text, boolean, integer, text
) from public, anon, authenticated;
grant execute on function public.get_or_create_m1_proposal_draft(
  uuid, jsonb, text, integer, text, boolean, integer, text
) to authenticated;

-- Authorize only the exact proposal revision bound to the canonical approval gate.
create or replace function public.authorize_proposal_revision(
  p_proposal_id uuid,
  p_workflow_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_proposal public.proposals;
  v_run public.workflow_runs;
  v_revision_id uuid;
  v_approval_id uuid;
  v_approval_step_id uuid;
  v_approval_attempt integer;
  v_version integer;
  v_existing_count bigint;
  v_canonical_content text;
  v_content_digest text;
  v_pgcrypto_schema text;
  v_requester uuid;
  v_self_approved boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select pr.* into v_proposal
  from public.proposals pr
  join public.projects p on p.id = pr.project_id
  where pr.id = p_proposal_id
    and private.is_studio_member(p.designer_id)
  for update of pr;

  if not found then
    raise exception 'proposal not found or access denied';
  end if;
  if v_proposal.status <> 'draft'
    or v_proposal.issued_revision_id is not null then
    raise exception 'only an unissued draft proposal can be authorized';
  end if;
  if pg_catalog.jsonb_typeof(v_proposal.sections) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_proposal.sections) < 1
    or pg_catalog.jsonb_array_length(v_proposal.sections) > 50
    or pg_catalog.pg_column_size(v_proposal.sections) > 262144 then
    raise exception 'proposal sections are invalid';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_proposal.sections) item(section)
    where pg_catalog.jsonb_typeof(item.section) is distinct from 'object'
      or pg_catalog.jsonb_typeof(item.section -> 'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(item.section -> 'title') is distinct from 'string'
      or pg_catalog.jsonb_typeof(item.section -> 'body') is distinct from 'string'
      or pg_catalog.length(item.section ->> 'id') > 100
      or pg_catalog.length(item.section ->> 'title') > 500
      or pg_catalog.length(item.section ->> 'body') > 50000
  ) then
    raise exception 'proposal section shape is invalid';
  end if;

  select coalesce(
    pg_catalog.string_agg(
      pg_catalog.octet_length(item.section ->> 'id')::text
        || ':' || (item.section ->> 'id')
        || pg_catalog.octet_length(item.section ->> 'title')::text
        || ':' || (item.section ->> 'title')
        || pg_catalog.octet_length(item.section ->> 'body')::text
        || ':' || (item.section ->> 'body'),
      '' order by item.ordinality
    ),
    ''
  )
  into v_canonical_content
  from pg_catalog.jsonb_array_elements(v_proposal.sections)
    with ordinality as item(section, ordinality);

  select namespace.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';
  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_content_digest
  using v_canonical_content;

  select w.* into v_run
  from public.workflow_runs w
  where w.id = p_workflow_run_id
    and w.project_id = v_proposal.project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and (
      (w.status = 'waiting_for_human' and w.current_step = 'approval')
      or (w.status = 'running' and w.current_step = 'issue_proposal')
    )
  for update of w;

  if not found then
    raise exception 'proposal approval workflow identity invalid';
  end if;

  if not exists (
    select 1
    from public.workflow_step_runs draft_step
    where draft_step.workflow_run_id = v_run.id
      and draft_step.step_key = 'generate_proposal_draft'
      and draft_step.status = 'completed'
      and draft_step.output_snapshot ->> 'proposal_id'
        = v_proposal.id::text
      and draft_step.output_snapshot ->> 'content_digest'
        = v_content_digest
  )
    or v_run.output_snapshot #>> '{proposal_draft,proposal_id}'
      is distinct from v_proposal.id::text
    or v_run.output_snapshot #>> '{proposal_draft,content_digest}'
      is distinct from v_content_digest then
    raise exception 'proposal draft workflow evidence is stale';
  end if;

  v_requester := coalesce(v_run.initiated_by, v_actor);
  v_self_approved := v_requester = v_actor;

  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(a.id))[1],
    (pg_catalog.array_agg(r.id))[1]
  into v_existing_count, v_approval_id, v_revision_id
  from public.proposal_revisions r
  join public.approval_requests a on a.proposal_revision_id = r.id
  where a.workflow_run_id = v_run.id
    and a.project_id = v_proposal.project_id
    and a.subject_type = 'proposal'
    and a.subject_id = v_proposal.id
    and a.approval_type = 'RELEASE_AUTHORIZED'
    and a.status = 'approved'
    and r.proposal_id = v_proposal.id
    and r.project_id = v_proposal.project_id
    and r.sections = v_proposal.sections;

  if v_existing_count > 1 then
    raise exception 'ambiguous proposal release authorization binding';
  end if;

  if v_approval_id is not null then
    select coalesce(pg_catalog.max(step.attempt), 0) + 1
    into v_approval_attempt
    from public.workflow_step_runs step
    where step.workflow_run_id = v_run.id
      and step.step_key = 'approval';

    v_approval_step_id := null;
    insert into public.workflow_step_runs(
      workflow_run_id,
      step_key,
      attempt,
      status,
      input_snapshot,
      output_snapshot,
      started_at,
      completed_at
    )
    select
      v_run.id,
      'approval',
      v_approval_attempt,
      'completed',
      pg_catalog.jsonb_build_object(
        'requested_by', v_actor,
        'proposal_id', v_proposal.id
      ),
      pg_catalog.jsonb_build_object(
        'proposal_id', v_proposal.id,
        'approval_request_id', v_approval_id,
        'proposal_revision_id', v_revision_id
      ),
      now(),
      now()
    where not exists (
      select 1
      from public.workflow_step_runs existing_step
      where existing_step.workflow_run_id = v_run.id
        and existing_step.step_key = 'approval'
        and existing_step.status = 'completed'
        and existing_step.output_snapshot ->> 'proposal_id'
          = v_proposal.id::text
        and existing_step.output_snapshot ->> 'approval_request_id'
          = v_approval_id::text
        and existing_step.output_snapshot ->> 'proposal_revision_id'
          = v_revision_id::text
    )
    returning id into v_approval_step_id;

    if v_approval_step_id is not null then
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
        v_proposal.project_id,
        v_actor,
        'human',
        'workflow_step_completed',
        'workflow_step_run',
        v_approval_step_id,
        v_run.id,
        pg_catalog.jsonb_build_object(
          'step_key', 'approval',
          'attempt', v_approval_attempt,
          'proposal_id', v_proposal.id,
          'approval_request_id', v_approval_id,
          'proposal_revision_id', v_revision_id
        )
      );
    end if;

    if v_run.status = 'waiting_for_human' then
      update public.workflow_runs
      set status = 'running',
          current_step = 'issue_proposal',
          error_state = null
      where id = v_run.id
        and project_id = v_proposal.project_id
        and status = 'waiting_for_human'
        and current_step = 'approval';

      if not found then
        raise exception 'proposal approval workflow changed concurrently';
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
      v_proposal.project_id,
      v_actor,
      'human',
      'proposal_release_authorization_reused',
      'approval_request',
      v_approval_id,
      v_run.id,
      pg_catalog.jsonb_build_object(
        'proposal_id', v_proposal.id,
        'proposal_revision_id', v_revision_id,
        'idempotent', v_run.status = 'running'
      )
    );

    return v_approval_id;
  end if;

  if v_run.status = 'running' then
    raise exception 'running proposal issuance has no exact approved binding';
  end if;

  select greatest(
    v_proposal.version,
    coalesce(pg_catalog.max(r.version), 0)
  ) + 1
  into v_version
  from public.proposal_revisions r
  where r.proposal_id = v_proposal.id;

  insert into public.proposal_revisions(
    proposal_id,
    project_id,
    version,
    sections,
    created_by
  )
  values (
    v_proposal.id,
    v_proposal.project_id,
    v_version,
    v_proposal.sections,
    v_actor
  )
  returning id into v_revision_id;

  insert into public.approval_requests(
    project_id,
    workflow_run_id,
    subject_type,
    subject_id,
    proposal_revision_id,
    approval_type,
    required_role,
    requested_by,
    status,
    decision_by,
    decision_at,
    self_approved
  )
  values (
    v_proposal.project_id,
    v_run.id,
    'proposal',
    v_proposal.id,
    v_revision_id,
    'RELEASE_AUTHORIZED',
    'member',
    v_requester,
    'approved',
    v_actor,
    now(),
    v_self_approved
  )
  returning id into v_approval_id;

  select coalesce(pg_catalog.max(step.attempt), 0) + 1
  into v_approval_attempt
  from public.workflow_step_runs step
  where step.workflow_run_id = v_run.id
    and step.step_key = 'approval';

  insert into public.workflow_step_runs(
    workflow_run_id,
    step_key,
    attempt,
    status,
    input_snapshot,
    output_snapshot,
    started_at,
    completed_at
  )
  values (
    v_run.id,
    'approval',
    v_approval_attempt,
    'completed',
    pg_catalog.jsonb_build_object(
      'requested_by', v_requester,
      'decision_by', v_actor,
      'proposal_id', v_proposal.id
    ),
    pg_catalog.jsonb_build_object(
      'proposal_id', v_proposal.id,
      'approval_request_id', v_approval_id,
      'proposal_revision_id', v_revision_id
    ),
    now(),
    now()
  )
  returning id into v_approval_step_id;

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
    v_proposal.project_id,
    v_actor,
    'human',
    'workflow_step_completed',
    'workflow_step_run',
    v_approval_step_id,
    v_run.id,
    pg_catalog.jsonb_build_object(
      'step_key', 'approval',
      'attempt', v_approval_attempt,
      'proposal_id', v_proposal.id,
      'approval_request_id', v_approval_id,
      'proposal_revision_id', v_revision_id
    )
  );

  update public.workflow_runs
  set status = 'running',
      current_step = 'issue_proposal',
      error_state = null
  where id = v_run.id
    and project_id = v_proposal.project_id
    and status = 'waiting_for_human'
    and current_step = 'approval';

  if not found then
    raise exception 'proposal approval workflow changed concurrently';
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
    v_proposal.project_id,
    v_actor,
    'human',
    'proposal_release_authorized',
    'approval_request',
    v_approval_id,
    v_run.id,
    pg_catalog.jsonb_build_object(
      'proposal_id', v_proposal.id,
      'proposal_revision_id', v_revision_id,
      'version', v_version,
      'requested_by', v_requester,
      'decision_by', v_actor,
      'self_approved', v_self_approved
    )
  );

  return v_approval_id;
end;
$$;

revoke all on function public.authorize_proposal_revision(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_proposal_revision(uuid, uuid)
  to authenticated;

-- Observe both governed and legacy proposal sends without changing proposal RLS or write behavior.
create or replace function private.record_m1_proposal_issuance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.approval_requests;
  v_workflow_run public.workflow_runs;
  v_approval_request_id uuid;
  v_workflow_run_id uuid;
  v_attempt integer;
begin
  if new.status = 'sent' and old.status is distinct from new.status then
    select a.* into v_approval
    from public.approval_requests a
    where a.project_id = new.project_id
      and a.subject_type = 'proposal'
      and a.subject_id = new.id
      and a.proposal_revision_id = new.issued_revision_id
      and a.approval_type = 'RELEASE_AUTHORIZED'
      and a.status = 'approved'
    for update;

    if not found then
      return new;
    end if;

    v_approval_request_id := v_approval.id;
    v_workflow_run_id := v_approval.workflow_run_id;

    select w.* into v_workflow_run
    from public.workflow_runs w
    where w.id = v_workflow_run_id
      and w.project_id = new.project_id
      and w.workflow_key = 'client_intake_to_issued_proposal'
      and w.workflow_version = 1
      and w.status = 'running'
      and w.current_step = 'issue_proposal'
    for update;

    if not found then
      return new;
    end if;

    if not exists (
      select 1
      from public.workflow_step_runs s
      where s.workflow_run_id = v_workflow_run_id
        and s.step_key = 'issue_proposal'
        and s.status = 'completed'
        and s.output_snapshot ->> 'proposal_id' = new.id::text
        and s.output_snapshot ->> 'issued_revision_id'
          = new.issued_revision_id::text
        and s.output_snapshot ->> 'approval_request_id'
          = v_approval_request_id::text
    ) then
      select coalesce(pg_catalog.max(s.attempt), 0) + 1
      into v_attempt
      from public.workflow_step_runs s
      where s.workflow_run_id = v_workflow_run_id
        and s.step_key = 'issue_proposal';

      insert into public.workflow_step_runs(
        workflow_run_id, step_key, attempt, status,
        input_snapshot, output_snapshot, started_at, completed_at
      )
      values (
        v_workflow_run_id, 'issue_proposal', v_attempt, 'completed',
        pg_catalog.jsonb_build_object(
          'proposal_id', new.id,
          'issued_revision_id', new.issued_revision_id,
          'approval_request_id', v_approval_request_id
        ),
        pg_catalog.jsonb_build_object(
          'proposal_id', new.id,
          'issued_revision_id', new.issued_revision_id,
          'approval_request_id', v_approval_request_id,
          'sent_at', new.sent_at
        ),
        coalesce(new.sent_at, pg_catalog.now()),
        coalesce(new.sent_at, pg_catalog.now())
      )
      on conflict (workflow_run_id, step_key, attempt) do nothing;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.record_m1_proposal_issuance()
  from public, anon, authenticated;

drop trigger if exists proposals_record_m1_issuance on public.proposals;
create trigger proposals_record_m1_issuance
after update of status, sent_at, issued_revision_id on public.proposals
for each row execute function private.record_m1_proposal_issuance();

-- Authenticated application sessions may edit draft content, but issuance is
-- available only through the guarded SECURITY DEFINER command.
revoke update on table public.proposals from authenticated;
grant update (sections) on table public.proposals to authenticated;
grant execute on function public.issue_proposal_revision(uuid, uuid)
  to authenticated;

alter table public.ai_calls
  add column if not exists request_digest text,
  add column if not exists idempotency_key text;

alter table public.ai_calls
  add constraint ai_calls_request_digest_format_check
  check (
    request_digest is null
    or request_digest ~ '^[0-9A-Fa-f]{64}$'
  );

alter table public.ai_calls
  add constraint ai_calls_idempotency_key_format_check
  check (
    idempotency_key is null
    or idempotency_key ~ '^[0-9A-Fa-f]{64}$'
  );

create index if not exists ai_calls_initial_brief_request_digest_idx
  on public.ai_calls(project_id, request_digest)
  where request_digest is not null
    and action_key = 'generate_risk_register';

create unique index if not exists ai_calls_initial_brief_idempotency_idx
  on public.ai_calls(project_id, idempotency_key)
  where idempotency_key is not null
    and action_key = 'generate_risk_register'
    and lifecycle_state = 'reserved';

-- A process crash after reservation must not block the same public brief
-- forever. Provider attempts are bounded to 30 seconds each in the server
-- adapter, so a ten-minute lease is safely beyond the complete two-attempt
-- pipeline. Recovery runs under the already locked project row before a new
-- reservation is considered.
create or replace function private.expire_stale_initial_brief_reservations(
  p_project_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale record;
begin
  for v_stale in
    select
      a.id as ai_call_id,
      a.lifecycle_state as ai_lifecycle_state,
      s.id as workflow_step_run_id,
      w.id as workflow_run_id
    from public.ai_calls a
    join public.workflow_step_runs s
      on s.id = a.workflow_step_run_id
    join public.workflow_runs w
      on w.id = a.workflow_run_id
    where a.project_id = p_project_id
      and a.action_key = 'generate_risk_register'
      and a.request_digest is not null
      and a.idempotency_key is not null
      and a.lifecycle_state in ('reserved', 'completed')
      and a.created_at
        < pg_catalog.clock_timestamp() - interval '10 minutes'
      and s.workflow_run_id = w.id
      and s.step_key = 'generate_risk_register'
      and s.status = 'running'
      and w.project_id = p_project_id
      and w.workflow_key = 'client_intake_to_issued_proposal'
      and w.workflow_version = 1
      and w.status in (
        'queued',
        'running',
        'pending_cost_confirmation',
        'retrying'
      )
    order by a.created_at, a.id
    for update of a, s, w
  loop
    update public.ai_calls
    set outcome = 'abandoned',
        lifecycle_state = 'abandoned'
    where id = v_stale.ai_call_id
      and lifecycle_state = 'reserved';

    update public.workflow_step_runs
    set status = 'failed',
        error = pg_catalog.jsonb_build_object(
          'code',
          'initial_brief_reservation_expired'
        ),
        completed_at = coalesce(completed_at, now())
    where id = v_stale.workflow_step_run_id
      and workflow_run_id = v_stale.workflow_run_id
      and status = 'running';

    update public.workflow_runs
    set status = 'failed',
        current_step = 'generate_risk_register',
        error_state = pg_catalog.jsonb_build_object(
          'step',
          'generate_risk_register',
          'code',
          'initial_brief_reservation_expired'
        )
    where id = v_stale.workflow_run_id
      and project_id = p_project_id
      and status in (
        'queued',
        'running',
        'pending_cost_confirmation',
        'retrying'
      );

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
      p_project_id,
      null,
      'system',
      'initial_brief_reservation_expired',
      'WorkflowStepRun',
      v_stale.workflow_step_run_id,
      v_stale.workflow_run_id,
      pg_catalog.jsonb_build_object(
        'ai_call_id', v_stale.ai_call_id,
        'ai_lifecycle_state', v_stale.ai_lifecycle_state,
        'lease_minutes', 10
      )
    );
  end loop;
end;
$$;

revoke all on function private.expire_stale_initial_brief_reservations(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.reserve_initial_brief_ai_call(
  p_project_id uuid,
  p_answer_digest text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_role text := coalesce(
    auth.role(),
    current_setting('request.jwt.claim.role', true),
    ''
  );
  v_initiated_by uuid;
  v_project_status text;
  v_workflow_run_id uuid;
  v_workflow_run_status text;
  v_workflow_step_run_id uuid;
  v_ai_call_id uuid;
  v_retry_of_id uuid;
  v_ai_outcome text;
  v_attempt integer;
begin
  if v_request_role <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_answer_digest is null
    or p_answer_digest !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'answer digest must be a SHA-256 hex string';
  end if;
  if p_idempotency_key is null
    or p_idempotency_key !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'idempotency key must be a SHA-256 hex string';
  end if;

  select p.designer_id, p.status
  into v_initiated_by, v_project_status
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'project not found';
  end if;
  if v_initiated_by is null then
    raise exception 'initial_brief_owner_required';
  end if;

  perform private.expire_stale_initial_brief_reservations(p_project_id);

  select
    w.id,
    s.id,
    a.id,
    a.outcome
  into
    v_workflow_run_id,
    v_workflow_step_run_id,
    v_ai_call_id,
    v_ai_outcome
  from public.ai_calls a
  join public.workflow_step_runs s
    on s.id = a.workflow_step_run_id
  join public.workflow_runs w
    on w.id = a.workflow_run_id
  where a.project_id = p_project_id
    and a.action_key = 'generate_risk_register'
    and a.request_digest = p_answer_digest
    and a.idempotency_key = p_idempotency_key
    and a.lifecycle_state = 'completed'
    and s.workflow_run_id = w.id
    and s.step_key = 'generate_risk_register'
    and s.status = 'completed'
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and exists (
      select 1
      from public.audit_events e
      where e.workflow_run_id = w.id
        and e.project_id = p_project_id
        and e.event_type = 'brief_workflow_waiting_for_review'
    )
    and v_project_status in (
      'brief_completed',
      'proposal_draft',
      'proposal_sent'
    )
  order by a.created_at desc
  limit 1;

  if v_ai_call_id is not null then
    return jsonb_build_object(
      'workflow_run_id', v_workflow_run_id,
      'workflow_step_run_id', v_workflow_step_run_id,
      'ai_call_id', v_ai_call_id,
      'replayed', true,
      'result_snapshot', jsonb_build_object(
        'ok', true,
        'llmOk', v_ai_outcome = 'success',
        'workflowRunId', v_workflow_run_id
      )
    );
  end if;

  if v_project_status not in (
    'created',
    'brief_sent',
    'brief_in_progress'
  ) then
    raise exception 'initial_brief_request_conflict';
  end if;

  v_workflow_run_id := null;
  v_workflow_step_run_id := null;
  v_ai_call_id := null;

  if exists (
    select 1
    from public.ai_calls a
    where a.project_id = p_project_id
      and a.action_key = 'generate_risk_register'
      and a.lifecycle_state = 'reserved'
  ) then
    raise exception 'initial_brief_request_conflict';
  end if;

  if exists (
    select 1
    from public.workflow_runs w
    where w.project_id = p_project_id
      and w.workflow_key = 'client_intake_to_issued_proposal'
      and w.workflow_version = 1
      and w.status = 'waiting_for_human'
  ) then
    raise exception 'initial_brief_request_conflict';
  end if;

  select w.id, w.status
  into v_workflow_run_id, v_workflow_run_status
  from public.workflow_runs w
  where w.project_id = p_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and w.status in (
      'queued',
      'running',
      'pending_cost_confirmation',
      'retrying',
      'failed'
    )
  order by w.created_at desc
  limit 1
  for update;

  if v_workflow_run_id is null then
    insert into public.workflow_runs(
      project_id,
      workflow_key,
      workflow_version,
      status,
      current_step,
      initiated_by,
      input_snapshot,
      started_at
    )
    values (
      p_project_id,
      'client_intake_to_issued_proposal',
      1,
      'running',
      'generate_risk_register',
      v_initiated_by,
      jsonb_build_object(
        'answer_digest', p_answer_digest,
        'idempotency_key', p_idempotency_key
      ),
      now()
    )
    returning id into v_workflow_run_id;
    v_workflow_run_status := 'running';
  else
    if exists (
      select 1
      from public.workflow_step_runs s
      where s.workflow_run_id = v_workflow_run_id
        and s.step_key = 'generate_risk_register'
        and s.status in (
          'queued',
          'running',
          'waiting_for_human',
          'pending_cost_confirmation'
        )
    ) then
      raise exception 'initial_brief_request_conflict';
    end if;

    if v_workflow_run_status = 'failed' then
      update public.workflow_runs
      set status = 'retrying',
          current_step = 'generate_risk_register'
      where id = v_workflow_run_id
        and status = 'failed';
      if not found then
        raise exception 'initial_brief_request_conflict';
      end if;
      v_workflow_run_status := 'retrying';
    end if;

    update public.workflow_runs
    set status = 'running',
        current_step = 'generate_risk_register',
        error_state = null,
        input_snapshot = coalesce(input_snapshot, '{}'::jsonb)
          || jsonb_build_object(
            'answer_digest', p_answer_digest,
            'idempotency_key', p_idempotency_key
          )
    where id = v_workflow_run_id;
  end if;

  select coalesce(max(s.attempt), 0) + 1
  into v_attempt
  from public.workflow_step_runs s
  where s.workflow_run_id = v_workflow_run_id
    and s.step_key = 'generate_risk_register';

  select a.id
  into v_retry_of_id
  from public.ai_calls a
  where a.project_id = p_project_id
    and a.action_key = 'generate_risk_register'
    and a.request_digest is not null
    and a.idempotency_key is not null
    and a.lifecycle_state in ('completed', 'abandoned')
  order by a.created_at desc, a.id desc
  limit 1;

  insert into public.workflow_step_runs(
    workflow_run_id,
    step_key,
    attempt,
    status,
    input_snapshot,
    started_at
  )
  values (
    v_workflow_run_id,
    'generate_risk_register',
    v_attempt,
    'running',
    jsonb_build_object(
      'answer_digest', p_answer_digest,
      'idempotency_key', p_idempotency_key
    ),
    now()
  )
  returning id into v_workflow_step_run_id;

  insert into public.ai_calls(
    project_id,
    workflow_run_id,
    workflow_step_run_id,
    action_key,
    cost_class,
    provider,
    model,
    tokens_in,
    tokens_out,
    duration_ms,
    provider_cost_estimate,
    estimate_source,
    retry_of_id,
    outcome,
    lifecycle_state,
    request_digest,
    idempotency_key
  )
  values (
    p_project_id,
    v_workflow_run_id,
    v_workflow_step_run_id,
    'generate_risk_register',
    'metered_ai',
    'pending',
    'pending',
    0,
    0,
    0,
    0,
    'static_table',
    v_retry_of_id,
    'reserved',
    'reserved',
    p_answer_digest,
    p_idempotency_key
  )
  returning id into v_ai_call_id;

  return jsonb_build_object(
    'workflow_run_id', v_workflow_run_id,
    'workflow_step_run_id', v_workflow_step_run_id,
    'ai_call_id', v_ai_call_id,
    'replayed', false,
    'result_snapshot', null
  );
end;
$$;

revoke all on function public.reserve_initial_brief_ai_call(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_initial_brief_ai_call(uuid, text, text)
  to service_role;

-- The public intake route runs with the service role, but it still must not
-- receive generic write access to the AI ledger. This command completes one
-- exact reservation and makes the measured usage immutable.
create or replace function public.record_initial_brief_ai_usage(
  p_project_id uuid,
  p_workflow_run_id uuid,
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
  v_request_role text := coalesce(
    auth.role(),
    current_setting('request.jwt.claim.role', true),
    ''
  );
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
  v_ai_call public.ai_calls;
begin
  if v_request_role <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select w.* into v_run
  from public.workflow_runs w
  where w.id = p_workflow_run_id
    and w.project_id = p_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
  for update;
  if not found then
    raise exception 'initial brief workflow identity invalid';
  end if;

  select s.* into v_step
  from public.workflow_step_runs s
  where s.id = p_workflow_step_run_id
    and s.workflow_run_id = p_workflow_run_id
    and s.step_key = 'generate_risk_register'
    and s.status = 'running'
  for update;
  if not found then
    raise exception 'initial brief workflow step identity invalid';
  end if;

  select a.* into v_ai_call
  from public.ai_calls a
  where a.id = p_ai_call_id
    and a.project_id = p_project_id
    and a.workflow_run_id = p_workflow_run_id
    and a.workflow_step_run_id = p_workflow_step_run_id
    and a.action_key = 'generate_risk_register'
    and a.cost_class = 'metered_ai'
    and a.lifecycle_state in ('reserved', 'completed')
  for update;
  if not found then
    raise exception 'initial brief AI reservation identity invalid';
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
    raise exception 'initial brief AI usage invalid';
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
      raise exception 'completed initial brief AI usage is immutable';
    end if;
    return;
  end if;

  if v_ai_call.lifecycle_state = 'reserved' then
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
    where id = v_ai_call.id
      and project_id = p_project_id
      and workflow_run_id = p_workflow_run_id
      and workflow_step_run_id = p_workflow_step_run_id
      and lifecycle_state = 'reserved';
  end if;
end;
$$;

revoke all on function public.record_initial_brief_ai_usage(
  uuid, uuid, uuid, uuid, text, text, integer, integer, integer,
  numeric, text, text
) from public, anon, authenticated;
grant execute on function public.record_initial_brief_ai_usage(
  uuid, uuid, uuid, uuid, text, text, integer, integer, integer,
  numeric, text, text
) to service_role;

-- Close every failure after reservation through one atomic command. Raw
-- provider/database messages never enter persisted state: callers may pass only
-- one of the stable codes below.
create or replace function public.close_initial_brief_ai_call(
  p_project_id uuid,
  p_workflow_run_id uuid,
  p_workflow_step_run_id uuid,
  p_ai_call_id uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_role text := coalesce(
    auth.role(),
    current_setting('request.jwt.claim.role', true),
    ''
  );
  v_error_code text;
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
  v_ai_call public.ai_calls;
  v_changed boolean := false;
begin
  if v_request_role <> 'service_role' then
    raise exception 'service_role required';
  end if;

  v_error_code := case p_error_code
    when 'provider_execution_failed' then p_error_code
    when 'usage_persistence_failed' then p_error_code
    when 'legacy_persistence_failed' then p_error_code
    when 'workflow_finalization_failed' then p_error_code
    else 'workflow_terminalization_failed'
  end;

  select w.* into v_run
  from public.workflow_runs w
  where w.id = p_workflow_run_id
    and w.project_id = p_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
  for update;
  if not found then
    raise exception 'initial brief workflow identity invalid';
  end if;

  select s.* into v_step
  from public.workflow_step_runs s
  where s.id = p_workflow_step_run_id
    and s.workflow_run_id = p_workflow_run_id
    and s.step_key = 'generate_risk_register'
  for update;
  if not found then
    raise exception 'initial brief workflow step identity invalid';
  end if;

  select a.* into v_ai_call
  from public.ai_calls a
  where a.id = p_ai_call_id
    and a.project_id = p_project_id
    and a.workflow_run_id = p_workflow_run_id
    and a.workflow_step_run_id = p_workflow_step_run_id
    and a.action_key = 'generate_risk_register'
    and a.cost_class = 'metered_ai'
    and a.lifecycle_state in ('reserved', 'completed', 'abandoned')
  for update;
  if not found then
    raise exception 'initial brief AI reservation identity invalid';
  end if;

  if v_ai_call.lifecycle_state = 'reserved' then
    update public.ai_calls
    set outcome = 'abandoned',
        lifecycle_state = 'abandoned'
    where id = p_ai_call_id
      and project_id = p_project_id
      and workflow_run_id = p_workflow_run_id
      and workflow_step_run_id = p_workflow_step_run_id
      and lifecycle_state = 'reserved';
    v_changed := true;
  elsif v_ai_call.lifecycle_state = 'completed' then
    -- Cost evidence is immutable even when later business persistence fails.
    null;
  end if;

  if v_step.status <> 'failed'
    or v_step.error is distinct from jsonb_build_object('code', v_error_code) then
    update public.workflow_step_runs
    set status = 'failed',
        error = jsonb_build_object('code', v_error_code),
        completed_at = coalesce(completed_at, now())
    where id = p_workflow_step_run_id
      and workflow_run_id = p_workflow_run_id;
    v_changed := true;
  end if;

  if v_run.status <> 'failed'
    or v_run.error_state is distinct from jsonb_build_object(
      'step', 'generate_risk_register',
      'code', v_error_code
    ) then
    update public.workflow_runs
    set status = 'failed',
        current_step = 'generate_risk_register',
        error_state = jsonb_build_object(
          'step', 'generate_risk_register',
          'code', v_error_code
        )
    where id = p_workflow_run_id
      and project_id = p_project_id;
    v_changed := true;
  end if;

  if v_changed then
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
      p_project_id,
      null,
      'system',
      'initial_brief_ai_call_closed',
      'WorkflowStepRun',
      p_workflow_step_run_id,
      p_workflow_run_id,
      jsonb_build_object(
        'ai_call_id', p_ai_call_id,
        'ai_lifecycle_state',
          case
            when v_ai_call.lifecycle_state = 'completed' then 'completed'
            else 'abandoned'
          end,
        'error_code', v_error_code
      )
    );
  end if;

  return jsonb_build_object(
    'closed', true,
    'error_code', v_error_code,
    'ai_lifecycle_state',
      case
        when v_ai_call.lifecycle_state = 'completed' then 'completed'
        else 'abandoned'
      end
  );
end;
$$;

revoke all on function public.close_initial_brief_ai_call(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.close_initial_brief_ai_call(
  uuid, uuid, uuid, uuid, text
) to service_role;

-- Atomically publish one measured initial-brief result into both the legacy M1
-- tables and the governed platform ledger. The measured AI call is immutable by
-- this point: this command only verifies its identity and completed lifecycle.
create or replace function public.finalize_initial_brief(
  p_project_id uuid,
  p_workflow_run_id uuid,
  p_workflow_step_run_id uuid,
  p_ai_call_id uuid,
  p_answer_digest text,
  p_answers jsonb,
  p_passport jsonb,
  p_risk_cards jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_role text := coalesce(
    auth.role(),
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_run public.workflow_runs;
  v_risk_step public.workflow_step_runs;
  v_ai_call public.ai_calls;
  v_project public.projects;
  v_source_id uuid;
  v_answer record;
  v_answer_value jsonb;
  v_evidence_locator text;
  v_fact_type text;
  v_fact_value jsonb;
  v_fact_status text;
  v_fact_confidence numeric(4,3);
  v_previous_fact_id uuid;
  v_previous_version integer;
  v_fact_count integer := 0;
  v_card jsonb;
  v_evidence jsonb;
  v_evidence_values text[];
  v_risk_count integer := 0;
  v_extract_attempt integer;
  v_passport_attempt integer;
begin
  if v_request_role <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_answer_digest is null
    or p_answer_digest !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'answer digest must be a SHA-256 hex string';
  end if;

  select project.*
  into v_project
  from public.projects project
  where project.id = p_project_id
    and project.designer_id is not null
    and project.status in ('created', 'brief_sent', 'brief_in_progress')
  for update;
  if not found then
    raise exception 'initial brief project identity or state invalid';
  end if;

  select workflow.*
  into v_run
  from public.workflow_runs workflow
  where workflow.id = p_workflow_run_id
    and workflow.project_id = p_project_id
    and workflow.workflow_key = 'client_intake_to_issued_proposal'
    and workflow.workflow_version = 1
    and workflow.status = 'running'
    and workflow.initiated_by = v_project.designer_id
    and workflow.input_snapshot ->> 'answer_digest' = p_answer_digest
  for update;
  if not found then
    raise exception 'initial brief workflow identity invalid';
  end if;

  select step.*
  into v_risk_step
  from public.workflow_step_runs step
  where step.id = p_workflow_step_run_id
    and step.workflow_run_id = p_workflow_run_id
    and step.step_key = 'generate_risk_register'
    and step.status = 'running'
    and step.input_snapshot ->> 'answer_digest' = p_answer_digest
  for update;
  if not found then
    raise exception 'initial brief risk step identity invalid';
  end if;

  select call.*
  into v_ai_call
  from public.ai_calls call
  where call.id = p_ai_call_id
    and call.project_id = p_project_id
    and call.workflow_run_id = p_workflow_run_id
    and call.workflow_step_run_id = p_workflow_step_run_id
    and call.action_key = 'generate_risk_register'
    and call.lifecycle_state = 'completed'
    and call.request_digest = p_answer_digest
  for update;
  if not found then
    raise exception 'completed measured initial brief AI call not found';
  end if;

  if pg_catalog.jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'answers must be a JSON object';
  end if;
  if pg_catalog.pg_column_size(p_answers) > 262144 then
    raise exception 'answers payload is too large';
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_object_keys(p_answers)
  ) > 100 then
    raise exception 'answers contain too many entries';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_answers) as answer_key(key)
    where pg_catalog.length(pg_catalog.btrim(answer_key.key)) < 1
      or pg_catalog.length(answer_key.key) > 100
  ) then
    raise exception 'answers contain an unsupported question key';
  end if;

  if pg_catalog.jsonb_typeof(p_passport) is distinct from 'object' then
    raise exception 'passport must be a JSON object';
  end if;
  if pg_catalog.pg_column_size(p_passport) > 131072 then
    raise exception 'passport payload is too large';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_passport) as passport_key(key)
    where passport_key.key not in (
      'object',
      'asset_horizon',
      'household',
      'lifestyle',
      'budget',
      'timeline',
      'style',
      'rooms',
      'vision',
      'source',
      'contact',
      'pain_points',
      'scope'
    )
  ) then
    raise exception 'passport contains an unsupported top-level key';
  end if;

  if pg_catalog.jsonb_typeof(p_risk_cards) is distinct from 'array' then
    raise exception 'risk cards must be a JSON array';
  end if;
  if pg_catalog.pg_column_size(p_risk_cards) > 262144 then
    raise exception 'risk cards payload is too large';
  end if;
  if pg_catalog.jsonb_array_length(p_risk_cards) > 50 then
    raise exception 'risk cards payload contains too many cards';
  end if;

  for v_card in
    select card
    from pg_catalog.jsonb_array_elements(p_risk_cards) as risk(card)
  loop
    if pg_catalog.jsonb_typeof(v_card) is distinct from 'object' then
      raise exception 'risk card must be a JSON object';
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
      raise exception 'risk card is missing a required field';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_card) as card_key(key)
      where card_key.key not in (
        'risk_type',
        'evidence',
        'impact',
        'confidence',
        'designer_action',
        'proposal_implication',
        'source'
      )
    ) then
      raise exception 'risk card contains an unsupported field';
    end if;
    if pg_catalog.jsonb_typeof(v_card -> 'risk_type') <> 'string'
      or v_card ->> 'risk_type' not in (
        'budget',
        'timeline',
        'function',
        'style',
        'technical'
      )
      or pg_catalog.jsonb_typeof(v_card -> 'evidence') <> 'array'
      or pg_catalog.jsonb_array_length(v_card -> 'evidence') < 1
      or pg_catalog.jsonb_array_length(v_card -> 'evidence') > 20
      or pg_catalog.jsonb_typeof(v_card -> 'impact') <> 'string'
      or pg_catalog.length(v_card ->> 'impact') > 4000
      or pg_catalog.jsonb_typeof(v_card -> 'confidence') <> 'string'
      or v_card ->> 'confidence' not in ('low', 'medium', 'high')
      or pg_catalog.jsonb_typeof(v_card -> 'designer_action') <> 'string'
      or pg_catalog.length(v_card ->> 'designer_action') > 4000
      or pg_catalog.jsonb_typeof(v_card -> 'proposal_implication') <> 'string'
      or pg_catalog.length(v_card ->> 'proposal_implication') > 4000
      or pg_catalog.jsonb_typeof(v_card -> 'source') <> 'string'
      or v_card ->> 'source' not in ('rule', 'llm') then
      raise exception 'risk card schema is invalid';
    end if;
    for v_evidence in
      select evidence
      from pg_catalog.jsonb_array_elements(v_card -> 'evidence')
        as card_evidence(evidence)
    loop
      if pg_catalog.jsonb_typeof(v_evidence) <> 'string'
        or pg_catalog.length(v_evidence #>> '{}') > 2000 then
        raise exception 'risk card evidence schema is invalid';
      end if;
    end loop;
  end loop;

  insert into public.project_sources(
    project_id,
    source_type,
    source_ref,
    title,
    checksum,
    ingested_at,
    created_by
  )
  values (
    p_project_id,
    'client_brief',
    'answers:' || pg_catalog.lower(p_answer_digest),
    'Клиентский бриф',
    pg_catalog.lower(p_answer_digest),
    pg_catalog.now(),
    v_project.designer_id
  )
  on conflict (project_id, source_type, source_ref) do update
  set checksum = excluded.checksum,
      title = excluded.title,
      ingested_at = excluded.ingested_at
  returning id into v_source_id;

  insert into public.answers(project_id, question_id, value)
  select
    p_project_id,
    answer.key,
    answer.value
  from pg_catalog.jsonb_each(p_answers) as answer
  where true
  on conflict (project_id, question_id) do update
  set value = excluded.value;

  for v_answer in
    select answer.key, answer.value
    from pg_catalog.jsonb_each(p_answers) as answer
    order by answer.key
  loop
    v_answer_value := v_answer.value;
    v_evidence_locator := 'answers.' || v_answer.key;
    v_fact_type := case
      when v_answer.key in ('budget', 'timeline', 'object')
        then 'constraint'
      else 'requirement'
    end;
    v_fact_value := pg_catalog.jsonb_build_object(
      'question_id', v_answer.key,
      'answer', v_answer_value
    );
    if v_answer_value = 'null'::jsonb
      or (
        pg_catalog.jsonb_typeof(v_answer_value) = 'string'
        and pg_catalog.btrim(v_answer_value #>> '{}') = ''
      ) then
      v_fact_status := 'unknown';
      v_fact_confidence := 0;
    else
      v_fact_status := 'extracted';
      v_fact_confidence := 1;
    end if;
    v_previous_fact_id := null;
    v_previous_version := null;

    select fact.id, fact.version
    into v_previous_fact_id, v_previous_version
    from public.project_facts fact
    where fact.project_id = p_project_id
      and fact.evidence_locator = v_evidence_locator
    order by fact.version desc
    limit 1
    for update;

    insert into public.project_facts(
      project_id,
      fact_type,
      value,
      source_id,
      evidence_locator,
      status,
      confidence,
      created_by_type,
      created_by_id,
      version,
      supersedes_id
    )
    values (
      p_project_id,
      v_fact_type,
      v_fact_value,
      v_source_id,
      v_evidence_locator,
      v_fact_status,
      v_fact_confidence,
      'system',
      null,
      coalesce(v_previous_version, 0) + 1,
      v_previous_fact_id
    );
    v_fact_count := v_fact_count + 1;
  end loop;

  update public.projects
  set passport = p_passport,
      client_name = coalesce(
        nullif(
          pg_catalog.btrim(p_passport #>> '{contact,name}'),
          ''
        ),
        client_name
      ),
      status = 'brief_completed'
  where id = p_project_id;
  if not found then
    raise exception 'initial brief project update failed';
  end if;

  delete from public.risk_cards
  where project_id = p_project_id
    and status = 'proposed';

  for v_card in
    select card
    from pg_catalog.jsonb_array_elements(p_risk_cards) as risk(card)
  loop
    select coalesce(
      pg_catalog.array_agg(
        evidence.value #>> '{}'
        order by evidence.ordinality
      ),
      array[]::text[]
    )
    into v_evidence_values
    from pg_catalog.jsonb_array_elements(v_card -> 'evidence')
      with ordinality as evidence(value, ordinality);

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
    values (
      p_project_id,
      v_card ->> 'risk_type',
      v_evidence_values,
      v_card ->> 'impact',
      v_card ->> 'confidence',
      v_card ->> 'designer_action',
      v_card ->> 'proposal_implication',
      'proposed',
      v_card ->> 'source'
    );
    v_risk_count := v_risk_count + 1;
  end loop;

  insert into public.events(designer_id, project_id, type)
  values (v_project.designer_id, p_project_id, 'brief_completed');

  select coalesce(pg_catalog.max(step.attempt), 0) + 1
  into v_extract_attempt
  from public.workflow_step_runs step
  where step.workflow_run_id = p_workflow_run_id
    and step.step_key = 'extract_client_brief';

  insert into public.workflow_step_runs(
    workflow_run_id,
    step_key,
    attempt,
    status,
    input_snapshot,
    output_snapshot,
    started_at,
    completed_at
  )
  values (
    p_workflow_run_id,
    'extract_client_brief',
    v_extract_attempt,
    'completed',
    pg_catalog.jsonb_build_object('answer_digest', p_answer_digest),
    pg_catalog.jsonb_build_object(
      'answer_digest', p_answer_digest,
      'source_id', v_source_id,
      'fact_count', v_fact_count
    ),
    pg_catalog.now(),
    pg_catalog.now()
  );

  select coalesce(pg_catalog.max(step.attempt), 0) + 1
  into v_passport_attempt
  from public.workflow_step_runs step
  where step.workflow_run_id = p_workflow_run_id
    and step.step_key = 'build_project_passport';

  insert into public.workflow_step_runs(
    workflow_run_id,
    step_key,
    attempt,
    status,
    input_snapshot,
    output_snapshot,
    started_at,
    completed_at
  )
  values (
    p_workflow_run_id,
    'build_project_passport',
    v_passport_attempt,
    'completed',
    pg_catalog.jsonb_build_object('answer_digest', p_answer_digest),
    pg_catalog.jsonb_build_object(
      'answer_digest', p_answer_digest,
      'passport_present', true
    ),
    pg_catalog.now(),
    pg_catalog.now()
  );

  update public.workflow_step_runs
  set status = case
        when step_key = 'generate_risk_register' then 'completed'
        else status
      end,
      output_snapshot = coalesce(output_snapshot, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'answer_digest', p_answer_digest,
          'ai_call_id', p_ai_call_id,
          'llm_outcome', v_ai_call.outcome,
          'fallback_used', v_ai_call.outcome <> 'success',
          'risk_count', v_risk_count
        ),
      error = null,
      completed_at = pg_catalog.now()
  where id = p_workflow_step_run_id
    and workflow_run_id = p_workflow_run_id
    and step_key = 'generate_risk_register'
    and status = 'running';
  if not found then
    raise exception 'initial brief risk step changed concurrently';
  end if;

  if exists (
    select 1
    from public.approval_requests approval
    where approval.project_id = p_project_id
      and approval.subject_type = 'project_facts'
      and approval.approval_type = 'INTERNAL_REVIEWED'
      and approval.status = 'pending'
      and approval.workflow_run_id is distinct from p_workflow_run_id
  ) then
    raise exception 'pending human review belongs to another workflow run';
  end if;

  insert into public.approval_requests(
    project_id,
    workflow_run_id,
    subject_type,
    subject_id,
    approval_type,
    required_role,
    requested_by,
    status
  )
  select
    p_project_id,
    p_workflow_run_id,
    'project_facts',
    null,
    'INTERNAL_REVIEWED',
    'member',
    v_project.designer_id,
    'pending'
  where not exists (
    select 1
    from public.approval_requests approval
    where approval.project_id = p_project_id
      and approval.workflow_run_id = p_workflow_run_id
      and approval.subject_type = 'project_facts'
      and approval.subject_id is null
      and approval.approval_type = 'INTERNAL_REVIEWED'
      and approval.status = 'pending'
  );

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
    p_project_id,
    null,
    'system',
    'brief_workflow_waiting_for_review',
    'WorkflowRun',
    p_workflow_run_id,
    p_workflow_run_id,
    pg_catalog.jsonb_build_object(
      'answer_digest', p_answer_digest,
      'source_id', v_source_id,
      'ai_call_id', p_ai_call_id,
      'fact_count', v_fact_count,
      'risk_count', v_risk_count,
      'current_step', 'human_review'
    )
  );

  update public.workflow_runs
  set status = 'waiting_for_human',
      current_step = 'human_review',
      output_snapshot = coalesce(output_snapshot, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'answer_digest', p_answer_digest,
          'source_id', v_source_id,
          'ai_call_id', p_ai_call_id,
          'fact_count', v_fact_count,
          'risk_count', v_risk_count,
          'passport_present', true
        ),
      error_state = null
  where id = p_workflow_run_id
    and project_id = p_project_id
    and workflow_key = 'client_intake_to_issued_proposal'
    and workflow_version = 1
    and status = 'running';
  if not found then
    raise exception 'initial brief workflow changed concurrently';
  end if;

  return pg_catalog.jsonb_build_object(
    'workflow_run_id', p_workflow_run_id,
    'workflow_step_run_id', p_workflow_step_run_id,
    'ai_call_id', p_ai_call_id
  );
end;
$$;

revoke all on function public.finalize_initial_brief(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_initial_brief(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb
) to service_role;

-- Preserve the accumulated workflow evidence when the approved immutable
-- proposal revision is issued.
create or replace function public.issue_proposal_revision(
  p_proposal_revision_id uuid,
  p_approval_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_revision public.proposal_revisions;
  v_proposal public.proposals;
  v_approval public.approval_requests;
  v_run public.workflow_runs;
  v_designer_id uuid;
  v_max_revision integer;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select revision.*
  into v_revision
  from public.proposal_revisions revision
  join public.proposals proposal on proposal.id = revision.proposal_id
  join public.projects project on project.id = revision.project_id
  where revision.id = p_proposal_revision_id
    and proposal.project_id = revision.project_id
    and private.is_studio_member(project.designer_id)
  for update of revision;
  if not found then
    raise exception 'proposal revision not found or access denied';
  end if;

  select pr.*
  into v_proposal
  from public.proposals pr
  where pr.id = v_revision.proposal_id
    and pr.project_id = v_revision.project_id
  for update;
  if not found then
    raise exception 'proposal revision parent not found';
  end if;
  if v_proposal.sections is distinct from v_revision.sections then
    raise exception 'proposal draft differs from approved revision';
  end if;

  select project.designer_id
  into v_designer_id
  from public.projects project
  where project.id = v_revision.project_id;

  select approval.*
  into v_approval
  from public.approval_requests approval
  where approval.id = p_approval_request_id
  for update;
  if not found
    or v_approval.project_id is distinct from v_revision.project_id
    or v_approval.subject_type is distinct from 'proposal'
    or v_approval.subject_id is distinct from v_revision.proposal_id
    or v_approval.proposal_revision_id is distinct from v_revision.id
    or v_approval.approval_type is distinct from 'RELEASE_AUTHORIZED'
    or v_approval.status is distinct from 'approved' then
    raise exception 'approved proposal revision authorization required';
  end if;

  select w.*
  into v_run
  from public.workflow_runs w
  where w.id = v_approval.workflow_run_id
    and w.project_id = v_revision.project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
  for update;
  if not found then
    raise exception 'approval workflow identity invalid';
  end if;

  if v_proposal.status = 'sent'
    and v_proposal.issued_revision_id = v_revision.id
    and v_approval.issued_at is not null
    and v_run.status = 'completed' then
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
      v_revision.project_id,
      v_actor,
      'human',
      'proposal_issuance_replayed_idempotently',
      'proposal_revision',
      v_revision.id,
      v_run.id,
      pg_catalog.jsonb_build_object(
        'proposal_id', v_proposal.id,
        'version', v_revision.version
      )
    );
    return v_proposal.id;
  end if;

  if v_proposal.status <> 'draft'
    or v_proposal.issued_revision_id is not null
    or v_approval.issued_at is not null
    or v_run.status <> 'running'
    or v_run.current_step <> 'issue_proposal' then
    raise exception 'proposal is not in an issuable state';
  end if;

  select pg_catalog.max(revision.version)
  into v_max_revision
  from public.proposal_revisions revision
  where revision.proposal_id = v_proposal.id;
  if v_revision.version is distinct from v_max_revision
    or v_revision.version <= v_proposal.version then
    raise exception 'only the current monotonic proposal revision can be issued';
  end if;

  update public.proposals
  set sections = v_revision.sections,
      version = v_revision.version,
      status = 'sent',
      sent_at = now(),
      issued_revision_id = v_revision.id
  where id = v_revision.proposal_id
    and project_id = v_revision.project_id
    and status = 'draft'
    and issued_revision_id is null;
  if not found then
    raise exception 'proposal changed concurrently';
  end if;

  update public.approval_requests
  set issued_at = now()
  where id = v_approval.id
    and status = 'approved'
    and proposal_revision_id = v_revision.id
    and issued_at is null;
  if not found then
    raise exception 'approval changed concurrently';
  end if;

  update public.projects
  set status = 'proposal_sent'
  where id = v_revision.project_id
    and status in ('brief_completed', 'proposal_draft');
  if not found then
    raise exception 'project is not in an issuable state';
  end if;

  update public.workflow_runs
  set status = 'completed',
      current_step = 'issue_proposal',
      completed_at = now(),
      output_snapshot = coalesce(output_snapshot, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'proposal_issue',
          pg_catalog.jsonb_build_object(
            'proposal_id', v_proposal.id,
            'proposal_revision_id', v_revision.id,
            'approval_request_id', v_approval.id,
            'proposal_issued', true
          )
        ),
      error_state = null
  where id = v_run.id
    and project_id = v_revision.project_id
    and status = 'running'
    and current_step = 'issue_proposal';
  if not found then
    raise exception 'workflow changed concurrently';
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
    v_revision.project_id,
    v_actor,
    'human',
    'proposal_issued',
    'proposal_revision',
    v_revision.id,
    v_run.id,
    pg_catalog.jsonb_build_object(
      'proposal_id', v_proposal.id,
      'approval_request_id', v_approval.id,
      'version', v_revision.version
    )
  );

  insert into public.events(designer_id, project_id, type)
  values (v_designer_id, v_revision.project_id, 'proposal_sent');

  return v_revision.proposal_id;
end;
$$;

revoke all on function public.issue_proposal_revision(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.issue_proposal_revision(uuid, uuid)
  to authenticated;

-- The production-snapshot compatibility policies were created after the
-- public membership helper had been revoked. Replace them additively with the
-- private SECURITY DEFINER boundary used by the rest of the platform.
drop policy if exists project_rooms_studio_all on public.project_rooms;
create policy project_rooms_studio_all
on public.project_rooms for all to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_rooms.project_id
      and private.is_studio_member(p.designer_id)
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_rooms.project_id
      and private.is_studio_member(p.designer_id)
  )
);

drop policy if exists project_participants_studio_all
  on public.project_participants;
create policy project_participants_studio_all
on public.project_participants for all to authenticated
using (
  exists (
    select 1
    from public.project_rooms r
    join public.projects p on p.id = r.project_id
    where r.id = project_participants.room_id
      and private.is_studio_member(p.designer_id)
  )
)
with check (
  exists (
    select 1
    from public.project_rooms r
    join public.projects p on p.id = r.project_id
    where r.id = project_participants.room_id
      and private.is_studio_member(p.designer_id)
  )
);

drop policy if exists project_tasks_studio_all on public.project_tasks;
create policy project_tasks_studio_all
on public.project_tasks for all to authenticated
using (
  exists (
    select 1
    from public.project_rooms r
    join public.projects p on p.id = r.project_id
    where r.id = project_tasks.room_id
      and private.is_studio_member(p.designer_id)
  )
)
with check (
  exists (
    select 1
    from public.project_rooms r
    join public.projects p on p.id = r.project_id
    where r.id = project_tasks.room_id
      and private.is_studio_member(p.designer_id)
  )
);

drop policy if exists project_task_events_studio_all
  on public.project_task_events;
create policy project_task_events_studio_all
on public.project_task_events for all to authenticated
using (
  exists (
    select 1
    from public.project_rooms r
    join public.projects p on p.id = r.project_id
    where r.id = project_task_events.room_id
      and private.is_studio_member(p.designer_id)
  )
)
with check (
  exists (
    select 1
    from public.project_rooms r
    join public.projects p on p.id = r.project_id
    where r.id = project_task_events.room_id
      and private.is_studio_member(p.designer_id)
  )
);

-- Retire the pre-metering retry commands. The active runtime uses the guarded
-- reserve -> record usage -> finalize/close sequence instead.
revoke all on function public.prepare_m1_risk_retry(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_m1_risk_retry(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_m1_risk_retry(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_m1_risk_rerun(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- Restrict a manual risk rerun to the still-pending human-review gate. Once
-- internal review advances, a rerun must not silently invalidate that decision.
alter function public.reserve_m1_risk_rerun(uuid, uuid, text, text)
  rename to reserve_m1_risk_rerun_legacy_unscoped;
revoke all on function public.reserve_m1_risk_rerun_legacy_unscoped(
  uuid, uuid, text, text
) from public, anon, authenticated;

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
  v_run public.workflow_runs;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select w.*
  into v_run
  from public.workflow_runs w
  join public.projects p on p.id = w.project_id
  where w.id = p_workflow_run_id
    and w.project_id = p_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and w.status = 'waiting_for_human'
    and w.current_step = 'human_review'
    and private.is_studio_member(p.designer_id)
  for update of w;

  if not found then
    raise exception 'pending human-review workflow not found or access denied';
  end if;

  return public.reserve_m1_risk_rerun_legacy_unscoped(
    p_project_id,
    p_workflow_run_id,
    p_provider,
    p_model
  );
end;
$$;

revoke all on function public.reserve_m1_risk_rerun(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.reserve_m1_risk_rerun(
  uuid, uuid, text, text
) to authenticated;

-- Preserve the reservation's provider identity when durable usage is written.
alter function public.record_m1_risk_ai_usage(
  uuid, uuid, text, text, integer, integer, integer, numeric, text, text
) rename to record_m1_risk_ai_usage_legacy_unbound;
revoke all on function public.record_m1_risk_ai_usage_legacy_unbound(
  uuid, uuid, text, text, integer, integer, integer, numeric, text, text
) from public, anon, authenticated;

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

  select a.*
  into v_ai_call
  from public.ai_calls a
  join public.workflow_step_runs s on s.id = a.workflow_step_run_id
  join public.workflow_runs w on w.id = s.workflow_run_id
  join public.projects p on p.id = w.project_id
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = p_workflow_step_run_id
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state in ('reserved', 'completed')
    and a.action_key = 'generate_risk_register'
    and s.status = 'running'
    and (
      (w.status = 'waiting_for_human' and w.current_step = 'human_review')
      or (
        w.status = 'retrying'
        and w.current_step = 'generate_risk_register'
      )
    )
    and private.is_studio_member(p.designer_id)
  for update of a;

  if not found then
    raise exception 'risk AI reservation not found or access denied';
  end if;
  if v_ai_call.provider is distinct from pg_catalog.btrim(p_provider)
    or v_ai_call.model is distinct from pg_catalog.btrim(p_model) then
    raise exception 'risk AI reservation provider identity changed';
  end if;

  perform public.record_m1_risk_ai_usage_legacy_unbound(
    p_workflow_step_run_id,
    p_ai_call_id,
    v_ai_call.provider,
    v_ai_call.model,
    p_tokens_in,
    p_tokens_out,
    p_duration_ms,
    p_provider_cost_estimate,
    p_estimate_source,
    p_outcome
  );
end;
$$;

revoke all on function public.record_m1_risk_ai_usage(
  uuid, uuid, text, text, integer, integer, integer, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.record_m1_risk_ai_usage(
  uuid, uuid, text, text, integer, integer, integer, numeric, text, text
) to authenticated;

-- Bind business finalization to the immutable completed AI ledger. The legacy
-- implementation remains callable only by this guarded wrapper.
alter function public.finalize_m1_risk_rerun(
  uuid, uuid, jsonb, jsonb, jsonb, text, text,
  integer, integer, integer, numeric, text, text
) rename to finalize_m1_risk_rerun_legacy_unbound;
revoke all on function public.finalize_m1_risk_rerun_legacy_unbound(
  uuid, uuid, jsonb, jsonb, jsonb, text, text,
  integer, integer, integer, numeric, text, text
) from public, anon, authenticated;

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
  v_ai_call public.ai_calls;
  v_canonical_output jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select a.*
  into v_ai_call
  from public.ai_calls a
  join public.workflow_step_runs s on s.id = a.workflow_step_run_id
  join public.workflow_runs w on w.id = s.workflow_run_id
  join public.projects p on p.id = w.project_id
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = p_workflow_step_run_id
    and a.workflow_run_id = w.id
    and a.project_id = w.project_id
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state = 'completed'
    and a.action_key = 'generate_risk_register'
    and s.status = 'running'
    and (
      (w.status = 'waiting_for_human' and w.current_step = 'human_review')
      or (
        w.status = 'retrying'
        and w.current_step = 'generate_risk_register'
      )
    )
    and private.is_studio_member(p.designer_id)
  for update of a;

  if not found then
    raise exception 'measured risk AI call not found for workflow step';
  end if;
  if v_ai_call.provider is distinct from pg_catalog.btrim(p_provider)
    or v_ai_call.model is distinct from pg_catalog.btrim(p_model)
    or v_ai_call.tokens_in is distinct from p_tokens_in
    or v_ai_call.tokens_out is distinct from p_tokens_out
    or v_ai_call.duration_ms is distinct from p_duration_ms
    or v_ai_call.provider_cost_estimate
      is distinct from p_provider_cost_estimate
    or v_ai_call.estimate_source is distinct from p_estimate_source
    or v_ai_call.outcome is distinct from p_outcome then
    raise exception 'finalize usage differs from immutable AI ledger';
  end if;
  if p_risk_cards is null
    or pg_catalog.jsonb_typeof(p_risk_cards) <> 'array'
    or p_output_snapshot is null
    or pg_catalog.jsonb_typeof(p_output_snapshot) <> 'object' then
    raise exception 'risk output must contain cards and a snapshot';
  end if;

  v_canonical_output := p_output_snapshot
    || pg_catalog.jsonb_build_object(
      'ai_call_id', v_ai_call.id,
      'llm_outcome', v_ai_call.outcome,
      'fallback_used', v_ai_call.outcome <> 'success',
      'risk_card_count', pg_catalog.jsonb_array_length(p_risk_cards)
    );

  return public.finalize_m1_risk_rerun_legacy_unbound(
    p_workflow_step_run_id,
    p_ai_call_id,
    p_passport,
    p_risk_cards,
    v_canonical_output,
    v_ai_call.provider,
    v_ai_call.model,
    v_ai_call.tokens_in,
    v_ai_call.tokens_out,
    v_ai_call.duration_ms,
    v_ai_call.provider_cost_estimate,
    v_ai_call.estimate_source,
    v_ai_call.outcome
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

-- A failure terminalizer may close a reserved call, or replay a completed call
-- only with the exact immutable usage already recorded.
alter function public.close_m1_risk_ai_reservation(
  uuid, uuid, boolean, text, text, integer, integer, integer,
  numeric, text, text, jsonb
) rename to close_m1_risk_ai_reservation_legacy_unbound;
revoke all on function public.close_m1_risk_ai_reservation_legacy_unbound(
  uuid, uuid, boolean, text, text, integer, integer, integer,
  numeric, text, text, jsonb
) from public, anon, authenticated;

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
  v_ai_call public.ai_calls;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select a.*
  into v_ai_call
  from public.ai_calls a
  join public.workflow_step_runs s on s.id = a.workflow_step_run_id
  join public.workflow_runs w on w.id = s.workflow_run_id
  join public.projects p on p.id = w.project_id
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = p_workflow_step_run_id
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state in ('reserved', 'completed')
    and a.action_key = 'generate_risk_register'
    and s.status = 'running'
    and (
      (w.status = 'waiting_for_human' and w.current_step = 'human_review')
      or (
        w.status = 'retrying'
        and w.current_step = 'generate_risk_register'
      )
    )
    and private.is_studio_member(p.designer_id)
  for update of a;

  if not found then
    raise exception 'risk AI call not found for workflow step';
  end if;

  if v_ai_call.lifecycle_state = 'completed' and (
    not p_provider_completed
    or v_ai_call.provider is distinct from pg_catalog.btrim(p_provider)
    or v_ai_call.model is distinct from pg_catalog.btrim(p_model)
    or v_ai_call.tokens_in is distinct from p_tokens_in
    or v_ai_call.tokens_out is distinct from p_tokens_out
    or v_ai_call.duration_ms is distinct from p_duration_ms
    or v_ai_call.provider_cost_estimate
      is distinct from p_provider_cost_estimate
    or v_ai_call.estimate_source is distinct from p_estimate_source
    or v_ai_call.outcome is distinct from p_outcome
  ) then
    raise exception 'completed AI usage is immutable';
  end if;

  if v_ai_call.lifecycle_state = 'reserved'
    and p_provider_completed
    and (
      v_ai_call.provider is distinct from pg_catalog.btrim(p_provider)
      or v_ai_call.model is distinct from pg_catalog.btrim(p_model)
    ) then
    raise exception 'risk AI reservation provider identity changed';
  end if;

  perform public.close_m1_risk_ai_reservation_legacy_unbound(
    p_workflow_step_run_id,
    p_ai_call_id,
    p_provider_completed,
    v_ai_call.provider,
    v_ai_call.model,
    case
      when v_ai_call.lifecycle_state = 'completed'
        then v_ai_call.tokens_in
      else p_tokens_in
    end,
    case
      when v_ai_call.lifecycle_state = 'completed'
        then v_ai_call.tokens_out
      else p_tokens_out
    end,
    case
      when v_ai_call.lifecycle_state = 'completed'
        then v_ai_call.duration_ms
      else p_duration_ms
    end,
    case
      when v_ai_call.lifecycle_state = 'completed'
        then v_ai_call.provider_cost_estimate
      else p_provider_cost_estimate
    end,
    case
      when v_ai_call.lifecycle_state = 'completed'
        then v_ai_call.estimate_source
      else p_estimate_source
    end,
    case
      when v_ai_call.lifecycle_state = 'completed'
        then v_ai_call.outcome
      else p_outcome
    end,
    p_error
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

-- Supabase's legacy default/table grants included TRUNCATE, TRIGGER and
-- REFERENCES. RLS cannot protect those privileges, so remove them globally.
revoke all on all tables in schema public from anon;
revoke truncate, trigger, references
  on all tables in schema public
  from authenticated;

-- The compatibility tables remain available to authenticated studio members
-- through their RLS policies, with ordinary row-level CRUD only.
revoke all on table
  public.project_rooms,
  public.project_participants,
  public.project_tasks,
  public.project_task_events
from authenticated;
grant select, insert, update, delete on table
  public.project_rooms,
  public.project_participants,
  public.project_tasks,
  public.project_task_events
to authenticated;

-- Explicit authenticated application privileges. RLS remains the row boundary;
-- public intake/proposal routes continue to use token-checked server clients.
grant select, insert, update on table public.designers to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select on table public.answers to authenticated;
grant select, update on table public.risk_cards to authenticated;
revoke insert on table public.proposals from authenticated;
grant select on table public.proposals to authenticated;
grant update (sections) on table public.proposals to authenticated;
grant select, insert on table public.events to authenticated;
grant select, insert, delete on table public.studio_members to authenticated;

-- The production snapshot did not preserve ordinary application DML for the
-- Supabase service role. Server-only intake and public-link handlers require
-- those privileges even though service_role bypasses RLS. Restore only row
-- DML; do not restore TRUNCATE, TRIGGER or REFERENCES.
revoke truncate, trigger, references
  on all tables in schema public
  from service_role;
grant select, insert, update, delete
  on all tables in schema public
  to service_role;

-- Metered provider results cross a server-only trust boundary. The
-- request-bound authenticated session may reserve an actor-scoped attempt, but
-- only the server service role may persist usage, business output, or failure.
-- Each terminal command recovers the human actor from the immutable reservation
-- snapshot and re-checks that the actor still belongs to the owning studio.

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
  v_request_role text := coalesce(
    nullif(
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    ),
    auth.role(),
    ''
  );
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
  v_ai_call public.ai_calls;
  v_actor_text text;
  v_actor uuid;
  v_project_id uuid;
begin
  if v_request_role <> 'service_role' then
    raise exception 'service role required';
  end if;

  select p.id
  into v_project_id
  from public.projects p
  join public.workflow_runs w on w.project_id = p.id
  join public.workflow_step_runs s on s.workflow_run_id = w.id
  join public.ai_calls a on a.workflow_step_run_id = s.id
  where s.id = p_workflow_step_run_id
    and a.id = p_ai_call_id
    and a.workflow_run_id = w.id
    and a.project_id = p.id
    and a.action_key = 'generate_risk_register'
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state in ('reserved', 'completed')
  for update of p;
  if not found then
    raise exception 'risk AI reservation not found';
  end if;

  select w.*
  into v_run
  from public.workflow_runs w
  where w.id = (
      select s.workflow_run_id
      from public.workflow_step_runs s
      where s.id = p_workflow_step_run_id
    )
    and w.project_id = v_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and (
      (
        w.status = 'waiting_for_human'
        and w.current_step = 'human_review'
      )
      or (
        w.status = 'retrying'
        and w.current_step = 'generate_risk_register'
      )
    )
  for update;
  if not found then
    raise exception 'risk workflow is not terminalizable';
  end if;

  select s.*
  into v_step
  from public.workflow_step_runs s
  where s.id = p_workflow_step_run_id
    and s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register'
    and s.status = 'running'
  for update;
  if not found then
    raise exception 'running risk workflow step not found';
  end if;

  v_actor_text := v_step.input_snapshot->>'requested_by';
  if v_actor_text is null
    or v_actor_text !~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
      || '[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
    raise exception 'reserved actor is invalid';
  end if;
  v_actor := v_actor_text::uuid;

  if not exists (
    select 1
    from public.projects p
    where p.id = v_run.project_id
      and (
        p.designer_id = v_actor
        or exists (
          select 1
          from public.studio_members m
          where m.owner_id = p.designer_id
            and m.member_id = v_actor
            and m.status = 'active'
        )
      )
  ) then
    raise exception 'reserved actor is no longer authorized';
  end if;

  select a.*
  into v_ai_call
  from public.ai_calls a
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = v_step.id
    and a.workflow_run_id = v_run.id
    and a.project_id = v_run.project_id
    and a.action_key = 'generate_risk_register'
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state in ('reserved', 'completed')
  for update;
  if not found then
    raise exception 'risk AI reservation not found';
  end if;

  if nullif(pg_catalog.btrim(p_provider), '') is null
    or nullif(pg_catalog.btrim(p_model), '') is null
    or p_tokens_in is null
    or p_tokens_out is null
    or p_duration_ms is null
    or p_provider_cost_estimate is null
    or p_tokens_in < 0
    or p_tokens_out < 0
    or p_duration_ms < 0
    or p_provider_cost_estimate < 0
    or p_estimate_source not in ('static_table', 'provider_response')
    or p_outcome not in (
      'success',
      'schema_fail',
      'provider_error',
      'timeout'
    ) then
    raise exception 'AI usage is invalid';
  end if;
  if v_ai_call.provider is distinct from pg_catalog.btrim(p_provider)
    or v_ai_call.model is distinct from pg_catalog.btrim(p_model) then
    raise exception 'risk AI reservation provider identity changed';
  end if;

  if v_ai_call.lifecycle_state = 'completed' then
    if v_ai_call.tokens_in is distinct from p_tokens_in
      or v_ai_call.tokens_out is distinct from p_tokens_out
      or v_ai_call.duration_ms is distinct from p_duration_ms
      or v_ai_call.provider_cost_estimate
        is distinct from p_provider_cost_estimate
      or v_ai_call.estimate_source is distinct from p_estimate_source
      or v_ai_call.outcome is distinct from p_outcome then
      raise exception 'completed AI usage is immutable';
    end if;
    return;
  end if;

  update public.ai_calls
  set tokens_in = p_tokens_in,
      tokens_out = p_tokens_out,
      duration_ms = p_duration_ms,
      provider_cost_estimate = p_provider_cost_estimate,
      estimate_source = p_estimate_source,
      outcome = p_outcome,
      lifecycle_state = 'completed'
  where id = v_ai_call.id
    and lifecycle_state = 'reserved';
  if not found then
    raise exception 'risk AI reservation changed concurrently';
  end if;
end;
$$;

revoke all on function public.record_m1_risk_ai_usage(
  uuid, uuid, text, text, integer, integer, integer, numeric, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_m1_risk_ai_usage(
  uuid, uuid, text, text, integer, integer, integer, numeric, text, text
) to service_role;

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
  v_request_role text := coalesce(
    nullif(
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    ),
    auth.role(),
    ''
  );
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
  v_ai_call public.ai_calls;
  v_actor_text text;
  v_actor uuid;
  v_project_id uuid;
  v_card jsonb;
  v_canonical_output jsonb;
begin
  if v_request_role <> 'service_role' then
    raise exception 'service role required';
  end if;

  select p.id
  into v_project_id
  from public.projects p
  join public.workflow_runs w on w.project_id = p.id
  join public.workflow_step_runs s on s.workflow_run_id = w.id
  join public.ai_calls a on a.workflow_step_run_id = s.id
  where s.id = p_workflow_step_run_id
    and a.id = p_ai_call_id
    and a.workflow_run_id = w.id
    and a.project_id = p.id
    and a.action_key = 'generate_risk_register'
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state = 'completed'
  for update of p;
  if not found then
    raise exception 'measured risk AI call not found';
  end if;

  select w.*
  into v_run
  from public.workflow_runs w
  where w.id = (
      select s.workflow_run_id
      from public.workflow_step_runs s
      where s.id = p_workflow_step_run_id
    )
    and w.project_id = v_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and (
      (
        w.status = 'waiting_for_human'
        and w.current_step = 'human_review'
      )
      or (
        w.status = 'retrying'
        and w.current_step = 'generate_risk_register'
      )
    )
  for update;
  if not found then
    raise exception 'risk workflow is not terminalizable';
  end if;

  select s.*
  into v_step
  from public.workflow_step_runs s
  where s.id = p_workflow_step_run_id
    and s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register'
    and s.status = 'running'
  for update;
  if not found then
    raise exception 'running risk workflow step not found';
  end if;

  v_actor_text := v_step.input_snapshot->>'requested_by';
  if v_actor_text is null
    or v_actor_text !~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
      || '[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
    raise exception 'reserved actor is invalid';
  end if;
  v_actor := v_actor_text::uuid;

  if not exists (
    select 1
    from public.projects p
    where p.id = v_run.project_id
      and (
        p.designer_id = v_actor
        or exists (
          select 1
          from public.studio_members m
          where m.owner_id = p.designer_id
            and m.member_id = v_actor
            and m.status = 'active'
        )
      )
  ) then
    raise exception 'reserved actor is no longer authorized';
  end if;

  select a.*
  into v_ai_call
  from public.ai_calls a
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = v_step.id
    and a.workflow_run_id = v_run.id
    and a.project_id = v_run.project_id
    and a.action_key = 'generate_risk_register'
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state = 'completed'
  for update;
  if not found then
    raise exception 'measured risk AI call not found';
  end if;

  if v_ai_call.provider is distinct from pg_catalog.btrim(p_provider)
    or v_ai_call.model is distinct from pg_catalog.btrim(p_model)
    or v_ai_call.tokens_in is distinct from p_tokens_in
    or v_ai_call.tokens_out is distinct from p_tokens_out
    or v_ai_call.duration_ms is distinct from p_duration_ms
    or v_ai_call.provider_cost_estimate
      is distinct from p_provider_cost_estimate
    or v_ai_call.estimate_source is distinct from p_estimate_source
    or v_ai_call.outcome is distinct from p_outcome then
    raise exception 'finalize usage differs from immutable AI ledger';
  end if;
  if p_passport is null
    or pg_catalog.jsonb_typeof(p_passport) <> 'object' then
    raise exception 'passport must be a JSON object';
  end if;
  if p_risk_cards is null
    or pg_catalog.jsonb_typeof(p_risk_cards) <> 'array' then
    raise exception 'risk cards must be a JSON array';
  end if;
  if p_output_snapshot is null
    or pg_catalog.jsonb_typeof(p_output_snapshot) <> 'object' then
    raise exception 'output snapshot must be a JSON object';
  end if;

  for v_card in
    select value
    from pg_catalog.jsonb_array_elements(p_risk_cards)
  loop
    if pg_catalog.jsonb_typeof(v_card) <> 'object' then
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
      from pg_catalog.jsonb_object_keys(v_card) as field_name
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
    if pg_catalog.jsonb_typeof(v_card->'risk_type') <> 'string'
      or pg_catalog.jsonb_typeof(v_card->'evidence') <> 'array'
      or pg_catalog.jsonb_typeof(v_card->'impact') <> 'string'
      or pg_catalog.jsonb_typeof(v_card->'confidence') <> 'string'
      or pg_catalog.jsonb_typeof(v_card->'designer_action') <> 'string'
      or pg_catalog.jsonb_typeof(v_card->'proposal_implication') <> 'string'
      or pg_catalog.jsonb_typeof(v_card->'source') <> 'string' then
      raise exception 'risk card fields have invalid JSON types';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_card->'evidence') as evidence(value)
      where pg_catalog.jsonb_typeof(evidence.value) <> 'string'
    ) then
      raise exception 'risk card evidence must contain only strings';
    end if;
    if v_card->>'risk_type' not in (
      'budget',
      'timeline',
      'function',
      'style',
      'technical'
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

  v_canonical_output := p_output_snapshot
    || pg_catalog.jsonb_build_object(
      'ai_call_id', v_ai_call.id,
      'llm_outcome', v_ai_call.outcome,
      'fallback_used', v_ai_call.outcome <> 'success',
      'risk_card_count', pg_catalog.jsonb_array_length(p_risk_cards)
    );

  update public.projects
  set passport = p_passport
  where id = v_run.project_id;

  delete from public.risk_cards
  where project_id = v_run.project_id
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
    v_run.project_id,
    card.risk_type,
    array(
      select evidence.value
      from pg_catalog.jsonb_array_elements_text(card.evidence)
        as evidence(value)
    ),
    card.impact,
    card.confidence,
    card.designer_action,
    card.proposal_implication,
    'proposed',
    card.source
  from pg_catalog.jsonb_to_recordset(p_risk_cards) as card(
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
      output_snapshot = v_canonical_output,
      error = null,
      completed_at = pg_catalog.now()
  where id = v_step.id
    and status = 'running';
  if not found then
    raise exception 'risk workflow step changed concurrently';
  end if;

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
      v_run.project_id,
      v_actor,
      'human',
      'workflow_retry_completed',
      'WorkflowStepRun',
      v_step.id,
      v_run.id,
      pg_catalog.jsonb_build_object(
        'step_key',
        'generate_risk_register',
        'attempt',
        v_step.attempt
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
    v_run.project_id,
    v_actor,
    'human',
    'risk_register_generated',
    'WorkflowStepRun',
    v_step.id,
    v_run.id,
    pg_catalog.jsonb_build_object(
      'ai_call_id',
      v_ai_call.id,
      'risk_card_count',
      pg_catalog.jsonb_array_length(p_risk_cards),
      'outcome',
      v_ai_call.outcome
    )
  );

  return pg_catalog.jsonb_build_object(
    'workflow_step_run_id',
    v_step.id,
    'ai_call_id',
    v_ai_call.id,
    'risk_card_count',
    pg_catalog.jsonb_array_length(p_risk_cards)
  );
end;
$$;

revoke all on function public.finalize_m1_risk_rerun(
  uuid, uuid, jsonb, jsonb, jsonb, text, text,
  integer, integer, integer, numeric, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_m1_risk_rerun(
  uuid, uuid, jsonb, jsonb, jsonb, text, text,
  integer, integer, integer, numeric, text, text
) to service_role;

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
  v_request_role text := coalesce(
    nullif(
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    ),
    auth.role(),
    ''
  );
  v_run public.workflow_runs;
  v_step public.workflow_step_runs;
  v_ai_call public.ai_calls;
  v_actor_text text;
  v_actor uuid;
  v_project_id uuid;
  v_error_code text;
  v_error jsonb;
begin
  if v_request_role <> 'service_role' then
    raise exception 'service role required';
  end if;

  select p.id
  into v_project_id
  from public.projects p
  join public.workflow_runs w on w.project_id = p.id
  join public.workflow_step_runs s on s.workflow_run_id = w.id
  join public.ai_calls a on a.workflow_step_run_id = s.id
  where s.id = p_workflow_step_run_id
    and a.id = p_ai_call_id
    and a.workflow_run_id = w.id
    and a.project_id = p.id
    and a.action_key = 'generate_risk_register'
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state in ('reserved', 'completed')
  for update of p;
  if not found then
    raise exception 'risk AI call not found';
  end if;

  select w.*
  into v_run
  from public.workflow_runs w
  where w.id = (
      select s.workflow_run_id
      from public.workflow_step_runs s
      where s.id = p_workflow_step_run_id
    )
    and w.project_id = v_project_id
    and w.workflow_key = 'client_intake_to_issued_proposal'
    and w.workflow_version = 1
    and (
      (
        w.status = 'waiting_for_human'
        and w.current_step = 'human_review'
      )
      or (
        w.status = 'retrying'
        and w.current_step = 'generate_risk_register'
      )
    )
  for update;
  if not found then
    raise exception 'risk workflow is not terminalizable';
  end if;

  select s.*
  into v_step
  from public.workflow_step_runs s
  where s.id = p_workflow_step_run_id
    and s.workflow_run_id = v_run.id
    and s.step_key = 'generate_risk_register'
    and s.status = 'running'
  for update;
  if not found then
    raise exception 'running risk workflow step not found';
  end if;

  v_actor_text := v_step.input_snapshot->>'requested_by';
  if v_actor_text is null
    or v_actor_text !~* (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
      || '[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
    raise exception 'reserved actor is invalid';
  end if;
  v_actor := v_actor_text::uuid;

  if not exists (
    select 1
    from public.projects p
    where p.id = v_run.project_id
      and (
        p.designer_id = v_actor
        or exists (
          select 1
          from public.studio_members m
          where m.owner_id = p.designer_id
            and m.member_id = v_actor
            and m.status = 'active'
        )
      )
  ) then
    raise exception 'reserved actor is no longer authorized';
  end if;

  select a.*
  into v_ai_call
  from public.ai_calls a
  where a.id = p_ai_call_id
    and a.workflow_step_run_id = v_step.id
    and a.workflow_run_id = v_run.id
    and a.project_id = v_run.project_id
    and a.action_key = 'generate_risk_register'
    and a.request_digest is null
    and a.idempotency_key is null
    and a.lifecycle_state in ('reserved', 'completed')
  for update;
  if not found then
    raise exception 'risk AI call not found';
  end if;

  if p_error is null
    or pg_catalog.jsonb_typeof(p_error) <> 'object' then
    raise exception 'error payload must be a JSON object';
  end if;
  v_error_code := p_error->>'code';
  if v_error_code is null
    or v_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'error code is invalid';
  end if;
  v_error := pg_catalog.jsonb_build_object('code', v_error_code);

  if v_ai_call.lifecycle_state = 'completed' and (
    not p_provider_completed
    or v_ai_call.provider is distinct from pg_catalog.btrim(p_provider)
    or v_ai_call.model is distinct from pg_catalog.btrim(p_model)
    or v_ai_call.tokens_in is distinct from p_tokens_in
    or v_ai_call.tokens_out is distinct from p_tokens_out
    or v_ai_call.duration_ms is distinct from p_duration_ms
    or v_ai_call.provider_cost_estimate
      is distinct from p_provider_cost_estimate
    or v_ai_call.estimate_source is distinct from p_estimate_source
    or v_ai_call.outcome is distinct from p_outcome
  ) then
    raise exception 'completed AI usage is immutable';
  end if;

  if v_ai_call.lifecycle_state = 'reserved'
    and p_provider_completed then
    if v_ai_call.provider is distinct from pg_catalog.btrim(p_provider)
      or v_ai_call.model is distinct from pg_catalog.btrim(p_model) then
      raise exception 'risk AI reservation provider identity changed';
    end if;
    if p_tokens_in is null
      or p_tokens_out is null
      or p_duration_ms is null
      or p_provider_cost_estimate is null
      or p_tokens_in < 0
      or p_tokens_out < 0
      or p_duration_ms < 0
      or p_provider_cost_estimate < 0
      or p_estimate_source not in ('static_table', 'provider_response')
      or p_outcome not in (
        'success',
        'schema_fail',
        'provider_error',
        'timeout'
      ) then
      raise exception 'completed provider usage is invalid';
    end if;

    update public.ai_calls
    set tokens_in = p_tokens_in,
        tokens_out = p_tokens_out,
        duration_ms = p_duration_ms,
        provider_cost_estimate = p_provider_cost_estimate,
        estimate_source = p_estimate_source,
        outcome = p_outcome,
        lifecycle_state = 'completed'
    where id = v_ai_call.id
      and lifecycle_state = 'reserved';
    if not found then
      raise exception 'risk AI reservation changed concurrently';
    end if;
  elsif v_ai_call.lifecycle_state = 'reserved' then
    update public.ai_calls
    set outcome = 'abandoned',
        lifecycle_state = 'abandoned'
    where id = v_ai_call.id
      and lifecycle_state = 'reserved';
    if not found then
      raise exception 'risk AI reservation changed concurrently';
    end if;
  end if;

  update public.workflow_step_runs
  set status = 'failed',
      error = v_error,
      completed_at = pg_catalog.now()
  where id = v_step.id
    and status = 'running';
  if not found then
    raise exception 'risk workflow step changed concurrently';
  end if;

  if v_run.status = 'retrying' then
    update public.workflow_runs
    set status = 'failed',
        error_state = v_error
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
    pg_catalog.jsonb_build_object(
      'ai_call_id',
      v_ai_call.id,
      'provider_completed',
      p_provider_completed,
      'outcome',
      case
        when p_provider_completed then p_outcome
        else 'abandoned'
      end,
      'error',
      v_error
    )
  );
end;
$$;

revoke all on function public.close_m1_risk_ai_reservation(
  uuid, uuid, boolean, text, text, integer, integer, integer,
  numeric, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.close_m1_risk_ai_reservation(
  uuid, uuid, boolean, text, text, integer, integer, integer,
  numeric, text, text, jsonb
) to service_role;

-- A project override becomes an approved project decision only through a
-- request-bound command with an optimistic digest. Approved payloads are
-- immutable; service clients and combined value+approval writes cannot create
-- or silently rewrite human decisions.
create or replace function private.project_override_value_digest(
  p_value jsonb,
  p_standard_version_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pgcrypto_schema text;
  v_digest text;
  v_payload jsonb;
begin
  select namespace.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'standard_version_id',
      case
        when p_standard_version_id is null then null
        else p_standard_version_id::text
      end,
    'value', p_value
  );

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest('
      || 'pg_catalog.convert_to($1::text, ''UTF8''), ''sha256''), ''hex'')',
    v_pgcrypto_schema
  )
  into v_digest
  using v_payload;

  return v_digest;
end;
$$;

revoke all on function private.project_override_value_digest(jsonb, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.project_override_standard_is_valid(
  p_project_id uuid,
  p_standard_key text,
  p_standard_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_standard_version_id is null
    or exists (
      select 1
      from public.projects project
      join public.studio_standards standard
        on standard.studio_id = project.designer_id
       and standard.standard_key = p_standard_key
       and standard.id = p_standard_version_id
      where project.id = p_project_id
    );
$$;

revoke all on function private.project_override_standard_is_valid(
  uuid, text, uuid
) from public, anon, authenticated, service_role;

do $project_override_preflight$
begin
  if exists (
    select 1
    from public.project_overrides project_override
    where not private.project_override_standard_is_valid(
      project_override.project_id,
      project_override.standard_key,
      project_override.standard_version_id
    )
  ) then
    raise exception
      'existing project override has an invalid studio standard version';
  end if;
end;
$project_override_preflight$;

alter table public.project_overrides
  add column value_digest text,
  add column approved_by uuid references auth.users(id) on delete restrict,
  add column approved_at timestamptz,
  add column approval_digest text,
  add column approval_source text;

update public.project_overrides
set value_digest = private.project_override_value_digest(
  value,
  standard_version_id
);

-- Pre-governance approved rows are locked exactly as found. They remain
-- distinguishable from decisions approved by the governed command; no
-- historical approver or approval time is invented.
update public.project_overrides
set approval_digest = value_digest,
    approval_source = 'legacy_locked'
where approved is true;

alter table public.project_overrides
  alter column value_digest set not null,
  add constraint project_overrides_value_digest_format
    check (value_digest ~ '^[0-9a-f]{64}$'),
  add constraint project_overrides_approval_digest_format
    check (
      approval_digest is null
      or approval_digest ~ '^[0-9a-f]{64}$'
    ),
  add constraint project_overrides_approval_metadata
    check (
      (
        approved is false
        and approved_by is null
        and approved_at is null
        and approval_digest is null
        and approval_source is null
      )
      or (
        approved is true
        and approval_digest = value_digest
        and (
          (
            approval_source = 'human'
            and approved_by is not null
            and approved_at is not null
          )
          or (
            approval_source = 'legacy_locked'
            and approved_by is null
            and approved_at is null
          )
        )
      )
    );

create or replace function private.enforce_project_override_governance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    if old.approved
      and exists (
        select 1
        from public.projects project
        where project.id = old.project_id
      ) then
      raise exception 'approved project decisions are immutable';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.approved then
      raise exception 'project override must be approved separately';
    end if;
    if not private.project_override_standard_is_valid(
      new.project_id,
      new.standard_key,
      new.standard_version_id
    ) then
      raise exception 'project override standard version is invalid';
    end if;
    new.value_digest :=
      private.project_override_value_digest(
        new.value,
        new.standard_version_id
      );
    new.approved_by := null;
    new.approved_at := null;
    new.approval_digest := null;
    new.approval_source := null;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.standard_key is distinct from old.standard_key
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'project override identity is immutable';
  end if;

  if old.approved then
    if new is distinct from old then
      raise exception 'approved project decisions are immutable';
    end if;
    return new;
  end if;

  if not private.project_override_standard_is_valid(
    new.project_id,
    new.standard_key,
    new.standard_version_id
  ) then
    raise exception 'project override standard version is invalid';
  end if;

  if new.approved then
    if v_actor is null then
      raise exception 'authenticated human approval required';
    end if;
    if new.value is distinct from old.value
      or new.standard_version_id is distinct from old.standard_version_id
      or new.value_digest is distinct from old.value_digest then
      raise exception 'approval cannot modify the project decision payload';
    end if;
    if new.approved_by is distinct from v_actor
      or new.approved_at is null
      or new.approval_digest is distinct from old.value_digest
      or new.approval_source is distinct from 'human' then
      raise exception 'project decision approval metadata is invalid';
    end if;

    insert into public.audit_events(
      project_id,
      actor_id,
      actor_type,
      event_type,
      entity_type,
      entity_id,
      payload
    )
    values (
      new.project_id,
      v_actor,
      'human',
      'project_override_approved',
      'project_override',
      new.id,
      pg_catalog.jsonb_build_object(
        'standard_key', new.standard_key,
        'standard_version_id', new.standard_version_id,
        'value_digest', new.value_digest
      )
    );
    return new;
  end if;

  new.value_digest :=
    private.project_override_value_digest(
      new.value,
      new.standard_version_id
    );
  new.approved_by := null;
  new.approved_at := null;
  new.approval_digest := null;
  new.approval_source := null;
  return new;
end;
$$;

revoke all on function private.enforce_project_override_governance()
  from public, anon, authenticated, service_role;

drop trigger if exists project_overrides_governance
  on public.project_overrides;
create trigger project_overrides_governance
  before insert or update or delete on public.project_overrides
  for each row
  execute function private.enforce_project_override_governance();

drop policy if exists project_overrides_studio_all
  on public.project_overrides;
create policy project_overrides_studio_all
  on public.project_overrides
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.projects project
      where project.id = project_overrides.project_id
        and private.is_studio_member(project.designer_id)
    )
  )
  with check (
    approved is false
    and created_by = (select auth.uid())
    and exists (
      select 1
      from public.projects project
      where project.id = project_overrides.project_id
        and private.is_studio_member(project.designer_id)
    )
  );

revoke insert, update, delete
  on table public.project_overrides
  from authenticated;
grant insert(project_id, standard_key, value, standard_version_id, created_by)
  on table public.project_overrides
  to authenticated;
grant update(value, standard_version_id)
  on table public.project_overrides
  to authenticated;

create or replace function public.approve_project_override(
  p_project_override_id uuid,
  p_expected_value_digest text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_override public.project_overrides;
  v_designer_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_expected_value_digest is null
    or p_expected_value_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'expected project decision digest is invalid';
  end if;

  select project.designer_id
  into v_designer_id
  from public.project_overrides project_override
  join public.projects project
    on project.id = project_override.project_id
  where project_override.id = p_project_override_id
  for update of project_override, project;
  if not found then
    raise exception 'project override not found';
  end if;
  if not private.is_studio_member(v_designer_id) then
    raise exception 'project override access denied';
  end if;

  select project_override.*
  into v_override
  from public.project_overrides project_override
  where project_override.id = p_project_override_id;

  if v_override.approved then
    raise exception 'project override is already approved';
  end if;
  if v_override.value_digest is distinct from p_expected_value_digest then
    raise exception 'project override changed before approval';
  end if;
  if not private.project_override_standard_is_valid(
    v_override.project_id,
    v_override.standard_key,
    v_override.standard_version_id
  ) then
    raise exception 'project override standard version is invalid';
  end if;

  update public.project_overrides
  set approved = true,
      approved_by = v_actor,
      approved_at = pg_catalog.now(),
      approval_digest = value_digest,
      approval_source = 'human'
  where id = v_override.id
    and approved is false
    and value_digest = p_expected_value_digest;
  if not found then
    raise exception 'project override changed concurrently';
  end if;

  return v_override.id;
end;
$$;

revoke all on function public.approve_project_override(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_project_override(uuid, text)
  to authenticated;
