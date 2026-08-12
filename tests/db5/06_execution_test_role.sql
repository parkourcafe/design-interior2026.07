\set ON_ERROR_STOP on

-- E0R, шаг 3: отдельная тестовая роль для позитивной цепочки инкремента 2.
--
-- ЗАЧЕМ ОНА, А НЕ `authenticated`. Позитивная цепочка обязана вызвать
-- человеческие RPC инкремента 2, а `authenticated` для них закрыт навсегда:
-- `20260810070000` отзывает их по схеме, `enable-m4-increment-1.sql` намеренно
-- НЕ возвращает и падает `PROJECTCEO_M4_INCREMENT_2_LEAKED`, если бы вернул.
-- Открыть их `authenticated` ради прогона значило бы доказать работу движка,
-- сняв ровно тот запрет, ради которого guardrail'ы написаны.
--
-- ЗАЧЕМ ОНА, А НЕ `service_role`. Это человеческие операции. Системная роль их
-- не имеет и иметь не должна — `10_schema_security.sql` роняет прогон
-- (`DB5_EXECUTOR_ROLE_BOUNDARY_BROKEN`), если у `service_role` появится
-- `submit_change_request` или `accept_milestone`.
--
-- ЧЕМ ОБЕСПЕЧЕНА ИЗОЛЯЦИЯ. Тремя вещами, и ни одна из них не «невидимость»:
--
--   1. роль живёт только внутри одноразового контейнера DB5, поднятого с
--      `--network none` и удаляемого после прогона. Снаружи к этой базе нет
--      сетевого пути вообще — ни у PostgREST, ни у кого-либо ещё;
--   2. её нет ни в одной миграции, поэтому в постоянной схеме она не
--      появляется (проверяется статически в `static-boundary.test.ts`
--      сканированием всех файлов `supabase/migrations/`);
--   3. у неё нет членства ни в одну сторону, шесть явных грантов на функции и
--      ноль табличных прав — то есть даже при доступе она не сильнее, чем
--      описано ниже.
--
-- Чего НЕ следует утверждать: ни `nologin`, ни отсутствие имени в
-- `supabase/config.toml` сами по себе не делают роль недоступной PostgREST.
-- `config.toml` перечисляет схемы, а не роли; `nologin` запрещает прямой вход,
-- но не `set role` из уже установленной сессии. Изоляция здесь держится на
-- пунктах 1–3, а не на этих двух свойствах. Постоянные гранты файл не трогает.
--
-- ЧТО РОЛЬ НЕ ДАЁТ. Identity человека она не подменяет: `auth.uid()` читает
-- `request.jwt.claim.sub`, и `_authorize_package_human` по-прежнему требует
-- активного членства в организации, в проекте и наличия capability. Роль базы
-- отвечает только за право ВЫЗВАТЬ функцию; кто её вызвал — по-прежнему решает
-- проверенная человеческая identity. Поэтому позитивная цепочка доказывает
-- авторизацию, а не обходит её.

create role pi_db5_execution_tester
  nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole
  noreplication;

grant usage on schema projectceo_m4_api to pi_db5_execution_tester;

-- Минимально необходимое: ровно шесть человеческих RPC, которые вызывает
-- позитивная цепочка. `submit_change_request` сюда не входит — он инкремента 1
-- и вызывается ролью `authenticated`, как в жизни. `replay_*` не входят —
-- цепочка их не зовёт. Воркерные RPC не входят — они системные.
grant execute on function
  projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text),
  projectceo_m4_api.define_milestone(uuid, uuid, text, text, jsonb, bigint, text),
  projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text),
  projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text),
  projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text),
  projectceo_m4_api.register_handover_document(uuid, uuid, text, text, text, text, bigint, text)
  to pi_db5_execution_tester;

do $db5_test_role_isolation$
declare
  v_role pg_catalog.pg_roles%rowtype;
  v_problem text;
  v_count bigint;
