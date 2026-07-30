-- ArchiDom Project Intelligence custom roles.
--
-- Supabase applies this cluster-level bootstrap before timestamped migrations.
-- The migrations remain authoritative and revalidate every role attribute; this
-- file only gives the local migration executor enough membership to assign
-- private object ownership and default privileges without rewriting history.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_table_owner') then
    create role pi_table_owner nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_human_executor') then
    create role pi_human_executor nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_worker_executor') then
    create role pi_worker_executor nologin noinherit nobypassrls;
  end if;
end
$roles$;

grant pi_table_owner, pi_human_executor, pi_worker_executor to postgres;
