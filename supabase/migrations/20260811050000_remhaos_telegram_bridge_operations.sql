-- Telegram Chat Bridge — операции шлюза (A7 / DEC-031, гейт TG1).
--
-- Additive only. Продолжение `20260811040000`.
--
-- ДВА КОНТУРА, ДВА ЗАМКА. Функции этой миграции делятся ровно на два класса, и
-- класс определяет, кому она может быть выдана НАВСЕГДА:
--
--   * **человеческие** (`_authorize_project_human`, работают от `auth.uid()`) —
--     отозваны у `authenticated` этой миграцией и возвращаются ЯВНО только там,
--     где мост намеренно открыт (`tests/ap1/environment/enable-telegram-bridge.sql`).
--     Тот же механизм, что у M3 и M4, и по тому же решению владельца (DEC-029):
--     постоянная миграция прав не возвращает, production-включение — отдельный
--     OWNER GO;
--   * **системные** (webhook, воркеры) — выданы ТОЛЬКО `service_role` и отозваны
--     у `authenticated` НАВСЕГДА. Ни одна среда их не возвращает. Системная
--     функция, доступная человеческой сессии, означала бы, что кто угодно может
--     сфабриковать входящее сообщение чужого проекта.
--
-- ПОЧЕМУ СИСТЕМНАЯ ФУНКЦИЯ НЕ МОЖЕТ ВЫПОЛНИТЬ ЧЕЛОВЕЧЕСКОЕ ДЕЙСТВИЕ. Ни одна
-- функция ниже не подтверждает кандидата, не выдаёт выпуск и не создаёт
-- изменение. Системный контур умеет ровно три вещи: записать, что пришло;
-- отдать очередь; отметить обработку. Всё остальное делает человек своей
-- сессией через существующие команды RemHaOS.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни одного обращения к `project_intelligence.project_workflows
-- .state_revision` и ни одной записи в `projectceo_product.command_records` —
-- см. объяснение в `20260811040000`: ревизия состояния защищает человеческие
-- команды, и двигать её приходом сообщения из чата значило бы отменять чужую
-- работу. Идемпотентность шлюза структурная.

begin;

set local check_function_bodies = on;

-- ---------------------------------------------------------------------------
-- 0. Общие помощники
-- ---------------------------------------------------------------------------

create function projectceo_gateway._envelope(p_data jsonb)
returns jsonb
language sql
volatile
set search_path = ''
as $function$
  select jsonb_build_object(
    'contractVersion', 'remhaos-telegram-bridge/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', coalesce(p_data, 'null'::jsonb),
    'error', null
  )
$function$;

alter function projectceo_gateway._envelope(jsonb) owner to pi_table_owner;
revoke all on function projectceo_gateway._envelope(jsonb)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Шестнадцатеричный дайджест → bytea, с проверкой формы. Приложение считает
-- SHA-256 от одноразового секрета у себя и присылает только дайджест: сам
-- секрет в базу не попадает никогда.
create function projectceo_gateway._digest(p_hex text)
returns bytea
language plpgsql
immutable
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  if p_hex is null or p_hex !~ '^[0-9a-f]{64}$' then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"NONCE_DIGEST_INVALID"}'::jsonb
    );
  end if;
  return decode(p_hex, 'hex');
end
$function$;

alter function projectceo_gateway._digest(text) owner to pi_table_owner;
revoke all on function projectceo_gateway._digest(text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Разрешает организацию проекта для СИСТЕМНОГО вызова. Человека здесь нет и
-- быть не может: webhook и воркеры приходят без `auth.uid()`.
create function projectceo_gateway._system_organization(p_project_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
begin
  select workflow.organization_id into v_organization_id
  from project_intelligence.project_workflows workflow
  where workflow.project_id = p_project_id;
  if v_organization_id is null then
    perform projectceo_gateway._raise('P1104', 'not_found', '{"entity":"project"}'::jsonb);
  end if;
  return v_organization_id;
end
$function$;

alter function projectceo_gateway._system_organization(uuid) owner to pi_table_owner;
revoke all on function projectceo_gateway._system_organization(uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Есть ли у ЭТОГО пользователя capability в ЭТОМ проекте.
--
-- Это НЕ подмена `_authorize_project_human`: та отвечает на вопрос «имеет ли
-- право тот, кто сейчас звонит», и без `auth.uid()` бессмысленна. Здесь вопрос
-- другой — «имеет ли право тот, кого мы уже опознали по связанной идентичности»,
-- и системный контур обязан уметь его задать, не притворяясь этим человеком.
create function projectceo_gateway._user_has_capability(
  p_organization_id uuid,
  p_project_id uuid,
  p_user_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from projectceo_foundation.project_memberships membership
    join projectceo_foundation.project_member_capabilities capability
      on capability.organization_id = membership.organization_id
     and capability.project_id = membership.project_id
     and capability.user_id = membership.user_id
     and capability.capability = p_capability
    where membership.organization_id = p_organization_id
      and membership.project_id = p_project_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  )
$function$;

alter function projectceo_gateway._user_has_capability(uuid, uuid, uuid, text)
  owner to pi_table_owner;
revoke all on function projectceo_gateway._user_has_capability(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- ---------------------------------------------------------------------------
-- 1. Человеческие операции
-- ---------------------------------------------------------------------------

-- Заводит одноразовый интент. Секрет генерирует приложение; сюда приходит
-- только его SHA-256. TTL задаётся вызовом, но верхнюю границу держит
-- ограничение таблицы: растянуть 10 минут параметром нельзя.
create function projectceo_gateway_api.create_channel_link_intent(
  project_id uuid,
  purpose text,
  bot_instance_id text,
  nonce_digest_hex text,
  ttl_seconds integer default 600
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_intent_id uuid;
  v_expires_at timestamptz;
begin
  if auth.uid() is null then
    perform projectceo_gateway._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;
  if purpose is null or purpose not in ('identity_link', 'channel_binding') then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"PURPOSE_INVALID"}'::jsonb
    );
  end if;
  if bot_instance_id is null or btrim(bot_instance_id) = ''
     or char_length(btrim(bot_instance_id)) > 160
     or bot_instance_id <> btrim(bot_instance_id) then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"BOT_INSTANCE_INVALID"}'::jsonb
    );
  end if;
  if ttl_seconds is null or ttl_seconds < 60 or ttl_seconds > 600 then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"TTL_INVALID"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id, 'manage_project_integrations'
  );

  -- Прежние ожидающие интенты того же назначения гасятся: одновременно живой
  -- может быть ровно одна ссылка, иначе «одноразовость» превращается в
  -- «сколько успел нажать».
  update projectceo_gateway.channel_link_intents intent
  set status = 'revoked', revoked_at = statement_timestamp()
  where intent.organization_id = v_context.organization_id
    and intent.project_id = project_id
    and intent.actor_user_id = v_context.actor_user_id
    and intent.purpose = purpose
    and intent.status = 'pending';

  v_expires_at := statement_timestamp() + make_interval(secs => ttl_seconds);

  insert into projectceo_gateway.channel_link_intents (
    organization_id, project_id, purpose, provider, bot_instance_id,
    nonce_digest, actor_user_id, status, expires_at
  ) values (
    v_context.organization_id, project_id, purpose, 'telegram', bot_instance_id,
    projectceo_gateway._digest(nonce_digest_hex), v_context.actor_user_id,
    'pending', v_expires_at
  )
  returning intent_id into v_intent_id;

  return projectceo_gateway._envelope(jsonb_build_object(
    'intentId', v_intent_id,
    'purpose', purpose,
    'expiresAt', v_expires_at
  ));
