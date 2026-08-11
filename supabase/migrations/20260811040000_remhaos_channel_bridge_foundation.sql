-- Telegram Chat Bridge — фундамент (A7 / DEC-031, подписан 11.08.2026).
--
-- Один горизонтальный адаптер `Integration Gateway → Messaging`, а не Module 5
-- и не бот на каждый модуль. Отсюда две вещи, которые видно уже в схеме:
--
--   * идентификаторы Telegram живут ТОЛЬКО здесь. Ни `telegram_chat_id`, ни
--     `telegram_user_id` не появляются в доменных таблицах M1–M4 (A7 §2.1);
--   * из чата рождается только НЕПОДТВЕРЖДЁННЫЙ кандидат. Официальным объектом
--     он становится существующей командой RemHaOS от человеческой сессии — в
--     этой схеме нет ни одной двери, способной это обойти.
--
-- ЧТО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ. Она не включает мост: `authenticated` не получает
-- ни одного права на системные RPC, флаг приложения выключен по умолчанию, а
-- webhook появится отдельной миграцией и отдельным PR. Схема, добавленная
-- сегодня, при выключенном мосте просто пуста.
--
-- Приватная схема `remhaos_channel` не отдаётся Data API вовсе. Отдаётся только
-- `remhaos_channel_api` — и в ней права раздаются поимённо: системные функции
-- воркеру (`service_role`), человеческие — `authenticated` с авторизацией
-- внутри через `_authorize_project_human`.

begin;

set local check_function_bodies = on;

create schema remhaos_channel authorization pi_table_owner;
create schema remhaos_channel_api authorization pi_table_owner;

revoke all on schema remhaos_channel
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on schema remhaos_channel_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

alter default privileges for role pi_table_owner
  in schema remhaos_channel
  revoke all on tables from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema remhaos_channel
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema remhaos_channel_api
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Подключённый чат проекта
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Единственность живёт в частичных уникальных индексах, а не в приложении:
-- «один активный чат на проект» и «один проект на активный чат» обязаны
-- переживать гонку двух одновременных подключений. Отозванные и
-- приостановленные связи остаются в таблице ради аудита и повторного
-- подключения — поэтому индексы частичные.

create table remhaos_channel.project_channel_bindings (
  organization_id uuid not null,
  project_id uuid not null,
  binding_id uuid not null default extensions.gen_random_uuid(),
  provider text not null check (provider in ('telegram')),
  -- Один продукт может держать разных ботов (staging и продовый) — событие
  -- уникально в пределах экземпляра бота, а не глобально.
  bot_instance_id text not null
    check (char_length(btrim(bot_instance_id)) between 1 and 160),
  -- Telegram отдаёт chat id знаковым 64-битным числом; супергруппы
  -- отрицательные, и это не ошибка.
  external_chat_id bigint not null,
  external_chat_type text not null
    check (external_chat_type in ('group', 'supergroup', 'private', 'channel')),
  status text not null
    check (status in ('pending', 'active', 'suspended', 'revoked')),
  capture_mode text not null default 'all_messages'
    check (capture_mode in ('all_messages', 'explicit_mention')),
  -- Версия текста уведомления участникам: чем именно людей предупредили,
  -- обязано быть видно спустя год.
  notice_version text not null
    check (char_length(btrim(notice_version)) between 1 and 40),
  notice_posted_at timestamptz,
  initiated_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  activated_at timestamptz,
  -- Причина приостановки/отзыва — санитизированный код, не текст переписки.
  status_reason text
    check (status_reason is null or char_length(status_reason) between 1 and 200),
  status_changed_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, binding_id),
  constraint project_channel_bindings_binding_key unique (binding_id),
  constraint project_channel_bindings_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint project_channel_bindings_active_shape_check check (
    (status = 'active') = (activated_at is not null)
  )
);

-- Один активный чат на проект.
create unique index project_channel_bindings_one_active_per_project
  on remhaos_channel.project_channel_bindings (organization_id, project_id)
  where status = 'active';

-- Один проект на активный чат: тот же чат не может обслуживать два проекта,
-- в том числе в разных организациях.
create unique index project_channel_bindings_one_active_per_chat
  on remhaos_channel.project_channel_bindings (provider, bot_instance_id, external_chat_id)
  where status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Связь аккаунтов
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Только стабильный числовой Telegram user id. Ни username, ни телефон, ни
-- отображаемое имя связью не являются: username меняется владельцем в любой
-- момент, а телефон — прямой ПДн, который мосту не нужен. Связь НЕ создаёт ни
-- членства в проекте, ни capability — она отвечает на единственный вопрос
-- «кто этот человек в RemHaOS».

