\set ON_ERROR_STOP on

-- M3 read boundary. Runs after the sheet operations file, so the projection is
-- asked about a sheet that really exists and really has two revisions.
--
-- What is proven here: v7 adds documentation sheets without dropping anything
-- v6 returned; only the latest revision of a sheet is projected; the studio
-- side sees the sheets and the client approver does not; the private M3 schema
-- stays unreadable even though its rows are now projected.

set role authenticated;
set request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $m3_read_owner$
declare v_read jsonb; v_sheet jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v7(
    '41111111-1111-4111-8111-111111111111',null) into v_read;
  if v_read->'error' is not null and v_read->'error'<>'null'::jsonb then
    raise exception 'DB4_M3_READ_OWNER_FORBIDDEN';
  end if;
  -- v6 остаётся целым: проекция расширяется, а не подменяется.
  if v_read#>'{data,m2M3Handoffs}' is null
     or jsonb_array_length(v_read#>'{data,m2M3Handoffs}')<>1 then
    raise exception 'DB4_M3_READ_BASE_LOST';
  end if;
  if jsonb_array_length(v_read#>'{data,m3DocumentationSheets}')<>1 then
    raise exception 'DB4_M3_READ_SHEET_COUNT';
  end if;
  v_sheet := v_read#>'{data,m3DocumentationSheets,0}';
  -- Только последняя ревизия: первая осталась в хранилище, но не в проекции.
  if (v_sheet->>'revisionNo')::bigint<>2
     or v_sheet->>'revisionId'<>'75000000-0000-4000-8000-000000000002' then
    raise exception 'DB4_M3_READ_NOT_LATEST';
  end if;
  if v_sheet->>'sheetNumber'<>'A-101'
     or v_sheet->>'roomId'<>'cycle6-living-room'
     or v_sheet->'specificationRevisionIds'<>jsonb_build_array('revision-selection-db4-r1') then
    raise exception 'DB4_M3_READ_SHEET_SHAPE';
  end if;
  if v_sheet#>>'{origin,semanticHash}' !~ '^sha256:[0-9a-f]{64}$'
     or v_sheet#>>'{origin,approvedM2CommitRevisionId}' is null
     or v_sheet#>>'{origin,handoffContractVersion}' is null then
    raise exception 'DB4_M3_READ_ORIGIN_MISSING';
  end if;
  -- Вход модуля отдаётся в его собственной форме: комната и design intent
  -- есть, иначе проверку комплектности не на чем запустить.
  if jsonb_array_length(v_read#>'{data,m3DocumentationHandoffs}')<>1 then
    raise exception 'DB4_M3_READ_HANDOFF_COUNT';
  end if;
  if v_read#>>'{data,m3DocumentationHandoffs,0,roomId}'<>'cycle6-living-room'
     or v_read#>>'{data,m3DocumentationHandoffs,0,designIntentRevisionId}' is null
     or v_read#>>'{data,m3DocumentationHandoffs,0,layout,semanticHash}'
        is distinct from v_sheet#>>'{origin,semanticHash}'
     or v_read#>'{data,m3DocumentationHandoffs,0,selectionRevisionIds}'
        <>jsonb_build_array('revision-selection-db4-r1') then
    raise exception 'DB4_M3_READ_HANDOFF_SHAPE';
  end if;
end
$m3_read_owner$;
reset role;

-- Клиент-утверждающий согласовывает варианты M2 и не получает внутренностей
-- пакета документации — то же правило, что v6 применяет к m2M3Handoffs.
set role authenticated;
set request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $m3_read_client$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v7(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111') into v_read;
  if v_read->'error' is not null and v_read->'error'<>'null'::jsonb then
    raise exception 'DB4_M3_READ_CLIENT_FORBIDDEN';
  end if;
  -- Ключей нет вовсе: «не получает поверхность», а не «получает пустую».
  if v_read#>'{data,m3DocumentationSheets}' is not null
     or v_read#>'{data,m3DocumentationHandoffs}' is not null then
    raise exception 'DB4_M3_READ_CLIENT_LEAK';
  end if;
end
$m3_read_client$;
reset role;

-- Чужой пакет и чужая организация закрыты ровно так же, как в базовой
-- проекции: v7 не создаёт обхода.
set role authenticated;
set request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $m3_read_wrong_package$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v7(
    '41111111-1111-4111-8111-111111111111',
    '49999999-9999-4999-8999-999999999999') into v_read;
  if v_read->'error' is null or v_read->'error'='null'::jsonb then
    raise exception 'DB4_M3_READ_WRONG_PACKAGE';
  end if;
end
$m3_read_wrong_package$;
reset role;

set role authenticated;
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $m3_read_other_org$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v7(
    '41111111-1111-4111-8111-111111111111',null) into v_read;
  if v_read->'error' is null or v_read->'error'='null'::jsonb then
    raise exception 'DB4_M3_READ_OTHER_ORG';
  end if;
end
$m3_read_other_org$;
reset role;

-- Проекция не открыла таблицу: строки видно через RPC, схему — нет.
set role authenticated;
set request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $m3_read_schema_still_closed$
begin
  begin
    perform 1 from projectceo_m3.documentation_sheet_revisions;
    raise exception 'DB4_M3_READ_SCHEMA_OPENED';
  exception when insufficient_privilege then null;
  end;
end
$m3_read_schema_still_closed$;
reset role;

begin;
set local role anon;
do $m3_read_anon_denied$
begin
  begin
    perform projectceo_read_api.get_project_workspace_read_v7(
      '41111111-1111-4111-8111-111111111111',null);
    raise exception 'DB4_M3_READ_ANON_ALLOWED';
  exception when insufficient_privilege or sqlstate 'P1101' then null;
  end;
end
$m3_read_anon_denied$;
rollback;

select 'DB4_M3_DOCUMENTATION_READ_OK' result;
