\set ON_ERROR_STOP on

-- E0R, последний шаг: закрытое осталось закрытым.
--
-- Позитивная цепочка прошла целиком — значит движок инкремента 2 работает. Это
-- половина доказательства. Вторая половина в том, что доказали мы его НЕ ценой
-- открытия: `anon`, `authenticated` и `service_role` не получили ни одного
-- права инкремента 2, а тестовая роль не разрослась за пределы выданных шести
-- функций.
--
-- Проверка стоит в конце намеренно. Между `06_...` и этим файлом успели
-- отработать все сценарии, конкурентный прогон и перезапуск базы: если бы
-- что-то из них выдало права молча, здесь это упадёт.

do $db5_default_deny_after$
declare
  v_reachable text;
  v_missing text;
  v_count bigint;
  v_role_oid oid;
begin
  -- 1. Десять человеческих RPC инкремента 2 по-прежнему недоступны всем трём
  --    PostgREST-ролям — тот же список, что в `05_default_deny_before.sql`.
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
    raise exception 'DB5_INCREMENT_2_REACHABLE_AFTER_RUN:%', v_reachable;
  end if;

  -- 2. Поверхность `authenticated` в схеме модуля исчерпывающая, а не
  --    выборочная: ровно три функции — инкремент 1 и его replay-обёртка,
  --    открытые скриптом среды, плюс читающая RPC рабочего пространства.
  --    Проверка по счётчику ловит и то, чего сегодня нет: функция, добавленная
  --    в схему завтра и выданная по недосмотру, уронит прогон.
  select procedure.proname into v_reachable
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    and procedure.proname not in (
      'submit_change_request', 'replay_submit_change_request',
      'get_execution_delivery'
    )
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_AUTHENTICATED_SURFACE_WIDER_THAN_INCREMENT_1:%', v_reachable;
  end if;

  -- 3. `service_role` в схеме модуля — ровно два воркерных вызова, ни одной
  --    человеческой операции.
  select procedure.proname into v_reachable
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    and procedure.proname not in (
      'calculate_change_impact', 'build_construction_handover',
      -- V1 Impact: воркерные двери расчёта, открытые только системной роли
      -- (`20260812010000`).
      'calculate_change_impact_policy_bound', 'list_change_impact_backlog'
    )
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_SERVICE_ROLE_GOT_HUMAN_OPERATION:%', v_reachable;
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

  -- 4. `anon` не достаёт до схемы модуля вовсе.
  select procedure.proname into v_reachable
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_ANON_REACHED_MODULE:%', v_reachable;
  end if;

  -- 5. Тестовая роль не разрослась: те же шесть ЯВНЫХ грантов на функции и ни
  --    одного табличного. Счётчик говорит про записи ACL, а не про то, сколько
  --    функций роль вообще способна вызвать.
  select oid into v_role_oid
  from pg_catalog.pg_roles
  where rolname = 'pi_db5_execution_tester';
  if v_role_oid is null then
    raise exception 'DB5_TEST_ROLE_DISAPPEARED';
  end if;

  select count(distinct procedure.oid) into v_count
  from pg_catalog.pg_proc procedure
  cross join lateral aclexplode(coalesce(
    procedure.proacl,
    pg_catalog.acldefault('f'::"char", procedure.proowner)
  )) acl
  where acl.grantee = v_role_oid;
  if v_count <> 6 then
    raise exception 'DB5_TEST_ROLE_EXPLICIT_FUNCTION_ACL_COUNT_AFTER_RUN:%', v_count;
  end if;

  select count(*) into v_count
  from pg_catalog.pg_class relation
  cross join lateral aclexplode(coalesce(
    relation.relacl,
    pg_catalog.acldefault(
      (case when relation.relkind = 'S' then 's' else 'r' end)::"char",
      relation.relowner
    )
  )) acl
  where acl.grantee = v_role_oid;
  if v_count <> 0 then
    raise exception 'DB5_TEST_ROLE_GAINED_TABLE_GRANT:%', v_count;
  end if;

  -- 6. Других тестовых ролей в кластере не завелось.
  select count(*) into v_count
  from pg_catalog.pg_roles
  where rolname like 'pi_db5%';
  if v_count <> 1 then
    raise exception 'DB5_UNEXPECTED_TEST_ROLE_COUNT:%', v_count;
  end if;
end
$db5_default_deny_after$;

select 'DB5_DEFAULT_DENY_AFTER_OK' as result;
