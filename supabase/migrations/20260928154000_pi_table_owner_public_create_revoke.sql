-- Пара к 20260928095900: право CREATE на схему public нужно было роли
-- pi_table_owner только для смены владельца таблиц удаления аккаунта
-- (20260928100000, 20260928120000). Владение сохраняется и без него.

begin;
revoke create on schema public from pi_table_owner;
commit;
