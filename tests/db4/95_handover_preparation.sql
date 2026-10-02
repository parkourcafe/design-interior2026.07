\set ON_ERROR_STOP on

-- DB4-95: подготовка комплекта подрядчика — сверка и контролируемое содержимое
-- (миграция 20261002100000, решение владельца 02.10.2026, блокеры B-1/B-2).
-- 1. Черновик — только из принятого КП; файлы — только файлы проекта, безопасная
--    копия — только в папке подготовки этого проекта.
-- 2. Подтвердить сверку можно только для текущего содержимого и текущего
--    паспорта, без файлов «нужна копия» и без непроверенных файлов; подписывает
--    сам участник студии. Подменить копию подтверждения нельзя; правка после
--    сверки её сбрасывает.
-- 3. Комплект — только из действующей сверки: изменение паспорта после
--    подтверждения, другой текст или другой набор файлов — отказ. После
--    передачи черновик не меняется.
-- 4. Правки паспорта — журнал с автором, только добавление.
-- 5. Видимость: чужая студия и anon не видят черновики и правки.
-- 6. Внешние ключи комплекта и ответов клиента — cascade (очистка аккаунта).
-- Сид: tests/db3/20_foundation_operations.sql — проект 42222222 (студия 33333333).
-- Весь файл — одна транзакция с откатом.

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
      raise exception 'DB4_95_WRONG_FAILURE:%:%:%', p_label, v_state, v_message;
    end if;
    return;
  end;
  raise exception 'DB4_95_EXPECTED_FAILURE:%', p_label;
end
$function$;

create function pg_temp.assert(p_ok boolean, p_label text)
returns void language plpgsql as $function$
begin
  if p_ok is not true then
    raise exception 'DB4_95_ASSERT:%', p_label;
  end if;
end
$function$;

-- Проект с паспортом «без перепланировки», принятое КП v41 и отправленное v42,
-- файлы проекта: план дизайнера и файл клиента; комната и исполнитель.
update public.projects set passport = '{"object":{"replanning":"no"},"budget":{"range":"undisclosed","risk_level":"low"}}'::jsonb
where id = '42222222-2222-4222-8222-222222222222';
insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
values
  ('95a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 41,
   '[{"id":"works","title":"Состав работ","body":"Перенос кухни и демонтаж перегородки"}]'::jsonb,
   'accepted', 'db4-95-accepted', statement_timestamp()),
  ('95b00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 42,
   '[]'::jsonb, 'sent', 'db4-95-sent', statement_timestamp());
insert into public.answers (project_id, question_id, value) values
  ('42222222-2222-4222-8222-222222222222', 'designer_plan_attachments',
   '[{"path":"designer-plans/42222222-2222-4222-8222-222222222222/1-plan.pdf","name":"plan.pdf"}]'),
  ('42222222-2222-4222-8222-222222222222', 'attachments',
   '[{"path":"42222222-2222-4222-8222-222222222222/2-client.pdf","name":"client.pdf"}]');
