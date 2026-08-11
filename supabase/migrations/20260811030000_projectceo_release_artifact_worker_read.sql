-- Системное чтение очереди артефактов выпуска — единственная новая поверхность
-- этапа M4 Worker Foundation / Increment 1.5 (DEC-030, подписан 11.08.2026).
--
-- ЗАЧЕМ. Гейт 2 нашёл, что `distribute_release` опирается на артефакт выпуска,
-- а собрать артефакт может только система: у `build_release_artifact` права
-- есть лишь у `service_role`, и запись помечается
-- `system:projectceo-product-worker`. Воркера при этом не существовало, и в
-- прогоне AP5 его изображал psql-скрипт. Настоящему воркеру нужно одно, чего в
-- базе не было: узнать, для каких выпущенных версий артефакта ещё нет.
--
-- Читать напрямую он не может: `projectceo_product` — приватная схема, Data API
-- её не отдаёт (`supabase/config.toml`, `verify-runtime.mjs` требует 406).
-- Отсюда эта дверь.
--
-- ГРАНИЦЫ, КОТОРЫЕ ОНА НЕ ДВИГАЕТ:
--   * права только у `service_role`. Роль `authenticated` не получает ничего —
--     ни на эту функцию, ни через неё. Это проверяет сценарий
--     `tests/db4/09_release_artifact_worker.sql` настоящим вызовом, а не
--     чтением грантов;
--   * функция ТОЛЬКО читает. Ни одной записи, ни одного побочного эффекта;
--   * в выдаче нет ни PII, ни имён, ни исходных имён файлов — только
--     идентификаторы, хеши и ссылки на ревизии, то есть ровно то, из чего
--     собирается логическое содержимое артефакта;
--   * модуль 4 она не открывает: человеческая поверхность модуля закрыта
--     флагом и отозванными правами, и настоящая миграция их не трогает.
--
-- Область запроса намеренно НЕ ограничена одним проектом: воркер — системный
-- процесс, а не сессия арендатора, и очередь у него общая. Изоляция арендаторов
-- живёт в человеческом контуре (RLS, `_authorize_project_human`), и эта функция
-- туда не относится.

begin;

create function projectceo_product_api.list_release_artifact_backlog(
  max_rows integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_limit integer;
  v_data jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 1000 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"RELEASE_BACKLOG_LIMIT_INVALID"}'::jsonb
    );
  end if;
  v_limit := max_rows;

  select coalesce(jsonb_agg(item order by item ->> 'productionPackageVersionId'), '[]'::jsonb)
  into v_data
  from (
    select jsonb_build_object(
      'organizationId', ppv.organization_id,
      'projectId', ppv.project_id,
      'packageId', ppv.package_id,
      'productionPackageVersionId', ppv.production_package_version_id,
      'versionNo', ppv.version_no,
      'previousVersionId', ppv.previous_version_id,
      'baselineId', ppv.baseline_id,
      'exactRevisionRefs', ppv.semantic_content -> 'exactRevisionRefs',
      'semanticHash', 'sha256:' || encode(ppv.semantic_digest, 'hex'),
      -- Ревизия состояния проекта нужна воркеру для `expected_state_revision`.
      -- Между чтением и вызовом она может сдвинуться — тогда сборка ответит
      -- stale_state, и это нормальный исход, а не ошибка воркера.
      'stateRevision', pw.state_revision
    ) item
    from projectceo_product.production_package_versions ppv
    join project_intelligence.project_workflows pw
      on pw.organization_id = ppv.organization_id
     and pw.project_id = ppv.project_id
    where not exists (
      select 1
      from projectceo_product.release_artifacts ra
      where ra.organization_id = ppv.organization_id
        and ra.project_id = ppv.project_id
        and ra.production_package_version_id =
          ppv.production_package_version_id
        and ra.format = 'logical_json'
    )
    -- Порядок детерминированный: два параллельных воркера обязаны видеть одну
    -- очередь в одном порядке, иначе «повтор» перестал бы быть повтором.
    order by ppv.organization_id,
      ppv.project_id,
      ppv.production_package_version_id collate "C"
    limit v_limit
  ) rows;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-release-worker/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

alter function projectceo_product_api.list_release_artifact_backlog(integer)
  owner to pi_table_owner;

revoke all on function
  projectceo_product_api.list_release_artifact_backlog(integer)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function
  projectceo_product_api.list_release_artifact_backlog(integer)
  to service_role;

-- Дверь, открытая не тому, — это не дверь, а дыра. Миграция обязана упасть
-- здесь, если права разошлись с замыслом.
do $guard$
begin
  if pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_product_api.list_release_artifact_backlog(integer)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_RELEASE_BACKLOG_REACHABLE_BY_AUTHENTICATED';
  end if;
  if pg_catalog.has_function_privilege(
    'anon',
    'projectceo_product_api.list_release_artifact_backlog(integer)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_RELEASE_BACKLOG_REACHABLE_BY_ANON';
  end if;
  if not pg_catalog.has_function_privilege(
    'service_role',
    'projectceo_product_api.list_release_artifact_backlog(integer)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_RELEASE_BACKLOG_UNREACHABLE_BY_WORKER';
  end if;

  -- Сборка артефакта как была системной, так и остаётся: настоящая миграция
  -- прав на неё не выдаёт и не отбирает.
  if pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_product_api.build_release_artifact(uuid, jsonb, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_RELEASE_BUILD_REACHABLE_BY_AUTHENTICATED';
  end if;
end
$guard$;

commit;
