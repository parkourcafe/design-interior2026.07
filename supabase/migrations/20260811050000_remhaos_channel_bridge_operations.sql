-- Telegram Chat Bridge — операции фундамента (A7 / DEC-031).
--
-- Две группы дверей, и они не пересекаются:
--
--   * СИСТЕМНЫЕ (`service_role`) — приём обновлений, активация связи по
--     одноразовому намерению, очередь уведомлений. Их зовёт транспорт и воркер,
--     человек не зовёт никогда;
--   * ЧЕЛОВЕЧЕСКИЕ (`authenticated`) — создание намерения, чтение состояния,
--     отключение. Авторизация внутри через `_authorize_project_human`, то есть
--     по членству и capability, а не по тому, что клиент прислал.
--
-- Ни одна функция здесь не создаёт официальный объект домена. Кандидат остаётся
-- кандидатом; изменение, приёмку и подтверждение выполняют существующие команды
-- RemHaOS от человеческой сессии.

begin;

set local check_function_bodies = on;

-- ─────────────────────────────────────────────────────────────────────────────
-- Общее
-- ─────────────────────────────────────────────────────────────────────────────

create function remhaos_channel._envelope(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'contractVersion', 'remhaos-channel/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', p_data,
    'error', null
  );
$function$;

-- Системный контекст: организация проекта без человеческой сессии. Отдельно от
-- человеческой авторизации намеренно — чтобы нельзя было случайно позвать
-- человеческую проверку из системного пути и наоборот.
create function remhaos_channel._system_project_context(p_project_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
begin
  select pw.organization_id into v_organization_id
  from project_intelligence.project_workflows pw
  where pw.project_id = p_project_id;
  if v_organization_id is null then
    perform projectceo_foundation._raise(
      'P1104', 'not_found', '{"entity":"project"}'::jsonb
    );
  end if;
  return v_organization_id;
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Человеческие двери
-- ─────────────────────────────────────────────────────────────────────────────

-- Намерение связать свой Telegram-аккаунт. Проекта здесь нет: человек связывает
-- себя. Сам nonce живёт только в ссылке — сюда приходит его хеш.
create function remhaos_channel_api.create_identity_link_intent(
  nonce_digest bytea,
  ttl_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_user_id uuid := auth.uid();
  v_intent_id uuid;
begin
  if v_user_id is null then
    perform projectceo_foundation._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;
  if nonce_digest is null or octet_length(nonce_digest) <> 32 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"nonceDigest"}'::jsonb
    );
  end if;
  if ttl_seconds is null or ttl_seconds < 60 or ttl_seconds > 600 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"ttlSeconds"}'::jsonb
    );
  end if;

  -- Прежние неиспользованные намерения этого человека гасятся: одновременно
  -- живых ссылок быть не должно, иначе «одноразовая» становится «одной из».
  update remhaos_channel.channel_link_intents
  set revoked_at = statement_timestamp()
  where actor_user_id = v_user_id
    and purpose = 'identity_link'
    and consumed_at is null
    and revoked_at is null;

  insert into remhaos_channel.channel_link_intents (
    purpose, provider, nonce_digest, actor_user_id, expires_at
  )
  values (
    'identity_link',
    'telegram',
    nonce_digest,
    v_user_id,
    statement_timestamp() + make_interval(secs => ttl_seconds)
  )
  returning intent_id into v_intent_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'intentId', v_intent_id,
    'expiresInSeconds', ttl_seconds
  ));
end
$function$;