insert into public.project_rooms (id, project_id, proposal_id, scope_package)
values ('95c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        '95a00000-0000-4000-8000-000000000001', 'full');
insert into public.project_participants (id, room_id, role, display_name, access_token)
values ('95d00000-0000-4000-8000-000000000001', '95c00000-0000-4000-8000-000000000001',
        'executor', 'Исполнитель', 'db4-95-executor-token');

create temp table v95 (k text primary key, v jsonb) on commit drop;
grant all on v95 to authenticated;
insert into v95 values
  ('plan_original', '{"kind":"designer_plan","source_path":"designer-plans/42222222-2222-4222-8222-222222222222/1-plan.pdf","name":"plan.pdf","decision":"original","reviewed":false}'),
  ('client_exclude', '{"kind":"client_file","source_path":"42222222-2222-4222-8222-222222222222/2-client.pdf","name":"client.pdf","decision":"exclude","reviewed":false}');

-- === 1. Черновик =============================================================
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect_error(
  $sql$ insert into public.project_handover_drafts (project_id, proposal_id, proposal_version, contractor_sections, created_by)
        values ('42222222-2222-4222-8222-222222222222', '95b00000-0000-4000-8000-000000000001', 42, '[]',
                '33333333-3333-4333-8333-333333333333') $sql$,
  '42501', 'HANDOVER_DRAFT_PROPOSAL_NOT_ACCEPTED', 'draft_from_sent');
-- Файл не из ответов проекта.
select pg_temp.expect_error(
  $sql$ insert into public.project_handover_drafts (project_id, proposal_id, proposal_version, contractor_sections, files, created_by)
        values ('42222222-2222-4222-8222-222222222222', '95a00000-0000-4000-8000-000000000001', 41, '[]',
                '[{"kind":"client_file","source_path":"42222222-2222-4222-8222-222222222222/alien.pdf","name":"a","decision":"original","reviewed":true}]',
                '33333333-3333-4333-8333-333333333333') $sql$,
  '23514', 'HANDOVER_DRAFT_FILES_INVALID', 'foreign_file');

insert into public.project_handover_drafts (id, project_id, proposal_id, proposal_version, contractor_sections, files, created_by)
select '95e00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
       '95a00000-0000-4000-8000-000000000001', 41,
       '[{"id":"works","title":"Состав работ","body":"Перенос кухни и демонтаж перегородки"}]',
       jsonb_build_array((select v from v95 where k = 'plan_original'), (select v from v95 where k = 'client_exclude')),
       '33333333-3333-4333-8333-333333333333';

-- Безопасная копия вне папки подготовки проекта.
select pg_temp.expect_error(
  $sql$ update public.project_handover_drafts
        set files = jsonb_build_array((select v from v95 where k = 'client_exclude')
          || '{"decision":"safe_copy","reviewed":true,"safe_copy":{"path":"designer-plans/42222222-2222-4222-8222-222222222222/other.pdf","name":"x"}}')
        where id = '95e00000-0000-4000-8000-000000000001' $sql$,
  '23514', 'HANDOVER_DRAFT_FILES_INVALID', 'safe_copy_outside_folder');

-- === 2. Подтверждение сверки ================================================
create function pg_temp.confirm(p_by uuid, p_passport jsonb) returns void language sql as $function$
  update public.project_handover_drafts
  set confirmed_at = statement_timestamp(), confirmed_by = p_by,
      confirmed_sections = contractor_sections, confirmed_files = files,
      confirmed_acknowledged = acknowledged, confirmed_passport = p_passport,
      confirmed_passport_summary = '{"object":{"replanning":"yes"}}'
  where id = '95e00000-0000-4000-8000-000000000001'
$function$;

-- Включённый файл не проверен.
select pg_temp.expect_error(
  $sql$ select pg_temp.confirm('33333333-3333-4333-8333-333333333333',
          (select passport from public.projects where id = '42222222-2222-4222-8222-222222222222')) $sql$,
  '42501', 'HANDOVER_DRAFT_FILES_NOT_READY', 'unreviewed_file');
-- «Нужна безопасная копия» без копии.
update public.project_handover_drafts
set files = jsonb_build_array((select v from v95 where k = 'plan_original') || '{"reviewed":true}',
                              (select v from v95 where k = 'client_exclude') || '{"decision":"needs_safe_copy"}')
where id = '95e00000-0000-4000-8000-000000000001';
select pg_temp.expect_error(
  $sql$ select pg_temp.confirm('33333333-3333-4333-8333-333333333333',
          (select passport from public.projects where id = '42222222-2222-4222-8222-222222222222')) $sql$,
  '42501', 'HANDOVER_DRAFT_FILES_NOT_READY', 'needs_safe_copy');
-- Безопасная копия загружена и проверена.
update public.project_handover_drafts
set files = jsonb_build_array((select v from v95 where k = 'plan_original') || '{"reviewed":true}',
                              (select v from v95 where k = 'client_exclude') || '{"decision":"safe_copy","reviewed":true,"safe_copy":{"path":"designer-plans/42222222-2222-4222-8222-222222222222/handover/3-client-safe.pdf","name":"client-safe.pdf"}}')
where id = '95e00000-0000-4000-8000-000000000001';
-- Подтверждение не того паспорта и подтверждение от чужого имени.
select pg_temp.expect_error(
  $sql$ select pg_temp.confirm('33333333-3333-4333-8333-333333333333', '{"object":{"replanning":"yes"}}') $sql$,
  '42501', 'HANDOVER_DRAFT_CONFIRMATION_MISMATCH', 'wrong_passport');
select pg_temp.expect_error(
  $sql$ select pg_temp.confirm('31111111-1111-4111-8111-111111111111',
          (select passport from public.projects where id = '42222222-2222-4222-8222-222222222222')) $sql$,
  '42501', 'HANDOVER_DRAFT_CONFIRMER_SPOOFED', 'spoofed_confirmer');

select pg_temp.confirm('33333333-3333-4333-8333-333333333333',
  (select passport from public.projects where id = '42222222-2222-4222-8222-222222222222'));
select pg_temp.assert((select confirmed_at is not null from public.project_handover_drafts
  where id = '95e00000-0000-4000-8000-000000000001'), 'confirmed');

-- Копию подтверждения нельзя подменить без новой сверки: значение остаётся прежним.
update public.project_handover_drafts set confirmed_sections = '[]'
where id = '95e00000-0000-4000-8000-000000000001';
select pg_temp.assert((select confirmed_sections = contractor_sections from public.project_handover_drafts
  where id = '95e00000-0000-4000-8000-000000000001'), 'confirmed_copy_kept');

-- Правка текста после сверки сбрасывает подтверждение.
update public.project_handover_drafts
set contractor_sections = '[{"id":"works","title":"Состав работ","body":"Перенос кухни, демонтаж перегородки"}]'
where id = '95e00000-0000-4000-8000-000000000001';
select pg_temp.assert((select confirmed_at is null and confirmed_sections is null from public.project_handover_drafts
  where id = '95e00000-0000-4000-8000-000000000001'), 'reset_on_text_edit');

-- === 3. Комплект — только из действующей сверки =============================
create function pg_temp.kit(p_sections jsonb, p_summary jsonb, p_files jsonb) returns void language sql as $function$
  insert into public.project_handover_kits (id, room_id, project_id, proposal_id, proposal_version,
    proposal_sections, passport_summary, manifest, created_by, draft_id)
  values ('95f00000-0000-4000-8000-000000000001', '95c00000-0000-4000-8000-000000000001',
    '42222222-2222-4222-8222-222222222222', '95a00000-0000-4000-8000-000000000001', 41,
    p_sections, p_summary,
    '[{"kind":"proposal","name":"КП","sha256":"00","size":1},{"kind":"passport_summary","name":"Сводка","sha256":"01","size":1}]'::jsonb || p_files,
    '33333333-3333-4333-8333-333333333333', '95e00000-0000-4000-8000-000000000001')
$function$;
insert into v95 values
  ('final_files', '[{"kind":"designer_plan","path":"designer-plans/42222222-2222-4222-8222-222222222222/1-plan.pdf","sha256":"aa","size":1},
                    {"kind":"client_file","path":"designer-plans/42222222-2222-4222-8222-222222222222/handover/3-client-safe.pdf","sha256":"bb","size":1}]');

select pg_temp.expect_error(
  $sql$ select pg_temp.kit((select contractor_sections from public.project_handover_drafts where id = '95e00000-0000-4000-8000-000000000001'),
          '{"object":{"replanning":"yes"}}', (select v from v95 where k = 'final_files')) $sql$,
  '42501', 'HANDOVER_KIT_NOT_RECONCILED', 'kit_without_confirmation');

-- B-1: дизайнер исправляет паспорт и подтверждает сверку.
update public.projects set passport = '{"object":{"replanning":"yes"},"budget":{"range":"undisclosed","risk_level":"low"}}'::jsonb
where id = '42222222-2222-4222-8222-222222222222';
select pg_temp.confirm('33333333-3333-4333-8333-333333333333',
  (select passport from public.projects where id = '42222222-2222-4222-8222-222222222222'));

-- Изменение паспорта после сверки делает её недействительной для передачи.
update public.projects set passport = '{"object":{"replanning":"maybe"},"budget":{"range":"undisclosed","risk_level":"low"}}'::jsonb
where id = '42222222-2222-4222-8222-222222222222';
select pg_temp.expect_error(
  $sql$ select pg_temp.kit((select confirmed_sections from public.project_handover_drafts where id = '95e00000-0000-4000-8000-000000000001'),
          '{"object":{"replanning":"yes"}}', (select v from v95 where k = 'final_files')) $sql$,
  '42501', 'HANDOVER_KIT_RECONCILIATION_STALE', 'passport_changed_after_confirm');
update public.projects set passport = '{"object":{"replanning":"yes"},"budget":{"range":"undisclosed","risk_level":"low"}}'::jsonb
where id = '42222222-2222-4222-8222-222222222222';
select pg_temp.confirm('33333333-3333-4333-8333-333333333333',
  (select passport from public.projects where id = '42222222-2222-4222-8222-222222222222'));

-- Текст или сводка не те, что подтверждены.
select pg_temp.expect_error(
  $sql$ select pg_temp.kit('[{"id":"works","title":"Состав работ","body":"Бюджет 4 500 000 ₽"}]',
          '{"object":{"replanning":"yes"}}', (select v from v95 where k = 'final_files')) $sql$,
  '42501', 'HANDOVER_KIT_CONTENT_MISMATCH', 'other_text');
select pg_temp.expect_error(
  $sql$ select pg_temp.kit((select confirmed_sections from public.project_handover_drafts where id = '95e00000-0000-4000-8000-000000000001'),
          '{"object":{"replanning":"no"}}', (select v from v95 where k = 'final_files')) $sql$,
  '42501', 'HANDOVER_KIT_CONTENT_MISMATCH', 'other_summary');
-- B-2: manifest не совпадает с выбранными файлами (оригинал клиента вместо копии; лишний файл).
select pg_temp.expect_error(
  $sql$ select pg_temp.kit((select confirmed_sections from public.project_handover_drafts where id = '95e00000-0000-4000-8000-000000000001'),
          '{"object":{"replanning":"yes"}}',
          '[{"kind":"designer_plan","path":"designer-plans/42222222-2222-4222-8222-222222222222/1-plan.pdf"},
            {"kind":"client_file","path":"42222222-2222-4222-8222-222222222222/2-client.pdf"}]') $sql$,
  '42501', 'HANDOVER_KIT_FILES_MISMATCH', 'original_instead_of_copy');
select pg_temp.expect_error(
  $sql$ select pg_temp.kit((select confirmed_sections from public.project_handover_drafts where id = '95e00000-0000-4000-8000-000000000001'),
          '{"object":{"replanning":"yes"}}',
          (select v from v95 where k = 'final_files') || '[{"kind":"client_file","path":"42222222-2222-4222-8222-222222222222/2-client.pdf"}]') $sql$,
  '42501', 'HANDOVER_KIT_FILES_MISMATCH', 'extra_file');

select pg_temp.kit((select confirmed_sections from public.project_handover_drafts where id = '95e00000-0000-4000-8000-000000000001'),
  '{"object":{"replanning":"yes"}}', (select v from v95 where k = 'final_files'));

-- После передачи черновик заперт.
select pg_temp.expect_error(
  $sql$ update public.project_handover_drafts set acknowledged = '["x"]'
        where id = '95e00000-0000-4000-8000-000000000001' $sql$,
  '42501', 'HANDOVER_DRAFT_LOCKED', 'draft_locked');
select pg_temp.expect_error(
  $sql$ delete from public.project_handover_drafts where id = '95e00000-0000-4000-8000-000000000001' $sql$,
  '42501', null, 'draft_delete');

-- === 4. Правки паспорта ======================================================
insert into public.project_passport_corrections (project_id, field, before_value, after_value, corrected_by)
values ('42222222-2222-4222-8222-222222222222', 'object.replanning', '"no"', '"yes"', '33333333-3333-4333-8333-333333333333');
select pg_temp.expect_error(
  $sql$ insert into public.project_passport_corrections (project_id, field, before_value, after_value, corrected_by)
        values ('42222222-2222-4222-8222-222222222222', 'object.replanning', '"no"', '"yes"', '31111111-1111-4111-8111-111111111111') $sql$,
  '42501', null, 'correction_spoofed');
select pg_temp.expect_error(
  $sql$ insert into public.project_passport_corrections (project_id, field, before_value, after_value, corrected_by)
        values ('42222222-2222-4222-8222-222222222222', 'contact.phone', 'null', '"1"', '33333333-3333-4333-8333-333333333333') $sql$,
  '23514', null, 'correction_bad_field');
select pg_temp.expect_error(
  $sql$ update public.project_passport_corrections set after_value = '"no"'
        where project_id = '42222222-2222-4222-8222-222222222222' $sql$,
  '42501', null, 'correction_update');

-- === 5. Видимость ============================================================
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.assert(not exists (select 1 from public.project_handover_drafts where project_id = '42222222-2222-4222-8222-222222222222')
  and not exists (select 1 from public.project_passport_corrections where project_id = '42222222-2222-4222-8222-222222222222'),
  'foreign_studio_reads');
set local role anon;
select pg_temp.expect_error($sql$ select count(*) from public.project_handover_drafts $sql$, '42501', null, 'anon_drafts');
select pg_temp.expect_error($sql$ select count(*) from public.project_passport_corrections $sql$, '42501', null, 'anon_corrections');
reset role;

-- === 6. Внешние ключи: очистка аккаунта не упирается в restrict =============
select pg_temp.assert(not exists (
  select 1 from pg_catalog.pg_constraint c
  where c.contype = 'f' and c.confdeltype <> 'c'
    and c.conrelid in ('public.proposal_responses'::regclass, 'public.project_handover_kits'::regclass,
                       'public.project_handover_receipts'::regclass, 'public.project_handover_drafts'::regclass,
                       'public.project_passport_corrections'::regclass)
), 'cascade_fks');
-- Удаление проекта (как при очистке) уносит черновик, правки, комплект и отметку.
insert into public.project_handover_receipts (kit_id, participant_id)
values ('95f00000-0000-4000-8000-000000000001', '95d00000-0000-4000-8000-000000000001');
delete from public.project_rooms where id = '95c00000-0000-4000-8000-000000000001';
select pg_temp.assert(not exists (select 1 from public.project_handover_kits where id = '95f00000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.project_handover_receipts where kit_id = '95f00000-0000-4000-8000-000000000001'),
  'room_delete_cascades_kit');

rollback;

\echo 'DB4_95_HANDOVER_PREPARATION_OK'
