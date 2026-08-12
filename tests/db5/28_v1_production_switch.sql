\set ON_ERROR_STOP on

-- Производственный выключатель V1 Impact против настоящей базы.
--
-- ЗАЧЕМ СЦЕНАРИЙ. Выключатель — это код, который выполняется один раз в жизни
-- продукта, в самый неудобный момент, руками. Ровно такой код и обязан иметь
-- прогон: ошибка в нём обнаружилась бы иначе на живой базе, где «открыть» и
-- «закрыть» уже нельзя порепетировать.
--
-- ЧТО ДОКАЗЫВАЕТСЯ. Что открытие открывает ровно три двери и записывает, кто и
-- на каком основании; что закрытие снимает права у обеих прикладных ролей и
-- тоже записывается; что открытие ПАДАЕТ, если рядом просочилась команда V2;
-- что без действующего лица и основания открыть нельзя; и что сам выключатель
-- не доступен ни одной прикладной роли.
--
-- ПОРЯДОК. Сценарий стоит после `27_impact_concurrency_fixture.sql` и обязан
-- оставить вертикаль ОТКРЫТОЙ: `90_default_deny_after.sql` проверяет состояние,
-- которое установил `enable-m4-v1-impact.sql`, и сценарий не имеет права его
-- менять за спиной у следующего файла.

do $v1_production_switch$
declare
  v_signatures text[] := array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)',
    'projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)'
  ];
  v_problem text;
  v_open boolean;
  v_action text;
  v_actor text;
  v_basis text;
  v_entry_id uuid;
  v_count integer;
