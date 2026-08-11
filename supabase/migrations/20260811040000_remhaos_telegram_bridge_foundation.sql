-- Telegram Chat Bridge — фундамент шлюза интеграций (A7 / DEC-031, гейт TG1).
--
-- Additive only. Ни одна существующая миграция не тронута.
--
-- ГДЕ ЭТО ЖИВЁТ. Мост — ОДИН горизонтальный adapter в `Integration Gateway →
-- Messaging` (Architecture v1.1 §2, §9), а не пятый доменный модуль (DEC-001) и
-- не бот на каждый из M1–M4. Поэтому у него собственная приватная схема
-- `projectceo_gateway` и собственная API-схема `projectceo_gateway_api`, а
-- доменные таблицы M1–M4 не получают НИ ОДНОГО поля с внешними
-- идентификаторами Telegram (INV-T7). Внутренний namespace остаётся
-- `projectceo_*` — переименований ради публичного бренда здесь нет (AGENTS.md).
--
-- ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ.
--
--   * **Ревизии состояния проекта.** Шлюз НЕ трогает
--     `project_intelligence.project_workflows.state_revision` и НЕ пишет в
--     `projectceo_product.command_records`. Причина не в лени: ревизия состояния
--     — механизм оптимистической блокировки человеческих команд, и если бы
--     каждое входящее сообщение чата её двигало, любое сообщение отменяло бы
--     человеческую команду, начатую секунду назад. Идемпотентность шлюза
--     структурная — уникальными индексами по естественным ключам (внешний
--     `update_id`, ключ уведомления), и это проверяется DB4, а не обещается.
--   * **Bot token и webhook secret.** Их в базе нет и не будет: они живут
--     только в окружении процесса. В таблицах есть `bot_instance_id` —
--     логическое имя бота, не его ключ.
--   * **Telegram download URL.** Колонки под него нет: URL содержит токен бота
--     (Bot API `getFile`), и хранить его значило бы положить секрет в базу.
--   * **Username, телефон, отображаемое имя.** Колонок нет вовсе — это самый
--     сильный способ гарантировать INV-T2: связь строится только по стабильному
--     числовому идентификатору, и смена username её не рвёт, потому что рвать
--     нечего.
--
-- ГРАНИЦЫ ДОСТУПА — ДВЕ, КАК У M3 И M4.
--
--   1. Приложение: `REMHAOS_TELEGRAM_BRIDGE_ENABLED` (по умолчанию выключен).
--   2. База: человеческие RPC шлюза отозваны у `authenticated` этой миграцией и
--      возвращаются ЯВНО только там, где мост намеренно открыт
--      (`tests/ap1/environment/enable-telegram-bridge.sql`). Системные RPC
--      отозваны у `authenticated` НАВСЕГДА — ни одна среда их не возвращает.
--
-- Урок M3 и M4 повторять не будем: границу модуля нельзя проверять по имени
-- схемы. Полный состав поверхности — матрица
-- `lib/integration-gateway/telegram/bridge-surface.ts`, и она сверяется с базой
-- тестом и сценарием DB4, а не читается глазами.

begin;

set local check_function_bodies = on;

create schema projectceo_gateway authorization pi_table_owner;
create schema projectceo_gateway_api authorization pi_table_owner;

revoke all on schema projectceo_gateway
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on schema projectceo_gateway_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

alter default privileges for role pi_table_owner
  in schema projectceo_gateway
  revoke all on tables from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_gateway
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_gateway_api
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- ---------------------------------------------------------------------------
-- 1. Capability
-- ---------------------------------------------------------------------------
--
-- `manage_project_integrations` заводится в СУЩЕСТВУЮЩЕМ реестре, а не вторым
-- списком ролей рядом с ним. Это же закрывает пункт 6 backlog `M4 Production
-- Hardening` для нового слоя заранее: приложение обязано спрашивать capability,
-- а не сравнивать строку роли.
--
-- В P0 её получает ТОЛЬКО project-scoped `owner_lead` — канонический владелец
-- проекта. `package_member_capabilities` не трогается намеренно: подключение
-- канала — действие уровня проекта, у пакетного участника его быть не может.

