\set ON_ERROR_STOP on

-- TG2 моста A7 (миграция 20260928110000; DEC-041 §5, DEC-043 (c), DEC-044).
--
-- 1. Поверхность: системные двери TG2 — только service_role, человеческие —
--    только authenticated.
-- 2. Флаги проекта: по умолчанию выключены, включает владелец с
--    manage_project_integrations, каждое изменение — в журнале; выключенный
--    «мост» не принимает сообщений, выключенные «уведомления» не выдают
--    очередь.
-- 3. Атрибуция отправителя: связанный участник проекта — verified_member,
--    чужой Telegram — unlinked.
-- 4. Смена номера чата: перенос автоматический, повтор и парное сообщение не
--    пишут второй записи, журнал привязки append-only.
-- 5. Вложения: метаданные → аренда → карантин file intake (scan_pending) →
--    итог только от держателя аренды.

\set project_a '41111111-1111-4111-8111-111111111111'
\set owner_a '31111111-1111-4111-8111-111111111111'

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Поверхность
-- ─────────────────────────────────────────────────────────────────────────────

do $tg2_surface$
declare
  v_leak text;
begin
  -- Системные двери TG2: только service_role.
  select signature into v_leak
  from unnest(array[
    'remhaos_channel_api.migrate_channel_binding(text, bigint, bigint, bigint)',
    'remhaos_channel_api.record_channel_attachments(uuid, jsonb)',
    'remhaos_channel_api.claim_channel_attachments(integer, integer)',
    'remhaos_channel_api.complete_channel_attachment(uuid, uuid, text, uuid, text, text, text)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('pi_worker_executor', signature, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  limit 1;
  if v_leak is not null then
    raise exception 'DB4_TG2_SYSTEM_SURFACE:%', v_leak;
  end if;

  -- Человеческие: только authenticated.
  select signature into v_leak
  from unnest(array[
    'remhaos_channel_api.set_bridge_flag(uuid, text, boolean, text)',
    'remhaos_channel_api.list_bridge_flags(uuid)'
  ]) signature
  where pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_leak is not null then
    raise exception 'DB4_TG2_HUMAN_SURFACE:%', v_leak;
  end if;

  -- Внутренние функции и таблицы — никому из API-ролей.
  if pg_catalog.has_function_privilege('service_role',
       'remhaos_channel._bridge_flag_enabled(uuid, uuid, text)', 'EXECUTE')
     or pg_catalog.has_table_privilege('service_role',
       'remhaos_channel.bridge_scope_flags', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated',
       'remhaos_channel.project_channel_binding_events', 'SELECT') then
    raise exception 'DB4_TG2_PRIVATE_REACHABLE';
  end if;

  -- Флаг, которого нет, — выключен.
  if remhaos_channel._bridge_flag_enabled(
       extensions.gen_random_uuid(), extensions.gen_random_uuid(), 'bridge') then
    raise exception 'DB4_TG2_ABSENT_FLAG_OPEN';
  end if;
end
$tg2_surface$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Свежий чат проекта A
-- ─────────────────────────────────────────────────────────────────────────────

-- Предыдущие сценарии могли оставить живую связь: снимаем её штатной дверью.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
do $tg2_release$
begin
  perform remhaos_channel_api.disconnect_project_channel(
    '41111111-1111-4111-8111-111111111111', 'db4-tg2-reset');
exception when others then null;
end
$tg2_release$;
select remhaos_channel_api.create_binding_intent(
  :'project_a'::uuid,
  pg_catalog.sha256(convert_to('db4-tg2-nonce', 'UTF8')),
  600
);
commit;

begin;
set local role service_role;
select remhaos_channel_api.activate_project_binding(
  pg_catalog.sha256(convert_to('db4-tg2-nonce', 'UTF8')),
  777001, 'db4-bot', -100850, 'group', 'notice-v1', true, true
);
commit;

select binding_id::text as tg2_binding
from remhaos_channel.project_channel_bindings
where project_id = :'project_a'::uuid and external_chat_id = -100850
  and status = 'notice_pending' \gset

begin;
set local role service_role;
select remhaos_channel_api.mark_channel_notice_posted(:'tg2_binding'::uuid, 'notice-v1', true, true);
commit;

-- Журнал привязки записал рождение связи и её переходы.
do $tg2_binding_journal$
begin
  if not exists (
    select 1 from remhaos_channel.project_channel_binding_events e
    join remhaos_channel.project_channel_bindings b using (binding_id)
    where b.external_chat_id = -100850 and e.event_type = 'created'
  ) then
    raise exception 'DB4_TG2_BINDING_CREATED_NOT_JOURNALED';
  end if;
  if not exists (
    select 1 from remhaos_channel.project_channel_binding_events e
    join remhaos_channel.project_channel_bindings b using (binding_id)
    where b.external_chat_id = -100850 and e.event_type = 'status_changed'
      and e.to_status = 'active'
  ) then
    raise exception 'DB4_TG2_BINDING_ACTIVATION_NOT_JOURNALED';
  end if;
end
$tg2_binding_journal$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Флаги
-- ─────────────────────────────────────────────────────────────────────────────

-- Посторонний пользователь флагом не управляет.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '39999999-9999-4999-8999-999999999999';
do $tg2_flag_stranger$
begin
  perform remhaos_channel_api.set_bridge_flag(
    '41111111-1111-4111-8111-111111111111', 'attachments', true, 'probe');
  raise exception 'DB4_TG2_STRANGER_SET_FLAG';
exception when others then
  if sqlerrm like 'DB4_%' then raise; end if;
end
$tg2_flag_stranger$;
rollback;

-- «Мост» выключен владельцем → сообщение не сохраняется.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.set_bridge_flag(:'project_a'::uuid, 'bridge', false, 'db4 off');
commit;

begin;
set local role service_role;
do $tg2_bridge_off$
declare
  v_result jsonb;
begin
  v_result := remhaos_channel_api.ingest_channel_update(
    'db4-bot', 8500, -100850, 850, 'message', 777001, null, null, null,
    '{"kind":"message","text":"при выключенном мосте","attachmentCount":0}'::jsonb
  ) -> 'data';
  if (v_result ->> 'stored')::boolean or v_result ->> 'reason' <> 'bridge_disabled_for_project' then
    raise exception 'DB4_TG2_BRIDGE_OFF_STORED:%', v_result;
  end if;
end
$tg2_bridge_off$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.set_bridge_flag(:'project_a'::uuid, 'bridge', true, 'db4 on');
do $tg2_list_flags$
declare
  v_flags jsonb;
begin
  v_flags := remhaos_channel_api.list_bridge_flags('41111111-1111-4111-8111-111111111111') -> 'data';
  if v_flags ->> 'bridge' <> 'true' or v_flags ->> 'attachments' <> 'false' then
    raise exception 'DB4_TG2_FLAGS_UNEXPECTED:%', v_flags;
  end if;
end
$tg2_list_flags$;
commit;

do $tg2_flag_journal$
declare
  v_count int;
begin
  select count(*) into v_count
  from remhaos_channel.bridge_scope_flag_events
  where project_id = '41111111-1111-4111-8111-111111111111'
    and flag = 'bridge'
    and changed_by_user_id = '31111111-1111-4111-8111-111111111111'
    and reason in ('db4 off', 'db4 on');
  if v_count <> 2 then
    raise exception 'DB4_TG2_FLAG_JOURNAL_EXPECTED_2_GOT_%', v_count;
  end if;
end
$tg2_flag_journal$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Атрибуция отправителя
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 8501, -100850, 851, 'message', 777001, null, null, null,
  '{"kind":"message","text":"от владельца","attachmentCount":0}'::jsonb
);
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 8502, -100850, 852, 'message', 990000001, null, null, null,
  '{"kind":"message","text":"от незнакомца","attachmentCount":0}'::jsonb
);
commit;

