-- TG2 моста A7 (DEC-041 §5, DEC-043 (c), DEC-044 (b–d)). Порядок владельца:
-- личность и полномочия → привязка и смена номера чата → вложения → флаги и
-- доказательства. Мост остаётся единственным адаптером сообщений (DEC-031):
-- из Telegram появляются только кандидаты, действий проекта бот не выполняет.
--
-- 1. Атрибуция отправителя. Событие хранит, кто его прислал в терминах
--    RemHaOS: связанный Telegram-аккаунт (channel_identity_links) и активное
--    членство в проекте. Без связи — `unlinked`, со связью без членства —
--    `linked_non_member`. Атрибуция ничего не разрешает: она подпись к
--    кандидату для человека, который его разбирает.
-- 2. Журнал привязки (append-only). Каждая смена статуса или номера чата
--    пишется триггером; прямой записи в журнал нет ни у кого.
-- 3. Смена номера чата (группа → супергруппа, migrate_to_chat_id): перенос
--    активной привязки автоматический, идемпотентный по update_id и всегда с
--    записью в журнал (DEC-043 (c)). Ключ — только числовой chat id: ни
--    название, ни телефон, ни display name.
-- 4. Вложения: webhook записывает только метаданные (file_id), фоновый
--    процесс (DEC-044 (b)) берёт их в аренду, скачивает, считает sha256,
--    кладёт в карантин через существующий file intake и возвращает итог:
--    `scanning` (передано в file intake → scan_pending) или `rejected`.
-- 5. Флаги (DEC-044 (c)): bridge / attachments / notifications на проект,
--    по умолчанию выключены, включает человек с manage_project_integrations,
--    каждое включение — в журнале. Глобальный env-выключатель остаётся
--    главным. Второй контур «интеграция» для Telegram заморожен (DEC-044 (d))
--    на стороне маршрута; его таблицы не меняются.

begin;
set local check_function_bodies = on;

-- === 5. Флаги (раньше всех: ими пользуются функции ниже) ====================

create table remhaos_channel.bridge_scope_flags (
  organization_id uuid not null,
  project_id uuid not null,
  flag text not null check (flag in ('bridge', 'attachments', 'notifications')),
  enabled boolean not null default false,
  -- NULL — только перенос при установке миграции (системный автор, см. журнал).
  changed_by_user_id uuid,
  changed_at timestamptz not null default statement_timestamp(),
  constraint bridge_scope_flags_pkey primary key (organization_id, project_id, flag),
  constraint bridge_scope_flags_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict
);

create table remhaos_channel.bridge_scope_flag_events (
  event_id bigint generated always as identity primary key,
  organization_id uuid not null,
  project_id uuid not null,
  flag text not null,
  enabled boolean not null,
  changed_by_user_id uuid,
  actor text not null default 'human' check (actor in ('human', 'system:migration')),
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default statement_timestamp(),
  -- Человек всегда назван; безымянное изменение — только системный перенос.
  constraint bridge_scope_flag_events_author_check check (
    (actor = 'human' and changed_by_user_id is not null)
    or (actor = 'system:migration' and changed_by_user_id is null)
  )
);

-- F8: журнал флагов append-only, как журнал привязки.
create function remhaos_channel._reject_flag_event_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception using errcode = '55000', message = 'FLAG_EVENT_IMMUTABLE';
end
$function$;

create trigger bridge_scope_flag_events_append_only
  before update or delete on remhaos_channel.bridge_scope_flag_events
  for each row execute function remhaos_channel._reject_flag_event_mutation();

create function remhaos_channel._bridge_flag_enabled(
  p_organization_id uuid, p_project_id uuid, p_flag text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select f.enabled from remhaos_channel.bridge_scope_flags f
    where f.organization_id = p_organization_id
      and f.project_id = p_project_id
      and f.flag = p_flag
  ), false)
$function$;

