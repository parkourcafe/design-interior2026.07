-- Дверь для решения по источнику в уже отданной схеме.
--
-- Решение пишет `project_intelligence_api.review_claim`, но эта схема
-- намеренно не отдана Data API (`supabase/config.toml`; `verify-runtime.mjs`
-- требует от неё 406). Из браузера вызов не находился PostgREST, ошибка не
-- ложилась ни на один SQLSTATE и выходила наружу как 500 — это поймал гейт AP5.
--
-- Здесь заводится тонкая делегирующая функция в `projectceo_api`, которая
-- отдана Data API. Она НЕ добавляет ни одного права:
--
--   * `security invoker` — тело выполняется от имени вызывающего, а не владельца;
--   * `authenticated` и без неё имеет `usage` на `project_intelligence_api`
--     и `execute` на `review_claim` (проверено на живой базе);
--   * авторизацию по-прежнему делает внутренняя функция через
--     `_human_context(project_id, 'review_claim')` и request-claims.
--
-- Меняется ровно одно: достижимость через Data API. Расширять список отданных
-- схем ради одной команды было бы куда большей правкой — и она противоречила бы
-- контракту окружения, который требует держать `project_intelligence_api`
-- закрытой.

begin;

create function projectceo_api.review_source(
  project_id uuid,
  target_revision_id text,
  expected_revision_id text,
  expected_state_revision bigint,
  decision text,
  idempotency_key text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_constraint text;
begin
  return project_intelligence_api.review_claim(
    project_id,
    target_revision_id,
    expected_revision_id,
    expected_state_revision,
    decision,
    idempotency_key
  );
exception
  -- Повторное решение по уже отрецензированной ревизии упирается в
  -- `human_reviews_target_revision_key` и выходит сырым 23505: этот SQLSTATE
  -- не отображён ни на один код ошибки приложения, то есть снова 500 у
  -- пользователя. Смысл же ровно тот, который в семье P1 уже есть, — P1009
  -- scope_conflict. Ловится строго это ограничение; любое другое нарушение
  -- уникальности пробрасывается как было, чтобы дверь не глушила чужие ошибки.
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'human_reviews_target_revision_key' then
      raise;
    end if;
    raise exception 'REVIEW_ALREADY_DECIDED' using errcode = 'P1009';
end;
$function$;

alter function projectceo_api.review_source(
  uuid, text, text, bigint, text, text
) owner to pi_table_owner;

revoke all on function projectceo_api.review_source(
  uuid, text, text, bigint, text, text
) from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function projectceo_api.review_source(
  uuid, text, text, bigint, text, text
) to authenticated;

-- Дверь без комнаты — это 500 у пользователя, ровно то, что чинится. Если
-- внутренняя функция когда-нибудь переедет или сменит сигнатуру, миграция
-- обязана упасть здесь, а не в браузере.
do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'project_intelligence_api'
      and p.proname = 'review_claim'
      and pg_catalog.pg_get_function_identity_arguments(p.oid)
          = 'project_id uuid, target_revision_id text, expected_revision_id text, expected_state_revision bigint, decision text, idempotency_key text'
  ) then
    raise exception 'PROJECTCEO_SOURCE_REVIEW_TARGET_MISSING';
  end if;
  if not has_function_privilege(
    'authenticated',
    'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_SOURCE_REVIEW_DOOR_UNREACHABLE';
  end if;
end
$guard$;

commit;
