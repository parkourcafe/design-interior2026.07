-- Включение инкремента 1 модуля 4 на границе базы — вторая половина
-- выключателя.
--
-- Первая половина живёт в приложении: `REMHAOS_EXECUTION_ENABLED=true`. Она
-- закрывает поверхность и команды, но не видна PostgREST: вызов через Data API
-- до приложения не доходит. Поэтому guardrail'ы `20260810070000` (схема M4) и
-- `20260811020000` (командные RPC модуля 4 в продуктовой схеме) отзывают права,
-- а среда, где M4 открыт, возвращает их явно — этим скриптом.
--
-- Открывается инкремент 1 по A6 §1.1 / DEC-025 (выдача, подтверждение
-- получения, заявка на изменение) и, поверх него, V1 Impact по DEC-033
-- (OWNER GO 12.08.2026): расчёт влияния — воркерная RPC, а не эта дверь; здесь
-- открывается только его человеческое ревью, `review_change_impact`. Четыре
-- оставшиеся команды V2/V3 (`upload_photo_evidence`, `review_photo_evidence`,
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
  projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text),
  -- V1 Impact (DEC-033): ревью уже посчитанного влияния — человеческая
  -- операция; сам расчёт остаётся воркерным и этой выдачей не касается.
  projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text),
  projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)
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
    'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)',
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'PROJECTCEO_M4_INCREMENT_1_NOT_ENABLED:%', v_missing;
  end if;

  -- Раскрытая системная дверь расчёта проверяется отдельно: она обязана
  -- остаться закрытой ДАЖЕ здесь, где модуль намеренно открыт. Единственная
  -- дверь расчёта — policy-bound RPC, выданная только `service_role`
  -- (`20260812010000`), и этот скрипт её не касается.
  if pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M4_RAW_IMPACT_RPC_LEAKED_TO_AUTHENTICATED';
  end if;

  -- Включение инкремента 1 + V1 не имеет права задеть V2/V3. Проверка стоит
  -- здесь, а не в отдельном сценарии, потому что ошибиться легче всего именно
  -- в момент открытия: одна лишняя строка в `grant` выше — и закрытым остаётся
  -- только документ.
  --
  -- `review_change_impact` и её повторная дверь из этого списка УБРАНЫ
  -- 12.08.2026: их открывает `enable-m4-v1-impact.sql` по отдельному GO на
  -- вертикаль V1. Пока они охранялись здесь, повторное применение этого скрипта
  -- в среде с открытым V1 падало бы на законно выданном праве — то есть
  -- порядок применения скриптов стал бы частью контракта. Теперь каждый скрипт
  -- охраняет ровно то, чего сам не открывает. Что инкремент 1 их не выдаёт,
  -- видно из `grant` выше: их там нет.
  select signature into v_leaked
  from unnest(array[
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
    raise exception 'PROJECTCEO_M4_V2_V3_LEAKED:%', v_leaked;
  end if;
end
$enabled$;

commit;
