-- Включение человеческого контура Telegram Chat Bridge на границе базы —
-- вторая половина выключателя.
--
-- Первая половина живёт в приложении: `REMHAOS_TELEGRAM_BRIDGE_ENABLED=true`.
-- Она закрывает поверхность и команды, но не видна PostgREST: вызов через Data
-- API до приложения не доходит. Поэтому миграция `20260811050000` отзывает
-- права у `authenticated`, а среда, где мост открыт намеренно, возвращает их
-- явно — этим скриптом.
--
-- Открывается РОВНО человеческий контур: завести одноразовый интент, прочитать
-- состояние подключения, отключить чат, прочитать Project Inbox, решить по
-- кандидату. Системный контур (webhook и воркеры) этот скрипт НЕ открывает и
-- открыть не может: у тех функций права только у `service_role`, и ни одна
-- среда их человеку не возвращает. Системная функция, доступная человеческой
-- сессии, означала бы, что кто угодно может сфабриковать входящее сообщение
-- чужого проекта.
--
-- Скрипт исполняется ТОЛЬКО там, где мост намеренно открыт: локальный стенд,
-- CI, харнессы DB4 и AP1 — то есть одноразовые непроизводственные среды. В
-- продакшене он не исполняется: там мост закрыт отсутствием этих прав.
--
-- Обратная операция — повторно применить `revoke` из `20260811050000`.
--
-- ЭТО НЕ PRODUCTION FEATURE FLAG И НЕ МЕХАНИЗМ ENTITLEMENT.
-- Тот же механизм и то же основание, что у модулей 3 и 4 (DEC-029): постоянные
-- миграции прав не возвращают, production-включение требует отдельного OWNER GO
-- и аудируемого DB-state, поверх которого env-флаг остаётся дополнительным
-- hard-off. По A7 §9 production-включение моста не разрешено вовсе — до
-- закрытия legal / data-plane / consent / retention гейта.

begin;

grant execute on function
  projectceo_gateway_api.create_channel_link_intent(uuid, text, text, text, integer),
  projectceo_gateway_api.get_project_channel_state(uuid),
  projectceo_gateway_api.revoke_channel_binding(uuid, uuid, text),
  projectceo_gateway_api.list_project_inbox_candidates(uuid, integer),
  projectceo_gateway_api.resolve_project_inbox_candidate(uuid, uuid, text)
  to authenticated;

do $enabled$
declare
  v_missing text;
  v_leaked text;
begin
  select signature into v_missing
  from unnest(array[
    'projectceo_gateway_api.create_channel_link_intent(uuid, text, text, text, integer)',
    'projectceo_gateway_api.get_project_channel_state(uuid)',
    'projectceo_gateway_api.revoke_channel_binding(uuid, uuid, text)',
    'projectceo_gateway_api.list_project_inbox_candidates(uuid, integer)',
    'projectceo_gateway_api.resolve_project_inbox_candidate(uuid, uuid, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'REMHAOS_TELEGRAM_BRIDGE_NOT_ENABLED:%', v_missing;
  end if;

  -- Включение человеческого контура не имеет права задеть системный. Проверка
  -- стоит здесь, а не в отдельном сценарии, потому что ошибиться легче всего
  -- именно в момент открытия: одна лишняя строка в `grant` выше — и webhook
  -- становится доступен любой сессии.
  select signature into v_leaked
  from unnest(array[
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
  limit 1;
  if v_leaked is not null then
    raise exception 'REMHAOS_TELEGRAM_BRIDGE_SYSTEM_PATH_LEAKED:%', v_leaked;
  end if;
end
$enabled$;

commit;