exception
  when unique_violation then
    -- Тот же дайджест уже существует: либо повтор, либо коллизия. И то и другое
    -- обязано быть отказом, а не молчаливым переиспользованием чужого интента.
    perform projectceo_gateway._raise(
      'P1109', 'scope_conflict', '{"reason":"INTENT_DIGEST_TAKEN"}'::jsonb
    );
    return null;
end
$function$;

-- Состояние подключения для экрана настроек проекта.
create function projectceo_gateway_api.get_project_channel_state(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_binding jsonb;
  v_identity jsonb;
begin
  if auth.uid() is null then
    perform projectceo_gateway._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;

  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id, 'manage_project_integrations'
  );

  -- Внешний идентификатор чата наружу НЕ отдаётся: экрану он не нужен, а
  -- отданный он превращается в цель для чужого подключения.
  select jsonb_build_object(
    'bindingId', binding.binding_id,
    'provider', binding.provider,
    'chatType', binding.chat_type,
    'status', binding.status,
    'captureMode', binding.capture_mode,
    'noticeVersion', binding.notice_version,
    'noticePostedAt', binding.notice_posted_at,
    'createdAt', binding.created_at,
    'activatedAt', binding.activated_at,
    'statusReason', binding.status_reason
  ) into v_binding
  from projectceo_gateway.project_channel_bindings binding
  where binding.organization_id = v_context.organization_id
    and binding.project_id = project_id
    and binding.status in ('pending', 'active', 'suspended')
  order by binding.created_at desc
  limit 1;

  select jsonb_build_object(
    'linked', true,
    'linkedAt', link.linked_at
  ) into v_identity
  from projectceo_gateway.channel_identity_links link
  where link.organization_id = v_context.organization_id
    and link.provider = 'telegram'
    and link.user_id = v_context.actor_user_id
    and link.status = 'active';

  return projectceo_gateway._envelope(jsonb_build_object(
    'binding', coalesce(v_binding, 'null'::jsonb),
    'identity', coalesce(v_identity, jsonb_build_object('linked', false))
  ));
end
$function$;

-- Отключение. Привязка не удаляется — она отзывается: история подключения часть
-- аудита, и стирать её означало бы терять ответ на вопрос «кто и когда открыл
-- канал».
create function projectceo_gateway_api.revoke_channel_binding(
  project_id uuid,
  binding_id uuid,
  reason_code text default 'revoked_by_owner'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_cancelled bigint;
begin
  if auth.uid() is null then
    perform projectceo_gateway._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;

  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id, 'manage_project_integrations'
  );

  update projectceo_gateway.project_channel_bindings binding
  set status = 'revoked',
      capture_mode = 'none',
      revoked_at = statement_timestamp(),
      status_reason = reason_code
  where binding.organization_id = v_context.organization_id
    and binding.project_id = project_id
    and binding.binding_id = binding_id
    and binding.status in ('pending', 'active', 'suspended');
  if not found then
    perform projectceo_gateway._raise('P1104', 'not_found', '{"entity":"binding"}'::jsonb);
  end if;

  -- Отозванная привязка отменяет ещё не отправленные уведомления: слать в чат,
  -- который больше не наш, нельзя.
  with cancelled as (
    update projectceo_gateway.notification_outbox outbox
    set status = 'cancelled', cancelled_at = statement_timestamp(),
        lease_expires_at = null, failure_code = 'binding_revoked'
    where outbox.binding_id = binding_id
      and outbox.status in ('pending', 'retry', 'sending')
    returning 1
  )
  select count(*) into v_cancelled from cancelled;

  return projectceo_gateway._envelope(jsonb_build_object(
    'bindingId', binding_id,
    'status', 'revoked',
    'cancelledNotifications', v_cancelled
  ));
end
$function$;

-- Чтение Project Inbox. Кандидат — предложение, поэтому его видит тот, кто
-- вообще видит проект.
create function projectceo_gateway_api.list_project_inbox_candidates(
  project_id uuid,
  max_rows integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_data jsonb;
begin
  if auth.uid() is null then
    perform projectceo_gateway._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;
  if max_rows is null or max_rows < 1 or max_rows > 500 then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"INBOX_LIMIT_INVALID"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_foundation._authorize_project_human(project_id, 'view_project');

  select coalesce(jsonb_agg(item order by item ->> 'createdAt' desc), '[]'::jsonb)
  into v_data
  from (
    select jsonb_build_object(
      'candidateId', candidate.candidate_id,
      'candidateType', candidate.candidate_type,
      'status', candidate.status,
      'confidence', candidate.confidence,
      'rationale', candidate.rationale,
      'proposedText', candidate.proposed_text,
      'extractionSchemaVersion', candidate.extraction_schema_version,
      'createdAt', candidate.created_at,
      'reviewedAt', candidate.reviewed_at,
      'source', jsonb_build_object(
        'channel', 'telegram',
        'eventId', event.event_id,
        'externalMessageId', event.external_message_id,
        'sourceRevision', event.source_revision,
        'receivedAt', event.received_at,
        'externalEventAt', event.external_event_at,
        -- Опознан ли автор. Имени, username и телефона здесь нет и быть не
        -- может: отображаемое имя берётся из RemHaOS по `senderUserId`.
        'senderUserId', event.sender_user_id,
        'identity', case when event.sender_user_id is null then 'unverified' else 'verified' end,
        'text', event.text_content
      ),
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'attachmentId', attachment.attachment_id,
          'kind', attachment.attachment_kind,
          'scanStatus', attachment.scan_status,
          -- Локатор отдаётся ТОЛЬКО у проверенного файла: до `clean` вложения
          -- для продукта не существует.
          'storageObjectKey', case
            when attachment.scan_status = 'clean' then attachment.storage_object_key
            else null
          end
        ) order by attachment.created_at)
        from projectceo_gateway.channel_attachments attachment
        where attachment.event_id = event.event_id
      ), '[]'::jsonb)
    ) item
    from projectceo_gateway.project_inbox_candidates candidate
    join projectceo_gateway.channel_events event
      on event.event_id = candidate.source_event_id
    where candidate.organization_id = v_context.organization_id
      and candidate.project_id = project_id
      and candidate.candidate_type <> 'ignored'
    order by candidate.created_at desc
    limit max_rows
  ) rows;

  return projectceo_gateway._envelope(v_data);