do $tg2_attribution$
declare
  v_owner record;
  v_stranger record;
begin
  select sender_user_id, sender_attribution into v_owner
  from remhaos_channel.channel_events where bot_instance_id = 'db4-bot' and update_id = 8501;
  select sender_user_id, sender_attribution into v_stranger
  from remhaos_channel.channel_events where bot_instance_id = 'db4-bot' and update_id = 8502;
  if v_owner.sender_attribution <> 'verified_member'
     or v_owner.sender_user_id <> '31111111-1111-4111-8111-111111111111' then
    raise exception 'DB4_TG2_OWNER_ATTRIBUTION:%/%', v_owner.sender_attribution, v_owner.sender_user_id;
  end if;
  if v_stranger.sender_attribution <> 'unlinked' or v_stranger.sender_user_id is not null then
    raise exception 'DB4_TG2_STRANGER_ATTRIBUTION:%', v_stranger.sender_attribution;
  end if;
end
$tg2_attribution$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Смена номера чата (группа → супергруппа)
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
do $tg2_migration$
declare
  v_first jsonb;
  v_replay jsonb;
  v_pair jsonb;
  v_unbound jsonb;
begin
  v_first := remhaos_channel_api.migrate_channel_binding('db4-bot', 8510, -100850, -1008500) -> 'data';
  if not (v_first ->> 'migrated')::boolean or (v_first ->> 'duplicate')::boolean then
    raise exception 'DB4_TG2_MIGRATION_FIRST:%', v_first;
  end if;
  -- Повтор того же update и парное сообщение из нового чата — без второго переноса.
  v_replay := remhaos_channel_api.migrate_channel_binding('db4-bot', 8510, -100850, -1008500) -> 'data';
  v_pair := remhaos_channel_api.migrate_channel_binding('db4-bot', 8511, -100850, -1008500) -> 'data';
  if not (v_replay ->> 'duplicate')::boolean or not (v_pair ->> 'duplicate')::boolean then
    raise exception 'DB4_TG2_MIGRATION_REPLAY:%/%', v_replay, v_pair;
  end if;
  v_unbound := remhaos_channel_api.migrate_channel_binding('db4-bot', 8512, -100851, -1008510) -> 'data';
  if (v_unbound ->> 'migrated')::boolean or v_unbound ->> 'reason' <> 'chat_not_bound' then
    raise exception 'DB4_TG2_MIGRATION_UNBOUND:%', v_unbound;
  end if;
