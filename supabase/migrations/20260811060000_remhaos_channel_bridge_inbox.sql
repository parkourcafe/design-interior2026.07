-- Telegram Chat Bridge, вертикаль M3 → M4 (A7 §1.8 / DEC-031, гейт TG3).
--
-- Здесь появляются три недостающих куска контура:
--
--   1. очередь разбора канальных событий → кандидаты Project Inbox;
--   2. человеческая поверхность Inbox: посмотреть и решить;
--   3. хвост очереди уведомлений — какие выдачи M4 ещё не уведомлены.
--
-- ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ. Ни одна функция этой миграции не создаёт
-- официального объекта домена: ни изменения, ни приёмки, ни решения. Кандидат
-- остаётся кандидатом, а `create_change` выполняет человек своей командой
-- после входа. `resulting_entity_id` — СЛЕД уже случившегося факта, и запись
-- этого следа ничего не создаёт (A7 §1.7).
--
-- Проектор уведомлений намеренно ЧИТАЕТ состояние M4, а не встраивается в
-- `distribute_release`. A7 §2.1 запрещает писать Telegram-код внутрь модулей;
-- команда модуля о существовании моста не знает и знать не должна.

begin;

set local search_path = '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Разбор канальных событий
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Захват лизой, как в очереди уведомлений: упавший разборщик не уносит работу
-- с собой, а `skip locked` разводит параллельные прогоны по разным строкам.

create function remhaos_channel_api.claim_channel_events(
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
begin
  if max_rows is null or max_rows < 1 or max_rows > 200 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"maxRows"}'::jsonb
    );
  end if;

  with due as (
    select e.event_id
    from remhaos_channel.channel_events e
    join remhaos_channel.project_channel_bindings b on b.binding_id = e.binding_id
    where e.processing_state in ('pending', 'processing')
      and e.event_kind in ('message', 'edited_message')
      -- Приостановленная связь не разбирается: чат отключён, и делать из его
      -- сообщений предложения проекту больше не за чем.
      and b.status = 'active'
      and (e.lease_expires_at is null or e.lease_expires_at <= statement_timestamp())
    order by e.received_at
    limit max_rows
    for update of e skip locked
  ), claimed as (
    update remhaos_channel.channel_events e
    set processing_state = 'processing',
      attempt_count = e.attempt_count + 1,
      lease_expires_at = statement_timestamp()
        + make_interval(secs => greatest(coalesce(lease_seconds, 60), 5))
    from due
    where e.event_id = due.event_id
    returning e.event_id, e.project_id, e.payload, e.external_sender_id,
      e.event_kind, e.attempt_count, e.external_message_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', c.event_id,
    'projectId', c.project_id,
    'eventKind', c.event_kind,
    'attemptCount', c.attempt_count,
    'externalMessageId', c.external_message_id,
    'externalSenderId', c.external_sender_id,
    'payload', c.payload
  )), '[]'::jsonb)
  into v_data
  from claimed c;

  return remhaos_channel._envelope(v_data);
end
$function$;

-- Запись кандидата. Идемпотентна по паре (событие, вид): повторный разбор того
-- же события не плодит вторую карточку в Inbox — иначе перезапуск разборщика
-- превращался бы в наводнение.
create function remhaos_channel_api.record_inbox_candidate(
  event_id uuid,
  candidate_kind text,
  origin text,
  extraction_schema_version text,
  summary text,
  confidence text default null,
  extraction_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_event record;
  v_candidate_id uuid;
begin
  select e.organization_id, e.project_id, e.event_id
  into v_event
  from remhaos_channel.channel_events e
  where e.event_id = event_id;

  if not found then
    perform projectceo_foundation._raise(
      'P1104', 'not_found', '{"entity":"channel_event"}'::jsonb
    );
  end if;

  -- `human` сюда не принимается: этой дверью ходит система. Человек своё
  -- решение оставляет через `review_inbox_candidate` со своей сессией.
  if origin not in ('ai', 'rule') then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"origin"}'::jsonb
    );
  end if;

  insert into remhaos_channel.project_inbox_candidates (
    organization_id, project_id, event_id, candidate_kind, origin,
    extraction_schema_version, extraction_model, summary, confidence
  )
  values (
    v_event.organization_id, v_event.project_id, event_id, candidate_kind,
    origin, extraction_schema_version, extraction_model, summary, confidence
  )
  -- Цель конфликта — ИМЯ ограничения. Список колонок здесь развалился бы о
  -- `#variable_conflict use_variable`: `event_id` и `candidate_kind` — имена
  -- параметров, и спецификация вывелась бы по выражению, а не по индексу.
  on conflict on constraint project_inbox_candidates_event_kind_key do nothing
  returning candidate_id into v_candidate_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'created', v_candidate_id is not null,
    'candidateId', coalesce(
      v_candidate_id,
      (select c.candidate_id
       from remhaos_channel.project_inbox_candidates c
       where c.event_id = event_id and c.candidate_kind = candidate_kind)
    )
  ));
