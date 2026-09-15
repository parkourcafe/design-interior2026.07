-- Включение модуля 3 на границе базы — вторая половина выключателя.
--
-- Первая половина живёт в приложении: `REMHAOS_DOCUMENTATION_ENABLED=true`.
-- Она закрывает поверхность и команды, но не видна PostgREST: вызов через Data
-- API до приложения не доходит. Поэтому guardrail `20260811010000` отзывает
-- права на три публикующие RPC, и среда, где M3 открыт, возвращает их явно —
-- этим скриптом.
--
-- Скрипт исполняется ТОЛЬКО там, где модуль намеренно открыт: локальный стенд,
-- одноразовый стек AP5. В продакшене он не исполняется — там модуль закрыт, и
-- закрыт он отсутствием этих прав, а не отсутствием маршрута.
--
-- Обратная операция — повторно применить сам guardrail (`revoke` в нём
-- идемпотентен).
--
-- ЭТО НЕ PRODUCTION FEATURE FLAG (решение владельца 11.08). Скрипт — временный
-- механизм одноразовой среды и default-deny до запуска M3. Исполнять его против
-- продакшена запрещено: включение модуля там — отдельное решение, и оно требует
-- одного авторитетного DB-state с аудитом, поверх которого env-флаг остаётся
-- дополнительным hard-off.

begin;

grant execute on function
  projectceo_read_api.get_pdf_dwg_source_pair_confirmation(uuid, uuid, uuid),
  projectceo_api.confirm_pdf_dwg_source_pair(uuid, uuid, uuid, uuid, text, text),
  projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text),
  projectceo_product_api.publish_release_request_bound(uuid, text, text, bigint, text, text),
  projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text),
  projectceo_api.review_source(uuid, text, text, bigint, text, text),
  projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text),
  projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text),
  projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)
  to authenticated;

do $enabled$
declare
  v_missing text;
begin
  select signature into v_missing
  from unnest(array[
    'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)',
    'projectceo_product_api.publish_release_request_bound(uuid, text, text, bigint, text, text)',
    'projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text)',
    'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
    'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
    'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)',
    'projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'PROJECTCEO_M3_PUBLICATION_NOT_ENABLED:%', v_missing;
  end if;
end
$enabled$;

commit;
