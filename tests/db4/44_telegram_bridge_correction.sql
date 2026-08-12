\set ON_ERROR_STOP on

-- Исправления фундамента моста (CORRECTIVE GO 11.08.2026, миграция
-- `20260811070000`).
--
-- Каждый блок ниже соответствует одному дефекту, который был в слитом коде и
-- который эта миграция закрывает. Проверяется поведение, а не форма: реальные
-- вызовы, реальные конфликты, реальные протухшие аренды.
--
-- Сценарий идёт ПОСЛЕ `43_telegram_inbox_vertical.sql`: к этому моменту проект
-- `4111…` уже связан с чатом `-100600`, и связь активна.

\set project_a '41111111-1111-4111-8111-111111111111'
\set project_b '42222222-2222-4222-8222-222222222222'
\set owner_a '31111111-1111-4111-8111-111111111111'
\set owner_b '33333333-3333-4333-8333-333333333333'
\set project_c '43333333-3333-4333-8333-333333333333'

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Один чат — один проект, даже через разных ботов
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Прежний индекс включал `bot_instance_id`, поэтому второй бот в том же чате
-- давал ВТОРУЮ активную связь с другим проектом, и переписка одной группы
-- расходилась по двум проектам.

-- Порядок обязателен: намерение подключить чат создаётся только тем, чей
-- Telegram-аккаунт уже связан. Сначала связь, потом намерение.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
select remhaos_channel_api.create_identity_link_intent(
  pg_catalog.sha256(convert_to('db4-correction-identity-b', 'UTF8')),
  600
);
commit;