end
$function$;

-- Закрытие события. `ignored` — законный исход: не в каждом сообщении на
-- стройке есть предложение проекту, и притворяться, что есть, значит
-- засорять Inbox.
create function remhaos_channel_api.complete_channel_event(
  event_id uuid,
  outcome text,
  failure_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_state text;
  v_attempt integer;
begin
  if outcome not in ('processed', 'ignored', 'failed') then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"outcome"}'::jsonb
    );
  end if;

  select e.attempt_count into v_attempt
  from remhaos_channel.channel_events e
  where e.event_id = event_id;

  if not found then
    perform projectceo_foundation._raise(
      'P1104', 'not_found', '{"entity":"channel_event"}'::jsonb
    );
  end if;

  -- Пять попыток и в dead_letter. Бесконечный ретрай на событии, которое
  -- разбор не берёт, держит очередь занятой навсегда; строка остаётся в базе
  -- видимой, а не пропадает.
  v_state := case
    when outcome = 'failed' and v_attempt >= 5 then 'dead_letter'
    when outcome = 'failed' then 'pending'
    else outcome
  end;

  update remhaos_channel.channel_events e
  set processing_state = v_state,
    lease_expires_at = null,
    failure_code = case when outcome = 'failed' then failure_code else null end
  where e.event_id = event_id;

  return remhaos_channel._envelope(jsonb_build_object('state', v_state));
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Хвост очереди уведомлений
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Какие выдачи M4 ещё не уведомлены. Читается состояние домена, а не
-- перехватывается команда: `distribute_release` о мосте не знает.
--
-- Только проекты с активной связью: строить хвост по проектам без чата значит
-- заставить проектор перебирать работу, которой нет.

create function remhaos_channel_api.list_distribution_notification_backlog(
  max_rows integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_data jsonb;
begin
  if max_rows is null or max_rows < 1 or max_rows > 200 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"maxRows"}'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into v_data
  from (
    select d.project_id as "projectId",
      d.distribution_id::text as "distributionId",
      d.production_package_version_id as "versionLabel"
    from projectceo_product.release_distributions d
    join remhaos_channel.project_channel_bindings b
      on b.project_id = d.project_id and b.status = 'active'
    where not exists (
      select 1
      from remhaos_channel.notification_outbox o
      where o.binding_id = b.binding_id
        and o.source_kind = 'release_distributed'
        and o.source_id = d.distribution_id::text
    )
    order by d.distributed_at
    limit max_rows
  ) t;

  return remhaos_channel._envelope(v_data);
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Человеческая поверхность Project Inbox
-- ─────────────────────────────────────────────────────────────────────────────

create function remhaos_channel_api.list_project_inbox(
  project_id uuid,
  max_rows integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_can_review boolean;
  v_data jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(project_id, 'view_project');

  if max_rows is null or max_rows < 1 or max_rows > 200 then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"maxRows"}'::jsonb
    );
  end if;

  select exists (
    select 1
    from projectceo_foundation.project_member_capabilities pc
    where pc.project_id = project_id
      and pc.user_id = v_context.actor_user_id
      and pc.capability = 'review_source'
  ) into v_can_review;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into v_data
  from (
    select c.candidate_id::text as "candidateId",
      c.candidate_kind as "candidateKind",
      c.origin,
      c.summary,
      c.confidence,
      c.status,
      c.created_at as "createdAt",
      c.resulting_entity_kind as "resultingEntityKind",
      c.resulting_entity_id as "resultingEntityId"
    from remhaos_channel.project_inbox_candidates c
    where c.project_id = project_id
    order by c.created_at desc
    limit max_rows
  ) t;

  return remhaos_channel._envelope(jsonb_build_object(
    'canReview', v_can_review,
    'candidates', v_data
  ));
end
$function$;

-- Решение человека по кандидату. Официального объекта НЕ создаёт: меняет
-- статус карточки и, если человек уже создал объект своей командой,
-- записывает след. Порядок именно такой — сначала команда домена, потом
-- отметка, — иначе след указывал бы на несуществующее.
create function remhaos_channel_api.review_inbox_candidate(
  project_id uuid,
  candidate_id uuid,
  decision text,
  resulting_entity_kind text default null,
  resulting_entity_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_status text;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(project_id, 'review_source');

  if decision not in ('confirm', 'reject') then
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"decision"}'::jsonb
    );
  end if;
  if decision = 'reject' and resulting_entity_id is not null then
    -- Отклонённый кандидат не может иметь следа официального объекта: это
    -- ровно та путаница, ради предотвращения которой существует граница.
    perform projectceo_foundation._raise(
      'P1111', 'validation_failed', '{"field":"resultingEntityId"}'::jsonb
    );
  end if;

  select c.status into v_status
  from remhaos_channel.project_inbox_candidates c
  where c.candidate_id = candidate_id and c.project_id = project_id;

  if not found then
    perform projectceo_foundation._raise(
      'P1104', 'not_found', '{"entity":"inbox_candidate"}'::jsonb
    );
  end if;
  if v_status <> 'pending' then
    -- Решение принимается один раз. Переголосование задним числом сделало бы
    -- аудит рассказом, а не записью.
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict', '{"reason":"CANDIDATE_ALREADY_REVIEWED"}'::jsonb
    );
  end if;

  update remhaos_channel.project_inbox_candidates c
  set status = case when decision = 'confirm' then 'confirmed' else 'rejected' end,
    reviewed_by_user_id = v_context.actor_user_id,
    reviewed_at = statement_timestamp(),
    resulting_entity_kind = case when decision = 'confirm' then resulting_entity_kind end,
    resulting_entity_id = case when decision = 'confirm' then resulting_entity_id end
  where c.candidate_id = candidate_id;

  return remhaos_channel._envelope(jsonb_build_object(
    'candidateId', candidate_id,
    'status', case when decision = 'confirm' then 'confirmed' else 'rejected' end
  ));
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Права: поимённо, как и в предыдущей миграции
-- ─────────────────────────────────────────────────────────────────────────────