end
$tg2_migration$;
commit;

do $tg2_migration_state$
declare
  v_journal int;
begin
  if not exists (
    select 1 from remhaos_channel.project_channel_bindings
    where project_id = '41111111-1111-4111-8111-111111111111'
      and external_chat_id = -1008500 and external_chat_type = 'supergroup' and status = 'active'
  ) then
    raise exception 'DB4_TG2_MIGRATION_NOT_APPLIED';
  end if;
  select count(*) into v_journal
  from remhaos_channel.project_channel_binding_events
  where event_type = 'chat_migrated' and from_chat_id = -100850 and to_chat_id = -1008500;
  if v_journal <> 1 then
    raise exception 'DB4_TG2_MIGRATION_JOURNAL_EXPECTED_1_GOT_%', v_journal;
  end if;
  if not exists (
    select 1 from remhaos_channel.project_channel_binding_events
    where event_type = 'chat_migrated' and to_chat_id = -1008500 and update_id = 8510
  ) then
    raise exception 'DB4_TG2_MIGRATION_UPDATE_NOT_RECORDED';
  end if;

  -- Журнал append-only — для всех, включая владельца таблицы.
  begin
    update remhaos_channel.project_channel_binding_events set reason = 'tampered'
    where to_chat_id = -1008500;
    raise exception 'DB4_TG2_BINDING_JOURNAL_MUTABLE';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from remhaos_channel.project_channel_binding_events where to_chat_id = -1008500;
    raise exception 'DB4_TG2_BINDING_JOURNAL_DELETABLE';
  exception when sqlstate '55000' then null;
  end;
