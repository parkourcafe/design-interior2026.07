\set ON_ERROR_STOP on

-- Операции Telegram Chat Bridge: подключение, приём, кандидаты, уведомления
-- (A7 / DEC-031, миграции `20260811040000` и `20260811050000`).
--
-- Сценарий стоит ПОСЛЕ продуктовых операций намеренно: к этому моменту в
-- проекте есть настоящая выдача выпуска, и догоняющий проектор уведомлений
-- проверяется на ней, а не на выдуманной строке.
--
-- ФОРМА СЦЕНАРИЯ. Внутри блоков `set local role` стоят ТОЛЬКО вызовы RPC:
-- приватные таблицы шлюза не читает ни `authenticated`, ни `service_role`, и это
-- часть проверяемого контракта, а не неудобство сценария. Идентификаторы
-- снимаются суперпользователем через `\gset` до блока, утверждения — после.
--
-- Сценарий оставляет после себя два ПОГАШЕННЫХ интента подключения — по одному
-- на каждый из двух проектов разных организаций. Ими пользуется
-- `run-concurrency.zsh`, чтобы столкнуть два подключения одного чата лбами.

\set project_a '41111111-1111-4111-8111-111111111111'
\set project_b '42222222-2222-4222-8222-222222222222'
\set owner_a '31111111-1111-4111-8111-111111111111'
\set architect '32222222-2222-4222-8222-222222222222'
\set owner_b '33333333-3333-4333-8333-333333333333'

-- ---------------------------------------------------------------------------
-- 1. Право на подключение канала есть только у владельца проекта
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'architect';
do $intent_requires_capability$
begin
  -- Архитектор проекта — участник с широкими правами, но подключение канала не
  -- его действие: `manage_project_integrations` в P0 только у владельца.
  begin
    perform projectceo_gateway_api.create_channel_link_intent(
      '41111111-1111-4111-8111-111111111111', 'identity_link', 'db4-bot',
      encode(sha256(convert_to('db4-architect-nonce', 'UTF8')), 'hex'), 600
    );
    raise exception 'DB4_TELEGRAM_INTENT_ALLOWED_WITHOUT_CAPABILITY';
  exception
    when sqlstate 'P1103' then null;
  end;
end
$intent_requires_capability$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
do $intent_rejects_foreign_project$
begin
  -- Владелец ДРУГОЙ организации к этому проекту не получает ничего, и отказ не
  -- подсказывает, существует ли проект.
  begin
    perform projectceo_gateway_api.create_channel_link_intent(
      '41111111-1111-4111-8111-111111111111', 'identity_link', 'db4-bot',
      encode(sha256(convert_to('db4-outsider-nonce', 'UTF8')), 'hex'), 600
    );
    raise exception 'DB4_TELEGRAM_INTENT_CROSSED_ORGANIZATION';
  exception
    when sqlstate 'P1103' then null;
  end;
end
$intent_rejects_foreign_project$;
rollback;

-- TTL не растягивается параметром: верхняя граница живёт в базе.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
do $intent_ttl_bounded$
begin
  begin
    perform projectceo_gateway_api.create_channel_link_intent(
      '41111111-1111-4111-8111-111111111111', 'identity_link', 'db4-bot',
      encode(sha256(convert_to('db4-long-ttl', 'UTF8')), 'hex'), 86400
    );
    raise exception 'DB4_TELEGRAM_INTENT_ACCEPTED_LONG_TTL';
  exception
    when sqlstate 'P1111' then null;
  end;
end
$intent_ttl_bounded$;
rollback;

-- ---------------------------------------------------------------------------
-- 2. Связывание идентичности
-- ---------------------------------------------------------------------------

