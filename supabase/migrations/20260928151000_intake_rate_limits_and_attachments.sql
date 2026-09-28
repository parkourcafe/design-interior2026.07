-- Аудит 28.09, шаг 5: ограничения частоты и загрузки файлов в брифе.
--
-- 1. public.rate_limits. Код (lib/rate-limit.ts) давно пишет в эту таблицу, но в
--    цепочке миграций репозитория её не было: на окружении, собранном из
--    репозитория, запрос падал и лимит молча пропускал всё. Таблица создаётся,
--    если её ещё нет (в исторической production-базе она есть), с запретом
--    доступа API-ролям. Проверка и учёт — одной функцией под advisory lock,
--    чтобы две одновременные попытки не проходили обе.
-- 2. public.append_intake_attachment — добавление метаданных файла клиента в
--    ответ `attachments` одной транзакцией с блокировкой строки и лимитом
--    числа файлов. Раньше маршрут читал массив, дописывал и перезаписывал:
--    одновременные загрузки теряли записи, а лимита не было вовсе.
--
-- Обе функции SECURITY INVOKER и выданы только service_role: они выполняются
-- с правами серверного маршрута брифа и не дают базе новых прав.

begin;

create table if not exists public.rate_limits (
  id bigint generated always as identity primary key,
  key text not null,
  created_at timestamptz not null default statement_timestamp()
);
create index if not exists rate_limits_key_created_idx
  on public.rate_limits (key, created_at desc);

alter table public.rate_limits enable row level security;
drop policy if exists rate_limits_deny_anon_authenticated on public.rate_limits;
create policy rate_limits_deny_anon_authenticated
  on public.rate_limits
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
revoke all on table public.rate_limits from public, anon, authenticated;
grant select, insert on table public.rate_limits to service_role;

create function public.consume_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 300
     or p_window_seconds is null or p_window_seconds not between 1 and 86400
     or p_max is null or p_max not between 1 and 100000 then
    raise exception using errcode = '22023', message = 'RATE_LIMIT_ARGUMENTS_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rate-limit:' || p_key, 0));
  select count(*) into v_count
  from public.rate_limits r
  where r.key = p_key
    and r.created_at >= statement_timestamp() - make_interval(secs => p_window_seconds);
  if v_count >= p_max then
    return false;
  end if;
  insert into public.rate_limits (key) values (p_key);
  return true;
end
$function$;

create function public.append_intake_attachment(p_project_id uuid, p_item jsonb, p_max_files integer)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_current jsonb;
  v_next jsonb;
begin
  if p_project_id is null or p_item is null or jsonb_typeof(p_item) <> 'object'
     or jsonb_typeof(p_item -> 'path') is distinct from 'string'
     or left(p_item ->> 'path', 37) <> p_project_id::text || '/'
     or p_max_files is null or p_max_files not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INTAKE_ATTACHMENT_INVALID';
  end if;
  -- Сериализация по проекту: вставка первой строки тоже под замком.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('intake-attachments:' || p_project_id::text, 0));
  select a.value into v_current
  from public.answers a
  where a.project_id = p_project_id and a.question_id = 'attachments'
  for update;
  v_current := case when jsonb_typeof(v_current) = 'array' then v_current else '[]'::jsonb end;
  if jsonb_array_length(v_current) >= p_max_files then
    return jsonb_build_object('ok', false, 'reason', 'too_many_files', 'count', jsonb_array_length(v_current));
  end if;
  v_next := v_current || jsonb_build_array(p_item);
  insert into public.answers (project_id, question_id, value)
  values (p_project_id, 'attachments', v_next)
  on conflict (project_id, question_id) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(v_next));
end
$function$;

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.consume_rate_limit(text, integer, integer)',
    'public.append_intake_attachment(uuid, jsonb, integer)'
  ] loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_signature);
    execute pg_catalog.format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$grants$;

commit;
