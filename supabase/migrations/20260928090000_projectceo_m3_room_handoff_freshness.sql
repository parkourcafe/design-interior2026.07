-- DEC-041 §4 (OWNER DECISION 27.09.2026): передача M2→M3 по комнатам с
-- точными ревизиями.
--
-- До этой миграции (20260925100000) baseline принимал одну передачу на пакет,
-- устаревание проверялось только по номеру ревизии самой передачи, а из
-- содержимого передачи сверялось лишь решение (designIntentRevisionId).
--
-- Теперь:
--   * ПРИМЕНИМАЯ КОМНАТА — roomId, у которого в пакете есть утверждённый
--     клиентом дизайн (ревизия approved_commit). Каждая применимая комната
--     входит в baseline по своей передаче; каждый пакет baseline — хотя бы с
--     одной передачей (правило DEC-042 (4) сохраняется).
--   * Передача комнаты свежая, только если:
--       - это последняя опубликованная передача комнаты в пакете
--         (M2_HANDOFF_STALE);
--       - у комнаты нет более нового утверждённого дизайна, чем в передаче
--         (M2_HANDOFF_COMMIT_SUPERSEDED);
--       - решение и каждая selection передачи (selection несёт материал и
--         спецификацию) — текущие утверждённые ревизии своих сущностей по
--         тому же правилу «победителя», по которому baseline их замораживает
--         (M2_HANDOFF_DECISION_SUPERSEDED / M2_HANDOFF_SELECTION_SUPERSEDED,
--         неутверждённые — M2_HANDOFF_*_NOT_APPROVED).
--     Черновики и неутверждённые ревизии передачу не делают устаревшей: их
--     нет среди одобренных approval packages.
--   * После публикации решение и все selection передачи обязаны быть ровно
--     теми ревизиями, что заморожены в baseline (M2_HANDOFF_NOT_IN_BASELINE).
--   * Точные идентификаторы (комната, передача, approved commit, решение,
--     selection) пишутся в append-only baseline_room_handoff_refs. Это и есть
--     аудит привязки: дверь baseline по своему устройству пишет только
--     replay-запись (command_records), события пишут внутренние операции.
--   * Выпуск (триггер на production_package_versions) пересчитывает свежесть
--     каждой комнаты baseline заново: более новая утверждённая ревизия,
--     появившаяся после baseline, блокирует выпуск
--     (M2_HANDOFF_STALE_AT_RELEASE). Baseline без комнатных ссылок выпуск не
--     проходит.
--
-- Сигнатура publish_baseline_atomic не меняется (регистр модуля M3 прежний),
-- меняется форма ссылок: [{packageId, roomId, handoffId, handoffRevisionId}].
-- Таблица baseline_handoff_refs остаётся в истории и больше не пишется.

begin;
set local check_function_bodies = on;

create table projectceo_product.baseline_room_handoff_refs (
  organization_id uuid not null,
  project_id uuid not null,
  baseline_id text not null,
  package_id uuid not null,
  room_id text not null check (char_length(room_id) between 1 and 160),
  handoff_id text not null,
  handoff_revision_id text not null,
  handoff_kind text not null default 'm2_m3_handoff'
    check (handoff_kind = 'm2_m3_handoff'),
  approved_commit_revision_id text not null,
  decision_revision_id text not null,
  selection_revision_ids text[] not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, baseline_id, package_id, room_id),
  constraint baseline_room_handoff_refs_baseline_package_fkey
    foreign key (organization_id, project_id, baseline_id, package_id)
    references projectceo_product.project_baseline_packages
      (organization_id, project_id, baseline_id, package_id)
    on delete restrict,
  constraint baseline_room_handoff_refs_handoff_fkey
    foreign key (organization_id, project_id, handoff_kind, handoff_id, handoff_revision_id)
    references projectceo_product.m2_workspace_revisions
      (organization_id, project_id, entity_kind, entity_id, revision_id)
    on delete restrict
);

