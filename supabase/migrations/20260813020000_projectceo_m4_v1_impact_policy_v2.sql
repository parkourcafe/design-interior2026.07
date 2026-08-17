-- V1 Impact: policy v2 — corrects maxDepth to the value fixed by the original
-- OWNER GO (7), additively, without touching the immutable migration that
-- introduced the wrong number.
--
-- Основание: OWNER REVIEW 12.08.2026 (поверх DEC-034). Исходный OWNER GO на
-- V1 Impact зафиксировал `maxDepth = 7`. Слитая параллельной сессией миграция
-- `20260812010000` записала в `_impact_policy()` `maxDepth = 8` — числовая
-- ошибка при переносе решения в код, не переоткрытие вопроса. Согласно
-- `docs/canonical/remhaos-v1/REMHAOS_MIGRATION_ERRATA.md` (правило вверху
-- файла): ошибка ТЕКСТА миграции лечится записью в errata; ошибка ПОВЕДЕНИЯ
-- лечится новой миграцией. Это — ошибка поведения: число, которым живая база
-- считает влияние, обязано стать 7, а не только документ, который это
-- утверждает.
--
-- `20260813010000` (DEC-034) неизменяема тем же правилом — эта миграция её не
-- трогает и не трогает `20260812010000/020000/030000`.
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ. Ровно одно: `create or replace function
-- projectceo_m4._impact_policy()`, начиная жить под новой версией
-- (`project-ceo-impact-policy/0.2`) с `maxDepth = 7`, `maxImpacts = 5000`
-- (без изменений — граница результата, а не глубины, вопросом не была).
-- `CREATE OR REPLACE FUNCTION` сохраняет OID, владельца и все выданные права
-- функции без изменений — ни `alter … owner to`, ни `grant`/`revoke` этой
-- функции повторять не нужно, они уже стоят с `20260812010000`.
--
-- Все вызывающие эту функцию — `calculate_change_impact_policy_bound()` и
-- `list_change_impact_backlog()` (обе в `20260812010000`) — читают
-- `_impact_policy()` заново при каждом вызове, а не кешируют её в момент
-- своего создания: новая глубина действует немедленно после применения этой
-- миграции, без переопределения обёрток.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни одна уже сохранённая строка `projectceo_m4.impact_runs`
-- не меняется: у неё уже есть собственные `policy_version`/`max_depth`,
-- записанные в момент расчёта, и эта миграция таблицу не трогает вообще —
-- только функцию, от которой зависят БУДУЩИЕ расчёты. Старые прогоны (если
-- есть) остаются подписаны `project-ceo-impact-policy/0.1` / `maxDepth = 8`
-- ровно потому, что колонки таблицы — не производные от текущего состояния
-- функции, а снятые с неё копии на момент вызова.

begin;

create or replace function projectceo_m4._impact_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'version', 'project-ceo-impact-policy/0.2',
    'maxDepth', 7,
    'maxImpacts', 5000
  )
$function$;

do $guard$
declare
  v_policy jsonb := projectceo_m4._impact_policy();
  v_problem text;
begin
  -- 1. Живая политика — ровно то число, которое зафиксировал OWNER GO, а не
  --    прежнее и не какое-то третье.
  if v_policy ->> 'version' is distinct from 'project-ceo-impact-policy/0.2'
     or (v_policy ->> 'maxDepth')::integer is distinct from 7
     or (v_policy ->> 'maxImpacts')::integer is distinct from 5000 then
    raise exception 'PROJECTCEO_M4_IMPACT_POLICY_V2_WRONG_SHAPE:%', v_policy;
  end if;

  -- 2. Замена определения функции не имеет права задеть её права: обёртки
  --    воркера остаются системными, человеческие роли к самой политике
  --    по-прежнему не подпущены.
  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4._impact_policy()',
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_POLICY_V2_LEAKED_TO_HUMAN_ROLE:%', v_problem;
  end if;

  select signature into v_problem
  from unnest(array[
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where not pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'PROJECTCEO_M4_IMPACT_POLICY_V2_LOST_SYSTEM_GRANT:%', v_problem;
  end if;
end
$guard$;

commit;
