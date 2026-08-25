-- Авторитетный DB-state включения модулей M3 и M4-инкремент-1 — один
-- механизм вместо скрипта одноразовой среды (M3 backlog #2/#8, M4 backlog #3).
--
-- ЗАЧЕМ ОДНА МИГРАЦИЯ НА ДВА МОДУЛЯ. `20260812030000` уже построила ровно этот
-- рисунок — журнал переключений, actor/basis обязательны, guard закрывает
-- модуль при применении миграции — но для ОДНОЙ вертикали (`v1_impact`),
-- захардкоженной в имени и в списке сигнатур. M3 backlog (предпосылка пунктов
-- #2 и #8) и M4 backlog #6 требуют того же свойства для module = 'm3' и
-- module = 'm4_increment_1'. Три копии одного файла с разными строковыми
-- константами — не три источника истины, а один источник, переписанный трижды;
-- к третьей копии они разойдутся. Здесь тот же механизм параметризован полем
-- `module`, а не продублирован. `v1_impact` эта миграция не трогает: у него уже
-- есть свой аудируемый выключатель, мигрировать рабочий production-контур без
-- нужды — лишний риск, которого задача не просит.
--
-- ЧТО ЭТА МИГРАЦИЯ ДЕЛАЕТ. Журнал переключений на два модуля плюс операции
-- open/close/state, идентичные по свойствам `open_v1_impact_production` /
-- `close_v1_impact_production` / `v1_impact_production_state`:
--   * actor и basis обязательны и непусты — решение без подписи невозможно;
--   * право проверяется по факту (`has_function_privilege`), а не по тому, что
--     `grant`/`revoke` не упали;
--   * применение МИГРАЦИИ не открывает ни один модуль ни в одной среде — оба
--     закрываются принудительно в конце файла;
--   * открыть/закрыть может только человек с прямым доступом к базе
--     (`pi_table_owner`) — `execute` отозван у всех прикладных ролей.
--
-- ЧТО ДОБАВЛЕНО СВЕРХ ПРЕЦЕДЕНТА: `is_module_open(module)`. Двери публикации
-- M3 (`publish_project_baseline` и т.д.) можно закрыть отзывом права — их
-- потребитель один, модуль. Читающие RPC (`get_project_workspace_read_v*`)
-- закрыть отзывом права НЕЛЬЗЯ: они общие с M1/M2, и отзыв уронил бы весь
-- рабочий стол. Их гейт — не право, а вопрос внутри тела функции: «модуль
-- открыт?». `is_module_open` — авторитетный ответ на этот вопрос, дешёвый
-- (индекс по `entry_no`), не пересекающийся с проверкой прав. Читает
-- последнюю запись журнала, а не сравнивает списки прав: у читающих RPC нет
-- сигнатур, чьи права можно было бы сверить.
--
-- ЧЕГО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ. Не отзывает и не выдаёт права сверх списков
-- сигнатур ниже (списки скопированы из `tests/ap1/environment/
-- enable-m3-publication.sql` и `enable-m4-increment-1.sql` — те скрипты
-- остаются механизмом одноразовой среды AP1/AP5, эта миграция их не заменяет
-- и не трогает: файлы принадлежат зоне Потока 1 по координационному протоколу
-- Фазы 3, §1.1). Не выполняет M3 backlog #8 (отзыв сырых descriptor-RPC в
-- пользу двери оркестрации) — эта дверь ещё не существует (M3 backlog #6/#7,
-- отдельная миграция); список `_module_signatures('m3')` обновится вместе с
-- ней. Не включает ни один модуль ни в одной среде — открытие остаётся
-- решением владельца, записанным в этот журнал.

begin;

set local check_function_bodies = on;

-- Схему первой создаёт `20260824130000` (платформенный фундамент A1,
-- Фаза 2) — эта миграция шла раньше по номеру, но после слияния веток
-- перенумерована позже неё; создание оставлено терпимым, revoke ниже
-- идемпотентен и ужесточает исполнителей сверх набора A1.
create schema if not exists projectceo_platform authorization pi_table_owner;
revoke all on schema projectceo_platform
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_platform
  revoke all on tables from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_platform
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Журнал переключений, оба модуля. Тот же контур безопасности и тот же выбор
-- `entry_no` вместо времени как тай-брейка, что у `production_switch_log`
-- (`20260812030000`) — открыть и закрыть можно в одном операторе, и
-- `clock_timestamp()` внутри него не обязана различать порядок надёжнее, чем
-- отдельный счётчик.
create table projectceo_platform.module_switch_log (
  entry_id uuid not null default extensions.gen_random_uuid(),
  entry_no bigint not null generated always as identity,
  module text not null check (module in ('m3', 'm4_increment_1')),
  action text not null check (action in ('open', 'close')),
  actor text not null
    check (
      char_length(btrim(actor)) between 1 and 200
      and actor = btrim(actor)
    ),
  basis text not null
    check (
      char_length(btrim(basis)) between 1 and 4000
      and basis = btrim(basis)
    ),
  signatures text[] not null check (cardinality(signatures) > 0),
  applied_by name not null default session_user,
  applied_at timestamptz not null default clock_timestamp(),
  primary key (entry_id)
);

create index module_switch_log_module_order_idx
  on projectceo_platform.module_switch_log (module, entry_no desc);

alter table projectceo_platform.module_switch_log owner to pi_table_owner;
alter table projectceo_platform.module_switch_log enable row level security;
alter table projectceo_platform.module_switch_log force row level security;
revoke all on table projectceo_platform.module_switch_log
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy module_switch_log_internal_owner
  on projectceo_platform.module_switch_log
  for all to pi_table_owner using (true) with check (true);

-- Список дверей на модуль — в одном месте, как у прецедента: открытие и
-- закрытие обязаны действовать по одному списку.
create function projectceo_platform._module_signatures(p_module text)
returns text[]
language sql
immutable
security definer
set search_path = ''
as $function$
  select case p_module
    when 'm3' then array[
      'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)',
      'projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text)',
      'projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text)',
      'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
      'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
      'projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)'
    ]
    when 'm4_increment_1' then array[
      'projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)',
      'projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)',
      'projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)',
      'projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)',
      'projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)',
      'projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)'
    ]
    else null
  end;
$function$;

alter function projectceo_platform._module_signatures(text) owner to pi_table_owner;
revoke all on function projectceo_platform._module_signatures(text)
  from public, anon, authenticated, service_role;

-- M4-инкремент-2 не должен просочиться, когда открывают инкремент-1 — тот же
-- guard, что несёт сам `enable-m4-increment-1.sql`, здесь как часть механизма,
-- а не только одноразового скрипта.
create function projectceo_platform._assert_m4_increment_1_blast_radius()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_leaked text;
begin
  select format('%s:%s', role_name, signature) into v_leaked
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array[
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_PLATFORM_M4_INCREMENT_2_LEAKED:%', v_leaked;
  end if;
end
$function$;

alter function projectceo_platform._assert_m4_increment_1_blast_radius()
  owner to pi_table_owner;
revoke all on function projectceo_platform._assert_m4_increment_1_blast_radius()
  from public, anon, authenticated, service_role;

-- Открыть модуль в производственной среде. Возвращает id записи журнала.
create function projectceo_platform.open_module_production(
  p_module text,
  p_actor text,
  p_basis text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_signatures text[];
  v_signature text;
  v_missing text;
  v_entry_id uuid;
begin
  if p_module is null or p_module not in ('m3', 'm4_increment_1') then
    raise exception 'PROJECTCEO_PLATFORM_MODULE_UNKNOWN:%', coalesce(p_module, 'null');
  end if;
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'PROJECTCEO_PLATFORM_SWITCH_ACTOR_REQUIRED';
  end if;
  if p_basis is null or btrim(p_basis) = '' then
    raise exception 'PROJECTCEO_PLATFORM_SWITCH_BASIS_REQUIRED';
  end if;

  v_signatures := projectceo_platform._module_signatures(p_module);

  foreach v_signature in array v_signatures loop
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;

  select signature into v_missing
  from unnest(v_signatures) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'PROJECTCEO_PLATFORM_MODULE_NOT_ENABLED:%', v_missing;
  end if;

  if p_module = 'm4_increment_1' then
    perform projectceo_platform._assert_m4_increment_1_blast_radius();
  end if;

  -- `anon` не получает ни один из этих модулей ни при каком раскладе — обе
  -- поверхности студийные, публичной стороны у них нет.
  select signature into v_missing
  from unnest(v_signatures) signature
  where pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'PROJECTCEO_PLATFORM_MODULE_LEAKED_TO_ANON:%', v_missing;
  end if;

  insert into projectceo_platform.module_switch_log (
    module, action, actor, basis, signatures
  )
  values (p_module, 'open', btrim(p_actor), btrim(p_basis), v_signatures)
  returning entry_id into v_entry_id;

  return v_entry_id;
end
$function$;

alter function projectceo_platform.open_module_production(text, text, text)
  owner to pi_table_owner;
revoke all on function projectceo_platform.open_module_production(text, text, text)
  from public, anon, authenticated, service_role;

-- Закрыть модуль — команда отката. Отзывает у `authenticated` и `anon`: если
-- право каким-то путём оказалось у `anon`, откат обязан снять и его.
create function projectceo_platform.close_module_production(
  p_module text,
  p_actor text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_signatures text[];
  v_signature text;
  v_leaked text;
  v_entry_id uuid;
begin
  if p_module is null or p_module not in ('m3', 'm4_increment_1') then
    raise exception 'PROJECTCEO_PLATFORM_MODULE_UNKNOWN:%', coalesce(p_module, 'null');
  end if;
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'PROJECTCEO_PLATFORM_SWITCH_ACTOR_REQUIRED';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'PROJECTCEO_PLATFORM_SWITCH_BASIS_REQUIRED';
  end if;

  v_signatures := projectceo_platform._module_signatures(p_module);

  foreach v_signature in array v_signatures loop
    execute format(
      'revoke execute on function %s from authenticated, anon', v_signature
    );
  end loop;

  select format('%s:%s', role_name, signature) into v_leaked
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(v_signatures) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_PLATFORM_MODULE_NOT_CLOSED:%', v_leaked;
  end if;

  insert into projectceo_platform.module_switch_log (
    module, action, actor, basis, signatures
  )
  values (p_module, 'close', btrim(p_actor), btrim(p_reason), v_signatures)
  returning entry_id into v_entry_id;

  return v_entry_id;
end
$function$;

alter function projectceo_platform.close_module_production(text, text, text)
  owner to pi_table_owner;
revoke all on function projectceo_platform.close_module_production(text, text, text)
  from public, anon, authenticated, service_role;

-- Состояние выключателя одним запросом — для мониторинга и разбора. Права —
-- источник истины для write-дверей модуля, но у читающих RPC нет сигнатур,
-- поэтому здесь опрашиваются оба признака: право (для write-поверхности) и
-- журнал (для read-поверхности). Расхождение между ними само по себе находка.
create function projectceo_platform.module_production_state(p_module text)
returns table (
  open_now boolean,
  granted_signatures text[],
  last_action text,
  last_actor text,
  last_basis text,
  last_applied_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_signatures text[];
begin
  if p_module is null or p_module not in ('m3', 'm4_increment_1') then
    raise exception 'PROJECTCEO_PLATFORM_MODULE_UNKNOWN:%', coalesce(p_module, 'null');
  end if;
  v_signatures := projectceo_platform._module_signatures(p_module);

  return query
  with granted as (
    select array_agg(signature order by signature) as signatures
    from unnest(v_signatures) signature
    where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  latest as (
    select log.action, log.actor, log.basis, log.applied_at
    from projectceo_platform.module_switch_log log
    where log.module = p_module
    order by log.entry_no desc
    limit 1
  )
  select
    coalesce(cardinality(granted.signatures), 0) = cardinality(v_signatures),
    coalesce(granted.signatures, array[]::text[]),
    latest.action,
    latest.actor,
    latest.basis,
    latest.applied_at
  from granted
  left join latest on true;
end
$function$;

alter function projectceo_platform.module_production_state(text)
  owner to pi_table_owner;
revoke all on function projectceo_platform.module_production_state(text)
  from public, anon, authenticated, service_role;

-- Гейт для читающих RPC. Авторитетный источник — последняя запись журнала, а
-- не право: у читающих RPC нет своей сигнатуры, которую можно было бы
-- отозвать без риска для M1/M2 (это и есть находка backlog #2). Пустой журнал
-- (модуль ни разу не переключали) — это «закрыт»: до первой записи молчание
-- не может значить «открыт».
create function projectceo_platform.is_module_open(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select log.action = 'open'
      from projectceo_platform.module_switch_log log
      where log.module = p_module
      order by log.entry_no desc
      limit 1
    ),
    false
  );
$function$;

alter function projectceo_platform.is_module_open(text) owner to pi_table_owner;
revoke all on function projectceo_platform.is_module_open(text)
  from public, anon, authenticated, service_role;

-- Применение миграции обязано оставить оба модуля ЗАКРЫТЫМИ, независимо от
-- того, что уже выдал `tests/ap1/environment/enable-m3-publication.sql` /
-- `enable-m4-increment-1.sql` в этой среде — те скрипты остаются механизмом
-- одноразовой среды и этой миграцией не отменяются, но production-состояние
-- этого выключателя обязано начинаться с «закрыто», а не наследовать то, что
-- случайно осталось от ручного скрипта.
do $close_on_apply$
declare
  v_module text;
  v_signature text;
  v_leaked text;
begin
  foreach v_module in array array['m3', 'm4_increment_1'] loop
    foreach v_signature in array projectceo_platform._module_signatures(v_module) loop
      execute format(
        'revoke execute on function %s from authenticated, anon', v_signature
      );
    end loop;
  end loop;

  select format('%s:%s', role_name, signature) into v_leaked
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(
    projectceo_platform._module_signatures('m3')
    || projectceo_platform._module_signatures('m4_increment_1')
  ) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_PLATFORM_MODULE_OPEN_AFTER_MIGRATION:%', v_leaked;
  end if;
end
$close_on_apply$;

commit;
