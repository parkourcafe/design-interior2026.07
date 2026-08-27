\set ON_ERROR_STOP on

do $ap1_read_schema_security$
declare
  v_problem text;
begin
  if not exists (
    select 1
    from pg_namespace namespace
    where namespace.nspname = 'projectceo_read_api'
      and pg_get_userbyid(namespace.nspowner) = 'pi_table_owner'
  ) then
    raise exception 'AP1_READ_SCHEMA_MISSING_OR_WRONG_OWNER';
  end if;

  if to_regprocedure(
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)'
  ) is null then
    raise exception 'AP1_READ_RPC_MISSING';
  end if;
  if to_regprocedure(
    'projectceo_read_api.get_project_workspace_read_unfiltered(uuid,uuid)'
  ) is null then
    raise exception 'AP1_UNFILTERED_READ_INTERNAL_MISSING';
  end if;
  if to_regprocedure(
    'projectceo_product_api.distribute_release_request_bound(uuid,text,uuid,bigint,text)'
  ) is null or to_regprocedure(
    'projectceo_product_api.acknowledge_release_request_bound(uuid,uuid,text,bigint,text)'
  ) is null then
    raise exception 'AP1_REQUEST_BOUND_RELEASE_RPC_MISSING';
  end if;
  if to_regprocedure(
    'projectceo_m4_api.replay_submit_change_request(uuid,uuid,text,text,text,text,bigint,integer,text)'
  ) is null or to_regprocedure(
    'projectceo_m4_api.replay_review_change_impact(uuid,uuid,text,text,text,text)'
  ) is null or to_regprocedure(
    'projectceo_m4_api.replay_register_photo_evidence(uuid,uuid,text,text,text,timestamptz,text,text)'
  ) is null or to_regprocedure(
    'projectceo_m4_api.replay_review_photo_evidence(uuid,uuid,text,text,text)'
  ) is null or to_regprocedure(
    'projectceo_m4_api.replay_accept_milestone(uuid,uuid,text)'
  ) is null then
    raise exception 'AP1_M4_REPLAY_RPC_MISSING';
  end if;

  select format(
    '%I.%I(%s)',
    namespace.nspname,
    procedure.proname,
    pg_get_function_identity_arguments(procedure.oid)
  )
  into v_problem
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_read_api'
    and (
      not procedure.prosecdef
      or procedure.provolatile <> 's'
      or pg_get_userbyid(procedure.proowner) <> 'pi_table_owner'
      or coalesce(array_to_string(procedure.proconfig, ','), '') !~
        '(^|,)search_path=""(,|$)'
      or exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'AP1_READ_UNSAFE_DEFINER:%', v_problem;
  end if;

  if not has_schema_privilege(
    'authenticated',
    'projectceo_read_api',
    'USAGE'
  ) or has_schema_privilege(
    'anon',
    'projectceo_read_api',
    'USAGE'
  ) or has_schema_privilege(
    'service_role',
    'projectceo_read_api',
    'USAGE'
  ) then
    raise exception 'AP1_READ_SCHEMA_ACL_INVALID';
  end if;

  if not has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'pi_human_executor',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'pi_worker_executor',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read_unfiltered(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'projectceo_read_api._published_role_projection(jsonb,text,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'AP1_READ_FUNCTION_ACL_INVALID';
  end if;

  if not has_function_privilege(
    'authenticated',
    'projectceo_product_api.distribute_release_request_bound(uuid,text,uuid,bigint,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'projectceo_product_api.acknowledge_release_request_bound(uuid,uuid,text,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'projectceo_product_api.distribute_release_request_bound(uuid,text,uuid,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'projectceo_product_api.distribute_release_request_bound(uuid,text,uuid,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'pi_human_executor',
    'projectceo_product_api.distribute_release_request_bound(uuid,text,uuid,bigint,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'pi_worker_executor',
    'projectceo_product_api.acknowledge_release_request_bound(uuid,uuid,text,bigint,text)',
    'EXECUTE'
  ) then
    raise exception 'AP1_REQUEST_BOUND_RELEASE_ACL_INVALID';
  end if;

  select format(
    '%I.%I(%s)',
    namespace.nspname,
    procedure.proname,
    pg_get_function_identity_arguments(procedure.oid)
  )
  into v_problem
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_product_api'
    and procedure.proname in (
      'distribute_release_request_bound',
      'acknowledge_release_request_bound'
    )
    and (
      not procedure.prosecdef
      or pg_get_userbyid(procedure.proowner) <> 'pi_table_owner'
      or coalesce(array_to_string(procedure.proconfig, ','), '') !~
        '(^|,)search_path=""(,|$)'
      or exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'AP1_REQUEST_BOUND_RELEASE_UNSAFE_DEFINER:%', v_problem;
  end if;

  -- ACL повторных дверей модуля 4.
  --
  -- ЧТО ЗДЕСЬ ИЗМЕНИЛОСЬ И ПОЧЕМУ. Файл писался 18.07.2026, когда все пять
  -- `replay_*` были выданы `authenticated` миграцией `20260718124958`. С
  -- 10.08.2026 guardrail `20260810070000` отзывает права по схеме M4 целиком, и
  -- обратно их возвращают только скрипты одноразовой среды — ровно тем, что
  -- авторизовано:
  --
  --   * `replay_submit_change_request` — инкремент 1 (A6 §1.1, DEC-025);
  --   * `replay_review_change_impact` — вертикаль V1 (M4 IMPLEMENTATION GO
  --     от 12.08.2026).
  --
  -- Остальные три принадлежат V2 и V3, которые `NOT AUTHORIZED` (DEC-032), и
  -- закрыты для ВСЕХ ролей. До этой правки файл требовал их у `authenticated` и
  -- потому падал `AP1_M4_REPLAY_ACL_INVALID` — не находка, а устаревшее
  -- ожидание: он описывал мир до guardrail'а.
  --
  -- Права им НЕ возвращаются. Открытие V2/V3 требует отдельного решения
  -- владельца, и харнесс не то место, где такие решения принимаются.
  if exists (
    select 1
    from (values
      ('projectceo_m4_api.replay_submit_change_request(uuid,uuid,text,text,text,text,bigint,integer,text)'),
      ('projectceo_m4_api.replay_review_change_impact(uuid,uuid,text,text,text,text)')
    ) replay(signature)
    where not has_function_privilege(
      'authenticated', replay.signature, 'EXECUTE'
    ) or has_function_privilege('anon', replay.signature, 'EXECUTE')
      or has_function_privilege('service_role', replay.signature, 'EXECUTE')
      or has_function_privilege(
        'pi_human_executor', replay.signature, 'EXECUTE'
      )
      or has_function_privilege(
        'pi_worker_executor', replay.signature, 'EXECUTE'
      )
  ) then
    raise exception 'AP1_M4_AUTHORISED_REPLAY_ACL_INVALID';
  end if;

  -- Неавторизованные вертикали закрыты для всех, включая `authenticated`.
  -- Проверка положительная, а не «не упало»: молчаливое открытие одной из них
  -- иначе прошло бы незамеченным.
  if exists (
    select 1
    from (values
      ('projectceo_m4_api.replay_register_photo_evidence(uuid,uuid,text,text,text,timestamptz,text,text)'),
      ('projectceo_m4_api.replay_review_photo_evidence(uuid,uuid,text,text,text)'),
      ('projectceo_m4_api.replay_accept_milestone(uuid,uuid,text)')
    ) replay(signature)
    cross join (values
      ('anon'), ('authenticated'), ('service_role'),
      ('pi_human_executor'), ('pi_worker_executor')
    ) actor(role_name)
    where has_function_privilege(actor.role_name, replay.signature, 'EXECUTE')
  ) then
    raise exception 'AP1_M4_UNAUTHORISED_REPLAY_REACHABLE';
  end if;

  if has_function_privilege(
    'authenticated',
    'projectceo_m4._request_bound_human_replay_or_null(uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'AP1_M4_REPLAY_HELPER_REACHABLE';
  end if;

  select format(
    '%I.%I(%s)',
    namespace.nspname,
    procedure.proname,
    pg_get_function_identity_arguments(procedure.oid)
  )
  into v_problem
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'projectceo_m4_api'
    and procedure.proname like 'replay\_%' escape '\'
    and (
      not procedure.prosecdef
      or procedure.provolatile <> 's'
      or pg_get_userbyid(procedure.proowner) <> 'pi_table_owner'
      or coalesce(array_to_string(procedure.proconfig, ','), '') !~
        '(^|,)search_path=""(,|$)'
      or exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  limit 1;
  if v_problem is not null then
    raise exception 'AP1_M4_REPLAY_UNSAFE_DEFINER:%', v_problem;
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema in (
      'project_intelligence',
      'projectceo_foundation',
      'projectceo_product',
      'projectceo_m4'
    )
      and grant_row.grantee in ('anon', 'authenticated', 'service_role')
  ) then
    raise exception 'AP1_READ_PRIVATE_TABLE_GRANT_EXPOSED';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral unnest(coalesce(procedure.proargnames, array[]::text[]))
      argument(name)
    where namespace.nspname = 'projectceo_read_api'
      and argument.name in (
        'actor_id',
        'actor_user_id',
        'organization_id',
        'role',
        'recipient_user_id'
      )
  ) then
    raise exception 'AP1_READ_CALLER_CONTROLLED_AUTHORIZATION_ARGUMENT';
  end if;
end
$ap1_read_schema_security$;

select 'AP1_READ_SCHEMA_SECURITY_OK' as result;