begin;
set local role service_role;
select remhaos_channel_api.consume_identity_link_intent(
  pg_catalog.sha256(convert_to('db4-correction-identity-b', 'UTF8')),
  777002
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
select remhaos_channel_api.create_binding_intent(
  :'project_b',
  pg_catalog.sha256(convert_to('db4-correction-cross-bot', 'UTF8')),
  600
);
commit;

begin;
set local role service_role;
do $cross_bot_binding_denied$
begin
  begin
    -- ДРУГОЙ бот, ТОТ ЖЕ чат, ДРУГОЙ проект. Прежде это проходило.
    perform remhaos_channel_api.activate_project_binding(
      pg_catalog.sha256(convert_to('db4-correction-cross-bot', 'UTF8')),
      777002, 'db4-bot-second', -100600, 'supergroup', 'notice-v1', true, true
    );
    raise exception 'DB4_TGC_CHAT_BOUND_TWICE_VIA_SECOND_BOT';
  exception when sqlstate 'P1109' then null;
  end;
end
$cross_bot_binding_denied$;
rollback;

do $one_project_per_chat$
begin
  if (
    select count(*) from remhaos_channel.project_channel_bindings
    where external_chat_id = -100600 and status = 'active'
  ) <> 1 then
    raise exception 'DB4_TGC_CHAT_HAS_MORE_THAN_ONE_ACTIVE_BINDING';
  end if;
end
$one_project_per_chat$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Бот без прав администратора связь не открывает
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Privacy mode включён глобально: бот без админских прав переписки не увидит.
-- Связь в таком чате была бы связью, которая ничего не принимает, а человек
-- узнал бы об этом только по тишине.

begin;
set local role service_role;
do $bot_admin_required$
begin
  begin
    perform remhaos_channel_api.activate_project_binding(
      pg_catalog.sha256(convert_to('db4-correction-cross-bot', 'UTF8')),
      777002, 'db4-bot-second', -100777, 'supergroup', 'notice-v1', true, false
    );
    raise exception 'DB4_TGC_BINDING_WITHOUT_BOT_ADMIN';
  exception when sqlstate 'P1103' then null;
  end;

  -- И инициатор тоже обязателен: обе проверки независимы.
  begin
    perform remhaos_channel_api.activate_project_binding(
      pg_catalog.sha256(convert_to('db4-correction-cross-bot', 'UTF8')),
      777002, 'db4-bot-second', -100777, 'supergroup', 'notice-v1', false, true
    );
    raise exception 'DB4_TGC_BINDING_WITHOUT_INITIATOR_ADMIN';
  exception when sqlstate 'P1103' then null;
  end;
end
$bot_admin_required$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Право проверяется в момент активации, а не в момент намерения
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Между созданием намерения и нажатием в Telegram человека могли исключить из
-- проекта или отобрать право. Намерение — не доверенность на будущее.

-- Право у владельца второго проекта отбираем ВРЕМЕННО, уже после того как
-- намерение создано.
delete from projectceo_foundation.project_member_capabilities
where project_id = :'project_b'
  and user_id = :'owner_b'
  and capability = 'manage_project_integrations';

begin;
set local role service_role;
do $capability_revoked_between$
begin
  begin
    perform remhaos_channel_api.activate_project_binding(
      pg_catalog.sha256(convert_to('db4-correction-cross-bot', 'UTF8')),
      777002, 'db4-bot-second', -100888, 'supergroup', 'notice-v1', true, true
    );
    raise exception 'DB4_TGC_ACTIVATED_AFTER_CAPABILITY_REVOKED';
  exception when sqlstate 'P1103' then null;
  end;
end
$capability_revoked_between$;
rollback;

-- Возвращаем право: дальше оно понадобится.
insert into projectceo_foundation.project_member_capabilities (
  organization_id, project_id, user_id, capability
)
select pm.organization_id, pm.project_id, pm.user_id, 'manage_project_integrations'
from projectceo_foundation.project_memberships pm
where pm.project_id = :'project_b' and pm.user_id = :'owner_b'
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Конфликт связи аккаунтов называется конфликтом
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Прежняя реализация писала `on conflict do nothing` и отвечала успехом:
-- человек видел «аккаунт связан», а связи не было либо она принадлежала другому.

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.create_identity_link_intent(
  pg_catalog.sha256(convert_to('db4-correction-identity-steal', 'UTF8')),
  600
);
commit;

begin;
set local role service_role;
do $identity_conflict_is_conflict$
begin
  -- Владелец A пытается забрать Telegram-аккаунт, уже связанный с владельцем B.
  begin
    perform remhaos_channel_api.consume_identity_link_intent(
      pg_catalog.sha256(convert_to('db4-correction-identity-steal', 'UTF8')),
      777002
    );
    raise exception 'DB4_TGC_EXTERNAL_ACCOUNT_STOLEN_SILENTLY';
  exception when sqlstate 'P1109' then null;
  end;
end
$identity_conflict_is_conflict$;
rollback;

do $identity_untouched$
begin
  if not exists (
    select 1 from remhaos_channel.channel_identity_links
    where external_user_id = 777002
      and user_id = '33333333-3333-4333-8333-333333333333'
      and revoked_at is null
  ) then
    raise exception 'DB4_TGC_IDENTITY_LINK_LOST';
  end if;
  -- И ни одной второй связи для того же внешнего аккаунта.
  if (
    select count(*) from remhaos_channel.channel_identity_links
    where external_user_id = 777002 and revoked_at is null
  ) <> 1 then
    raise exception 'DB4_TGC_DUPLICATE_IDENTITY_LINK';
  end if;
end
$identity_untouched$;

-- Повтор ТОЙ ЖЕ связи не конфликт, а no-op: ссылка могла быть открыта дважды.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
select remhaos_channel_api.create_identity_link_intent(
  pg_catalog.sha256(convert_to('db4-correction-identity-repeat', 'UTF8')),
  600
);
commit;

begin;
set local role service_role;
do $identity_repeat_is_noop$
declare
  v_result jsonb;
begin
  v_result := remhaos_channel_api.consume_identity_link_intent(
    pg_catalog.sha256(convert_to('db4-correction-identity-repeat', 'UTF8')),
    777002
  ) -> 'data';
  if (v_result ->> 'changed')::boolean then
    raise exception 'DB4_TGC_REPEAT_LINK_REPORTED_AS_NEW';
  end if;
end
$identity_repeat_is_noop$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Правки сообщения: третья не теряется
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Прежде ревизия считалась через `max(...)+1` без блокировки. Третья правка
-- получала тот же номер, что и вторая, проигрывала уникальному индексу — и
-- ТЕРЯЛАСЬ, а вызов отвечал «сохранено».

begin;
set local role service_role;
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 7101, -100600, 501, 'message', 777001, null, null, null,
  '{"kind":"message","text":"Первая редакция"}'::jsonb
);
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 7102, -100600, 501, 'edited_message', 777001, null, null, null,
  '{"kind":"edited_message","text":"Вторая редакция"}'::jsonb
);
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 7103, -100600, 501, 'edited_message', 777001, null, null, null,
  '{"kind":"edited_message","text":"Третья редакция"}'::jsonb
);
commit;

do $three_revisions_survive$
declare
  v_revisions integer[];