alter function remhaos_channel_api.claim_channel_events(integer, integer)
  owner to pi_table_owner;
alter function remhaos_channel_api.record_inbox_candidate(
  uuid, text, text, text, text, text, text
) owner to pi_table_owner;
alter function remhaos_channel_api.complete_channel_event(uuid, text, text)
  owner to pi_table_owner;
alter function remhaos_channel_api.list_distribution_notification_backlog(integer)
  owner to pi_table_owner;
alter function remhaos_channel_api.list_project_inbox(uuid, integer)
  owner to pi_table_owner;
alter function remhaos_channel_api.review_inbox_candidate(
  uuid, uuid, text, text, text
) owner to pi_table_owner;

-- PostgreSQL выдаёт EXECUTE роли `public` на КАЖДУЮ созданную функцию. Правило
-- `alter default privileges for role pi_table_owner` из миграции
-- `20260811040000` этого не снимает: функции создаются ролью миграции, а
-- владелец меняется уже после создания — правило умолчаний к ним не
-- применяется. Без явного revoke ниже `authenticated` дотягивался бы до
-- разборщика, и guard в конце миграции падал (падал, и правильно делал).
--
-- Отзыв ТОЧЕЧНЫЙ, по шести новым функциям. Сплошной проход по схеме, как в
-- `20260811050000`, здесь был бы ошибкой: он снял бы и гранты предыдущей
-- миграции, которые эта не восстанавливает.
revoke all on function
  remhaos_channel_api.claim_channel_events(integer, integer),
  remhaos_channel_api.record_inbox_candidate(uuid, text, text, text, text, text, text),
  remhaos_channel_api.complete_channel_event(uuid, text, text),
  remhaos_channel_api.list_distribution_notification_backlog(integer),
  remhaos_channel_api.list_project_inbox(uuid, integer),
  remhaos_channel_api.review_inbox_candidate(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Человеческие двери: авторизация внутри
grant execute on function remhaos_channel_api.list_project_inbox(uuid, integer)
  to authenticated;
grant execute on function remhaos_channel_api.review_inbox_candidate(
  uuid, uuid, text, text, text
) to authenticated;

-- Системные двери: только разборщик и проектор
grant execute on function remhaos_channel_api.claim_channel_events(integer, integer)
  to service_role;
grant execute on function remhaos_channel_api.record_inbox_candidate(
  uuid, text, text, text, text, text, text
) to service_role;
grant execute on function remhaos_channel_api.complete_channel_event(uuid, text, text)
  to service_role;
grant execute on function remhaos_channel_api.list_distribution_notification_backlog(integer)
  to service_role;

do $guard$
declare
  v_leaked text;
begin
  -- Системная дверь, доступная человеку, — это и есть та дыра, которую дважды
  -- пропускали guardrail'ы модулей 3 и 4. Проверяется поимённо.
  select signature into v_leaked
  from unnest(array[
    'remhaos_channel_api.claim_channel_events(integer, integer)',
    'remhaos_channel_api.record_inbox_candidate(uuid, text, text, text, text, text, text)',
    'remhaos_channel_api.complete_channel_event(uuid, text, text)',
    'remhaos_channel_api.list_distribution_notification_backlog(integer)'
  ]) signature
  where pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'REMHAOS_CHANNEL_SYSTEM_RPC_EXPOSED:%', v_leaked;
  end if;

  -- И обратное: человеческая дверь, до которой человек не достаёт, — молча
  -- неработающий экран.
  select signature into v_leaked
  from unnest(array[
    'remhaos_channel_api.list_project_inbox(uuid, integer)',
    'remhaos_channel_api.review_inbox_candidate(uuid, uuid, text, text, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'REMHAOS_CHANNEL_HUMAN_RPC_UNREACHABLE:%', v_leaked;
  end if;
end
$guard$;

commit;
