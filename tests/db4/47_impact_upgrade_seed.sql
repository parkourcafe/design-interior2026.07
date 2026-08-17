\set ON_ERROR_STOP on

-- Населённое состояние ПЕРЕД `20260813010000` (DEC-034).
--
-- ЗАЧЕМ. Основной прогон DB4/DB5 применяет весь ledger к пустой базе, и
-- backfill DEC-034 не исполняется ни разу: нормализовать нечего. Ровно так
-- прятался дефект telegram-моста (`run-telegram-upgrade.zsh`), и ровно так
-- прятался дефект этой миграции: `set not null` без backfill падал бы на
-- любой базе, применившей `20260812*` раньше и посчитавшей прогоны под
-- семантикой PR #94 (truncate-and-keep). Здесь такие строки заводятся
-- специально — по одной на каждую из трёх legacy-форм.
--
-- ПОЧЕМУ ПРЯМАЯ ЗАПИСЬ БЕЗ FK. Предмет проверки — поведение миграции на
-- населённой `impact_runs`, а не ссылочная целостность продуктовой цепочки:
-- её собственный путь доказан прогонами DB4/DB5 на золотом проекте. Полная
-- FK-цепь (workflows → packages → baselines → change_requests → roots →
-- version_nodes) для этого доказательства — шум, поэтому строки вставляются
-- с выключенными FK-триггерами (`session_replication_role = replica`);
-- CHECK-констрейнты `20260812020000` при этом ПРОДОЛЖАЮТ действовать, и
-- строки обязаны им соответствовать — это часть предмета проверки.

begin;

set local session_replication_role = replica;

-- Прогон 1: legacy complete (не усечён) с двумя сохранёнными влияниями.
insert into projectceo_m4.impact_runs (
  organization_id, project_id, impact_run_id, change_request_id, package_id,
  target_baseline_id, target_graph_version_id, max_depth, algorithm,
  result_digest, created_by_id,
  is_truncated, truncation_reason, calculated_depth, policy_max_depth
) values (
  'aaaa0000-0000-4000-8000-000000000001',
  'aaaa0000-0000-4000-8000-000000000002',
  'aaaa0000-0000-4000-8000-000000000011',
  'aaaa0000-0000-4000-8000-000000000021',
  'aaaa0000-0000-4000-8000-000000000031',
  'baseline:upgrade', 'graph:upgrade', 8,
  '{"version":"project-ceo-impact/0.2"}'::jsonb,
  decode(repeat('11', 32), 'hex'), 'system:upgrade-harness',
  false, null, 2, 8
);

-- Прогон 2: legacy depth_limit (усечён по глубине) с одним влиянием.
insert into projectceo_m4.impact_runs (
  organization_id, project_id, impact_run_id, change_request_id, package_id,
  target_baseline_id, target_graph_version_id, max_depth, algorithm,
  result_digest, created_by_id,
  is_truncated, truncation_reason, calculated_depth, policy_max_depth
) values (
  'aaaa0000-0000-4000-8000-000000000001',
  'aaaa0000-0000-4000-8000-000000000002',
  'aaaa0000-0000-4000-8000-000000000012',
  'aaaa0000-0000-4000-8000-000000000022',
  'aaaa0000-0000-4000-8000-000000000031',
  'baseline:upgrade', 'graph:upgrade', 8,
  '{"version":"project-ceo-impact/0.2"}'::jsonb,
  decode(repeat('22', 32), 'hex'), 'system:upgrade-harness',
  true, 'depth_limit', 8, 8
);

