\set ON_ERROR_STOP on

-- DB4: DEC-040 (4) — baseline и выпуск M3 требуют опубликованную точную
-- передачу M2→M3 по каждому пакету (миграция 20260925100000). Всё — внутри
-- откатываемой транзакции поверх состояния проекта 41111111 после 20–78.

do $schema_contract$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'projectceo_product.production_package_versions'::regclass
      and t.tgname = 'production_package_versions_require_handoff'
      and not t.tgisinternal
  ) then
    raise exception 'DB4_81_RELEASE_HANDOFF_TRIGGER_MISSING';
  end if;
  if to_regprocedure('projectceo_product_api.publish_baseline_atomic(uuid,text,text,bigint,text,text)') is not null then
    raise exception 'DB4_81_LEGACY_BASELINE_SIGNATURE_REMAINS';
  end if;
  if not ('projectceo_product_api.publish_baseline_atomic(uuid, text, text, jsonb, bigint, text, text)'
          = any(projectceo_platform._module_signatures('m3'))) then
    raise exception 'DB4_81_M3_MODULE_SIGNATURE_MISSING';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'projectceo_product.baseline_handoff_refs', 'SELECT') then
    raise exception 'DB4_81_HANDOFF_REFS_EXPOSED';
  end if;
  -- Каждый опубликованный через дверь baseline несёт ссылки на все свои пакеты.
  if exists (
    select 1
    from projectceo_product.project_baseline_packages bp
    join projectceo_product.project_baselines b
      on b.organization_id = bp.organization_id and b.project_id = bp.project_id
     and b.baseline_id = bp.baseline_id
    where bp.project_id = '41111111-1111-4111-8111-111111111111'
      and not exists (
        select 1 from projectceo_product.baseline_handoff_refs r
        where r.organization_id = bp.organization_id and r.project_id = bp.project_id
          and r.baseline_id = bp.baseline_id and r.package_id = bp.package_id
      )
  ) then
    raise exception 'DB4_81_BASELINE_WITHOUT_HANDOFF_REFS';
  end if;
end
$schema_contract$;

select
  workflow.state_revision as state_revision,
  workflow.latest_version_id as latest_version_id
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset gate_
select baseline.baseline_id as previous_baseline_id
from projectceo_product.project_baselines baseline
where baseline.project_id = '41111111-1111-4111-8111-111111111111'
order by baseline.version_no desc
limit 1
\gset gate_
select set_config('db4.gate_state_revision', :'gate_state_revision', false);
select set_config('db4.gate_latest_version_id', :'gate_latest_version_id', false);
select set_config('db4.gate_previous_baseline_id', :'gate_previous_baseline_id', false);

begin;

-- Помощник: попытка публикации с заданными ссылками, ожидаемый отказ.
create function pi_test_fixture.expect_baseline_refusal(p_refs jsonb, p_state text, p_reason text, p_case text)
returns void language plpgsql as $function$
declare v_state text; v_detail text;
begin
  begin
    perform projectceo_product_api.publish_baseline_atomic(
      '41111111-1111-4111-8111-111111111111',
      current_setting('db4.gate_latest_version_id'),
      current_setting('db4.gate_previous_baseline_id'),
      p_refs,
      current_setting('db4.gate_state_revision')::bigint,
      'db4-gate-' || p_case,
      'db4-gate-' || p_case
    );
    raise exception 'DB4_81_%_ACCEPTED', upper(p_case);
  exception when sqlstate 'P1111' or sqlstate 'P1109' then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    if v_state <> p_state or v_detail::jsonb->>'reason' is distinct from p_reason then
      raise exception 'DB4_81_%_WRONG_REFUSAL:%/%', upper(p_case), v_state, v_detail;
    end if;
  end;
end
$function$;
grant execute on function pi_test_fixture.expect_baseline_refusal(jsonb, text, text, text) to authenticated;

-- Ссылки «как есть» до засева посторонних передач ниже.
select set_config('db4.gate_refs',
  pi_test_fixture.handoff_refs('41111111-1111-4111-8111-111111111111')::text, true);

-- Устаревшая ревизия и «содержание не в baseline» — готовим передачи заранее.
select pi_test_fixture.seed_handoff(
  '41111111-1111-4111-8111-111111111111', '49999999-9999-4999-8999-999999999999',
  'handoff-db4-81-stale', 'revision-decision-db4-r1', array['revision-selection-db4-r1'],
  '31111111-1111-4111-8111-111111111111') as stale_r1
