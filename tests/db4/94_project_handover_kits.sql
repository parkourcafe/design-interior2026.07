\set ON_ERROR_STOP on

-- DB4-94: комплект подрядчика уровня 1 и подтверждение получения
-- (миграция 20261001101000, решение владельца 01.10.2026, вариант B).
-- 1. Комплект — только из принятого КП этого проекта и в комнату этого проекта;
--    один на комнату; создаёт участник студии от своего имени; не меняется.
-- 2. «Получил» — только исполнитель комнаты комплекта, один раз; конечные
--    пользователи отметки не пишут и не меняют.
-- 3. Чужая студия и anon комплект не видят; журнал комнаты принимает новые события.
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
      raise exception 'DB4_94_WRONG_FAILURE:%:%:%', p_label, v_state, v_message;
    end if;
    return;
  end;
  raise exception 'DB4_94_EXPECTED_FAILURE:%', p_label;
end
$function$;

-- Принятое КП v31 и отправленное (не принятое) v32 проекта 42222222.
insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
values
  ('94a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
   31, '[]'::jsonb, 'accepted', 'db4-94-accepted', statement_timestamp()),
  ('94b00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
   32, '[]'::jsonb, 'sent', 'db4-94-sent', statement_timestamp());

insert into public.project_rooms (id, project_id, proposal_id, scope_package)
values ('94c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        '94a00000-0000-4000-8000-000000000001', 'full');
insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
values ('94a00000-0000-4000-8000-000000000002', '41111111-1111-4111-8111-111111111111',
        31, '[]'::jsonb, 'accepted', 'db4-94-foreign', statement_timestamp());
insert into public.project_rooms (id, project_id, proposal_id, scope_package)
values ('94c00000-0000-4000-8000-000000000002', '41111111-1111-4111-8111-111111111111',
        '94a00000-0000-4000-8000-000000000002', 'full');
insert into public.project_participants (id, room_id, role, display_name, access_token)
values
  ('94d00000-0000-4000-8000-000000000001', '94c00000-0000-4000-8000-000000000001', 'executor', 'Исполнитель', 'db4-94-executor-token'),
  ('94d00000-0000-4000-8000-000000000002', '94c00000-0000-4000-8000-000000000001', 'client', 'Клиент', 'db4-94-client-token');

-- === 1. Дизайнер студии создаёт комплект ====================================
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect_error(
  $sql$ insert into public.project_handover_kits (room_id, project_id, proposal_id, proposal_version,
          proposal_sections, passport_summary, manifest, created_by)
        values ('94c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
          '94b00000-0000-4000-8000-000000000001', 32, '[]', '{}', '[{"kind":"proposal"}]',
          '33333333-3333-4333-8333-333333333333') $sql$,
  '42501', 'HANDOVER_KIT_PROPOSAL_NOT_ACCEPTED', 'not_accepted');
select pg_temp.expect_error(
  $sql$ insert into public.project_handover_kits (room_id, project_id, proposal_id, proposal_version,
          proposal_sections, passport_summary, manifest, created_by)
        values ('94c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
          '94a00000-0000-4000-8000-000000000001', 99, '[]', '{}', '[{"kind":"proposal"}]',
          '33333333-3333-4333-8333-333333333333') $sql$,
  '42501', 'HANDOVER_KIT_SUBJECT_MISMATCH', 'wrong_version');
select pg_temp.expect_error(
  $sql$ insert into public.project_handover_kits (room_id, project_id, proposal_id, proposal_version,
          proposal_sections, passport_summary, manifest, created_by)
        values ('94c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
          '94a00000-0000-4000-8000-000000000001', 31, '[]', '{}', '[{"kind":"proposal"}]',
          '31111111-1111-4111-8111-111111111111') $sql$,
  '42501', null, 'created_by_spoofed');
select pg_temp.expect_error(
  $sql$ insert into public.project_handover_kits (room_id, project_id, proposal_id, proposal_version,
          proposal_sections, passport_summary, manifest, created_by)
        values ('94c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
          '94a00000-0000-4000-8000-000000000001', 31, '[]', '{}', '[]',
          '33333333-3333-4333-8333-333333333333') $sql$,
  '23514', null, 'empty_manifest');

insert into public.project_handover_kits (id, room_id, project_id, proposal_id, proposal_version,
  proposal_sections, passport_summary, manifest, created_by)
values ('94e00000-0000-4000-8000-000000000001', '94c00000-0000-4000-8000-000000000001',
  '42222222-2222-4222-8222-222222222222', '94a00000-0000-4000-8000-000000000001', 31,
  '[{"id":"task","title":"Задача","body":"квартира"}]', '{"object":{}}',
  '[{"kind":"proposal","name":"КП","sha256":"00","size":1}]', '33333333-3333-4333-8333-333333333333');

select pg_temp.expect_error(
  $sql$ insert into public.project_handover_kits (room_id, project_id, proposal_id, proposal_version,
          proposal_sections, passport_summary, manifest, created_by)
        values ('94c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
          '94a00000-0000-4000-8000-000000000001', 31, '[]', '{}', '[{"kind":"proposal"}]',
          '33333333-3333-4333-8333-333333333333') $sql$,
  '23505', null, 'second_kit');
select pg_temp.expect_error(
  $sql$ update public.project_handover_kits set manifest = '[{"kind":"x"}]'
        where id = '94e00000-0000-4000-8000-000000000001' $sql$,
  '42501', null, 'kit_update');
select pg_temp.expect_error(
  $sql$ delete from public.project_handover_kits where id = '94e00000-0000-4000-8000-000000000001' $sql$,
  '42501', null, 'kit_delete');
-- Дизайнер не ставит отметку за исполнителя.
select pg_temp.expect_error(
  $sql$ insert into public.project_handover_receipts (kit_id, participant_id)
        values ('94e00000-0000-4000-8000-000000000001', '94d00000-0000-4000-8000-000000000001') $sql$,
  '42501', null, 'designer_receipt');

-- Комнату чужого проекта дизайнер комплектом не наполнит.
select pg_temp.expect_error(
  $sql$ insert into public.project_handover_kits (room_id, project_id, proposal_id, proposal_version,
          proposal_sections, passport_summary, manifest, created_by)
        values ('94c00000-0000-4000-8000-000000000002', '42222222-2222-4222-8222-222222222222',
          '94a00000-0000-4000-8000-000000000001', 31, '[]', '{}', '[{"kind":"proposal"}]',
          '33333333-3333-4333-8333-333333333333') $sql$,
  '42501', 'HANDOVER_KIT_SUBJECT_MISMATCH', 'foreign_room');

reset role;

-- === 2. «Получил» — маршрут по токену исполнителя (service role) ============
set local role service_role;
select pg_temp.expect_error(
  $sql$ insert into public.project_handover_receipts (kit_id, participant_id)
        values ('94e00000-0000-4000-8000-000000000001', '94d00000-0000-4000-8000-000000000002') $sql$,
  '42501', 'HANDOVER_RECEIPT_NOT_EXECUTOR', 'client_receipt');
insert into public.project_handover_receipts (kit_id, participant_id)
values ('94e00000-0000-4000-8000-000000000001', '94d00000-0000-4000-8000-000000000001');
select pg_temp.expect_error(
  $sql$ insert into public.project_handover_receipts (kit_id, participant_id)
        values ('94e00000-0000-4000-8000-000000000001', '94d00000-0000-4000-8000-000000000001') $sql$,
  '23505', null, 'second_receipt');
reset role;

insert into public.project_task_events (room_id, actor_role, event_type, details)
values ('94c00000-0000-4000-8000-000000000001', 'executor', 'handover_kit_received', '{"proposal_version":31}');

-- === 3. Видимость ===========================================================
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $own$
begin
  if (select count(*) from public.project_handover_receipts
      where kit_id = '94e00000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'DB4_94_STUDIO_CANNOT_READ_RECEIPT';
  end if;
end
$own$;
select pg_temp.expect_error(
  $sql$ update public.project_handover_receipts set received_at = statement_timestamp()
        where kit_id = '94e00000-0000-4000-8000-000000000001' $sql$,
  '42501', null, 'receipt_update');

set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $foreign$
begin
  if exists (select 1 from public.project_handover_kits where id = '94e00000-0000-4000-8000-000000000001')
     or exists (select 1 from public.project_handover_receipts where kit_id = '94e00000-0000-4000-8000-000000000001') then
    raise exception 'DB4_94_FOREIGN_STUDIO_READS_KIT';
  end if;
end
$foreign$;

set local role anon;
select pg_temp.expect_error($sql$ select count(*) from public.project_handover_kits $sql$, '42501', null, 'anon_kits');
select pg_temp.expect_error($sql$ select count(*) from public.project_handover_receipts $sql$, '42501', null, 'anon_receipts');

reset role;
rollback;

\echo 'DB4_94_PROJECT_HANDOVER_KITS_OK'
