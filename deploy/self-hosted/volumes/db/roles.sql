-- Пароли служебных ролей, через которые ходят Auth, Storage и API.
-- Выполняется один раз при создании базы (как в официальной сборке Supabase).
\set pgpass `echo "$POSTGRES_PASSWORD"`
alter user authenticator with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
alter user supabase_storage_admin with password :'pgpass';