create index baseline_room_handoff_refs_handoff_idx
  on projectceo_product.baseline_room_handoff_refs
    (organization_id, project_id, handoff_kind, handoff_id, handoff_revision_id);

create trigger baseline_room_handoff_refs_append_only
before update or delete on projectceo_product.baseline_room_handoff_refs
for each row execute function projectceo_product.reject_append_only_mutation();

alter table projectceo_product.baseline_room_handoff_refs owner to pi_table_owner;
alter table projectceo_product.baseline_room_handoff_refs enable row level security;
alter table projectceo_product.baseline_room_handoff_refs force row level security;
revoke all on table projectceo_product.baseline_room_handoff_refs
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy baseline_room_handoff_refs_internal_owner
  on projectceo_product.baseline_room_handoff_refs
  for all to pi_table_owner using (true) with check (true);

-- Текущая утверждённая ревизия той же сущности, что и p_revision_id: правило
-- «победителя» _publish_baseline_atomic_unchecked — последний по created_at
-- (тай-брейк — id) одобренный approval package активного пакета.
-- null — ревизия не входит ни в один одобренный approval package.
create function projectceo_product._current_approved_revision(
  p_organization_id uuid,
  p_project_id uuid,
  p_target_kind text,
  p_revision_id text
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  with approved as (
    select ap.approval_package_id, ap.created_at
    from projectceo_product.approval_packages ap
    join projectceo_foundation.project_packages package
      on package.organization_id = ap.organization_id
     and package.project_id = ap.project_id
     and package.id = ap.package_id
     and package.status = 'active'
    join lateral (
      select event.to_status
      from projectceo_product.approval_package_events event
      where event.organization_id = ap.organization_id
        and event.project_id = ap.project_id
        and event.approval_package_id = ap.approval_package_id
      order by event.sequence_no desc
      limit 1
    ) current_event on true
    where ap.organization_id = p_organization_id
      and ap.project_id = p_project_id
      and current_event.to_status = 'approved'
  ),
  entity as (
    select distinct item.entity_id
    from projectceo_product.approval_package_items item
    join approved on approved.approval_package_id = item.approval_package_id
    where item.organization_id = p_organization_id
      and item.project_id = p_project_id
      and item.target_kind = p_target_kind
      and item.revision_id = p_revision_id
  )
  select item.revision_id
  from projectceo_product.approval_package_items item
  join approved on approved.approval_package_id = item.approval_package_id
  join entity on entity.entity_id = item.entity_id
  where item.organization_id = p_organization_id
    and item.project_id = p_project_id
    and item.target_kind = p_target_kind
  order by approved.created_at desc, approved.approval_package_id collate "C" desc
  limit 1
$function$;

-- Причина, по которой передача комнаты не свежая, или null.
create function projectceo_product._room_handoff_problem(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid,
  p_handoff projectceo_product.m2_workspace_revisions
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_room text := p_handoff.payload->>'roomId';
  v_latest_handoff text;
  v_latest_commit text;
  v_current text;
  v_selection text;
begin
  select revision.revision_id into v_latest_handoff
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = p_organization_id
    and revision.project_id = p_project_id
    and revision.package_id = p_package_id
    and revision.entity_kind = 'm2_m3_handoff'
    and revision.status = 'published'
    and revision.payload->>'roomId' = v_room
  order by revision.created_at desc, revision.revision_no desc,
    revision.revision_id collate "C" desc
  limit 1;
  if v_latest_handoff is distinct from p_handoff.revision_id then
    return 'M2_HANDOFF_STALE';
  end if;

  select revision.revision_id into v_latest_commit
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = p_organization_id
    and revision.project_id = p_project_id
    and revision.package_id = p_package_id
    and revision.entity_kind = 'approved_commit'
    and revision.status = 'approved'
    and revision.payload->>'roomId' = v_room
  order by revision.created_at desc, revision.revision_no desc,
    revision.revision_id collate "C" desc
  limit 1;
  if v_latest_commit is not null
     and v_latest_commit is distinct from p_handoff.payload->>'approvedCommitRevisionId' then
    return 'M2_HANDOFF_COMMIT_SUPERSEDED';
  end if;

  v_current := projectceo_product._current_approved_revision(
    p_organization_id, p_project_id, 'decision_revision',
    p_handoff.payload->>'designIntentRevisionId'
  );
  if v_current is null then
    return 'M2_HANDOFF_DECISION_NOT_APPROVED';
  elsif v_current is distinct from p_handoff.payload->>'designIntentRevisionId' then
    return 'M2_HANDOFF_DECISION_SUPERSEDED';
  end if;

  if jsonb_typeof(p_handoff.payload->'selectionRevisionIds') is distinct from 'array' then
    return 'M2_HANDOFF_INCOMPLETE';
  end if;
  for v_selection in
    select value from jsonb_array_elements_text(p_handoff.payload->'selectionRevisionIds')
  loop
    v_current := projectceo_product._current_approved_revision(
      p_organization_id, p_project_id, 'selection_revision', v_selection
    );
    if v_current is null then
      return 'M2_HANDOFF_SELECTION_NOT_APPROVED';
    elsif v_current is distinct from v_selection then
      return 'M2_HANDOFF_SELECTION_SUPERSEDED';
    end if;
  end loop;
  return null;
end
$function$;

-- Применимые комнаты пакета: комнаты с утверждённым клиентом дизайном.
create function projectceo_product._package_applicable_rooms(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid
)
returns setof text
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct revision.payload->>'roomId'
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = p_organization_id
    and revision.project_id = p_project_id
    and revision.package_id = p_package_id
    and revision.entity_kind = 'approved_commit'
    and revision.status = 'approved'
    and revision.payload->>'roomId' is not null
$function$;

create or replace function projectceo_product_api.publish_baseline_atomic(
  project_id uuid,
  expected_latest_version_id text,
  previous_baseline_id text,
  handoff_refs jsonb,
  expected_state_revision bigint,
  command_ref text,
  idempotency_key text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_ref jsonb;
  v_package_id uuid;
  v_room text;
  v_handoff projectceo_product.m2_workspace_revisions;
  v_problem text;
  v_refs jsonb := '[]'::jsonb;
  v_result jsonb;
  v_baseline_id text;
  v_existing jsonb;
  v_missing jsonb;
begin
  select context.organization_id, context.actor_user_id, context.actor_id
    into v_context
  from projectceo_foundation._authorize_project_human(
    project_id, 'publish_baseline'
  ) context;

  if not exists (
    select 1
    from projectceo_product.approval_packages approval
    join projectceo_foundation.project_packages package
      on package.organization_id = approval.organization_id
     and package.project_id = approval.project_id
     and package.id = approval.package_id
     and package.status = 'active'
    join lateral (
      select event.to_status
      from projectceo_product.approval_package_events event
      where event.organization_id = approval.organization_id
        and event.project_id = approval.project_id
        and event.approval_package_id = approval.approval_package_id
      order by event.sequence_no desc
      limit 1
    ) current_event on true
    where approval.organization_id = v_context.organization_id
      and approval.project_id = project_id
      and current_event.to_status = 'approved'
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"APPROVED_SNAPSHOT_REQUIRED"}'::jsonb
    );
  end if;

  -- Форма ссылок: одна ссылка на (пакет, комнату).
  v_baseline_id := 'baseline:' || btrim(coalesce(command_ref, ''));
  if handoff_refs is null
     or jsonb_typeof(handoff_refs) <> 'array'
     or jsonb_array_length(handoff_refs) not between 1 and 500 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_REQUIRED"}'::jsonb
    );
  end if;
  for v_ref in select value from jsonb_array_elements(handoff_refs) loop
    if jsonb_typeof(v_ref) is distinct from 'object'
       or jsonb_typeof(v_ref->'packageId') is distinct from 'string'
       or jsonb_typeof(v_ref->'roomId') is distinct from 'string'
       or jsonb_typeof(v_ref->'handoffId') is distinct from 'string'
       or jsonb_typeof(v_ref->'handoffRevisionId') is distinct from 'string'
       or char_length(v_ref->>'roomId') not between 1 and 160 then
      perform projectceo_product._raise(
        'P1111', 'validation_failed', '{"field":"handoffRefs"}'::jsonb
      );
    end if;
    begin
      v_package_id := (v_ref->>'packageId')::uuid;
    exception when invalid_text_representation then
      perform projectceo_product._raise(
        'P1111', 'validation_failed', '{"field":"handoffRefs.packageId"}'::jsonb
      );
    end;
    if v_refs @> jsonb_build_array(jsonb_build_object(
      'packageId', v_package_id::text, 'roomId', v_ref->>'roomId'
    )) then
      perform projectceo_product._raise(
        'P1111', 'validation_failed', '{"field":"handoffRefs.duplicateRoom"}'::jsonb
      );
    end if;
    v_refs := v_refs || jsonb_build_array(jsonb_build_object(
      'packageId', v_package_id::text,
      'roomId', v_ref->>'roomId',
      'handoffId', v_ref->>'handoffId',
      'handoffRevisionId', v_ref->>'handoffRevisionId'
    ));
  end loop;

  -- Точный replay: тот же baseline с теми же ссылками возвращает прежний
  -- результат, с другими ссылками — P1110.
  select coalesce(jsonb_agg(jsonb_build_object(
      'packageId', r.package_id::text,
      'roomId', r.room_id,
      'handoffId', r.handoff_id,
      'handoffRevisionId', r.handoff_revision_id
    ) order by r.package_id, r.room_id collate "C"), '[]'::jsonb)
    into v_existing
  from projectceo_product.baseline_room_handoff_refs r
  where r.organization_id = v_context.organization_id
    and r.project_id = project_id
    and r.baseline_id = v_baseline_id;
  if jsonb_array_length(v_existing) > 0 then
    if v_existing is distinct from (
      select jsonb_agg(ref order by (ref->>'packageId')::uuid, ref->>'roomId' collate "C")
      from jsonb_array_elements(v_refs) ref
    ) then
      perform projectceo_product._raise(
        'P1110', 'idempotency_conflict', '{"reason":"HANDOFF_REFS_CHANGED"}'::jsonb
      );
    end if;
    return projectceo_product._publish_baseline_atomic_unchecked(
      project_id, expected_latest_version_id, previous_baseline_id,
      expected_state_revision, command_ref, idempotency_key
    );
  end if;

  -- Первый вызов: каждая ссылка — опубликованная передача своей комнаты,
  -- и она свежая.
  v_refs := '[]'::jsonb;
  for v_ref in select value from jsonb_array_elements(handoff_refs) loop
    v_package_id := (v_ref->>'packageId')::uuid;
    v_room := v_ref->>'roomId';
    v_handoff := projectceo_m3._require_published_handoff(
      v_context.organization_id, project_id, v_package_id,
      v_ref->>'handoffId', v_ref->>'handoffRevisionId'
    );
    if v_handoff.payload->>'roomId' is distinct from v_room then
      perform projectceo_product._raise(
        'P1111', 'validation_failed', '{"field":"handoffRefs.roomId"}'::jsonb
      );
    end if;
    v_problem := projectceo_product._room_handoff_problem(
      v_context.organization_id, project_id, v_package_id, v_handoff
    );
    if v_problem is not null then
      perform projectceo_product._raise(
        'P1109', 'scope_conflict',
        jsonb_build_object('reason', v_problem, 'roomId', v_room)
      );
    end if;
    v_refs := v_refs || jsonb_build_array(jsonb_build_object(
      'packageId', v_package_id::text,
      'roomId', v_room,
      'handoffId', v_handoff.entity_id,
      'handoffRevisionId', v_handoff.revision_id,
      'approvedCommitRevisionId', v_handoff.payload->>'approvedCommitRevisionId',
      'designIntentRevisionId', v_handoff.payload->>'designIntentRevisionId',
      'selectionRevisionIds', v_handoff.payload->'selectionRevisionIds'
    ));
  end loop;

  v_result := projectceo_product._publish_baseline_atomic_unchecked(
    project_id, expected_latest_version_id, previous_baseline_id,
    expected_state_revision, command_ref, idempotency_key
  );
  -- Replay команды, выполненной до этой миграции: комнатных ссылок у такого
  -- baseline нет, задним числом они не пришиваются.
  if coalesce((v_result->>'replay')::boolean, false) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_REQUIRED"}'::jsonb
    );
  end if;

  -- Каждый пакет baseline — хотя бы с одной передачей; ссылка — только на
  -- пакет baseline.
  if exists (
    select 1
    from projectceo_product.project_baseline_packages bp
    where bp.organization_id = v_context.organization_id
      and bp.project_id = project_id
      and bp.baseline_id = v_baseline_id
      and not v_refs @> jsonb_build_array(jsonb_build_object('packageId', bp.package_id::text))
  ) or exists (
    select 1
    from jsonb_array_elements(v_refs) ref
    where not exists (
      select 1 from projectceo_product.project_baseline_packages bp
      where bp.organization_id = v_context.organization_id
        and bp.project_id = project_id
        and bp.baseline_id = v_baseline_id
        and bp.package_id = (ref->>'packageId')::uuid
    )
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_REQUIRED"}'::jsonb
    );
  end if;

  -- Каждая применимая комната каждого пакета baseline — со своей передачей.
  select jsonb_agg(jsonb_build_object('packageId', bp.package_id::text, 'roomId', room.room_id)
      order by bp.package_id, room.room_id collate "C")
    into v_missing
  from projectceo_product.project_baseline_packages bp
  cross join lateral projectceo_product._package_applicable_rooms(
    v_context.organization_id, project_id, bp.package_id
  ) room(room_id)
  where bp.organization_id = v_context.organization_id
    and bp.project_id = project_id
    and bp.baseline_id = v_baseline_id
    and not v_refs @> jsonb_build_array(jsonb_build_object(
      'packageId', bp.package_id::text, 'roomId', room.room_id
    ));
  if v_missing is not null then
    perform projectceo_product._raise(
      'P1111', 'validation_failed',
      jsonb_build_object('reason', 'M2_HANDOFF_REQUIRED', 'missingRooms', v_missing)
    );
  end if;

  -- Точное совпадение: решение и все selection передачи заморожены в
  -- baseline именно этими ревизиями.
  if exists (
    select 1
    from jsonb_array_elements(v_refs) ref
    where not exists (
      select 1 from projectceo_product.project_baseline_refs br
      where br.organization_id = v_context.organization_id
        and br.project_id = project_id
        and br.baseline_id = v_baseline_id
        and br.target_kind = 'decision_revision'
        and br.revision_id = ref->>'designIntentRevisionId'
    )
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed',
      '{"reason":"M2_HANDOFF_NOT_IN_BASELINE","field":"designIntentRevisionId"}'::jsonb
    );
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_refs) ref
    cross join lateral jsonb_array_elements_text(ref->'selectionRevisionIds') selection(revision_id)
    where not exists (
      select 1 from projectceo_product.project_baseline_refs br
      where br.organization_id = v_context.organization_id
        and br.project_id = project_id
        and br.baseline_id = v_baseline_id
        and br.target_kind = 'selection_revision'
        and br.revision_id = selection.revision_id
    )
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed',
      '{"reason":"M2_HANDOFF_NOT_IN_BASELINE","field":"selectionRevisionIds"}'::jsonb
    );
  end if;

  insert into projectceo_product.baseline_room_handoff_refs (
    organization_id, project_id, baseline_id, package_id, room_id,
    handoff_id, handoff_revision_id, approved_commit_revision_id,
    decision_revision_id, selection_revision_ids
  )
  select v_context.organization_id, project_id, v_baseline_id,
    (ref->>'packageId')::uuid, ref->>'roomId',
    ref->>'handoffId', ref->>'handoffRevisionId',
    ref->>'approvedCommitRevisionId', ref->>'designIntentRevisionId',
    coalesce(array(select jsonb_array_elements_text(ref->'selectionRevisionIds')), '{}')
  from jsonb_array_elements(v_refs) ref;

  return v_result;