end
$function$;

-- Решение человека по кандидату.
--
-- `confirmed` НЕ создаёт доменного объекта и не может его создать: официальное
-- действие выполняет существующая команда RemHaOS отдельным вызовом, а сюда
-- приходит только отметка «проверено». Разделение намеренное — иначе одно
-- нажатие делало бы и проверку, и изменение.
create function projectceo_gateway_api.resolve_project_inbox_candidate(
  project_id uuid,
  candidate_id uuid,
  decision text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_status text;
begin
  if auth.uid() is null then
    perform projectceo_gateway._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;
  if decision is null or decision not in ('confirmed', 'rejected') then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"DECISION_INVALID"}'::jsonb
    );
  end if;

  -- Проверять кандидата вправе тот, кто вправе проверять утверждения проекта:
  -- та же студийная сторона, что подтверждает источники и ревизии.
  select * into v_context
  from projectceo_foundation._authorize_project_human(project_id, 'review_claim');

  select candidate.status into v_status
  from projectceo_gateway.project_inbox_candidates candidate
  where candidate.organization_id = v_context.organization_id
    and candidate.project_id = project_id
    and candidate.candidate_id = candidate_id
  for update;
  if v_status is null then
    perform projectceo_gateway._raise('P1104', 'not_found', '{"entity":"candidate"}'::jsonb);
  end if;
  if v_status <> 'pending' then
    perform projectceo_gateway._raise(
      'P1109', 'scope_conflict', '{"reason":"CANDIDATE_ALREADY_RESOLVED"}'::jsonb
    );
  end if;

  update projectceo_gateway.project_inbox_candidates candidate
  set status = decision,
      reviewed_by_user_id = v_context.actor_user_id,
      reviewed_at = statement_timestamp()
  where candidate.candidate_id = candidate_id;

  return projectceo_gateway._envelope(jsonb_build_object(
    'candidateId', candidate_id,
    'status', decision
  ));
end
$function$;

-- ---------------------------------------------------------------------------
-- 2. Системные операции
-- ---------------------------------------------------------------------------

-- Погасить одноразовый интент. Возвращает контекст, если он ЖИВ: `pending`, не
-- истёк, не отозван. Всё остальное — отказ, и отказ одинаковый: истёкший,
-- отозванный и вовсе несуществующий токен неотличимы снаружи.
create function projectceo_gateway_api.consume_channel_link_intent(
  nonce_digest_hex text,
  purpose text,
  bot_instance_id text,
  external_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intent projectceo_gateway.channel_link_intents;
begin
  if purpose is null or purpose not in ('identity_link', 'channel_binding') then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"PURPOSE_INVALID"}'::jsonb
    );
  end if;
  if external_actor_id is null or external_actor_id !~ '^[0-9]{1,20}$' then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"EXTERNAL_ACTOR_INVALID"}'::jsonb
    );
  end if;

  select * into v_intent
  from projectceo_gateway.channel_link_intents intent
  where intent.nonce_digest = projectceo_gateway._digest(nonce_digest_hex)
  for update;

  if v_intent.intent_id is null
     or v_intent.status <> 'pending'
     or v_intent.purpose <> purpose
     or v_intent.bot_instance_id <> bot_instance_id
     or v_intent.expires_at <= statement_timestamp() then
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_NOT_USABLE"}'::jsonb
    );
  end if;

  update projectceo_gateway.channel_link_intents intent
  set status = 'consumed',
      consumed_at = statement_timestamp(),
      consumed_by_external_actor_id = external_actor_id
  where intent.intent_id = v_intent.intent_id
    and intent.status = 'pending';
  if not found then
    -- Кто-то погасил его между чтением и записью. Одноразовость важнее
    -- удобства: второй вызов обязан проиграть.
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_ALREADY_CONSUMED"}'::jsonb
    );
  end if;

  return projectceo_gateway._envelope(jsonb_build_object(
    'intentId', v_intent.intent_id,
    'organizationId', v_intent.organization_id,
    'projectId', v_intent.project_id,
    'purpose', v_intent.purpose,
    'actorUserId', v_intent.actor_user_id
  ));
end
$function$;

-- Связать идентичность канала с аккаунтом RemHaOS.
--
-- Строка НЕ выдаёт роли и не создаёт членства (INV-T3). Она отвечает на один
-- вопрос: чей это Telegram-аккаунт.
create function projectceo_gateway_api.complete_identity_link(
  intent_id uuid,
  external_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intent projectceo_gateway.channel_link_intents;
begin
  select * into v_intent
  from projectceo_gateway.channel_link_intents intent
  where intent.intent_id = intent_id
    and intent.purpose = 'identity_link'
    and intent.status = 'consumed'
    and intent.consumed_by_external_actor_id = external_actor_id;
  if v_intent.intent_id is null then
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_NOT_USABLE"}'::jsonb
    );
  end if;

  insert into projectceo_gateway.channel_identity_links (
    organization_id, provider, external_actor_id, user_id, status
  ) values (
    v_intent.organization_id, 'telegram', external_actor_id,
    v_intent.actor_user_id, 'active'
  )
  on conflict on constraint channel_identity_links_pkey do update
  set user_id = excluded.user_id,
      status = 'active',
      linked_at = statement_timestamp(),
      revoked_at = null
  where projectceo_gateway.channel_identity_links.user_id = excluded.user_id
     or projectceo_gateway.channel_identity_links.status = 'revoked';

  if not found then
    -- Этот внешний идентификатор уже принадлежит ДРУГОМУ аккаунту и связь жива.
    -- Молча перевесить её значило бы дать угонщику чужую идентичность.
    perform projectceo_gateway._raise(
      'P1109', 'scope_conflict', '{"reason":"EXTERNAL_ACTOR_ALREADY_LINKED"}'::jsonb
    );
  end if;

  return projectceo_gateway._envelope(jsonb_build_object(
    'organizationId', v_intent.organization_id,
    'userId', v_intent.actor_user_id
  ));
