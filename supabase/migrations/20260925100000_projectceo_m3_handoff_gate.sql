-- DEC-040 (4) (решение владельца 25.09.2026; A5 §2 / DEC-024 «вход в M3 —
-- только через persisted handoff, без обходов»): baseline и выпуск M3
-- требуют опубликованную точную передачу M2→M3 от дизайнера.
--
-- Выбор владельца: явная ссылка на передачу и гейт для ВСЕХ пакетов baseline.
--
-- 1. publish_baseline_atomic получает аргумент handoff_refs
--    [{packageId, handoffId, handoffRevisionId}]. Дверь проверяет:
--      * каждая ссылка — опубликованная передача этого пакета
--        (projectceo_m3._require_published_handoff) и ПОСЛЕДНЯЯ ревизия этой
--        передачи (устаревшая → M2_HANDOFF_STALE);
--      * набор пакетов в ссылках совпадает с набором пакетов опубликованного
--        baseline (пакет без передачи → M2_HANDOFF_REQUIRED);
--      * design intent передачи (designIntentRevisionId — согласованное
--        решение M2) вошёл в refs этого baseline как decision_revision (иначе
--        M2_HANDOFF_NOT_IN_BASELINE). Выборы/материалы передачи (цены,
--        комплектация) в состав baseline M3 не обязаны входить и не проверяются.
--    Ссылки сохраняются в append-only baseline_handoff_refs. Повтор той же
--    команды с другими ссылками — P1110 (точный replay, как у
--    register_documentation_sheet). Все проверки — в одной транзакции с
--    публикацией: отказ откатывает и baseline, и версию графа.
-- 2. Выпуски (корневой и work-package) не меняют сигнатуры: они привязаны к
--    expected_baseline_id; триггер на production_package_versions требует
--    строку baseline_handoff_refs для выпускаемого пакета этого baseline. Baseline, опубликованные до этой
--    миграции, ссылок не имеют — их выпуск отклоняется до нового baseline с
--    передачей.
--
-- Прежняя 6-аргументная сигнатура publish_baseline_atomic удаляется; список
-- модуля M3 (_module_signatures) пересобирается с заменой ровно этой записи,
-- остальные (в т.ч. R1) переносятся как есть.

begin;
set local check_function_bodies = on;

create table projectceo_product.baseline_handoff_refs (
  organization_id uuid not null,
  project_id uuid not null,
  baseline_id text not null,
  package_id uuid not null,
  handoff_id text not null,
  handoff_revision_id text not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, baseline_id, package_id),
  constraint baseline_handoff_refs_baseline_package_fkey
    foreign key (organization_id, project_id, baseline_id, package_id)
    references projectceo_product.project_baseline_packages
      (organization_id, project_id, baseline_id, package_id)
    on delete restrict,
  constraint baseline_handoff_refs_handoff_fkey
    foreign key (organization_id, project_id, handoff_kind, handoff_id, handoff_revision_id)
    references projectceo_product.m2_workspace_revisions
      (organization_id, project_id, entity_kind, entity_id, revision_id)
    on delete restrict,
  handoff_kind text not null default 'm2_m3_handoff'
    check (handoff_kind = 'm2_m3_handoff')
);

create index baseline_handoff_refs_handoff_idx
  on projectceo_product.baseline_handoff_refs
    (organization_id, project_id, handoff_kind, handoff_id, handoff_revision_id);

create trigger baseline_handoff_refs_append_only
before update or delete on projectceo_product.baseline_handoff_refs
for each row execute function projectceo_product.reject_append_only_mutation();

alter table projectceo_product.baseline_handoff_refs owner to pi_table_owner;
alter table projectceo_product.baseline_handoff_refs enable row level security;
alter table projectceo_product.baseline_handoff_refs force row level security;
revoke all on table projectceo_product.baseline_handoff_refs
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy baseline_handoff_refs_internal_owner
  on projectceo_product.baseline_handoff_refs
  for all to pi_table_owner using (true) with check (true);

-- Опубликованная передача пакета, и эта ревизия — последняя у передачи.
create function projectceo_product._require_latest_published_handoff(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid,
  p_handoff_id text,
  p_handoff_revision_id text
)
returns projectceo_product.m2_workspace_revisions
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_handoff projectceo_product.m2_workspace_revisions;
  v_latest_revision_id text;