create function remhaos_channel_api.set_bridge_flag(
  project_id uuid,
  flag text,
  enabled boolean,
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
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(project_id, 'manage_project_integrations');
  if flag is null or flag not in ('bridge', 'attachments', 'notifications') then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"flag"}'::jsonb);
  end if;
  if enabled is null then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"enabled"}'::jsonb);
  end if;
  if reason is null or char_length(btrim(reason)) not between 1 and 500 then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"reason"}'::jsonb);
  end if;
  insert into remhaos_channel.bridge_scope_flags (
    organization_id, project_id, flag, enabled, changed_by_user_id
  ) values (
    v_context.organization_id, project_id, flag, enabled, v_context.actor_user_id
  )
  -- Цель конфликта — ИМЯ ограничения: при `use_variable` список колонок
  -- разрешился бы в одноимённые параметры (`project_id`, `flag`).
  on conflict on constraint bridge_scope_flags_pkey do update
    set enabled = excluded.enabled,
        changed_by_user_id = excluded.changed_by_user_id,
        changed_at = statement_timestamp();
  insert into remhaos_channel.bridge_scope_flag_events (
    organization_id, project_id, flag, enabled, changed_by_user_id, reason
  ) values (
    v_context.organization_id, project_id, flag, enabled, v_context.actor_user_id, btrim(reason)
  );
  -- Выключение уведомлений снимает ещё не отправленное: после повторного
  -- включения в группу не уходит то, что копилось до выключения.
  if flag = 'notifications' and not enabled then
    update remhaos_channel.notification_outbox o
    set state = 'cancelled', failure_code = 'notifications_disabled', lease_expires_at = null
    where o.organization_id = v_context.organization_id
      and o.project_id = project_id
      and o.state in ('pending', 'retry');
  end if;
  return remhaos_channel._envelope(jsonb_build_object(
    'projectId', project_id, 'flag', flag, 'enabled', enabled
  ));
end
$function$;

create function remhaos_channel_api.list_bridge_flags(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(project_id, 'manage_project_integrations');
  return remhaos_channel._envelope(jsonb_build_object(
    'bridge', remhaos_channel._bridge_flag_enabled(v_context.organization_id, project_id, 'bridge'),
    'attachments', remhaos_channel._bridge_flag_enabled(v_context.organization_id, project_id, 'attachments'),
    'notifications', remhaos_channel._bridge_flag_enabled(v_context.organization_id, project_id, 'notifications')
  ));
end
$function$;

-- === 1. Атрибуция отправителя ==============================================

alter table remhaos_channel.channel_events
  add column sender_user_id uuid,
  add column sender_attribution text not null default 'none'
    check (sender_attribution in ('verified_member', 'linked_non_member', 'unlinked', 'none'));

create function remhaos_channel._attribute_sender(
  p_organization_id uuid, p_project_id uuid, p_external_sender_id bigint
)
returns table (user_id uuid, attribution text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid;
begin
  if p_external_sender_id is null then
    return query select null::uuid, 'none'::text;
    return;
  end if;
  select cil.user_id into v_user
  from remhaos_channel.channel_identity_links cil
  where cil.provider = 'telegram'
    and cil.external_user_id = p_external_sender_id
    and cil.revoked_at is null;
  if v_user is null then
    return query select null::uuid, 'unlinked'::text;
    return;
  end if;
  if exists (
    select 1
    from projectceo_foundation.project_memberships pm
    join project_intelligence.organization_members om
      on om.organization_id = pm.organization_id
     and om.user_id = pm.user_id
     and om.status = 'active'
    where pm.organization_id = p_organization_id
      and pm.project_id = p_project_id
      and pm.user_id = v_user
      and pm.status = 'active'
  ) then
    return query select v_user, 'verified_member'::text;
  else
    return query select v_user, 'linked_non_member'::text;
  end if;
end
$function$;

-- Приём: прежний контракт (20260811070000) + флаг «мост» проекта + атрибуция.
create or replace function remhaos_channel_api.ingest_channel_update(
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
  v_sender record;
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
    and b.status = 'active'
    and b.capture_state = 'full_after_notice';

  if not found then
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', false,
      'reason', 'capture_not_open'
    ));
  end if;

  -- DEC-044 (c): мост проекта по умолчанию выключен.
  if not remhaos_channel._bridge_flag_enabled(
    v_binding.organization_id, v_binding.project_id, 'bridge'
  ) then
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', false,
      'reason', 'bridge_disabled_for_project'
    ));
  end if;

  select e.event_id into v_existing
  from remhaos_channel.channel_events e
  where e.provider = 'telegram'
    and e.bot_instance_id = bot_instance_id
    and e.update_id = update_id;
  if v_existing is not null then
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', true, 'duplicate', true, 'eventId', v_existing
    ));
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_binding.binding_id::text || u&'\001f' || external_chat_id::text
        || u&'\001f' || coalesce(external_message_id, -1)::text,
      0
    )
  );

  select coalesce(max(e.source_revision), 0) + 1 into v_revision
  from remhaos_channel.channel_events e
  where e.binding_id = v_binding.binding_id
    and e.external_chat_id = external_chat_id
    and e.external_message_id is not distinct from external_message_id;

  select * into v_sender
  from remhaos_channel._attribute_sender(
    v_binding.organization_id, v_binding.project_id, external_sender_id
  );

  insert into remhaos_channel.channel_events (
    organization_id, project_id, binding_id, provider, bot_instance_id,
    update_id, external_chat_id, external_message_id, source_revision,
    external_sender_id, event_kind, external_sent_at, reply_to_message_id,
    forward_origin_kind, payload, sender_user_id, sender_attribution
  )
  values (
    v_binding.organization_id, v_binding.project_id, v_binding.binding_id,
    'telegram', bot_instance_id, update_id, external_chat_id,
    external_message_id, v_revision, external_sender_id, event_kind,
    external_sent_at, reply_to_message_id, forward_origin_kind, payload,
    v_sender.user_id, v_sender.attribution
  )
  returning event_id into v_event_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'stored', true,
    'duplicate', false,
    'eventId', v_event_id,
    'projectId', v_binding.project_id,
    'sourceRevision', v_revision,
    'senderAttribution', v_sender.attribution
  ));
