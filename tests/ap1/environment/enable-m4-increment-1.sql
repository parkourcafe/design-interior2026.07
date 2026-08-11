-- Включение инкремента 1 модуля 4 на границе базы — вторая половина
-- выключателя.
--
-- Первая половина живёт в приложении: `REMHAOS_EXECUTION_ENABLED=true`. Она
-- закрывает поверхность и команды, но не видна PostgREST: вызов через Data API
-- до приложения не доходит. Поэтому guardrail'ы `20260810070000` (схема M4) и
-- `20260811020000` (командные RPC модуля 4 в продуктовой схеме) отзывают права,
-- а среда, где M4 открыт, возвращает их явно — этим скриптом.
--
-- Открывается РОВНО инкремент 1 по A6 §1.1 / DEC-025: выдача, подтверждение
-- получения, заявка на изменение. Пять команд инкремента 2
-- (`review_change_impact`, `upload_photo_evidence`, `review_photo_evidence`,
-- `accept_milestone`, `build_handover`) не открывает ни этот скрипт, ни любая
-- другая среда: их не авторизовал ни один подписанный документ, и закрыты они
-- на обеих границах — правами в базе и отдельной проверкой в
-- `command-service.ts`, не зависящей от флага.
--
-- Скрипт исполняется ТОЛЬКО там, где модуль намеренно открыт: локальный стенд,
-- CI, харнессы DB4 и AP1 — то есть одноразовые непроизводственные среды. В
-- продакшене он не исполняется: там модуль закрыт отсутствием этих прав.
--
-- Обратная операция — повторно применить сами guardrail'ы (`revoke` в них
-- идемпотентен).
--
-- ЭТО НЕ PRODUCTION FEATURE FLAG И НЕ МЕХАНИЗМ ENTITLEMENT.
-- Ратифицировано владельцем 11.08.2026 — DEC-029 LOCKED, форма действия:
-- `docs/canonical/remhaos-v1/REMHAOS_A6_CLARIFICATION_M4_GRANT_MECHANISM_2026-08-11.md`
-- (уточнение A6 §5.2 п.8 в части механизма). Зафиксировано там же:
--   * постоянные миграции НЕ возвращают `authenticated` права на пишущие RPC M4;
--   * production-включение требует отдельного OWNER GO и аудируемого DB-state,
--     поверх которого env-флаг остаётся дополнительным hard-off;
--   * инкремент 2 закрыт независимо от флага.

begin;

grant execute on function
  -- Двери, которые зовёт приложение.
  projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text),
  projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text),
  projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text),
  projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text),
  -- Прежние двери тех же двух операций. Приложение их не зовёт, но их
  -- семантику проверяет `tests/db4/20_product_operations.sql`, и харнесс — это
  -- ровно та среда, где модуль открыт намеренно. Сведение двух дверей к одной
  -- записано в backlog `M4 Production Hardening`.
  projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text),
  projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)
  to authenticated;

do $enabled$
declare
  v_missing text;
  v_leaked text;
begin
  select signature into v_missing
  from unnest(array[
    'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)',
    'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
    'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)',
    'projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)',
    'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'PROJECTCEO_M4_INCREMENT_1_NOT_ENABLED:%', v_missing;
  end if;

  -- Включение инкремента 1 не имеет права задеть инкремент 2. Проверка стоит
  -- здесь, а не в отдельном сценарии, потому что ошибиться легче всего именно
  -- в момент открытия: одна лишняя строка в `grant` выше — и закрытым остаётся
  -- только документ.
  select signature into v_leaked
  from unnest(array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)',
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_M4_INCREMENT_2_LEAKED:%', v_leaked;
  end if;
end
$enabled$;

commit;
