-- Platform foundation A1: project_facts + provenance (DEC-004, Фаза 2).
--
-- ЧТО ЭТО. Первый слой платформенного фундамента, разрешённого DEC-038
-- (`PLATFORM_FOUNDATION` → `ACTIVE_FOR_DISPOSABLE_PILOT`): нормализованный
-- реестр фактов проекта — надтип по DEC-004
-- (requirement/constraint/assumption/open_question) — с ОБЯЗАТЕЛЬНЫМ
-- провенансом (AGENTS.md: «Source provenance и exact revision обязательны
-- для extracted/interpreted facts»).
--
-- ФОРМА. Тот же свежий образец, что `impact_worker_failures`
-- (`20260813030000`): приватная схема `projectceo_platform`, RLS force +
-- revoke-all + internal-owner policy, доступ только через security definer
-- RPC в экспонируемой `projectceo_platform_api`. Append-only триггер
-- разрешает ровно один односторонний переход (активный → вытесненный,
-- побайтово неизменный остальной строки) — тот же приём, что
-- `reject_impact_run_mutation` из DEC-037.
--
-- ПРОВЕНАНС — constraint, не соглашение: `extracted`/`interpreted` обязаны
-- нести source_id (FK на `project_intelligence.sources`) и точную ревизию
-- `source_revision_id`; `human_stated` — автора высказывания и непустую
-- причину. Форма закреплена CHECK.
--
-- ИДЕМПОТЕНТНОСТЬ. Человеческая дверь идёт через command_records
-- (`projectceo_product._replay_or_null` / `_complete_command`) со
-- state_revision-гейтом — тот же контракт, что у команд M4, в
-- проект-уровневом варианте: авторизация через
-- `projectceo_foundation._authorize_project_human` (живая версия читает
-- подписанные claims, не `auth.uid()`).
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни системной двери (воркеры M2/M3/M4 получат её
-- аддитивными дверями следующих этапов), ни связей fact→room/scope
-- (AFFECTS/INFORMS из каталога — следующий этап), ни валидации ревизии
-- против реестра ревизий источника (M3 backlog №5, воркер ingest), ни UI.
-- Ни удаления фактов: append-only, исправление = новая ревизия, вытесняющая
-- старую.

begin;

-- Схемы создаются ВО ВЛАДЕНИЕ pi_table_owner (как `project_intelligence`,
-- `20260716072000`): на managed Supabase исполнитель — не superuser, и без
-- авторизации владелец-исполнитель терял право revoke на функции после
-- `alter owner` (воспроизведено на живом стенде, FIND-01 пилота).
create schema projectceo_platform authorization pi_table_owner;
create schema projectceo_platform_api authorization pi_table_owner;

revoke all on schema projectceo_platform
  from public, anon, authenticated, service_role;
revoke all on schema projectceo_platform_api
  from public, anon, service_role;
grant usage on schema projectceo_platform_api to authenticated, service_role;

-- === Реестр фактов ==========================================================

create table projectceo_platform.project_facts (
  organization_id uuid not null,
  project_id uuid not null,
  fact_id uuid not null default extensions.gen_random_uuid(),
  fact_type text not null
    check (fact_type in ('requirement', 'constraint', 'assumption', 'open_question')),
  content jsonb not null
    check (
      jsonb_typeof(content) = 'object'
      and content ->> 'title' is not null
      and char_length(btrim(content ->> 'title')) between 1 and 500
    ),
  extraction_kind text not null
    check (extraction_kind in ('extracted', 'interpreted', 'human_stated')),
  source_id text
    check (source_id is null or char_length(btrim(source_id)) between 1 and 160),
  source_revision_id text
    check (source_revision_id is null or char_length(btrim(source_revision_id)) between 1 and 160),
  stated_by uuid,
  stated_reason text
    check (stated_reason is null or char_length(btrim(stated_reason)) between 1 and 2000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid,
  primary key (organization_id, project_id, fact_id),
  constraint project_facts_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id),
  constraint project_facts_source_fkey
    foreign key (organization_id, project_id, source_id)
    references project_intelligence.sources (organization_id, project_id, source_id),
  constraint project_facts_superseded_by_fkey
    foreign key (organization_id, project_id, superseded_by)
    references projectceo_platform.project_facts (organization_id, project_id, fact_id),
  constraint project_facts_provenance_check check (
    (
      extraction_kind in ('extracted', 'interpreted')
      and source_id is not null
      and source_revision_id is not null
      and stated_by is null
    )
    or (
      extraction_kind = 'human_stated'
      and source_id is null
      and source_revision_id is null
      and stated_by is not null
      and stated_reason is not null
    )
  ),
  constraint project_facts_supersede_shape_check check (
    (superseded_at is null and superseded_by is null)
    or (superseded_at is not null and superseded_by is not null)
  )
);