exception
  when unique_violation then
    select e.event_id into v_existing
    from remhaos_channel.channel_events e
    where e.provider = 'telegram'
      and e.bot_instance_id = bot_instance_id
      and e.update_id = update_id;
    if v_existing is null then
      perform projectceo_foundation._raise(
        'P1109', 'scope_conflict', '{"reason":"SOURCE_REVISION_CONFLICT"}'::jsonb
      );
    end if;
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', true, 'duplicate', true, 'eventId', v_existing
    ));
end
$function$;

-- === 2. Журнал привязки =====================================================

create table remhaos_channel.project_channel_binding_events (
  event_id bigint generated always as identity primary key,
  binding_id uuid not null
    references remhaos_channel.project_channel_bindings (binding_id) on delete restrict,
  event_type text not null check (event_type in ('created', 'status_changed', 'chat_migrated')),
  from_status text,
  to_status text,
  from_chat_id bigint,
  to_chat_id bigint,
  update_id bigint,
  reason text check (reason is null or char_length(reason) between 1 and 200),
  created_at timestamptz not null default statement_timestamp()
);

create unique index project_channel_binding_events_migration_update
  on remhaos_channel.project_channel_binding_events (binding_id, update_id)
  where event_type = 'chat_migrated';

create function remhaos_channel._record_binding_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into remhaos_channel.project_channel_binding_events (
      binding_id, event_type, to_status, to_chat_id
    ) values (new.binding_id, 'created', new.status, new.external_chat_id);
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into remhaos_channel.project_channel_binding_events (
      binding_id, event_type, from_status, to_status, from_chat_id, to_chat_id, reason
    ) values (
      new.binding_id, 'status_changed', old.status, new.status,
      old.external_chat_id, new.external_chat_id, new.status_reason
    );
  end if;
  -- Единственный писатель номера чата — migrate_channel_binding: он и ставит
  -- update_id. Иной путь смены номера сюда тоже попадёт, но без update_id.
  if new.external_chat_id is distinct from old.external_chat_id then
    insert into remhaos_channel.project_channel_binding_events (
      binding_id, event_type, from_status, to_status, from_chat_id, to_chat_id,
      update_id, reason
    ) values (
      new.binding_id, 'chat_migrated', old.status, new.status,
      old.external_chat_id, new.external_chat_id,
      nullif(pg_catalog.current_setting('remhaos_channel.migration_update_id', true), '')::bigint,
      'telegram_chat_migration'
    );
  end if;
  return null;
end
$function$;

create trigger project_channel_bindings_journal
  after insert or update on remhaos_channel.project_channel_bindings
  for each row execute function remhaos_channel._record_binding_change();

