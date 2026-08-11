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

do $duplicates_collapsed$
declare
  v_winner uuid;
  v_status text;
  v_reason text;
  v_capture text;
begin
  -- ЧАТ: из двух активных связей осталась ровно одна, и это та, что была
  -- активирована позже. Победитель выбран правилом, а не планом запроса.
  if (
    select count(*) from remhaos_channel.project_channel_bindings
    where external_chat_id = -200300
      and status in ('pending', 'notice_pending', 'active')
  ) <> 1 then
    raise exception 'DB4_TGU_CHAT_DUPLICATE_NOT_COLLAPSED';
  end if;

  select b.binding_id into v_winner
  from remhaos_channel.project_channel_bindings b
  where b.external_chat_id = -200300
    and b.status in ('pending', 'notice_pending', 'active');
  if v_winner is distinct from '5b000000-0000-4000-8000-00000000000b'::uuid then
    raise exception 'DB4_TGU_CHAT_WINNER_NOT_DETERMINISTIC:%', v_winner;
  end if;

  -- Проигравшая связь ЗАКРЫТА, приём у неё снят, причина сохранена.
  select b.status, b.status_reason, b.capture_state
  into v_status, v_reason, v_capture
  from remhaos_channel.project_channel_bindings b
  where b.binding_id = '5a000000-0000-4000-8000-00000000000a';
  if v_status is distinct from 'revoked' or v_capture is distinct from 'none' then
    raise exception 'DB4_TGU_CHAT_LOSER_STILL_LIVE:%/%', v_status, v_capture;
  end if;
  if v_reason is distinct from 'superseded_duplicate_chat_binding' then
    raise exception 'DB4_TGU_CHAT_LOSER_REASON_LOST:%', coalesce(v_reason, 'null');
  end if;

  -- ПРОЕКТ: активная связь пережила соседнюю `pending`, и живая осталась одна.
  if (
    select count(*) from remhaos_channel.project_channel_bindings
    where project_id = '52222222-2222-4222-8222-222222222222'
      and status in ('pending', 'notice_pending', 'active')
  ) <> 1 then
    raise exception 'DB4_TGU_PROJECT_DUPLICATE_NOT_COLLAPSED';
  end if;

  select b.status, b.status_reason
  into v_status, v_reason
  from remhaos_channel.project_channel_bindings b
  where b.binding_id = '5c000000-0000-4000-8000-00000000000c';
  if v_status is distinct from 'revoked' then
    raise exception 'DB4_TGU_PROJECT_LOSER_STILL_LIVE:%', v_status;
  end if;
  if v_reason is distinct from 'superseded_duplicate_project_binding' then
    raise exception 'DB4_TGU_PROJECT_LOSER_REASON_LOST:%', coalesce(v_reason, 'null');
  end if;

  -- И ни одной осиротевшей ожидающей связи после схлопывания.
  if exists (
    select 1 from remhaos_channel.project_channel_bindings
    where status = 'pending'
  ) then
    raise exception 'DB4_TGU_ORPHAN_PENDING_SURVIVED';
  end if;
end
$duplicates_collapsed$;

-- Индексы существуют, уникальны, валидны и стоят на правильном составе колонок.
do $indexes_valid$
declare
  v_def text;
begin
  for v_def in
    select pg_catalog.pg_get_indexdef(i.indexrelid)
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    where c.relname in (
      'project_channel_bindings_one_live_per_chat',
      'project_channel_bindings_one_live_per_project'
    )
  loop
    if v_def not like 'CREATE UNIQUE INDEX%' then
      raise exception 'DB4_TGU_INDEX_NOT_UNIQUE:%', v_def;
    end if;
    if v_def not like '%notice_pending%' then
      raise exception 'DB4_TGU_INDEX_NOT_LIVE_SCOPED:%', v_def;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    where c.relname = 'project_channel_bindings_one_live_per_chat'
      and i.indisvalid and i.indisunique
  ) then
    raise exception 'DB4_TGU_CHAT_INDEX_INVALID';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    where c.relname = 'project_channel_bindings_one_live_per_project'
      and i.indisvalid and i.indisunique
  ) then
    raise exception 'DB4_TGU_PROJECT_INDEX_INVALID';
  end if;

  -- Состав по проекту — `organization + project + provider`, а не пара.
  select pg_catalog.pg_get_indexdef(i.indexrelid) into v_def
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  where c.relname = 'project_channel_bindings_one_live_per_project';
  if v_def not like '%provider%' then
    raise exception 'DB4_TGU_PROJECT_INDEX_MISSING_PROVIDER:%', v_def;
  end if;
end
$indexes_valid$;

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

  -- Ограничение не просто существует, а ПРОВАЛИДИРОВАНО: `not valid` пропустил
  -- бы старые строки и караулил только новые, то есть закрывал бы половину.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'notification_outbox_lease_shape_check' and convalidated
  ) then
    raise exception 'DB4_TGU_LEASE_SHAPE_NOT_VALIDATED';
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
