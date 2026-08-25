-- Platform foundation A2: ai_calls (DEC-009, Фаза 2).
--
-- ЧТО ЭТО. Учёт каждого вызова AI — «AI cost измеряется с Sprint 1»
-- (DEC-009/A1 §2): провайдер, модель, статус, объёмы, длительность,
-- стоимость-заготовка (nullable — billing позже, DEC-009). Без PII и без
-- исходных текстов промптов — только длины и sha256 (односторонний).
--
-- ФОРМА. Та же свежая форма, что project_facts (`20260824130000`):
-- приватная схема, RLS force + revoke-all + internal-owner policy,
-- таблица во владении pi_table_owner.
--
-- ДВЕРЬ. Одна, системная: `record_ai_call` выдана ТОЛЬКО service_role —
-- вызовы AI происходят в серверных маршрутах и воркерах, человеческой
-- поверхности у учёта нет (A2 ТЗ: «не человеческим RPC»). Запись
-- best-effort на стороне приложения: сбой учёта не роняет основной вызов.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни текстов промптов/ответов (колонок такого рода нет
-- в принципе — форма запрещает, а не соглашение), ни биллинга
-- (cost_rub nullable-заготовка), ни агрегатов/квот, ни FK на
-- organization/project (легаси-бриф работает по токену до зачисления —
-- вызовы бывают вне организации; связь мягкая, по id).

begin;

create table projectceo_platform.ai_calls (
  id uuid not null default extensions.gen_random_uuid(),
  organization_id uuid,
  project_id uuid,
  actor_user_id uuid,
  module text not null
    check (module in ('brief', 'risks', 'proposal', 'documentation',
                      'execution', 'platform', 'unknown')),
  purpose text not null
    check (char_length(btrim(purpose)) between 1 and 100),
  provider text not null
    check (provider in ('yandex', 'gigachat', 'zai', 'unknown')),
  model text not null
    check (char_length(btrim(model)) between 1 and 160),
  status text not null check (status in ('ok', 'error')),
  error_code text
    check (error_code is null or char_length(btrim(error_code)) between 1 and 80),
  prompt_chars integer not null check (prompt_chars >= 0),
  completion_chars integer,
  prompt_tokens integer,
  completion_tokens integer,
  prompt_sha256 text
    check (prompt_sha256 is null or prompt_sha256 ~ '^[0-9a-f]{64}$'),
  duration_ms integer,
  cost_rub bigint
    check (cost_rub is null or cost_rub between 0 and 9007199254740991),
  created_at timestamptz not null default now(),
  primary key (id),
  -- Форма — constraint: у ошибки есть код, у успеха кода нет.
  constraint ai_calls_status_shape_check check (
    (status = 'error' and error_code is not null)
    or (status = 'ok' and error_code is null)
  ),
  constraint ai_calls_completion_shape_check check (
    (status = 'ok' and completion_chars is not null)
    or (status = 'error' and completion_chars is null)
  )
);

create index ai_calls_module_created_idx
  on projectceo_platform.ai_calls (module, created_at);

alter table projectceo_platform.ai_calls enable row level security;
alter table projectceo_platform.ai_calls force row level security;
revoke all on table projectceo_platform.ai_calls
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
-- Таблица во владении pi_table_owner (как project_facts): security definer
-- дверь исполняется от него, RLS-политика пускает только его.
alter table projectceo_platform.ai_calls owner to pi_table_owner;
create policy ai_calls_internal_owner
  on projectceo_platform.ai_calls
  for all to pi_table_owner using (true) with check (true);

-- === Единственная дверь: системная запись ===================================

create function projectceo_platform_api.record_ai_call(
  p_module text,
  p_purpose text,
  p_provider text,
  p_model text,
  p_status text,
  p_error_code text default null,
  p_prompt_chars integer default null,
  p_prompt_sha256 text default null,
  p_completion_chars integer default null,
  p_duration_ms integer default null,
  p_organization_id uuid default null,
  p_project_id uuid default null,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_id uuid;
begin
  if p_module is null or p_module not in
    ('brief', 'risks', 'proposal', 'documentation', 'execution', 'platform', 'unknown') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"module"}'::jsonb
    );
  end if;
  if p_purpose is null or btrim(p_purpose) = ''
    or char_length(btrim(p_purpose)) > 100 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"purpose"}'::jsonb
    );
  end if;
  if p_provider is null or p_provider not in ('yandex', 'gigachat', 'zai', 'unknown') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"provider"}'::jsonb
    );
  end if;
  if p_model is null or btrim(p_model) = ''
    or char_length(btrim(p_model)) > 160 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"model"}'::jsonb
    );
  end if;
  if p_status is null or p_status not in ('ok', 'error') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"status"}'::jsonb
    );
  end if;
  if p_prompt_chars is null or p_prompt_chars < 0 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"promptChars"}'::jsonb
    );
  end if;
  if p_prompt_sha256 is not null
    and p_prompt_sha256 !~ '^[0-9a-f]{64}$' then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"promptSha256"}'::jsonb
    );
  end if;

  insert into projectceo_platform.ai_calls (
    organization_id, project_id, actor_user_id,
    module, purpose, provider, model,
    status, error_code,
    prompt_chars, completion_chars,
    prompt_tokens, completion_tokens,
    prompt_sha256, duration_ms
  ) values (
    p_organization_id, p_project_id, p_actor_user_id,
    p_module, btrim(p_purpose), p_provider, btrim(p_model),
    p_status, p_error_code,
    p_prompt_chars, p_completion_chars,
    null, null,
    p_prompt_sha256, p_duration_ms
  ) returning id into v_id;

  return v_id;
end
$function$;

alter function projectceo_platform_api.record_ai_call(
  text, text, text, text, text, text, integer, text, integer, integer,
  uuid, uuid, uuid
) owner to pi_table_owner;

revoke all on function projectceo_platform_api.record_ai_call(
  text, text, text, text, text, text, integer, text, integer, integer,
  uuid, uuid, uuid
) from public, anon, authenticated, pi_human_executor, pi_worker_executor;

grant execute on function projectceo_platform_api.record_ai_call(
  text, text, text, text, text, text, integer, text, integer, integer,
  uuid, uuid, uuid
) to service_role;

-- === Guard ==================================================================

do $guard$
declare
  v_pii_columns integer;
begin
  -- У учёта НЕТ колонок для текстов: форма запрещает PII на уровне схемы.
  select count(*) into v_pii_columns
  from information_schema.columns
  where table_schema = 'projectceo_platform'
    and table_name = 'ai_calls'
    and column_name in ('prompt_text', 'completion_text', 'prompt', 'response');
  if v_pii_columns <> 0 then
    raise exception 'PROJECTCEO_PLATFORM_AI_CALLS_TEXT_COLUMNS_PRESENT:%', v_pii_columns;
  end if;

  if has_function_privilege(
    'authenticated',
    'projectceo_platform_api.record_ai_call(text,text,text,text,text,text,integer,text,integer,integer,uuid,uuid,uuid)',
    'execute'
  ) then
    raise exception 'PROJECTCEO_PLATFORM_AI_CALLS_REACHABLE_BY_AUTHENTICATED';
  end if;
  if has_function_privilege(
    'anon',
    'projectceo_platform_api.record_ai_call(text,text,text,text,text,text,integer,text,integer,integer,uuid,uuid,uuid)',
    'execute'
  ) then
    raise exception 'PROJECTCEO_PLATFORM_AI_CALLS_REACHABLE_BY_ANON';
  end if;
end
$guard$;

commit;
