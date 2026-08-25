\set ON_ERROR_STOP on

-- Авторитетный DB-state включения модулей M3 / M4-инкремент-1
-- (`20260824150000`): выключатель существует, закрыт по умолчанию, недостижим
-- прикладными ролями, журналирует actor/basis и переключает права фактически.
--
-- Сценарий стоит ПОСЛЕ enable-скриптов среды намеренно: харнесс — это среда,
-- где модули открыты грантами одноразовых скриптов, а журнал выключателя пуст.
-- Ровно это расхождение сценарий и фиксирует первым: гранты среды не пишут
-- журнал, значит миграция не могла «включить» модуль сама — ей нечем.

-- 1. Журнал пуст: применение миграции не оставило ни одной записи ни по
-- одному модулю. «Открыт» без записи в журнале это состояние среды, а не
-- решение владельца — is_module_open обязан отвечать false.
do $journal_empty_after_migration$
begin
  if exists (select 1 from projectceo_platform.module_switch_log) then
    raise exception 'DB4_PLATFORM_SWITCH_JOURNAL_NOT_EMPTY_AFTER_MIGRATION';
  end if;
  if projectceo_platform.is_module_open('m3') then
    raise exception 'DB4_PLATFORM_SWITCH_M3_OPEN_ON_EMPTY_JOURNAL';
  end if;
  if projectceo_platform.is_module_open('m4_increment_1') then
    raise exception 'DB4_PLATFORM_SWITCH_M4_OPEN_ON_EMPTY_JOURNAL';
  end if;
end
$journal_empty_after_migration$;

-- 2. Выключатель недостижим прикладными ролями — ни операции, ни журнал.
do $switch_unreachable_by_app_roles$
declare
  v_leaked text;
