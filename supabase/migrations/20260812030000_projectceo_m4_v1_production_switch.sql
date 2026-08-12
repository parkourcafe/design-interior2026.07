-- Производственный выключатель вертикали V1 Impact — постоянный механизм
-- вместо скрипта одноразовой среды.
--
-- ЗАЧЕМ ОТДЕЛЬНАЯ МИГРАЦИЯ. До неё права на две человеческие двери V1
-- возвращал `tests/ap1/environment/enable-m4-v1-impact.sql`. Этот файл живёт в
-- харнессе, применяется руками и ничего о себе не записывает: по базе нельзя
-- узнать, кто её открыл, когда и на каком основании. DEC-029 требует ровно
-- обратного — «production-включение требует отдельного OWNER GO и аудируемого
-- DB-state (кто, когда, на каком основании включил)». Тестовый скрипт таким
-- state не является и не может им стать: он не пишет ни строки.
--
-- ЧТО ЭТА МИГРАЦИЯ ДЕЛАЕТ. Заводит две операции — открыть и закрыть — и
-- журнал, в который каждая из них обязана записаться. Открытие без указания
-- действующего лица и основания технически невозможно: оба поля обязательны и
-- непустые.
--
-- ЧЕГО ОНА НЕ ДЕЛАЕТ, И ЭТО ГЛАВНОЕ. Она НЕ открывает V1. Применение миграции
-- при деплое не выдаёт роли `authenticated` ни одного права: наоборот, она
-- явно отзывает права V1 и падает, если после отзыва хоть одна дверь осталась
-- доступной. То есть выкатить её в production безопасно в любой момент —
-- модуль остаётся закрытым до отдельного, ручного, записанного в журнал
-- вызова `open_v1_impact_production`.
--
-- ПОЧЕМУ ГРАНТ НЕ ЗАПИСАН ПРЯМО В МИГРАЦИЮ. Миграция применяется деплоем, а
-- деплой случается по причинам, не связанным с решением владельца: слияние
-- чужой ветки, откат, пересоздание среды. Право, выданное миграцией,
-- появилось бы у пользователей как побочный эффект выкатки, и снять его можно
-- было бы только новой миграцией. Право, выданное операцией, включается и
-- выключается одним вызовом и оставляет запись о том, кто это сделал.
--
-- ОТКАТ — `close_v1_impact_production(actor, reason)`. Одна команда, тот же
-- журнал, та же проверка результата.
--
-- КТО МОЖЕТ ЗВАТЬ. Никто из прикладных ролей: `execute` отозван у `public`,
-- `anon`, `authenticated` и `service_role`. Остаются владелец объектов
-- (`pi_table_owner`) и роли, состоящие в нём, — то есть человек с прямым
-- доступом к базе. Через Data API выключатель недостижим: схема
-- `projectceo_m4` приватная и в `[api].schemas` не входит.

begin;

-- Журнал переключений. Отдельная таблица, а не колонка где-то ещё: у события
-- «модуль открыли» нет естественного владельца среди сущностей продукта, а
-- история переключений обязана переживать любое из них.
create table projectceo_m4.production_switch_log (
  entry_id uuid not null default extensions.gen_random_uuid(),
  -- Порядок переключений — отдельным счётчиком, а не временем.
  --
  -- Первая редакция сортировала журнал по времени применения, и на первом же
  -- прогоне «последним действием» оказалось закрытие, хотя последним было
  -- открытие: закрыть и открыть можно внутри одного оператора, а
  -- `statement_timestamp()` на весь оператор один. Тай-брейк по uuid ничего не
  -- упорядочивает — он случаен. Счётчик отвечает на вопрос «что было позже»
  -- независимо от того, как часто переключали.
  entry_no bigint not null generated always as identity,
  vertical text not null check (vertical = 'v1_impact'),
  action text not null check (action in ('open', 'close')),
  -- Действующее лицо — человек или роль, принявшая решение, в свободной форме
  -- («Selena, владелец продукта»). Это не идентификатор в базе: решение
  -- принимает не сессия, и подставлять `current_user` вместо подписи значило
  -- бы записать исполнителя вместо решившего.
  actor text not null
    check (
      char_length(btrim(actor)) between 1 and 200
      and actor = btrim(actor)
    ),
  -- Основание: номер решения, дата, ссылка на документ. Пустое основание
  -- запрещено — запись «открыли, потому что открыли» бесполезна при разборе.
  basis text not null
    check (
      char_length(btrim(basis)) between 1 and 4000
      and basis = btrim(basis)
    ),
  -- Сигнатуры, которых операция коснулась. Записываются фактические, а не
  -- ожидаемые: если завтра список V1 изменится, журнал покажет, что именно
  -- было открыто в тот день.
  signatures text[] not null check (cardinality(signatures) > 0),
  -- Кто исполнил на уровне базы — в дополнение к подписи, не вместо неё.
  -- Именно `session_user`: операции `security definer`, и `current_user`
  -- внутри них — всегда владелец объектов, то есть запись «кто исполнил» была
  -- бы одинаковой у всех и бесполезной.
  applied_by name not null default session_user,
  -- `clock_timestamp()`, а не `statement_timestamp()`: два переключения в
  -- одном операторе — обычное дело при откате и повторном открытии, и им
  -- нужно разное время.
  applied_at timestamptz not null default clock_timestamp(),
  primary key (entry_id)
);

