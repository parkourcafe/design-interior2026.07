-- Guardrail модуля 4, вторая попытка закрыть ту же границу — база.
--
-- Основание: `docs/canonical/remhaos-v1/REMHAOS_GUARDRAIL_DECISION_M4_FLAG.md`
-- (подписан 10.08.2026) и открытие инкремента 1 по A6/DEC-025. Миграция ничего
-- не открывает — она закрывает то, что осталось открытым.
--
-- НАХОДКА, ради которой миграция существует. `20260810070000` отозвал права
-- сплошь по схеме `projectceo_m4_api` и выглядел исчерпывающим. Он им не был:
-- четыре командные RPC модуля 4 живут в ЧУЖОЙ схеме —
--
--   projectceo_product_api.distribute_release
--   projectceo_product_api.acknowledge_release
--   projectceo_product_api.distribute_release_request_bound
--   projectceo_product_api.acknowledge_release_request_bound
--
-- — и права на них выданы роли `authenticated` в `20260717101000` и
-- `20260718124958`. Сплошной revoke по схеме M4 их не касался. То есть выдача
-- выпущенного пакета и подтверждение получения были доступны любой
-- аутентифицированной сессии через PostgREST при ВЫКЛЮЧЕННОМ модуле 4: флаг
-- `REMHAOS_EXECUTION_ENABLED` живёт в TypeScript, а вызов до TypeScript не
-- доходит.
--
-- Урок тот же, что дал guardrail модуля 3: границу модуля нельзя проверять по
-- имени схемы. Поэтому здесь отзыв поимённый, а его полнота проверяется не
-- глазами, а матрицей `lib/project-intelligence/delivery/projectceo/
-- m4-surface.ts` и сценарием `tests/db4/08_m4_surface_classification.sql`.
--
-- Что НЕ отзывается: `projectceo_m4_api.get_execution_delivery` (читающая RPC
-- рабочего пространства, исключение из `20260810070000`) и продуктовые RPC,
-- которые к модулю 4 не относятся, — `approve_no_change`, публикация,
-- одобрения. Их закрывают или открывают собственные основания.
--
-- Как открыть инкремент 1 там, где модуль намеренно включён:
-- `tests/ap1/environment/enable-m4-increment-1.sql`. Это механизм одноразовой
-- среды и default-deny до запуска M4, а НЕ production feature flag — по тому же
-- решению владельца от 11.08, что и у модуля 3.

begin;

revoke execute on function
  projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text),
  projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text),
  projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text),
  projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)
  from authenticated;

-- Запрет, который никто не проверяет, — это комментарий.
do $guard$
declare
  v_reachable text;
begin
  select signature into v_reachable
  from unnest(array[
    'projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)',
    'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'PROJECTCEO_M4_DISTRIBUTION_STILL_REACHABLE:%', v_reachable;
  end if;

  -- ...и соседи обязаны уцелеть: миграция, задевшая лишнее, ломает чтение
  -- проекта и публикацию, а это уже не guardrail, а поломка.
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.get_execution_delivery(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M4_DELIVERY_READ_LOST';
  end if;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_WORKSPACE_READ_LOST';
  end if;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_product_api.approve_no_change(uuid, text, text, text, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_APPROVE_NO_CHANGE_LOST';
  end if;
end
$guard$;

commit;
