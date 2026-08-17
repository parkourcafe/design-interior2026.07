-- Function-level statement_timeout для двери `projectceo_api.publish_version`.
--
-- Дефект. AP5-сценарий «blocked_result_limit» (широкая звезда, >5000 узлов в
-- графе) падал ДО запуска воркера: команда `publish_baseline` получала 500 от
-- `publish_version` примерно на 8,22 секунды. Это не отказ логики публикации —
-- это `statement_timeout = 8s` роли `authenticated` (платформенный дефолт
-- Supabase), в который снапшот графа такого размера не помещается.
--
-- Почему чинится именно так. PostgREST читает `pg_proc.proconfig` вызываемой
-- RPC-функции и применяет её настройки (`set_config(..., local)`) ДО основного
-- statement запроса — ПОСЛЕ ролевых, поэтому функция выигрывает у роли. То есть
-- function-level `statement_timeout` — документированный у Supabase способ дать
-- одной заведомо тяжёлой операции больше времени, НЕ трогая ни глобальный
-- timeout, ни настройки роли `authenticated`: любой другой запрос той же роли
-- живёт в прежних 8 секундах.
--
-- Почему на двери, а не на внутренней функции. PostgREST видит только ту
-- функцию, которую вызывает, — `projectceo_api.publish_version`; proconfig
-- внутренней `project_intelligence_api.publish_version` он не читает. Настройка
-- на двери накрывает весь вложенный вызов целиком.
--
-- Почему 30 секунд. Наблюдаемый отказ — чуть за 8s на фикстуре AP5; 30s дают
-- многократный запас на медленный CI-runner, оставаясь жёсткой границей: если
-- публикация не уложилась и в 30s — это уже реальная деградация, о которой
-- обязан узнать монитор, а не молча растянутый лимит.
--
-- ЧТО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ. Не меняет глобальный `statement_timeout`, не
-- меняет `rolconfig` роли `authenticated` (и никакой другой), не трогает права,
-- сигнатуру и тело двери (`20260810080000`) и не открывает новых путей вызова.

begin;

alter function projectceo_api.publish_version(
  uuid, text, bigint, text, jsonb, text
) set statement_timeout = '30s';

-- Проверка на месте: proconfig обязан нести и новый timeout, и прежний
-- закреплённый search_path — `alter ... set` добавляет запись, а не заменяет
-- набор, и если это перестанет быть правдой, миграция обязана упасть здесь.
do $guard$
declare
  v_config text[];
begin
  select p.proconfig into v_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_api'
    and p.proname = 'publish_version'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)
        = 'project_id uuid, expected_latest_version_id text, expected_state_revision bigint, label text, selected_revisions jsonb, idempotency_key text';
  if v_config is null then
    raise exception 'PROJECTCEO_PUBLISH_VERSION_TIMEOUT_PROCONFIG_MISSING';
  end if;
  if not exists (
    select 1 from unnest(v_config) entry
    where entry = 'statement_timeout=30s'
  ) then
    raise exception 'PROJECTCEO_PUBLISH_VERSION_TIMEOUT_NOT_SET:%', v_config;
  end if;
  if not exists (
    select 1 from unnest(v_config) entry
    where entry ~ '^search_path=("")?$'
  ) then
    raise exception 'PROJECTCEO_PUBLISH_VERSION_TIMEOUT_LOST_SEARCH_PATH:%', v_config;
  end if;
end
$guard$;

commit;
