-- Чистый bootstrap на настоящем Supabase (находка 28.09, блокер B1).
--
-- 20260928100000_account_retention_cases передаёт таблицы в схеме public роли
-- pi_table_owner (`alter table … owner to pi_table_owner`). Сменить владельца
-- можно, только если у нового владельца есть CREATE на схему. В Postgres 15+
-- у схемы public его нет ни у кого, кроме владельца схемы; суперпользователь
-- (харнесс DB4) эту проверку не проходит, а `postgres` на Supabase — не
-- суперпользователь. Итог: на настоящем Supabase миграция падала с
-- «permission denied for schema public».
--
-- Право выдаётся здесь, до 20260928100000 (сам файл не меняется), и
-- забирается сразу после миграций удаления аккаунта
-- (20260928154000_pi_table_owner_public_create_revoke): владение таблицами
-- остаётся, лишнего права — нет.

begin;
grant create on schema public to pi_table_owner;
commit;