create index project_facts_active_by_project_idx
  on projectceo_platform.project_facts (organization_id, project_id, fact_type)
  where superseded_at is null;

-- === Append-only: ровно один односторонний переход ==========================

create function projectceo_platform.reject_project_fact_mutation()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'PROJECTCEO_PLATFORM_FACT_IMMUTABLE';
  end if;
  -- Единственный санкционированный переход: активный → вытесненный, весь
  -- остальной состав строки побайтово неизменен (тот же приём, что
  -- `reject_impact_run_mutation` из DEC-037).
  if to_jsonb(new) - 'superseded_at' - 'superseded_by'
     = to_jsonb(old) - 'superseded_at' - 'superseded_by'
    and old.superseded_at is null
    and old.superseded_by is null
    and new.superseded_at is not null
    and new.superseded_by is not null then
    return new;
  end if;
  raise exception using
    errcode = '55000',
    message = 'PROJECTCEO_PLATFORM_FACT_IMMUTABLE';
end
$function$;

create trigger projectceo_platform_facts_append_only
  before update or delete on projectceo_platform.project_facts
  for each row execute function projectceo_platform.reject_project_fact_mutation();

-- === RLS: свежая форма (force + revoke + internal-owner) ====================

alter table projectceo_platform.project_facts enable row level security;
-- `force row level security` действует и на владельца: без явной политики
-- pi_table_owner не прочитает ни одну строку напрямую.
alter table projectceo_platform.project_facts force row level security;
revoke all on table projectceo_platform.project_facts
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
-- Таблица тоже переходит внутреннему владельцу: security definer RPC
-- исполняется от pi_table_owner, а RLS-политика не заменяет табличных
-- грантов (воспроизведено на живом стенде: без этого — 42501 на INSERT).
alter table projectceo_platform.project_facts owner to pi_table_owner;

create policy project_facts_internal_owner
  on projectceo_platform.project_facts
  for all to pi_table_owner using (true) with check (true);

-- === Проект-уровневый контекст команды ======================================

create function projectceo_platform._human_command_context(
  p_project_id uuid,
  p_capability text,
  p_operation text,
  p_expected_state_revision bigint,
  p_idempotency_key text,
  p_request_payload jsonb
)
returns table (
  organization_id uuid,
  actor_user_id uuid,
  actor_id text,
  state_revision bigint,
  key_digest bytea,
  request_digest bytea,
  replay jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  select distinct
    context.organization_id,
    context.actor_user_id,
    context.actor_id
  into organization_id, actor_user_id, actor_id
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    p_capability
  ) context;

  perform projectceo_foundation._assert_state_revision(
    p_expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(
    p_idempotency_key
  );

  key_digest := project_intelligence._sha256_text(
    btrim(p_idempotency_key)
  );
  request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'expectedStateRevision', p_expected_state_revision,
      'operation', p_operation,
      'payload', p_request_payload,
      'projectId', p_project_id
    )
  );

  select pw.state_revision into state_revision
  from project_intelligence.project_workflows pw
  where pw.project_id = p_project_id
  for update;

  replay := projectceo_product._replay_or_null(
    organization_id,
    p_project_id,
    p_operation,
    key_digest,
    request_digest
  );
  if replay is null and state_revision <> p_expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', state_revision)
    );
  end if;
  return next;
