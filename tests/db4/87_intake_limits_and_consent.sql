\set ON_ERROR_STOP on

-- DB4-87: аудит 28.09, шаги 4–5 (миграции 20260928150000, 20260928151000).
-- 1. Согласие на обработку ПДн: запись только сервером брифа, append-only,
--    время ставит база, API-роли не видят.
-- 2. consume_rate_limit: атомарный лимит, окно, только service_role.
-- 3. append_intake_attachment: лимит числа файлов, только папка проекта,
--    только service_role, без потери записей.
-- Весь файл — одна транзакция с откатом.

begin;

create function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql as $function$
declare
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> p_state then
      raise exception 'DB4_87_WRONG_FAILURE:%:%:%', p_label, v_state, sqlerrm;
    end if;
    return;
  end;
  raise exception 'DB4_87_EXPECTED_FAILURE:%', p_label;
end
$function$;

-- === Поверхность =============================================================

do $surface$
begin
  if pg_catalog.has_table_privilege('anon', 'public.intake_consent_records', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.intake_consent_records', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.intake_consent_records', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.intake_consent_records', 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.intake_consent_records', 'DELETE')
     or not pg_catalog.has_column_privilege('service_role', 'public.intake_consent_records', 'project_id', 'INSERT') then
    raise exception 'DB4_87_CONSENT_SURFACE';
  end if;
  -- Время согласия задаёт база: сервер не может его подставить.
  if pg_catalog.has_column_privilege('service_role', 'public.intake_consent_records', 'consented_at', 'INSERT') then
    raise exception 'DB4_87_CONSENT_TIME_WRITABLE';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.rate_limits', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.rate_limits', 'INSERT') then
    raise exception 'DB4_87_RATE_LIMITS_EXPOSED';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.append_intake_attachment(uuid,jsonb,integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.append_intake_attachment(uuid,jsonb,integer)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.append_intake_attachment(uuid,jsonb,integer)', 'EXECUTE') then
    raise exception 'DB4_87_FUNCTION_SURFACE';
  end if;
end
$surface$;

-- === 1. Согласие ============================================================

set local role service_role;
insert into public.intake_consent_records (project_id, consent_version, consent_text_sha256, source)
values ('41111111-1111-4111-8111-111111111111', 'consent-draft-2026-09-28', repeat('a', 64), 'designer_intake');
select pg_temp.expect_error(
  $sql$ insert into public.intake_consent_records (project_id, consent_version, consent_text_sha256, source, consented_at)
        values ('41111111-1111-4111-8111-111111111111', 'consent-draft-2026-09-28', repeat('a', 64), 'designer_intake', now() - interval '1 year') $sql$,
  '42501', 'backdated_consent');
select pg_temp.expect_error(
  $sql$ insert into public.intake_consent_records (project_id, consent_version, consent_text_sha256, source)
        values ('41111111-1111-4111-8111-111111111111', 'x', 'not-a-hash', 'designer_intake') $sql$,
  '23514', 'malformed_consent');
reset role;

do $consent$
begin
  if not exists (
    select 1 from public.intake_consent_records
    where project_id = '41111111-1111-4111-8111-111111111111'
      and consented_at is not null
      and consented_at <= statement_timestamp()
      and consented_at > statement_timestamp() - interval '1 minute'
  ) then
    raise exception 'DB4_87_CONSENT_NOT_RECORDED';
  end if;
  begin
    update public.intake_consent_records set consent_version = 'consent-final'
    where project_id = '41111111-1111-4111-8111-111111111111';
    raise exception 'DB4_87_CONSENT_MUTABLE';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.intake_consent_records where project_id = '41111111-1111-4111-8111-111111111111';
    raise exception 'DB4_87_CONSENT_DELETABLE';
  exception when sqlstate '55000' then null;
  end;
end
$consent$;

-- === 2. Лимит частоты =======================================================

set local role service_role;
do $rate_limit$
begin
  if not public.consume_rate_limit('db4-87:ip', 60, 2)
     or not public.consume_rate_limit('db4-87:ip', 60, 2)
     or public.consume_rate_limit('db4-87:ip', 60, 2) then
    raise exception 'DB4_87_RATE_LIMIT_NOT_ENFORCED';
  end if;
  -- Другой ключ — свой счёт.
  if not public.consume_rate_limit('db4-87:other-ip', 60, 2) then
    raise exception 'DB4_87_RATE_LIMIT_KEY_LEAK';
  end if;
end
$rate_limit$;
select pg_temp.expect_error($sql$ select public.consume_rate_limit('', 60, 2) $sql$, '22023', 'empty_key');
reset role;

-- Окно: старые попытки не считаются.
update public.rate_limits set created_at = statement_timestamp() - interval '2 hours' where key = 'db4-87:ip';
set local role service_role;
do $rate_window$
begin
  if not public.consume_rate_limit('db4-87:ip', 60, 2) then
    raise exception 'DB4_87_RATE_WINDOW_IGNORED';
  end if;
end
$rate_window$;
reset role;

-- === 3. Вложения клиента ====================================================

delete from public.answers
where project_id = '41111111-1111-4111-8111-111111111111' and question_id = 'attachments';

set local role service_role;
do $attachments$
declare
  v_result jsonb;
  i integer;
begin
  for i in 1..3 loop
    v_result := public.append_intake_attachment(
      '41111111-1111-4111-8111-111111111111',
      jsonb_build_object('path', '41111111-1111-4111-8111-111111111111/' || i || '-plan.pdf', 'name', 'plan.pdf'),
      3);
    if not (v_result ->> 'ok')::boolean or (v_result ->> 'count')::int <> i then
      raise exception 'DB4_87_APPEND_%:%', i, v_result;
    end if;
  end loop;
  v_result := public.append_intake_attachment(
    '41111111-1111-4111-8111-111111111111',
    jsonb_build_object('path', '41111111-1111-4111-8111-111111111111/4-plan.pdf'), 3);
  if (v_result ->> 'ok')::boolean or v_result ->> 'reason' <> 'too_many_files' then
    raise exception 'DB4_87_LIMIT_NOT_ENFORCED:%', v_result;
  end if;
end
$attachments$;
-- Путь чужого проекта не записывается.
select pg_temp.expect_error(
  $sql$ select public.append_intake_attachment('41111111-1111-4111-8111-111111111111',
        jsonb_build_object('path', '42222222-2222-4222-8222-222222222222/secret.pdf'), 10) $sql$,
  '22023', 'foreign_path');
select pg_temp.expect_error(
  $sql$ select public.append_intake_attachment('41111111-1111-4111-8111-111111111111',
        '"not-an-object"'::jsonb, 10) $sql$,
  '22023', 'not_an_object');
reset role;

do $attachments_state$
begin
  if (select jsonb_array_length(value) from public.answers
      where project_id = '41111111-1111-4111-8111-111111111111' and question_id = 'attachments') <> 3 then
    raise exception 'DB4_87_ATTACHMENTS_LOST';
  end if;
end
$attachments_state$;

-- Клиентская роль не вызывает ни одну из функций напрямую.
set local role authenticated;
select pg_temp.expect_error($sql$ select public.consume_rate_limit('x', 60, 1) $sql$, '42501', 'authenticated_rate_limit');
select pg_temp.expect_error(
  $sql$ select public.append_intake_attachment('41111111-1111-4111-8111-111111111111', '{"path":"x"}'::jsonb, 1) $sql$,
  '42501', 'authenticated_append');
reset role;

rollback;

select 'DB4_INTAKE_LIMITS_AND_CONSENT_OK' result;