exception
  when unique_violation then
    -- Активная связь этого аккаунта с ДРУГИМ внешним идентификатором.
    perform projectceo_gateway._raise(
      'P1109', 'scope_conflict', '{"reason":"ACCOUNT_ALREADY_LINKED"}'::jsonb
    );
    return null;
end
$function$;

-- Подключить чат к проекту.
--
-- `initiator_is_chat_admin` приходит от транспорта, потому что база не умеет
-- спросить Telegram. Названо честно: это утверждение проверенного транспортом
-- факта, а не проверка внутри базы. Отказ при `false` стоит здесь, чтобы забыть
-- о нём было нельзя.
create function projectceo_gateway_api.complete_channel_binding(
  intent_id uuid,
  external_actor_id text,
  external_chat_id text,
  chat_type text,
  initiator_is_chat_admin boolean,
  notice_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intent projectceo_gateway.channel_link_intents;
  v_linked_user uuid;
  v_binding_id uuid;
begin
  if chat_type is null or chat_type not in ('group', 'supergroup') then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"CHAT_TYPE_INVALID"}'::jsonb
    );
  end if;
  if coalesce(initiator_is_chat_admin, false) is not true then
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"INITIATOR_NOT_CHAT_ADMIN"}'::jsonb
    );
  end if;

  select * into v_intent
  from projectceo_gateway.channel_link_intents intent
  where intent.intent_id = intent_id
    and intent.purpose = 'channel_binding'
    and intent.status = 'consumed'
    and intent.consumed_by_external_actor_id = external_actor_id;
  if v_intent.intent_id is null then
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_NOT_USABLE"}'::jsonb
    );
  end if;

  -- Кто нажал в Telegram — и есть ли у него аккаунт RemHaOS. Связь по
  -- ЧИСЛОВОМУ идентификатору: username мог смениться, а это — нет.
  select link.user_id into v_linked_user
  from projectceo_gateway.channel_identity_links link
  where link.organization_id = v_intent.organization_id
    and link.provider = 'telegram'
    and link.external_actor_id = external_actor_id
    and link.status = 'active';
  if v_linked_user is null then
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"IDENTITY_NOT_LINKED"}'::jsonb
    );
  end if;
  -- Интент завёл один человек, а в Telegram нажал другой — подключения нет.
  if v_linked_user <> v_intent.actor_user_id then
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_ACTOR_MISMATCH"}'::jsonb
    );
  end if;
  -- Право проверяется ЗАНОВО в момент подключения: между созданием интента и
  -- нажатием в Telegram человека могли исключить из проекта.
  if not projectceo_gateway._user_has_capability(
    v_intent.organization_id, v_intent.project_id, v_linked_user,
    'manage_project_integrations'
  ) then
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"PROJECT_CAPABILITY_REQUIRED"}'::jsonb
    );
  end if;

  insert into projectceo_gateway.project_channel_bindings (
    organization_id, project_id, provider, bot_instance_id, external_chat_id,
    chat_type, status, capture_mode, notice_version, initiated_by_user_id,
    initiated_by_external_actor_id, activated_at
  ) values (
    v_intent.organization_id, v_intent.project_id, 'telegram',
    v_intent.bot_instance_id, external_chat_id, chat_type,
    'active', 'notice_pending', notice_version, v_linked_user,
    external_actor_id, statement_timestamp()
  )
  returning binding_id into v_binding_id;

  return projectceo_gateway._envelope(jsonb_build_object(
    'bindingId', v_binding_id,
    'organizationId', v_intent.organization_id,
    'projectId', v_intent.project_id,
    'captureMode', 'notice_pending'
  ));
exception
  when unique_violation then
    -- INV-T1 сработал. Два конкурентных подключения одного чата или второго
    -- чата в один проект приходят сюда, и оба обязаны получить внятный отказ, а
    -- не 23505 наружу.
    perform projectceo_gateway._raise(
      'P1109', 'scope_conflict', '{"reason":"BINDING_ALREADY_ACTIVE"}'::jsonb
    );
    return null;
end
$function$;