create table remhaos_channel.channel_identity_links (
  provider text not null check (provider in ('telegram')),
  external_user_id bigint not null,
  user_id uuid not null,
  linked_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  primary key (provider, external_user_id, user_id),
  constraint channel_identity_links_user_fkey
    foreign key (user_id) references auth.users (id) on delete restrict
);

-- Один Telegram-аккаунт связан максимум с одним аккаунтом RemHaOS и наоборот:
-- иначе «кто это написал» перестаёт иметь однозначный ответ.
create unique index channel_identity_links_one_active_external
  on remhaos_channel.channel_identity_links (provider, external_user_id)
  where revoked_at is null;
create unique index channel_identity_links_one_active_user
  on remhaos_channel.channel_identity_links (provider, user_id)
  where revoked_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Одноразовые намерения
-- ─────────────────────────────────────────────────────────────────────────────
--
-- В базе лежит ТОЛЬКО хеш nonce. Украденный дамп не даёт рабочего токена, а
-- сравнение идёт по хешу — как с паролями. Сам токен существует ровно один раз:
-- в ссылке, которую человек открыл.
--
-- Токен не несёт ни project id, ни organization id: он непрозрачен, и по нему
-- снаружи нельзя узнать даже того, к какому проекту он относится. Длина
-- ограничена лимитом Telegram на `start` / `startgroup` (64 символа) — проверка
-- стоит в приложении, здесь хранится только хеш.

create table remhaos_channel.channel_link_intents (
  intent_id uuid not null default extensions.gen_random_uuid(),
  purpose text not null check (purpose in ('identity_link', 'project_binding')),
  provider text not null check (provider in ('telegram')),
  nonce_digest bytea not null check (octet_length(nonce_digest) = 32),
  -- Для identity_link проект отсутствует: человек связывает себя, а не проект.
  organization_id uuid,
  project_id uuid,
  actor_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  consumed_by_external_user_id bigint,
  primary key (intent_id),
  constraint channel_link_intents_nonce_key unique (provider, nonce_digest),
  constraint channel_link_intents_actor_fkey
    foreign key (actor_user_id) references auth.users (id) on delete restrict,
  constraint channel_link_intents_project_shape_check check (
    (purpose = 'project_binding') = (project_id is not null)
    and (project_id is null) = (organization_id is null)
  ),
  -- TTL 10 минут — ровно столько живёт намерение. Это не настройка: длинный
  -- TTL превращает одноразовую ссылку в переносимый ключ.
  constraint channel_link_intents_ttl_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '10 minutes'
  ),
  constraint channel_link_intents_single_use_check check (
    consumed_at is null or consumed_by_external_user_id is not null
  )
);