create function remhaos_channel._reject_binding_event_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception using errcode = '55000', message = 'BINDING_EVENT_IMMUTABLE';
end
$function$;

create trigger project_channel_binding_events_append_only
  before update or delete on remhaos_channel.project_channel_binding_events
  for each row execute function remhaos_channel._reject_binding_event_mutation();

-- Уже существующие привязки получают исходную запись журнала.
insert into remhaos_channel.project_channel_binding_events (
  binding_id, event_type, to_status, to_chat_id, reason
)
select b.binding_id, 'created', b.status, b.external_chat_id, 'journal_backfill'
from remhaos_channel.project_channel_bindings b;

-- === 3. Смена номера чата ===================================================

create function remhaos_channel_api.migrate_channel_binding(
  bot_instance_id text,
  update_id bigint,
  old_chat_id bigint,
  new_chat_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding remhaos_channel.project_channel_bindings;
begin
  if old_chat_id is null or new_chat_id is null or old_chat_id = new_chat_id
     or update_id is null or bot_instance_id is null then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"chatMigration"}'::jsonb);
  end if;
  -- Оба служебных сообщения (в старом и в новом чате) приходят отдельно и в
  -- любом порядке; оба ведут сюда. Сериализация по паре чатов.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'telegram-chat-migration:' || bot_instance_id || ':' || least(old_chat_id, new_chat_id)::text
      || ':' || greatest(old_chat_id, new_chat_id)::text, 0));

  -- Уже перенесено (повтор этого или парного сообщения).
  select b.* into v_binding
  from remhaos_channel.project_channel_bindings b
  where b.provider = 'telegram' and b.bot_instance_id = bot_instance_id
    and b.external_chat_id = new_chat_id
    and b.status in ('pending', 'notice_pending', 'active')
    and exists (
      select 1 from remhaos_channel.project_channel_binding_events e
      where e.binding_id = b.binding_id and e.event_type = 'chat_migrated'
        and e.from_chat_id = old_chat_id and e.to_chat_id = new_chat_id
    );
  if found then
    return remhaos_channel._envelope(jsonb_build_object(
      'migrated', true, 'duplicate', true, 'bindingId', v_binding.binding_id
    ));
  end if;

  select b.* into v_binding
  from remhaos_channel.project_channel_bindings b
  where b.provider = 'telegram' and b.bot_instance_id = bot_instance_id
    and b.external_chat_id = old_chat_id
    and b.status in ('pending', 'notice_pending', 'active')
  for update;
  if not found then
    return remhaos_channel._envelope(jsonb_build_object('migrated', false, 'reason', 'chat_not_bound'));
  end if;
  if exists (
    select 1 from remhaos_channel.project_channel_bindings b
    where b.provider = 'telegram' and b.bot_instance_id = bot_instance_id
      and b.external_chat_id = new_chat_id
      and b.status in ('pending', 'notice_pending', 'active')
  ) then
    -- Новый номер уже занят другой живой привязкой: переносить нельзя,
    -- сообщать оператору (журнал не пишется — переноса не было).
    return remhaos_channel._envelope(jsonb_build_object('migrated', false, 'reason', 'target_chat_bound'));
  end if;

  perform pg_catalog.set_config('remhaos_channel.migration_update_id', update_id::text, true);
  update remhaos_channel.project_channel_bindings b
  set external_chat_id = new_chat_id,
      external_chat_type = 'supergroup'
  where b.binding_id = v_binding.binding_id;
  perform pg_catalog.set_config('remhaos_channel.migration_update_id', '', true);

  return remhaos_channel._envelope(jsonb_build_object(
    'migrated', true, 'duplicate', false, 'bindingId', v_binding.binding_id,
    'fromChatId', old_chat_id, 'toChatId', new_chat_id
  ));
end
$function$;

-- === 4. Вложения ============================================================

alter table remhaos_channel.channel_attachments
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column file_intake_id uuid,
  add column rejection_code text
    check (rejection_code is null or char_length(rejection_code) between 1 and 80);