-- Уведомление участников опубликовано — только теперь начинается полный приём.
create function projectceo_gateway_api.mark_channel_notice_posted(
  binding_id uuid,
  notice_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  update projectceo_gateway.project_channel_bindings binding
  set capture_mode = 'full_after_notice',
      notice_posted_at = statement_timestamp(),
      notice_version = notice_version
  where binding.binding_id = binding_id
    and binding.status = 'active'
    and binding.capture_mode = 'notice_pending';
  if not found then
    perform projectceo_gateway._raise('P1104', 'not_found', '{"entity":"binding"}'::jsonb);
  end if;
  return projectceo_gateway._envelope(jsonb_build_object(
    'bindingId', binding_id, 'captureMode', 'full_after_notice'
  ));
end
$function$;

-- Бот удалён из чата или понижен в правах. Привязка не отзывается — она
-- приостанавливается: чат тот же, права вернуть можно, а терять историю
-- подключения не за что.
create function projectceo_gateway_api.suspend_channel_binding(
  binding_id uuid,
  reason_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_cancelled bigint;
begin
  update projectceo_gateway.project_channel_bindings binding
  set status = 'suspended',
      capture_mode = 'none',
      suspended_at = statement_timestamp(),
      status_reason = reason_code
  where binding.binding_id = binding_id
    and binding.status = 'active';
  if not found then
    -- Повторное уведомление Telegram об одном и том же — не ошибка.
    return projectceo_gateway._envelope(jsonb_build_object(
      'bindingId', binding_id, 'status', 'unchanged'
    ));
  end if;

  with cancelled as (
    update projectceo_gateway.notification_outbox outbox
    set status = 'cancelled', cancelled_at = statement_timestamp(),
        lease_expires_at = null, failure_code = 'binding_suspended'
    where outbox.binding_id = binding_id
      and outbox.status in ('pending', 'retry', 'sending')
    returning 1
  )
  select count(*) into v_cancelled from cancelled;

  return projectceo_gateway._envelope(jsonb_build_object(
    'bindingId', binding_id,
    'status', 'suspended',
    'cancelledNotifications', v_cancelled
  ));
end
$function$;

-- Найти активную привязку по внешнему чату. Единственный способ для webhook
-- узнать, наш ли это чат, — и первый, потому что у несвязанного чата
-- содержимое не сохраняется вовсе.
create function projectceo_gateway_api.resolve_channel_binding(
  bot_instance_id text,
  external_chat_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding projectceo_gateway.project_channel_bindings;
begin
  select * into v_binding
  from projectceo_gateway.project_channel_bindings binding
  where binding.provider = 'telegram'
    and binding.bot_instance_id = bot_instance_id
    and binding.external_chat_id = external_chat_id
    and binding.status in ('active', 'suspended')
  order by case binding.status when 'active' then 0 else 1 end, binding.created_at desc
  limit 1;

  if v_binding.binding_id is null then
    return projectceo_gateway._envelope('null'::jsonb);
  end if;

  return projectceo_gateway._envelope(jsonb_build_object(
    'bindingId', v_binding.binding_id,
    'organizationId', v_binding.organization_id,
    'projectId', v_binding.project_id,
    'status', v_binding.status,
    'captureMode', v_binding.capture_mode
  ));
end
$function$;

-- Durable-запись входящего update. Единственная запись, которую делает webhook,
-- и делает он её ДО того, как ответить Telegram успехом.
create function projectceo_gateway_api.record_channel_event(
  binding_id uuid,
  external_update_id bigint,
  external_chat_id text,
  external_message_id bigint,
  external_actor_id text,
  event_kind text,
  source_revision integer,
  external_event_at timestamptz,
  reply_to_message_id bigint,
  forward_origin_kind text,
  forward_origin_at timestamptz,
  text_content text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding projectceo_gateway.project_channel_bindings;
  v_sender_user_id uuid;
  v_event_id uuid;
  v_existing uuid;
begin
  if event_kind is null or event_kind not in (
    'message', 'edited_message', 'my_chat_member', 'chat_member', 'callback_query'
  ) then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"EVENT_KIND_INVALID"}'::jsonb
    );
  end if;

  select * into v_binding
  from projectceo_gateway.project_channel_bindings binding
  where binding.binding_id = binding_id;
  if v_binding.binding_id is null then
    perform projectceo_gateway._raise('P1104', 'not_found', '{"entity":"binding"}'::jsonb);
  end if;
  -- Содержимое сохраняется только у активной привязки после уведомления
  -- участников. До него и после приостановки чат для нас нем.
  if v_binding.status <> 'active' or v_binding.capture_mode <> 'full_after_notice' then
    perform projectceo_gateway._raise(
      'P1103', 'forbidden', '{"reason":"CAPTURE_NOT_ACTIVE"}'::jsonb
    );
  end if;
  if v_binding.external_chat_id <> external_chat_id then
    perform projectceo_gateway._raise(
      'P1109', 'scope_conflict', '{"reason":"CHAT_MISMATCH"}'::jsonb
    );
  end if;

  if external_actor_id is not null then
    select link.user_id into v_sender_user_id
    from projectceo_gateway.channel_identity_links link
    where link.organization_id = v_binding.organization_id
      and link.provider = 'telegram'
      and link.external_actor_id = external_actor_id
      and link.status = 'active';
  end if;

  insert into projectceo_gateway.channel_events (
    organization_id, project_id, binding_id, provider, bot_instance_id,
    external_update_id, external_chat_id, external_message_id, external_actor_id,
    sender_user_id, event_kind, source_revision, external_event_at,
    reply_to_message_id, forward_origin_kind, forward_origin_at, text_content
  ) values (
    v_binding.organization_id, v_binding.project_id, binding_id, 'telegram',
    v_binding.bot_instance_id, external_update_id, external_chat_id,
    external_message_id, external_actor_id, v_sender_user_id, event_kind,
    coalesce(source_revision, 1), external_event_at, reply_to_message_id,
    forward_origin_kind, forward_origin_at, text_content
  )
  on conflict on constraint channel_events_update_key do nothing
  returning event_id into v_event_id;

  if v_event_id is null then
    -- Повтор доставки. Telegram повторяет, пока не получит 2xx, и вторая
    -- попытка обязана попасть в ТУ ЖЕ строку, а не завести вторую.
    select event.event_id into v_existing
    from projectceo_gateway.channel_events event
    where event.provider = 'telegram'
      and event.bot_instance_id = v_binding.bot_instance_id
      and event.external_update_id = external_update_id;
    return projectceo_gateway._envelope(jsonb_build_object(
      'eventId', v_existing, 'duplicate', true,
      'projectId', v_binding.project_id
    ));
  end if;

  return projectceo_gateway._envelope(jsonb_build_object(
    'eventId', v_event_id, 'duplicate', false,
    'projectId', v_binding.project_id
  ));
exception
  when unique_violation then
    -- Правка сообщения, у которой ревизия уже занята: тот же текст пришёл
    -- дважды под разными `update_id`. Второй раз новую ревизию не заводим.
    perform projectceo_gateway._raise(
      'P1109', 'scope_conflict', '{"reason":"SOURCE_REVISION_TAKEN"}'::jsonb
    );
    return null;
end
$function$;

-- Метаданные вложения. Байты сюда не приходят: их место — общий приватный
-- storage с карантином, и до `clean` файла для продукта не существует.
create function projectceo_gateway_api.record_channel_attachment(
  event_id uuid,
  attachment_kind text,
  external_file_id text,
  external_file_unique_id text,
  declared_size_bytes bigint,
  declared_media_type text,
  scan_status text,
  scan_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_event projectceo_gateway.channel_events;
  v_attachment_id uuid;
begin
  if attachment_kind is null or attachment_kind not in ('photo', 'document', 'voice') then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"ATTACHMENT_KIND_INVALID"}'::jsonb
    );
  end if;
  -- Записать вложение сразу «чистым» нельзя: чистоту устанавливает проверка
  -- байтов, а не тот, кто их прислал.
  if scan_status is null or scan_status not in (
    'pending', 'materialization_blocked', 'rejected', 'too_large'
  ) then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"SCAN_STATUS_NOT_INITIAL"}'::jsonb
    );
  end if;

  select * into v_event
  from projectceo_gateway.channel_events event
  where event.event_id = event_id;
  if v_event.event_id is null then
    perform projectceo_gateway._raise('P1104', 'not_found', '{"entity":"channelEvent"}'::jsonb);
  end if;

  insert into projectceo_gateway.channel_attachments (
    organization_id, project_id, event_id, attachment_kind, external_file_id,
    external_file_unique_id, declared_size_bytes, declared_media_type,
    scan_status, scan_reason
  ) values (
    v_event.organization_id, v_event.project_id, event_id, attachment_kind,
    external_file_id, external_file_unique_id, declared_size_bytes,
    declared_media_type, scan_status, scan_reason
  )
  on conflict on constraint channel_attachments_event_file_key do nothing
  returning attachment_id into v_attachment_id;

  return projectceo_gateway._envelope(jsonb_build_object(
    'attachmentId', v_attachment_id,
    'duplicate', v_attachment_id is null
  ));
