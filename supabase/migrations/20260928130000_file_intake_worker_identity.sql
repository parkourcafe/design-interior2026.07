-- DEC-045 (b): фоновые воркеры file intake (загрузчик вложений Telegram,
-- импорт Google Drive) работают под ролью `pi_worker_executor` через API базы.
--
-- PostgREST переключается на роль из JWT (`role`), только если его логин-роль
-- `authenticator` — член этой роли. Здесь выдаётся ровно это членство. Ключ
-- (JWT с `role = pi_worker_executor`, подписанный секретом проекта) выпускает
-- и хранит владелец: `docs/canonical/remhaos-v1/REMHAOS_FILE_INTAKE_WORKER_KEY_RUNBOOK.md`.
--
-- Новых прав у самой роли не появляется: она по-прежнему видит только
-- выданные ей функции. `authenticator` не наследует её права (NOINHERIT):
-- членство даёт только переключение по JWT.
--
-- В харнессах DB4/DB5 роли `authenticator` нет — там миграция ничего не
-- делает, а сценарий 85 доказывает путь через `set role pi_worker_executor`.

begin;

do $worker_identity$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator') then
    grant pi_worker_executor to authenticator;
  end if;
end
$worker_identity$;

commit;
