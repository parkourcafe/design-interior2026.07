-- Telegram Chat Bridge — исправление фундамента (CORRECTIVE GO 11.08.2026).
--
-- Additive only. Миграции `20260811040000`, `20260811050000` и `20260811060000`
-- не переписываются и не откатываются: они уже слиты, и переписывать историю
-- схемы нельзя. Здесь исправляется СОСТОЯНИЕ, а не прошлое.
--
-- A7 и DEC-031 не переоткрываются: архитектурное решение не изменилось,
-- исправляется реализация. Нового аддендума не требуется и не создаётся.
--
-- ШЕСТЬ ДЕФЕКТОВ, каждый из которых пропускает наружу то, что мост обещал не
-- пропускать:
--
--   1. уникальность активной связи включала `bot_instance_id` — один чат
--      связывался с двумя проектами через двух ботов;
--   2. приём начинался ДО уведомления участников: связь создавалась сразу
--      `active`, уведомление уходило после и ничего не блокировало;
--   3. при активации не перепроверялись членство, capability и
--      администраторство самого бота;
--   4. конфликт связи аккаунтов гасился `on conflict do nothing` и отдавался
--      как успех;
--   5. очередь не возвращала в работу протухшую аренду `sending`, а
--      `mark sent/failed` не проверяли ни аренду, ни терминальность
--      `cancelled` — отменённое уведомление воскресало;
--   6. ревизия правки считалась через `max(...)+1` без блокировки: третья и
--      последующие правки терялись, а вызов отвечал «сохранено».

begin;

set local check_function_bodies = on;

-- ---------------------------------------------------------------------------
-- 1. Один чат — один проект, независимо от числа ботов
-- ---------------------------------------------------------------------------
--
-- Прежний индекс включал `bot_instance_id`, и это выглядело осторожностью:
-- «у продукта бывает staging-бот». Но следствие другое — два бота в одном чате
-- давали ДВЕ активные связи с разными проектами, и переписка одной группы
-- расходилась по двум проектам. Изоляция арендаторов важнее удобства стендов:
-- staging-бот живёт в staging-чате.
--
-- Guard стоит ДО создания индекса: молча упасть на `create unique index` в
-- populated-базе значит оставить миграцию наполовину применённой и без
-- объяснения.
do $chat_conflicts_guard$
declare
  v_conflict text;
begin
  select format('chat=%s projects=%s', external_chat_id, count(distinct project_id))
  into v_conflict
  from remhaos_channel.project_channel_bindings
  where status = 'active'
  group by provider, external_chat_id
  having count(*) > 1
  limit 1;

  if v_conflict is not null then
    raise exception
      'REMHAOS_CHANNEL_ACTIVE_CHAT_ALREADY_SHARED:% — разведите чаты вручную до применения миграции',
      v_conflict;
  end if;
end
$chat_conflicts_guard$;

drop index remhaos_channel.project_channel_bindings_one_active_per_chat;