end
$function$;

-- Выпуск: свежесть каждой комнаты baseline проверяется заново.
create or replace function projectceo_product._guard_release_requires_handoff()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_ref record;
  v_handoff projectceo_product.m2_workspace_revisions;
  v_problem text;
begin
  if current_user <> 'pi_table_owner' then
    return new;
  end if;
  if not exists (
    select 1 from projectceo_product.baseline_room_handoff_refs r
    where r.organization_id = new.organization_id
      and r.project_id = new.project_id
      and r.baseline_id = new.baseline_id
      and r.package_id = new.package_id
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_REQUIRED"}'::jsonb
    );
  end if;
  for v_ref in
    select r.room_id, r.handoff_id, r.handoff_revision_id
    from projectceo_product.baseline_room_handoff_refs r
    where r.organization_id = new.organization_id
      and r.project_id = new.project_id
      and r.baseline_id = new.baseline_id
      and r.package_id = new.package_id
    order by r.room_id collate "C"
  loop
    select * into v_handoff
    from projectceo_product.m2_workspace_revisions revision
    where revision.organization_id = new.organization_id
      and revision.project_id = new.project_id
      and revision.entity_kind = 'm2_m3_handoff'
      and revision.entity_id = v_ref.handoff_id
      and revision.revision_id = v_ref.handoff_revision_id;
    v_problem := projectceo_product._room_handoff_problem(
      new.organization_id, new.project_id, new.package_id, v_handoff
    );
    if v_problem is not null then
      perform projectceo_product._raise(
        'P1109', 'scope_conflict',
        jsonb_build_object('reason', 'M2_HANDOFF_STALE_AT_RELEASE',
                           'cause', v_problem, 'roomId', v_ref.room_id)
      );
    end if;
  end loop;
  return new;
