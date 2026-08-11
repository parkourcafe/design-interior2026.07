\set ON_ERROR_STOP on

-- Материализация артефакта выпуска СИСТЕМОЙ, а не человеком.
--
-- Зачем этот файл существует. Гейт 2 (A6 §6.1) требует провести через браузер
-- `distribute_release`, а выдача адресуется артефакту:
-- `distribute_release_request_bound` ищет строку в
-- `projectceo_product.release_artifacts` и без неё отвечает
-- `P1104 not_found {"entity":"releaseArtifact"}`. Собирает эту строку
-- `projectceo_product_api.build_release_artifact` — операция СИСТЕМНАЯ:
-- права на неё есть только у `service_role`, а запись помечается
-- `created_by_id = 'system:projectceo-product-worker'`.
--
-- Отсюда находка гейта, записанная в `AP5_RUNBOOK.md`: утверждение A6 §1.1
-- «у инкремента 1 нет воркерных предпосылок» верно для двух команд из трёх.
-- У выдачи предпосылка есть, и она воркерная.
--
-- Что здесь НЕ происходит: ни одна человеческая операция не выполняется от
-- имени service_role. Скрипт делает ровно то, что в продакшене делает воркер
-- продуктового мозга, и ничего сверх; сами `distribute_release`,
-- `acknowledge_release` и `create_change` идут через браузер настоящими
-- сессиями настоящих ролей.
--
-- Содержимое артефакта повторяет то, что собирает сама RPC (`20260717101000`),
-- потому что она сверяет семантический хеш с переданным и отказывает при
-- расхождении. Расхождение здесь означает, что RPC изменилась, — и тогда
-- скрипт обязан упасть, а не подогнать значение.

select state_revision as state_revision,
  organization_id as organization_id
from project_intelligence.project_workflows
where project_id = :'project_id'::uuid
\gset ap5_

select jsonb_build_object(
  'artifactId', :'artifact_id',
  'productionPackageVersionId', :'version_id',
  'format', 'logical_json',
  'semanticHash', 'sha256:' || encode(
    project_intelligence._sha256_jsonb(jsonb_build_object(
      'artifacts', jsonb_build_array(jsonb_build_object(
        'contentHash', 'sha256:' || encode(ppv.semantic_digest, 'hex'),
        'kind', 'logical_json'
      )),
      'baselineId', ppv.baseline_id,
      'exactRevisionRefs', ppv.semantic_content -> 'exactRevisionRefs',
      'organizationId', ppv.organization_id,
      'packageId', ppv.package_id,
      'productionPackageSemanticHash',
        'sha256:' || encode(ppv.semantic_digest, 'hex'),
      'productionPackageVersionId', ppv.production_package_version_id,
      'projectId', ppv.project_id,
      'schemaVersion', 'project-ceo-release/0.1'
    )),
    'hex'
  )
) as descriptor
from projectceo_product.production_package_versions ppv
where ppv.organization_id = :'ap5_organization_id'::uuid
  and ppv.project_id = :'project_id'::uuid
  and ppv.production_package_version_id = :'version_id'
\gset ap5_

begin;
set local role service_role;
select projectceo_product_api.build_release_artifact(
  :'project_id'::uuid,
  :'ap5_descriptor'::jsonb,
  :'ap5_state_revision'::bigint,
  :'idempotency_key'
);
commit;

-- Проверка результата. Подстановка psql внутрь тела `do $$ … $$` не работает —
-- урок сессии 11.08, — поэтому значения кладутся в настройки сеанса, а тело
-- читает их через `current_setting`.
select set_config('projectceo.ap5_project_id', :'project_id', false);
select set_config('projectceo.ap5_artifact_id', :'artifact_id', false);

do $artifact_materialized$
begin
  if not exists (
    select 1
    from projectceo_product.release_artifacts ra
    where ra.project_id = current_setting('projectceo.ap5_project_id')::uuid
      and ra.artifact_id = current_setting('projectceo.ap5_artifact_id')
  ) then
    raise exception 'AP5_RELEASE_ARTIFACT_NOT_MATERIALIZED';
  end if;
end
$artifact_materialized$;

\echo AP5_RELEASE_ARTIFACT_OK
