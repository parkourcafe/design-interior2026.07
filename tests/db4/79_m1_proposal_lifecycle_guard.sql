\set ON_ERROR_STOP on

-- DB4: жизненный цикл КП закреплён базой (миграция 20260925090000, DEC-040;
-- финальный аудит 25.09.2026, BUG-03/BUG-04). Конечный пользователь не может
-- обойти approval паспорта прямым PostgREST-запросом, править отправленное КП,
-- откатывать accepted → sent или удалять выданное КП; серверный путь ответа
-- клиента (sent → accepted) остаётся рабочим.
--
-- Сид: tests/db3/20_foundation_operations.sql — проект 41111111 (студия
-- владельца 31111111, зачислен в ProjectCEO) и 42222222 (студия 33333333).

do $schema_contract$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.proposals'::regclass
      and t.tgname = 'proposals_lifecycle_guard'
      and not t.tgisinternal
  ) then
    raise exception 'DB4_79_PROPOSAL_GUARD_MISSING';
  end if;
  if pg_catalog.has_function_privilege(
    'authenticated', 'public.guard_proposal_lifecycle()', 'EXECUTE'
  ) then
    raise exception 'DB4_79_GUARD_EXECUTABLE_BY_AUTHENTICATED';
  end if;
end
$schema_contract$;

begin;

insert into public.proposals (id, project_id, version, sections, status, public_token)
values
  ('79a00000-0000-4000-8000-000000000001', '41111111-1111-4111-8111-111111111111',
   1, '[{"id":"s1","title":"t","body":"v1"}]'::jsonb, 'draft', 'db4-79-token-a'),
  ('79b00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
   1, '[]'::jsonb, 'draft', 'db4-79-token-b');

-- 1. Без утверждённого approval паспорта прямой draft → sent отклоняется.
do $send_without_approval_denied$
declare
  v_message text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
  begin
    update public.proposals set status = 'sent'
    where id = '79b00000-0000-4000-8000-000000000001';
    raise exception 'DB4_79_SEND_WITHOUT_APPROVAL_ACCEPTED';
  exception when sqlstate '42501' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'PROPOSAL_APPROVAL_REQUIRED' then raise; end if;
  end;
  reset role;
end
$send_without_approval_denied$;

-- 2. Конечный пользователь не вставляет КП сразу отправленным.
do $insert_sent_denied$
declare
  v_message text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
  begin
    insert into public.proposals (project_id, version, sections, status, public_token)
    values ('42222222-2222-4222-8222-222222222222', 2, '[]'::jsonb, 'sent',
            'db4-79-token-b-sent');
    raise exception 'DB4_79_INSERT_SENT_ACCEPTED';
  exception when sqlstate '42501' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'PROPOSAL_INSERT_MUST_BE_DRAFT' then raise; end if;
  end;
  reset role;
end
$insert_sent_denied$;

-- 3. Владелец получает approval паспорта через те же RPC, что и приложение,
--    после чего draft → sent проходит, а sent_at проставляется базой.
do $approved_send$
declare
  v_rev bigint;
  v_request uuid;
  v_status text;
  v_sent_at timestamptz;
begin
  select state_revision into v_rev from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  set local role authenticated;
  set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
  v_request := (projectceo_platform_api.create_approval_request(
    '41111111-1111-4111-8111-111111111111', 'project_passport',
    '41111111-1111-4111-8111-111111111111', 'manage_project',
    'db4-79 паспорт готов к КП', v_rev, 'db4-79-approval-create'
  ) -> 'result' ->> 'requestId')::uuid;
  reset role;

  select state_revision into v_rev from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  set local role authenticated;
  set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
  perform projectceo_platform_api.submit_approval_request(
    '41111111-1111-4111-8111-111111111111', v_request, v_rev, 'db4-79-approval-submit');
  reset role;

  select state_revision into v_rev from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  set local role authenticated;
  set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
  perform projectceo_platform_api.decide_approval_request(
    '41111111-1111-4111-8111-111111111111', v_request, 'approved',
    'db4-79 утверждено', v_rev, 'db4-79-approval-decide');

  update public.proposals set status = 'sent'
  where id = '79a00000-0000-4000-8000-000000000001';
  reset role;

  select status, sent_at into v_status, v_sent_at from public.proposals
  where id = '79a00000-0000-4000-8000-000000000001';
  if v_status <> 'sent' or v_sent_at is null then
    raise exception 'DB4_79_APPROVED_SEND_FAILED:%/%', v_status, v_sent_at;
  end if;
end
$approved_send$;