-- Намерение подключить чат к проекту. Требует capability
-- `manage_project_integrations` — в P0 она только у владельца проекта.
create function remhaos_channel_api.create_binding_intent(
  project_id uuid,
  nonce_digest bytea,
  ttl_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_intent_id uuid;
  v_linked boolean;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id, 'manage_project_integrations'
  );
  if nonce_digest is null or octet_length(nonce_digest) <> 32 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"nonceDigest"}'::jsonb
    );
  end if;
  if ttl_seconds is null or ttl_seconds < 60 or ttl_seconds > 600 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"ttlSeconds"}'::jsonb
    );
  end if;

  -- Порядок обязателен: сначала подтверждённая личность, потом подключение
  -- группы. Иначе непонятно, чьё «добавил бота» мы приняли.
  select exists (
    select 1
    from remhaos_channel.channel_identity_links cil
    where cil.provider = 'telegram'
      and cil.user_id = v_context.actor_user_id
      and cil.revoked_at is null
  ) into v_linked;
  if not v_linked then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"TELEGRAM_IDENTITY_NOT_LINKED"}'::jsonb
    );
  end if;

  if exists (
    select 1
    from remhaos_channel.project_channel_bindings b
    where b.project_id = project_id and b.status = 'active'
  ) then
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"PROJECT_ALREADY_BOUND"}'::jsonb
    );
  end if;

  update remhaos_channel.channel_link_intents
  set revoked_at = statement_timestamp()
  where actor_user_id = v_context.actor_user_id
    and purpose = 'project_binding'
    and project_id = project_id
    and consumed_at is null
    and revoked_at is null;

  insert into remhaos_channel.channel_link_intents (
    purpose, provider, nonce_digest, organization_id, project_id,
    actor_user_id, expires_at
  )
  values (
    'project_binding',
    'telegram',
    nonce_digest,
    v_context.organization_id,
    project_id,
    v_context.actor_user_id,
    statement_timestamp() + make_interval(secs => ttl_seconds)
  )
  returning intent_id into v_intent_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'intentId', v_intent_id,
    'expiresInSeconds', ttl_seconds
  ));
end
$function$;

