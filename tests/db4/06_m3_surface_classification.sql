\set ON_ERROR_STOP on

-- Классификация поверхности модуля 3 против настоящей базы.
--
-- Матрица живёт в `lib/project-intelligence/delivery/projectceo/m3-surface.ts`,
-- и её строки — утверждения о базе. Утверждение, которое никто не сверял с
-- базой, ошибается молча: первая редакция матрицы содержала три сигнатуры,
-- написанные по памяти, и ни один TypeScript-тест этого поймать не мог. Здесь
-- сверка: каждая сигнатура обязана разрешаться в существующую функцию.
--
-- Второе: ни одна функция схемы `projectceo_m3_api` не может быть доступна
-- `authenticated`, не будучи классифицированной. Новая RPC модуля, добавленная
-- завтра, окажется здесь неклассифицированной и уронит CI — а не пройдёт мимо
-- запрета, как это уже случилось с публикацией.
--
-- Список ниже — зеркало матрицы. Их совпадение проверяет
-- `m3-surface-matrix.test.ts`: разойдись они, красным станет юнит-набор.

do $m3_surface_classification$
declare
  v_signature text;
  v_unknown text;
  v_classified text[] := array[
    'projectceo_m3_api.get_native_m3_release_context(uuid, uuid)',
    'projectceo_read_api.get_pdf_dwg_sheet_sidecar(uuid, uuid, uuid)',
    'projectceo_api.bind_pdf_dwg_sheet_sidecar(uuid, uuid, uuid, text, text, bigint, jsonb, integer, text, jsonb, text, text)',
    'projectceo_read_api.get_pdf_dwg_source_pair_confirmation(uuid, uuid, uuid)',
    'projectceo_api.confirm_pdf_dwg_source_pair(uuid, uuid, uuid, uuid, text, text)',
    -- app_gate_only
    'projectceo_api.register_source_inventory(uuid, jsonb, jsonb, bigint, text)',
    -- revoked_from_authenticated
    'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
    'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
    'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)',
    'projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)',
    'projectceo_product_api.publish_release_request_bound(uuid, text, text, bigint, text, text)',
    'projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text)',
    'projectceo_product_api.publish_native_m3_release_request_bound(uuid, uuid, text, text, bigint, text, text, text)',
    'projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)'
  ];
begin
  -- 1. Каждая сигнатура матрицы существует. `to_regprocedure` возвращает null
  --    на несуществующую функцию вместо ошибки, поэтому проверка явная.
  foreach v_signature in array v_classified loop
    if to_regprocedure(v_signature) is null then
      raise exception 'DB4_M3_SURFACE_SIGNATURE_NOT_FOUND:%', v_signature;
    end if;
  end loop;

  -- 2. Схема модуля не содержит доступных `authenticated` функций сверх
  --    классифицированных. Читающие RPC модуля сюда тоже попадут — и это
  --    правильно: чтение документации есть поверхность модуля и обязано быть
  --    названо, а не молча открыто.
  select p.oid::regprocedure::text into v_unknown
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_m3_api'
    and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not exists (
      select 1
      from unnest(v_classified) signature
      where to_regprocedure(signature) = p.oid
    )
  limit 1;
  if v_unknown is not null then
    raise exception 'DB4_M3_RPC_UNCLASSIFIED:%', v_unknown;
  end if;
end
$m3_surface_classification$;

\echo DB4_M3_SURFACE_CLASSIFICATION_OK