-- Словарь пересоздаётся целиком (CHECK нельзя расширить на месте), и базой для
-- него служит ДЕЙСТВУЮЩЕЕ определение из `20260802030000` — то, где уже есть
-- `manage_budget` и `prepare_client_handoff`, а не исходное из `20260717090000`.
-- Разница ровно в одном значении: `manage_project_integrations`.
alter table projectceo_foundation.project_member_capabilities
  drop constraint project_member_capabilities_capability_check;
alter table projectceo_foundation.project_member_capabilities
  add constraint project_member_capabilities_capability_check check (capability in (
    'view_project', 'manage_project', 'manage_access', 'register_source',
    'review_source', 'review_claim', 'create_selection', 'review_selection',
    'publish_baseline', 'publish_release', 'distribute_release',
    'acknowledge_release', 'revise_decision', 'create_change',
    'review_change_impact', 'upload_photo_evidence', 'review_milestone',
    'view_audit', 'manage_budget', 'prepare_client_handoff',
    'manage_project_integrations'
  ));

create or replace function projectceo_foundation._role_capabilities(p_role text)
returns table (capability text)
language sql
immutable
set search_path = ''
as $function$
  select value
  from unnest(
    case p_role
      when 'owner_lead' then array[
        'view_project', 'manage_project', 'manage_access', 'register_source',
        'review_source', 'review_claim', 'create_selection', 'review_selection',
        'publish_baseline', 'publish_release', 'distribute_release',
        'acknowledge_release', 'revise_decision', 'create_change',
        'review_change_impact', 'upload_photo_evidence', 'review_milestone',
        'view_audit', 'manage_budget', 'prepare_client_handoff',
        'manage_project_integrations'
      ]::text[]
      when 'architect' then array[
        'view_project', 'register_source', 'review_source', 'review_claim',
        'create_selection', 'review_selection', 'publish_baseline',
        'publish_release', 'distribute_release', 'acknowledge_release',
        'revise_decision', 'create_change', 'review_change_impact',
        'upload_photo_evidence', 'review_milestone', 'view_audit',
        'manage_budget', 'prepare_client_handoff'
      ]::text[]
      when 'builder' then array[
        'view_project', 'register_source', 'acknowledge_release',
        'create_change', 'upload_photo_evidence'
      ]::text[]
      when 'client_approver' then array[
        'view_project', 'review_selection', 'acknowledge_release',
        'create_change', 'review_milestone'
      ]::text[]
      else array[]::text[]
    end
  ) value
$function$;

-- Реестр ролей приходится переписывать целиком, и это ровно тот случай, когда
-- легко потерять чужую строку: `create or replace`, набранный по памяти со
-- СТАРОЙ версии, тихо отбирает права, добавленные позже. Проверка ниже делает
-- такую потерю невозможной молча — миграция упадёт, а не отнимет.
do $capability_registry_guard$
declare
  v_expected constant jsonb := jsonb_build_object(
    'owner_lead', 21, 'architect', 18, 'builder', 5, 'client_approver', 5
  );
  v_role text;
  v_actual bigint;
begin
  for v_role in select jsonb_object_keys(v_expected) loop
    select count(*) into v_actual
    from projectceo_foundation._role_capabilities(v_role);
    if v_actual <> (v_expected ->> v_role)::bigint then
      raise exception 'PROJECTCEO_ROLE_CAPABILITY_REGISTRY_DRIFT:% expected % got %',
        v_role, v_expected ->> v_role, v_actual;
    end if;
  end loop;

  -- Ни одна роль не имеет права получить новую capability мимо решения: в P0
  -- подключение канала — только у владельца проекта (A7 §7.1).
  if exists (
    select 1
    from unnest(array['architect', 'builder', 'client_approver']) role,
      lateral projectceo_foundation._role_capabilities(role) capability
    where capability.capability = 'manage_project_integrations'
  ) then
    raise exception 'REMHAOS_TELEGRAM_CAPABILITY_GRANTED_BEYOND_OWNER';
  end if;

  -- И реестр обязан остаться подмножеством словаря: значение, которого нет в
  -- CHECK, взорвалось бы только при следующем приглашении.
  if exists (
    select 1
    from unnest(array['owner_lead', 'architect', 'builder', 'client_approver']) role,
      lateral projectceo_foundation._role_capabilities(role) capability
    where capability.capability not in (
      'view_project', 'manage_project', 'manage_access', 'register_source',
      'review_source', 'review_claim', 'create_selection', 'review_selection',
      'publish_baseline', 'publish_release', 'distribute_release',
      'acknowledge_release', 'revise_decision', 'create_change',
      'review_change_impact', 'upload_photo_evidence', 'review_milestone',
      'view_audit', 'manage_budget', 'prepare_client_handoff',
      'manage_project_integrations'
    )
  ) then
    raise exception 'PROJECTCEO_ROLE_CAPABILITY_OUTSIDE_DICTIONARY';
  end if;
