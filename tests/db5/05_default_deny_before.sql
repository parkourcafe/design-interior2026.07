\set ON_ERROR_STOP on

-- E0R, шаг 1: состояние сразу после цепочки миграций, до единого включения.
--
-- Зачем этот файл существует. Прежняя редакция DB5 применяла миграции и сразу
-- шла в позитивную цепочку под ролью `authenticated`. Она падала — потому что
-- guardrail'ы M3 и M4 отозвали у `authenticated` ровно те права, которыми
-- сценарий пользовался, — и падение никто не видел, так как DB5 не стоял ни в
-- одном обязательном гейте. Чинить это возвращением прав `authenticated`
-- нельзя: тогда позитивный прогон доказывал бы работу движка ЦЕНОЙ снятия
-- запрета, ради которого guardrail'ы и написаны.
--
-- Поэтому порядок такой: сначала доказать, что закрыто (здесь), потом
-- открыть ровно то, что разрешено средой, потом провести позитивную цепочку
-- под ОТДЕЛЬНОЙ тестовой ролью (`06_execution_test_role.sql`), и в конце
-- доказать, что закрытое так и осталось закрытым (`90_default_deny_after.sql`).
--
-- Файл обязан выполняться ДО `enable-m3-publication.sql` и
-- `enable-m4-increment-1.sql`.

do $db5_default_deny_before$
declare
  v_reachable text;
  v_missing text;
begin
  -- 1. Десять человеческих RPC инкремента 2 недоступны никому из трёх
  --    PostgREST-ролей. Ни одна среда их не открывает — это `revoked_from_
  --    authenticated` в `m4-surface.ts`, и сюда же попадают две человеческие
  --    RPC без команды (`define_milestone`, `register_handover_document`).
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)',
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)',
    'projectceo_m4_api.define_milestone(uuid, uuid, text, text, jsonb, bigint, text)',
    'projectceo_m4_api.register_handover_document(uuid, uuid, text, text, text, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_INCREMENT_2_REACHABLE_BEFORE_ENABLE:%', v_reachable;
  end if;

  -- 2. Инкремент 1 закрыт по умолчанию: скрипт среды его ещё не применяли.
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
    'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)',
    'projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)',
    'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_INCREMENT_1_REACHABLE_BEFORE_ENABLE:%', v_reachable;
  end if;

  -- 3. Публикация M3 тоже закрыта по умолчанию — на ней и падала прежняя
  --    редакция DB5, поэтому проверка стоит именно здесь, а не подразумевается.
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text)',
    'projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text)',
    'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_M3_PUBLICATION_REACHABLE_BEFORE_ENABLE:%', v_reachable;
  end if;

  -- 4. Воркерные RPC модуля недоступны человеческим ролям — и доступны
  --    системной. Второе утверждается ЯВНО: молчаливый отзыв прав у
  --    `service_role` превратил бы воркерный шаг цепочки в необъяснимое
  --    падение вместо понятного отказа.
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)',
    -- V1 Impact: те же правила для новых воркерных дверей — человеческим ролям
    -- недоступны, системной доступны.
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_WORKER_RPC_REACHABLE_BY_HUMAN_ROLE:%', v_reachable;
  end if;

  select signature into v_missing
  from unnest(array[
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)',
    -- V1 Impact: те же правила для новых воркерных дверей — человеческим ролям
    -- недоступны, системной доступны.
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'DB5_WORKER_RPC_LOST_SYSTEM_GRANT:%', v_missing;
  end if;

  -- 5. Читающая RPC рабочего пространства обязана уцелеть: она — единственное
  --    исключение guardrail'а `20260810070000`, и без неё падение сценария
  --    означало бы поломку чтения проекта, а не закрытость модуля.
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.get_execution_delivery(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'DB5_DELIVERY_READ_LOST';
  end if;

  -- 6. Тестовой роли ещё нет. Если она осталась от прошлого прогона, значит
  --    контейнер не одноразовый, и весь смысл изоляции потерян.
  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'pi_db5_execution_tester'
  ) then
    raise exception 'DB5_TEST_ROLE_ALREADY_EXISTS';
  end if;
end
$db5_default_deny_before$;

select 'DB5_DEFAULT_DENY_BEFORE_OK' as result;