\gset gate_
select pi_test_fixture.seed_handoff(
  '41111111-1111-4111-8111-111111111111', '49999999-9999-4999-8999-999999999999',
  'handoff-db4-81-stale', 'revision-decision-db4-r1', array['revision-selection-db4-r1'],
  '31111111-1111-4111-8111-111111111111') as stale_r2
\gset gate_
select pi_test_fixture.seed_handoff(
  '41111111-1111-4111-8111-111111111111', '49999999-9999-4999-8999-999999999999',
  'handoff-db4-81-foreign', 'revision-decision-not-in-graph', array['revision-selection-db4-r1'],
  '31111111-1111-4111-8111-111111111111') as foreign_r1
\gset gate_
select set_config('db4.gate_stale_r1', :'gate_stale_r1', true);
select set_config('db4.gate_stale_r2', :'gate_stale_r2', true);
select set_config('db4.gate_foreign_r1', :'gate_foreign_r1', true);

set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';

do $refusals$
declare
  v_root jsonb := (
    select ref from jsonb_array_elements(current_setting('db4.gate_refs')::jsonb) ref
    where ref->>'packageId' = '41111111-1111-4111-8111-111111111111'
  );
begin
  -- 1. Без ссылок.
  perform pi_test_fixture.expect_baseline_refusal('[]'::jsonb, 'P1111', 'M2_HANDOFF_REQUIRED', 'empty');
  -- 2. Пакет baseline без передачи (только корневой).
  perform pi_test_fixture.expect_baseline_refusal(jsonb_build_array(v_root), 'P1111', 'M2_HANDOFF_REQUIRED', 'missing_package');
  -- 3. Устаревшая ревизия передачи.
  perform pi_test_fixture.expect_baseline_refusal(jsonb_build_array(v_root, jsonb_build_object(
    'packageId', '49999999-9999-4999-8999-999999999999',
    'handoffId', 'handoff-db4-81-stale', 'handoffRevisionId', current_setting('db4.gate_stale_r1')
  )), 'P1109', 'M2_HANDOFF_STALE', 'stale');
  -- 4. Передача, которой нет у пакета (чужой пакет).
  perform pi_test_fixture.expect_baseline_refusal(jsonb_build_array(v_root, jsonb_build_object(
    'packageId', '49999999-9999-4999-8999-999999999999',
    'handoffId', v_root->>'handoffId', 'handoffRevisionId', v_root->>'handoffRevisionId'
  )), 'P1111', 'M2_HANDOFF_REQUIRED', 'wrong_package');
  -- 5. Содержание передачи не вошло в baseline.
  perform pi_test_fixture.expect_baseline_refusal(jsonb_build_array(v_root, jsonb_build_object(
    'packageId', '49999999-9999-4999-8999-999999999999',
    'handoffId', 'handoff-db4-81-foreign', 'handoffRevisionId', current_setting('db4.gate_foreign_r1')
  )), 'P1111', 'M2_HANDOFF_NOT_IN_BASELINE', 'not_in_baseline');
end
$refusals$;

-- 6. Позитивный путь и точный replay: те же ссылки — тот же результат,
--    другие ссылки на тот же ключ — P1110.
do $positive_and_replay$
declare
  v_refs jsonb := current_setting('db4.gate_refs')::jsonb;
  v_first jsonb;
  v_second jsonb;
  v_state text;
  v_detail text;