-- Прогон 3: legacy result_limit — truncate-and-keep PR #94: усечён по ширине,
-- НО влияния сохранены. Ровно эта форма и есть предмет DEC-034.
insert into projectceo_m4.impact_runs (
  organization_id, project_id, impact_run_id, change_request_id, package_id,
  target_baseline_id, target_graph_version_id, max_depth, algorithm,
  result_digest, created_by_id,
  is_truncated, truncation_reason, calculated_depth, policy_max_depth
) values (
  'aaaa0000-0000-4000-8000-000000000001',
  'aaaa0000-0000-4000-8000-000000000002',
  'aaaa0000-0000-4000-8000-000000000013',
  'aaaa0000-0000-4000-8000-000000000023',
  'aaaa0000-0000-4000-8000-000000000031',
  'baseline:upgrade', 'graph:upgrade', 8,
  '{"version":"project-ceo-impact/0.2"}'::jsonb,
  decode(repeat('33', 32), 'hex'), 'system:upgrade-harness',
  true, 'result_limit', 3, 8
);

-- Влияния: 2 у complete, 1 у depth_limit, 3 у result_limit (замена «5000»).
insert into projectceo_m4.impacts (
  organization_id, project_id, impact_id, impact_run_id, change_request_id,
  package_id, target_graph_version_id, changed_node_id, changed_revision_id,
  impacted_node_id, impacted_revision_id, distance, node_path
) values
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000002',
   'impact:upgrade-complete-1', 'aaaa0000-0000-4000-8000-000000000011',
   'aaaa0000-0000-4000-8000-000000000021', 'aaaa0000-0000-4000-8000-000000000031',
   'graph:upgrade', 'node:a', 'rev:a1', 'node:b', 'rev:b1', 1,
   array['node:a', 'node:b']),
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000002',
   'impact:upgrade-complete-2', 'aaaa0000-0000-4000-8000-000000000011',
   'aaaa0000-0000-4000-8000-000000000021', 'aaaa0000-0000-4000-8000-000000000031',
   'graph:upgrade', 'node:a', 'rev:a1', 'node:c', 'rev:c1', 2,
   array['node:a', 'node:b', 'node:c']),
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000002',
   'impact:upgrade-depth-1', 'aaaa0000-0000-4000-8000-000000000012',
   'aaaa0000-0000-4000-8000-000000000022', 'aaaa0000-0000-4000-8000-000000000031',
   'graph:upgrade', 'node:a', 'rev:a1', 'node:d', 'rev:d1', 1,
   array['node:a', 'node:d']),
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000002',
   'impact:upgrade-blocked-1', 'aaaa0000-0000-4000-8000-000000000013',
   'aaaa0000-0000-4000-8000-000000000023', 'aaaa0000-0000-4000-8000-000000000031',
   'graph:upgrade', 'node:a', 'rev:a1', 'node:e', 'rev:e1', 1,
   array['node:a', 'node:e']),
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000002',
   'impact:upgrade-blocked-2', 'aaaa0000-0000-4000-8000-000000000013',
   'aaaa0000-0000-4000-8000-000000000023', 'aaaa0000-0000-4000-8000-000000000031',
   'graph:upgrade', 'node:a', 'rev:a1', 'node:f', 'rev:f1', 1,
   array['node:a', 'node:f']),
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000002',
   'impact:upgrade-blocked-3', 'aaaa0000-0000-4000-8000-000000000013',
   'aaaa0000-0000-4000-8000-000000000023', 'aaaa0000-0000-4000-8000-000000000031',
   'graph:upgrade', 'node:a', 'rev:a1', 'node:g', 'rev:g1', 2,
   array['node:a', 'node:f', 'node:g']);

do $seed_check$
declare
  v_runs integer;
  v_impacts integer;
begin
  select count(*) into v_runs from projectceo_m4.impact_runs
  where organization_id = 'aaaa0000-0000-4000-8000-000000000001';
  select count(*) into v_impacts from projectceo_m4.impacts
  where organization_id = 'aaaa0000-0000-4000-8000-000000000001';
  if v_runs <> 3 or v_impacts <> 6 then
    raise exception 'IMPACT_UPGRADE_SEED_INCOMPLETE runs=% impacts=%',
      v_runs, v_impacts;
  end if;
end
$seed_check$;

commit;