begin
  v_handoff := projectceo_m3._require_published_handoff(
    p_organization_id, p_project_id, p_package_id, p_handoff_id, p_handoff_revision_id
  );
  select revision.revision_id into v_latest_revision_id
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = p_organization_id
    and revision.project_id = p_project_id
    and revision.entity_kind = 'm2_m3_handoff'
    and revision.entity_id = p_handoff_id
  order by revision.revision_no desc
  limit 1;
  if v_latest_revision_id is distinct from p_handoff_revision_id then
    perform projectceo_product._raise(
      'P1109', 'scope_conflict', '{"reason":"M2_HANDOFF_STALE"}'::jsonb
    );
  end if;
  return v_handoff;
end
$function$;

drop function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, bigint, text, text
);

create function projectceo_product_api.publish_baseline_atomic(
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
  v_handoff projectceo_product.m2_workspace_revisions;
  v_refs jsonb := '[]'::jsonb;
  v_result jsonb;
  v_baseline_id text;
  v_existing jsonb;
begin
  -- Authorize before inspecting approval state. The delegate authorizes again
  -- before its locked write transaction, preserving its existing race checks.
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
      'P1111',
      'validation_failed',
      '{"reason":"APPROVED_SNAPSHOT_REQUIRED"}'::jsonb
    );
  end if;

  -- DEC-040 (4): форма и содержание ссылок на передачи — до публикации.
  if handoff_refs is null
     or jsonb_typeof(handoff_refs) <> 'array'
     or jsonb_array_length(handoff_refs) not between 1 and 100 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_REQUIRED"}'::jsonb
    );
  end if;
  for v_ref in select value from jsonb_array_elements(handoff_refs) loop
    if jsonb_typeof(v_ref) is distinct from 'object'
       or jsonb_typeof(v_ref->'packageId') is distinct from 'string'
       or jsonb_typeof(v_ref->'handoffId') is distinct from 'string'
       or jsonb_typeof(v_ref->'handoffRevisionId') is distinct from 'string' then
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
    if v_refs @> jsonb_build_array(jsonb_build_object('packageId', v_package_id::text)) then
      perform projectceo_product._raise(
        'P1111', 'validation_failed', '{"field":"handoffRefs.duplicatePackageId"}'::jsonb
      );
    end if;
    v_handoff := projectceo_product._require_latest_published_handoff(
      v_context.organization_id, project_id, v_package_id,
      v_ref->>'handoffId', v_ref->>'handoffRevisionId'
    );
    v_refs := v_refs || jsonb_build_array(jsonb_build_object(
      'packageId', v_package_id::text,
      'handoffId', v_handoff.entity_id,
      'handoffRevisionId', v_handoff.revision_id,
      'designIntentRevisionId', v_handoff.payload->>'designIntentRevisionId'
    ));
  end loop;

  v_result := projectceo_product._publish_baseline_atomic_unchecked(
    project_id,
    expected_latest_version_id,
    previous_baseline_id,
    expected_state_revision,
    command_ref,
    idempotency_key
  );
  v_baseline_id := 'baseline:' || btrim(command_ref);

  -- Точный replay: та же команда с другими ссылками — конфликт, не новый
  -- baseline и не молчаливое принятие.
  select coalesce(jsonb_agg(jsonb_build_object(
      'packageId', r.package_id::text,
      'handoffId', r.handoff_id,
      'handoffRevisionId', r.handoff_revision_id
    ) order by r.package_id), '[]'::jsonb)
    into v_existing
  from projectceo_product.baseline_handoff_refs r
  where r.organization_id = v_context.organization_id
    and r.project_id = project_id
    and r.baseline_id = v_baseline_id;
  if jsonb_array_length(v_existing) > 0 then
    if v_existing is distinct from (
      select jsonb_agg(jsonb_build_object(
          'packageId', ref->>'packageId',
          'handoffId', ref->>'handoffId',
          'handoffRevisionId', ref->>'handoffRevisionId'
        ) order by (ref->>'packageId')::uuid)
      from jsonb_array_elements(v_refs) ref
    ) then
      perform projectceo_product._raise(
        'P1110', 'idempotency_conflict', '{"reason":"HANDOFF_REFS_CHANGED"}'::jsonb
      );
    end if;
    return v_result;
  end if;

  -- Каждый пакет baseline — ровно с одной передачей, и наоборот.
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

  -- Согласованное решение передачи (design intent) вошло в baseline.
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
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_NOT_IN_BASELINE"}'::jsonb
    );
  end if;

  insert into projectceo_product.baseline_handoff_refs (
    organization_id, project_id, baseline_id, package_id, handoff_id, handoff_revision_id
  )
  select v_context.organization_id, project_id, v_baseline_id,
    (ref->>'packageId')::uuid, ref->>'handoffId', ref->>'handoffRevisionId'
  from jsonb_array_elements(v_refs) ref;

  return v_result;