begin
  select array_agg(source_revision order by source_revision) into v_revisions
  from remhaos_channel.channel_events
  where external_chat_id = -100600 and external_message_id = 501;

  -- Три правки — три ревизии, подряд и без потерь.
  if v_revisions is distinct from array[1, 2, 3] then
    raise exception 'DB4_TGC_EDIT_REVISIONS_LOST:%', v_revisions;
  end if;

  -- Прошлые ревизии immutable: текст первой на месте.
  if not exists (
    select 1 from remhaos_channel.channel_events
    where external_chat_id = -100600 and external_message_id = 501
      and source_revision = 1
      and payload ->> 'text' = 'Первая редакция'
  ) then
    raise exception 'DB4_TGC_FIRST_REVISION_OVERWRITTEN';
  end if;
end
$three_revisions_survive$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Очередь: протухшая аренда возвращается, отмена терминальна
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
select remhaos_channel_api.enqueue_notification(
  :'project_a', 'release_distribution', 'db4-correction-dist-1',
  'telegram-release/1', '{"projectName":"DB4"}'::jsonb, 'db4-correction-key-1'
);
commit;

-- Первый воркер захватывает работу и умирает, не завершив.
begin;
set local role service_role;
select set_config(
  'projectceo.db4_tgc_claim',
  (remhaos_channel_api.claim_notification_batch(10, 60) -> 'data' -> 0)::text,
  false
);
commit;

do $claim_carries_lease$
declare
  v_claim jsonb := nullif(current_setting('projectceo.db4_tgc_claim', true), '')::jsonb;
begin
  if v_claim is null or v_claim ->> 'leaseToken' is null then
    raise exception 'DB4_TGC_CLAIM_WITHOUT_LEASE_TOKEN';
  end if;
end
$claim_carries_lease$;

-- Аренда истекает: воркер не вернулся.
update remhaos_channel.notification_outbox
set lease_expires_at = statement_timestamp() - interval '1 minute'
where notification_id = (
  current_setting('projectceo.db4_tgc_claim')::jsonb ->> 'notificationId'
)::uuid;

begin;
set local role service_role;
select set_config(
  'projectceo.db4_tgc_reclaim',
  (remhaos_channel_api.claim_notification_batch(10, 60) -> 'data' -> 0)::text,
  false
);
commit;

do $expired_lease_returns_to_queue$
declare
  v_first jsonb := current_setting('projectceo.db4_tgc_claim')::jsonb;
  v_second jsonb := nullif(current_setting('projectceo.db4_tgc_reclaim', true), '')::jsonb;
begin
  -- Прежде `sending` не попадал в выборку вовсе: работа зависала навсегда.
  if v_second is null then
    raise exception 'DB4_TGC_EXPIRED_LEASE_NOT_RECLAIMED';
  end if;
  if v_second ->> 'notificationId' <> v_first ->> 'notificationId' then
    raise exception 'DB4_TGC_RECLAIMED_WRONG_NOTIFICATION';
  end if;
  if v_second ->> 'leaseToken' = v_first ->> 'leaseToken' then
    raise exception 'DB4_TGC_LEASE_TOKEN_NOT_ROTATED';
  end if;
end
$expired_lease_returns_to_queue$;

-- Старый воркер возвращается со СТАРОЙ арендой — и ничего не меняет.
begin;
set local role service_role;
do $stale_worker_changes_nothing$
declare
  v_first jsonb := current_setting('projectceo.db4_tgc_claim')::jsonb;
  v_result jsonb;
begin
  v_result := remhaos_channel_api.mark_notification_sent(
    (v_first ->> 'notificationId')::uuid,
    (v_first ->> 'leaseToken')::uuid,
    999
  ) -> 'data';
  if (v_result ->> 'changed')::boolean then
    raise exception 'DB4_TGC_STALE_WORKER_MARKED_SENT';
  end if;
end
$stale_worker_changes_nothing$;
commit;

-- Отзыв связи гасит очередь; вернувшийся воркер отменённое не воскрешает.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.disconnect_project_channel(:'project_a', 'db4-correction');
commit;

do $revoke_cancels_queue$
begin
  if exists (
    select 1 from remhaos_channel.notification_outbox
    where notification_id = (
      current_setting('projectceo.db4_tgc_reclaim')::jsonb ->> 'notificationId'
    )::uuid
      and state <> 'cancelled'
  ) then
    raise exception 'DB4_TGC_REVOKE_LEFT_QUEUE_ALIVE';
  end if;
