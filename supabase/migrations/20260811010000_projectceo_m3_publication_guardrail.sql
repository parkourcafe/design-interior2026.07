-- Guardrail модуля 3: публикация закрыта на границе базы.
--
-- Основание: OWNER DECISION 11.08.2026 и требование A5 §4.2.2 — «флаг модуля M3,
-- выключенный по умолчанию». Решение ничего не открывает, оно запрещает.
--
-- Находка, ради которой миграция существует. `REMHAOS_DOCUMENTATION_ENABLED`
-- закрывал только intake (`register_source`, `review_source`, листы
-- документации). Выход модуля — `publish_baseline` и `publish_release` — не был
-- закрыт ничем: ни флагом приложения, ни правами в базе. Схема
-- `projectceo_product_api` отдана Data API (`supabase/config.toml`), а
-- `publish_project_baseline` и `publish_production_package_version` были выданы
-- роли `authenticated` (`20260717101000`, строки 3635–3641). То есть любая
-- аутентифицированная сессия могла опубликовать baseline и производственную
-- версию напрямую через PostgREST, минуя приложение целиком. Флаг в TypeScript
-- такого вызова не видит — вызов до TypeScript не доходит.
--
-- Тот же класс дефекта, что закрыл guardrail модуля 4 (`20260810070000`), и
-- закрывается он так же: границ две, и обе кодом.
--
-- ЧЕМ ЭТОТ GUARDRAIL ОТЛИЧАЕТСЯ ОТ M4. Модуль 4 закрыт целиком, поэтому там
-- отзыв сплошной по схеме. Модуль 3 обязан РАБОТАТЬ при включённом флаге, а его
-- RPC живут в схеме, которую делят с ним M2 и общий продуктовый мозг. Сплошной
-- отзыв по схеме здесь сломал бы решения, выборы и одобрения — то есть отзыв
-- обязан быть точечным. Отзываются шесть функций двух групп:
--
--   * три публикующие (выход модуля);
--   * три M3-only авторские (решение владельца 11.08): дверь ревью источника и
--     обе RPC листов документации. Они принадлежат модулю целиком, другого
--     потребителя не имеют, и закрыть их в базе можно без риска для M1/M2.
--
-- `projectceo_api.register_source_inventory` НЕ отзывается: RPC общая, и до
-- появления M3-aware обёртки она остаётся названным остатком `app_gate_only`
-- (см. матрицу `m3-surface.ts`).
--
-- КАК МОДУЛЬ ВКЛЮЧАЕТСЯ В СРЕДЕ. База не видит переменную окружения — значит
-- вторая половина выключателя живёт в правах. По умолчанию (после этой
-- миграции) прав нет: продакшен закрыт, и закрыт намеренно, а не по отсутствию
-- маршрута. Среда, где M3 открыт, исполняет
-- `tests/ap1/environment/enable-m3-publication.sql` — это и есть включение
-- второй границы, парное к `REMHAOS_DOCUMENTATION_ENABLED=true` в приложении.
-- Два выключателя вместо одного — сознательно: приложение отказывает раньше RPC
-- и говорит `module_disabled`, база отказывает даже мимо приложения.
--
-- ГРАНТ — НЕ ФИНАЛЬНЫЙ PRODUCTION FEATURE FLAG (решение владельца 11.08).
-- Он допустим ровно как два механизма: способ открыть модуль в одноразовой среде
-- AP5 и default-deny до запуска M3. Продакшен-включение модуля этим грантом
-- ЗАПРЕЩЕНО. Финальный механизм — отдельное решение, и его форма уже названа:
-- один авторитетный DB-state с аудитом (кто включил, когда, на основании чего),
-- а env-флаг остаётся дополнительным hard-off поверх него. До этого решения
-- продакшен остаётся закрытым, и открывать его вручную грантом нельзя.

begin;

revoke execute on function
  projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text),
  projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text),
  projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text),
  projectceo_api.review_source(uuid, text, text, bigint, text, text),
  projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text),
  projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)
  from authenticated;

-- Запрет, который никто не проверяет, — это комментарий. Миграция обязана
-- упасть здесь, если она не достигла цели или задела лишнее.
do $guard$
declare
  v_reachable text;
  v_broken text;
begin
  select signature into v_reachable
  from unnest(array[
    'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)',
    'projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text)',
    'projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text)',
    'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
    'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
    'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'PROJECTCEO_M3_PUBLICATION_STILL_REACHABLE:%', v_reachable;
  end if;

  -- Точечность отзыва: всё, что публикацией не является, обязано уцелеть.
  -- Без этой половины «закрыли публикацию» могло бы незаметно означать
  -- «закрыли работу с решениями», и поймали бы это только браузерным прогоном.
  select signature into v_broken
  from unnest(array[
    'projectceo_product_api.append_decision_revision(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text, bigint, text)',
    'projectceo_product_api.create_approval_package(uuid, uuid, text, jsonb, bigint, text)',
    'projectceo_product_api.review_approval_package(uuid, text, text, text, text, bigint, text)',
    'projectceo_read_api.get_project_workspace_read_v9(uuid, uuid)',
    'projectceo_api.register_source_inventory(uuid, jsonb, jsonb, bigint, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_broken is not null then
    raise exception 'PROJECTCEO_M3_GUARDRAIL_OVERREACHED:%', v_broken;
  end if;
end
$guard$;

commit;
