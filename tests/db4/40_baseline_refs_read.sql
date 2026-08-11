\set ON_ERROR_STOP on

-- Чтение v9 (`20260810090000`): состав опубликованного baseline становится
-- видимым, потому что выпуск производственной версии обязан строиться от него,
-- а не от «всего одобренного сейчас».
--
-- Здесь проверяется три вещи, и каждая — про то, что уже ломалось раньше:
--   * состав отдаётся ПОЛНОСТЬЮ и ровно тот, что записан в
--     `project_baseline_refs` — иначе корневой пакет упрётся в
--     `ROOT_PACKAGE_REQUIRES_FULL_BASELINE`;
--   * порядок внутри групп — по кодовым точкам, как у
--     `_sorted_unique_text_array`, иначе хеш сборщика разойдётся с хешем RPC;
--   * v8 остаётся нетронутой — версионированный контракт чтения не переписывают
--     под новую нужду.
--
-- Чтение идёт под ролью `authenticated`, а сверка с хранилищем — снаружи неё:
-- приватная `projectceo_product` этой роли закрыта, и это часть контракта, а не
-- помеха тесту. Первая редакция сценария сверяла изнутри и справедливо
-- получила `permission denied` — проверка обязана уважать ту же границу, что и
-- продукт.
--
-- Предпосылка: `20_product_operations.sql` уже опубликовал `baseline-db4-v1`.

-- Результат чтения переносится через временную таблицу, а не через переменную
-- psql: подстановка `:'var'` внутри `$$`-тела не работает, а держать чтение и
-- сверку в одной транзакции нельзя — у них разные роли.
create temp table db4_baseline_refs_read (v9 jsonb, v8 jsonb, v9_package jsonb);
grant insert on db4_baseline_refs_read to authenticated;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
insert into db4_baseline_refs_read (v9, v8, v9_package)
select
  projectceo_read_api.get_project_workspace_read_v9(
    '41111111-1111-4111-8111-111111111111',
    null
  ),
  projectceo_read_api.get_project_workspace_read_v8(
    '41111111-1111-4111-8111-111111111111',
    null
  ),
  -- То же чтение, но областью пакета: состав baseline описан ревизиями без
  -- привязки к пакету, поэтому сузить его нельзя — и отдавать полный тому, кто
  -- видит один пакет, тоже нельзя.
  projectceo_read_api.get_project_workspace_read_v9(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111'
  );
commit;

do $baseline_refs_read$
declare
  v_v9 jsonb;
  v_v8 jsonb;
  v_v9_package jsonb;
  v_refs jsonb;
  v_expected jsonb;
  v_kind text;
begin
  select read.v9, read.v8, read.v9_package
    into v_v9, v_v8, v_v9_package
  from db4_baseline_refs_read read;
  if v_v9 -> 'error' is not null and v_v9 -> 'error' <> 'null'::jsonb then
    raise exception 'DB4_BASELINE_REFS_READ_ERROR %', v_v9 -> 'error';
  end if;

  v_refs := v_v9 #> '{data,latestBaseline,exactRevisionRefs}';
  if v_refs is null then
    raise exception 'DB4_BASELINE_REFS_MISSING';
  end if;

  -- Ожидание строится из самой таблицы: тест сверяет чтение с хранилищем, а не
  -- с переписанным от руки списком, который разъедется вместе с фикстурой.
  for v_kind, v_expected in
    select mapping.json_key, coalesce(
      (
        select jsonb_agg(ref.revision_id order by ref.revision_id collate "C")
        from projectceo_product.project_baseline_refs ref
        where ref.organization_id = (v_v9 #>> '{scope,organizationId}')::uuid
          and ref.project_id = '41111111-1111-4111-8111-111111111111'
          and ref.baseline_id = v_v9 #>> '{data,latestBaseline,id}'
          and ref.target_kind = mapping.target_kind
      ),
      '[]'::jsonb
    )
    from (values
      ('sources', 'source_revision'),
      ('requirements', 'requirement_revision'),
      ('assumptions', 'assumption_revision'),
      ('decisions', 'decision_revision'),
      ('selections', 'selection_revision')
    ) mapping(json_key, target_kind)
  loop
    if v_refs -> v_kind is distinct from v_expected then
      raise exception 'DB4_BASELINE_REFS_MISMATCH % read=% stored=%',
        v_kind, v_refs -> v_kind, v_expected;
    end if;
  end loop;

  -- Baseline фикстуры не пуст. Без этой проверки сверка выше прошла бы и на
  -- полностью пустом чтении, если бы хранилище тоже оказалось пустым.
  if jsonb_array_length(v_refs -> 'decisions')
     + jsonb_array_length(v_refs -> 'selections')
     + jsonb_array_length(v_refs -> 'sources') = 0 then
    raise exception 'DB4_BASELINE_REFS_EMPTY';
  end if;

  -- v8 не трогали: поле появляется только в v9.
  if v_v8 #> '{data,latestBaseline,exactRevisionRefs}' is not null then
    raise exception 'DB4_BASELINE_REFS_LEAKED_INTO_V8';
  end if;

  -- Область пакета: состава нет вовсе. Первая редакция миграции отдавала здесь
  -- полный состав baseline, то есть идентификаторы ревизий соседних пакетов
  -- участнику, который имеет доступ к одному.
  if v_v9_package #> '{data,latestBaseline,exactRevisionRefs}' is not null then
    raise exception 'DB4_BASELINE_REFS_LEAKED_TO_PACKAGE_SCOPE';
  end if;
end
$baseline_refs_read$;

drop table db4_baseline_refs_read;

\echo DB4_BASELINE_REFS_READ_OK