end
$capability_registry_guard$;

-- Проекты, заведённые до этой миграции, уже имеют владельца — его capability
-- шаблон тогда не содержал. Тот же приём, что в `20260802090000`.
insert into projectceo_foundation.project_member_capabilities (
  organization_id, project_id, user_id, capability
)
select membership.organization_id, membership.project_id, membership.user_id,
  'manage_project_integrations'
from projectceo_foundation.project_memberships membership
where membership.role = 'owner_lead'
  and membership.status = 'active'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Общие проверки шлюза
-- ---------------------------------------------------------------------------

-- Внешний идентификатор пользователя канала. ТОЛЬКО десятичное число: Telegram
-- user id — int64, и он единственный стабилен. Ни username, ни телефон, ни имя
-- сюда попасть не могут — не потому, что мы обещали, а потому, что не пройдут
-- проверку (INV-T2).
create domain projectceo_gateway.external_actor_id as text
  check (value ~ '^[0-9]{1,20}$');

-- Внешний идентификатор чата. У Telegram он тоже int64 и бывает отрицательным
-- (группы и супергруппы), поэтому знак допускается, а буквы — нет.
create domain projectceo_gateway.external_chat_id as text
  check (value ~ '^-?[0-9]{1,20}$');

-- Санитизированный код отказа. Именно КОД, не текст: в диагностику шлюза не
-- попадает ни строки переписки, ни имени файла, ни токена.
create domain projectceo_gateway.failure_code as text
  check (value ~ '^[a-z][a-z0-9_]{2,63}$');