create unique index project_channel_bindings_one_active_per_chat
  on remhaos_channel.project_channel_bindings (provider, external_chat_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 2. Приём начинается только после уведомления участников
-- ---------------------------------------------------------------------------
--
-- Состояния связи: `pending` / `notice_pending` → `active` / `full_after_notice`.
--
-- Разделение на две оси намеренное. `status` отвечает на вопрос «жива ли
-- связь», `capture_state` — «можно ли уже сохранять переписку». Слить их в одно
-- поле значит потерять состояние «бот в чате, связь создана, но люди ещё не
-- предупреждены» — то самое, в котором прежняя реализация уже писала
-- сообщения.

alter table remhaos_channel.project_channel_bindings
  drop constraint project_channel_bindings_status_check;
alter table remhaos_channel.project_channel_bindings
  add constraint project_channel_bindings_status_check check (status in (
    'pending', 'notice_pending', 'active', 'suspended', 'revoked'
  ));

alter table remhaos_channel.project_channel_bindings
  add column capture_state text not null default 'none'
  check (capture_state in ('none', 'full_after_notice'));

-- Существующие активные связи приводятся к новому инварианту. Те, где
-- уведомление реально публиковалось, сохраняют приём; остальные возвращаются в
-- `notice_pending` — и это не потеря данных, а восстановление обещания,
-- которое им дали участники чата.
update remhaos_channel.project_channel_bindings
set capture_state = 'full_after_notice'
where status = 'active' and notice_posted_at is not null;

update remhaos_channel.project_channel_bindings
set status = 'notice_pending',
    activated_at = null,
    status_changed_at = statement_timestamp()
where status = 'active' and notice_posted_at is null;

alter table remhaos_channel.project_channel_bindings
  drop constraint project_channel_bindings_active_shape_check;
alter table remhaos_channel.project_channel_bindings
  add constraint project_channel_bindings_active_shape_check check (
    (status = 'active') = (activated_at is not null)
  );

-- Приём и только приём: `full_after_notice` невозможен без активной связи и
-- без опубликованного уведомления. Обратное тоже верно — активная связь без
-- приёма не бывает, иначе «активен» перестало бы что-либо значить.
alter table remhaos_channel.project_channel_bindings
  add constraint project_channel_bindings_capture_shape_check check (
    (capture_state = 'full_after_notice')
      = (status = 'active' and notice_posted_at is not null)
  );

-- ---------------------------------------------------------------------------
-- 3. Аренда очереди с fencing
-- ---------------------------------------------------------------------------
--
-- Без токена аренды «захват» был обещанием, а не механизмом: воркер, чья аренда
-- истекла, всё ещё мог пометить чужую работу отправленной.

alter table remhaos_channel.notification_outbox
  add column lease_token uuid;

-- ПОРЯДОК ЗДЕСЬ — НЕ СТИЛЬ. Сначала нормализуются старые строки, и только потом
-- появляется ограничение.
--
-- Первая редакция делала наоборот и была сломана: `lease_token` — новая
-- колонка, у всех существующих строк она NULL, поэтому на любой уже
-- существующей строке `state = 'sending'` проверка
-- `(state = 'sending') = (lease_token is not null)` читается как `true = false`
-- и миграция падает при применении. На пустой базе DB4 этого не видно — именно
-- поэтому ниже стоит сценарий, который заводит такую строку заранее.
--
-- Осиротевшие `sending` из прошлой реализации возвращаются в очередь: аренды у
-- них нет и никогда не было, подобрать их заново было бы некому.
update remhaos_channel.notification_outbox
set state = 'retry',
    lease_expires_at = null,
    next_attempt_at = statement_timestamp()
where state = 'sending';

-- Ограничение добавляется валидируемым: к этому моменту нарушать его нечем, и
-- `not valid` только спрятал бы будущую поломку за отложенной проверкой.
alter table remhaos_channel.notification_outbox
  add constraint notification_outbox_lease_shape_check check (
    (state = 'sending') = (lease_token is not null)
  );

-- Индекс должен покрывать и `sending`: иначе возврат протухшей аренды идёт
-- сканом.
drop index remhaos_channel.notification_outbox_due_idx;
create index notification_outbox_due_idx
  on remhaos_channel.notification_outbox (state, next_attempt_at)
  where state in ('pending', 'retry', 'sending');

-- ---------------------------------------------------------------------------
-- 4. Активация связи: все проверки заново, в одной транзакции
-- ---------------------------------------------------------------------------
--
-- Прежняя функция удаляется, а не остаётся рядом. Две двери в одну операцию —
-- ровно та ошибка, которая уже стоила модулю 4 отдельной находки: закрыть одну
-- и забыть вторую слишком легко.
drop function remhaos_channel_api.activate_project_binding(
  bytea, bigint, text, bigint, text, text
);

create function remhaos_channel_api.activate_project_binding(
  nonce_digest bytea,
  external_user_id bigint,
  bot_instance_id text,
  external_chat_id bigint,
  external_chat_type text,
  notice_version text,
  initiator_is_chat_admin boolean,
  bot_is_chat_admin boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intent record;
  v_linked_user uuid;
  v_binding_id uuid;
begin
  -- Telegram user id — положительное целое. Отрицательное или нулевое значение
  -- означает, что транспорт подставил идентификатор чата вместо пользователя.
  if external_user_id is null or external_user_id <= 0 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"externalUserId"}'::jsonb
    );
  end if;

  -- Оба факта проверяет транспорт — база не умеет спросить Telegram. Но отказ
  -- живёт здесь, потому что забыть проверку в одном из вызовов легче, чем
  -- пройти мимо обязательного аргумента.
  if coalesce(initiator_is_chat_admin, false) is not true then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"INITIATOR_NOT_CHAT_ADMIN"}'::jsonb
    );
  end if;
  -- Бот без прав администратора не увидит переписку: privacy mode включён
  -- глобально. Связь, созданная в таком чате, была бы связью, которая ничего
  -- не принимает, — и человек узнал бы об этом только по тишине.
  if coalesce(bot_is_chat_admin, false) is not true then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"BOT_NOT_CHAT_ADMIN"}'::jsonb
    );
  end if;

  select * into v_intent
  from remhaos_channel.channel_link_intents i
  where i.provider = 'telegram'
    and i.nonce_digest = nonce_digest
    and i.purpose = 'project_binding'
  for update;

  if not found
     or v_intent.consumed_at is not null
     or v_intent.revoked_at is not null
     or v_intent.expires_at <= statement_timestamp() then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_INVALID"}'::jsonb
    );
  end if;

  select cil.user_id into v_linked_user
  from remhaos_channel.channel_identity_links cil
  where cil.provider = 'telegram'
    and cil.external_user_id = external_user_id
    and cil.revoked_at is null;

  if v_linked_user is null or v_linked_user <> v_intent.actor_user_id then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_ACTOR_MISMATCH"}'::jsonb
    );
  end if;

  -- Между созданием намерения и нажатием в Telegram человека могли исключить
  -- из проекта или отобрать право. Намерение — не доверенность на будущее.
  if not exists (
    select 1
    from projectceo_foundation.project_memberships pm
    join projectceo_foundation.project_member_capabilities pc
      on pc.organization_id = pm.organization_id
     and pc.project_id = pm.project_id
     and pc.user_id = pm.user_id
     and pc.capability = 'manage_project_integrations'
    where pm.organization_id = v_intent.organization_id
      and pm.project_id = v_intent.project_id
      and pm.user_id = v_linked_user
      and pm.status = 'active'
  ) then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"PROJECT_CAPABILITY_REQUIRED"}'::jsonb
    );
  end if;

  -- Чат уже обслуживает другой проект. Индекс поймал бы это и сам, но отказ по
  -- нарушению уникальности не отличает «занят» от «гонка», а человеку нужно
  -- знать именно первое.
  if exists (
    select 1
    from remhaos_channel.project_channel_bindings b
    where b.provider = 'telegram'
      and b.external_chat_id = external_chat_id
      and b.status = 'active'
  ) then
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"CHANNEL_ALREADY_BOUND"}'::jsonb
    );
  end if;

  update remhaos_channel.channel_link_intents
  set consumed_at = statement_timestamp(),
    consumed_by_external_user_id = external_user_id
  where intent_id = v_intent.intent_id;

  -- Связь рождается БЕЗ приёма. Полный приём открывает только успешная
  -- публикация уведомления участникам.
  insert into remhaos_channel.project_channel_bindings (
    organization_id, project_id, provider, bot_instance_id,
    external_chat_id, external_chat_type, status, capture_state, notice_version,
    initiated_by_user_id, activated_at
  )
  values (
    v_intent.organization_id,
    v_intent.project_id,
    'telegram',
    bot_instance_id,
    external_chat_id,
    external_chat_type,
    'notice_pending',
    'none',
    notice_version,
    v_intent.actor_user_id,
    null
  )
  returning binding_id into v_binding_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'bindingId', v_binding_id,
    'projectId', v_intent.project_id,
    'status', 'notice_pending',
    'captureState', 'none'
  ));