create function remhaos_channel_api.record_channel_attachments(
  event_id uuid,
  attachments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_event remhaos_channel.channel_events;
  v_item jsonb;
  v_recorded integer := 0;
begin
  if attachments is null or jsonb_typeof(attachments) <> 'array'
     or jsonb_array_length(attachments) > 20 then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"attachments"}'::jsonb);
  end if;
  select e.* into v_event from remhaos_channel.channel_events e where e.event_id = event_id;
  if not found then
    perform projectceo_foundation._raise('P1104', 'not_found', '{"entity":"channelEvent"}'::jsonb);
  end if;
  if not remhaos_channel._bridge_flag_enabled(v_event.organization_id, v_event.project_id, 'attachments') then
    return remhaos_channel._envelope(jsonb_build_object(
      'recorded', 0, 'reason', 'attachments_disabled_for_project'
    ));
  end if;
  for v_item in select value from jsonb_array_elements(attachments) loop
    if jsonb_typeof(v_item->'fileId') is distinct from 'string'
       or jsonb_typeof(v_item->'fileUniqueId') is distinct from 'string'
       or coalesce(v_item->>'kind', '') not in ('photo', 'document', 'voice', 'video') then
      perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"attachments.item"}'::jsonb);
    end if;
    insert into remhaos_channel.channel_attachments (
      organization_id, project_id, event_id, attachment_kind, external_file_id,
      external_file_unique_id, claimed_size_bytes, claimed_media_type
    ) values (
      v_event.organization_id, v_event.project_id, v_event.event_id, v_item->>'kind',
      v_item->>'fileId', v_item->>'fileUniqueId',
      case when jsonb_typeof(v_item->'claimedSizeBytes') = 'number'
        then (v_item->>'claimedSizeBytes')::bigint end,
      nullif(left(coalesce(v_item->>'claimedMediaType', ''), 200), '')
    )
    on conflict on constraint channel_attachments_file_key do nothing;
    if found then v_recorded := v_recorded + 1; end if;
  end loop;
  return remhaos_channel._envelope(jsonb_build_object('recorded', v_recorded));
end
$function$;

create function remhaos_channel_api.claim_channel_attachments(
  max_rows integer default 10,
  lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_token uuid := extensions.gen_random_uuid();
  v_data jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 50 then
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"maxRows"}'::jsonb);
  end if;
  -- Пятая попытка, чья аренда истекла без итога (воркер упал), больше не
  -- выдаётся — и не должна висеть в `pending` вечно: отказ с кодом.
  update remhaos_channel.channel_attachments a
  set scan_status = 'rejected', rejection_code = 'attempts_exhausted',
      scan_completed_at = statement_timestamp(), lease_token = null, lease_expires_at = null
  where a.scan_status = 'pending' and a.attempt_count >= 5
    and (a.lease_token is null or a.lease_expires_at <= statement_timestamp());
  with due as (
    select a.attachment_id
    from remhaos_channel.channel_attachments a
    where a.scan_status = 'pending'
      and (a.lease_token is null or a.lease_expires_at <= statement_timestamp())
      and a.attempt_count < 5
      and remhaos_channel._bridge_flag_enabled(a.organization_id, a.project_id, 'attachments')
    order by a.created_at
    limit max_rows
    for update of a skip locked
  ), claimed as (
    update remhaos_channel.channel_attachments a
    set lease_token = v_token,
        lease_expires_at = statement_timestamp() + make_interval(secs => greatest(coalesce(lease_seconds, 120), 10)),
        attempt_count = a.attempt_count + 1
    from due where a.attachment_id = due.attachment_id
    returning a.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'attachmentId', c.attachment_id,
    'projectId', c.project_id,
    'kind', c.attachment_kind,
    'fileId', c.external_file_id,
    'fileUniqueId', c.external_file_unique_id,
    'claimedSizeBytes', c.claimed_size_bytes,
    'claimedMediaType', c.claimed_media_type,
    'attemptCount', c.attempt_count,
    'leaseToken', c.lease_token
  ) order by c.created_at), '[]'::jsonb) into v_data
  from claimed c;
  return remhaos_channel._envelope(v_data);
end
$function$;