end
$revoke_cancels_queue$;

begin;
set local role service_role;
do $cancelled_is_terminal$
declare
  v_second jsonb := current_setting('projectceo.db4_tgc_reclaim')::jsonb;
  v_sent jsonb;
  v_failed jsonb;
begin
  -- Воркер, державший ДЕЙСТВУЮЩУЮ аренду, возвращается после отзыва связи.
  -- Прежде `mark_notification_sent` смотрел только `state <> 'sent'` и
  -- воскрешал отменённое уведомление.
  v_sent := remhaos_channel_api.mark_notification_sent(
    (v_second ->> 'notificationId')::uuid,
    (v_second ->> 'leaseToken')::uuid,
    1000
  ) -> 'data';
  if (v_sent ->> 'changed')::boolean then
    raise exception 'DB4_TGC_CANCELLED_RESURRECTED_AS_SENT';
  end if;

  v_failed := remhaos_channel_api.mark_notification_failed(
    (v_second ->> 'notificationId')::uuid,
    (v_second ->> 'leaseToken')::uuid,
    'late_failure', 30
  ) -> 'data';
  if (v_failed ->> 'changed')::boolean then
    raise exception 'DB4_TGC_CANCELLED_RESURRECTED_AS_RETRY';
  end if;
end
$cancelled_is_terminal$;
commit;

do $still_cancelled$
begin
  if not exists (
    select 1 from remhaos_channel.notification_outbox
    where notification_id = (
      current_setting('projectceo.db4_tgc_reclaim')::jsonb ->> 'notificationId'
    )::uuid
      and state = 'cancelled'
  ) then
    raise exception 'DB4_TGC_CANCELLED_STATE_LOST';
  end if;
end
$still_cancelled$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Отозванная связь ничего не принимает
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local role service_role;
do $revoked_binding_stores_nothing$
declare
  v_result jsonb;
begin
  v_result := remhaos_channel_api.ingest_channel_update(
    'db4-bot', 7201, -100600, 601, 'message', 777001, null, null, null,
    '{"kind":"message","text":"После отключения"}'::jsonb
  ) -> 'data';
  if (v_result ->> 'stored')::boolean then
    raise exception 'DB4_TGC_CAPTURED_AFTER_DISCONNECT';
  end if;
end
$revoked_binding_stores_nothing$;
rollback;

do $nothing_after_disconnect$
begin
  if exists (
    select 1 from remhaos_channel.channel_events where external_message_id = 601
  ) then
    raise exception 'DB4_TGC_STORED_CONTENT_AFTER_DISCONNECT';
  end if;
end
$nothing_after_disconnect$;

-------------------------------------------------------------------------------
-- 8. Одна живая связь: и на чат, и на проект
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Прежняя редакция считала занятым только `active`, поэтому поверх связи,
-- ждущей публикации уведомления, заводилась вторая — на тот же чат другим
-- проектом или на другой чат тем же проектом. Победитель определялся тем, кто
-- первым добежит до финализации, а проигравший оставался жить и занимать
-- ресурс, который ему уже не принадлежит.

begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
select remhaos_channel_api.create_binding_intent(
  :'project_b', pg_catalog.sha256(convert_to('db4-live-b1', 'UTF8')), 600
);
commit;

begin;
set local role service_role;
select remhaos_channel_api.activate_project_binding(
  pg_catalog.sha256(convert_to('db4-live-b1', 'UTF8')),
  777002, 'db4-bot', -101000, 'supergroup', 'notice-v1', true, true
);
commit;

select binding_id::text as db4_live_binding
from remhaos_channel.project_channel_bindings
where external_chat_id = -101000 and status = 'notice_pending' \gset

select set_config('projectceo.db4_live_binding', :'db4_live_binding', false);

-- Второй проект на ТОТ ЖЕ чат другим ботом. Раньше проходило.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_a';
select remhaos_channel_api.create_binding_intent(
  :'project_c', pg_catalog.sha256(convert_to('db4-live-c1', 'UTF8')), 600
);
commit;

begin;
set local role service_role;
do $chat_taken_by_pending$
begin
  begin
    perform remhaos_channel_api.activate_project_binding(
      pg_catalog.sha256(convert_to('db4-live-c1', 'UTF8')),
      777001, 'db4-bot-second', -101000, 'supergroup', 'notice-v1', true, true
    );
    raise exception 'DB4_TGC_SECOND_LIVE_BINDING_ON_CHAT';
  exception when sqlstate 'P1109' then null;
  end;