end
$function$;

alter function projectceo_product._current_approved_revision(uuid, uuid, text, text)
  owner to pi_table_owner;
alter function projectceo_product._room_handoff_problem(
  uuid, uuid, uuid, projectceo_product.m2_workspace_revisions
) owner to pi_table_owner;
alter function projectceo_product._package_applicable_rooms(uuid, uuid, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_product._current_approved_revision(uuid, uuid, text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_product._room_handoff_problem(
  uuid, uuid, uuid, projectceo_product.m2_workspace_revisions
) from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_product._package_applicable_rooms(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

do $guard$
begin
  if pg_catalog.has_table_privilege(
    'authenticated', 'projectceo_product.baseline_room_handoff_refs', 'select'
  ) then
    raise exception 'ROOM_HANDOFF_REFS_READABLE_BY_AUTHENTICATED';
  end if;
  -- create or replace сохраняет владельца и ACL двери: её по-прежнему
  -- открывает только выключатель M3.
  if (select proowner::regrole::text from pg_catalog.pg_proc
      where oid = 'projectceo_product_api.publish_baseline_atomic(uuid,text,text,jsonb,bigint,text,text)'::regprocedure)
     <> 'pi_table_owner' then
    raise exception 'ROOM_HANDOFF_BASELINE_DOOR_OWNER_CHANGED';
  end if;
end
$guard$;

commit;