exception
  when unique_violation then
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"CHANNEL_ALREADY_BOUND"}'::jsonb
    );
    return null;
end
$function$;

-- Уведомление опубликовано — только теперь связь становится активной и
-- начинается приём. Отдельная функция, потому что отдельный факт: между
-- созданием связи и словами в чате может пройти и минута, и никогда.
create function remhaos_channel_api.mark_channel_notice_posted(
  binding_id uuid,
  notice_version text,
  initiator_is_chat_admin boolean,
  bot_is_chat_admin boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding record;
  v_external_user_id bigint;
  v_linked_user uuid;
begin
  -- ПОЧЕМУ ЗДЕСЬ ПОВТОРЯЕТСЯ ВСЁ, ЧТО УЖЕ ПРОВЕРЯЛА АКТИВАЦИЯ.
  --
  -- Между созданием `notice_pending` и этим вызовом проходит настоящее время:
  -- сеть, ответ Telegram, иногда — повторная попытка через сутки. За это время
  -- человека могли исключить из проекта, отобрать право, понизить в группе;
  -- бота могли разжаловать; чат могли отдать другому проекту. Функция, которая
  -- в этот момент только меняет статус, открывает приём чужой переписки по
  -- правам, которых уже нет. Первая редакция делала ровно это.
  --
  -- Сериализация по ЧАТУ, а не по связи: конкурируют между собой именно связи
  -- разных ботов в одном чате, и блокировка строки каждой из них их не развела
  -- бы. Advisory-блокировка транзакционная — снимается сама.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'remhaos_channel:chat:' || (
        select b.external_chat_id::text
        from remhaos_channel.project_channel_bindings b
        where b.binding_id = binding_id
      ), 0
    )
  );

  select * into v_binding
  from remhaos_channel.project_channel_bindings b
  where b.binding_id = binding_id
  for update;

  if not found then
    perform projectceo_foundation._raise(
      'P1104', 'not_found', '{"entity":"channelBinding"}'::jsonb
    );
  end if;

  -- Повтор по уже активной связи — не ошибка: сообщение могло уйти дважды, а
  -- финализация — потеряться после успешной отправки. Идемпотентность здесь
  -- обязательна, иначе восстановление после потерянного ответа невозможно.
  if v_binding.status = 'active' then
    return remhaos_channel._envelope(jsonb_build_object(
      'bindingId', binding_id, 'status', 'active', 'changed', false
    ));
  end if;

  if v_binding.status <> 'notice_pending' then
    -- Отозванная или приостановленная связь приёма не открывает никогда.
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"BINDING_NOT_PENDING"}'::jsonb
    );
  end if;

  if coalesce(initiator_is_chat_admin, false) is not true then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"INITIATOR_NOT_CHAT_ADMIN"}'::jsonb
    );
  end if;
  if coalesce(bot_is_chat_admin, false) is not true then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"BOT_NOT_CHAT_ADMIN"}'::jsonb
    );
  end if;

  -- Связь личности инициатора: она могла быть отозвана после создания связи.
  select cil.external_user_id, cil.user_id
  into v_external_user_id, v_linked_user
  from remhaos_channel.channel_identity_links cil
  where cil.provider = 'telegram'
    and cil.user_id = v_binding.initiated_by_user_id
    and cil.revoked_at is null;

  if v_linked_user is null then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"TELEGRAM_IDENTITY_NOT_LINKED"}'::jsonb
    );
  end if;
  if v_external_user_id is null or v_external_user_id <= 0 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"externalUserId"}'::jsonb
    );
  end if;

  if not exists (
    select 1
    from projectceo_foundation.project_memberships pm
    join projectceo_foundation.project_member_capabilities pc
      on pc.organization_id = pm.organization_id
     and pc.project_id = pm.project_id
     and pc.user_id = pm.user_id
     and pc.capability = 'manage_project_integrations'
    where pm.organization_id = v_binding.organization_id
      and pm.project_id = v_binding.project_id
      and pm.user_id = v_linked_user
      and pm.status = 'active'
  ) then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"PROJECT_CAPABILITY_REQUIRED"}'::jsonb
    );
  end if;

  -- Чат мог достаться другому проекту, пока это уведомление публиковалось.
  -- Проверка явная: частичный уникальный индекс поймал бы это и сам, но
  -- `unique_violation` не отличает «занят» от «гонка», а вызывающему нужно
  -- знать именно первое.
  if exists (
    select 1
    from remhaos_channel.project_channel_bindings other
    where other.provider = 'telegram'
      and other.external_chat_id = v_binding.external_chat_id
      and other.status = 'active'
      and other.binding_id <> binding_id
  ) then
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"CHANNEL_ALREADY_BOUND"}'::jsonb
    );
  end if;

  update remhaos_channel.project_channel_bindings b
  set status = 'active',
    capture_state = 'full_after_notice',
    notice_posted_at = statement_timestamp(),
    notice_version = coalesce(nullif(btrim(notice_version), ''), b.notice_version),
    activated_at = statement_timestamp(),
    status_changed_at = statement_timestamp()
  where b.binding_id = binding_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'bindingId', binding_id, 'status', 'active', 'changed', true
  ));
