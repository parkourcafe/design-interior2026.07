\set ON_ERROR_STOP on

-- Границы Telegram Chat Bridge (A7 / DEC-031, миграции `20260811040000` и
-- `20260811050000`).
--
-- Проверяется не «права выглядят правильно», а поведение: реальные вызовы
-- из-под ролей, реальные конфликты уникальности, реальные повторы.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Приватная схема закрыта, системные двери человеку недоступны
-- ─────────────────────────────────────────────────────────────────────────────

do $bridge_private$
declare
  v_leaked text;
begin
  if pg_catalog.has_schema_privilege('authenticated', 'remhaos_channel', 'USAGE')
     or pg_catalog.has_schema_privilege('anon', 'remhaos_channel', 'USAGE') then
    raise exception 'DB4_TG_PRIVATE_SCHEMA_EXPOSED';
  end if;

  -- Ни одной таблицы моста напрямую: ни чтения, ни записи.
  select c.relname into v_leaked
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'remhaos_channel'
    and c.relkind in ('r', 'p')
    and (
      pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
      or pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')
      or pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
    )
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_TG_TABLE_REACHABLE_BY_HUMAN:%', v_leaked;
  end if;

  -- RLS включён и forced на каждой таблице моста.
  select c.relname into v_leaked
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'remhaos_channel'
    and c.relkind in ('r', 'p')
    and (c.relrowsecurity is false or c.relforcerowsecurity is false)
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_TG_RLS_NOT_FORCED:%', v_leaked;
  end if;

  select signature into v_leaked
  from unnest(array[
    'remhaos_channel_api.ingest_channel_update(text, bigint, bigint, bigint, text, bigint, timestamptz, bigint, text, jsonb)',
    'remhaos_channel_api.activate_project_binding(bytea, bigint, text, bigint, text, text)',
    'remhaos_channel_api.consume_identity_link_intent(bytea, bigint)',
    'remhaos_channel_api.enqueue_notification(uuid, text, text, text, jsonb, text)',
    'remhaos_channel_api.claim_notification_batch(integer, integer)',
    'remhaos_channel_api.mark_notification_sent(uuid, bigint)',
    'remhaos_channel_api.mark_notification_failed(uuid, text, integer)',
    'remhaos_channel_api.suspend_project_binding(text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_TG_SYSTEM_RPC_REACHABLE_BY_HUMAN:%', v_leaked;
  end if;
end
$bridge_private$;

-- Права — утверждение о доступе; ниже проверяется сам доступ.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $bridge_system_denied$
declare
  v_denied int := 0;
begin
  begin
    perform remhaos_channel_api.ingest_channel_update(
      'probe-bot', 1, 1, 1, 'message', 1, null, null, null, '{}'::jsonb
    );
    raise exception 'DB4_TG_INGEST_REACHED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform remhaos_channel_api.claim_notification_batch(1, 60);
    raise exception 'DB4_TG_CLAIM_REACHED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform remhaos_channel_api.activate_project_binding(
      decode(repeat('00', 32), 'hex'), 1, 'probe-bot', 1, 'group', 'v1'
    );
    raise exception 'DB4_TG_ACTIVATE_REACHED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  if v_denied <> 3 then
    raise exception 'DB4_TG_SYSTEM_DENIALS_EXPECTED_3_GOT_%', v_denied;
  end if;
end
$bridge_system_denied$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Capability подключения — только у владельца проекта
-- ─────────────────────────────────────────────────────────────────────────────

do $bridge_capability$
begin
  if not exists (
    select 1 from projectceo_foundation._role_capabilities('owner_lead')
    where capability = 'manage_project_integrations'
  ) then
    raise exception 'DB4_TG_CAPABILITY_MISSING_FOR_OWNER';
  end if;
  if exists (
    select 1
    from unnest(array['architect', 'builder', 'client_approver']) role,
      lateral projectceo_foundation._role_capabilities(role) rc
    where rc.capability = 'manage_project_integrations'
  ) then
    raise exception 'DB4_TG_CAPABILITY_LEAKED_TO_NON_OWNER';
  end if;
  -- Владельцы, заведённые ДО миграции, право получили: иначе оно существовало
  -- бы только для новых проектов, и подключение молча не работало бы.
  if not exists (
    select 1
    from projectceo_foundation.project_member_capabilities pc
    where pc.capability = 'manage_project_integrations'
      and pc.project_id = '41111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'DB4_TG_CAPABILITY_NOT_BACKFILLED';
  end if;
end
$bridge_capability$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Одноразовое намерение: TTL, single-use, чужой пользователь
-- ─────────────────────────────────────────────────────────────────────────────

-- Владелец проекта DB4 связывает свой Telegram-аккаунт и подключает чат.
--
-- Digest считается встроенной `pg_catalog.sha256`, а не приватным помощником
-- `project_intelligence._sha256_text`: у `authenticated` нет USAGE на приватную
-- схему, и первая редакция сценария на этом упала. Падение верное — так же
-- вычисляет digest настоящий вызывающий (маршрут webhook в Node), и сценарий
-- обязан повторять его путь, а не привилегии владельца схемы.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select remhaos_channel_api.create_identity_link_intent(
  pg_catalog.sha256(convert_to('db4-identity-nonce', 'UTF8')), 600
);
commit;

begin;
set local role service_role;
select remhaos_channel_api.consume_identity_link_intent(
  pg_catalog.sha256(convert_to('db4-identity-nonce', 'UTF8')), 777001
);
commit;

do $identity_linked$
begin
  if not exists (
    select 1 from remhaos_channel.channel_identity_links
    where external_user_id = 777001
      and user_id = '31111111-1111-4111-8111-111111111111'
      and revoked_at is null
  ) then
    raise exception 'DB4_TG_IDENTITY_NOT_LINKED';
  end if;
end
$identity_linked$;

-- Повтор того же токена: одноразовость.
begin;
set local role service_role;
do $identity_replay_denied$
begin
  begin
    perform remhaos_channel_api.consume_identity_link_intent(
      pg_catalog.sha256(convert_to('db4-identity-nonce', 'UTF8')), 777002
    );
    raise exception 'DB4_TG_IDENTITY_TOKEN_REPLAYED';
  exception when sqlstate 'P1103' then null;
  end;
end
$identity_replay_denied$;
rollback;

-- Подключение чата: намерение создаёт владелец, активирует система.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select remhaos_channel_api.create_binding_intent(
  '41111111-1111-4111-8111-111111111111',
  pg_catalog.sha256(convert_to('db4-binding-nonce', 'UTF8')),
  600
);
commit;

-- Ссылку открыл ДРУГОЙ Telegram-пользователь — отказ.
begin;
set local role service_role;
do $binding_actor_mismatch$
begin
  begin
    perform remhaos_channel_api.activate_project_binding(
      pg_catalog.sha256(convert_to('db4-binding-nonce', 'UTF8')),
      999999, 'db4-bot', -100500, 'supergroup', 'notice-v1'
    );
    raise exception 'DB4_TG_BINDING_ACCEPTED_FOREIGN_ACTOR';
  exception when sqlstate 'P1103' then null;
  end;
end
$binding_actor_mismatch$;
rollback;

begin;
set local role service_role;
select remhaos_channel_api.activate_project_binding(
  pg_catalog.sha256(convert_to('db4-binding-nonce', 'UTF8')),
  777001, 'db4-bot', -100500, 'supergroup', 'notice-v1'
);
commit;

do $binding_active$
begin
  if not exists (
    select 1 from remhaos_channel.project_channel_bindings
    where project_id = '41111111-1111-4111-8111-111111111111'
      and status = 'active'
      and external_chat_id = -100500
  ) then
    raise exception 'DB4_TG_BINDING_NOT_ACTIVE';
  end if;
end
$binding_active$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Единственность: тот же чат не уходит второму проекту
-- ─────────────────────────────────────────────────────────────────────────────

do $binding_uniqueness$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';

  begin
    insert into remhaos_channel.project_channel_bindings (
      organization_id, project_id, provider, bot_instance_id,
      external_chat_id, external_chat_type, status, notice_version,
      initiated_by_user_id, activated_at
    )
    values (
      v_org, '41111111-1111-4111-8111-111111111111', 'telegram', 'db4-bot',
      -100777, 'supergroup', 'active', 'notice-v1',
      '31111111-1111-4111-8111-111111111111', statement_timestamp()
    );
    raise exception 'DB4_TG_SECOND_ACTIVE_BINDING_ALLOWED_FOR_PROJECT';
  exception when unique_violation then null;
  end;
end
$binding_uniqueness$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Приём: повтор update даёт один event, правка — новую ревизию
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 5001, -100500, 42, 'message', 777001, null, null, null,
  '{"text":"db4"}'::jsonb
);
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 5001, -100500, 42, 'message', 777001, null, null, null,
  '{"text":"db4"}'::jsonb
);
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 5002, -100500, 42, 'edited_message', 777001, null, null, null,
  '{"text":"db4 edited"}'::jsonb
);
-- Несвязанный чат: содержимое не сохраняется.
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 5003, -100999, 1, 'message', 777001, null, null, null,
  '{"text":"unbound"}'::jsonb
);
commit;