end
$chat_taken_by_pending$;
rollback;

-- ТОТ ЖЕ проект на другой чат: у проекта уже есть живая связь.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
do $project_already_bound_intent$
begin
  begin
    -- Литерал, а не переменная psql: внутрь dollar-quoted блока psql свои
    -- переменные не подставляет, и `:'…'` уехал бы в сервер буквально.
    perform remhaos_channel_api.create_binding_intent(
      '42222222-2222-4222-8222-222222222222',
      pg_catalog.sha256(convert_to('db4-live-b2', 'UTF8')), 600
    );
    raise exception 'DB4_TGC_SECOND_INTENT_OVER_LIVE_BINDING';
  exception when sqlstate 'P1109' then null;
  end;
end
$project_already_bound_intent$;
rollback;

-- И сама база не даст вставить вторую живую строку ни по чату, ни по проекту.
do $indexes_hold$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from remhaos_channel.project_channel_bindings
  where binding_id = current_setting('projectceo.db4_live_binding')::uuid;

  begin
    insert into remhaos_channel.project_channel_bindings (
      organization_id, project_id, provider, bot_instance_id,
      external_chat_id, external_chat_type, status, notice_version,
      initiated_by_user_id
    )
    values (
      v_org, '43333333-3333-4333-8333-333333333333', 'telegram', 'db4-bot-third',
      -101000, 'supergroup', 'notice_pending', 'notice-v1',
      '31111111-1111-4111-8111-111111111111'
    );
    raise exception 'DB4_TGC_CHAT_INDEX_ALLOWED_SECOND_LIVE';
  exception when unique_violation then null;
  end;

  begin
    insert into remhaos_channel.project_channel_bindings (
      organization_id, project_id, provider, bot_instance_id,
      external_chat_id, external_chat_type, status, notice_version,
      initiated_by_user_id
    )
    select b.organization_id, b.project_id, 'telegram', 'db4-bot-third',
      -101999, 'supergroup', 'notice_pending', 'notice-v1', b.initiated_by_user_id
    from remhaos_channel.project_channel_bindings b
    where b.binding_id = current_setting('projectceo.db4_live_binding')::uuid;
    raise exception 'DB4_TGC_PROJECT_INDEX_ALLOWED_SECOND_LIVE';
  exception when unique_violation then null;
  end;
end
$indexes_hold$;

-- Чат, занятый ожидающей связью ДРУГОГО бота, не выглядит свободным.
do $held_by_other_bot$
declare
  v_data jsonb;
begin
  v_data := remhaos_channel_api.find_pending_notice_binding('db4-bot-second', -101000)
    -> 'data';
  if (v_data ->> 'pending')::boolean then
    raise exception 'DB4_TGC_FOREIGN_BOT_GOT_PENDING_BINDING';
  end if;
  if (v_data ->> 'chatHeldByOtherBot') is distinct from 'true' then
    raise exception 'DB4_TGC_CHAT_HELD_FLAG_MISSING:%', v_data;
  end if;

  -- А своему боту — ровно одна связь и ровно та.
  v_data := remhaos_channel_api.find_pending_notice_binding('db4-bot', -101000)
    -> 'data';
  if not (v_data ->> 'pending')::boolean
     or v_data ->> 'bindingId' is distinct from current_setting('projectceo.db4_live_binding') then
    raise exception 'DB4_TGC_PENDING_LOOKUP_WRONG:%', v_data;
  end if;
end
$held_by_other_bot$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Незавершённое подключение умеет закончиться
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Отказ, который повтор не лечит, обязан закрывать связь. Иначе она вечно
-- занимает чат и проект: приём закрыт, уведомление повторяется на каждом
-- сообщении и всякий раз отказывает, а владелец не может подключиться заново.

begin;
set local role service_role;
do $terminate_validates$
begin
  begin
    perform remhaos_channel_api.terminate_pending_binding(
      current_setting('projectceo.db4_live_binding')::uuid, 'active', 'nope'
    );
    raise exception 'DB4_TGC_TERMINATE_ACCEPTED_BAD_DISPOSITION';
  exception when sqlstate 'P1111' then null;
  end;

  begin
    perform remhaos_channel_api.terminate_pending_binding(
      '00000000-0000-4000-8000-000000000000'::uuid, 'suspended', 'nope'
    );
    raise exception 'DB4_TGC_TERMINATE_ACCEPTED_UNKNOWN_BINDING';
  exception when sqlstate 'P1104' then null;
  end;
