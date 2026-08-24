\set ON_ERROR_STOP on

-- AP1 §2a — предусловие по ролям на управляемом Supabase.
--
-- Зачем: `postgres` в Supabase не superuser. В PostgreSQL 16+ роль с CREATEROLE,
-- создавая новую роль, получает admin_option, но НЕ set_option и НЕ
-- inherit_option. Без явного членства слой Project Intelligence не встаёт:
--   ERROR: 42501: must be able to SET ROLE "pi_table_owner"
--   ERROR: 42501: permission denied to change default privileges
-- (оба симптома воспроизведены на живой базе 01.08.2026, AP1_RUNBOOK.md §2a).
--
-- Чем отличается от `supabase/roles.sql`: тот рассчитан на локальный CLI, где
-- postgres — superuser, и грантит членство без `with inherit true, set true`.
-- Здесь членство выдаётся явно, потому что на hosted оно само не появляется.
--
-- Файл идемпотентен: атрибуты ролей не меняются, повторный прогон безопасен.
-- Роли остаются NOLOGIN NOINHERIT NOBYPASSRLS — guard внутри миграций это
-- перепроверяет.

do $precondition$
declare
  v_executor text := current_user;
  v_role text;
  v_defects text[];
begin
  foreach v_role in array array['pi_table_owner', 'pi_human_executor', 'pi_worker_executor'] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = v_role) then
      execute format('create role %I nologin noinherit nobypassrls', v_role);
    end if;
  end loop;

  -- Членство, а не атрибуты. `with inherit true, set true` — то, чего PG16+ не
  -- выдаёт создателю роли автоматически и без чего миграции падают.
  foreach v_role in array array['pi_table_owner', 'pi_human_executor', 'pi_worker_executor'] loop
    execute format(
      'grant %I to %I with inherit true, set true',
      v_role, v_executor
    );
  end loop;

  -- Постусловие. Проверяем ровно то, обо что спотыкались миграции: SET ROLE и
  -- наследование. Атрибуты ролей проверяем отдельно — их не должен менять
  -- никто, включая этот файл.
  select array_agg(defect order by defect)
  into v_defects
  from (
    select case
      when r.rolname is null then expected.name || ':MISSING'
      when r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole
        or r.rolreplication or r.rolbypassrls or r.rolinherit
        then expected.name || ':ATTRIBUTES_WIDENED'
      when not pg_has_role(v_executor, r.oid, 'SET')
        then expected.name || ':EXECUTOR_CANNOT_SET_ROLE'
      when not pg_has_role(v_executor, r.oid, 'USAGE')
        then expected.name || ':EXECUTOR_CANNOT_INHERIT'
    end as defect
    from unnest(array['pi_table_owner', 'pi_human_executor', 'pi_worker_executor']) expected(name)
    left join pg_catalog.pg_roles r on r.rolname = expected.name
  ) t
  where t.defect is not null;

  if v_defects is not null then
    raise exception 'AP1_HOSTED_ROLE_PRECONDITION_INVALID % executor=%', v_defects, v_executor;
  end if;

  -- Исторический обходной путь §2b. Он маскировал несовместимость managed
  -- Supabase и после PR #60 не нужен. Если он вернулся — предусловие врёт о
  -- том, что доказывает прогон, поэтому останавливаемся здесь.
  if pg_has_role('pi_table_owner', 'authenticated', 'USAGE') then
    raise exception 'AP1_AUTH_WORKAROUND_GRANT_PRESENT pi_table_owner inherits authenticated';
  end if;
end
$precondition$;

select format(
  'AP1_ROLE_PRECONDITION_OK executor=%s roles=pi_table_owner,pi_human_executor,pi_worker_executor auth_workaround_grant=absent',
  current_user
);
