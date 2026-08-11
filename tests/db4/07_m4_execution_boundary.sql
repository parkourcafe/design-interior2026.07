\set ON_ERROR_STOP on

-- Прямой обход приложения через Data API: операции модуля 4 при выключенном
-- модуле.
--
-- Тот же класс проверки, что и `05_m3_publication_guardrail.sql`, и по тому же
-- условию владельца: если закрывается только Next.js-команда, условие не
-- выполнено. Флаг `REMHAOS_EXECUTION_ENABLED` живёт в TypeScript, а вызов
-- PostgREST до TypeScript не доходит.
--
-- Сценарий существует потому, что первая попытка закрыть эту границу
-- (`20260810070000`) её не закрыла. Она отозвала права сплошь по схеме
-- `projectceo_m4_api` — и пропустила четыре командные RPC модуля 4, живущие в
-- продуктовой схеме: выдача и подтверждение получения оставались доступны любой
-- аутентифицированной сессии. Закрывает `20260811020000`; здесь это
-- проверяется вызовами, а не чтением грантов.
--
-- Сценарий стоит ДО `enable-m4-increment-1.sql` в `run.zsh` намеренно: он
-- обязан наблюдать состояние сразу после цепочки миграций, где guardrail'ы уже
-- отозвали права, а среда ещё ничего не включала.

do $execution_closed_by_default$
declare
  v_reachable text;
begin
  select signature into v_reachable
  from unnest(array[
    -- Инкремент 1 — открыт A6, но закрыт по умолчанию до явного включения.
    'projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)',
    'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)',
    'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
    'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)',
    -- Инкремент 2 — не открыт ничем и не открывается ни одной средой.
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB4_M4_EXECUTION_GRANTED_BY_DEFAULT:%', v_reachable;
  end if;
end
$execution_closed_by_default$;

-- Права — это утверждение о доступе. Ниже проверяется сам доступ: реальные
-- вызовы из-под роли, каждый обязан упереться в 42501 insufficient_privilege ДО
-- того, как дойдёт до тела функции. Аргументы намеренно бессмысленные: если
-- отказ придёт не по правам, а по содержимому, значит вызов состоялся.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $direct_calls_denied$
declare
  v_denied int := 0;
begin
  begin
    perform projectceo_product_api.distribute_release(
      '41111111-1111-4111-8111-111111111111', 'probe',
      '32222222-2222-4222-8222-222222222222', 1, 'db4-m4-probe'
    );
    raise exception 'DB4_M4_DISTRIBUTE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_product_api.distribute_release_request_bound(
      '41111111-1111-4111-8111-111111111111', 'probe',
      '32222222-2222-4222-8222-222222222222', 1, 'db4-m4-probe'
    );
    raise exception 'DB4_M4_DISTRIBUTE_REQUEST_BOUND_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_product_api.acknowledge_release(
      '41111111-1111-4111-8111-111111111111',
      '32222222-2222-4222-8222-222222222222',
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      1, 'db4-m4-probe'
    );
    raise exception 'DB4_M4_ACKNOWLEDGE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_product_api.acknowledge_release_request_bound(
      '41111111-1111-4111-8111-111111111111',
      '32222222-2222-4222-8222-222222222222',
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      1, 'db4-m4-probe'
    );
    raise exception 'DB4_M4_ACKNOWLEDGE_REQUEST_BOUND_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_m4_api.submit_change_request(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'probe', 'probe', 'probe', 'probe', 0, 0, 1, 'db4-m4-probe'
    );
    raise exception 'DB4_M4_SUBMIT_CHANGE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- Инкремент 2: закрыт не флагом и не средой, а тем, что его никто не
  -- авторизовал. Один представитель проверяется вызовом, остальные — правами
  -- выше и сценарием классификации.
  begin
    perform projectceo_m4_api.accept_milestone(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      1, 'db4-m4-probe'
    );
    raise exception 'DB4_M4_ACCEPT_MILESTONE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  if v_denied <> 6 then
    raise exception 'DB4_M4_EXECUTION_DENIALS_EXPECTED_6_GOT_%', v_denied;
  end if;
end
$direct_calls_denied$;
rollback;

-- Точечность: закрыты команды модуля, а не работа системы. Чтение исполнения и
-- рабочего пространства обязано остаться доступным той же роли.
do $neighbours_intact$
declare
  v_broken text;
begin
  select signature into v_broken
  from unnest(array[
    'projectceo_m4_api.get_execution_delivery(uuid, uuid)',
    'projectceo_read_api.get_project_workspace_read_v9(uuid, uuid)',
    'projectceo_product_api.approve_no_change(uuid, text, text, text, bigint, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_broken is not null then
    raise exception 'DB4_M4_GUARDRAIL_OVERREACHED:%', v_broken;
  end if;
end
$neighbours_intact$;

\echo DB4_M4_EXECUTION_BOUNDARY_OK
