\set ON_ERROR_STOP on

-- Гейт читающих RPC по состоянию модуля M3 (`20260824190000`, backlog #2):
-- при выключенном модуле Data API не отдаёт source/sheet данные, при
-- включённом — отдаёт как раньше. Сценарий стоит после 52: к этому моменту
-- в проекте есть и инвентарь, и граф, и листы — гейту есть что прятать.

-- 1. Модуль открыт (среда харнесса): у владельца есть и sources, и листы.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $open_module_serves_m3$
declare
  v_read jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read_v9(
    '41111111-1111-4111-8111-111111111111', null
  );
  if jsonb_array_length(v_read#>'{data,sources}') < 1 then
    raise exception 'DB4_M3_GATE_OPEN_SOURCES_EMPTY';
  end if;
  if (v_read#>>'{data,sourceStats,physicalRecords}')::int < 1 then
    raise exception 'DB4_M3_GATE_OPEN_STATS_EMPTY';
  end if;
  if v_read#>'{data,m3DocumentationSheets}' is null then
    raise exception 'DB4_M3_GATE_OPEN_SHEETS_MISSING';
  end if;
end
$open_module_serves_m3$;
rollback;

-- 2. Закрываем модуль выключателем — те же чтения из-под той же роли больше
-- не отдают ни инвентаря, ни счётчиков, ни листов. Форма ответа не меняется:
-- sources — пустой массив, sourceStats — нули, ключей листов нет.
select projectceo_platform.close_module_production(
  'm3', 'DB4 harness', 'сценарий 53: проверка гейта чтений при закрытом модуле'
);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $closed_module_hides_m3$
declare
  v_read jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read_v9(
    '41111111-1111-4111-8111-111111111111', null
  );
  if v_read#>'{data,sources}' is distinct from '[]'::jsonb then
    raise exception 'DB4_M3_GATE_CLOSED_SOURCES_SERVED:%',
      jsonb_array_length(v_read#>'{data,sources}');
  end if;
  if (v_read#>>'{data,sourceStats,physicalRecords}')::int <> 0
    or (v_read#>>'{data,sourceStats,reviewQueue}')::int <> 0
    or (v_read#>>'{data,sourceStats,uniqueBlobs}')::int <> 0 then
    raise exception 'DB4_M3_GATE_CLOSED_STATS_SERVED';
  end if;
  if v_read#>'{data,m3DocumentationSheets}' is not null
    or v_read#>'{data,m3DocumentationHandoffs}' is not null then
    raise exception 'DB4_M3_GATE_CLOSED_SHEETS_SERVED';
  end if;
  -- Поверхность M1/M2 модулем M3 не закрывается: решения и согласования
  -- остаются на месте.
  if v_read#>'{data,approvalPackages}' is null
    or v_read#>'{data,decisions}' is null then
    raise exception 'DB4_M3_GATE_CLOSED_TOOK_TOO_MUCH';
  end if;
  -- Гейт действует и на младших версиях цепочки — они оборачивают ту же базу.
  v_read := projectceo_read_api.get_project_workspace_read_v7(
    '41111111-1111-4111-8111-111111111111', null
  );
  if v_read#>'{data,sources}' is distinct from '[]'::jsonb
    or v_read#>'{data,m3DocumentationSheets}' is not null then
    raise exception 'DB4_M3_GATE_CLOSED_V7_SERVED';
  end if;
end
$closed_module_hides_m3$;
rollback;

-- 3. Открываем обратно — данные вернулись, среда харнесса восстановлена.
select projectceo_platform.open_module_production(
  'm3', 'DB4 harness', 'сценарий 53: возврат среды харнесса к открытому M3'
);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $reopened_module_serves_again$
declare
  v_read jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read_v9(
    '41111111-1111-4111-8111-111111111111', null
  );
  if jsonb_array_length(v_read#>'{data,sources}') < 1
    or v_read#>'{data,m3DocumentationSheets}' is null then
    raise exception 'DB4_M3_GATE_REOPEN_NOT_SERVING';
  end if;
end
$reopened_module_serves_again$;
rollback;

select 'DB4_M3_READ_GATE_OK' as result;
