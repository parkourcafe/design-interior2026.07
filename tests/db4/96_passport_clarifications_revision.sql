\set ON_ERROR_STOP on

-- DB4-96: уточнения клиента в паспорте (ТЗ 08.10.2026, FIX-03). Паспорт с
-- уточнениями — обычная новая ревизия существующего механизма; отдельной
-- логики в базе нет, файл фиксирует обязательные регрессии:
--   1. запись паспорта с уточнениями добавляет ревизию, прежние ревизии
--      не меняются (журнал только на добавление);
--   2. текущая ревизия меняется — одобрение прежней ревизии к новой не
--      относится (сама проверка одобрения — DB4-82);
--   3. сверка B-1, подтверждённая на паспорте без уточнений, для передачи
--      недействительна: комплект из устаревшей сверки — отказ;
--   4. уже переданный комплект (текст, сводка, manifest) после новой
--      ревизии не меняется.
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
      raise exception 'DB4_96_WRONG_FAILURE:%:%:%', p_label, v_state, v_message;
    end if;
    return;
  end;
  raise exception 'DB4_96_EXPECTED_FAILURE:%', p_label;
end
$function$;

create function pg_temp.assert(p_ok boolean, p_label text)
returns void language plpgsql as $function$
begin
  if p_ok is not true then
    raise exception 'DB4_96_ASSERT:%', p_label;
  end if;
end
$function$;

create temp table v96 (k text primary key, v jsonb) on commit drop;
grant all on v96 to authenticated;
insert into v96 values
  ('p0', '{"object":{"type":"flat","area_m2":64},"budget":{"range":[1000000,2000000],"risk_level":"mid"},"lifestyle":{"cooking":"basic"}}'),
  ('p1', '{"object":{"type":"flat","area_m2":64},"budget":{"range":[1000000,2000000],"risk_level":"mid"},"lifestyle":{"cooking":"basic"},
           "clarifications":[{"question_id":"cooking","question":"Готовите ли вы дома?","text":"Готовлю по выходным, звонить +7 900 000-00-00, бюджет 4 500 000 ₽"}]}'),
  ('p2', '{"object":{"type":"flat","area_m2":64},"budget":{"range":[1000000,2000000],"risk_level":"mid"},"lifestyle":{"cooking":"basic"},
           "clarifications":[{"question_id":"cooking","question":"Готовите ли вы дома?","text":"Готовлю по выходным, звонить +7 900 000-00-00, бюджет 4 500 000 ₽"},
                             {"question_id":"storage","question":"Что сейчас не помещается?","text":"Велосипед, test@clarify.test"}]}'),
  -- Сводка исполнителя строится приложением по явному списку полей и уточнений не содержит.
  ('summary', '{"object":{"type":"flat","area_m2":64},"budget":{"range":"undisclosed","risk_level":"mid"},"lifestyle":{"cooking":"basic"}}');

update public.projects set passport = (select v from v96 where k = 'p0')
where id = '42222222-2222-4222-8222-222222222222';
insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
values ('96a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222', 51,
        '[{"id":"works","title":"Состав работ","body":"Кухня по проекту"}]'::jsonb,
        'accepted', 'db4-96-accepted', statement_timestamp());