-- Тот же контур безопасности, что у любой таблицы схемы (`20260717102000`):
-- владелец, RLS с `force`, отзыв всех прав у прикладных ролей и единственная
-- политика для владельца.
alter table projectceo_m4.production_switch_log owner to pi_table_owner;
alter table projectceo_m4.production_switch_log enable row level security;
alter table projectceo_m4.production_switch_log force row level security;
revoke all on table projectceo_m4.production_switch_log
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy production_switch_log_internal_owner
  on projectceo_m4.production_switch_log
  for all to pi_table_owner using (true) with check (true);

-- Список дверей вертикали — в одном месте. Открытие и закрытие обязаны
-- работать по одному списку: разойдись они, закрытие оставило бы открытой
-- дверь, о которой забыли, и журнал утверждал бы, что модуль закрыт.
create function projectceo_m4._v1_impact_signatures()
returns text[]
language sql
immutable
security definer
set search_path = ''
as $function$
  select array[
    'projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)',
    'projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)'
  ];
$function$;

alter function projectceo_m4._v1_impact_signatures() owner to pi_table_owner;
revoke all on function projectceo_m4._v1_impact_signatures()
  from public, anon, authenticated, service_role;

-- Двери, которых открытие V1 не имеет права коснуться. Проверка стоит внутри
-- операции, а не рядом с ней: ошибиться легче всего именно в момент
-- открытия, и проверка, которую можно забыть выполнить, — это комментарий.
create function projectceo_m4._assert_v1_impact_blast_radius()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_leaked text;
begin
  -- V2 и V3 остаются NOT AUTHORIZED (DEC-032): ни одна их команда не может
  -- оказаться доступной прикладной роли.
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
    raise exception 'PROJECTCEO_M4_V2_V3_LEAKED_BY_V1:%', v_leaked;
  end if;

  -- Воркерный контур остаётся системным: человек рассматривает влияние, но не
  -- заказывает его расчёт. Это не удобство, а граница ответственности —
  -- глубина обхода задана политикой сервера, а не тем, кто нажал кнопку.
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

  -- `anon` не получает V1 ни при каком раскладе: публичной поверхности у
  -- модуля исполнения нет.
  select signature into v_leaked
  from unnest(projectceo_m4._v1_impact_signatures()) signature
  where pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_M4_V1_LEAKED_TO_ANON:%', v_leaked;
  end if;
end
$function$;

alter function projectceo_m4._assert_v1_impact_blast_radius() owner to pi_table_owner;
revoke all on function projectceo_m4._assert_v1_impact_blast_radius()
  from public, anon, authenticated, service_role;

