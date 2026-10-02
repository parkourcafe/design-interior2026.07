\set ON_ERROR_STOP on

-- DB4-93: ответ клиента привязан к версии КП (миграция 20261001100000,
-- E2E-20261001-1531, разрыв D1).
-- 1. Одна версия — один ответ; ответ только на выданное КП; версия и проект
--    ответа должны совпадать с самим КП.
-- 2. Конечные пользователи не пишут, не правят и не удаляют ответы; студия
--    читает ответы своих проектов, чужая студия — нет.
-- 3. Новая версия КП (черновик) создаётся рядом с отправленной, не трогая её.
-- Сид: tests/db3/20_foundation_operations.sql — проект 42222222 (студия 33333333),
-- проект 41111111 (студия 31111111). Весь файл — одна транзакция с откатом.

begin;

create function pg_temp.expect_error(p_sql text, p_state text, p_message text, p_label text)
returns void language plpgsql as $function$
declare
  v_state text;
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state <> p_state or (p_message is not null and v_message <> p_message) then
      raise exception 'DB4_93_WRONG_FAILURE:%:%:%', p_label, v_state, v_message;
    end if;
    return;
  end;
  raise exception 'DB4_93_EXPECTED_FAILURE:%', p_label;
end
$function$;

-- Версия 1 отправлена, черновик версии 3 — для проверок «только выданное».
insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
values ('93a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        21, '[{"id":"price","title":"Стоимость","body":"v1"}]'::jsonb, 'sent', 'db4-93-v1', statement_timestamp());
insert into public.proposals (id, project_id, version, sections, status, public_token)
values ('93c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        23, '[]'::jsonb, 'draft', 'db4-93-draft');

-- === 1. Запись маршрутом (service role) ======================================
set local role service_role;

insert into public.proposal_responses (proposal_id, project_id, proposal_version, action, comment)
values ('93a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 21, 'changes', 'Нужна гардеробная');

select pg_temp.expect_error(
  $sql$ insert into public.proposal_responses (proposal_id, project_id, proposal_version, action)
        values ('93a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 21, 'accept') $sql$,
  '23505', null, 'second_response_same_version');
select pg_temp.expect_error(
  $sql$ insert into public.proposal_responses (proposal_id, project_id, proposal_version, action)
        values ('93c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 23, 'accept') $sql$,
  '42501', 'PROPOSAL_RESPONSE_NOT_ISSUED', 'response_to_draft');
select pg_temp.expect_error(
  $sql$ insert into public.proposal_responses (proposal_id, project_id, proposal_version, action)
        values ('93a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 99, 'accept') $sql$,
  '42501', 'PROPOSAL_RESPONSE_SUBJECT_MISMATCH', 'wrong_version');
select pg_temp.expect_error(
  $sql$ insert into public.proposal_responses (proposal_id, project_id, proposal_version, action)
        values ('93a00000-0000-4000-8000-000000000001', '41111111-1111-4111-8111-111111111111', 21, 'accept') $sql$,
  '42501', 'PROPOSAL_RESPONSE_SUBJECT_MISMATCH', 'wrong_project');

reset role;

-- Замечание к принятию и пустое замечание запрещены схемой.
select pg_temp.expect_error(
  $sql$ insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
        values ('93d00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
                24, '[]'::jsonb, 'sent', 'db4-93-v4', statement_timestamp());
        insert into public.proposal_responses (proposal_id, project_id, proposal_version, action, comment)
        values ('93d00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 24, 'accept', 'нет') $sql$,
  '23514', null, 'comment_on_accept');

-- === 2. Конечные пользователи ===============================================
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $own_studio$
begin
  if (select count(*) from public.proposal_responses
      where proposal_id = '93a00000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'DB4_93_STUDIO_CANNOT_READ_OWN_RESPONSE';
  end if;
end
$own_studio$;

select pg_temp.expect_error(
  $sql$ insert into public.proposal_responses (proposal_id, project_id, proposal_version, action)
        values ('93a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 21, 'accept') $sql$,
  '42501', null, 'designer_insert');
select pg_temp.expect_error(
  $sql$ update public.proposal_responses set comment = 'переписано'
        where proposal_id = '93a00000-0000-4000-8000-000000000001' $sql$,
  '42501', null, 'designer_update');
select pg_temp.expect_error(
  $sql$ delete from public.proposal_responses
        where proposal_id = '93a00000-0000-4000-8000-000000000001' $sql$,
  '42501', null, 'designer_delete');

-- === 3. Новая версия рядом с отправленной ===================================
insert into public.proposals (id, project_id, version, sections, status, public_token)
select '93b00000-0000-4000-8000-000000000001', project_id, 22, sections, 'draft', 'db4-93-v2'
from public.proposals where id = '93a00000-0000-4000-8000-000000000001';

do $revision$
begin
  if (select sections::text from public.proposals where id = '93a00000-0000-4000-8000-000000000001')
     is distinct from '[{"id": "price", "body": "v1", "title": "Стоимость"}]' then
    raise exception 'DB4_93_ISSUED_VERSION_CHANGED';
  end if;
  if (select status from public.proposals where id = '93b00000-0000-4000-8000-000000000001') <> 'draft' then
    raise exception 'DB4_93_REVISION_NOT_DRAFT';
  end if;
end
$revision$;

-- Чужая студия не видит ответы.
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $foreign$
begin
  if exists (select 1 from public.proposal_responses
             where proposal_id = '93a00000-0000-4000-8000-000000000001') then
    raise exception 'DB4_93_FOREIGN_STUDIO_READS_RESPONSE';
  end if;
end
$foreign$;

set local role anon;
select pg_temp.expect_error(
  $sql$ select count(*) from public.proposal_responses $sql$,
  '42501', null, 'anon_read');

reset role;
rollback;

\echo 'DB4_93_PROPOSAL_RESPONSE_VERSIONS_OK'