insert into public.project_rooms (id, project_id, proposal_id, scope_package)
values ('96c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        '96a00000-0000-4000-8000-000000000001', 'full');

insert into v96 select 'rev_p0', to_jsonb(projectceo_platform._current_passport_revision('42222222-2222-4222-8222-222222222222'));

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

insert into public.project_handover_drafts (id, project_id, proposal_id, proposal_version, contractor_sections, created_by)
values ('96e00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        '96a00000-0000-4000-8000-000000000001', 51,
        '[{"id":"works","title":"Состав работ","body":"Кухня по проекту"}]',
        '33333333-3333-4333-8333-333333333333');

create function pg_temp.confirm() returns void language sql as $function$
  update public.project_handover_drafts
  set confirmed_at = statement_timestamp(), confirmed_by = '33333333-3333-4333-8333-333333333333',
      confirmed_sections = contractor_sections, confirmed_files = files,
      confirmed_acknowledged = acknowledged,
      confirmed_passport = (select passport from public.projects where id = '42222222-2222-4222-8222-222222222222'),
      confirmed_passport_summary = (select v from v96 where k = 'summary')
  where id = '96e00000-0000-4000-8000-000000000001'
$function$;
create function pg_temp.kit() returns void language sql as $function$
  insert into public.project_handover_kits (id, room_id, project_id, proposal_id, proposal_version,
    proposal_sections, passport_summary, manifest, created_by, draft_id)
  values ('96f00000-0000-4000-8000-000000000001', '96c00000-0000-4000-8000-000000000001',
    '42222222-2222-4222-8222-222222222222', '96a00000-0000-4000-8000-000000000001', 51,
    (select confirmed_sections from public.project_handover_drafts where id = '96e00000-0000-4000-8000-000000000001'),
    (select v from v96 where k = 'summary'),
    '[{"kind":"proposal","name":"КП","sha256":"00","size":1},{"kind":"passport_summary","name":"Сводка","sha256":"01","size":1}]',
    '33333333-3333-4333-8333-333333333333', '96e00000-0000-4000-8000-000000000001')
$function$;

-- Сверка на паспорте без уточнений.
select pg_temp.confirm();

-- === 1–2. Паспорт с уточнениями — новая ревизия, прежние неизменны ==========
update public.projects set passport = (select v from v96 where k = 'p1')
where id = '42222222-2222-4222-8222-222222222222';
reset role;
select pg_temp.assert(
  projectceo_platform._current_passport_revision('42222222-2222-4222-8222-222222222222')
    = (select v::bigint from v96 where k = 'rev_p0') + 1, 'clarification_adds_revision');
select pg_temp.assert((select passport = (select v from v96 where k = 'p0') from public.project_passport_revisions
  where project_id = '42222222-2222-4222-8222-222222222222'
    and revision_no = (select v::bigint from v96 where k = 'rev_p0')), 'previous_revision_unchanged');
select pg_temp.assert((select passport -> 'clarifications' -> 0 ->> 'question_id' = 'cooking' from public.project_passport_revisions
  where project_id = '42222222-2222-4222-8222-222222222222'
    and revision_no = (select v::bigint from v96 where k = 'rev_p0') + 1), 'clarification_bound_to_question');
select pg_temp.expect_error(
  $sql$ update public.project_passport_revisions set passport = '{}'
        where project_id = '42222222-2222-4222-8222-222222222222' $sql$,
  '55000', 'PROJECTCEO_M1_PASSPORT_REVISION_IMMUTABLE', 'revision_immutable');
set local role authenticated;

-- === 3. Комплект из сверки, подтверждённой до уточнений, — отказ ============
select pg_temp.expect_error($sql$ select pg_temp.kit() $sql$,
  '42501', 'HANDOVER_KIT_RECONCILIATION_STALE', 'kit_from_pre_clarification_reconciliation');

-- Новая сверка на текущей ревизии — комплект выдаётся.
select pg_temp.confirm();
select pg_temp.kit();
insert into v96 select 'kit', to_jsonb(k) - 'updated_at' from public.project_handover_kits k
where id = '96f00000-0000-4000-8000-000000000001';
select pg_temp.assert((select position('+7 900' in v::text) = 0 and position('4 500 000' in v::text) = 0
  and position('clarifications' in v::text) = 0 from v96 where k = 'kit'), 'kit_without_clarifications');

-- === 4. Новая ревизия после передачи комплект не меняет ======================
update public.projects set passport = (select v from v96 where k = 'p2')
where id = '42222222-2222-4222-8222-222222222222';
select pg_temp.assert((select to_jsonb(k) - 'updated_at' = (select v from v96 where k = 'kit')
  from public.project_handover_kits k where id = '96f00000-0000-4000-8000-000000000001'), 'delivered_kit_unchanged');
reset role;
select pg_temp.assert(
  projectceo_platform._current_passport_revision('42222222-2222-4222-8222-222222222222')
    = (select v::bigint from v96 where k = 'rev_p0') + 2, 'second_clarification_adds_revision');

rollback;