exception
  when unique_violation then
    -- Последний рубеж. Дойти сюда можно только гонкой, которую не развела
    -- advisory-блокировка; ответ обязан быть тем же осмысленным конфликтом.
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"CHANNEL_ALREADY_BOUND"}'::jsonb
    );
    return null;
end
$function$;

-- Поиск связи, ожидающей публикации уведомления, по чату и боту.
--
-- Нужна ровно затем, чтобы повтор НЕ требовал исходного одноразового секрета:
-- он потрачен при создании связи, и без этой двери зависший `notice_pending`
-- нельзя было бы восстановить ничем, кроме ручного вмешательства в базу.
create function remhaos_channel_api.find_pending_notice_binding(
  bot_instance_id text,
  external_chat_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding record;
begin
  -- Идентификатор инициатора в Telegram отдаётся транспорту намеренно: без
  -- него повтор не может спросить у Telegram, остался ли инициатор
  -- администратором группы, а `mark_channel_notice_posted` требует этот факт
  -- обязательным аргументом. Наружу к человеку он не уходит: дверь системная.
  select b.binding_id, b.notice_version, cil.external_user_id as initiator_external_id
  into v_binding
  from remhaos_channel.project_channel_bindings b
  left join remhaos_channel.channel_identity_links cil
    on cil.provider = 'telegram'
   and cil.user_id = b.initiated_by_user_id
   and cil.revoked_at is null
  where b.provider = 'telegram'
    and b.bot_instance_id = bot_instance_id
    and b.external_chat_id = external_chat_id
    and b.status = 'notice_pending'
  order by b.created_at desc
  limit 1;

  if not found then
    return remhaos_channel._envelope(jsonb_build_object('pending', false));
  end if;

  return remhaos_channel._envelope(jsonb_build_object(
    'pending', true,
    'bindingId', v_binding.binding_id,
    'noticeVersion', v_binding.notice_version,
    'initiatorExternalUserId', v_binding.initiator_external_id
  ));
end
$function$;

-- ---------------------------------------------------------------------------
-- 5. Связывание аккаунта: конфликт называется конфликтом
-- ---------------------------------------------------------------------------
create or replace function remhaos_channel_api.consume_identity_link_intent(
  nonce_digest bytea,
  external_user_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intent record;
  v_existing_user uuid;
  v_existing_external bigint;
begin
  if external_user_id is null or external_user_id <= 0 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"externalUserId"}'::jsonb
    );
  end if;

  select * into v_intent
  from remhaos_channel.channel_link_intents i
  where i.provider = 'telegram'
    and i.nonce_digest = nonce_digest
    and i.purpose = 'identity_link'
  for update;

  if not found
     or v_intent.consumed_at is not null
     or v_intent.revoked_at is not null
     or v_intent.expires_at <= statement_timestamp() then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"INTENT_INVALID"}'::jsonb
    );
  end if;

  -- Кто уже стоит за этим Telegram-аккаунтом и за этим аккаунтом RemHaOS.
  select cil.user_id into v_existing_user
  from remhaos_channel.channel_identity_links cil
  where cil.provider = 'telegram'
    and cil.external_user_id = external_user_id
    and cil.revoked_at is null;

  select cil.external_user_id into v_existing_external
  from remhaos_channel.channel_identity_links cil
  where cil.provider = 'telegram'
    and cil.user_id = v_intent.actor_user_id
    and cil.revoked_at is null;

  -- Уже связаны именно так: повтор ссылки — не ошибка и не вторая связь.
  if v_existing_user is not null and v_existing_user = v_intent.actor_user_id then
    update remhaos_channel.channel_link_intents
    set consumed_at = statement_timestamp(),
      consumed_by_external_user_id = external_user_id
    where intent_id = v_intent.intent_id;
    return remhaos_channel._envelope(jsonb_build_object(
      'userId', v_intent.actor_user_id, 'changed', false
    ));
  end if;

  -- Конфликт нельзя проглотить. Прежняя реализация писала `on conflict do
  -- nothing` и отвечала успехом: человек видел «аккаунт связан», а связи не
  -- было — либо она принадлежала другому.
  if v_existing_user is not null then
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"EXTERNAL_ACCOUNT_ALREADY_LINKED"}'::jsonb
    );
  end if;
  if v_existing_external is not null then
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"REMHAOS_ACCOUNT_ALREADY_LINKED"}'::jsonb
    );
  end if;

  update remhaos_channel.channel_link_intents
  set consumed_at = statement_timestamp(),
    consumed_by_external_user_id = external_user_id
  where intent_id = v_intent.intent_id;

  insert into remhaos_channel.channel_identity_links (
    provider, external_user_id, user_id
  )
  values ('telegram', external_user_id, v_intent.actor_user_id);

  return remhaos_channel._envelope(jsonb_build_object(
    'userId', v_intent.actor_user_id, 'changed', true
  ));
