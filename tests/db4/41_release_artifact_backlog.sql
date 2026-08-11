\set ON_ERROR_STOP on

-- Очередь артефактов выпуска: системное чтение и его границы
-- (`20260811030000`, этап M4 Worker Foundation / Increment 1.5, DEC-030).
--
-- Сценарий стоит ПОСЛЕ продуктовых операций намеренно: к этому моменту в
-- проекте есть и версия с артефактом (`package-db4-root-v1`), и версия без
-- него (`package-db4-work-v1`). Очередь, проверенная на пустой базе, не
-- доказала бы главного — что она отдаёт ровно недостающее.

-- 1. Роль `authenticated` не достаёт до очереди. Проверка вызовом, а не
--    чтением грантов: права — утверждение о доступе, а доступ — это вызов.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $backlog_denied_to_human$
begin
  begin
    perform projectceo_product_api.list_release_artifact_backlog(10);
    raise exception 'DB4_RELEASE_BACKLOG_REACHED_BY_AUTHENTICATED';
  exception
    when insufficient_privilege then null;
  end;

  -- И сборка артефакта остаётся системной: воркер не открыл её человеку.
  begin
    perform projectceo_product_api.build_release_artifact(
      '41111111-1111-4111-8111-111111111111',
      '{}'::jsonb,
      1,
      'db4-worker-probe'
    );
    raise exception 'DB4_RELEASE_BUILD_REACHED_BY_AUTHENTICATED';
  exception
    when insufficient_privilege then null;
  end;
end
$backlog_denied_to_human$;
rollback;

-- 2. Системная роль очередь читает, и в очереди ровно то, чего не хватает.
begin;
set local role service_role;
do $backlog_contents$
declare
  v_backlog jsonb;
  v_ids text[];
begin
  v_backlog := projectceo_product_api.list_release_artifact_backlog(100)
    -> 'data';

  select array_agg(item ->> 'productionPackageVersionId' order by item ->> 'productionPackageVersionId')
  into v_ids
  from jsonb_array_elements(v_backlog) item
  where item ->> 'projectId' = '41111111-1111-4111-8111-111111111111';

  -- Версия с артефактом в очередь не попадает — иначе воркер ходил бы по
  -- кругу, каждый раз получая `existing_artifact`.
  if 'package-db4-root-v1' = any(coalesce(v_ids, array[]::text[])) then
    raise exception 'DB4_RELEASE_BACKLOG_RETURNED_BUILT_VERSION';
  end if;
  -- Версия без артефакта — попадает. Это и есть работа воркера.
  if not ('package-db4-work-v1' = any(coalesce(v_ids, array[]::text[]))) then
    raise exception 'DB4_RELEASE_BACKLOG_MISSED_PENDING_VERSION';
  end if;

  -- Строка очереди обязана нести всё, из чего собирается дескриптор: иначе
  -- воркеру пришлось бы что-то выдумывать.
  if exists (
    select 1
    from jsonb_array_elements(v_backlog) item
    where item ->> 'projectId' = '41111111-1111-4111-8111-111111111111'
      and (
        item ->> 'organizationId' is null
        or item ->> 'packageId' is null
        or item ->> 'baselineId' is null
        or item ->> 'semanticHash' !~ '^sha256:[0-9a-f]{64}$'
        or item -> 'exactRevisionRefs' is null
        or jsonb_typeof(item -> 'exactRevisionRefs') <> 'object'
        or item ->> 'stateRevision' is null
      )
  ) then
    raise exception 'DB4_RELEASE_BACKLOG_ROW_INCOMPLETE';
  end if;

  -- И ни одного поля сверх нужного: PII, имена и авторство в системную
  -- очередь не попадают.
  if exists (
    select 1
    from jsonb_array_elements(v_backlog) item,
      lateral jsonb_object_keys(item) key
    where key <> all (array[
      'organizationId', 'projectId', 'packageId',
      'productionPackageVersionId', 'versionNo', 'previousVersionId',
      'baselineId', 'exactRevisionRefs', 'semanticHash', 'stateRevision'
    ])
  ) then
    raise exception 'DB4_RELEASE_BACKLOG_LEAKED_EXTRA_FIELD';
  end if;
end
$backlog_contents$;
rollback;

-- 3. Негодный предел — контролируемый отказ, а не молчаливая выдача всего.
begin;
set local role service_role;
do $backlog_limit_guarded$
begin
  begin
    perform projectceo_product_api.list_release_artifact_backlog(0);
    raise exception 'DB4_RELEASE_BACKLOG_ACCEPTED_ZERO_LIMIT';
  exception
    when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_product_api.list_release_artifact_backlog(5000);
    raise exception 'DB4_RELEASE_BACKLOG_ACCEPTED_HUGE_LIMIT';
  exception
    when sqlstate 'P1111' then null;
  end;
end
$backlog_limit_guarded$;
rollback;

\echo DB4_RELEASE_ARTIFACT_BACKLOG_OK