end
$function$;

-- Очередь входящих событий, взятая в аренду. Аренда — не украшение: без неё
-- два воркера обработали бы одно сообщение дважды и завели бы двух кандидатов.
create function projectceo_gateway_api.claim_channel_events(
  max_rows integer default 20,
  lease_seconds integer default 120
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_data jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 200 then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"CLAIM_LIMIT_INVALID"}'::jsonb
    );
  end if;
  if lease_seconds is null or lease_seconds < 10 or lease_seconds > 3600 then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"LEASE_INVALID"}'::jsonb
    );
  end if;

  with claimed as (
    update projectceo_gateway.channel_events event
    set processing_state = 'processing',
        attempts = event.attempts + 1,
        lease_expires_at = statement_timestamp() + make_interval(secs => lease_seconds)
    where event.event_id in (
      select candidate.event_id
      from projectceo_gateway.channel_events candidate
      join projectceo_gateway.project_channel_bindings binding
        on binding.binding_id = candidate.binding_id
      where candidate.next_attempt_at <= statement_timestamp()
        and (
          candidate.processing_state = 'pending'
          -- Аренда истекла — воркер умер, и работу надо доделать.
          or (candidate.processing_state = 'processing'
              and candidate.lease_expires_at <= statement_timestamp())
        )
        -- Отозванная привязка ничего больше не обрабатывает.
        and binding.status in ('active', 'suspended')
        and candidate.event_kind in ('message', 'edited_message')
      order by candidate.received_at
      for update of candidate skip locked
      limit max_rows
    )
    returning event.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', claimed.event_id,
    'organizationId', claimed.organization_id,
    'projectId', claimed.project_id,
    'bindingId', claimed.binding_id,
    'eventKind', claimed.event_kind,
    'sourceRevision', claimed.source_revision,
    'senderUserId', claimed.sender_user_id,
    'textContent', claimed.text_content,
    'attempts', claimed.attempts
  ) order by claimed.received_at), '[]'::jsonb)
  into v_data
  from claimed;

  return projectceo_gateway._envelope(v_data);
end
$function$;

create function projectceo_gateway_api.complete_channel_event(
  event_id uuid,
  outcome text,
  failure_code text default null,
  retry_after_seconds integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  if outcome is null or outcome not in ('processed', 'skipped', 'retry', 'dead_letter') then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"OUTCOME_INVALID"}'::jsonb
    );
  end if;

  update projectceo_gateway.channel_events event
  set processing_state = case outcome when 'retry' then 'pending' else outcome end,
      lease_expires_at = null,
      failure_code = failure_code,
      next_attempt_at = case
        when outcome = 'retry'
          then statement_timestamp() + make_interval(secs => coalesce(retry_after_seconds, 60))
        else event.next_attempt_at
      end
  where event.event_id = event_id;
  if not found then
    perform projectceo_gateway._raise('P1104', 'not_found', '{"entity":"channelEvent"}'::jsonb);
  end if;

  return projectceo_gateway._envelope(jsonb_build_object('eventId', event_id, 'outcome', outcome));
end
$function$;

-- Записать кандидата. Только `pending`, и только системой: превратить кандидата
-- в решённого может исключительно человеческая RPC выше.
create function projectceo_gateway_api.record_inbox_candidate(
  event_id uuid,
  candidate_type text,
  extraction_schema_version text,
  extraction_provider text,
  extraction_model text,
  confidence text,
  rationale text,
  proposed_text text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_event projectceo_gateway.channel_events;
  v_candidate_id uuid;
begin
  if candidate_type is null or candidate_type not in (
    'question', 'decision_candidate', 'change_request_candidate',
    'risk_candidate', 'general_note', 'ignored'
  ) then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"CANDIDATE_TYPE_INVALID"}'::jsonb
    );
  end if;

  select * into v_event
  from projectceo_gateway.channel_events event
  where event.event_id = event_id;
  if v_event.event_id is null then
    perform projectceo_gateway._raise('P1104', 'not_found', '{"entity":"channelEvent"}'::jsonb);
  end if;

  insert into projectceo_gateway.project_inbox_candidates (
    organization_id, project_id, binding_id, source_event_id, candidate_type,
    extraction_schema_version, extraction_provider, extraction_model,
    confidence, rationale, proposed_text, status
  ) values (
    v_event.organization_id, v_event.project_id, v_event.binding_id, event_id,
    candidate_type, extraction_schema_version, extraction_provider,
    extraction_model, confidence, rationale, proposed_text, 'pending'
  )
  on conflict on constraint project_inbox_candidates_extraction_key do nothing
  returning candidate_id into v_candidate_id;

  return projectceo_gateway._envelope(jsonb_build_object(
    'candidateId', v_candidate_id,
    'duplicate', v_candidate_id is null
  ));
end
$function$;