create function projectceo_gateway._raise(
  p_sqlstate text,
  p_code text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  raise exception using
    errcode = p_sqlstate,
    message = p_code,
    detail = coalesce(p_detail, '{}'::jsonb)::text;
end
$function$;

alter function projectceo_gateway._raise(text, text, jsonb) owner to pi_table_owner;
revoke all on function projectceo_gateway._raise(text, text, jsonb)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- ---------------------------------------------------------------------------
-- 3. Привязка чата к проекту
-- ---------------------------------------------------------------------------

create table projectceo_gateway.project_channel_bindings (
  organization_id uuid not null,
  project_id uuid not null,
  binding_id uuid not null default extensions.gen_random_uuid(),
  provider text not null check (provider in ('telegram')),
  -- Логическое имя экземпляра бота. НЕ токен: токен в базу не попадает.
  bot_instance_id text not null check (
    char_length(btrim(bot_instance_id)) between 1 and 160
    and bot_instance_id = btrim(bot_instance_id)
  ),
  external_chat_id projectceo_gateway.external_chat_id not null,
  chat_type text not null check (chat_type in ('group', 'supergroup')),
  status text not null check (status in ('pending', 'active', 'suspended', 'revoked')),
  -- Режим захвата. `notice_pending` — бот в чате, но уведомление участникам ещё
  -- не опубликовано, и содержимое НЕ сохраняется. Полный приём начинается
  -- только после `full_after_notice`.
  capture_mode text not null check (capture_mode in ('none', 'notice_pending', 'full_after_notice')),
  -- Версия текста уведомления участников. Не «галочка согласия»: одно
  -- уведомление не закрывает 152-ФЗ (A7 §5.3), это отдельный production-гейт.
  notice_version text not null check (
    char_length(btrim(notice_version)) between 1 and 64
    and notice_version = btrim(notice_version)
  ),
  notice_posted_at timestamptz,
  initiated_by_user_id uuid not null,
  initiated_by_external_actor_id projectceo_gateway.external_actor_id not null,
  created_at timestamptz not null default statement_timestamp(),
  activated_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  -- Почему приостановлена или отозвана. Код, не текст.
  status_reason projectceo_gateway.failure_code,
  primary key (organization_id, project_id, binding_id),
  constraint project_channel_bindings_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint project_channel_bindings_initiator_fkey
    foreign key (initiated_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint project_channel_bindings_binding_key unique (binding_id),
  -- Приём возможен только у активной привязки после уведомления участников.
  constraint project_channel_bindings_capture_check check (
    (status = 'active' and capture_mode in ('notice_pending', 'full_after_notice'))
    or (status <> 'active' and capture_mode = 'none')
  ),
  -- Импликация, а не равенство: полный приём НЕВОЗМОЖЕН без опубликованного
  -- уведомления, но сам факт публикации переживает приостановку и отзыв — это
  -- часть истории подключения, а не переключатель.
  constraint project_channel_bindings_notice_check check (
    (capture_mode = 'full_after_notice') <= (notice_posted_at is not null)
  ),
  constraint project_channel_bindings_activated_check check (
    (status in ('active', 'suspended')) <= (activated_at is not null)
  ),
  constraint project_channel_bindings_revoked_check check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

-- INV-T1, первая половина: один активный чат на проект.
create unique index project_channel_bindings_one_active_per_project
  on projectceo_gateway.project_channel_bindings (organization_id, project_id)
  where status = 'active';

-- INV-T1, вторая половина: один проект на активный чат. Индекс намеренно НЕ
-- включает bot_instance_id — иначе один и тот же чат можно было бы связать с
-- двумя проектами через двух ботов, и ограничение существовало бы только на
-- бумаге. Конкурентные подключения его не обходят: два параллельных вставщика
-- получают 23505, и второй превращается в контролируемый `scope_conflict`.
create unique index project_channel_bindings_one_project_per_active_chat
  on projectceo_gateway.project_channel_bindings (provider, external_chat_id)
  where status = 'active';

create index project_channel_bindings_lookup_idx
  on projectceo_gateway.project_channel_bindings (provider, bot_instance_id, external_chat_id, status);
create index project_channel_bindings_project_idx
  on projectceo_gateway.project_channel_bindings (organization_id, project_id, created_at desc);

alter table projectceo_gateway.project_channel_bindings owner to pi_table_owner;
alter table projectceo_gateway.project_channel_bindings enable row level security;
alter table projectceo_gateway.project_channel_bindings force row level security;
revoke all on table projectceo_gateway.project_channel_bindings
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy project_channel_bindings_internal_owner
on projectceo_gateway.project_channel_bindings
for all to pi_table_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. Связь идентичности канала с аккаунтом RemHaOS
-- ---------------------------------------------------------------------------
--
-- INV-T3: эта строка НЕ создаёт project membership и НЕ выдаёт capability. Она
-- отвечает ровно на один вопрос — «чей это Telegram-аккаунт», и всё.

create table projectceo_gateway.channel_identity_links (
  organization_id uuid not null,
  provider text not null check (provider in ('telegram')),
  external_actor_id projectceo_gateway.external_actor_id not null,
  user_id uuid not null,
  status text not null check (status in ('active', 'revoked')),
  linked_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  primary key (organization_id, provider, external_actor_id),
  constraint channel_identity_links_organization_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint channel_identity_links_user_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete restrict,
  constraint channel_identity_links_revoked_check check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

-- Один активный аккаунт RemHaOS на один внешний идентификатор и наоборот:
-- иначе «связанный аккаунт» перестал бы отвечать однозначно.
create unique index channel_identity_links_one_active_account
  on projectceo_gateway.channel_identity_links (organization_id, provider, user_id)
  where status = 'active';

alter table projectceo_gateway.channel_identity_links owner to pi_table_owner;
alter table projectceo_gateway.channel_identity_links enable row level security;
alter table projectceo_gateway.channel_identity_links force row level security;
revoke all on table projectceo_gateway.channel_identity_links
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy channel_identity_links_internal_owner
on projectceo_gateway.channel_identity_links
for all to pi_table_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5. Одноразовые интенты
-- ---------------------------------------------------------------------------
--
-- Одна таблица, а не две, и это осознанно. A7 требует двух НАЗНАЧЕНИЙ —
-- связывание идентичности (`identity_link`) и подключение чата
-- (`channel_binding`), — но правила у них буквально одни и те же: криптослучайный
-- nonce, в базе только hash, TTL 10 минут, одноразовость, отзыв, привязка к
-- actor/project/purpose. Два одинаковых ledger'а означали бы два места, где
-- можно забыть проверить срок, и рано или поздно они бы разошлись. Назначение
-- разделяет колонка `purpose`, а не таблица.
--
-- В токене нет ни project id, ни organization id, ни чего-либо чувствительного:
-- наружу уходит непрозрачные 32 случайных байта в base64url (43 символа), что
-- помещается в лимит Telegram `start` / `startgroup` (64 символа, алфавит
-- A-Z a-z 0-9 _ -). Внутрь пишется только SHA-256 от него.

create table projectceo_gateway.channel_link_intents (
  intent_id uuid not null default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  purpose text not null check (purpose in ('identity_link', 'channel_binding')),
  provider text not null check (provider in ('telegram')),
  bot_instance_id text not null check (
    char_length(btrim(bot_instance_id)) between 1 and 160
    and bot_instance_id = btrim(bot_instance_id)
  ),
  nonce_digest bytea not null check (octet_length(nonce_digest) = 32),
  actor_user_id uuid not null,
  status text not null check (status in ('pending', 'consumed', 'revoked')),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_external_actor_id projectceo_gateway.external_actor_id,
  revoked_at timestamptz,
  primary key (intent_id),
  constraint channel_link_intents_nonce_key unique (nonce_digest),
  constraint channel_link_intents_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint channel_link_intents_actor_fkey
    foreign key (actor_user_id)
    references auth.users (id)
    on delete restrict,
  -- TTL 10 минут. Не «примерно»: верхняя граница в базе, чтобы её нельзя было
  -- растянуть параметром вызова.
  constraint channel_link_intents_ttl_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '10 minutes'
  ),
  constraint channel_link_intents_consumed_check check (
    (status = 'consumed') = (consumed_at is not null)
  ),
  constraint channel_link_intents_revoked_check check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

create index channel_link_intents_actor_idx
  on projectceo_gateway.channel_link_intents (organization_id, project_id, actor_user_id, created_at desc);
create index channel_link_intents_pending_idx
  on projectceo_gateway.channel_link_intents (expires_at)
  where status = 'pending';

alter table projectceo_gateway.channel_link_intents owner to pi_table_owner;
alter table projectceo_gateway.channel_link_intents enable row level security;
alter table projectceo_gateway.channel_link_intents force row level security;
revoke all on table projectceo_gateway.channel_link_intents
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy channel_link_intents_internal_owner
on projectceo_gateway.channel_link_intents
for all to pi_table_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 6. Durable Channel Inbox
-- ---------------------------------------------------------------------------

create table projectceo_gateway.channel_events (
  event_id uuid not null default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  binding_id uuid not null,
  provider text not null check (provider in ('telegram')),
  bot_instance_id text not null,
  -- Telegram `update_id` — int64 и монотонен в пределах бота.
  external_update_id bigint not null,
  external_chat_id projectceo_gateway.external_chat_id not null,
  external_message_id bigint,
  external_actor_id projectceo_gateway.external_actor_id,
  -- Разрешённый аккаунт RemHaOS отправителя, если связь существует. NULL —
  -- законное состояние: участник чата может не иметь аккаунта, и это делает
  -- кандидата `unverified`, а не отклоняет событие.
  sender_user_id uuid,
  event_kind text not null check (event_kind in (
    'message',
    'edited_message',
    'my_chat_member',
    'chat_member',
    'callback_query'
  )),
  -- Правка сообщения даёт НОВУЮ ревизию источника, а не перезапись строки.
  source_revision integer not null default 1 check (source_revision between 1 and 1000000),
  -- Серверное время приёма. Ему верим.
  received_at timestamptz not null default statement_timestamp(),
  -- Время по версии Telegram. Недоверенное — отправитель управляет часами
  -- клиента, а бот получает то, что записал сервер Telegram.
  external_event_at timestamptz,
  reply_to_message_id bigint,
  forward_origin_kind text check (forward_origin_kind in ('user', 'hidden_user', 'chat', 'channel')),
  forward_origin_at timestamptz,
  -- Текст сообщения. Хранится, потому что без него нечего показывать человеку
  -- на ревью; в structured logs не попадает НИКОГДА.
  text_content text check (char_length(text_content) <= 16384),
  processing_state text not null default 'pending' check (processing_state in (
    'pending', 'processing', 'processed', 'skipped', 'dead_letter'
  )),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default statement_timestamp(),
  failure_code projectceo_gateway.failure_code,
  primary key (event_id),
  constraint channel_events_binding_fkey
    foreign key (binding_id)
    references projectceo_gateway.project_channel_bindings (binding_id)
    on delete restrict,
  constraint channel_events_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint channel_events_sender_fkey
    foreign key (sender_user_id)
    references auth.users (id)
    on delete restrict,
  -- Повтор update создаёт ОДИН event. Telegram повторяет доставку, пока не
  -- получит 2xx, и без этого ограничения одно сообщение строителя рождало бы
  -- столько кандидатов, сколько было ретраев.
  constraint channel_events_update_key unique (provider, bot_instance_id, external_update_id),
  constraint channel_events_lease_check check (
    (processing_state = 'processing') >= (lease_expires_at is not null)
  )
);

-- Источник сообщения: `(binding, chat, message, revision)`. Правка приходит
-- отдельным `update_id`, поэтому предыдущее ограничение её не ловит — ловит это.
create unique index channel_events_source_revision_key
  on projectceo_gateway.channel_events (binding_id, external_chat_id, external_message_id, source_revision)
  where external_message_id is not null;

create index channel_events_queue_idx
  on projectceo_gateway.channel_events (processing_state, next_attempt_at)
  where processing_state in ('pending', 'processing');
create index channel_events_project_idx
  on projectceo_gateway.channel_events (organization_id, project_id, received_at desc);

alter table projectceo_gateway.channel_events owner to pi_table_owner;
alter table projectceo_gateway.channel_events enable row level security;
alter table projectceo_gateway.channel_events force row level security;
revoke all on table projectceo_gateway.channel_events
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy channel_events_internal_owner
on projectceo_gateway.channel_events
for all to pi_table_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 7. Вложения
-- ---------------------------------------------------------------------------

create table projectceo_gateway.channel_attachments (
  attachment_id uuid not null default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  event_id uuid not null,
  attachment_kind text not null check (attachment_kind in ('photo', 'document', 'voice')),
  external_file_id text not null check (char_length(external_file_id) between 1 and 400),
  external_file_unique_id text not null check (char_length(external_file_unique_id) between 1 and 200),
  -- Недоверенные метаданные: их присылает клиент отправителя. Названы так
  -- прямо, чтобы никто не построил на них проверку размера или типа.
  declared_size_bytes bigint check (declared_size_bytes between 0 and 9007199254740991),
  declared_media_type text check (char_length(declared_media_type) <= 200),
  -- Внутренний локатор. NULL, пока байты не материализованы. Telegram download
  -- URL здесь не хранится и храниться не может: он содержит токен бота.
  storage_object_key text check (char_length(storage_object_key) between 1 and 1024),
  -- Считает сервер, по фактическим байтам.
  server_sha256 bytea check (octet_length(server_sha256) = 32),
  scan_status text not null default 'pending' check (scan_status in (
    'pending',
    -- Общий карантинный конвейер ещё не доказан для этого источника: метаданные
    -- сохранены, байты не скачаны, отдельного небезопасного телеграм-хранилища
    -- не заведено.
    'materialization_blocked',
    'quarantined',
    'clean',
    'rejected',
    'too_large'
  )),
  scan_reason projectceo_gateway.failure_code,
  created_at timestamptz not null default statement_timestamp(),
  materialized_at timestamptz,
  scanned_at timestamptz,
  primary key (attachment_id),
  constraint channel_attachments_event_fkey
    foreign key (event_id)
    references projectceo_gateway.channel_events (event_id)
    on delete restrict,
  constraint channel_attachments_event_file_key unique (event_id, external_file_unique_id),
  -- До `clean` файла для продукта не существует: ни человеку, ни AI. Обратное
  -- тоже верно — «чистым» нельзя назвать то, чего сервер не считал сам.
  constraint channel_attachments_clean_check check (
    (scan_status = 'clean') <= (storage_object_key is not null and server_sha256 is not null)
  )
);

create index channel_attachments_event_idx
  on projectceo_gateway.channel_attachments (event_id);
create index channel_attachments_project_idx
  on projectceo_gateway.channel_attachments (organization_id, project_id, created_at desc);

alter table projectceo_gateway.channel_attachments owner to pi_table_owner;
alter table projectceo_gateway.channel_attachments enable row level security;
alter table projectceo_gateway.channel_attachments force row level security;
revoke all on table projectceo_gateway.channel_attachments
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy channel_attachments_internal_owner
on projectceo_gateway.channel_attachments
for all to pi_table_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 8. Project Inbox — кандидаты
-- ---------------------------------------------------------------------------

create table projectceo_gateway.project_inbox_candidates (
  candidate_id uuid not null default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  binding_id uuid not null,
  source_event_id uuid not null,
  candidate_type text not null check (candidate_type in (
    'question',
    'decision_candidate',
    'change_request_candidate',
    'risk_candidate',
    'general_note',
    -- Модель обязана уметь сказать «ничего»: без этого исхода она будет
    -- придумывать кандидатов из «ок, спасибо».
    'ignored'
  )),
  -- Версия схемы извлечения. Повторный проход другой версией даёт НОВОГО
  -- кандидата, а не переписывает старого: провенанс обязан пережить смену
  -- промпта.
  extraction_schema_version text not null check (
    char_length(btrim(extraction_schema_version)) between 1 and 64
    and extraction_schema_version = btrim(extraction_schema_version)
  ),
  extraction_provider text check (char_length(extraction_provider) <= 64),
  extraction_model text check (char_length(extraction_model) <= 160),
  confidence text check (confidence in ('low', 'medium', 'high')),
  -- Почему модель так решила и что предлагается человеку. Оба поля видит только
  -- человек на ревью.
  rationale text check (char_length(rationale) <= 4000),
  proposed_text text check (char_length(proposed_text) <= 8000),
  status text not null default 'pending' check (status in (
    'pending', 'confirmed', 'rejected', 'superseded'
  )),
  reviewed_by_user_id uuid,
  -- Серверное время. Клиент своего сюда не приносит.
  reviewed_at timestamptz,
  superseded_by_candidate_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  primary key (candidate_id),
  constraint project_inbox_candidates_event_fkey
    foreign key (source_event_id)
    references projectceo_gateway.channel_events (event_id)
    on delete restrict,
  constraint project_inbox_candidates_binding_fkey
    foreign key (binding_id)
    references projectceo_gateway.project_channel_bindings (binding_id)
    on delete restrict,
  constraint project_inbox_candidates_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint project_inbox_candidates_reviewer_fkey
    foreign key (reviewed_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint project_inbox_candidates_superseded_by_fkey
    foreign key (superseded_by_candidate_id)
    references projectceo_gateway.project_inbox_candidates (candidate_id)
    on delete restrict,
  -- Один проход одной версии схемы по одному событию. Повтор воркера после
  -- перезапуска не рождает второго кандидата.
  constraint project_inbox_candidates_extraction_key
    unique (source_event_id, extraction_schema_version),
  -- ЗАПРЕТ НА ПРЕВРАЩЕНИЕ В ОФИЦИАЛЬНЫЙ ОБЪЕКТ БЕЗ ЧЕЛОВЕКА, выраженный
  -- ограничением, а не обещанием: решённым кандидат бывает только вместе с
  -- человеком и серверным временем, а системная identity человека предъявить не
  -- может — у неё нет `auth.uid()`.
  constraint project_inbox_candidates_review_check check (
    (status in ('confirmed', 'rejected'))
    = (reviewed_by_user_id is not null and reviewed_at is not null)
  ),
  constraint project_inbox_candidates_superseded_check check (
    (status = 'superseded') = (superseded_by_candidate_id is not null)
  )
);

create index project_inbox_candidates_project_idx
  on projectceo_gateway.project_inbox_candidates (organization_id, project_id, status, created_at desc);
create index project_inbox_candidates_event_idx
  on projectceo_gateway.project_inbox_candidates (source_event_id);

alter table projectceo_gateway.project_inbox_candidates owner to pi_table_owner;
alter table projectceo_gateway.project_inbox_candidates enable row level security;
alter table projectceo_gateway.project_inbox_candidates force row level security;
revoke all on table projectceo_gateway.project_inbox_candidates
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy project_inbox_candidates_internal_owner
on projectceo_gateway.project_inbox_candidates
for all to pi_table_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 9. Notification Outbox
-- ---------------------------------------------------------------------------
--
-- Гарантия: at-least-once + внутренняя дедупликация. Telegram `sendMessage` не
-- принимает внешнего ключа идемпотентности, поэтому exactly-once здесь никто не
-- обещает. Редкий повтор УВЕДОМЛЕНИЯ после неопределённого сетевого результата
-- допустим; повтор БИЗНЕС-ДЕЙСТВИЯ — нет, и он закрыт идемпотентностью
-- командных RPC, а не этой таблицей.

create table projectceo_gateway.notification_outbox (
  notification_id uuid not null default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  binding_id uuid not null,
  -- Что именно произошло в домене. Единственное значение P0 — выдача выпуска.
  source_kind text not null check (source_kind in ('release_distribution')),
  -- Идентификатор ПЕРСИСТЕНТНОГО состояния, а не одноразового события в памяти:
  -- по нему догоняющий проектор находит выдачи, для которых уведомления ещё нет.
  source_id text not null check (char_length(source_id) between 1 and 160),
  template_id text not null check (char_length(template_id) between 1 and 64),
  template_version text not null check (char_length(template_version) between 1 and 32),
  -- Кому требуется действие. Уведомление уходит в ГРУППУ, поэтому здесь только
  -- идентификатор для сверки на стороне RemHaOS — ни имени, ни контакта.
  recipient_user_id uuid,
  -- Детерминированный внутренний ключ. Выводится из источника, а не из часов и
  -- не из случайности: повтор проектора обязан попасть в ту же строку.
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null default 'pending' check (status in (
    'pending', 'sending', 'sent', 'retry', 'failed', 'cancelled'
  )),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default statement_timestamp(),
  -- Идентификатор сообщения Telegram после отправки.
  external_message_id bigint,
  failure_code projectceo_gateway.failure_code,
  created_at timestamptz not null default statement_timestamp(),
  sent_at timestamptz,
  cancelled_at timestamptz,
  primary key (notification_id),
  constraint notification_outbox_binding_fkey
    foreign key (binding_id)
    references projectceo_gateway.project_channel_bindings (binding_id)
    on delete restrict,
  constraint notification_outbox_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint notification_outbox_recipient_fkey
    foreign key (recipient_user_id)
    references auth.users (id)
    on delete restrict,
  constraint notification_outbox_idempotency_key
    unique (organization_id, project_id, idempotency_key),
  constraint notification_outbox_sent_check check (
    (status = 'sent') = (sent_at is not null)
  ),
  constraint notification_outbox_cancelled_check check (
    (status = 'cancelled') = (cancelled_at is not null)
  ),
  constraint notification_outbox_lease_check check (
    (status = 'sending') >= (lease_expires_at is not null)
  )
);

create index notification_outbox_queue_idx
  on projectceo_gateway.notification_outbox (status, next_attempt_at)
  where status in ('pending', 'retry', 'sending');
create index notification_outbox_source_idx
  on projectceo_gateway.notification_outbox (organization_id, project_id, source_kind, source_id);

alter table projectceo_gateway.notification_outbox owner to pi_table_owner;
alter table projectceo_gateway.notification_outbox enable row level security;
alter table projectceo_gateway.notification_outbox force row level security;
revoke all on table projectceo_gateway.notification_outbox
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy notification_outbox_internal_owner
on projectceo_gateway.notification_outbox
for all to pi_table_owner using (true) with check (true);

commit;
