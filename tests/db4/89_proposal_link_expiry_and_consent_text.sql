\set ON_ERROR_STOP on

-- DB4-89: оценка ПДн 01.10.2026 (миграции 20260928156000, 20260928157000).
-- 1. Клиентская ссылка на КП получает срок 90 дней при отправке (и при вставке
--    уже отправленного КП — перенос), дизайнер может продлить не дальше 90 дней
--    или отозвать; снять срок нельзя; у черновика срок не меняется; чужая
--    студия не трогает чужое КП.
-- 2. Запись согласия хранит точный текст; хеш обязан совпадать с текстом.
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
      raise exception 'DB4_89_WRONG_FAILURE:%:%:%', p_label, v_state, v_message;
    end if;
    return;
  end;
  raise exception 'DB4_89_EXPECTED_FAILURE:%', p_label;
end
$function$;

-- === 1. Срок ссылки ===========================================================

-- Перенос: вставка уже отправленного КП — срок от даты отправки.
insert into public.proposals (id, project_id, version, sections, status, public_token, sent_at)
values ('89a00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        11, '[]'::jsonb, 'sent', 'db4-89-token-transferred', statement_timestamp() - interval '10 days');

-- Обычная отправка: черновик → отправлено (сервером), срок ставит база.
insert into public.proposals (id, project_id, version, sections, status, public_token)
values ('89b00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        12, '[]'::jsonb, 'draft', 'db4-89-token-sent');
update public.proposals set status = 'sent' where id = '89b00000-0000-4000-8000-000000000001';

-- Черновик для проверки «у черновика срок не меняется».
insert into public.proposals (id, project_id, version, sections, status, public_token)
values ('89c00000-0000-4000-8000-000000000001', '42222222-2222-4222-8222-222222222222',
        13, '[]'::jsonb, 'draft', 'db4-89-token-draft');

do $expiry_set$
begin
  if (select public_expires_at <> sent_at + interval '90 days' from public.proposals
      where id = '89a00000-0000-4000-8000-000000000001') then
    raise exception 'DB4_89_TRANSFER_EXPIRY_NOT_FROM_SENT_AT';
  end if;
  if (select abs(extract(epoch from public_expires_at - (statement_timestamp() + interval '90 days'))) > 60
      from public.proposals where id = '89b00000-0000-4000-8000-000000000001') then
    raise exception 'DB4_89_SEND_EXPIRY_NOT_90_DAYS';
  end if;
  if (select public_expires_at from public.proposals where id = '89c00000-0000-4000-8000-000000000001') is not null then
    raise exception 'DB4_89_DRAFT_HAS_EXPIRY';
  end if;
end
$expiry_set$;

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- Отзыв и продление своей ссылки — можно.
update public.proposals set public_expires_at = statement_timestamp()
where id = '89b00000-0000-4000-8000-000000000001';
update public.proposals set public_expires_at = statement_timestamp() + interval '90 days'
where id = '89b00000-0000-4000-8000-000000000001';
-- Дальше 90 дней и «без срока» — нельзя.
select pg_temp.expect_error(
  $sql$ update public.proposals set public_expires_at = statement_timestamp() + interval '200 days'
        where id = '89b00000-0000-4000-8000-000000000001' $sql$,
  '42501', 'PROPOSAL_PUBLIC_EXPIRY_OUT_OF_RANGE', 'extend_too_far');
select pg_temp.expect_error(
  $sql$ update public.proposals set public_expires_at = null
        where id = '89b00000-0000-4000-8000-000000000001' $sql$,
  '42501', 'PROPOSAL_PUBLIC_EXPIRY_OUT_OF_RANGE', 'remove_expiry');
-- У черновика срок не появляется.
update public.proposals set public_expires_at = statement_timestamp() + interval '10 days'
where id = '89c00000-0000-4000-8000-000000000001';
reset role;

do $draft_untouched$
begin
  if (select public_expires_at from public.proposals where id = '89c00000-0000-4000-8000-000000000001') is not null then
    raise exception 'DB4_89_DRAFT_EXPIRY_CHANGED';
  end if;
end
$draft_untouched$;

-- Чужая студия не меняет срок чужого КП (RLS: ноль строк).
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}';
update public.proposals set public_expires_at = statement_timestamp()
where id = '89a00000-0000-4000-8000-000000000001';
reset role;

do $foreign_untouched$
begin
  if (select public_expires_at <> sent_at + interval '90 days' from public.proposals
      where id = '89a00000-0000-4000-8000-000000000001') then
    raise exception 'DB4_89_FOREIGN_STUDIO_CHANGED_EXPIRY';
  end if;
end
$foreign_untouched$;

-- === 2. Текст согласия ========================================================

set local role service_role;
insert into public.intake_consent_records (project_id, consent_version, consent_text_sha256, consent_text, source)
values ('42222222-2222-4222-8222-222222222222', 'consent-draft-2026-10-01',
        encode(sha256(convert_to('Даю Студия (Имя) согласие на обработку моих данных.', 'UTF8')), 'hex'),
        'Даю Студия (Имя) согласие на обработку моих данных.', 'designer_intake');
select pg_temp.expect_error(
  $sql$ insert into public.intake_consent_records (project_id, consent_version, consent_text_sha256, consent_text, source)
        values ('42222222-2222-4222-8222-222222222222', 'consent-draft-2026-10-01', repeat('a', 64),
                'Даю Студия (Имя) согласие на обработку моих данных.', 'designer_intake') $sql$,
  '23514', null, 'hash_mismatch');
select pg_temp.expect_error(
  $sql$ insert into public.intake_consent_records (project_id, consent_version, consent_text_sha256, consent_text, source)
        values ('42222222-2222-4222-8222-222222222222', 'consent-draft-2026-10-01',
                encode(sha256(convert_to('коротко', 'UTF8')), 'hex'), 'коротко', 'designer_intake') $sql$,
  '23514', null, 'text_too_short');
reset role;

rollback;

select 'DB4_PROPOSAL_LINK_EXPIRY_AND_CONSENT_TEXT_OK' as result;