begin
  -- 0. Сам выключатель невидим прикладным ролям. Механизм, до которого можно
  --    дотянуться через Data API, был бы не выключателем, а кнопкой.
  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4.open_v1_impact_production(text, text)',
    'projectceo_m4.close_v1_impact_production(text, text)',
    'projectceo_m4.v1_impact_production_state()'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_V1_SWITCH_REACHABLE:%', v_problem;
  end if;

  -- 1. Исходное состояние — открыто скриптом среды. Читаем его функцией
  --    состояния: она и есть то, чем мониторинг будет смотреть на production.
  select open_now into v_open from projectceo_m4.v1_impact_production_state();
  if not v_open then
    raise exception 'DB5_V1_SWITCH_EXPECTED_OPEN_BEFORE';
  end if;

  -- 2. Закрытие — команда отката. Проверяем не «функция не упала», а права в
  --    базе: у обеих прикладных ролей.
  v_entry_id := projectceo_m4.close_v1_impact_production(
    'DB5 harness', 'откат проверяется прогоном, а не обещанием'
  );

  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(v_signatures) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_V1_SWITCH_CLOSE_LEFT_RIGHTS:%', v_problem;
  end if;

  select open_now into v_open from projectceo_m4.v1_impact_production_state();
  if v_open then
    raise exception 'DB5_V1_SWITCH_STATE_LIES_AFTER_CLOSE';
  end if;

  select action, actor, basis into v_action, v_actor, v_basis
  from projectceo_m4.production_switch_log
  where entry_id = v_entry_id;
  if v_action is distinct from 'close'
    or v_actor is distinct from 'DB5 harness'
    or v_basis is null
  then
    raise exception 'DB5_V1_SWITCH_CLOSE_NOT_LOGGED';
  end if;

  -- 3. Открытие обязано падать, если рядом просочилась команда V2. Утечка
  --    создаётся здесь же и откатывается вместе с подтранзакцией блока —
  --    проверять радиус поражения на живой утечке нельзя, а на воображаемой
  --    бессмысленно.
  begin
    grant execute on function
      projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)
      to authenticated;
    perform projectceo_m4.open_v1_impact_production(
      'DB5 harness', 'проверка радиуса поражения'
    );
    raise exception 'DB5_V1_SWITCH_BLAST_RADIUS_NOT_ENFORCED';
  exception
    when others then
      if sqlerrm not like 'PROJECTCEO_M4_V2_V3_LEAKED_BY_V1%' then
        raise;
      end if;
  end;

  -- Утечка и вместе с ней частично выданные права V1 откатились: и то и другое
  -- было в одной подтранзакции.
  if pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'DB5_V1_SWITCH_LEAK_SURVIVED_ROLLBACK';
  end if;

  select signature into v_problem
  from unnest(v_signatures) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_V1_SWITCH_PARTIAL_OPEN_SURVIVED:%', v_problem;
  end if;

  -- 4. Без действующего лица и без основания открыть нельзя. Это и есть
  --    «аудируемый DB-state» DEC-029: запись, из которой не видно, кто и
  --    почему, ничем не лучше отсутствия записи.
  begin
    perform projectceo_m4.open_v1_impact_production('   ', 'основание есть');
    raise exception 'DB5_V1_SWITCH_ACTOR_NOT_REQUIRED';
  exception
    when others then
      if sqlerrm not like 'PROJECTCEO_M4_V1_SWITCH_ACTOR_REQUIRED%' then
        raise;
      end if;
  end;

  begin
    perform projectceo_m4.open_v1_impact_production('Selena', '   ');
    raise exception 'DB5_V1_SWITCH_BASIS_NOT_REQUIRED';
  exception
    when others then
      if sqlerrm not like 'PROJECTCEO_M4_V1_SWITCH_BASIS_REQUIRED%' then
        raise;
      end if;
  end;

  -- 5. Открытие. После него — ровно три двери у `authenticated`, ни одной у
  --    `anon`, и воркерный контур по-прежнему системный.
  v_entry_id := projectceo_m4.open_v1_impact_production(
    'DB5 harness',
    'M4 V1 IMPACT PRODUCTION GO 12.08.2026 (репетиция в одноразовой среде)'
  );

  select signature into v_problem
  from unnest(v_signatures) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_V1_SWITCH_OPEN_INCOMPLETE:%', v_problem;
  end if;

  select signature into v_problem
  from unnest(v_signatures) signature
  where pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_V1_SWITCH_OPENED_FOR_ANON:%', v_problem;
  end if;

  select format('%s:%s', role_name, signature) into v_problem
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.calculate_change_impact(uuid, uuid, integer, bigint, text)',
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid, uuid, bigint, text)',
    'projectceo_m4_api.list_change_impact_backlog(integer)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_problem is not null then
    raise exception 'DB5_V1_SWITCH_OPENED_THE_WORKER:%', v_problem;
  end if;

  select open_now into v_open from projectceo_m4.v1_impact_production_state();
  if not v_open then
    raise exception 'DB5_V1_SWITCH_STATE_LIES_AFTER_OPEN';
  end if;

  select action into v_action
  from projectceo_m4.production_switch_log
  where entry_id = v_entry_id;
  if v_action is distinct from 'open' then
    raise exception 'DB5_V1_SWITCH_OPEN_NOT_LOGGED';
  end if;

  -- Последним действием обязано считаться открытие. Проверка не лишняя:
  -- первая редакция функции состояния сортировала журнал по времени, а
  -- закрытие и открытие выше происходят внутри ОДНОГО оператора — время у них
  -- совпадало, и «последним» становилось случайное из двух.
  select last_action into v_action
  from projectceo_m4.v1_impact_production_state();
  if v_action is distinct from 'open' then
    raise exception 'DB5_V1_SWITCH_STATE_LAST_ACTION:%', coalesce(v_action, '(null)');
  end if;

  -- 6. Журнал накапливает историю, а не заменяет последнюю запись: закрытие и
  --    открытие обязаны остаться оба. Неудачные попытки из шагов 3 и 4 в
  --    журнал не попали — они откатились вместе с подтранзакцией.
  select count(*) into v_count
  from projectceo_m4.production_switch_log
  where vertical = 'v1_impact';
  if v_count <> 2 then
    raise exception 'DB5_V1_SWITCH_LOG_UNEXPECTED_ROWS:%', v_count;
  end if;
end
$v1_production_switch$;