-- Открыть вертикаль V1 в производственной среде.
--
-- Возвращает идентификатор записи журнала — по нему разбор находит, кто и на
-- каком основании открыл, не полагаясь на память участников.
create function projectceo_m4.open_v1_impact_production(
  p_actor text,
  p_basis text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_signatures text[] := projectceo_m4._v1_impact_signatures();
  v_signature text;
  v_missing text;
  v_entry_id uuid;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'PROJECTCEO_M4_V1_SWITCH_ACTOR_REQUIRED';
  end if;
  if p_basis is null or btrim(p_basis) = '' then
    raise exception 'PROJECTCEO_M4_V1_SWITCH_BASIS_REQUIRED';
  end if;

  foreach v_signature in array v_signatures loop
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;

  -- Право проверяется по базе, а не выводится из того, что `grant` не упал:
  -- отозвать его мог кто угодно между строками, и молчаливо открытая наполовину
  -- вертикаль хуже закрытой.
  select signature into v_missing
  from unnest(v_signatures) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'PROJECTCEO_M4_V1_IMPACT_NOT_ENABLED:%', v_missing;
  end if;

  perform projectceo_m4._assert_v1_impact_blast_radius();

  insert into projectceo_m4.production_switch_log (
    vertical, action, actor, basis, signatures
  )
  values ('v1_impact', 'open', btrim(p_actor), btrim(p_basis), v_signatures)
  returning entry_id into v_entry_id;

  return v_entry_id;
end
$function$;

alter function projectceo_m4.open_v1_impact_production(text, text)
  owner to pi_table_owner;
revoke all on function projectceo_m4.open_v1_impact_production(text, text)
  from public, anon, authenticated, service_role;

-- Закрыть вертикаль V1 — команда отката.
--
-- Отзыв идёт у обеих прикладных ролей, а не только у `authenticated`: если
-- право каким-то путём оказалось у `anon`, откат обязан снять и его, иначе
-- «закрыто» в журнале и «закрыто» в базе разойдутся.
create function projectceo_m4.close_v1_impact_production(
  p_actor text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_signatures text[] := projectceo_m4._v1_impact_signatures();
  v_signature text;
  v_leaked text;
  v_entry_id uuid;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'PROJECTCEO_M4_V1_SWITCH_ACTOR_REQUIRED';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'PROJECTCEO_M4_V1_SWITCH_BASIS_REQUIRED';
  end if;

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
    raise exception 'PROJECTCEO_M4_V1_IMPACT_NOT_CLOSED:%', v_leaked;
  end if;

  insert into projectceo_m4.production_switch_log (
    vertical, action, actor, basis, signatures
  )
  values ('v1_impact', 'close', btrim(p_actor), btrim(p_reason), v_signatures)
  returning entry_id into v_entry_id;

  return v_entry_id;
end
$function$;

alter function projectceo_m4.close_v1_impact_production(text, text)
  owner to pi_table_owner;
revoke all on function projectceo_m4.close_v1_impact_production(text, text)
  from public, anon, authenticated, service_role;

-- Состояние выключателя одним запросом — для мониторинга и для разбора.
-- Читает права из базы, а не последнюю запись журнала: журнал говорит, что
-- собирались сделать, права говорят, что есть на самом деле, и расхождение
-- между ними — само по себе находка.
create function projectceo_m4.v1_impact_production_state()
returns table (
  open_now boolean,
  granted_signatures text[],
  last_action text,
  last_actor text,
  last_basis text,
  last_applied_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  with granted as (
    select array_agg(signature order by signature) as signatures
    from unnest(projectceo_m4._v1_impact_signatures()) signature
    where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  latest as (
    select action, actor, basis, applied_at
    from projectceo_m4.production_switch_log
    where vertical = 'v1_impact'
    order by entry_no desc
    limit 1
  )
  select
    coalesce(cardinality(granted.signatures), 0)
      = cardinality(projectceo_m4._v1_impact_signatures()),
    coalesce(granted.signatures, array[]::text[]),
    latest.action,
    latest.actor,
    latest.basis,
    latest.applied_at
  from granted
  left join latest on true;
$function$;

alter function projectceo_m4.v1_impact_production_state() owner to pi_table_owner;
revoke all on function projectceo_m4.v1_impact_production_state()
  from public, anon, authenticated, service_role;

-- Применение миграции обязано оставить вертикаль ЗАКРЫТОЙ.
--
-- Это не перестраховка: guardrail `20260810070000` отзывал права по схеме, но
-- с тех пор среда могла быть открыта скриптом харнесса и остаться такой. База,
-- в которую выкатывается этот выключатель, приводится к известному состоянию
-- здесь — иначе «выкатили механизм» и «открыли модуль» стали бы одним
-- событием, ровно тем, чего механизм и должен избежать.
do $close_on_apply$
declare
  v_signature text;
  v_leaked text;
begin
  foreach v_signature in array projectceo_m4._v1_impact_signatures() loop
    execute format(
      'revoke execute on function %s from authenticated, anon', v_signature
    );
  end loop;

  select format('%s:%s', role_name, signature) into v_leaked
  from unnest(array['anon', 'authenticated']) role_name
  cross join unnest(projectceo_m4._v1_impact_signatures()) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_M4_V1_OPEN_AFTER_MIGRATION:%', v_leaked;
  end if;
end
$close_on_apply$;

commit;