create function remhaos_channel_api.complete_channel_attachment(
  attachment_id uuid,
  lease_token uuid,
  outcome text,
  file_intake_id uuid,
  server_sha256_hex text,
  storage_locator text,
  rejection_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_row remhaos_channel.channel_attachments;
begin
  select a.* into v_row from remhaos_channel.channel_attachments a
  where a.attachment_id = attachment_id for update;
  if not found then
    perform projectceo_foundation._raise('P1104', 'not_found', '{"entity":"channelAttachment"}'::jsonb);
  end if;
  -- Итог принимается только от держателя аренды: воркер, у которого работу
  -- забрали, ничего не подтверждает.
  if v_row.lease_token is distinct from lease_token or v_row.scan_status <> 'pending' then
    return remhaos_channel._envelope(jsonb_build_object('completed', false, 'reason', 'lease_lost'));
  end if;
  if outcome = 'scan_pending' then
    if file_intake_id is null or coalesce(server_sha256_hex !~ '^[0-9a-f]{64}$', true)
       or storage_locator is null or char_length(storage_locator) not between 1 and 400 then
      perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"quarantine"}'::jsonb);
    end if;
    update remhaos_channel.channel_attachments a
    set scan_status = 'scanning', file_intake_id = file_intake_id,
        server_sha256 = decode(server_sha256_hex, 'hex'), storage_locator = storage_locator,
        lease_token = null, lease_expires_at = null
    where a.attachment_id = v_row.attachment_id;
  elsif outcome = 'rejected' then
    if coalesce(rejection_code !~ '^[a-z0-9_]{1,80}$', true) then
      perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"rejectionCode"}'::jsonb);
    end if;
    update remhaos_channel.channel_attachments a
    set scan_status = 'rejected', rejection_code = rejection_code,
        scan_completed_at = statement_timestamp(), lease_token = null, lease_expires_at = null
    where a.attachment_id = v_row.attachment_id;
  elsif outcome = 'release' then
    -- Работа не выполнялась (сбой инфраструктуры, остановка прохода):
    -- попытка возвращается, файл не приближается к отказу.
    update remhaos_channel.channel_attachments a
    set lease_token = null, lease_expires_at = null,
        attempt_count = greatest(a.attempt_count - 1, 0)
    where a.attachment_id = v_row.attachment_id;
  elsif outcome = 'retry' then
    update remhaos_channel.channel_attachments a
    set lease_token = null, lease_expires_at = null,
        rejection_code = case when a.attempt_count >= 5 then 'attempts_exhausted' else a.rejection_code end,
        scan_status = case when a.attempt_count >= 5 then 'rejected' else a.scan_status end
    where a.attachment_id = v_row.attachment_id;
  else
    perform projectceo_foundation._raise('P1111', 'validation_failed', '{"field":"outcome"}'::jsonb);
  end if;
  return remhaos_channel._envelope(jsonb_build_object('completed', true, 'outcome', outcome));
end
$function$;

-- === Уведомления: только для проектов с включённым флагом ===================