end
$terminate_validates$;
commit;

begin;
set local role service_role;
do $terminate_pending$
declare
  v_first jsonb;
  v_repeat jsonb;
begin
  v_first := remhaos_channel_api.terminate_pending_binding(
    current_setting('projectceo.db4_live_binding')::uuid,
    'suspended', 'bot_not_chat_admin'
  ) -> 'data';
  if not (v_first ->> 'terminated')::boolean
     or v_first ->> 'status' is distinct from 'suspended' then
    raise exception 'DB4_TGC_TERMINATE_DID_NOT_CLOSE:%', v_first;
  end if;

  -- Повтор безвреден и честен: закрывать больше нечего.
  v_repeat := remhaos_channel_api.terminate_pending_binding(
    current_setting('projectceo.db4_live_binding')::uuid,
    'revoked', 'second_call'
  ) -> 'data';
  if (v_repeat ->> 'terminated')::boolean then
    raise exception 'DB4_TGC_TERMINATE_REPEATED_AS_CHANGE:%', v_repeat;
  end if;
  if v_repeat ->> 'status' is distinct from 'suspended' then
    raise exception 'DB4_TGC_TERMINATE_REPEAT_CHANGED_STATUS:%', v_repeat;
  end if;
end
$terminate_pending$;
commit;

do $terminated_state$
declare
  v_status text;
  v_capture text;
  v_reason text;
  v_activated timestamptz;
begin
  select b.status, b.capture_state, b.status_reason, b.activated_at
  into v_status, v_capture, v_reason, v_activated
  from remhaos_channel.project_channel_bindings b
  where b.binding_id = current_setting('projectceo.db4_live_binding')::uuid;

  if v_status is distinct from 'suspended'
     or v_capture is distinct from 'none'
     or v_activated is not null then
    raise exception 'DB4_TGC_TERMINATED_SHAPE:%/%', v_status, v_capture;
  end if;
  if v_reason is distinct from 'bot_not_chat_admin' then
    raise exception 'DB4_TGC_TERMINATED_REASON_LOST:%', coalesce(v_reason, 'null');
  end if;
end
$terminated_state$;

-- После закрытия: повторять нечего, принимать нечего.
begin;
set local role service_role;
do $after_termination$
declare
  v_pending jsonb;
  v_ingest jsonb;
begin
  v_pending := remhaos_channel_api.find_pending_notice_binding('db4-bot', -101000) -> 'data';
  if (v_pending ->> 'pending')::boolean then
    raise exception 'DB4_TGC_TERMINATED_STILL_PENDING';
  end if;
  if (v_pending ->> 'chatHeldByOtherBot') is not distinct from 'true' then
    raise exception 'DB4_TGC_TERMINATED_STILL_HELD';
  end if;

  v_ingest := remhaos_channel_api.ingest_channel_update(
    'db4-bot', 9501, -101000, 951, 'message', 777002, null, null, null,
    '{"kind":"message","text":"после закрытия","attachmentCount":0}'::jsonb
  ) -> 'data';
  if (v_ingest ->> 'stored')::boolean then
    raise exception 'DB4_TGC_CAPTURED_AFTER_TERMINATION';
  end if;
end
$after_termination$;
rollback;

-- И владелец может подключиться заново: ни чат, ни проект больше не заняты.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
select remhaos_channel_api.create_binding_intent(
  :'project_b', pg_catalog.sha256(convert_to('db4-live-b3', 'UTF8')), 600
);
commit;

begin;
set local role service_role;
select remhaos_channel_api.activate_project_binding(
  pg_catalog.sha256(convert_to('db4-live-b3', 'UTF8')),
  777002, 'db4-bot', -101000, 'supergroup', 'notice-v1', true, true
);
commit;

do $reconnect_after_termination$
begin
  if (
    select count(*) from remhaos_channel.project_channel_bindings
    where external_chat_id = -101000
      and status in ('pending', 'notice_pending', 'active')
  ) <> 1 then
    raise exception 'DB4_TGC_RECONNECT_LEFT_MORE_THAN_ONE_LIVE';
  end if;
end
$reconnect_after_termination$;

-- Уборка: сценарий гонок ниже начинает с чистого проекта B.
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'owner_b';
select remhaos_channel_api.disconnect_project_channel(:'project_b', 'db4-tgc-cleanup');
commit;

\echo DB4_TELEGRAM_BRIDGE_CORRECTION_OK