begin
  select * into v_role
  from pg_catalog.pg_roles
  where rolname = 'pi_db5_execution_tester';
  if not found then
    raise exception 'DB5_TEST_ROLE_MISSING';
  end if;

  -- 1. Атрибуты роли. `nologin` — она не входная точка; `nobypassrls` — она не
  --    сильнее `authenticated`; остальное — чтобы «тестовая» не означало
  --    «привилегированная».
  if v_role.rolcanlogin
     or v_role.rolsuper
     or v_role.rolbypassrls
     or v_role.rolinherit
     or v_role.rolcreatedb
     or v_role.rolcreaterole
     or v_role.rolreplication then
    raise exception 'DB5_TEST_ROLE_ATTRIBUTES_UNSAFE';
  end if;

  -- 2. Никакого членства ни в одну сторону: роль не наследует прав чужих
  --    ролей, и ни одна роль не наследует её прав. Иначе изоляция была бы
  --    словом, а не фактом.
  select format('member_of:%s', pg_catalog.pg_get_userbyid(member.roleid))
  into v_problem
  from pg_catalog.pg_auth_members member
  where member.member = v_role.oid
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_TEST_ROLE_NOT_ISOLATED:%', v_problem;
  end if;

  select format('granted_to:%s', pg_catalog.pg_get_userbyid(member.member))
  into v_problem
  from pg_catalog.pg_auth_members member
  where member.roleid = v_role.oid
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_TEST_ROLE_NOT_ISOLATED:%', v_problem;
  end if;

  -- 3. Явных грантов на функции — ровно шесть, и ровно те. Утверждение именно
  --    про ЯВНЫЕ записи в ACL, а не про «доступ только к шести функциям во всей
  --    базе»: право, доставшееся через `PUBLIC`, здесь не считается, и
  --    `has_function_privilege` для такой функции вернул бы true. Поэтому
  --    считаются записи ACL, а недостижимость всего остального обеспечивается
  --    не этим счётчиком, а тем, что роли больше ничего не выдано (пункты 4-6).
  select format('%I.%I', namespace.nspname, procedure.proname)
  into v_problem
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  cross join lateral aclexplode(coalesce(
    procedure.proacl,
    pg_catalog.acldefault('f'::"char", procedure.proowner)
  )) acl
  where acl.grantee = v_role.oid
    and (
      namespace.nspname <> 'projectceo_m4_api'
      or procedure.proname not in (
        'review_change_impact', 'define_milestone', 'register_photo_evidence',
        'review_photo_evidence', 'accept_milestone', 'register_handover_document'
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_TEST_ROLE_UNEXPECTED_FUNCTION_GRANT:%', v_problem;
  end if;

  select count(distinct procedure.oid) into v_count
  from pg_catalog.pg_proc procedure
  cross join lateral aclexplode(coalesce(
    procedure.proacl,
    pg_catalog.acldefault('f'::"char", procedure.proowner)
  )) acl
  where acl.grantee = v_role.oid;
  if v_count <> 6 then
    raise exception 'DB5_TEST_ROLE_EXPLICIT_FUNCTION_ACL_COUNT:%', v_count;
  end if;

  -- 4. Схемы — ровно одна.
  select namespace.nspname into v_problem
  from pg_catalog.pg_namespace namespace
  cross join lateral aclexplode(coalesce(
    namespace.nspacl,
    pg_catalog.acldefault('n'::"char", namespace.nspowner)
  )) acl
  where acl.grantee = v_role.oid
    and namespace.nspname <> 'projectceo_m4_api'
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_TEST_ROLE_UNEXPECTED_SCHEMA_GRANT:%', v_problem;
  end if;

  -- 5. Ни одной таблицы, вьюхи или последовательности. Прямой доступ к данным
  --    модуля закрыт всем, и тестовая роль исключением не становится.
  select format('%I.%I', namespace.nspname, relation.relname)
  into v_problem
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  cross join lateral aclexplode(coalesce(
    relation.relacl,
    pg_catalog.acldefault(
      (case when relation.relkind = 'S' then 's' else 'r' end)::"char",
      relation.relowner
    )
  )) acl
  where acl.grantee = v_role.oid
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_TEST_ROLE_UNEXPECTED_TABLE_GRANT:%', v_problem;
  end if;

  -- 6. Роль не достаёт до воркерных RPC и до инкремента 1. Тестовая роль —
  --    это человек с правами инкремента 2, а не универсальный ключ.
  select signature into v_problem
  from unnest(array[
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)',
    'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
    'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(
    'pi_db5_execution_tester', signature, 'EXECUTE'
  )
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_TEST_ROLE_OVERREACHED:%', v_problem;
  end if;

  -- 7. Открытие тестовой роли не имеет права задеть PostgREST-роли. Проверка
  --    стоит здесь, а не только в `90_...`, потому что ошибиться легче всего в
  --    момент выдачи прав.
  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.define_milestone(uuid, uuid, text, text, jsonb, bigint, text)',
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.register_handover_document(uuid, uuid, text, text, text, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_INCREMENT_2_LEAKED_TO_POSTGREST_ROLE:%', v_problem;
  end if;
end
$db5_test_role_isolation$;

select 'DB5_TEST_ROLE_OK' as result;