do $ingest_contract$
declare
  v_events integer;
  v_revisions integer;
  v_unbound integer;
begin
  select count(*) into v_events
  from remhaos_channel.channel_events
  where update_id = 5001;
  if v_events <> 1 then
    raise exception 'DB4_TG_DUPLICATE_UPDATE_CREATED_%_EVENTS', v_events;
  end if;

  select count(*) into v_revisions
  from remhaos_channel.channel_events
  where external_chat_id = -100500 and external_message_id = 42;
  if v_revisions <> 2 then
    raise exception 'DB4_TG_EDIT_DID_NOT_CREATE_REVISION:%', v_revisions;
  end if;
  if not exists (
    select 1 from remhaos_channel.channel_events
    where external_message_id = 42 and source_revision = 1
      and payload ->> 'text' = 'db4'
  ) then
    raise exception 'DB4_TG_EDIT_OVERWROTE_ORIGINAL';
  end if;

  select count(*) into v_unbound
  from remhaos_channel.channel_events
  where external_chat_id = -100999;
  if v_unbound <> 0 then
    raise exception 'DB4_TG_UNBOUND_CHAT_STORED_CONTENT';
  end if;
end
$ingest_contract$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Очередь: дедупликация, лиза, отмена при отзыве
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
select remhaos_channel_api.enqueue_notification(
  '41111111-1111-4111-8111-111111111111',
  'release_distributed', 'db4-distribution-1', 'tpl-v1',
  '{"kind":"release_distributed"}'::jsonb,
  'release_distributed:db4-distribution-1'
);
select remhaos_channel_api.enqueue_notification(
  '41111111-1111-4111-8111-111111111111',
  'release_distributed', 'db4-distribution-1', 'tpl-v1',
  '{"kind":"release_distributed"}'::jsonb,
  'release_distributed:db4-distribution-1'
);
commit;