end
$tg2_migration_state$;

-- Новый номер принимает сообщения, старый — нет.
begin;
set local role service_role;
do $tg2_after_migration$
declare
  v_new jsonb;
  v_old jsonb;
begin
  v_new := remhaos_channel_api.ingest_channel_update(
    'db4-bot', 8520, -1008500, 860, 'message', 777001, null, null, null,
    '{"kind":"message","text":"после переноса","attachmentCount":1}'::jsonb
  ) -> 'data';
  v_old := remhaos_channel_api.ingest_channel_update(
    'db4-bot', 8521, -100850, 861, 'message', 777001, null, null, null,
    '{"kind":"message","text":"старый номер","attachmentCount":0}'::jsonb
  ) -> 'data';
  if not (v_new ->> 'stored')::boolean or (v_old ->> 'stored')::boolean then
    raise exception 'DB4_TG2_POST_MIGRATION_INGEST:%/%', v_new, v_old;
  end if;
  perform pg_catalog.set_config('db4.tg2_event', v_new ->> 'eventId', false);
end
$tg2_after_migration$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Вложения: метаданные → аренда → карантин → итог
-- ─────────────────────────────────────────────────────────────────────────────

-- «Файлы» по умолчанию выключены: запись метаданных ничего не создаёт.
begin;
set local role service_role;
do $tg2_attachments_off$
declare
  v_result jsonb;
begin
  v_result := remhaos_channel_api.record_channel_attachments(
    current_setting('db4.tg2_event')::uuid,
    '[{"kind":"document","fileId":"db4-file-1","fileUniqueId":"db4-uniq-1","claimedSizeBytes":16,"claimedMediaType":"application/pdf"}]'::jsonb
  ) -> 'data';
  if (v_result ->> 'recorded')::int <> 0 or v_result ->> 'reason' <> 'attachments_disabled_for_project' then
    raise exception 'DB4_TG2_ATTACHMENTS_OFF_RECORDED:%', v_result;
  end if;
end
$tg2_attachments_off$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.set_bridge_flag(:'project_a'::uuid, 'attachments', true, 'db4 files on');
commit;

begin;
set local role service_role;
do $tg2_attachments_record$
declare
  v_first jsonb;
  v_replay jsonb;
  v_claim jsonb;
  v_again jsonb;
begin
  v_first := remhaos_channel_api.record_channel_attachments(
    current_setting('db4.tg2_event')::uuid,
    '[{"kind":"document","fileId":"db4-file-1","fileUniqueId":"db4-uniq-1","claimedSizeBytes":16,"claimedMediaType":"application/pdf"},
      {"kind":"voice","fileId":"db4-file-2","fileUniqueId":"db4-uniq-2","claimedSizeBytes":8,"claimedMediaType":"audio/ogg"}]'::jsonb
  ) -> 'data';
  -- Повтор доставки webhook не плодит строк.
  v_replay := remhaos_channel_api.record_channel_attachments(
    current_setting('db4.tg2_event')::uuid,
    '[{"kind":"document","fileId":"db4-file-1","fileUniqueId":"db4-uniq-1"}]'::jsonb
  ) -> 'data';
  if (v_first ->> 'recorded')::int <> 2 or (v_replay ->> 'recorded')::int <> 0 then
    raise exception 'DB4_TG2_ATTACHMENTS_RECORD:%/%', v_first, v_replay;
  end if;

  v_claim := remhaos_channel_api.claim_channel_attachments(10, 120) -> 'data';
  if jsonb_array_length(v_claim) <> 2 then
    raise exception 'DB4_TG2_ATTACHMENTS_CLAIM_EXPECTED_2:%', v_claim;
  end if;
  -- Взятое в аренду второй раз не выдаётся.
  v_again := remhaos_channel_api.claim_channel_attachments(10, 120) -> 'data';
  if jsonb_array_length(v_again) <> 0 then
    raise exception 'DB4_TG2_ATTACHMENTS_DOUBLE_CLAIM:%', v_again;
  end if;
  perform pg_catalog.set_config('db4.tg2_claim', v_claim::text, false);