-- Состояние канала для экрана настроек. Ни текста переписки, ни имён файлов:
-- экран показывает состояние подключения, а не содержимое чата.
create function remhaos_channel_api.get_project_channel_state(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_binding record;
  v_identity_linked boolean;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(project_id, 'view_project');

  select b.status, b.external_chat_type, b.activated_at, b.status_reason,
    b.notice_version, b.notice_posted_at
  into v_binding
  from remhaos_channel.project_channel_bindings b
  where b.project_id = project_id
    and b.status in ('pending', 'active', 'suspended')
  order by b.created_at desc
  limit 1;

  select exists (
    select 1
    from remhaos_channel.channel_identity_links cil
    where cil.provider = 'telegram'
      and cil.user_id = v_context.actor_user_id
      and cil.revoked_at is null
  ) into v_identity_linked;

  return remhaos_channel._envelope(jsonb_build_object(
    'provider', 'telegram',
    'identityLinked', v_identity_linked,
    'binding', case
      when v_binding is null then null
      else jsonb_build_object(
        'status', v_binding.status,
        'chatType', v_binding.external_chat_type,
        'activatedAt', v_binding.activated_at,
        'statusReason', v_binding.status_reason,
        'noticeVersion', v_binding.notice_version,
        'noticePostedAt', v_binding.notice_posted_at
      )
    end
  ));
end
$function$;

-- Отключение. Человеческое действие: новые сообщения после него не
-- принимаются, а несделанные уведомления отменяются.
create function remhaos_channel_api.disconnect_project_channel(
  project_id uuid,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_binding_id uuid;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id, 'manage_project_integrations'
  );

  update remhaos_channel.project_channel_bindings b
  set status = 'revoked',
    status_reason = left(coalesce(nullif(btrim(reason), ''), 'disconnected_by_owner'), 200),
    status_changed_at = statement_timestamp(),
    activated_at = null
  where b.project_id = project_id
    and b.status in ('pending', 'active', 'suspended')
  returning b.binding_id into v_binding_id;

  if v_binding_id is null then
    perform projectceo_foundation._raise(
      'P1104', 'not_found', '{"entity":"channelBinding"}'::jsonb
    );
  end if;

  -- Отозванная связь не отправляет ничего: очередь гасится тем же действием.
  update remhaos_channel.notification_outbox o
  set state = 'cancelled',
    failure_code = 'binding_revoked',
    lease_expires_at = null
  where o.binding_id = v_binding_id
    and o.state in ('pending', 'retry', 'sending');

  return remhaos_channel._envelope(jsonb_build_object('bindingId', v_binding_id));
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Системные двери
-- ─────────────────────────────────────────────────────────────────────────────

-- Связывание аккаунта по одноразовому намерению. Токен гасится в той же
-- транзакции: повтор той же ссылки уже ничего не связывает.
create function remhaos_channel_api.consume_identity_link_intent(
  nonce_digest bytea,
  external_user_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intent record;
begin
  select * into v_intent
  from remhaos_channel.channel_link_intents i
  where i.provider = 'telegram'
    and i.nonce_digest = nonce_digest
    and i.purpose = 'identity_link'
  for update;

  if not found
     or v_intent.consumed_at is not null
     or v_intent.revoked_at is not null
     or v_intent.expires_at <= statement_timestamp() then
    -- Один и тот же отказ на «нет такого», «уже использован», «отозван» и
    -- «протух»: подсказывать, чем именно плох чужой токен, значит помогать
    -- его подбирать.
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_INVALID"}'::jsonb
    );
  end if;

  update remhaos_channel.channel_link_intents
  set consumed_at = statement_timestamp(),
    consumed_by_external_user_id = external_user_id
  where intent_id = v_intent.intent_id;

  insert into remhaos_channel.channel_identity_links (
    provider, external_user_id, user_id
  )
  values ('telegram', external_user_id, v_intent.actor_user_id)
  on conflict do nothing;

  return remhaos_channel._envelope(jsonb_build_object(
    'userId', v_intent.actor_user_id
  ));
end
$function$;

-- Активация связи проекта с чатом. Проверяется всё сразу: намерение, срок,
-- одноразовость, связанный Telegram-аккаунт инициатора и то, что чат ещё
-- никому не принадлежит. Администратора группы проверяет транспорт до вызова —
-- база о правах в Telegram знать не может.
create function remhaos_channel_api.activate_project_binding(
  nonce_digest bytea,
  external_user_id bigint,
  bot_instance_id text,
  external_chat_id bigint,
  external_chat_type text,
  notice_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intent record;
  v_linked_user uuid;
  v_binding_id uuid;
begin
  select * into v_intent
  from remhaos_channel.channel_link_intents i
  where i.provider = 'telegram'
    and i.nonce_digest = nonce_digest
    and i.purpose = 'project_binding'
  for update;

  if not found
     or v_intent.consumed_at is not null
     or v_intent.revoked_at is not null
     or v_intent.expires_at <= statement_timestamp() then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_INVALID"}'::jsonb
    );
  end if;

  -- Ссылку открыл кто-то другой: намерение принадлежит инициатору, а не
  -- тому, кто первым нажал.
  select cil.user_id into v_linked_user
  from remhaos_channel.channel_identity_links cil
  where cil.provider = 'telegram'
    and cil.external_user_id = external_user_id
    and cil.revoked_at is null;

  if v_linked_user is null or v_linked_user <> v_intent.actor_user_id then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_ACTOR_MISMATCH"}'::jsonb
    );
  end if;

  update remhaos_channel.channel_link_intents
  set consumed_at = statement_timestamp(),
    consumed_by_external_user_id = external_user_id
  where intent_id = v_intent.intent_id;

  insert into remhaos_channel.project_channel_bindings (
    organization_id, project_id, provider, bot_instance_id,
    external_chat_id, external_chat_type, status, notice_version,
    initiated_by_user_id, activated_at
  )
  values (
    v_intent.organization_id,
    v_intent.project_id,
    'telegram',
    bot_instance_id,
    external_chat_id,
    external_chat_type,
    'active',
    notice_version,
    v_intent.actor_user_id,
    statement_timestamp()
  )
  returning binding_id into v_binding_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'bindingId', v_binding_id,
    'projectId', v_intent.project_id
  ));
exception
  when unique_violation then
    -- Частичные индексы «один активный на проект» и «один проект на чат»
    -- держат гонку двух одновременных подключений. Отказ контролируемый.
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"CHANNEL_ALREADY_BOUND"}'::jsonb
    );
    return null;
end
$function$;