select encode(sha256(convert_to('db4-owner-identity', 'UTF8')), 'hex') as identity_hex \gset
select set_config('db4.identity_hex', :'identity_hex', false);
select encode(sha256(convert_to('db4-expired', 'UTF8')), 'hex') as expired_hex \gset
select set_config('db4.expired_hex', :'expired_hex', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select projectceo_gateway_api.create_channel_link_intent(
  :'project_a', 'identity_link', 'db4-bot', :'identity_hex', 600
);
commit;

begin;
set local role service_role;
do $identity_guards$
declare
  v_hex constant text := current_setting('db4.identity_hex');
begin
  -- Только числовой идентификатор. Ни username, ни телефон, ни имя.
  begin
    perform projectceo_gateway_api.consume_channel_link_intent(
      v_hex, 'identity_link', 'db4-bot', '@selena'
    );
    raise exception 'DB4_TELEGRAM_IDENTITY_ACCEPTED_USERNAME';
  exception
    when sqlstate 'P1111' then null;
  end;

  -- Чужой бот тем же токеном ничего не получает.
  begin
    perform projectceo_gateway_api.consume_channel_link_intent(
      v_hex, 'identity_link', 'other-bot', '770001'
    );
    raise exception 'DB4_TELEGRAM_INTENT_ACCEPTED_FOREIGN_BOT';
  exception
    when sqlstate 'P1103' then null;
  end;

  -- Чужое назначение тем же токеном не работает: интент привязан к purpose.
  begin
    perform projectceo_gateway_api.consume_channel_link_intent(
      v_hex, 'channel_binding', 'db4-bot', '770001'
    );
    raise exception 'DB4_TELEGRAM_INTENT_ACCEPTED_FOREIGN_PURPOSE';
  exception
    when sqlstate 'P1103' then null;
  end;
end
$identity_guards$;
rollback;

begin;
set local role service_role;
select projectceo_gateway_api.complete_identity_link(
  (projectceo_gateway_api.consume_channel_link_intent(
    :'identity_hex', 'identity_link', 'db4-bot', '770001'
  ) -> 'data' ->> 'intentId')::uuid,
  '770001'
);
commit;

begin;
set local role service_role;
do $intent_single_use$
declare
  v_hex constant text := current_setting('db4.identity_hex');
begin
  -- Одноразовость: тот же токен второй раз не работает никогда.
  begin
    perform projectceo_gateway_api.consume_channel_link_intent(
      v_hex, 'identity_link', 'db4-bot', '770001'
    );
    raise exception 'DB4_TELEGRAM_INTENT_REPLAYED';
  exception
    when sqlstate 'P1103' then null;
  end;
end
$intent_single_use$;
rollback;

-- Истёкший токен неотличим от несуществующего.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select projectceo_gateway_api.create_channel_link_intent(
  :'project_a', 'identity_link', 'db4-bot', :'expired_hex', 600
);
commit;

update projectceo_gateway.channel_link_intents
set expires_at = statement_timestamp() - interval '1 second',
    created_at = statement_timestamp() - interval '10 minutes'
where nonce_digest = decode(:'expired_hex', 'hex');

begin;
set local role service_role;
do $intent_expired$
declare
  v_hex constant text := current_setting('db4.expired_hex');
begin
  begin
    perform projectceo_gateway_api.consume_channel_link_intent(
      v_hex, 'identity_link', 'db4-bot', '770001'
    );
    raise exception 'DB4_TELEGRAM_INTENT_ACCEPTED_EXPIRED';
  exception
    when sqlstate 'P1103' then null;
  end;

  -- Украденный либо выдуманный токен — тот же отказ, без подсказок.
  begin
    perform projectceo_gateway_api.consume_channel_link_intent(
      encode(sha256(convert_to('db4-never-existed', 'UTF8')), 'hex'),
      'identity_link', 'db4-bot', '770001'
    );
    raise exception 'DB4_TELEGRAM_INTENT_ACCEPTED_UNKNOWN';
  exception
    when sqlstate 'P1103' then null;
  end;
end
$intent_expired$;
rollback;

-- Связь живёт по числовому идентификатору, и колонки под username в схеме нет
-- вовсе: сменить его — значит не тронуть ничего.
do $identity_shape$
declare
  v_column text;
begin
  select column_name into v_column
  from information_schema.columns
  where table_schema = 'projectceo_gateway'
    and table_name = 'channel_identity_links'
    and column_name !~ '^(organization_id|provider|external_actor_id|user_id|status|linked_at|revoked_at)$'
  limit 1;
  if v_column is not null then
    raise exception 'DB4_TELEGRAM_IDENTITY_EXTRA_COLUMN:%', v_column;
  end if;

  if not exists (
    select 1 from projectceo_gateway.channel_identity_links
    where external_actor_id = '770001' and status = 'active'
      and user_id = '31111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'DB4_TELEGRAM_IDENTITY_NOT_LINKED';
  end if;

  -- Другой числовой идентификатор связи не получает: она именно у этого.
  if exists (
    select 1 from projectceo_gateway.channel_identity_links
    where external_actor_id = '770099'
  ) then
    raise exception 'DB4_TELEGRAM_IDENTITY_LEAKED_TO_OTHER_ACTOR';
  end if;
end
$identity_shape$;

-- ---------------------------------------------------------------------------
-- 3. Подключение чата
-- ---------------------------------------------------------------------------

select encode(sha256(convert_to('db4-binding-1', 'UTF8')), 'hex') as binding_hex \gset

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select projectceo_gateway_api.create_channel_link_intent(
  :'project_a', 'channel_binding', 'db4-bot', :'binding_hex', 600
);
commit;

begin;
set local role service_role;
select projectceo_gateway_api.consume_channel_link_intent(
  :'binding_hex', 'channel_binding', 'db4-bot', '770001'
);
commit;

select intent_id::text as binding_intent
from projectceo_gateway.channel_link_intents
where nonce_digest = decode(:'binding_hex', 'hex') \gset

select set_config('db4.binding_intent', :'binding_intent', false);

begin;
set local role service_role;
do $binding_requires_chat_admin$
declare
  v_intent constant uuid := current_setting('db4.binding_intent')::uuid;
begin
  -- Не администратор группы — не подключает. Проверку делает транспорт, но
  -- отказ стоит здесь: забыть о ней нельзя.
  begin
    perform projectceo_gateway_api.complete_channel_binding(
      v_intent, '770001', '-1001000000001', 'supergroup', false, 'notice/0.1'
    );
    raise exception 'DB4_TELEGRAM_BINDING_ALLOWED_WITHOUT_ADMIN';
  exception
    when sqlstate 'P1103' then null;
  end;

  -- Нажал в Telegram не тот, кто заводил интент.
  begin
    perform projectceo_gateway_api.complete_channel_binding(
      v_intent, '779999', '-1001000000001', 'supergroup', true, 'notice/0.1'
    );
    raise exception 'DB4_TELEGRAM_BINDING_ALLOWED_FOREIGN_ACTOR';
  exception
    when sqlstate 'P1103' then null;
  end;
end
$binding_requires_chat_admin$;
rollback;

begin;
set local role service_role;
select projectceo_gateway_api.complete_channel_binding(
  :'binding_intent'::uuid, '770001', '-1001000000001', 'supergroup', true, 'notice/0.1'
);
commit;

select binding_id::text as binding_a
from projectceo_gateway.project_channel_bindings
where project_id = :'project_a' and status = 'active' \gset

select set_config('db4.binding_a', :'binding_a', false);

-- До уведомления участников содержимое НЕ сохраняется.
begin;
set local role service_role;
do $capture_requires_notice$
declare
  v_binding constant uuid := current_setting('db4.binding_a')::uuid;
begin
  begin
    perform projectceo_gateway_api.record_channel_event(
      v_binding, 9001, '-1001000000001', 11, '770001',
      'message', 1, null, null, null, null, 'Сообщение до уведомления'
    );
    raise exception 'DB4_TELEGRAM_CAPTURED_BEFORE_NOTICE';
  exception
    when sqlstate 'P1103' then null;
  end;
end
$capture_requires_notice$;
rollback;

do $nothing_captured_before_notice$
begin
  if exists (select 1 from projectceo_gateway.channel_events) then
    raise exception 'DB4_TELEGRAM_STORED_CONTENT_BEFORE_NOTICE';
  end if;
end
$nothing_captured_before_notice$;

begin;
set local role service_role;
select projectceo_gateway_api.mark_channel_notice_posted(:'binding_a'::uuid, 'notice/0.1');
commit;

-- Несвязанный чат: привязки нет, значит и записывать некуда.
begin;
set local role service_role;
do $unbound_chat_resolves_to_nothing$
begin
  if (projectceo_gateway_api.resolve_channel_binding('db4-bot', '-1009999999999') -> 'data')
     <> 'null'::jsonb then
    raise exception 'DB4_TELEGRAM_UNBOUND_CHAT_RESOLVED';
  end if;
end
$unbound_chat_resolves_to_nothing$;
rollback;

do $unbound_chat_stores_nothing$
begin
  if exists (
    select 1 from projectceo_gateway.channel_events
    where external_chat_id = '-1009999999999'
  ) then
    raise exception 'DB4_TELEGRAM_UNBOUND_CHAT_STORED_CONTENT';
  end if;
end
$unbound_chat_stores_nothing$;

-- ---------------------------------------------------------------------------
-- 4. Приём сообщений: повтор, правка, чужой чат
-- ---------------------------------------------------------------------------

begin;
set local role service_role;
do $inbound_idempotent$
declare
  v_binding constant uuid := current_setting('db4.binding_a')::uuid;
  v_first jsonb;
  v_second jsonb;
  v_edited jsonb;
begin
  v_first := projectceo_gateway_api.record_channel_event(
    v_binding, 9101, '-1001000000001', 21, '770001', 'message', 1,
    statement_timestamp(), null, null, null,
    'Нужно заменить плитку в санузле на другую модель'
  ) -> 'data';
  if (v_first ->> 'duplicate')::boolean then
    raise exception 'DB4_TELEGRAM_FIRST_EVENT_MARKED_DUPLICATE';
  end if;

  -- Повтор доставки того же update: Telegram повторяет, пока не получит 2xx.
  v_second := projectceo_gateway_api.record_channel_event(
    v_binding, 9101, '-1001000000001', 21, '770001', 'message', 1,
    statement_timestamp(), null, null, null,
    'Нужно заменить плитку в санузле на другую модель'
  ) -> 'data';
  if not (v_second ->> 'duplicate')::boolean
     or v_second ->> 'eventId' <> v_first ->> 'eventId' then
    raise exception 'DB4_TELEGRAM_DUPLICATE_UPDATE_CREATED_SECOND_EVENT';
  end if;

  -- Правка — НОВАЯ ревизия источника, а не перезапись строки.
  v_edited := projectceo_gateway_api.record_channel_event(
    v_binding, 9102, '-1001000000001', 21, '770001', 'edited_message', 2,
    statement_timestamp(), null, null, null,
    'Нужно заменить плитку в санузле на керамогранит'
  ) -> 'data';
  if (v_edited ->> 'duplicate')::boolean
     or v_edited ->> 'eventId' = v_first ->> 'eventId' then
    raise exception 'DB4_TELEGRAM_EDIT_OVERWROTE_SOURCE';
  end if;

  -- Чужой чат в теле запроса не подменяет чат привязки.
  begin
    perform projectceo_gateway_api.record_channel_event(
      v_binding, 9103, '-1001000000002', 22, '770001', 'message', 1,
      null, null, null, null, 'Чужой чат'
    );
    raise exception 'DB4_TELEGRAM_ACCEPTED_FOREIGN_CHAT';
  exception
    when sqlstate 'P1109' then null;
  end;
end
$inbound_idempotent$;
commit;

do $inbound_state$
declare
  v_revisions bigint;
  v_texts bigint;
begin
  select count(*) into v_revisions
  from projectceo_gateway.channel_events
  where external_message_id = 21;
  if v_revisions <> 2 then
    raise exception 'DB4_TELEGRAM_SOURCE_REVISIONS_NOT_TWO:%', v_revisions;
  end if;

  -- Обе ревизии на месте: старая не переписана.
  select count(*) into v_texts
  from projectceo_gateway.channel_events
  where external_message_id = 21
    and text_content in (
      'Нужно заменить плитку в санузле на другую модель',
      'Нужно заменить плитку в санузле на керамогранит'
    );
  if v_texts <> 2 then
    raise exception 'DB4_TELEGRAM_SOURCE_REVISION_TEXT_LOST';
  end if;

  if exists (
    select 1 from projectceo_gateway.channel_events
    where external_chat_id = '-1001000000002'
  ) then
    raise exception 'DB4_TELEGRAM_FOREIGN_CHAT_STORED';
  end if;
end
$inbound_state$;

-- ---------------------------------------------------------------------------
-- 5. Кандидаты Project Inbox
-- ---------------------------------------------------------------------------

select event_id::text as event_r1
from projectceo_gateway.channel_events
where external_message_id = 21 and source_revision = 1 \gset

select set_config('db4.event_r1', :'event_r1', false);

begin;
set local role service_role;
do $candidates$
declare
  v_event constant uuid := current_setting('db4.event_r1')::uuid;
  v_first jsonb;
  v_second jsonb;
begin
  v_first := projectceo_gateway_api.record_inbox_candidate(
    v_event, 'change_request_candidate', 'telegram-extract/0.1', 'db4', 'db4-model',
    'medium', 'Строитель предлагает замену материала', 'Заменить плитку в санузле'
  ) -> 'data';
  if (v_first ->> 'duplicate')::boolean then
    raise exception 'DB4_TELEGRAM_FIRST_CANDIDATE_MARKED_DUPLICATE';
  end if;

  -- Повтор воркера после перезапуска не создаёт второго кандидата.
  v_second := projectceo_gateway_api.record_inbox_candidate(
    v_event, 'change_request_candidate', 'telegram-extract/0.1', 'db4', 'db4-model',
    'medium', 'Строитель предлагает замену материала', 'Заменить плитку в санузле'
  ) -> 'data';
  if not (v_second ->> 'duplicate')::boolean then
    raise exception 'DB4_TELEGRAM_CANDIDATE_DUPLICATED';
  end if;
end
$candidates$;
commit;

do $candidate_is_pending$
begin
  if not exists (
    select 1 from projectceo_gateway.project_inbox_candidates
    where source_event_id = current_setting('db4.event_r1')::uuid
      and status = 'pending'
      and reviewed_by_user_id is null and reviewed_at is null
  ) then
    raise exception 'DB4_TELEGRAM_CANDIDATE_NOT_PENDING';
  end if;

  -- Подтвердить кандидата без человека нельзя даже владельцу таблиц:
  -- ограничение требует и человека, и серверного времени, а у системной
  -- identity человека нет.
  begin
    update projectceo_gateway.project_inbox_candidates
    set status = 'confirmed'
    where status = 'pending';
    raise exception 'DB4_TELEGRAM_CANDIDATE_CONFIRMED_WITHOUT_HUMAN';
  exception
    when check_violation then null;
  end;
end
$candidate_is_pending$;

select candidate_id::text as candidate
from projectceo_gateway.project_inbox_candidates
where status = 'pending' limit 1 \gset

select set_config('db4.candidate', :'candidate', false);

-- Снимок домена ДО решения человека. Кандидат не имеет права его сдвинуть.
select count(*)::text as change_requests_before
from projectceo_m4.change_requests
where project_id = :'project_a' \gset

select set_config('db4.change_requests_before', :'change_requests_before', false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
do $candidate_review_scoped$
declare
  v_candidate constant uuid := current_setting('db4.candidate')::uuid;
begin
  -- Владелец чужой организации кандидата не видит и не решает.
  begin
    perform projectceo_gateway_api.resolve_project_inbox_candidate(
      '41111111-1111-4111-8111-111111111111', v_candidate, 'confirmed'
    );
    raise exception 'DB4_TELEGRAM_CANDIDATE_RESOLVED_BY_OUTSIDER';
  exception
    when sqlstate 'P1103' then null;
  end;
end
$candidate_review_scoped$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select projectceo_gateway_api.resolve_project_inbox_candidate(
  :'project_a', :'candidate'::uuid, 'confirmed'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
do $candidate_resolved_once$
declare
  v_candidate constant uuid := current_setting('db4.candidate')::uuid;
begin
  -- Второе решение по тому же кандидату — контролируемый отказ.
  begin
    perform projectceo_gateway_api.resolve_project_inbox_candidate(
      '41111111-1111-4111-8111-111111111111', v_candidate, 'rejected'
    );
    raise exception 'DB4_TELEGRAM_CANDIDATE_RESOLVED_TWICE';
  exception
    when sqlstate 'P1109' then null;
  end;
end
$candidate_resolved_once$;
rollback;

do $candidate_review_recorded$
declare
  v_after bigint;
begin
  if not exists (
    select 1 from projectceo_gateway.project_inbox_candidates
    where candidate_id = current_setting('db4.candidate')::uuid
      and status = 'confirmed'
      and reviewed_by_user_id = '31111111-1111-4111-8111-111111111111'
      and reviewed_at is not null
  ) then
    raise exception 'DB4_TELEGRAM_CANDIDATE_REVIEW_NOT_RECORDED';
  end if;

  -- Подтверждение кандидата НЕ создало доменного объекта: официальное действие
  -- делает отдельная команда RemHaOS, и мост её не подменяет. Сравнивается
  -- ЧИСЛО заявок до и после — текст заявки шлюзу недоступен (он защищённый), и
  -- проверять по нему значило бы проверять не то.
  select count(*) into v_after
  from projectceo_m4.change_requests
  where project_id = '41111111-1111-4111-8111-111111111111';
  if v_after <> current_setting('db4.change_requests_before')::bigint then
    raise exception 'DB4_TELEGRAM_CANDIDATE_CREATED_CHANGE_REQUEST:% vs %',
      v_after, current_setting('db4.change_requests_before');
  end if;
end
$candidate_review_recorded$;

-- Чтение Project Inbox человеком: текст и провенанс на месте, чужого — нет.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
do $inbox_read$
declare
  v_data jsonb;
begin
  v_data := projectceo_gateway_api.list_project_inbox_candidates(
    '41111111-1111-4111-8111-111111111111', 50
  ) -> 'data';
  if jsonb_array_length(v_data) <> 1 then
    raise exception 'DB4_TELEGRAM_INBOX_SIZE:%', jsonb_array_length(v_data);
  end if;
  if v_data -> 0 -> 'source' ->> 'identity' <> 'verified' then
    raise exception 'DB4_TELEGRAM_INBOX_IDENTITY_NOT_VERIFIED';
  end if;
  if v_data -> 0 -> 'source' ->> 'text' is null then
    raise exception 'DB4_TELEGRAM_INBOX_TEXT_MISSING';
  end if;
  -- Внешнего идентификатора чата в человеческой выдаче нет: экрану он не нужен,
  -- а отданный превращается в цель для чужого подключения.
  if v_data::text like '%-1001000000001%' then
    raise exception 'DB4_TELEGRAM_INBOX_LEAKED_CHAT_ID';
  end if;
end
$inbox_read$;
rollback;

-- ---------------------------------------------------------------------------
-- 6. Догоняющий проектор уведомлений и очередь отправки
-- ---------------------------------------------------------------------------

do $distribution_fixture$
begin
  if not exists (
    select 1 from projectceo_product.release_distributions
    where project_id = '41111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'DB4_TELEGRAM_NO_DISTRIBUTION_FIXTURE';
  end if;
end
$distribution_fixture$;

select count(*)::text as distribution_count
from projectceo_product.release_distributions
where project_id = :'project_a' \gset

select set_config('db4.distribution_count', :'distribution_count', false);

begin;
set local role service_role;
do $projector_catches_up$
declare
  v_expected constant bigint := current_setting('db4.distribution_count')::bigint;
  v_first bigint;
  v_second bigint;
begin
  -- Первый проход находит выдачи, для которых уведомления ещё нет. Это и есть
  -- доказательство свойства «падение после записи выдачи и до отправки
  -- уведомление не теряет»: проектор решает по персистентному состоянию, а не
  -- по одноразовому сигналу в памяти.
  v_first := (projectceo_gateway_api.project_release_notifications(100)
    -> 'data' ->> 'created')::bigint;
  if v_first <> v_expected then
    raise exception 'DB4_TELEGRAM_PROJECTOR_MISSED_DISTRIBUTIONS:% of %', v_first, v_expected;
  end if;

  -- Второй проход не создаёт ничего: ключ детерминированный.
  v_second := (projectceo_gateway_api.project_release_notifications(100)
    -> 'data' ->> 'created')::bigint;
  if v_second <> 0 then
    raise exception 'DB4_TELEGRAM_PROJECTOR_DUPLICATED:%', v_second;
  end if;
end
$projector_catches_up$;
commit;

do $outbox_matches_distributions$
declare
  v_outbox bigint;
begin
  select count(*) into v_outbox
  from projectceo_gateway.notification_outbox
  where project_id = '41111111-1111-4111-8111-111111111111';
  if v_outbox <> current_setting('db4.distribution_count')::bigint then
    raise exception 'DB4_TELEGRAM_OUTBOX_COUNT:%', v_outbox;
  end if;
end
$outbox_matches_distributions$;

begin;
set local role service_role;
do $outbox_lease$
declare
  v_first jsonb;
  v_second jsonb;
begin
  v_first := projectceo_gateway_api.claim_notifications(100, 120) -> 'data';
  if jsonb_array_length(v_first) = 0 then
    raise exception 'DB4_TELEGRAM_CLAIM_EMPTY';
  end if;
  -- Аренда: взятое одним воркером второй не берёт.
  v_second := projectceo_gateway_api.claim_notifications(100, 120) -> 'data';
  if jsonb_array_length(v_second) <> 0 then
    raise exception 'DB4_TELEGRAM_CLAIM_LEASE_IGNORED';
  end if;

  -- Пустая очередь — безопасный no-op, а не ошибка.
  perform projectceo_gateway_api.claim_channel_events(10, 60);
end
$outbox_lease$;
commit;

-- ---------------------------------------------------------------------------
-- 7. Отключение останавливает всё
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select projectceo_gateway_api.revoke_channel_binding(
  :'project_a', :'binding_a'::uuid, 'revoked_by_owner'
);
commit;

do $revoke_cancelled_outbox$
declare
  v_pending bigint;
begin
  select count(*) into v_pending
  from projectceo_gateway.notification_outbox
  where project_id = '41111111-1111-4111-8111-111111111111'
    and status <> 'cancelled';
  if v_pending <> 0 then
    raise exception 'DB4_TELEGRAM_REVOKE_LEFT_PENDING_NOTIFICATIONS:%', v_pending;
  end if;
end
$revoke_cancelled_outbox$;

begin;
set local role service_role;
do $revoked_binding_stops_everything$
declare
  v_binding constant uuid := current_setting('db4.binding_a')::uuid;
begin
  if jsonb_array_length(projectceo_gateway_api.claim_notifications(100, 120) -> 'data') <> 0 then
    raise exception 'DB4_TELEGRAM_REVOKED_BINDING_STILL_SENDS';
  end if;

  -- Приём остановлен: отключённый чат новых сообщений не принимает.
  begin
    perform projectceo_gateway_api.record_channel_event(
      v_binding, 9201, '-1001000000001', 31, '770001',
      'message', 1, null, null, null, null, 'Сообщение после отключения'
    );
    raise exception 'DB4_TELEGRAM_CAPTURED_AFTER_DISCONNECT';
  exception
    when sqlstate 'P1103' then null;
  end;

  -- Проектор тоже молчит: у проекта нет активной привязки.
  if (projectceo_gateway_api.project_release_notifications(100)
      -> 'data' ->> 'created')::bigint <> 0 then
    raise exception 'DB4_TELEGRAM_PROJECTOR_RAN_WITHOUT_BINDING';
  end if;
end
$revoked_binding_stops_everything$;
commit;

do $no_content_after_disconnect$
begin
  if exists (
    select 1 from projectceo_gateway.channel_events where external_message_id = 31
  ) then
    raise exception 'DB4_TELEGRAM_STORED_CONTENT_AFTER_DISCONNECT';
  end if;
end
$no_content_after_disconnect$;

-- ---------------------------------------------------------------------------
-- 8. Заготовка гонки подключения для `run-concurrency.zsh`
-- ---------------------------------------------------------------------------
--
-- Два проекта РАЗНЫХ организаций, у каждого свой владелец, свой связанный
-- Telegram-аккаунт и свой погашенный интент подключения. Гонку за один и тот же
-- чат устраивает скрипт: здесь только фикстуры.

select encode(sha256(convert_to('db4-race-a', 'UTF8')), 'hex') as race_a_hex \gset
select encode(sha256(convert_to('db4-race-b', 'UTF8')), 'hex') as race_b_hex \gset
select encode(sha256(convert_to('db4-outsider-identity', 'UTF8')), 'hex') as identity_b_hex \gset

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select projectceo_gateway_api.create_channel_link_intent(
  :'project_a', 'channel_binding', 'db4-bot', :'race_a_hex', 600
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
select projectceo_gateway_api.create_channel_link_intent(
  :'project_b', 'identity_link', 'db4-bot', :'identity_b_hex', 600
);
commit;

begin;
set local role service_role;
select projectceo_gateway_api.complete_identity_link(
  (projectceo_gateway_api.consume_channel_link_intent(
    :'identity_b_hex', 'identity_link', 'db4-bot', '770002'
  ) -> 'data' ->> 'intentId')::uuid,
  '770002'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
select projectceo_gateway_api.create_channel_link_intent(
  :'project_b', 'channel_binding', 'db4-bot', :'race_b_hex', 600
);
commit;

begin;
set local role service_role;
select projectceo_gateway_api.consume_channel_link_intent(
  :'race_a_hex', 'channel_binding', 'db4-bot', '770001'
);
select projectceo_gateway_api.consume_channel_link_intent(
  :'race_b_hex', 'channel_binding', 'db4-bot', '770002'
);
commit;

do $race_fixture_ready$
begin
  if (
    select count(*) from projectceo_gateway.channel_link_intents
    where purpose = 'channel_binding' and status = 'consumed'
      and nonce_digest in (
        sha256(convert_to('db4-race-a', 'UTF8')),
        sha256(convert_to('db4-race-b', 'UTF8'))
      )
  ) <> 2 then
    raise exception 'DB4_TELEGRAM_RACE_FIXTURE_INCOMPLETE';
  end if;
end
$race_fixture_ready$;