-- ---------------------------------------------------------------------------
-- 3. Догоняющий проектор уведомлений
-- ---------------------------------------------------------------------------
--
-- ПОЧЕМУ ПРОЕКТОР, А НЕ СОБЫТИЕ В ПАМЯТИ. `distribute_release` пишет строку
-- `projectceo_product.release_distributions` в своей транзакции — это и есть
-- фактическая durable boundary успешной выдачи. Проектор ищет выдачи, у которых
-- строки в outbox ещё нет. Отсюда свойство, ради которого он и написан: падение
-- ПОСЛЕ записи выдачи и ДО отправки уведомление не теряет — следующий проход
-- найдёт ту же выдачу, потому что решает он по персистентному состоянию, а не
-- по одноразовому сигналу.
--
-- Модуль 4 при этом не тронут ни одной строкой: Telegram-кода в нём нет, и
-- `distribute_release` не знает о существовании моста.
create function projectceo_gateway_api.project_release_notifications(
  max_rows integer default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_created bigint;
begin
  if max_rows is null or max_rows < 1 or max_rows > 1000 then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"PROJECTION_LIMIT_INVALID"}'::jsonb
    );
  end if;

  with pending as (
    select distribution.organization_id,
      distribution.project_id,
      distribution.distribution_id,
      distribution.recipient_user_id,
      binding.binding_id
    from projectceo_product.release_distributions distribution
    join projectceo_gateway.project_channel_bindings binding
      on binding.organization_id = distribution.organization_id
     and binding.project_id = distribution.project_id
     and binding.status = 'active'
    where not exists (
      select 1
      from projectceo_gateway.notification_outbox outbox
      where outbox.organization_id = distribution.organization_id
        and outbox.project_id = distribution.project_id
        and outbox.idempotency_key = 'release_distribution:' || distribution.distribution_id::text
    )
    order by distribution.distributed_at
    limit max_rows
  ), inserted as (
    insert into projectceo_gateway.notification_outbox (
      organization_id, project_id, binding_id, source_kind, source_id,
      template_id, template_version, recipient_user_id, idempotency_key, status
    )
    select pending.organization_id, pending.project_id, pending.binding_id,
      'release_distribution', pending.distribution_id::text,
      'release_distributed', '0.1', pending.recipient_user_id,
      'release_distribution:' || pending.distribution_id::text, 'pending'
    from pending
    -- Гонка двух проекторов заканчивается одной строкой, а не ошибкой: ключ
    -- детерминированный, и второй просто ничего не вставляет.
    on conflict on constraint notification_outbox_idempotency_key do nothing
    returning 1
  )
  select count(*) into v_created from inserted;

  return projectceo_gateway._envelope(jsonb_build_object('created', v_created));
end
$function$;

create function projectceo_gateway_api.claim_notifications(
  max_rows integer default 20,
  lease_seconds integer default 120
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_data jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 200 then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"CLAIM_LIMIT_INVALID"}'::jsonb
    );
  end if;
  if lease_seconds is null or lease_seconds < 10 or lease_seconds > 3600 then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"LEASE_INVALID"}'::jsonb
    );
  end if;

  with claimed as (
    update projectceo_gateway.notification_outbox outbox
    set status = 'sending',
        attempts = outbox.attempts + 1,
        lease_expires_at = statement_timestamp() + make_interval(secs => lease_seconds)
    where outbox.notification_id in (
      select candidate.notification_id
      from projectceo_gateway.notification_outbox candidate
      join projectceo_gateway.project_channel_bindings binding
        on binding.binding_id = candidate.binding_id
      where candidate.next_attempt_at <= statement_timestamp()
        and (
          candidate.status in ('pending', 'retry')
          or (candidate.status = 'sending'
              and candidate.lease_expires_at <= statement_timestamp())
        )
        -- Приостановленная и отозванная привязка ничего не отправляет.
        and binding.status = 'active'
      order by candidate.created_at
      for update of candidate skip locked
      limit max_rows
    )
    returning outbox.*, (
      select binding.external_chat_id
      from projectceo_gateway.project_channel_bindings binding
      where binding.binding_id = outbox.binding_id
    ) as external_chat_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'notificationId', claimed.notification_id,
    'organizationId', claimed.organization_id,
    'projectId', claimed.project_id,
    'bindingId', claimed.binding_id,
    'externalChatId', claimed.external_chat_id,
    'sourceKind', claimed.source_kind,
    'sourceId', claimed.source_id,
    'templateId', claimed.template_id,
    'templateVersion', claimed.template_version,
    'recipientUserId', claimed.recipient_user_id,
    'attempts', claimed.attempts
  ) order by claimed.created_at), '[]'::jsonb)
  into v_data
  from claimed;

  return projectceo_gateway._envelope(v_data);
end
$function$;

create function projectceo_gateway_api.complete_notification(
  notification_id uuid,
  outcome text,
  external_message_id bigint default null,
  failure_code text default null,
  retry_after_seconds integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  if outcome is null or outcome not in ('sent', 'retry', 'failed', 'cancelled') then
    perform projectceo_gateway._raise(
      'P1111', 'validation_failed', '{"reason":"OUTCOME_INVALID"}'::jsonb
    );
  end if;

  update projectceo_gateway.notification_outbox outbox
  set status = outcome,
      lease_expires_at = null,
      external_message_id = coalesce(external_message_id, outbox.external_message_id),
      failure_code = failure_code,
      sent_at = case when outcome = 'sent' then statement_timestamp() else outbox.sent_at end,
      cancelled_at = case
        when outcome = 'cancelled' then statement_timestamp() else outbox.cancelled_at
      end,
      next_attempt_at = case
        when outcome = 'retry'
          then statement_timestamp() + make_interval(secs => coalesce(retry_after_seconds, 60))
        else outbox.next_attempt_at
      end
  where outbox.notification_id = notification_id
    -- Отменённое уведомление не воскресает: привязку отозвали, пока мы слали.
    and outbox.status <> 'cancelled';
  if not found then
    -- Строки нет либо она уже отменена. Для воркера это не ошибка: работа
    -- отменена, и следующий проход её не увидит.
    return projectceo_gateway._envelope(jsonb_build_object(
      'notificationId', notification_id, 'outcome', 'cancelled'
    ));
  end if;

  return projectceo_gateway._envelope(jsonb_build_object(
    'notificationId', notification_id, 'outcome', outcome
  ));
end
$function$;

-- ---------------------------------------------------------------------------
-- 4. Права
-- ---------------------------------------------------------------------------

do $own$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'projectceo_gateway_api.create_channel_link_intent(uuid, text, text, text, integer)',
    'projectceo_gateway_api.get_project_channel_state(uuid)',
    'projectceo_gateway_api.revoke_channel_binding(uuid, uuid, text)',
    'projectceo_gateway_api.list_project_inbox_candidates(uuid, integer)',
    'projectceo_gateway_api.resolve_project_inbox_candidate(uuid, uuid, text)',
    'projectceo_gateway_api.consume_channel_link_intent(text, text, text, text)',
    'projectceo_gateway_api.complete_identity_link(uuid, text)',
    'projectceo_gateway_api.complete_channel_binding(uuid, text, text, text, boolean, text)',
    'projectceo_gateway_api.mark_channel_notice_posted(uuid, text)',
    'projectceo_gateway_api.suspend_channel_binding(uuid, text)',
    'projectceo_gateway_api.resolve_channel_binding(text, text)',
    'projectceo_gateway_api.record_channel_event(uuid, bigint, text, bigint, text, text, integer, timestamptz, bigint, text, timestamptz, text)',
    'projectceo_gateway_api.record_channel_attachment(uuid, text, text, text, bigint, text, text, text)',
    'projectceo_gateway_api.claim_channel_events(integer, integer)',
    'projectceo_gateway_api.complete_channel_event(uuid, text, text, integer)',
    'projectceo_gateway_api.record_inbox_candidate(uuid, text, text, text, text, text, text, text)',
    'projectceo_gateway_api.project_release_notifications(integer)',
    'projectceo_gateway_api.claim_notifications(integer, integer)',
    'projectceo_gateway_api.complete_notification(uuid, text, bigint, text, integer)'
  ] loop
    execute format('alter function %s owner to pi_table_owner', v_signature);
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role,'
      ' pi_human_executor, pi_worker_executor',
      v_signature
    );
  end loop;