end
$function$;

alter function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, jsonb, bigint, text, text
) owner to pi_table_owner;
alter function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, jsonb, bigint, text, text
) set statement_timeout = '30s';
revoke all on function projectceo_product_api.publish_baseline_atomic(
  uuid, text, text, jsonb, bigint, text, text
) from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

-- Дверь модульная: открывает её только выключатель M3 (enable-m3-publication).
revoke execute on function
  projectceo_product_api.publish_baseline_atomic(uuid, text, text, jsonb, bigint, text, text)
from authenticated;

alter function projectceo_product._require_latest_published_handoff(uuid, uuid, uuid, text, text)
  owner to pi_table_owner;
revoke all on function projectceo_product._require_latest_published_handoff(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

-- Выпуск по baseline требует передачу выпускаемого пакета в этом baseline.
create function projectceo_product._require_baseline_package_handoff(
  p_organization_id uuid,
  p_project_id uuid,
  p_baseline_id text,
  p_package_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from projectceo_product.baseline_handoff_refs r
    where r.organization_id = p_organization_id
      and r.project_id = p_project_id
      and r.baseline_id = p_baseline_id
      and r.package_id = p_package_id
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_REQUIRED"}'::jsonb
    );
  end if;
end
$function$;
alter function projectceo_product._require_baseline_package_handoff(uuid, uuid, text, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_product._require_baseline_package_handoff(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

-- Граница ставится на таблицу выпусков: и корневой, и work-package выпуск
-- (и любая будущая дверь) пишут production_package_versions через
-- SECURITY DEFINER-функции pi_table_owner. SECURITY INVOKER намеренно — как
-- у clamp пакетных прав (20260925091000): прямая привилегированная SQL-запись
-- (фикстуры R1) не является продуктовым путём и не блокируется.
create function projectceo_product._guard_release_requires_handoff()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user = 'pi_table_owner' then
    perform projectceo_product._require_baseline_package_handoff(
      new.organization_id, new.project_id, new.baseline_id, new.package_id
    );
  end if;
  return new;
end
$function$;
alter function projectceo_product._guard_release_requires_handoff() owner to pi_table_owner;
revoke all on function projectceo_product._guard_release_requires_handoff()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

create trigger production_package_versions_require_handoff
  before insert on projectceo_product.production_package_versions
  for each row execute function projectceo_product._guard_release_requires_handoff();

-- Модуль M3: заменить ровно запись о baseline-двери, остальное сохранить.
do $m3_module_signatures$
declare
  v_old constant text := 'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)';
  v_new constant text := 'projectceo_product_api.publish_baseline_atomic(uuid, text, text, jsonb, bigint, text, text)';
  v_m3 text[] := projectceo_platform._module_signatures('m3');
  v_m4 text[] := projectceo_platform._module_signatures('m4_increment_1');
  v_owner oid;
  v_acl aclitem[];
begin
  if not (v_old = any(v_m3)) then
    raise exception 'DEC040_M3_BASELINE_SIGNATURE_MISSING';
  end if;
  select proowner, proacl into v_owner, v_acl
  from pg_catalog.pg_proc
  where oid = 'projectceo_platform._module_signatures(text)'::regprocedure;
  execute pg_catalog.format($definition$
    create or replace function projectceo_platform._module_signatures(p_module text)
    returns text[] language sql immutable security definer set search_path = '' as $body$
      select case p_module
        when 'm3' then %L::text[]
        when 'm4_increment_1' then %L::text[]
        else null end;
    $body$;
  $definition$, pg_catalog.array_replace(v_m3, v_old, v_new), v_m4);
  if projectceo_platform._module_signatures('m3') is distinct from pg_catalog.array_replace(v_m3, v_old, v_new)
     or projectceo_platform._module_signatures('m4_increment_1') is distinct from v_m4
     or exists (
       select 1 from pg_catalog.pg_proc
       where oid = 'projectceo_platform._module_signatures(text)'::regprocedure
         and (proowner is distinct from v_owner or proacl is distinct from v_acl)
     ) then
    raise exception 'DEC040_M3_MODULE_SIGNATURE_OR_PRIVILEGE_CHANGED';
  end if;
end
$m3_module_signatures$;

commit;