do $outbox_dedup$
declare
  v_count integer;
begin
  select count(*) into v_count
  from remhaos_channel.notification_outbox
  where idempotency_key = 'release_distributed:db4-distribution-1';
  if v_count <> 1 then
    raise exception 'DB4_TG_OUTBOX_DUPLICATED:%', v_count;
  end if;
end
$outbox_dedup$;

-- Захват партии и подтверждение отправки; повтор подтверждения безопасен.
begin;
set local role service_role;
select set_config(
  'projectceo.db4_tg_notification',
  (remhaos_channel_api.claim_notification_batch(10, 60) -> 'data' -> 0 ->> 'notificationId'),
  false
);
commit;

begin;
set local role service_role;
select remhaos_channel_api.mark_notification_sent(
  current_setting('projectceo.db4_tg_notification')::uuid, 12345
);
select remhaos_channel_api.mark_notification_sent(
  current_setting('projectceo.db4_tg_notification')::uuid, 12345
);
commit;

do $outbox_sent$
begin
  if not exists (
    select 1 from remhaos_channel.notification_outbox
    where notification_id = current_setting('projectceo.db4_tg_notification')::uuid
      and state = 'sent'
      and attempt_count = 1
  ) then
    raise exception 'DB4_TG_OUTBOX_SENT_STATE_INVALID';
  end if;
end
$outbox_sent$;

-- Отключение владельцем: связь отозвана, невыполненные уведомления отменены.
begin;
set local role service_role;
select remhaos_channel_api.enqueue_notification(
  '41111111-1111-4111-8111-111111111111',
  'release_distributed', 'db4-distribution-2', 'tpl-v1',
  '{"kind":"release_distributed"}'::jsonb,
  'release_distributed:db4-distribution-2'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select remhaos_channel_api.disconnect_project_channel(
  '41111111-1111-4111-8111-111111111111', 'db4 disconnect'
);
commit;

do $disconnect_contract$
begin
  if exists (
    select 1 from remhaos_channel.project_channel_bindings
    where project_id = '41111111-1111-4111-8111-111111111111' and status = 'active'
  ) then
    raise exception 'DB4_TG_BINDING_STILL_ACTIVE_AFTER_DISCONNECT';
  end if;
  if exists (
    select 1 from remhaos_channel.notification_outbox
    where idempotency_key = 'release_distributed:db4-distribution-2'
      and state <> 'cancelled'
  ) then
    raise exception 'DB4_TG_OUTBOX_NOT_CANCELLED_AFTER_DISCONNECT';
  end if;
end
$disconnect_contract$;

-- Отключённый канал новых сообщений не принимает.
begin;
set local role service_role;
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 5004, -100500, 43, 'message', 777001, null, null, null,
  '{"text":"after disconnect"}'::jsonb
);
commit;

do $ingest_after_disconnect$
begin
  if exists (
    select 1 from remhaos_channel.channel_events where update_id = 5004
  ) then
    raise exception 'DB4_TG_INGEST_ACCEPTED_AFTER_DISCONNECT';
  end if;
end
$ingest_after_disconnect$;

\echo DB4_TELEGRAM_BRIDGE_BOUNDARY_OK