-- Приостановка: бота удалили или понизили. Не отзыв — связь можно вернуть,
-- вернув боту права.
create function remhaos_channel_api.suspend_project_binding(
  bot_instance_id text,
  external_chat_id bigint,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding_id uuid;
begin
  update remhaos_channel.project_channel_bindings b
  set status = 'suspended',
    status_reason = left(coalesce(nullif(btrim(reason), ''), 'bot_access_lost'), 200),
    status_changed_at = statement_timestamp(),
    activated_at = null
  where b.provider = 'telegram'
    and b.bot_instance_id = bot_instance_id
    and b.external_chat_id = external_chat_id
    and b.status = 'active'
  returning b.binding_id into v_binding_id;

  if v_binding_id is not null then
    update remhaos_channel.notification_outbox o
    set state = 'cancelled', failure_code = 'binding_suspended', lease_expires_at = null
    where o.binding_id = v_binding_id
      and o.state in ('pending', 'retry', 'sending');
  end if;

  return remhaos_channel._envelope(jsonb_build_object(
    'bindingId', v_binding_id,
    'suspended', v_binding_id is not null
  ));
end
$function$;

-- Приём обновления. Идемпотентен по `(provider, bot_instance_id, update_id)`:
-- Telegram повторяет доставку до 2xx, и повтор обязан давать тот же event.
create function remhaos_channel_api.ingest_channel_update(
  bot_instance_id text,
  update_id bigint,
  external_chat_id bigint,
  external_message_id bigint,
  event_kind text,
  external_sender_id bigint,
  external_sent_at timestamptz,
  reply_to_message_id bigint,
  forward_origin_kind text,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding record;
  v_event_id uuid;
  v_revision integer;
  v_existing uuid;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"payload"}'::jsonb
    );
  end if;

  select b.* into v_binding
  from remhaos_channel.project_channel_bindings b
  where b.provider = 'telegram'
    and b.bot_instance_id = bot_instance_id
    and b.external_chat_id = external_chat_id
    and b.status = 'active';

  if not found then
    -- Несвязанный чат: содержимое НЕ сохраняется. Транспорт ответит Telegram
    -- 2xx и скажет в чат, что подключение не завершено, — но текста здесь не
    -- останется.
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', false,
      'reason', 'chat_not_bound'
    ));
  end if;

  -- Повтор доставки: тот же update_id — тот же event.
  select e.event_id into v_existing
  from remhaos_channel.channel_events e
  where e.provider = 'telegram'
    and e.bot_instance_id = bot_instance_id
    and e.update_id = update_id;
  if v_existing is not null then
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', true,
      'duplicate', true,
      'eventId', v_existing
    ));
  end if;

  -- Правка сообщения — новая ревизия источника, а не перезапись прошлой.
  select coalesce(max(e.source_revision), 0) + 1 into v_revision
  from remhaos_channel.channel_events e
  where e.binding_id = v_binding.binding_id
    and e.external_chat_id = external_chat_id
    and e.external_message_id = external_message_id;

  insert into remhaos_channel.channel_events (
    organization_id, project_id, binding_id, provider, bot_instance_id,
    update_id, external_chat_id, external_message_id, source_revision,
    external_sender_id, event_kind, external_sent_at, reply_to_message_id,
    forward_origin_kind, payload
  )
  values (
    v_binding.organization_id, v_binding.project_id, v_binding.binding_id,
    'telegram', bot_instance_id, update_id, external_chat_id,
    external_message_id, v_revision, external_sender_id, event_kind,
    external_sent_at, reply_to_message_id, forward_origin_kind, payload
  )
  returning event_id into v_event_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'stored', true,
    'duplicate', false,
    'eventId', v_event_id,
    'projectId', v_binding.project_id,
    'sourceRevision', v_revision
  ));
exception
  when unique_violation then
    -- Гонка двух одновременных доставок одного update: победила соседняя
    -- транзакция, и это успех, а не ошибка.
    select e.event_id into v_existing
    from remhaos_channel.channel_events e
    where e.provider = 'telegram'
      and e.bot_instance_id = bot_instance_id
      and e.update_id = update_id;
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', true,
      'duplicate', true,
      'eventId', v_existing
    ));
end
$function$;