end
$tg2_attachments_record$;
commit;

-- Карантин через существующий file intake (идентичность воркера).
select value ->> 'attachmentId' as tg2_doc_id, value ->> 'leaseToken' as tg2_doc_lease
from jsonb_array_elements(current_setting('db4.tg2_claim')::jsonb)
where value ->> 'kind' = 'document' \gset
select value ->> 'attachmentId' as tg2_voice_id, value ->> 'leaseToken' as tg2_voice_lease
from jsonb_array_elements(current_setting('db4.tg2_claim')::jsonb)
where value ->> 'kind' = 'voice' \gset
select set_config('db4.tg2_doc_id', :'tg2_doc_id', false),
       set_config('db4.tg2_doc_lease', :'tg2_doc_lease', false),
       set_config('db4.tg2_voice_id', :'tg2_voice_id', false),
       set_config('db4.tg2_voice_lease', :'tg2_voice_lease', false);

begin;
set local role pi_worker_executor;
select (remhaos_integration_api.create_file_intake_worker(
  :'project_a'::uuid, 'telegram-db4-uniq-1.pdf', 'application/pdf', 'pdf', 16,
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'correspondence', 'telegram-attachment:' || :'tg2_doc_id'
) -> 'result') as tg2_intake \gset
commit;

select :'tg2_intake'::jsonb ->> 'intakeId' as tg2_intake_id,
       :'tg2_intake'::jsonb ->> 'objectKey' as tg2_object_key \gset
select set_config('db4.tg2_intake_id', :'tg2_intake_id', false),
       set_config('db4.tg2_object_key', :'tg2_object_key', false);

begin;
set local role pi_worker_executor;
select remhaos_integration_api.mark_file_intake_uploaded_worker(
  :'project_a'::uuid, :'tg2_intake_id'::uuid, 'telegram-attachment:' || :'tg2_doc_id' || ':uploaded'
);
commit;

begin;
set local role service_role;
do $tg2_attachment_complete$
declare
  v_stale jsonb;
  v_done jsonb;
  v_rejected jsonb;
begin
  -- Чужая аренда ничего не подтверждает.
  v_stale := remhaos_channel_api.complete_channel_attachment(
    current_setting('db4.tg2_doc_id')::uuid, '00000000-0000-4000-8000-0000000000aa'::uuid, 'scan_pending',
    current_setting('db4.tg2_intake_id')::uuid,
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    current_setting('db4.tg2_object_key'), null
  ) -> 'data';
  if (v_stale ->> 'completed')::boolean or v_stale ->> 'reason' <> 'lease_lost' then
    raise exception 'DB4_TG2_STALE_LEASE_COMPLETED:%', v_stale;
  end if;
  v_done := remhaos_channel_api.complete_channel_attachment(
    current_setting('db4.tg2_doc_id')::uuid, current_setting('db4.tg2_doc_lease')::uuid,
    'scan_pending', current_setting('db4.tg2_intake_id')::uuid,
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    current_setting('db4.tg2_object_key'), null
  ) -> 'data';
  -- Голосовое сообщение политикой file intake не принимается.
  v_rejected := remhaos_channel_api.complete_channel_attachment(
    current_setting('db4.tg2_voice_id')::uuid, current_setting('db4.tg2_voice_lease')::uuid,
    'rejected', null, null, null, 'unsupported_extension'
  ) -> 'data';
  if not (v_done ->> 'completed')::boolean or not (v_rejected ->> 'completed')::boolean then
    raise exception 'DB4_TG2_COMPLETE:%/%', v_done, v_rejected;
  end if;