exception
  when unique_violation then
    -- Гонка двух связываний. Наружу тот же контролируемый конфликт, а не 23505.
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"IDENTITY_LINK_CONFLICT"}'::jsonb
    );
    return null;
end
$function$;

-- ---------------------------------------------------------------------------
-- 6. Приём: ревизии правок immutable и безопасные при гонке
-- ---------------------------------------------------------------------------
create or replace function remhaos_channel_api.ingest_channel_update(
  bot_instance_id text,
  update_id bigint,
  external_chat_id bigint,
  external_message_id bigint,
  event_kind text,
  external_sender_id bigint,
  external_sent_at timestamptz,
  reply_to_message_id bigint,
  forward_origin_kind text,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding record;
  v_event_id uuid;
  v_revision integer;
  v_existing uuid;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"payload"}'::jsonb
    );
  end if;

  -- Приём возможен ТОЛЬКО после уведомления участников. Прежнее условие
  -- смотрело лишь на `status='active'`, а связь становилась активной до слов в
  -- чате — то есть сообщения сохранялись у людей, которых ещё не предупредили.
  select b.* into v_binding
  from remhaos_channel.project_channel_bindings b
  where b.provider = 'telegram'
    and b.bot_instance_id = bot_instance_id
    and b.external_chat_id = external_chat_id
    and b.status = 'active'
    and b.capture_state = 'full_after_notice';

  if not found then
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', false,
      'reason', 'capture_not_open'
    ));
  end if;

  select e.event_id into v_existing
  from remhaos_channel.channel_events e
  where e.provider = 'telegram'
    and e.bot_instance_id = bot_instance_id
    and e.update_id = update_id;
  if v_existing is not null then
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', true, 'duplicate', true, 'eventId', v_existing
    ));
  end if;

  -- Ревизии одного сообщения выдаются под блокировкой этого сообщения, а не
  -- «кто первый посчитал max». Без неё третья правка получала тот же номер,
  -- что и вторая, проигрывала уникальному индексу и ТЕРЯЛАСЬ — а вызов при
  -- этом отвечал «сохранено».
  --
  -- Advisory-блокировка транзакционная и снимается сама; ключ выводится из
  -- тройки, а не из счётчика, поэтому два узла считают его одинаково.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_binding.binding_id::text || u&'\001f' || external_chat_id::text
        || u&'\001f' || coalesce(external_message_id, -1)::text,
      0
    )
  );

  select coalesce(max(e.source_revision), 0) + 1 into v_revision
  from remhaos_channel.channel_events e
  where e.binding_id = v_binding.binding_id
    and e.external_chat_id = external_chat_id
    and e.external_message_id is not distinct from external_message_id;

  insert into remhaos_channel.channel_events (
    organization_id, project_id, binding_id, provider, bot_instance_id,
    update_id, external_chat_id, external_message_id, source_revision,
    external_sender_id, event_kind, external_sent_at, reply_to_message_id,
    forward_origin_kind, payload
  )
  values (
    v_binding.organization_id, v_binding.project_id, v_binding.binding_id,
    'telegram', bot_instance_id, update_id, external_chat_id,
    external_message_id, v_revision, external_sender_id, event_kind,
    external_sent_at, reply_to_message_id, forward_origin_kind, payload
  )
  returning event_id into v_event_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'stored', true,
    'duplicate', false,
    'eventId', v_event_id,
    'projectId', v_binding.project_id,
    'sourceRevision', v_revision
  ));