-- 4. Отправленное КП неизменяемо, клиентский ответ за конечного пользователя
--    не ставится, выданное КП не удаляется — каждый случай своим отказом.
do $issued_locked_for_end_user$
declare
  v_message text;
  v_case record;
begin
  for v_case in
    select * from (values
      ('edit', 'PROPOSAL_CONTENT_LOCKED'),
      ('accept', 'PROPOSAL_STATUS_TRANSITION_DENIED'),
      ('to_draft', 'PROPOSAL_STATUS_TRANSITION_DENIED'),
      ('delete', 'PROPOSAL_ISSUED_DELETE_DENIED')
    ) cases(name, expected)
  loop
    set local role authenticated;
    set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
    begin
      if v_case.name = 'edit' then
        update public.proposals set sections = '[{"id":"s1","title":"t","body":"v2"}]'::jsonb
        where id = '79a00000-0000-4000-8000-000000000001';
      elsif v_case.name = 'accept' then
        update public.proposals set status = 'accepted'
        where id = '79a00000-0000-4000-8000-000000000001';
      elsif v_case.name = 'to_draft' then
        update public.proposals set status = 'draft'
        where id = '79a00000-0000-4000-8000-000000000001';
      else
        delete from public.proposals where id = '79a00000-0000-4000-8000-000000000001';
      end if;
      raise exception 'DB4_79_ISSUED_%_ACCEPTED', upper(v_case.name);
    exception when sqlstate '42501' then
      get stacked diagnostics v_message = message_text;
      if v_message is distinct from v_case.expected then
        raise exception 'DB4_79_ISSUED_%_WRONG_DENIAL:%', upper(v_case.name), v_message;
      end if;
    end;
    reset role;
  end loop;
end
$issued_locked_for_end_user$;

-- 4a. Серверная роль тоже не перепрыгивает переходы: draft → accepted и
--     sent → draft отклоняются для всех.
do $server_cannot_skip_transitions$
declare
  v_message text;
begin
  set local role service_role;
  begin
    update public.proposals set status = 'accepted'
    where id = '79b00000-0000-4000-8000-000000000001';
    raise exception 'DB4_79_SERVER_DRAFT_TO_ACCEPTED_ACCEPTED';
  exception when sqlstate '42501' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'PROPOSAL_STATUS_TRANSITION_DENIED' then raise; end if;
  end;
  begin
    update public.proposals set status = 'draft'
    where id = '79a00000-0000-4000-8000-000000000001';
    raise exception 'DB4_79_SERVER_SENT_TO_DRAFT_ACCEPTED';
  exception when sqlstate '42501' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'PROPOSAL_STATUS_TRANSITION_DENIED' then raise; end if;
  end;
  reset role;
end
$server_cannot_skip_transitions$;

-- 5. Серверный путь ответа клиента (service role) переводит sent → accepted;
--    откат accepted → sent запрещён всем, включая серверные роли.
do $server_accept_then_no_rollback$
declare
  v_message text;
begin
  set local role service_role;
  update public.proposals set status = 'accepted'
  where id = '79a00000-0000-4000-8000-000000000001';
  reset role;
  if (select status from public.proposals
      where id = '79a00000-0000-4000-8000-000000000001') <> 'accepted' then
    raise exception 'DB4_79_SERVER_ACCEPT_FAILED';
  end if;

  begin
    update public.proposals set status = 'sent'
    where id = '79a00000-0000-4000-8000-000000000001';
    raise exception 'DB4_79_ACCEPTED_ROLLBACK_ACCEPTED';
  exception when sqlstate '42501' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'PROPOSAL_STATUS_TRANSITION_DENIED' then raise; end if;
  end;

  begin
    update public.proposals set sections = '[]'::jsonb
    where id = '79a00000-0000-4000-8000-000000000001';
    raise exception 'DB4_79_ACCEPTED_EDIT_BY_SERVER_ACCEPTED';
  exception when sqlstate '42501' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'PROPOSAL_CONTENT_LOCKED' then raise; end if;
  end;
end
$server_accept_then_no_rollback$;

-- 6. Черновик по-прежнему редактируется владельцем.
do $draft_editable$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
  update public.proposals set sections = '[{"id":"s1","title":"t","body":"draft"}]'::jsonb
  where id = '79b00000-0000-4000-8000-000000000001';
  reset role;
  if (select sections -> 0 ->> 'body' from public.proposals
      where id = '79b00000-0000-4000-8000-000000000001') <> 'draft' then
    raise exception 'DB4_79_DRAFT_EDIT_LOST';
  end if;
end
$draft_editable$;

rollback;

select 'DB4_M1_PROPOSAL_LIFECYCLE_GUARD_OK' result;
