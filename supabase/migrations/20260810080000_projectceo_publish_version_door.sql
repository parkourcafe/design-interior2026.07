-- Дверь для публикации версии графа в уже отданной схеме.
--
-- Основание: разбор `REMHAOS_OPTIONS_BASELINE_DESCRIPTOR_2026-08-10.md` §0a и §8,
-- путь 1. Решение владельца от 10.08.2026 — «рекомендую дверь».
--
-- Зачем. `projectceo_product_api.publish_project_baseline` требует существующую
-- строку `project_intelligence.project_versions` и иначе отвечает
-- `P1104 not_found {"entity":"graphVersion"}` (`20260717101000`, строки
-- 1940–1951). Версию создаёт `project_intelligence_api.publish_version`, но эта
-- схема намеренно не отдана Data API (`supabase/config.toml`;
-- `verify-runtime.mjs` требует от неё 406). То есть браузерный путь не мог
-- создать версию графа вовсе, и выход M3 был недостижим не из-за дескриптора,
-- а из-за отсутствия предыдущего шага.
--
-- Это тот же класс дефекта, что закрыла дверь `projectceo_api.review_source`
-- (`20260810050000`), и закрывается он так же.
--
-- Прав не добавляет — проверено на живой базе:
--
--   * `security invoker` — тело выполняется от имени вызывающего;
--   * у роли `authenticated` уже есть `usage` на `project_intelligence_api`
--     и `execute` на `publish_version`;
--   * авторизацию по-прежнему делает внутренняя функция через
--     `_human_context(project_id, 'publish_version')`, а сама capability уже
--     отображена на `publish_baseline` (`20260717090000`, строка 1204) и
--     принадлежит ролям `owner_lead` и `architect`.
--
-- Меняется ровно одно: достижимость через Data API.
--
-- ЧТО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ. Она не заводит команду в контракте и не открывает
-- пользователю «опубликовать версию» как отдельное действие. По A′ состав
-- версии выводит сервер, а человек видит один preview и одно подтверждение;
-- дверь — предпосылка для сборщика, а не поверхность для браузера.

begin;

create function projectceo_api.publish_version(
  project_id uuid,
  expected_latest_version_id text,
  expected_state_revision bigint,
  label text,
  selected_revisions jsonb,
  idempotency_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $function$
  select project_intelligence_api.publish_version(
    project_id,
    expected_latest_version_id,
    expected_state_revision,
    label,
    selected_revisions,
    idempotency_key
  );
$function$;

alter function projectceo_api.publish_version(
  uuid, text, bigint, text, jsonb, text
) owner to pi_table_owner;

revoke all on function projectceo_api.publish_version(
  uuid, text, bigint, text, jsonb, text
) from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function projectceo_api.publish_version(
  uuid, text, bigint, text, jsonb, text
) to authenticated;

-- Дверь без комнаты — это 500 у пользователя. Если внутренняя функция переедет
-- или сменит сигнатуру, миграция обязана упасть здесь, а не в браузере.
do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'project_intelligence_api'
      and p.proname = 'publish_version'
      and pg_catalog.pg_get_function_identity_arguments(p.oid)
          = 'project_id uuid, expected_latest_version_id text, expected_state_revision bigint, label text, selected_revisions jsonb, idempotency_key text'
  ) then
    raise exception 'PROJECTCEO_PUBLISH_VERSION_TARGET_MISSING';
  end if;
  if not has_function_privilege(
    'authenticated',
    'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_PUBLISH_VERSION_DOOR_UNREACHABLE';
  end if;
end
$guard$;

commit;