end
$tg2_attachment_complete$;
commit;

do $tg2_attachment_state$
declare
  v_doc remhaos_channel.channel_attachments;
  v_voice remhaos_channel.channel_attachments;
  v_intake_status text;
begin
  select * into v_doc from remhaos_channel.channel_attachments
  where attachment_id = current_setting('db4.tg2_doc_id')::uuid;
  select * into v_voice from remhaos_channel.channel_attachments
  where attachment_id = current_setting('db4.tg2_voice_id')::uuid;
  select status into v_intake_status from remhaos_integration.file_intakes
  where intake_id = current_setting('db4.tg2_intake_id')::uuid;
  if v_doc.scan_status <> 'scanning' or v_doc.file_intake_id is distinct from current_setting('db4.tg2_intake_id')::uuid
     or v_doc.server_sha256 is null or v_doc.lease_token is not null then
    raise exception 'DB4_TG2_DOC_STATE:%/%', v_doc.scan_status, v_doc.file_intake_id;
  end if;
  if v_intake_status <> 'scan_pending' then
    raise exception 'DB4_TG2_INTAKE_NOT_SCAN_PENDING:%', v_intake_status;
  end if;
  if v_voice.scan_status <> 'rejected' or v_voice.rejection_code <> 'unsupported_extension' then
    raise exception 'DB4_TG2_VOICE_STATE:%/%', v_voice.scan_status, v_voice.rejection_code;
  end if;
end
$tg2_attachment_state$;

-- DEC-045 (c): автор записей file intake для Telegram — воркер Telegram, а не
-- импорт Google Drive; прежний автор для остальных ключей не изменился.
do $tg2_intake_actor$
declare
  v_telegram_events int;
  v_other_events int;
  v_telegram_commands int;
begin
  select count(*) filter (where e.actor_id = 'system:telegram-attachment-worker'),
         count(*) filter (where e.actor_id <> 'system:telegram-attachment-worker')
    into v_telegram_events, v_other_events
  from remhaos_integration.file_intake_events e
  where e.intake_id = current_setting('db4.tg2_intake_id')::uuid;
  select count(*) into v_telegram_commands
  from remhaos_integration.command_records c
  where c.project_id = '41111111-1111-4111-8111-111111111111'
    and c.operation in ('create_file_intake_worker', 'mark_file_intake_uploaded_worker')
    and c.actor_type = 'system' and c.actor_id = 'system:telegram-attachment-worker';
  -- Три события (requested, uploaded, scan queued) и две команды — как у Drive.
  if v_telegram_events <> 3 or v_other_events <> 0 or v_telegram_commands <> 2 then
    raise exception 'DB4_TG2_INTAKE_ACTOR:%:%:%', v_telegram_events, v_other_events, v_telegram_commands;
  end if;
  if remhaos_integration._file_intake_worker_actor('dbig-worker-file-create') <> 'system:google-drive-import-worker'
     or remhaos_integration._file_intake_worker_actor('telegram-attachment:x') <> 'system:telegram-attachment-worker' then
    raise exception 'DB4_TG2_ACTOR_MAPPING';
  end if;
  if pg_catalog.has_function_privilege('service_role', 'remhaos_integration._file_intake_worker_actor(text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('pi_worker_executor', 'remhaos_integration._file_intake_worker_actor(text)', 'EXECUTE') then
    raise exception 'DB4_TG2_ACTOR_HELPER_EXPOSED';
  end if;
  -- DEC-045 (b): где есть логин-роль PostgREST, она может переключиться на воркера.
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator')
     and not pg_catalog.pg_has_role('authenticator', 'pi_worker_executor', 'MEMBER') then
    raise exception 'DB4_TG2_WORKER_IDENTITY_NOT_GRANTED';
  end if;
end
$tg2_intake_actor$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Аренда: исчерпанные попытки и возврат без списания (ревью TG2)
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
select remhaos_channel_api.record_channel_attachments(
  current_setting('db4.tg2_event')::uuid,
  '[{"kind":"document","fileId":"db4-file-3","fileUniqueId":"db4-uniq-3"},
    {"kind":"document","fileId":"db4-file-4","fileUniqueId":"db4-uniq-4"}]'::jsonb
);
commit;

