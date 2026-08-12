\set ON_ERROR_STOP on

-- E0R, последний шаг: закрытое осталось закрытым.
--
-- Позитивная цепочка прошла целиком — значит движок инкремента 2 работает. Это
-- половина доказательства. Вторая половина в том, что доказали мы его НЕ ценой
-- открытия: `anon`, `authenticated` и `service_role` не получили ни одного
-- неавторизованного права, а тестовая роль не разрослась за пределы выданных
-- семи функций.
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
  -- 1. Девять человеческих RPC, не открытых никем, по-прежнему недоступны всем
  --    трём PostgREST-ролям. Восемь — V2/V3 (A6 не авторизовал). Девятая —
  --    `acknowledge_impact_truncation`: DEC-034 закрыла её навсегда, тем же
  --    контуром, что V2/V3, а не тем же, что `review_change_impact` — она
  --    недоступна `authenticated` тоже, не только `anon`/`service_role`.
  --
  --    Список короче, чем в `05_default_deny_before.sql`, ровно на две двери
  --    `review_change_impact`: их открывает `enable-m4-v1-impact.sql` по GO на
  --    вертикаль V1 от 12.08.2026. Они не выпали из-под проверки — они
  --    проверяются ниже, отдельным пунктом и строже: закрыты для `anon` и
  --    `service_role`, открыты ровно для `authenticated`.
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
    'projectceo_m4_api.register_handover_document(uuid, uuid, text, text, text, text, bigint, text)',
    'projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_INCREMENT_2_REACHABLE_AFTER_RUN:%', v_reachable;
  end if;

  -- 1b. Две двери V1 открыты РОВНО человеческой сессии. Открытие вертикали не
  --     имеет права протечь ни в публичную роль, ни в системную: `anon` — это
  --     интернет, а `service_role` — это воркер, который влияние считает, но
  --     не рассматривает. `acknowledge_impact_truncation` сюда не входит
  --     (DEC-034) — она недоступна вообще никому, проверено пунктом 1 выше.
  select format('%s:%s', role_name, signature) into v_reachable
  from unnest(array['anon', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_V1_IMPACT_REACHABLE_BY_WRONG_ROLE:%', v_reachable;
  end if;

  select signature into v_missing
  from unnest(array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'DB5_V1_IMPACT_LOST_HUMAN_GRANT:%', v_missing;
  end if;

  -- 2. Поверхность `authenticated` в схеме модуля исчерпывающая, а не
  --    выборочная: ровно шесть функций — инкремент 1 и его replay-обёртка,
  --    читающая RPC рабочего пространства и две двери V1, открытые скриптами
  --    среды. Проверка по счётчику ловит и то, чего сегодня нет: функция,
  --    добавленная в схему завтра и выданная по недосмотру, уронит прогон.
  select procedure.proname into v_reachable
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    and procedure.proname not in (
      'submit_change_request', 'replay_submit_change_request',
      'get_execution_delivery',
      -- Открыты GO на V1 (`enable-m4-v1-impact.sql`).
      'review_change_impact', 'replay_review_change_impact'
      -- `acknowledge_impact_truncation` сюда НЕ входит (DEC-034): если она
      -- когда-нибудь окажется доступна `authenticated`, эта проверка обязана
      -- её поймать, а не молча пропустить как «одну из открытых».
    )
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_AUTHENTICATED_SURFACE_WIDER_THAN_AUTHORISED:%', v_reachable;
  end if;

  -- 3. `service_role` в схеме модуля — ровно два воркерных вызова, ни одной
  --    человеческой операции. `calculate_change_impact` (сырая) сюда НЕ входит
  --    (DEC-034) — та же логика: если она снова окажется доступна
  --    `service_role`, проверка обязана это поймать.
  select procedure.proname into v_reachable
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    and procedure.proname not in (
      'build_construction_handover',
      -- V1 Impact: воркерные двери расчёта, открытые только системной роли
      -- (`20260812010000`).
      'calculate_change_impact_policy_bound', 'list_change_impact_backlog',
      -- OWNER REVIEW (поверх DEC-034/035): дверь воркера, записывающая
      -- durable отказ (DEC-036) — та же системная identity.
      'record_change_impact_worker_failure'
    )
  limit 1;
  if v_reachable is not null then
    raise exception 'DB5_SERVICE_ROLE_GOT_HUMAN_OPERATION:%', v_reachable;
  end if;

  if pg_catalog.has_function_privilege(
    'service_role',
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'DB5_RAW_IMPACT_RPC_REACHABLE_BY_SERVICE_ROLE_AFTER_RUN';
  end if;

  select signature into v_missing
  from unnest(array[
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)',
    -- V1 Impact: те же правила для новых воркерных дверей — человеческим ролям
    -- недоступны, системной доступны.
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)',
    'projectceo_m4_api.record_change_impact_worker_failure(uuid, uuid, text, text, jsonb)'
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
  --    одного табличного. `acknowledge_impact_truncation` роли не выдана
  --    (DEC-034 закрыла её навсегда, поверх решения об усечении 12.08) —
  --    поэтому шесть, не семь. Счётчик говорит про записи ACL, а не про то,
  --    сколько функций роль вообще способна вызвать.
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
