\set ON_ERROR_STOP on

-- Вертикаль Telegram → Project Inbox → решение человека (A7 §1.8, миграция
-- `20260811060000`).
--
-- Сценарий 42 доказывает, что мост закрыт. Этот доказывает, что открытая его
-- часть ведёт себя как обещано: кандидат остаётся кандидатом, решение
-- принимается один раз, и системная дверь человеку по-прежнему недоступна.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Новые системные двери человеку недоступны
-- ─────────────────────────────────────────────────────────────────────────────

do $inbox_system_closed$
declare
  v_leaked text;
begin
  select signature into v_leaked
  from unnest(array[
    'remhaos_channel_api.claim_channel_events(integer, integer)',
    'remhaos_channel_api.record_inbox_candidate(uuid, text, text, text, text, text, text)',
    'remhaos_channel_api.complete_channel_event(uuid, text, text)',
    'remhaos_channel_api.list_distribution_notification_backlog(integer)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_TG_INBOX_SYSTEM_RPC_REACHABLE:%', v_leaked;
  end if;
end
$inbox_system_closed$;

-- Права — утверждение о доступе; ниже проверяется сам доступ.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $inbox_system_denied$
declare
  v_denied int := 0;
begin
  begin
    perform remhaos_channel_api.claim_channel_events(1, 60);
    raise exception 'DB4_TG_CLAIM_EVENTS_REACHED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;
  begin
    perform remhaos_channel_api.record_inbox_candidate(
      '00000000-0000-4000-8000-000000000000', 'general_note', 'rule',
      'v1', 'probe', null, null
    );
    raise exception 'DB4_TG_RECORD_CANDIDATE_REACHED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;
  begin
    perform remhaos_channel_api.list_distribution_notification_backlog(1);
    raise exception 'DB4_TG_BACKLOG_REACHED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;
  if v_denied <> 3 then
    raise exception 'DB4_TG_INBOX_DENIALS_EXPECTED_3_GOT_%', v_denied;
  end if;
end
$inbox_system_denied$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Подключение чата заново — сценарий 42 оставил проект отключённым
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select remhaos_channel_api.create_binding_intent(
  '41111111-1111-4111-8111-111111111111',
  pg_catalog.sha256(convert_to('db4-inbox-nonce', 'UTF8')),
  600
);
commit;

begin;
set local role service_role;
select remhaos_channel_api.activate_project_binding(
  pg_catalog.sha256(convert_to('db4-inbox-nonce', 'UTF8')),
  777001, 'db4-bot', -100600, 'supergroup', 'notice-v1'
);
commit;

-- Отключённый чат снова подключаем — отозванная связь не мешает вернуться.
do $rebind_ok$
begin
  if not exists (
    select 1 from remhaos_channel.project_channel_bindings
    where project_id = '41111111-1111-4111-8111-111111111111'
      and status = 'active' and external_chat_id = -100600
  ) then
    raise exception 'DB4_TG_REBIND_FAILED';
  end if;
end
$rebind_ok$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Разбор: сообщение → кандидат, повтор не плодит второго
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 6001, -100600, 101, 'message', 777001, null, null, null,
  '{"kind":"message","text":"Плитки нет в наличии, поставим аналог","attachmentCount":0}'::jsonb
);
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 6002, -100600, 102, 'message', 777001, null, null, null,
  '{"kind":"message","text":"ок","attachmentCount":0}'::jsonb
);
commit;

begin;
set local role service_role;
select set_config(
  'projectceo.db4_tg_claimed',
  remhaos_channel_api.claim_channel_events(10, 60) -> 'data' #>> '{}',
  false
);
commit;

do $claim_shape$
declare
  v_claimed jsonb := current_setting('projectceo.db4_tg_claimed')::jsonb;