-- Постановка уведомления в очередь. Дедупликация внутренняя и детерминированная:
-- один домённый факт — одна запись, сколько бы раз проектор ни пробежал.
create function remhaos_channel_api.enqueue_notification(
  project_id uuid,
  source_kind text,
  source_id text,
  template_version text,
  payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_binding_id uuid;
  v_notification_id uuid;
begin
  v_organization_id := remhaos_channel._system_project_context(project_id);

  select b.binding_id into v_binding_id
  from remhaos_channel.project_channel_bindings b
  where b.project_id = project_id and b.status = 'active';

  if v_binding_id is null then
    -- Чат не подключён — уведомлять некуда, и это не ошибка выпуска.
    return remhaos_channel._envelope(jsonb_build_object(
      'queued', false, 'reason', 'no_active_binding'
    ));
  end if;

  insert into remhaos_channel.notification_outbox (
    organization_id, project_id, binding_id, source_kind, source_id,
    template_version, payload, idempotency_key
  )
  values (
    v_organization_id, project_id, v_binding_id, source_kind, source_id,
    template_version, payload, idempotency_key
  )
  -- Цель конфликта названа ИМЕНЕМ ОГРАНИЧЕНИЯ, а не списком колонок. При
  -- `#variable_conflict use_variable` идентификатор `idempotency_key` в списке
  -- колонок разрешается в одноимённый параметр функции, спецификация выводится
  -- по выражению и не совпадает ни с одним индексом — первая редакция падала
  -- ровно так («there is no unique or exclusion constraint matching the ON
  -- CONFLICT specification»). Имя ограничения от переименования параметров не
  -- зависит.
  on conflict on constraint notification_outbox_idempotency_key do nothing
  returning notification_id into v_notification_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'queued', v_notification_id is not null,
    'notificationId', coalesce(
      v_notification_id,
      (select o.notification_id
       from remhaos_channel.notification_outbox o
       where o.binding_id = v_binding_id and o.idempotency_key = idempotency_key)
    )
  ));
end
$function$;

-- Захват партии на отправку. Лиза, а не удаление из очереди: упавший
-- отправитель не уносит работу с собой.
create function remhaos_channel_api.claim_notification_batch(
  max_rows integer default 20,
  lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_data jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 200 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"maxRows"}'::jsonb
    );
  end if;

  with due as (
    select o.notification_id
    from remhaos_channel.notification_outbox o
    join remhaos_channel.project_channel_bindings b on b.binding_id = o.binding_id
    where o.state in ('pending', 'retry')
      and o.next_attempt_at <= statement_timestamp()
      and b.status = 'active'
      and (o.lease_expires_at is null or o.lease_expires_at <= statement_timestamp())
    order by o.next_attempt_at
    limit max_rows
    for update of o skip locked
  ), claimed as (
    update remhaos_channel.notification_outbox o
    set state = 'sending',
      attempt_count = o.attempt_count + 1,
      lease_expires_at = statement_timestamp()
        + make_interval(secs => greatest(coalesce(lease_seconds, 60), 5))
    from due
    where o.notification_id = due.notification_id
    returning o.notification_id, o.binding_id, o.payload, o.template_version,
      o.attempt_count
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'notificationId', c.notification_id,
    'bindingId', c.binding_id,
    'templateVersion', c.template_version,
    'attemptCount', c.attempt_count,
    'payload', c.payload,
    'externalChatId', b.external_chat_id,
    'botInstanceId', b.bot_instance_id
  )), '[]'::jsonb)
  into v_data
  from claimed c
  join remhaos_channel.project_channel_bindings b on b.binding_id = c.binding_id;

  return remhaos_channel._envelope(v_data);
end
$function$;

create function remhaos_channel_api.mark_notification_sent(
  notification_id uuid,
  external_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_state text;
begin
  update remhaos_channel.notification_outbox o
  set state = 'sent',
    sent_at = statement_timestamp(),
    external_message_id = external_message_id,
    lease_expires_at = null,
    failure_code = null
  where o.notification_id = notification_id
    and o.state <> 'sent'
  returning o.state into v_state;

  -- Повтор после потерянного ответа: запись уже `sent`, второй отправки не
  -- будет, и это не ошибка.
  return remhaos_channel._envelope(jsonb_build_object(
    'notificationId', notification_id,
    'changed', v_state is not null
  ));
end
$function$;

create function remhaos_channel_api.mark_notification_failed(
  notification_id uuid,
  failure_code text,
  retry_after_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_attempt integer;
  v_state text;
begin
  select o.attempt_count into v_attempt
  from remhaos_channel.notification_outbox o
  where o.notification_id = notification_id;
  if v_attempt is null then
    perform projectceo_foundation._raise(
      'P1104', 'not_found', '{"entity":"notification"}'::jsonb
    );
  end if;

  -- Пять попыток, дальше dead letter. Бесконечный ретрай — это не надёжность,
  -- а тихий цикл, который никто не заметит.
  v_state := case when v_attempt >= 5 then 'failed' else 'retry' end;

  update remhaos_channel.notification_outbox o
  set state = v_state,
    failure_code = left(coalesce(nullif(btrim(failure_code), ''), 'send_failed'), 80),
    lease_expires_at = null,
    next_attempt_at = statement_timestamp()
      + make_interval(secs => greatest(coalesce(retry_after_seconds, 30), 1))
  where o.notification_id = notification_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'notificationId', notification_id,
    'state', v_state
  ));
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Права
-- ─────────────────────────────────────────────────────────────────────────────