create or replace function remhaos_channel_api.claim_notification_batch(
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
  v_token uuid := extensions.gen_random_uuid();
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
    where b.status = 'active'
      -- DEC-044 (c): уведомления проекта по умолчанию выключены.
      and remhaos_channel._bridge_flag_enabled(b.organization_id, b.project_id, 'notifications')
      and (
        (o.state in ('pending', 'retry') and o.next_attempt_at <= statement_timestamp())
        or (o.state = 'sending'
            and o.lease_expires_at is not null
            and o.lease_expires_at <= statement_timestamp())
      )
    order by o.next_attempt_at
    limit max_rows
    for update of o skip locked
  ), claimed as (
    update remhaos_channel.notification_outbox o
    set state = 'sending',
      attempt_count = o.attempt_count + 1,
      lease_token = v_token,
      lease_expires_at = statement_timestamp()
        + make_interval(secs => greatest(coalesce(lease_seconds, 60), 5))
    from due
    where o.notification_id = due.notification_id
    returning o.notification_id, o.binding_id, o.payload, o.template_version,
      o.attempt_count, o.lease_token
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'notificationId', c.notification_id,
    'bindingId', c.binding_id,
    'templateVersion', c.template_version,
    'attemptCount', c.attempt_count,
    'leaseToken', c.lease_token,
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

-- Постановка в очередь: прежний контракт (20260811050000) + флаг «уведомления».
create or replace function remhaos_channel_api.enqueue_notification(
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

  -- DEC-044 (c): при выключенных уведомлениях очередь не копится — иначе
  -- включение флага вывалило бы в группу накопленные устаревшие сообщения.
  if not remhaos_channel._bridge_flag_enabled(v_organization_id, project_id, 'notifications') then
    return remhaos_channel._envelope(jsonb_build_object(
      'queued', false, 'reason', 'notifications_disabled_for_project'
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

-- === Перенос текущего поведения ============================================
-- Привязки, живые на момент миграции, до неё работали под глобальным env-флагом.
-- Им включаются «мост» и «уведомления» — с записью в журнал флагов, чтобы
-- обновление не выключило молча работающие группы. «Файлы» не включаются:
-- до TG2 вложения вообще не принимались.
insert into remhaos_channel.bridge_scope_flags (
  organization_id, project_id, flag, enabled, changed_by_user_id
)
select distinct on (b.organization_id, b.project_id, flag.name)
  b.organization_id, b.project_id, flag.name, true, null::uuid
from remhaos_channel.project_channel_bindings b
cross join (values ('bridge'), ('notifications')) flag(name)
where b.status in ('pending', 'notice_pending', 'active')
order by b.organization_id, b.project_id, flag.name, b.created_at desc
on conflict (organization_id, project_id, flag) do nothing;

-- Автор — система (перенос), а не инициатор связи: он этого решения не
-- принимал. Владелец может выключить флаги штатно, и это будет в журнале.
insert into remhaos_channel.bridge_scope_flag_events (
  organization_id, project_id, flag, enabled, changed_by_user_id, actor, reason
)
select f.organization_id, f.project_id, f.flag, f.enabled, null, 'system:migration',
  'migration_backfill_existing_binding'
from remhaos_channel.bridge_scope_flags f;

-- === Владение, RLS, гранты ==================================================

do $own$
declare
  v_table text;
  v_signature text;
begin
  foreach v_table in array array['bridge_scope_flags', 'bridge_scope_flag_events',
                                 'project_channel_binding_events'] loop
    execute pg_catalog.format('alter table remhaos_channel.%I owner to pi_table_owner', v_table);
    execute pg_catalog.format('alter table remhaos_channel.%I enable row level security', v_table);
    execute pg_catalog.format('alter table remhaos_channel.%I force row level security', v_table);
    execute pg_catalog.format(
      'revoke all on table remhaos_channel.%I from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_table);
    execute pg_catalog.format(
      'create policy %I on remhaos_channel.%I for all to pi_table_owner using (true) with check (true)',
      v_table || '_internal_owner', v_table);
  end loop;

  foreach v_signature in array array[
    'remhaos_channel._bridge_flag_enabled(uuid, uuid, text)',
    'remhaos_channel._attribute_sender(uuid, uuid, bigint)',
    'remhaos_channel._record_binding_change()',
    'remhaos_channel._reject_binding_event_mutation()',
    'remhaos_channel._reject_flag_event_mutation()'
  ] loop
    execute pg_catalog.format('alter function %s owner to pi_table_owner', v_signature);
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
  end loop;

  -- Человеческие двери: интерфейс настройки моста, только authenticated.
  -- Порядок «человеческие, затем системные» — соглашение сверки матрицы
  -- (tests/projectceo-integration/telegram-bridge-surface.test.ts).
  foreach v_signature in array array[
    'remhaos_channel_api.set_bridge_flag(uuid, text, boolean, text)',
    'remhaos_channel_api.list_bridge_flags(uuid)'
  ] loop
    execute pg_catalog.format('alter function %s owner to pi_table_owner', v_signature);
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
    execute pg_catalog.format('grant execute on function %s to authenticated', v_signature);
  end loop;

  -- Системные двери: webhook и фоновые процессы, только service_role.
  foreach v_signature in array array[
    'remhaos_channel_api.migrate_channel_binding(text, bigint, bigint, bigint)',
    'remhaos_channel_api.record_channel_attachments(uuid, jsonb)',
    'remhaos_channel_api.claim_channel_attachments(integer, integer)',
    'remhaos_channel_api.complete_channel_attachment(uuid, uuid, text, uuid, text, text, text)'
  ] loop
    execute pg_catalog.format('alter function %s owner to pi_table_owner', v_signature);
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
    execute pg_catalog.format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$own$;

commit;