begin
  if jsonb_array_length(v_claimed) <> 2 then
    raise exception 'DB4_TG_CLAIMED_EXPECTED_2_GOT_%', jsonb_array_length(v_claimed);
  end if;
  -- Захват уже произошёл: повторный вызов не должен выдать те же строки, иначе
  -- два параллельных разборщика взялись бы за одну работу.
  if exists (
    select 1 from remhaos_channel.channel_events
    where update_id in (6001, 6002) and processing_state <> 'processing'
  ) then
    raise exception 'DB4_TG_CLAIM_DID_NOT_LEASE';
  end if;
end
$claim_shape$;

begin;
set local role service_role;
do $second_claim_empty$
declare
  v_second jsonb;
begin
  v_second := remhaos_channel_api.claim_channel_events(10, 60) -> 'data';
  if jsonb_array_length(v_second) <> 0 then
    raise exception 'DB4_TG_LEASED_EVENT_CLAIMED_TWICE:%', jsonb_array_length(v_second);
  end if;
end
$second_claim_empty$;
rollback;

-- Идентификаторы событий берутся ИЗ ОТВЕТА захвата, а не из таблицы: у
-- `service_role` нет доступа к приватной схеме, и настоящий разборщик читает
-- их ровно отсюда. Первая редакция сценария лезла в `channel_events` напрямую
-- и упала «permission denied for schema remhaos_channel» — падение верное,
-- сценарий шёл не тем путём, каким ходит воркер.
select set_config(
  'projectceo.db4_tg_event_change',
  (select c ->> 'eventId'
   from jsonb_array_elements(current_setting('projectceo.db4_tg_claimed')::jsonb) c
   where (c ->> 'externalMessageId')::bigint = 101),
  false
);
select set_config(
  'projectceo.db4_tg_event_ack',
  (select c ->> 'eventId'
   from jsonb_array_elements(current_setting('projectceo.db4_tg_claimed')::jsonb) c
   where (c ->> 'externalMessageId')::bigint = 102),
  false
);

-- Разборщик записал кандидата по первому событию и пропустил «ок».
begin;
set local role service_role;
select remhaos_channel_api.record_inbox_candidate(
  current_setting('projectceo.db4_tg_event_change')::uuid,
  'change_request_candidate', 'rule', 'telegram-extraction/1',
  'Плитки нет в наличии, поставим аналог', 'medium', null
);
-- Повтор того же разбора: второго кандидата быть не должно.
select remhaos_channel_api.record_inbox_candidate(
  current_setting('projectceo.db4_tg_event_change')::uuid,
  'change_request_candidate', 'rule', 'telegram-extraction/1',
  'Плитки нет в наличии, поставим аналог', 'medium', null
);
select remhaos_channel_api.complete_channel_event(
  current_setting('projectceo.db4_tg_event_change')::uuid, 'processed', null
);
select remhaos_channel_api.complete_channel_event(
  current_setting('projectceo.db4_tg_event_ack')::uuid, 'ignored', null
);
commit;

do $candidate_contract$
declare
  v_count integer;
begin
  select count(*) into v_count
  from remhaos_channel.project_inbox_candidates c
  join remhaos_channel.channel_events e on e.event_id = c.event_id
  where e.update_id = 6001;
  if v_count <> 1 then
    raise exception 'DB4_TG_CANDIDATE_DUPLICATED:%', v_count;
  end if;

  if not exists (
    select 1 from remhaos_channel.channel_events
    where update_id = 6002 and processing_state = 'ignored'
  ) then
    raise exception 'DB4_TG_IGNORED_NOT_RECORDED';
  end if;

  -- Кандидат рождается БЕЗ следа официального объекта. Если он однажды
  -- появится сам, граница «предложено ≠ утверждено» сломается молча.
  if exists (
    select 1 from remhaos_channel.project_inbox_candidates
    where resulting_entity_id is not null and status <> 'confirmed'
  ) then
    raise exception 'DB4_TG_CANDIDATE_BORN_WITH_ENTITY';
  end if;
end
$candidate_contract$;