do $ownership$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('remhaos_channel', 'remhaos_channel_api')
  loop
    execute format('alter function %s owner to pi_table_owner', v_function);
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role, '
      || 'pi_human_executor, pi_worker_executor',
      v_function
    );
  end loop;
end
$ownership$;

grant usage on schema remhaos_channel_api to authenticated, service_role;

-- Человеческие двери: авторизация внутри, по членству и capability.
grant execute on function
  remhaos_channel_api.create_identity_link_intent(bytea, integer),
  remhaos_channel_api.create_binding_intent(uuid, bytea, integer),
  remhaos_channel_api.get_project_channel_state(uuid),
  remhaos_channel_api.disconnect_project_channel(uuid, text)
  to authenticated;

-- Системные двери: только воркер и транспорт. Человек не зовёт их никогда.
grant execute on function
  remhaos_channel_api.consume_identity_link_intent(bytea, bigint),
  remhaos_channel_api.activate_project_binding(bytea, bigint, text, bigint, text, text),
  remhaos_channel_api.suspend_project_binding(text, bigint, text),
  remhaos_channel_api.ingest_channel_update(text, bigint, bigint, bigint, text, bigint, timestamptz, bigint, text, jsonb),
  remhaos_channel_api.enqueue_notification(uuid, text, text, text, jsonb, text),
  remhaos_channel_api.claim_notification_batch(integer, integer),
  remhaos_channel_api.mark_notification_sent(uuid, bigint),
  remhaos_channel_api.mark_notification_failed(uuid, text, integer)
  to service_role;

do $guard$
declare
  v_leaked text;
begin
  -- Ни одна системная дверь не достаётся человеческой роли. Проверка тут же в
  -- миграции: разошлись гранты — упадёт применение, а не пользователь.
  select signature into v_leaked
  from unnest(array[
    'remhaos_channel_api.consume_identity_link_intent(bytea, bigint)',
    'remhaos_channel_api.activate_project_binding(bytea, bigint, text, bigint, text, text)',
    'remhaos_channel_api.suspend_project_binding(text, bigint, text)',
    'remhaos_channel_api.ingest_channel_update(text, bigint, bigint, bigint, text, bigint, timestamptz, bigint, text, jsonb)',
    'remhaos_channel_api.enqueue_notification(uuid, text, text, text, jsonb, text)',
    'remhaos_channel_api.claim_notification_batch(integer, integer)',
    'remhaos_channel_api.mark_notification_sent(uuid, bigint)',
    'remhaos_channel_api.mark_notification_failed(uuid, text, integer)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'REMHAOS_CHANNEL_SYSTEM_RPC_REACHABLE_BY_HUMAN:%', v_leaked;
  end if;

  -- И обратно: человеческие двери обязаны быть недоступны анонимам.
  select signature into v_leaked
  from unnest(array[
    'remhaos_channel_api.create_identity_link_intent(bytea, integer)',
    'remhaos_channel_api.create_binding_intent(uuid, bytea, integer)',
    'remhaos_channel_api.get_project_channel_state(uuid)',
    'remhaos_channel_api.disconnect_project_channel(uuid, text)'
  ]) signature
  where pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'REMHAOS_CHANNEL_HUMAN_RPC_REACHABLE_BY_ANON:%', v_leaked;
  end if;
end
$guard$;

commit;
