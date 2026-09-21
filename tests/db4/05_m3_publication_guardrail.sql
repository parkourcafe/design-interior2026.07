\set ON_ERROR_STOP on

-- Прямой обход приложения через Data API: публикация M3 при выключенном модуле.
--
-- Условие владельца от 11.08: «если закрывается только Next.js-команда, условие
-- не выполнено». Флаг `REMHAOS_DOCUMENTATION_ENABLED` живёт в TypeScript, а
-- вызов PostgREST до TypeScript не доходит — значит проверять надо здесь, из-под
-- роли `authenticated`, ровно так, как это сделал бы владелец сессии со своим
-- access token.
--
-- Сценарий стоит ПЕРВЫМ среди продуктовых намеренно: он обязан наблюдать
-- состояние сразу после цепочки миграций, где guardrail `20260811010000` уже
-- отозвал права, а среда ещё ничего не включала. Если поставить его после
-- операций модуля, он мерил бы уже открытую базу и не значил бы ничего.
--
-- В конце сценарий включает публикацию (`enable-m3-publication.sql`), потому
-- что дальше по цепочке идут сценарии, которые публикуют baseline и версии
-- пакета. Это не обход запрета, а моделирование среды, где модуль намеренно
-- открыт: два выключателя, и здесь виден второй.

do $publication_closed_by_default$
declare
  v_reachable text;
begin
  select signature into v_reachable
  from unnest(array[
    'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)',
    'projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text)',
    'projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text)',
    'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
    'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
    'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)',
    'projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB4_M3_PUBLICATION_GRANTED_BY_DEFAULT:%', v_reachable;
  end if;
end
$publication_closed_by_default$;

-- Права — это утверждение о доступе. Ниже проверяется сам доступ: семь реальных
-- вызова из-под роли, каждый обязан упереться в 42501 insufficient_privilege
-- ДО того, как дойдёт до тела функции. Аргументы намеренно бессмысленные:
-- если отказ придёт не по правам, а по содержимому, значит вызов состоялся, и
-- сценарий обязан упасть.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $direct_calls_denied$
declare
  v_denied int := 0;
begin
  begin
    perform projectceo_api.publish_version(
      '41111111-1111-4111-8111-111111111111', null, 1,
      'db4-guardrail-probe', '[]'::jsonb, 'db4-guardrail-probe'
    );
    raise exception 'DB4_M3_PUBLISH_VERSION_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_product_api.publish_project_baseline(
      '41111111-1111-4111-8111-111111111111', '{}'::jsonb, 1, 'db4-guardrail-probe'
    );
    raise exception 'DB4_M3_PUBLISH_BASELINE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_product_api.publish_production_package_version(
      '41111111-1111-4111-8111-111111111111', '{}'::jsonb, 1, 'db4-guardrail-probe'
    );
    raise exception 'DB4_M3_PUBLISH_VERSION_PACKAGE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_api.review_source(
      '41111111-1111-4111-8111-111111111111', 'probe', 'probe', 1,
      'confirmed', 'db4-guardrail-probe'
    );
    raise exception 'DB4_M3_REVIEW_SOURCE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_m3_api.register_documentation_sheet(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'probe', 'probe', 'probe', 'probe', 'probe', 'probe',
      array[]::text[], 'db4-guardrail-probe', 1, 'db4-guardrail-probe'
    );
    raise exception 'DB4_M3_REGISTER_SHEET_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_m3_api.attach_documentation_sheet_specifications(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'probe', 'probe', 'probe',
      array[]::text[], 'db4-guardrail-probe', 1, 'db4-guardrail-probe'
    );
    raise exception 'DB4_M3_ATTACH_SPECS_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    perform projectceo_product_api.attach_external_release_refs(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'probe','probe','[]'::jsonb,1,'db4-guardrail-external-candidate'
    );
    raise exception 'DB4_M3_EXTERNAL_CANDIDATE_REACHED';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
  end;

  if v_denied <> 7 then
    raise exception 'DB4_M3_PUBLICATION_DENIALS_EXPECTED_7_GOT_%', v_denied;
  end if;
end
$direct_calls_denied$;
rollback;

-- Точечность: закрыта публикация, а не работа модуля. Решения, одобрения и
-- чтение рабочего пространства обязаны остаться доступными той же роли —
-- иначе guardrail не защищает, а ломает.
do $neighbours_intact$
declare
  v_broken text;
begin
  select signature into v_broken
  from unnest(array[
    'projectceo_product_api.append_decision_revision(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text, bigint, text)',
    'projectceo_product_api.create_approval_package(uuid, uuid, text, jsonb, bigint, text)',
    'projectceo_product_api.review_approval_package(uuid, text, text, text, text, bigint, text)',
    'projectceo_read_api.get_project_workspace_read_v9(uuid, uuid)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_broken is not null then
    raise exception 'DB4_M3_GUARDRAIL_OVERREACHED:%', v_broken;
  end if;
end
$neighbours_intact$;

\echo DB4_M3_PUBLICATION_GUARDRAIL_OK

-- Дальше по цепочке модуль нужен открытым: сценарии ниже публикуют baseline и
-- версии пакета. Включение — отдельным файлом в `run.zsh`
-- (`tests/ap1/environment/enable-m3-publication.sql`), тем же самым, который
-- исполняет среда AP5. Через `\i` его подключить нельзя: psql работает внутри
-- контейнера, где репозитория нет.