end
$function$;

alter function projectceo_platform._human_command_context(
  uuid, text, text, bigint, text, jsonb
) owner to pi_table_owner;
revoke all on function projectceo_platform._human_command_context(
  uuid, text, text, bigint, text, jsonb
) from public, anon, authenticated, service_role,
     pi_human_executor, pi_worker_executor;

-- === Дверь записи: создать факт (опционально вытеснив старый) ===============

create function projectceo_platform_api.create_project_fact(
  p_project_id uuid,
  p_fact_type text,
  p_content jsonb,
  p_extraction_kind text,
  p_source_id text default null,
  p_source_revision_id text default null,
  p_stated_reason text default null,
  p_supersedes_fact_id uuid default null,
  p_expected_state_revision bigint default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_fact_id uuid := extensions.gen_random_uuid();
  v_stated_by uuid;
  v_source_id text;
  v_source_revision_id text;
  v_result jsonb;
begin
  if p_fact_type is null or p_fact_type not in
    ('requirement', 'constraint', 'assumption', 'open_question') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"factType"}'::jsonb
    );
  end if;
  if p_extraction_kind is null or p_extraction_kind not in
    ('extracted', 'interpreted', 'human_stated') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"extractionKind"}'::jsonb
    );
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object'
    or btrim(coalesce(p_content ->> 'title', '')) = '' then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"content.title"}'::jsonb
    );
  end if;

  -- Провенанс до контекста: отказ валидации дешевле отката транзакции.
  if p_extraction_kind in ('extracted', 'interpreted') then
    if p_source_id is null or btrim(p_source_id) = ''
      or p_source_revision_id is null or btrim(p_source_revision_id) = '' then
      perform projectceo_product._raise(
        'P1111',
        'validation_failed',
        '{"reason":"PROVENANCE_SOURCE_REVISION_REQUIRED"}'::jsonb
      );
    end if;
    v_source_id := btrim(p_source_id);
    v_source_revision_id := btrim(p_source_revision_id);
  elsif p_extraction_kind = 'human_stated' then
    if p_stated_reason is null or btrim(p_stated_reason) = '' then
      perform projectceo_product._raise(
        'P1111',
        'validation_failed',
        '{"reason":"PROVENANCE_STATED_REASON_REQUIRED"}'::jsonb
      );
    end if;
  end if;

  select * into v_context
  from projectceo_platform._human_command_context(
    p_project_id,
    'review_source',
    'create_project_fact',
    p_expected_state_revision,
    p_idempotency_key,
    jsonb_build_object(
      'content', p_content,
      'extractionKind', p_extraction_kind,
      'factType', p_fact_type,
      'sourceId', v_source_id,
      'sourceRevisionId', v_source_revision_id,
      'supersedesFactId', p_supersedes_fact_id
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;

  if p_extraction_kind = 'human_stated' then
    v_stated_by := v_context.actor_user_id;
  end if;

  -- Источник обязан существовать в этом проекте: FK поймал бы и так, но
  -- контролируемый отказ лучше голого 23503.
  if v_source_id is not null then
    perform 1
    from project_intelligence.sources s
    where s.organization_id = v_context.organization_id
      and s.project_id = p_project_id
      and s.source_id = v_source_id;
    if not found then
      perform projectceo_product._raise(
        'P1104', 'not_found', '{"entity":"source"}'::jsonb
      );
    end if;
  end if;

  -- Вытеснение: цель обязана существовать, быть активной и в этом проекте.
  if p_supersedes_fact_id is not null then
    perform 1
    from projectceo_platform.project_facts f
    where f.organization_id = v_context.organization_id
      and f.project_id = p_project_id
      and f.fact_id = p_supersedes_fact_id
      and f.superseded_at is null;
    if not found then
      perform projectceo_product._raise(
        'P1104',
        'not_found',
        '{"entity":"activeFactToSupersede"}'::jsonb
      );
    end if;
  end if;

  insert into projectceo_platform.project_facts (
    organization_id, project_id, fact_id,
    fact_type, content, extraction_kind,
    source_id, source_revision_id,
    stated_by, stated_reason,
    created_by
  ) values (
    v_context.organization_id, p_project_id, v_fact_id,
    p_fact_type, p_content, p_extraction_kind,
    v_source_id, v_source_revision_id,
    v_stated_by, p_stated_reason,
    v_context.actor_user_id
  );

  if p_supersedes_fact_id is not null then
    -- Единственный санкционированный переход append-only триггера.
    update projectceo_platform.project_facts f
    set superseded_at = now(),
        superseded_by = v_fact_id
    where f.organization_id = v_context.organization_id
      and f.project_id = p_project_id
      and f.fact_id = p_supersedes_fact_id;
  end if;

  v_result := jsonb_build_object(
    'factId', v_fact_id,
    'factType', p_fact_type,
    'extractionKind', p_extraction_kind,
    'supersededFactId', p_supersedes_fact_id
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    p_project_id,
    'create_project_fact',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'project_fact_created',
    jsonb_build_object(
      'fact_id', v_fact_id,
      'fact_type', p_fact_type,
      'superseded_fact_id', p_supersedes_fact_id
    ),
    v_context.state_revision
  );
end
$function$;

alter function projectceo_platform_api.create_project_fact(
  uuid, text, jsonb, text, text, text, text, uuid, bigint, text
) owner to pi_table_owner;
revoke all on function projectceo_platform_api.create_project_fact(
  uuid, text, jsonb, text, text, text, text, uuid, bigint, text
) from public, anon, service_role, pi_human_executor, pi_worker_executor;

grant execute on function projectceo_platform_api.create_project_fact(
  uuid, text, jsonb, text, text, text, text, uuid, bigint, text
) to authenticated;

-- === Дверь чтения: реестр фактов проекта ====================================

create function projectceo_platform_api.list_project_facts(
  p_project_id uuid,
  p_include_superseded boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_data jsonb;
begin
  select context.organization_id into v_organization_id
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    'view_project'
  ) context;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'factId', f.fact_id,
        'factType', f.fact_type,
        'content', f.content,
        'extractionKind', f.extraction_kind,
        'sourceId', f.source_id,
        'sourceRevisionId', f.source_revision_id,
        'statedReason', f.stated_reason,
        'createdAt', f.created_at,
        'supersededAt', f.superseded_at,
        'supersededBy', f.superseded_by
      ) order by f.created_at, f.fact_id
    ),
    '[]'::jsonb
  ) into v_data
  from projectceo_platform.project_facts f
  where f.organization_id = v_organization_id
    and f.project_id = p_project_id
    and (p_include_superseded or f.superseded_at is null);

  return jsonb_build_object('facts', v_data);
