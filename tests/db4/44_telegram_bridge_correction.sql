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