create index channel_link_intents_actor_idx
  on remhaos_channel.channel_link_intents (actor_user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Входящие события канала
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Telegram повторяет доставку, пока не получит 2xx, поэтому один `update_id`
-- обязан давать ровно одну строку. Правка сообщения НЕ переписывает прошлую
-- запись: она рождает новую ревизию источника, а подтверждённый официальный
-- объект остаётся тем, чем был.
--
-- Синхронизацию удалений мост не обещает: обычный бот не получает надёжных
-- событий обо всех удалённых сообщениях, и притворяться, что получает, значит
-- лгать в аудите.

create table remhaos_channel.channel_events (
  organization_id uuid not null,
  project_id uuid not null,
  binding_id uuid not null,
  event_id uuid not null default extensions.gen_random_uuid(),
  provider text not null check (provider in ('telegram')),
  bot_instance_id text not null,
  update_id bigint not null,
  external_chat_id bigint not null,
  external_message_id bigint not null,
  -- Ревизия источника: 1 — исходное сообщение, дальше каждая правка.
  source_revision integer not null default 1 check (source_revision >= 1),
  external_sender_id bigint,
  event_kind text not null check (event_kind in (
    'message',
    'edited_message',
    'my_chat_member',
    'chat_member',
    'callback_query'
  )),
  -- Время сервера и время Telegram — разные вещи, и обе нужны: первое
  -- доказуемо наше, второе приходит от источника и доверия не заслуживает.
  received_at timestamptz not null default statement_timestamp(),
  external_sent_at timestamptz,
  reply_to_message_id bigint,
  forward_origin_kind text
    check (forward_origin_kind is null or char_length(forward_origin_kind) <= 40),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  processing_state text not null default 'pending' check (processing_state in (
    'pending', 'processing', 'processed', 'ignored', 'dead_letter'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_expires_at timestamptz,
  -- Санитизированный код отказа. Ни текста переписки, ни имён файлов.
  failure_code text
    check (failure_code is null or char_length(failure_code) between 1 and 80),
  primary key (organization_id, project_id, event_id),
  constraint channel_events_event_key unique (event_id),
  constraint channel_events_binding_fkey
    foreign key (binding_id)
    references remhaos_channel.project_channel_bindings (binding_id)
    on delete restrict,
  -- Повтор доставки Telegram создаёт один event.
  constraint channel_events_update_key
    unique (provider, bot_instance_id, update_id),
  -- Ревизия источника уникальна: правка не перезаписывает, а добавляет.
  constraint channel_events_source_revision_key
    unique (binding_id, external_chat_id, external_message_id, source_revision)
);

create index channel_events_pending_idx
  on remhaos_channel.channel_events (processing_state, received_at)
  where processing_state in ('pending', 'processing');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Вложения
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Размер и MIME от Telegram — НЕДОВЕРЕННЫЕ метаданные: их сообщает отправитель.
-- Истину устанавливает сервер: свой SHA-256, свой MIME, свой антивирус. До
-- статуса `clean` вложение недоступно ни человеку, ни AI.
--
-- Байты здесь не хранятся: только локатор в общем приватном хранилище. Ссылка
-- Telegram на скачивание содержит токен бота и не попадает ни в БД, ни в логи.

create table remhaos_channel.channel_attachments (
  organization_id uuid not null,
  project_id uuid not null,
  event_id uuid not null,
  attachment_id uuid not null default extensions.gen_random_uuid(),
  attachment_kind text not null
    check (attachment_kind in ('photo', 'document', 'voice', 'video', 'other')),
  external_file_id text not null
    check (char_length(external_file_id) between 1 and 400),
  external_file_unique_id text not null
    check (char_length(external_file_unique_id) between 1 and 200),
  claimed_size_bytes bigint check (claimed_size_bytes is null or claimed_size_bytes >= 0),
  claimed_media_type text
    check (claimed_media_type is null or char_length(claimed_media_type) <= 200),
  storage_locator text
    check (storage_locator is null or char_length(storage_locator) between 1 and 400),
  server_sha256 bytea check (server_sha256 is null or octet_length(server_sha256) = 32),
  scan_status text not null default 'pending' check (scan_status in (
    'pending', 'scanning', 'clean', 'infected', 'rejected', 'materialization_blocked'
  )),
  scan_completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, attachment_id),
  constraint channel_attachments_event_fkey
    foreign key (event_id) references remhaos_channel.channel_events (event_id)
    on delete restrict,
  constraint channel_attachments_file_key unique (event_id, external_file_unique_id),
  -- Доступное вложение обязано иметь наш хеш и наш локатор. Без них «файл
  -- проверен» было бы словом, а не свойством.
  constraint channel_attachments_clean_shape_check check (
    scan_status <> 'clean'
    or (storage_locator is not null and server_sha256 is not null)
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Кандидаты во входящих проекта
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Главная таблица всего моста — и главное, чего в ней НЕТ: перехода в
-- официальный объект. Кандидат может быть подтверждён человеком, и тогда
-- человек выполняет существующую команду RemHaOS; ссылка на созданный объект
-- пишется сюда постфактум, как след, а не как способ его создать.

create table remhaos_channel.project_inbox_candidates (
  organization_id uuid not null,
  project_id uuid not null,
  candidate_id uuid not null default extensions.gen_random_uuid(),
  event_id uuid not null,
  candidate_kind text not null check (candidate_kind in (
    'question',
    'decision_candidate',
    'change_request_candidate',
    'risk_candidate',
    'general_note',
    'ignored'
  )),
  -- Провенанс: откуда взялось. `ai` не значит «правда», значит «предложено».
  origin text not null check (origin in ('ai', 'rule', 'human')),
  extraction_schema_version text not null
    check (char_length(btrim(extraction_schema_version)) between 1 and 40),
  extraction_model text
    check (extraction_model is null or char_length(extraction_model) <= 120),
  summary text not null check (char_length(btrim(summary)) between 1 and 2000),
  confidence text check (confidence is null or confidence in ('low', 'medium', 'high')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected', 'superseded')),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  -- След подтверждения: что человек создал СВОЕЙ командой. Ссылка появляется
  -- после факта и ничего не создаёт сама.
  resulting_entity_kind text
    check (resulting_entity_kind is null or char_length(resulting_entity_kind) <= 60),
  resulting_entity_id text
    check (resulting_entity_id is null or char_length(resulting_entity_id) <= 160),
  superseded_by_candidate_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, candidate_id),
  constraint project_inbox_candidates_candidate_key unique (candidate_id),
  constraint project_inbox_candidates_event_fkey
    foreign key (event_id) references remhaos_channel.channel_events (event_id)
    on delete restrict,
  constraint project_inbox_candidates_reviewer_fkey
    foreign key (reviewed_by_user_id) references auth.users (id) on delete restrict,
  constraint project_inbox_candidates_superseded_fkey
    foreign key (superseded_by_candidate_id)
    references remhaos_channel.project_inbox_candidates (candidate_id)
    on delete restrict,
  -- Решение человека обязано иметь автора и время. Анонимного подтверждения
  -- не бывает: на нём держится вся граница «предложено ≠ утверждено».
  constraint project_inbox_candidates_review_shape_check check (
    (status in ('pending', 'superseded'))
    = (reviewed_by_user_id is null and reviewed_at is null)
  ),
  -- Официальный объект появляется только у подтверждённого кандидата.
  constraint project_inbox_candidates_result_shape_check check (
    resulting_entity_id is null or status = 'confirmed'
  ),
  -- Один канальный event не порождает двух кандидатов одного вида: повтор
  -- извлечения обязан быть повтором, а не вторым предложением.
  constraint project_inbox_candidates_event_kind_key
    unique (event_id, candidate_kind)
);

create index project_inbox_candidates_pending_idx
  on remhaos_channel.project_inbox_candidates (organization_id, project_id, created_at desc)
  where status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Исходящая очередь
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Telegram `sendMessage` не принимает внешний ключ идемпотентности. Значит
-- честная гарантия — **at-least-once доставка с внутренней дедупликацией**, а
-- не exactly-once. После неопределённого сетевого исхода редкий повтор
-- УВЕДОМЛЕНИЯ допустим; повтор бизнес-действия — нет, и его здесь неоткуда
-- взять: очередь умеет только отправлять текст.

create table remhaos_channel.notification_outbox (
  organization_id uuid not null,
  project_id uuid not null,
  notification_id uuid not null default extensions.gen_random_uuid(),
  binding_id uuid not null,
  -- Источник: что именно в домене произошло. Пара (kind, id) детерминирована,
  -- поэтому повторный проектор не создаёт второй записи.
  source_kind text not null check (char_length(btrim(source_kind)) between 1 and 60),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 160),
  template_version text not null
    check (char_length(btrim(template_version)) between 1 and 40),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 1 and 200),
  state text not null default 'pending' check (state in (
    'pending', 'sending', 'sent', 'retry', 'failed', 'cancelled'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  sent_at timestamptz,
  external_message_id bigint,
  failure_code text
    check (failure_code is null or char_length(failure_code) between 1 and 80),
  primary key (organization_id, project_id, notification_id),
  constraint notification_outbox_notification_key unique (notification_id),
  constraint notification_outbox_binding_fkey
    foreign key (binding_id)
    references remhaos_channel.project_channel_bindings (binding_id)
    on delete restrict,
  -- Внутренняя дедупликация: один и тот же домённый факт ставится в очередь
  -- один раз, сколько бы раз проектор ни пробежал.
  constraint notification_outbox_idempotency_key
    unique (binding_id, idempotency_key),
  constraint notification_outbox_sent_shape_check check (
    (state = 'sent') = (sent_at is not null)
  )
);

create index notification_outbox_due_idx
  on remhaos_channel.notification_outbox (state, next_attempt_at)
  where state in ('pending', 'retry');

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Безопасность хранения
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Тот же приём, что у продуктовых схем: владелец — `pi_table_owner`, RLS
-- включён и forced, прямых прав нет ни у кого. Единственный путь к данным —
-- фиксированные RPC, которые появятся следующими миграциями.

do $table_security$
declare
  v_table text;
begin
  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'remhaos_channel'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table remhaos_channel.%I owner to pi_table_owner',
      v_table
    );
    execute format(
      'alter table remhaos_channel.%I enable row level security',
      v_table
    );
    execute format(
      'alter table remhaos_channel.%I force row level security',
      v_table
    );
    execute format(
      'revoke all on table remhaos_channel.%I '
      || 'from public, anon, authenticated, service_role, '
      || 'pi_human_executor, pi_worker_executor',
      v_table
    );
    execute format(
      'create policy %I on remhaos_channel.%I '
      || 'for all to pi_table_owner using (true) with check (true)',
      v_table || '_internal_owner',
      v_table
    );
  end loop;
end
$table_security$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Capability подключения интеграций
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Реестр ролей один — `_role_capabilities`. Новая capability добавляется в
-- него, а не вторым списком рядом: параллельный список и есть тот способ, каким
-- права расходятся между слоями незаметно.
--
-- ОСТОРОЖНО с базой для замены. Эта функция уже переписывалась миграцией
-- `20260802030000` (M2 добавил `manage_budget` и `prepare_client_handoff`).
-- Первая редакция настоящей миграции взяла за основу ИСХОДНОЕ определение из
-- `20260717090000` и молча отняла у владельца и архитектора эти два права.
-- Поймала перепись `DB3_OWNER_CAPABILITY_PRESET` — она для того и написана.
-- Полный список ниже собран поверх ДЕЙСТВУЮЩЕЙ редакции.
--
-- В P0 подключать чат может только `owner_lead` — владелец проекта. Ни
-- архитектор, ни строитель, ни заказчик: подключение открывает канал ко всему
-- проекту, и это решение владельца, а не участника.

alter table projectceo_foundation.project_member_capabilities
  drop constraint project_member_capabilities_capability_check;

alter table projectceo_foundation.project_member_capabilities
  add constraint project_member_capabilities_capability_check
  check (capability in (
    'view_project',
    'manage_project',
    'manage_access',
    'register_source',
    'review_source',
    'review_claim',
    'create_selection',
    'review_selection',
    'publish_baseline',
    'publish_release',
    'distribute_release',
    'acknowledge_release',
    'revise_decision',
    'create_change',
    'review_change_impact',
    'upload_photo_evidence',
    'review_milestone',
    'view_audit',
    'manage_budget',
    'prepare_client_handoff',
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

alter function projectceo_foundation._role_capabilities(text)
  owner to pi_table_owner;

-- Существующие владельцы получают новую capability без пересоздания членства:
-- иначе право появилось бы только у проектов, заведённых после миграции.
insert into projectceo_foundation.project_member_capabilities (
  organization_id,
  project_id,
  user_id,
  capability
)
select pm.organization_id, pm.project_id, pm.user_id, 'manage_project_integrations'
from projectceo_foundation.project_memberships pm
where pm.role = 'owner_lead'
on conflict do nothing;

-- Пакетный реестр НЕ трогается: подключение канала — проектное действие, и
-- участник рабочего пакета его не выполняет.

do $guard$
begin
  if not exists (
    select 1
    from projectceo_foundation._role_capabilities('owner_lead')
    where capability = 'manage_project_integrations'
  ) then
    raise exception 'REMHAOS_CHANNEL_CAPABILITY_MISSING_FOR_OWNER';
  end if;
  if exists (
    select 1
    from unnest(array['architect', 'builder', 'client_approver']) role,
      lateral projectceo_foundation._role_capabilities(role) rc
    where rc.capability = 'manage_project_integrations'
  ) then
    raise exception 'REMHAOS_CHANNEL_CAPABILITY_LEAKED_TO_NON_OWNER';
  end if;
  if exists (
    select 1
    from unnest(array['architect', 'builder', 'client_approver']) role,
      lateral projectceo_foundation._package_role_capabilities(role) rc
    where rc.capability = 'manage_project_integrations'
  ) then
    raise exception 'REMHAOS_CHANNEL_CAPABILITY_LEAKED_TO_PACKAGE_SCOPE';
  end if;

  -- Схема моста закрыта от Data API целиком. Если однажды кто-то откроет её
  -- ради удобства, миграция обязана упасть здесь, а не пользователь — там.
  if pg_catalog.has_schema_privilege('authenticated', 'remhaos_channel', 'USAGE')
     or pg_catalog.has_schema_privilege('anon', 'remhaos_channel', 'USAGE') then
    raise exception 'REMHAOS_CHANNEL_PRIVATE_SCHEMA_EXPOSED';
  end if;
end
$guard$;

commit;