end
$function$;

alter function projectceo_platform_api.list_project_facts(uuid, boolean)
  owner to pi_table_owner;
revoke all on function projectceo_platform_api.list_project_facts(uuid, boolean)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;

grant execute on function projectceo_platform_api.list_project_facts(uuid, boolean)
  to authenticated;



-- Командная дверь реестра фактов входит в реестр операций command_records
-- (аддитивное расширение CHECK — тот же приём, что 20260802030000 для M2).
alter table projectceo_product.command_records
  drop constraint command_records_operation_check;
alter table projectceo_product.audit_events
  drop constraint audit_events_event_type_check;
alter table projectceo_product.audit_events
  add constraint audit_events_event_type_check
  check (event_type = ANY (ARRAY[
    'decision_revision_appended'::text,
    'selection_revision_appended'::text,
    'price_observation_appended'::text,
    'approval_package_created'::text,
    'approval_package_submitted'::text,
    'approval_package_reviewed'::text,
    'project_baseline_published'::text,
    'production_package_version_published'::text,
    'release_artifact_built'::text,
    'release_distributed'::text,
    'release_acknowledged'::text,
    'no_change_approved'::text,
    'change_request_submitted'::text,
    'change_impact_calculated'::text,
    'change_impact_reviewed'::text,
    'milestone_defined'::text,
    'photo_evidence_registered'::text,
    'photo_evidence_reviewed'::text,
    'milestone_accepted'::text,
    'handover_document_registered'::text,
    'construction_handover_built'::text,
    'm2_room_revision_appended'::text,
    'm2_variant_revision_appended'::text,
    'm2_material_revision_appended'::text,
    'm2_budget_revision_appended'::text,
    'm2_client_handoff_revision_appended'::text,
    'm2_approved_commit_revision_appended'::text,
    'm2_layout_version_revision_appended'::text,
    'm2_client_review_submitted'::text,
    'm2_client_submission_reviewed'::text,
    'm2_m3_handoff_published'::text,
    'm3_documentation_sheet_registered'::text,
    'm3_documentation_sheet_specifications_attached'::text,
    'change_impact_truncation_acknowledged'::text,
    'project_fact_created'::text
  ]));