-- Идентификатор карточки тоже сташится на верхнем уровне: под ролью
-- `authenticated` приватная схема недоступна, а экран получает карточки из
-- ответа `list_project_inbox`, а не из таблицы.
select set_config(
  'projectceo.db4_tg_candidate_change',
  (select c.candidate_id::text
   from remhaos_channel.project_inbox_candidates c
   where c.event_id = current_setting('projectceo.db4_tg_event_change')::uuid),
  false
);

-- Системная дверь не принимает `human` как происхождение: человек оставляет
-- своё решение своей сессией, а не через дверь разборщика.
begin;
set local role service_role;
do $origin_human_denied$
begin
  begin
    perform remhaos_channel_api.record_inbox_candidate(
      current_setting('projectceo.db4_tg_event_ack')::uuid,
      'general_note', 'human', 'telegram-extraction/1', 'подделка', null, null
    );
    raise exception 'DB4_TG_HUMAN_ORIGIN_ACCEPTED_BY_SYSTEM';
  exception when sqlstate 'P1111' then null;
  end;
end
$origin_human_denied$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Решение человека
-- ─────────────────────────────────────────────────────────────────────────────

-- Чужой человек кандидата не видит и не решает.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $outsider_denied$
begin
  begin
    perform remhaos_channel_api.list_project_inbox(
      '41111111-1111-4111-8111-111111111111', 10
    );
    raise exception 'DB4_TG_OUTSIDER_READ_INBOX';
  exception when sqlstate 'P1103' then null;
  end;
end
$outsider_denied$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select set_config(
  'projectceo.db4_tg_inbox',
  remhaos_channel_api.list_project_inbox(
    '41111111-1111-4111-8111-111111111111', 50
  ) -> 'data' #>> '{}',
  false
);
commit;

do $inbox_shape$
declare
  v_inbox jsonb := current_setting('projectceo.db4_tg_inbox')::jsonb;
  v_first jsonb := v_inbox -> 'candidates' -> 0;
begin
  if v_inbox ->> 'canReview' is distinct from 'true' then
    raise exception 'DB4_TG_OWNER_CANNOT_REVIEW';
  end if;
  if v_first ->> 'status' is distinct from 'pending' then
    raise exception 'DB4_TG_CANDIDATE_NOT_PENDING:%', v_first ->> 'status';
  end if;
  if v_first ->> 'origin' is distinct from 'rule' then
    raise exception 'DB4_TG_CANDIDATE_ORIGIN_WRONG:%', v_first ->> 'origin';
  end if;
  -- Экран получает СВОДКУ, а не сырое событие: ни `payload`, ни идентификаторов
  -- Telegram в ответе нет.
  if v_inbox::text ~ 'externalChatId|externalSenderId|payload' then
    raise exception 'DB4_TG_INBOX_LEAKS_TRANSPORT_FIELDS';
  end if;
end
$inbox_shape$;

-- Строитель кандидатов не решает: `review_source` у него нет.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $builder_review$
declare
  v_inbox jsonb;
begin
  -- Архитектор проекта: читать может и решать может — у него есть
  -- `review_source`. Строка проверяет, что право не привязано к владельцу.
  v_inbox := remhaos_channel_api.list_project_inbox(
    '41111111-1111-4111-8111-111111111111', 10
  ) -> 'data';
  if v_inbox ->> 'canReview' is distinct from 'true' then
    raise exception 'DB4_TG_ARCHITECT_CANNOT_REVIEW';
  end if;
end
$builder_review$;
rollback;

