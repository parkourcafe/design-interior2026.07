-- DEC-045 (b): загрузчик вложений Telegram кладёт файлы в карантин file
-- intake через API базы по отдельному ключу (JWT, `role` = роль ниже).
--
-- Роль узкая и отдельная: `pi_telegram_file_worker`. Широкую
-- `pi_worker_executor` API не отдаётся — у неё десятки системных дверей
-- (итог антивирусной проверки, OAuth, задания интеграций), и ключ с её ролью
-- позволил бы, например, самому пометить свой файл чистым. Узкая роль может
-- ровно две вещи:
--   * `create_file_intake_worker` — завести запись и получить путь карантина;
--   * `mark_file_intake_uploaded_worker` — отметить загрузку (→ scan_pending).
-- Проверку файла делает не она. Таблиц она не видит; функции — SECURITY
-- DEFINER, прав на данные роль не получает.
--
-- PostgREST переключается на роль из JWT, только если его логин-роль
-- `authenticator` — член роли. Членство выдаётся здесь; в харнессах DB4/DB5
-- роли `authenticator` нет — там его нет и в миграции. Ключ выпускает владелец:
-- docs/canonical/remhaos-v1/REMHAOS_FILE_INTAKE_WORKER_KEY_RUNBOOK.md.

begin;

do $role$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_telegram_file_worker') then
    create role pi_telegram_file_worker nologin noinherit nobypassrls;
  end if;
end
$role$;

grant usage on schema remhaos_integration_api to pi_telegram_file_worker;
grant execute on function remhaos_integration_api.create_file_intake_worker(uuid, text, text, text, bigint, text, text, text)
  to pi_telegram_file_worker;
grant execute on function remhaos_integration_api.mark_file_intake_uploaded_worker(uuid, uuid, text)
  to pi_telegram_file_worker;

do $authenticator$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator') then
    grant pi_telegram_file_worker to authenticator;
  end if;
end
$authenticator$;

-- Роль не получила ничего сверх двух дверей: ни одной другой функции в
-- API-схемах и ни одной таблицы.
do $narrow$
declare
  v_extra text;
begin
  select n.nspname || '.' || p.proname into v_extra
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where pg_catalog.has_function_privilege('pi_telegram_file_worker', p.oid, 'EXECUTE')
    and n.nspname not in ('pg_catalog', 'information_schema', 'extensions')
    and n.nspname not like 'pg\_%'
    and not (n.nspname = 'remhaos_integration_api'
             and p.proname in ('create_file_intake_worker', 'mark_file_intake_uploaded_worker'))
    -- Функции с EXECUTE для PUBLIC (служебные, без прав на данные) не в счёт.
    and not pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
  limit 1;
  if v_extra is not null then
    raise exception 'PI_TELEGRAM_FILE_WORKER_TOO_WIDE:%', v_extra;
  end if;
end
$narrow$;

commit;