-- Пятая попытка, чья аренда истекла без итога (воркер упал).
update remhaos_channel.channel_attachments
set attempt_count = 5,
    lease_token = '00000000-0000-4000-8000-0000000000bb',
    lease_expires_at = statement_timestamp() - interval '1 minute'
where external_file_unique_id = 'db4-uniq-3';

begin;
set local role service_role;
do $tg2_lease_rules$
declare
  v_claim jsonb;
  v_item jsonb;
  v_release jsonb;
begin
  v_claim := remhaos_channel_api.claim_channel_attachments(10, 120) -> 'data';
  if jsonb_array_length(v_claim) <> 1 or v_claim -> 0 ->> 'fileUniqueId' <> 'db4-uniq-4' then
    raise exception 'DB4_TG2_CLAIM_AFTER_SWEEP:%', v_claim;
  end if;
  v_item := v_claim -> 0;
  v_release := remhaos_channel_api.complete_channel_attachment(
    (v_item ->> 'attachmentId')::uuid, (v_item ->> 'leaseToken')::uuid,
    'release', null, null, null, null
  ) -> 'data';
  if not (v_release ->> 'completed')::boolean then
    raise exception 'DB4_TG2_RELEASE:%', v_release;
  end if;
end
$tg2_lease_rules$;
commit;

do $tg2_lease_state$
declare
  v_exhausted remhaos_channel.channel_attachments;
  v_released remhaos_channel.channel_attachments;
begin
  select * into v_exhausted from remhaos_channel.channel_attachments where external_file_unique_id = 'db4-uniq-3';
  select * into v_released from remhaos_channel.channel_attachments where external_file_unique_id = 'db4-uniq-4';
  if v_exhausted.scan_status <> 'rejected' or v_exhausted.rejection_code <> 'attempts_exhausted' then
    raise exception 'DB4_TG2_EXHAUSTED_STUCK:%/%', v_exhausted.scan_status, v_exhausted.rejection_code;
  end if;
  if v_released.scan_status <> 'pending' or v_released.attempt_count <> 0 or v_released.lease_token is not null then
    raise exception 'DB4_TG2_RELEASE_BURNED_ATTEMPT:%', v_released.attempt_count;
  end if;
end
$tg2_lease_state$;

-- Проверка без итога не проходит: NULL-хеш — ошибка, а не `scanning`.
begin;
set local role service_role;
do $tg2_null_hash$
declare
  v_item jsonb;
begin
  v_item := (remhaos_channel_api.claim_channel_attachments(10, 120) -> 'data') -> 0;
  begin
    perform remhaos_channel_api.complete_channel_attachment(
      (v_item ->> 'attachmentId')::uuid, (v_item ->> 'leaseToken')::uuid,
      'scan_pending', '00000000-0000-4000-8000-0000000000cc'::uuid, null, 'quarantine/x', null);
    raise exception 'DB4_TG2_NULL_HASH_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform remhaos_channel_api.record_channel_attachments(
      current_setting('db4.tg2_event')::uuid, '[{"kind":"document","fileUniqueId":"no-file-id"}]'::jsonb);
    raise exception 'DB4_TG2_MISSING_FILE_ID_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