exception
  when unique_violation then
    -- Единственная оставшаяся гонка — два одновременных приёма ОДНОГО update.
    -- Победила соседняя транзакция; её событие и есть ответ. Если же строки
    -- нет, значит нарушено что-то другое, и молчать об этом нельзя: прежняя
    -- реализация возвращала здесь `stored: true` с пустым `eventId`.
    select e.event_id into v_existing
    from remhaos_channel.channel_events e
    where e.provider = 'telegram'
      and e.bot_instance_id = bot_instance_id
      and e.update_id = update_id;
    if v_existing is null then
      perform projectceo_foundation._raise(
        'P1109', 'scope_conflict', '{"reason":"SOURCE_REVISION_CONFLICT"}'::jsonb
      );
    end if;
    return remhaos_channel._envelope(jsonb_build_object(
      'stored', true, 'duplicate', true, 'eventId', v_existing
    ));
end
$function$;

-- ---------------------------------------------------------------------------
-- 7. Очередь: аренда возвращается, отмена терминальна
-- ---------------------------------------------------------------------------
drop function remhaos_channel_api.claim_notification_batch(integer, integer);
drop function remhaos_channel_api.mark_notification_sent(uuid, bigint);
drop function remhaos_channel_api.mark_notification_failed(uuid, text, integer);

create function remhaos_channel_api.claim_notification_batch(
  max_rows integer default 20,
  lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_data jsonb;
  v_token uuid := extensions.gen_random_uuid();
begin
  if max_rows is null or max_rows < 1 or max_rows > 200 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"maxRows"}'::jsonb
    );
  end if;

  with due as (
    select o.notification_id
    from remhaos_channel.notification_outbox o
    join remhaos_channel.project_channel_bindings b on b.binding_id = o.binding_id
    where b.status = 'active'
      and (
        (o.state in ('pending', 'retry') and o.next_attempt_at <= statement_timestamp())
        -- Протухшая аренда возвращается в работу. Без этой ветки воркер,
        -- умерший на полпути, уносил уведомление с собой навсегда.
        or (o.state = 'sending'
            and o.lease_expires_at is not null
            and o.lease_expires_at <= statement_timestamp())
      )
    order by o.next_attempt_at
    limit max_rows
    for update of o skip locked
  ), claimed as (
    update remhaos_channel.notification_outbox o
    set state = 'sending',
      attempt_count = o.attempt_count + 1,
      lease_token = v_token,
      lease_expires_at = statement_timestamp()
        + make_interval(secs => greatest(coalesce(lease_seconds, 60), 5))
    from due
    where o.notification_id = due.notification_id
    returning o.notification_id, o.binding_id, o.payload, o.template_version,
      o.attempt_count, o.lease_token
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'notificationId', c.notification_id,
    'bindingId', c.binding_id,
    'templateVersion', c.template_version,
    'attemptCount', c.attempt_count,
    'leaseToken', c.lease_token,
    'payload', c.payload,
    'externalChatId', b.external_chat_id,
    'botInstanceId', b.bot_instance_id
  )), '[]'::jsonb)
  into v_data
  from claimed c
  join remhaos_channel.project_channel_bindings b on b.binding_id = c.binding_id;

  return remhaos_channel._envelope(v_data);
