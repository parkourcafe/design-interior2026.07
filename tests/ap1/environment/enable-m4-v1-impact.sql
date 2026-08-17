-- Включение вертикали V1 Impact на границе базы — вторая половина
-- выключателя, ровно как у инкремента 1.
--
-- Первая половина живёт в приложении: `review_change_impact` вышла из списка
-- «закрыто независимо от флага» (`execution-flag.ts`). Она закрывает поверхность
-- и команду, но не видна PostgREST: вызов через Data API до приложения не
-- доходит. Поэтому guardrail `20260810070000` отзывает права по схеме M4, а
-- среда, где V1 открыт, возвращает их явно — этим скриптом.
--
-- Основание: **M4 IMPLEMENTATION GO на V1** от 12.08.2026 поверх DEC-032 —
-- то самое отдельное решение владельца, которого требовал
-- `REMHAOS_A6_CLARIFICATION_M4_EXECUTION_LAYER_2026-08-12.md` §5. До него ни
-- одна команда инкремента 2 не открывалась ни в одной среде.
--
-- Открываются РОВНО две команды вертикали: рассмотрение готового прогона
-- влияния, прямая дверь и повторная. Третьей двери — подтверждения неполноты
-- (`acknowledge_impact_truncation`) — в V1 нет: DEC-034 закрывает её
-- НАВСЕГДА, поверх DEC-033-на-main, поперёк того, что делал этот скрипт до
-- коррекции. Человеческого override у усечённого прогона не существует ни в
-- одной среде, включая эту.
--
-- Четыре оставшиеся команды инкремента 2
-- (`upload_photo_evidence`, `review_photo_evidence`, `accept_milestone`,
-- `build_handover`) этот скрипт не открывает: их вертикали V2 и V3 остаются
-- `NOT AUTHORIZED`.
--
-- ПОЧЕМУ ЭТО СТАЛО ВОЗМОЖНО ТОЛЬКО СЕЙЧАС. Вход команды — `impactRunId` —
-- рождается в воркерном контуре. Пока контура не было, открытая команда
-- обещала бы то, чего выполнить нельзя: рассматривать было нечего. Контур
-- появился в V1 (`20260812010000` + `lib/project-intelligence/workers/
-- change-impact`), и команда возвращается в обычный порядок — доступна по
-- предпосылке, а не по авторизации.
--
-- РАСЧЁТ ЭТИМ СКРИПТОМ НЕ ОТКРЫВАЕТСЯ. `calculate_change_impact`,
-- `calculate_change_impact_policy_bound` и `list_change_impact_backlog`
-- остаются системными: человек рассматривает влияние, но не заказывает его
-- расчёт. Ниже это проверяется, а не подразумевается.
--
-- Скрипт исполняется ТОЛЬКО там, где модуль намеренно открыт: локальный стенд,
-- CI, харнессы DB4/DB5 и AP1 — то есть одноразовые непроизводственные среды. В
-- продакшене он не исполняется: там модуль закрыт отсутствием этих прав.
--
-- Обратная операция — повторно применить guardrail `20260810070000`
-- (`revoke` в нём идемпотентен).
--
-- ЭТО НЕ PRODUCTION FEATURE FLAG И НЕ МЕХАНИЗМ ENTITLEMENT. DEC-029 без
-- изменений: постоянные миграции НЕ возвращают `authenticated` права на
-- пишущие RPC модуля 4, и production-включение требует отдельного OWNER GO.

begin;

grant execute on function
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
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'PROJECTCEO_M4_V1_IMPACT_NOT_ENABLED:%', v_missing;
  end if;

  -- DEC-034: третьей двери нет ни при каких обстоятельствах, включая эту
  -- заведомо открытую среду. Явная проверка — не молчаливое отсутствие
  -- строки в списке выше.
  if pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M4_TRUNCATION_ACK_LEAKED_BY_ENABLE_SCRIPT';
  end if;

  -- Открытие V1 не имеет права задеть V2 и V3. Проверка стоит здесь, а не в
  -- отдельном сценарии, потому что ошибиться легче всего именно в момент
  -- открытия: одна лишняя строка в `grant` выше — и закрытым остаётся только
  -- документ.
  --
  -- Эти четыре сигнатуры переехали сюда из `enable-m4-increment-1.sql` вместе с
  -- двумя открываемыми: пока весь инкремент 2 охранял тот скрипт, повторное
  -- применение его после этого падало бы на законно выданном праве. Теперь
  -- каждый скрипт охраняет ровно то, что сам не открывает, и порядок их
  -- применения перестал иметь значение.
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
    raise exception 'PROJECTCEO_M4_V2_V3_LEAKED_BY_V1:%', v_leaked;
  end if;

  -- Человек рассматривает влияние, но не заказывает расчёт: воркерный контур
  -- остаётся системным в среде, где V1 открыт.
  select format('%s:%s', role_name, signature) into v_leaked
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_WORKER_LEAKED_BY_V1:%', v_leaked;
  end if;
end
$enabled$;

commit;