end
$tg2_null_hash$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Уведомления: флаг закрывает и очередь, и выдачу
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
select remhaos_channel_api.enqueue_notification(
  :'project_a'::uuid, 'db4_tg2', 'db4-tg2-source-1', 'telegram-notice/1',
  '{"kind":"release_distributed","projectId":"41111111-1111-4111-8111-111111111111"}'::jsonb,
  'db4-tg2-notification-1'
);
commit;

-- Выключение снимает неотправленное: после включения старое не уйдёт.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.set_bridge_flag(:'project_a'::uuid, 'notifications', false, 'db4 quiet');
commit;

begin;
set local role service_role;
do $tg2_quiet$
declare
  v_enqueue jsonb;
  v_batch jsonb;
begin
  v_enqueue := remhaos_channel_api.enqueue_notification(
    '41111111-1111-4111-8111-111111111111', 'db4_tg2', 'db4-tg2-source-2', 'telegram-notice/1',
    '{"kind":"release_distributed","projectId":"41111111-1111-4111-8111-111111111111"}'::jsonb,
    'db4-tg2-notification-2'
  ) -> 'data';
  if (v_enqueue ->> 'queued')::boolean or v_enqueue ->> 'reason' <> 'notifications_disabled_for_project' then
    raise exception 'DB4_TG2_QUEUED_WHILE_OFF:%', v_enqueue;
  end if;
  v_batch := remhaos_channel_api.claim_notification_batch(50, 60) -> 'data';
  if exists (select 1 from jsonb_array_elements(v_batch) item
             where (item ->> 'externalChatId')::bigint = -1008500) then
    raise exception 'DB4_TG2_NOTIFICATION_CLAIMED_WHILE_OFF';
  end if;
end
$tg2_quiet$;
commit;

do $tg2_backlog_cancelled$
begin
  if not exists (
    select 1 from remhaos_channel.notification_outbox
    where idempotency_key = 'db4-tg2-notification-1' and state = 'cancelled'
      and failure_code = 'notifications_disabled'
  ) then
    raise exception 'DB4_TG2_BACKLOG_NOT_CANCELLED';
  end if;
end
$tg2_backlog_cancelled$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.set_bridge_flag(:'project_a'::uuid, 'notifications', true, 'db4 loud');
commit;

begin;
set local role service_role;
select remhaos_channel_api.enqueue_notification(
  :'project_a'::uuid, 'db4_tg2', 'db4-tg2-source-3', 'telegram-notice/1',
  '{"kind":"release_distributed","projectId":"41111111-1111-4111-8111-111111111111"}'::jsonb,
  'db4-tg2-notification-3'
);
do $tg2_loud$
declare
  v_batch jsonb;
begin
  v_batch := remhaos_channel_api.claim_notification_batch(50, 60) -> 'data';
  if (select count(*) from jsonb_array_elements(v_batch) item
      where (item ->> 'externalChatId')::bigint = -1008500) <> 1 then
    raise exception 'DB4_TG2_NOTIFICATION_CLAIM_WHEN_ON:%', v_batch;
  end if;
end
$tg2_loud$;
commit;

-- Журнал флагов append-only.
do $tg2_flag_journal_immutable$
begin
  begin
    update remhaos_channel.bridge_scope_flag_events set reason = 'tampered'
    where project_id = '41111111-1111-4111-8111-111111111111';
    raise exception 'DB4_TG2_FLAG_JOURNAL_MUTABLE';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from remhaos_channel.bridge_scope_flag_events
    where project_id = '41111111-1111-4111-8111-111111111111';
    raise exception 'DB4_TG2_FLAG_JOURNAL_DELETABLE';
  exception when sqlstate '55000' then null;
  end;
end
$tg2_flag_journal_immutable$;

-- Сценарий оставляет проект A без живой связи, как и нашёл предыдущие.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.disconnect_project_channel(:'project_a'::uuid, 'db4-tg2-cleanup');
commit;

\echo DB4_TELEGRAM_TG2_OK