-- Решение принимается один раз.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select remhaos_channel_api.review_inbox_candidate(
  '41111111-1111-4111-8111-111111111111',
  current_setting('projectceo.db4_tg_candidate_change')::uuid,
  'confirm', 'change_request', 'db4-change-1'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $review_once$
begin
  begin
    perform remhaos_channel_api.review_inbox_candidate(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.db4_tg_candidate_change')::uuid,
      'reject', null, null
    );
    raise exception 'DB4_TG_CANDIDATE_REVIEWED_TWICE';
  exception when sqlstate 'P1109' then null;
  end;
end
$review_once$;
rollback;

do $review_recorded$
declare
  v_candidate record;
begin
  select status, reviewed_by_user_id, reviewed_at, resulting_entity_id
  into v_candidate
  from remhaos_channel.project_inbox_candidates
  where candidate_id = current_setting('projectceo.db4_tg_candidate_change')::uuid;

  if v_candidate.status <> 'confirmed' then
    raise exception 'DB4_TG_REVIEW_NOT_RECORDED:%', v_candidate.status;
  end if;
  -- Анонимного подтверждения не бывает: на авторе и времени держится вся
  -- граница «предложено ≠ утверждено».
  if v_candidate.reviewed_by_user_id is null or v_candidate.reviewed_at is null then
    raise exception 'DB4_TG_REVIEW_ANONYMOUS';
  end if;
  if v_candidate.resulting_entity_id <> 'db4-change-1' then
    raise exception 'DB4_TG_RESULT_TRACE_LOST';
  end if;
end
$review_recorded$;

-- Отклонение со следом официального объекта невозможно: отклонённый кандидат
-- не может указывать на созданное изменение.
begin;
set local role service_role;
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 6003, -100600, 103, 'message', 777001, null, null, null,
  '{"kind":"message","text":"Сроки поедут, не успеваем","attachmentCount":0}'::jsonb
);
commit;

-- Второй проход захвата: разборщик снова спрашивает базу, что появилось.
begin;
set local role service_role;
select set_config(
  'projectceo.db4_tg_event_risk',
  remhaos_channel_api.claim_channel_events(10, 60) -> 'data' -> 0 ->> 'eventId',
  false
);
select remhaos_channel_api.record_inbox_candidate(
  current_setting('projectceo.db4_tg_event_risk')::uuid,
  'risk_candidate', 'rule', 'telegram-extraction/1', 'Сроки поедут', 'medium', null
);
commit;

select set_config(
  'projectceo.db4_tg_candidate_risk',
  (select c.candidate_id::text
   from remhaos_channel.project_inbox_candidates c
   where c.event_id = current_setting('projectceo.db4_tg_event_risk')::uuid),
  false
);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $reject_with_entity$
begin
  begin
    perform remhaos_channel_api.review_inbox_candidate(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.db4_tg_candidate_risk')::uuid,
      'reject', 'change_request', 'db4-change-2'
    );
    raise exception 'DB4_TG_REJECTED_CANDIDATE_GOT_ENTITY';
  exception when sqlstate 'P1111' then null;
  end;
end
$reject_with_entity$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Хвост уведомлений: выдачи M4 без записи в очереди
-- ─────────────────────────────────────────────────────────────────────────────

do $backlog_contract$
declare
  v_backlog jsonb;
  v_before integer;
  v_after integer;
begin
  select count(*) into v_before from remhaos_channel.notification_outbox;

  -- Хвост читается системой; здесь верхний уровень, то есть суперпользователь.
  v_backlog := remhaos_channel_api.list_distribution_notification_backlog(50) -> 'data';

  -- Проект DB4 выдач пакета не имеет, поэтому хвост пуст. Проверяется именно
  -- это: функция обязана быть безопасным no-op на пустой очереди, а не падать.
  if jsonb_typeof(v_backlog) <> 'array' then
    raise exception 'DB4_TG_BACKLOG_NOT_ARRAY';
  end if;

  select count(*) into v_after from remhaos_channel.notification_outbox;
  -- Чтение хвоста ничего не создаёт: это read-модель проектора.
  if v_before <> v_after then
    raise exception 'DB4_TG_BACKLOG_WROTE_ROWS';
  end if;
end
$backlog_contract$;

\echo DB4_TELEGRAM_INBOX_VERTICAL_OK