begin
  select format('%s:%s', role_name, signature) into v_leaked
  from unnest(array[
    'anon', 'authenticated', 'service_role',
    'pi_human_executor', 'pi_worker_executor'
  ]) role_name
  cross join unnest(array[
    'projectceo_platform.open_module_production(text, text, text)',
    'projectceo_platform.close_module_production(text, text, text)',
    'projectceo_platform.module_production_state(text)',
    'projectceo_platform.is_module_open(text)',
    'projectceo_platform._module_signatures(text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_PLATFORM_SWITCH_FUNCTION_REACHABLE:%', v_leaked;
  end if;

  select role_name into v_leaked
  from unnest(array[
    'anon', 'authenticated', 'service_role',
    'pi_human_executor', 'pi_worker_executor'
  ]) role_name
  where pg_catalog.has_table_privilege(
    role_name, 'projectceo_platform.module_switch_log', 'SELECT'
  )
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_PLATFORM_SWITCH_JOURNAL_READABLE:%', v_leaked;
  end if;
end
$switch_unreachable_by_app_roles$;

-- Права — утверждение о доступе; ниже сам доступ: живой вызов из-под
-- `authenticated` обязан упереться в 42501 до тела функции.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $switch_denied_live$
begin
  begin
    perform projectceo_platform.open_module_production(
      'm3', 'db4-probe', 'db4-probe'
    );
    raise exception 'DB4_PLATFORM_SWITCH_OPEN_REACHED_BY_AUTHENTICATED';
  exception
    when insufficient_privilege then null;
  end;
end
$switch_denied_live$;
rollback;

-- 3. Валидация входа: пустой actor, пустое основание, неизвестный модуль.
do $switch_input_validation$
begin
  begin
    perform projectceo_platform.open_module_production('m3', '  ', 'basis');
    raise exception 'DB4_PLATFORM_SWITCH_EMPTY_ACTOR_ACCEPTED';
  exception when others then
    if sqlerrm not like 'PROJECTCEO_PLATFORM_SWITCH_ACTOR_REQUIRED%' then
      raise;
    end if;
  end;

  begin
    perform projectceo_platform.open_module_production('m3', 'actor', null);
    raise exception 'DB4_PLATFORM_SWITCH_EMPTY_BASIS_ACCEPTED';
  exception when others then
    if sqlerrm not like 'PROJECTCEO_PLATFORM_SWITCH_BASIS_REQUIRED%' then
      raise;
    end if;
  end;

  begin
    perform projectceo_platform.open_module_production('m5', 'actor', 'basis');
    raise exception 'DB4_PLATFORM_SWITCH_UNKNOWN_MODULE_ACCEPTED';
  exception when others then
    if sqlerrm not like 'PROJECTCEO_PLATFORM_MODULE_UNKNOWN%' then
      raise;
    end if;
  end;

  -- Валидация отказывает ДО записи: журнал обязан остаться пустым.
  if exists (select 1 from projectceo_platform.module_switch_log) then
    raise exception 'DB4_PLATFORM_SWITCH_JOURNAL_WRITTEN_ON_REJECTED_INPUT';
  end if;
end
$switch_input_validation$;

-- 4. Цикл close → open для M3: закрытие фактически отзывает права, открытие
-- фактически возвращает, обе операции пишут журнал с actor/basis.
do $m3_close_open_cycle$
declare
  v_leaked text;
  v_missing text;
  v_row record;
begin
  perform projectceo_platform.close_module_production(
    'm3', 'DB4 harness', 'сценарий 49: проверка отзыва прав закрытием'
  );

  select signature into v_leaked
  from unnest(projectceo_platform._module_signatures('m3')) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_PLATFORM_SWITCH_M3_STILL_GRANTED_AFTER_CLOSE:%', v_leaked;
  end if;
  if projectceo_platform.is_module_open('m3') then
    raise exception 'DB4_PLATFORM_SWITCH_M3_OPEN_AFTER_CLOSE';
  end if;

  perform projectceo_platform.open_module_production(
    'm3', 'DB4 harness', 'сценарий 49: возврат среды харнесса к открытому M3'
  );

  select signature into v_missing
  from unnest(projectceo_platform._module_signatures('m3')) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'DB4_PLATFORM_SWITCH_M3_NOT_GRANTED_AFTER_OPEN:%', v_missing;
  end if;
  if not projectceo_platform.is_module_open('m3') then
    raise exception 'DB4_PLATFORM_SWITCH_M3_CLOSED_AFTER_OPEN';
  end if;

  -- Журнал: две записи модуля m3, последняя по entry_no — open, у обеих
  -- непустые actor/basis.
  select log.action, log.actor, log.basis into v_row
  from projectceo_platform.module_switch_log log
  where log.module = 'm3'
  order by log.entry_no desc
  limit 1;
  if v_row.action is distinct from 'open'
    or v_row.actor is distinct from 'DB4 harness'
    or v_row.basis is null or btrim(v_row.basis) = '' then
    raise exception 'DB4_PLATFORM_SWITCH_M3_JOURNAL_LAST_ENTRY_WRONG:%',
      coalesce(v_row.action, 'null');
  end if;
  if (select count(*) from projectceo_platform.module_switch_log
      where module = 'm3') <> 2 then
    raise exception 'DB4_PLATFORM_SWITCH_M3_JOURNAL_COUNT_WRONG';
  end if;

  -- module_production_state сводит обе стороны: право и журнал.
  select state.open_now, state.last_action into v_row
  from projectceo_platform.module_production_state('m3') state;
  if not v_row.open_now or v_row.last_action is distinct from 'open' then
    raise exception 'DB4_PLATFORM_SWITCH_M3_STATE_MISMATCH';
  end if;
end
$m3_close_open_cycle$;

-- 5. Тот же цикл для M4-инкремент-1 + границы поражения: закрытие/открытие
-- инкремента 1 не трогает ни вертикаль V1 (открыта отдельным скриптом среды),
-- ни инкремент 2 (закрыт всюду).
do $m4_close_open_cycle$
declare
  v_leaked text;
  v_missing text;
begin
  perform projectceo_platform.close_module_production(
    'm4_increment_1', 'DB4 harness', 'сценарий 49: проверка отзыва прав закрытием'
  );

  select signature into v_leaked
  from unnest(projectceo_platform._module_signatures('m4_increment_1')) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_PLATFORM_SWITCH_M4_STILL_GRANTED_AFTER_CLOSE:%', v_leaked;
  end if;

  -- V1 Impact открыт скриптом среды и закрытием инкремента 1 не задет.
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'DB4_PLATFORM_SWITCH_M4_CLOSE_TOUCHED_V1_IMPACT';
  end if;

  perform projectceo_platform.open_module_production(
    'm4_increment_1', 'DB4 harness',
    'сценарий 49: возврат среды харнесса к открытому инкременту 1'
  );

  select signature into v_missing
  from unnest(projectceo_platform._module_signatures('m4_increment_1')) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'DB4_PLATFORM_SWITCH_M4_NOT_GRANTED_AFTER_OPEN:%', v_missing;
  end if;

  -- Инкремент 2 остался закрытым — открытие инкремента 1 не расширило его.
  select signature into v_leaked
  from unnest(array[
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'DB4_PLATFORM_SWITCH_M4_INCREMENT_2_LEAKED:%', v_leaked;
  end if;
end
$m4_close_open_cycle$;

select 'DB4_PLATFORM_MODULE_SWITCH_OK' as result;