end
$function$;

-- Завершение отправки требует ТОЙ ЖЕ аренды. Воркер, чью работу уже забрали,
-- ничего не подтверждает и ничего не воскрешает.
create function remhaos_channel_api.mark_notification_sent(
  notification_id uuid,
  lease_token uuid,
  external_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_state text;
begin
  update remhaos_channel.notification_outbox o
  set state = 'sent',
    sent_at = statement_timestamp(),
    external_message_id = external_message_id,
    lease_token = null,
    lease_expires_at = null,
    failure_code = null
  where o.notification_id = notification_id
    and o.state = 'sending'
    and o.lease_token = lease_token
    -- Третье условие обязательно. Совпадения токена мало: аренда могла
    -- истечь, работу мог забрать другой воркер и уже отправить своё
    -- сообщение. Завершение по протухшей аренде затирало бы чужой результат
    -- — это и есть тот случай, ради которого fencing существует.
    and o.lease_expires_at > statement_timestamp()
  returning o.state into v_state;

  -- Не изменилось — значит либо уже отправлено, либо отменено, либо аренда
  -- истекла и её забрал другой. Все исходы для воркера одинаковы: делать нечего.
  return remhaos_channel._envelope(jsonb_build_object(
    'notificationId', notification_id,
    'changed', v_state is not null
  ));
end
$function$;

create function remhaos_channel_api.mark_notification_failed(
  notification_id uuid,
  lease_token uuid,
  failure_code text,
  retry_after_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_attempt integer;
  v_state text;
  v_changed boolean;
begin
  select o.attempt_count into v_attempt
  from remhaos_channel.notification_outbox o
  where o.notification_id = notification_id
    and o.state = 'sending'
    and o.lease_token = lease_token
    -- Та же тройка, что и в `mark_notification_sent`: истёкшая аренда больше
    -- не даёт права записывать исход.
    and o.lease_expires_at > statement_timestamp();

  if v_attempt is null then
    -- Отменённое уведомление сюда не попадает и воскреснуть не может: `cancelled`
    -- терминально. Просроченная аренда — тоже не повод писать в чужую строку.
    return remhaos_channel._envelope(jsonb_build_object(
      'notificationId', notification_id, 'state', 'unchanged', 'changed', false
    ));
  end if;

  v_state := case when v_attempt >= 5 then 'failed' else 'retry' end;

  update remhaos_channel.notification_outbox o
  set state = v_state,
    failure_code = left(coalesce(nullif(btrim(failure_code), ''), 'send_failed'), 80),
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = statement_timestamp()
      + make_interval(secs => greatest(coalesce(retry_after_seconds, 30), 1))
  where o.notification_id = notification_id
    and o.state = 'sending'
    and o.lease_token = lease_token
    -- Та же тройка, что и в `mark_notification_sent`: истёкшая аренда больше
    -- не даёт права записывать исход.
    and o.lease_expires_at > statement_timestamp();
  v_changed := found;

  return remhaos_channel._envelope(jsonb_build_object(
    'notificationId', notification_id, 'state', v_state, 'changed', v_changed
  ));
end
$function$;

-- ---------------------------------------------------------------------------
-- 7a. Выход из связи знает о новом состоянии
-- ---------------------------------------------------------------------------
--
-- Обе функции писались до появления `notice_pending` и `capture_state`. Без
-- правки отзыв связи, ещё не открывшей приём, просто её не находил, а отзыв
-- активной падал на проверке формы: приём оставался `full_after_notice` у
-- отозванной связи.

create or replace function remhaos_channel_api.suspend_project_binding(
  bot_instance_id text,
  external_chat_id bigint,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_binding_id uuid;
begin
  update remhaos_channel.project_channel_bindings b
  set status = 'suspended',
    -- Приостановленная связь ничего не принимает. Оставить приём открытым
    -- значило бы сохранить обещание, которого больше нет.
    capture_state = 'none',
    status_reason = left(coalesce(nullif(btrim(reason), ''), 'bot_access_lost'), 200),
    status_changed_at = statement_timestamp(),
    activated_at = null
  where b.provider = 'telegram'
    and b.bot_instance_id = bot_instance_id
    and b.external_chat_id = external_chat_id
    and b.status in ('notice_pending', 'active')
  returning b.binding_id into v_binding_id;

  if v_binding_id is not null then
    update remhaos_channel.notification_outbox o
    set state = 'cancelled', failure_code = 'binding_suspended',
      lease_token = null, lease_expires_at = null
    where o.binding_id = v_binding_id
      and o.state in ('pending', 'retry', 'sending');
  end if;

  return remhaos_channel._envelope(jsonb_build_object(
    'bindingId', v_binding_id,
    'suspended', v_binding_id is not null
  ));
end
$function$;

create or replace function remhaos_channel_api.disconnect_project_channel(
  project_id uuid,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_binding_id uuid;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id, 'manage_project_integrations'
  );

  update remhaos_channel.project_channel_bindings b
  set status = 'revoked',
    capture_state = 'none',
    status_reason = left(coalesce(nullif(btrim(reason), ''), 'disconnected_by_owner'), 200),
    status_changed_at = statement_timestamp(),
    activated_at = null
  where b.project_id = project_id
    and b.status in ('pending', 'notice_pending', 'active', 'suspended')
  returning b.binding_id into v_binding_id;

  if v_binding_id is null then
    perform projectceo_foundation._raise(
      'P1104', 'not_found', '{"entity":"channelBinding"}'::jsonb
    );
  end if;

  -- Отозванная связь не отправляет ничего, и `cancelled` терминально: воркер,
  -- державший аренду, вернётся с ней ни к чему.
  update remhaos_channel.notification_outbox o
  set state = 'cancelled',
    failure_code = 'binding_revoked',
    lease_token = null,
    lease_expires_at = null
  where o.binding_id = v_binding_id
    and o.state in ('pending', 'retry', 'sending');

  return remhaos_channel._envelope(jsonb_build_object('bindingId', v_binding_id));
end
$function$;

-- ---------------------------------------------------------------------------
-- 8. Права
-- ---------------------------------------------------------------------------
--
-- Системные двери: только `service_role`, как и прежде. Человеку эти функции не
-- выдаются ни в одной среде, и человеческих дверей эта миграция не заводит
-- вовсе — она пересоздаёт системные.

do $own$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'remhaos_channel_api.activate_project_binding(bytea, bigint, text, bigint, text, text, boolean, boolean)',
    'remhaos_channel_api.mark_channel_notice_posted(uuid, text, boolean, boolean)',
    'remhaos_channel_api.find_pending_notice_binding(text, bigint)',
    'remhaos_channel_api.consume_identity_link_intent(bytea, bigint)',
    'remhaos_channel_api.ingest_channel_update(text, bigint, bigint, bigint, text, bigint, timestamptz, bigint, text, jsonb)',
    'remhaos_channel_api.claim_notification_batch(integer, integer)',
    'remhaos_channel_api.mark_notification_sent(uuid, uuid, bigint)',
    'remhaos_channel_api.mark_notification_failed(uuid, uuid, text, integer)'
  ] loop
    execute format('alter function %s owner to pi_table_owner', v_signature);
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role,'
      ' pi_human_executor, pi_worker_executor',
      v_signature
    );
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$own$;

do $guard$
declare
  v_leaked text;
begin
  select signature into v_leaked
  from unnest(array[
    'remhaos_channel_api.activate_project_binding(bytea, bigint, text, bigint, text, text, boolean, boolean)',
    'remhaos_channel_api.mark_channel_notice_posted(uuid, text, boolean, boolean)',
    'remhaos_channel_api.find_pending_notice_binding(text, bigint)',
    'remhaos_channel_api.consume_identity_link_intent(bytea, bigint)',
    'remhaos_channel_api.ingest_channel_update(text, bigint, bigint, bigint, text, bigint, timestamptz, bigint, text, jsonb)',
    'remhaos_channel_api.claim_notification_batch(integer, integer)',
    'remhaos_channel_api.mark_notification_sent(uuid, uuid, bigint)',
    'remhaos_channel_api.mark_notification_failed(uuid, uuid, text, integer)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'REMHAOS_CHANNEL_SYSTEM_PATH_REACHABLE_BY_HUMAN_ROLE:%', v_leaked;
  end if;

  -- И прежние сигнатуры не должны остаться рядом второй дверью.
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'remhaos_channel_api'
      and p.proname in (
        'activate_project_binding', 'claim_notification_batch',
        'mark_notification_sent', 'mark_notification_failed'
      )
    group by p.proname
    having count(*) > 1
  ) then
    raise exception 'REMHAOS_CHANNEL_DUPLICATE_DOOR_REMAINS';
  end if;
end
$guard$;

commit;
