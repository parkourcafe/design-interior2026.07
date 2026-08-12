\set ON_ERROR_STOP on

-- E0R, последний шаг: закрытое осталось закрытым.
--
-- Позитивная цепочка прошла целиком — значит движок инкремента 2 работает. Это
-- половина доказательства. Вторая половина в том, что доказали мы его НЕ ценой
-- открытия: `anon`, `authenticated` и `service_role` не получили ни одного
-- права V2/V3, а тестовая роль не разрослась за пределы выданных пяти
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
  -- 1. Восемь человеческих RPC V2/V3 по-прежнему недоступны всем трём
  --    PostgREST-ролям. `review_change_impact`/`replay_review_change_impact`
  --    здесь больше нет: DEC-033 вывел их из закрытого множества в V1, и их
  --    проверяют отдельно, положительно, ниже.
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
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
  --    выборочная: ровно пять функций — инкремент 1 (`create_change`) и его
  --    replay-обёртка, V1 Impact (`review_change_impact`) и его
  --    replay-обёртка, открытые скриптом среды, плюс читающая RPC рабочего
  --    пространства. Проверка по счётчику ловит и то, чего сегодня нет:
  --    функция, добавленная в схему завтра и выданная по недосмотру, уронит
  --    прогон.
  select procedure.proname into v_reachable
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    and procedure.proname not in (
      'submit_change_request', 'replay_submit_change_request',
      'review_change_impact', 'replay_review_change_impact',
      'get_execution_delivery'
    )
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_AUTHENTICATED_SURFACE_WIDER_THAN_INCREMENT_1:%', v_reachable;
  end if;

  -- V1 Impact открыт: `authenticated` обязана видеть обе двери
  -- (review_change_impact и её replay-обёртку) после скрипта среды.
  select signature into v_missing
  from unnest(array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'DB5_V1_IMPACT_REVIEW_NOT_ENABLED:%', v_missing;
  end if;

  -- 3. `service_role` в схеме модуля — ровно пять воркерных вызовов
  --    (`build_construction_handover` плюс четыре V1 Impact), ни одной
  --    человеческой операции, и БЕЗ прежней двери расчёта с произвольной
  --    глубиной (DEC-033 §8 закрыл её и для `service_role`).
  select procedure.proname into v_reachable
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    and procedure.proname not in (
      'build_construction_handover',
      'calculate_change_impact_policy_bound', 'list_change_impact_backlog',
      'record_change_impact_worker_failure', 'redrive_change_impact_worker_failure'
    )
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_SERVICE_ROLE_GOT_HUMAN_OPERATION:%', v_reachable;
  end if;

  select signature into v_missing
  from unnest(array[
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)',
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)',
    'projectceo_m4_api.record_change_impact_worker_failure(uuid, uuid, text, integer)',
    'projectceo_m4_api.redrive_change_impact_worker_failure(uuid, uuid)'
  ]) signature
  where not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'DB5_WORKER_RPC_LOST_SYSTEM_GRANT:%', v_missing;
  end if;

  if pg_catalog.has_function_privilege(
    'service_role',
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'DB5_RAW_IMPACT_RPC_REACHABLE_BY_SERVICE_ROLE_AFTER_RUN';
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

  -- 5. Тестовая роль не разрослась: те же пять ЯВНЫХ грантов на функции и ни
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
  if v_count <> 5 then
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