end
$own$;

-- Схема отдана Data API, но САМА ПО СЕБЕ она ничего не открывает: `usage` без
-- `execute` не даёт вызвать ни одной функции.
grant usage on schema projectceo_gateway_api to authenticated, service_role;

-- Системный контур. Выдаётся `service_role` навсегда и `authenticated` —
-- никогда.
grant execute on function
  projectceo_gateway_api.consume_channel_link_intent(text, text, text, text),
  projectceo_gateway_api.complete_identity_link(uuid, text),
  projectceo_gateway_api.complete_channel_binding(uuid, text, text, text, boolean, text),
  projectceo_gateway_api.mark_channel_notice_posted(uuid, text),
  projectceo_gateway_api.suspend_channel_binding(uuid, text),
  projectceo_gateway_api.resolve_channel_binding(text, text),
  projectceo_gateway_api.record_channel_event(uuid, bigint, text, bigint, text, text, integer, timestamptz, bigint, text, timestamptz, text),
  projectceo_gateway_api.record_channel_attachment(uuid, text, text, text, bigint, text, text, text),
  projectceo_gateway_api.claim_channel_events(integer, integer),
  projectceo_gateway_api.complete_channel_event(uuid, text, text, integer),
  projectceo_gateway_api.record_inbox_candidate(uuid, text, text, text, text, text, text, text),
  projectceo_gateway_api.project_release_notifications(integer),
  projectceo_gateway_api.claim_notifications(integer, integer),
  projectceo_gateway_api.complete_notification(uuid, text, bigint, text, integer)
  to service_role;

-- Человеческий контур НЕ открывается этой миграцией. Права возвращает только
-- среда, где мост намеренно включён: `tests/ap1/environment/enable-telegram-bridge.sql`.

-- Запрет, который никто не проверяет, — это комментарий.
do $guard$
declare
  v_leaked text;
  v_missing text;
begin
  -- Ни одна функция шлюза не доступна `authenticated` после миграции: ни
  -- системная (никогда), ни человеческая (до явного включения среды).
  select signature into v_leaked
  from unnest(array[
    'projectceo_gateway_api.create_channel_link_intent(uuid, text, text, text, integer)',
    'projectceo_gateway_api.get_project_channel_state(uuid)',
    'projectceo_gateway_api.revoke_channel_binding(uuid, uuid, text)',
    'projectceo_gateway_api.list_project_inbox_candidates(uuid, integer)',
    'projectceo_gateway_api.resolve_project_inbox_candidate(uuid, uuid, text)',
    'projectceo_gateway_api.consume_channel_link_intent(text, text, text, text)',
    'projectceo_gateway_api.complete_identity_link(uuid, text)',
    'projectceo_gateway_api.complete_channel_binding(uuid, text, text, text, boolean, text)',
    'projectceo_gateway_api.mark_channel_notice_posted(uuid, text)',
    'projectceo_gateway_api.suspend_channel_binding(uuid, text)',
    'projectceo_gateway_api.resolve_channel_binding(text, text)',
    'projectceo_gateway_api.record_channel_event(uuid, bigint, text, bigint, text, text, integer, timestamptz, bigint, text, timestamptz, text)',
    'projectceo_gateway_api.record_channel_attachment(uuid, text, text, text, bigint, text, text, text)',
    'projectceo_gateway_api.claim_channel_events(integer, integer)',
    'projectceo_gateway_api.complete_channel_event(uuid, text, text, integer)',
    'projectceo_gateway_api.record_inbox_candidate(uuid, text, text, text, text, text, text, text)',
    'projectceo_gateway_api.project_release_notifications(integer)',
    'projectceo_gateway_api.claim_notifications(integer, integer)',
    'projectceo_gateway_api.complete_notification(uuid, text, bigint, text, integer)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'REMHAOS_TELEGRAM_BRIDGE_REACHABLE_BY_HUMAN_ROLE:%', v_leaked;
  end if;

  -- ...и системный контур обязан работать: воркер без прав — это не запрет, это
  -- поломка.
  select signature into v_missing
  from unnest(array[
    'projectceo_gateway_api.resolve_channel_binding(text, text)',
    'projectceo_gateway_api.record_channel_event(uuid, bigint, text, bigint, text, text, integer, timestamptz, bigint, text, timestamptz, text)',
    'projectceo_gateway_api.claim_channel_events(integer, integer)',
    'projectceo_gateway_api.project_release_notifications(integer)',
    'projectceo_gateway_api.claim_notifications(integer, integer)'
  ]) signature
  where not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'REMHAOS_TELEGRAM_BRIDGE_SYSTEM_PATH_BROKEN:%', v_missing;
  end if;

  -- Приватные таблицы шлюза не отданы никому, кроме владельца.
  if pg_catalog.has_table_privilege(
    'authenticated', 'projectceo_gateway.channel_events', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'service_role', 'projectceo_gateway.channel_events', 'SELECT'
  ) then
    raise exception 'REMHAOS_TELEGRAM_BRIDGE_TABLES_EXPOSED';
  end if;
end
$guard$;

commit;
