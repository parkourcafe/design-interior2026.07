\set ON_ERROR_STOP on

-- Прямой обход приложения через Data API: поверхность Telegram Chat Bridge при
-- выключенном мосте (A7 / DEC-031, миграции `20260811040000` и `20260811050000`).
--
-- Тот же класс проверки и то же условие, что у M3 (`05_...`) и M4 (`07_...`):
-- если закрывается только Next.js-команда, условие не выполнено. Флаг
-- `REMHAOS_TELEGRAM_BRIDGE_ENABLED` живёт в TypeScript, а вызов PostgREST до
-- TypeScript не доходит.
--
-- Сценарий стоит ДО `enable-telegram-bridge.sql` в `run.zsh` намеренно: он
-- обязан наблюдать состояние сразу после цепочки миграций, где мост закрыт, а
-- среда ещё ничего не включала.

-- 1. Ни одна функция шлюза не выдана человеческим ролям по умолчанию.
do $bridge_closed_by_default$
declare
  v_reachable text;
begin
  select signature into v_reachable
  from unnest(array[
    -- Человеческий контур: закрыт до явного включения среды.
    'projectceo_gateway_api.create_channel_link_intent(uuid, text, text, text, integer)',
    'projectceo_gateway_api.get_project_channel_state(uuid)',
    'projectceo_gateway_api.revoke_channel_binding(uuid, uuid, text)',
    'projectceo_gateway_api.list_project_inbox_candidates(uuid, integer)',
    'projectceo_gateway_api.resolve_project_inbox_candidate(uuid, uuid, text)',
    -- Системный контур: закрыт НАВСЕГДА, ни одна среда его не возвращает.
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
  if v_reachable is not null then
    raise exception 'DB4_TELEGRAM_BRIDGE_GRANTED_BY_DEFAULT:%', v_reachable;
  end if;
end
$bridge_closed_by_default$;

-- 2. Права — это утверждение о доступе. Ниже проверяется сам доступ: реальные
--    вызовы из-под роли, каждый обязан упереться в 42501 ДО тела функции.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $bridge_direct_calls_denied$
declare
  v_denied int := 0;
begin
  begin
    perform projectceo_gateway_api.create_channel_link_intent(
      '41111111-1111-4111-8111-111111111111', 'channel_binding', 'probe-bot',
      repeat('a', 64), 600
    );
    raise exception 'DB4_TELEGRAM_INTENT_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_gateway_api.get_project_channel_state(
      '41111111-1111-4111-8111-111111111111'
    );
    raise exception 'DB4_TELEGRAM_STATE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_gateway_api.list_project_inbox_candidates(
      '41111111-1111-4111-8111-111111111111', 10
    );
    raise exception 'DB4_TELEGRAM_INBOX_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- Системный контур: человеческая сессия не имеет права сфабриковать входящее
  -- сообщение и не имеет права взять очередь.
  begin
    perform projectceo_gateway_api.record_channel_event(
      '00000000-0000-4000-8000-000000000000', 1, '-100500', 1, '777',
      'message', 1, null, null, null, null, 'probe'
    );
    raise exception 'DB4_TELEGRAM_RECORD_EVENT_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_gateway_api.claim_channel_events(1, 60);
    raise exception 'DB4_TELEGRAM_CLAIM_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_gateway_api.claim_notifications(1, 60);
    raise exception 'DB4_TELEGRAM_CLAIM_NOTIFICATIONS_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  if v_denied <> 6 then
    raise exception 'DB4_TELEGRAM_BRIDGE_DENIAL_COUNT:%', v_denied;
  end if;
end
$bridge_direct_calls_denied$;
rollback;

-- 3. Приватные таблицы шлюза не отданы никому, кроме владельца. Ни человеку, ни
--    системной роли: воркер ходит только через фиксированные RPC.
do $bridge_tables_private$
declare
  v_exposed text;
begin
  select format('%s.%s to %s', table_schema, table_name, grantee) into v_exposed
  from information_schema.role_table_grants
  where table_schema = 'projectceo_gateway'
    and grantee in ('anon', 'authenticated', 'service_role', 'public',
                    'pi_human_executor', 'pi_worker_executor')
  limit 1;
  if v_exposed is not null then
    raise exception 'DB4_TELEGRAM_BRIDGE_TABLE_EXPOSED:%', v_exposed;
  end if;
end
$bridge_tables_private$;

-- 4. Каждая таблица шлюза живёт под RLS, и политика ровно одна — владельца
--    таблиц. Таблица без RLS в приватной схеме — это дыра, ждущая гранта.
do $bridge_rls$
declare
  v_table text;
begin
  select relname into v_table
  from pg_catalog.pg_class
  join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
  where nspname = 'projectceo_gateway'
    and relkind = 'r'
    and (not relrowsecurity or not relforcerowsecurity)
  limit 1;
  if v_table is not null then
    raise exception 'DB4_TELEGRAM_BRIDGE_TABLE_WITHOUT_RLS:%', v_table;
  end if;

  select tablename into v_table
  from pg_catalog.pg_policies
  where schemaname = 'projectceo_gateway'
    and roles <> '{pi_table_owner}'
  limit 1;
  if v_table is not null then
    raise exception 'DB4_TELEGRAM_BRIDGE_POLICY_BEYOND_OWNER:%', v_table;
  end if;
end
$bridge_rls$;

-- 5. Мост не добавил внешних идентификаторов канала в доменные таблицы модулей
--    (INV-T7). Проверка по каталогу, а не по памяти: колонка, добавленная
--    «на минутку», переживёт любое обещание.
do $bridge_no_domain_leak$
declare
  v_column text;
begin
  select format('%I.%I.%I', table_schema, table_name, column_name) into v_column
  from information_schema.columns
  where table_schema in (
      'projectceo_product', 'projectceo_m3', 'projectceo_m4',
      'projectceo_foundation', 'project_intelligence', 'public'
    )
    and (
      column_name ~ 'telegram'
      or column_name in ('external_chat_id', 'external_actor_id', 'external_update_id')
    )
  limit 1;
  if v_column is not null then
    raise exception 'DB4_TELEGRAM_IDENTIFIER_IN_DOMAIN_TABLE:%', v_column;
  end if;
end
$bridge_no_domain_leak$;