begin
  v_first := projectceo_product_api.publish_baseline_atomic(
    '41111111-1111-4111-8111-111111111111',
    current_setting('db4.gate_latest_version_id'),
    current_setting('db4.gate_previous_baseline_id'),
    v_refs,
    current_setting('db4.gate_state_revision')::bigint,
    'db4-gate-positive', 'db4-gate-positive');
  v_second := projectceo_product_api.publish_baseline_atomic(
    '41111111-1111-4111-8111-111111111111',
    current_setting('db4.gate_latest_version_id'),
    current_setting('db4.gate_previous_baseline_id'),
    v_refs,
    current_setting('db4.gate_state_revision')::bigint,
    'db4-gate-positive', 'db4-gate-positive');
  if v_first->'result' is distinct from v_second->'result' then
    raise exception 'DB4_81_REPLAY_RESULT_CHANGED';
  end if;
  begin
    perform projectceo_product_api.publish_baseline_atomic(
      '41111111-1111-4111-8111-111111111111',
      current_setting('db4.gate_latest_version_id'),
      current_setting('db4.gate_previous_baseline_id'),
      (select jsonb_agg(case when ref->>'packageId' = '49999999-9999-4999-8999-999999999999'
          then jsonb_build_object('packageId', ref->>'packageId',
            'handoffId', 'handoff-db4-81-stale', 'handoffRevisionId', current_setting('db4.gate_stale_r2'))
          else ref end)
       from jsonb_array_elements(v_refs) ref),
      current_setting('db4.gate_state_revision')::bigint,
      'db4-gate-positive', 'db4-gate-positive');
    raise exception 'DB4_81_REPLAY_WITH_OTHER_REFS_ACCEPTED';
  exception when sqlstate 'P1110' then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    if v_detail::jsonb->>'reason' is distinct from 'HANDOFF_REFS_CHANGED' then
      raise exception 'DB4_81_REPLAY_WRONG_REFUSAL:%', v_detail;
    end if;
  end;
end
$positive_and_replay$;

reset role;

do $refs_persisted$
begin
  if (select count(*) from projectceo_product.baseline_handoff_refs
      where project_id = '41111111-1111-4111-8111-111111111111'
        and baseline_id = 'baseline:db4-gate-positive') <> 2 then
    raise exception 'DB4_81_REFS_NOT_PERSISTED';
  end if;
  begin
    update projectceo_product.baseline_handoff_refs set handoff_id = 'tampered'
    where baseline_id = 'baseline:db4-gate-positive';
    raise exception 'DB4_81_REFS_MUTABLE';
  exception when sqlstate '55000' then null;
  end;
end
$refs_persisted$;

-- 7. Выпуск: продуктовый путь (pi_table_owner) без ссылки пакета в baseline
--    отклоняется триггером таблицы выпусков.
do $release_requires_handoff$
declare v_detail text;
begin
  begin
    perform projectceo_product._require_baseline_package_handoff(
      (select organization_id from project_intelligence.project_workflows
       where project_id = '41111111-1111-4111-8111-111111111111'),
      '41111111-1111-4111-8111-111111111111',
      'baseline:db4-gate-positive',
      '00000000-0000-4000-8000-000000000081');
    raise exception 'DB4_81_RELEASE_WITHOUT_HANDOFF_ACCEPTED';
  exception when sqlstate 'P1111' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail::jsonb->>'reason' <> 'M2_HANDOFF_REQUIRED' then raise; end if;
  end;
end
$release_requires_handoff$;

-- 8. У baseline нет ссылки на передачу пакета (строку снимаем в
--    откатываемой транзакции, выключив append-only).
alter table projectceo_product.baseline_handoff_refs disable trigger baseline_handoff_refs_append_only;
delete from projectceo_product.baseline_handoff_refs
where baseline_id = 'baseline:db4-gate-positive'
  and package_id = '49999999-9999-4999-8999-999999999999';
alter table projectceo_product.baseline_handoff_refs enable trigger baseline_handoff_refs_append_only;

-- Продуктовый путь выпуска пишет production_package_versions от имени
-- владельца дверей (pi_table_owner). Та же запись для пакета без ссылки в
-- baseline отклоняется триггером до любых ограничений таблицы.
set local role pi_table_owner;
do $release_row_refused$
declare v_detail text;
begin
  begin
    insert into projectceo_product.production_package_versions
    select (jsonb_populate_record(
      null::projectceo_product.production_package_versions,
      to_jsonb(v) || jsonb_build_object(
        'baseline_id', 'baseline:db4-gate-positive',
        'production_package_version_id', 'db4-gate-release-probe')
    )).*
    from projectceo_product.production_package_versions v
    where v.project_id = '41111111-1111-4111-8111-111111111111'
      and v.package_id = '49999999-9999-4999-8999-999999999999'
    limit 1;
    raise exception 'DB4_81_RELEASE_ROW_WITHOUT_HANDOFF_ACCEPTED';
  exception when sqlstate 'P1111' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail::jsonb->>'reason' is distinct from 'M2_HANDOFF_REQUIRED' then
      raise exception 'DB4_81_RELEASE_ROW_WRONG_REFUSAL:%', v_detail;
    end if;
  end;
end
$release_row_refused$;
reset role;

rollback;

select 'DB4_M3_HANDOFF_GATE_OK' result;
