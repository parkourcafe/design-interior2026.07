\set ON_ERROR_STOP on

-- Состояние базы ПОСЛЕ применения `20260811070000` к населённой базе.
--
-- Проверяется не «миграция применилась» — это уже доказано тем, что мы сюда
-- дошли, — а что она сделала с существующими строками именно то, что обещает
-- её текст. Обещаний ровно три, и каждое из них раньше было нарушено.

do $bindings_normalized$
declare
  v_status text;
  v_capture text;
  v_activated timestamptz;
begin
  -- 1. Связь, участников которой предупредили, приём СОХРАНЯЕТ. Обратное
  --    означало бы, что миграция отняла работающее подключение у людей,
  --    которые всё сделали правильно.
  select b.status, b.capture_state, b.activated_at
  into v_status, v_capture, v_activated
  from remhaos_channel.project_channel_bindings b
  where b.external_chat_id = -200100;

  if v_status is distinct from 'active'
     or v_capture is distinct from 'full_after_notice'
     or v_activated is null then
    raise exception 'DB4_TGU_NOTIFIED_BINDING_BROKEN:%/%', v_status, v_capture;
  end if;

  -- 2. Связь без опубликованного уведомления приём ТЕРЯЕТ и возвращается в
  --    `notice_pending`. Это не потеря данных: это восстановление обещания,
  --    которое дали участникам чата и не сдержали.
  select b.status, b.capture_state, b.activated_at
  into v_status, v_capture, v_activated
  from remhaos_channel.project_channel_bindings b
  where b.external_chat_id = -200200;

  if v_status is distinct from 'notice_pending'
     or v_capture is distinct from 'none'
     or v_activated is not null then
    raise exception 'DB4_TGU_SILENT_BINDING_STILL_CAPTURING:%/%', v_status, v_capture;
  end if;
end
$bindings_normalized$;

do $outbox_normalized$
declare
  v_state text;
  v_token uuid;
  v_expires timestamptz;
begin
  -- 3. Осиротевший `sending` вернулся в очередь, поля аренды очищены. Именно
  --    здесь падала бы первая редакция миграции: constraint формы аренды
  --    добавлялся раньше этой нормализации, а токена у строки не было и быть
  --    не могло — колонку только что создали.
  select o.state, o.lease_token, o.lease_expires_at
  into v_state, v_token, v_expires
  from remhaos_channel.notification_outbox o
  where o.idempotency_key = 'release_distribution:upgrade-dist-1';

  if v_state is distinct from 'retry' then
    raise exception 'DB4_TGU_ORPHANED_SENDING_NOT_REQUEUED:%', v_state;
  end if;
  if v_token is not null or v_expires is not null then
    raise exception 'DB4_TGU_ORPHANED_LEASE_FIELDS_KEPT';
  end if;

  -- Отправленное осталось отправленным: нормализация трогает только `sending`.
  select o.state into v_state
  from remhaos_channel.notification_outbox o
  where o.idempotency_key = 'release_distribution:upgrade-dist-0';
  if v_state is distinct from 'sent' then
    raise exception 'DB4_TGU_TERMINAL_ROW_TOUCHED:%', v_state;
  end if;

  -- И форма аренды теперь обязательна: `sending` без токена больше не
  -- существует как состояние.
  begin
    update remhaos_channel.notification_outbox
    set state = 'sending'
    where idempotency_key = 'release_distribution:upgrade-dist-1';
    raise exception 'DB4_TGU_LEASE_SHAPE_NOT_ENFORCED';
  exception when check_violation then null;
  end;
end
$outbox_normalized$;

-- Цепочка живая: восстановленная связь доводится до активной обычным путём, а
-- вернувшаяся в очередь запись снова захватывается воркером.
do $chain_still_works$
declare
  v_binding uuid;
  v_result jsonb;
  v_claim jsonb;
begin
  select b.binding_id into v_binding
  from remhaos_channel.project_channel_bindings b
  where b.external_chat_id = -200200;

  v_result := remhaos_channel_api.mark_channel_notice_posted(
    v_binding, 'notice-v2', true, true
  ) -> 'data';
  if not (v_result ->> 'changed')::boolean then
    raise exception 'DB4_TGU_RECOVERED_BINDING_DID_NOT_ACTIVATE';
  end if;

  v_claim := remhaos_channel_api.claim_notification_batch(10, 60) -> 'data' -> 0;
  if v_claim is null or v_claim ->> 'leaseToken' is null then
    raise exception 'DB4_TGU_REQUEUED_ROW_NOT_CLAIMABLE';
  end if;
end
$chain_still_works$;

\echo DB4_TELEGRAM_UPGRADE_OK