alter table projectceo_product.command_records
  add constraint command_records_operation_check
  CHECK ((operation = ANY (ARRAY['append_decision_revision'::text, 'append_selection_revision'::text, 'append_price_observation'::text, 'append_system_decision_revision'::text, 'append_system_selection_revision'::text, 'create_approval_package'::text, 'submit_approval_package'::text, 'review_approval_package'::text, 'publish_project_baseline'::text, 'publish_production_package_version'::text, 'build_release_artifact'::text, 'distribute_release'::text, 'distribute_release_request_bound'::text, 'acknowledge_release'::text, 'acknowledge_release_request_bound'::text, 'approve_no_change'::text, 'submit_change_request'::text, 'calculate_change_impact'::text, 'review_change_impact'::text, 'define_milestone'::text, 'register_photo_evidence'::text, 'review_photo_evidence'::text, 'accept_milestone'::text, 'register_handover_document'::text, 'build_construction_handover'::text, 'append_m2_room_revision'::text, 'append_m2_variant_revision'::text, 'append_m2_material_revision'::text, 'append_m2_budget_revision'::text, 'append_m2_client_handoff_revision'::text, 'append_m2_approved_commit_revision'::text, 'append_m2_layout_version_revision'::text, 'submit_m2_client_review'::text, 'review_m2_client_submission'::text, 'publish_m2_m3_handoff'::text, 'register_m3_documentation_sheet'::text, 'attach_m3_documentation_sheet_specifications'::text, 'acknowledge_impact_truncation'::text, 'create_project_fact'::text])));

-- === Guard: форма и границы =================================================

do $guard$
declare
  v_policies integer;
  v_forced boolean;
begin
  -- RLS принудителен и политик, кроме internal-owner, нет.
  select relrowsecurity and relforcerowsecurity into v_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'projectceo_platform' and c.relname = 'project_facts';
  if v_forced is not true then
    raise exception 'PROJECTCEO_PLATFORM_FACTS_RLS_NOT_FORCED';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'projectceo_platform'
    and tablename = 'project_facts';
  if v_policies <> 1 then
    raise exception 'PROJECTCEO_PLATFORM_FACTS_POLICY_COUNT_INVALID:%', v_policies;
  end if;

  -- anon не может исполнить ни одну дверь.
  if has_function_privilege(
    'anon',
    'projectceo_platform_api.create_project_fact(uuid,text,jsonb,text,text,text,text,uuid,bigint,text)',
    'execute'
  ) then
    raise exception 'PROJECTCEO_PLATFORM_CREATE_REACHABLE_BY_ANON';
  end if;
  if has_function_privilege(
    'anon',
    'projectceo_platform_api.list_project_facts(uuid,boolean)',
    'execute'
  ) then
    raise exception 'PROJECTCEO_PLATFORM_LIST_REACHABLE_BY_ANON';
  end if;
end
$guard$;

commit;
