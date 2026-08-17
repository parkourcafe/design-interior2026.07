\set ON_ERROR_STOP on

-- Проверка апгрейда населённой базы: `20260813010000` (и весь хвост ledger
-- после неё) применились к строкам `47_impact_upgrade_seed.sql`, и backfill
-- привёл каждую legacy-форму ровно к её форме контракта DEC-034.

do $upgrade_assert$
declare
  v_run record;
  v_impacts integer;
begin
  -- 1. Complete: счётчики выведены из фактических строк влияний.
  select * into v_run from projectceo_m4.impact_runs
  where impact_run_id = 'aaaa0000-0000-4000-8000-000000000011';
  if not found
    or v_run.coverage_status <> 'complete'
    or v_run.cutoff_reason is not null
    or v_run.has_more_beyond_depth
    or v_run.returned_impact_count <> 2
    or v_run.known_impact_count_lower_bound <> 2
    or v_run.policy_version <> 'project-ceo-impact-policy/0.1'
    or v_run.max_impacts <> 5000 then
    raise exception 'IMPACT_UPGRADE_COMPLETE_SHAPE_WRONG: %', to_jsonb(v_run);
  end if;

  -- 2. depth_limit → partial_depth: возвращено 1, нижняя граница 2.
  select * into v_run from projectceo_m4.impact_runs
  where impact_run_id = 'aaaa0000-0000-4000-8000-000000000012';
  if not found
    or v_run.coverage_status <> 'partial_depth'
    or v_run.cutoff_reason <> 'depth_boundary'
    or not v_run.has_more_beyond_depth
    or v_run.returned_impact_count <> 1
    or v_run.known_impact_count_lower_bound <> 2 then
    raise exception 'IMPACT_UPGRADE_DEPTH_SHAPE_WRONG: %', to_jsonb(v_run);
  end if;

  -- 3. result_limit → blocked_result_limit: счётчики контракта DEC-034
  --    (возвращено 0, нижняя граница maxImpacts + 1) НЕЗАВИСИМО от того,
  --    сколько строк сохранил truncate-and-keep PR #94.
  select * into v_run from projectceo_m4.impact_runs
  where impact_run_id = 'aaaa0000-0000-4000-8000-000000000013';
  if not found
    or v_run.coverage_status <> 'blocked_result_limit'
    or v_run.cutoff_reason <> 'result_limit'
    or not v_run.has_more_beyond_depth
    or v_run.returned_impact_count <> 0
    or v_run.known_impact_count_lower_bound <> 5001 then
    raise exception 'IMPACT_UPGRADE_BLOCKED_SHAPE_WRONG: %', to_jsonb(v_run);
  end if;

  -- 4. Append-only: сохранённые влияния legacy-прогона НЕ удалены.
  select count(*) into v_impacts from projectceo_m4.impacts
  where impact_run_id = 'aaaa0000-0000-4000-8000-000000000013';
  if v_impacts <> 3 then
    raise exception 'IMPACT_UPGRADE_LEGACY_IMPACTS_LOST: %', v_impacts;
  end if;

  -- 5. Constraint формы валидирован на населённой базе (не NOT VALID).
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'm4_impact_runs_coverage_shape_check'
      and conrelid = 'projectceo_m4.impact_runs'::regclass
      and convalidated
  ) then
    raise exception 'IMPACT_UPGRADE_SHAPE_CHECK_NOT_VALIDATED';
  end if;

  -- 6. Recovery-миграция DEC-037 (`20260817010000`) применилась поверх
  --    населённой базы: частичный уникальный индекс активных прогонов на
  --    месте, legacy-прогоны активны (не вытеснены самим апгрейдом).
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'projectceo_m4'
      and indexname = 'm4_impact_runs_one_active_key'
  ) then
    raise exception 'IMPACT_UPGRADE_ACTIVE_UNIQUE_INDEX_MISSING';
  end if;
  if exists (
    select 1 from projectceo_m4.impact_runs
    where organization_id = 'aaaa0000-0000-4000-8000-000000000001'
      and superseded_at is not null
  ) then
    raise exception 'IMPACT_UPGRADE_SUPERSEDED_BY_MIGRATION_ITSELF';
  end if;

  -- 7. Специализированный append-only (DEC-037): контент прогона неизменяем,
  --    delete запрещён, а единственный разрешённый переход — вытеснение — и
  --    тот односторонний.
  begin
    update projectceo_m4.impact_runs
    set max_depth = 9
    where impact_run_id = 'aaaa0000-0000-4000-8000-000000000013';
    raise exception 'IMPACT_UPGRADE_CONTENT_MUTATION_ALLOWED';
  exception
    when object_not_in_prerequisite_state then null; -- 55000
  end;
  begin
    delete from projectceo_m4.impact_runs
    where impact_run_id = 'aaaa0000-0000-4000-8000-000000000013';
    raise exception 'IMPACT_UPGRADE_DELETE_ALLOWED';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  -- Легальный переход: complete-прогон вытесняется (форма перехода
  -- разрешена триггером независимо от coverage_status — какие прогоны
  -- МОЖНО вытеснять, решает `calculate_change_impact`, и это доказывает
  -- DB5-сценарий recovery; здесь предмет — сам триггер).
  update projectceo_m4.impact_runs
  set superseded_at = statement_timestamp(),
      superseded_by_impact_run_id = 'aaaa0000-0000-4000-8000-0000000000ff'
  where impact_run_id = 'aaaa0000-0000-4000-8000-000000000011';
  if not exists (
    select 1 from projectceo_m4.impact_runs
    where impact_run_id = 'aaaa0000-0000-4000-8000-000000000011'
      and superseded_at is not null
  ) then
    raise exception 'IMPACT_UPGRADE_LEGAL_SUPERSEDE_REFUSED';
  end if;

  -- Односторонность: назад в активные не возвращаются.
  begin
    update projectceo_m4.impact_runs
    set superseded_at = null,
        superseded_by_impact_run_id = null
    where impact_run_id = 'aaaa0000-0000-4000-8000-000000000011';
    raise exception 'IMPACT_UPGRADE_UNSUPERSEDE_ALLOWED';
  exception
    when object_not_in_prerequisite_state then null;
  end;
end
$upgrade_assert$;
