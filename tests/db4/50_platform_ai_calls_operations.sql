\set ON_ERROR_STOP on

-- DB4: учёт вызовов AI (Фаза 2, A2; DEC-009). Дверь системная
-- (service_role), человеческих ролей у учёта нет. Форма запрещает тексты
-- промптов на уровне схемы; у ошибки есть код, у успеха — ответ.

begin;
set local role service_role;
select projectceo_platform_api.record_ai_call(
  'brief', 'custom_question', 'yandex', 'yandexgpt-lite',
  'ok', null, 120, encode(sha256('prompt'), 'hex'), 45, 850
) as ok_id \gset
select projectceo_platform_api.record_ai_call(
  'risks', 'risk_cards', 'yandex', 'yandexgpt-lite',
  'error', 'yandex_http_429', 300, encode(sha256('prompt2'), 'hex'),
  null, 1200
) as err_id \gset
select set_config('projectceo.db4_ai_ok', :'ok_id', false) as b1 \gset
select set_config('projectceo.db4_ai_err', :'err_id', false) as b2 \gset
commit;

do $assert_rows$
declare
  v_ok_count integer;
  v_err_count integer;
  v_err_code text;
  v_ok_completion integer;
begin
  set local role pi_table_owner;
  select count(*) into v_ok_count
  from projectceo_platform.ai_calls
  where id = current_setting('projectceo.db4_ai_ok')::uuid and status = 'ok';
  select count(*), min(error_code) into v_err_count, v_err_code
  from projectceo_platform.ai_calls
  where id = current_setting('projectceo.db4_ai_err')::uuid and status = 'error';
  select completion_chars into v_ok_completion
  from projectceo_platform.ai_calls
  where id = current_setting('projectceo.db4_ai_ok')::uuid;
  if v_ok_count <> 1 or v_err_count <> 1 then
    raise exception 'DB4_AI_CALLS_ROWS_MISSING:%/%', v_ok_count, v_err_count;
  end if;
  if v_err_code <> 'yandex_http_429' or v_ok_completion is null then
    raise exception 'DB4_AI_CALLS_SHAPE_INVALID:%/%', v_err_code, v_ok_completion;
  end if;
end
$assert_rows$;

-- === Отказы формы ============================================================

begin;
set local role service_role;
do $shape_denied$
begin
  -- ok с кодом ошибки — нарушает форму статуса.
  begin
    perform projectceo_platform_api.record_ai_call(
      'brief', 'probe', 'yandex', 'yandexgpt-lite',
      'ok', 'some_error', 10, null, 5, 100);
    raise exception 'DB4_AI_CALLS_OK_WITH_ERROR_CODE_ACCEPTED';
  exception when check_violation then null;
  end;
  -- ok без длины ответа — нарушает форму завершённости.
  begin
    perform projectceo_platform_api.record_ai_call(
      'brief', 'probe', 'yandex', 'yandexgpt-lite',
      'ok', null, 10, null, null, 100);
    raise exception 'DB4_AI_CALLS_OK_WITHOUT_COMPLETION_ACCEPTED';
  exception when check_violation then null;
  end;
  -- недопустимый модуль.
  begin
    perform projectceo_platform_api.record_ai_call(
    'marketing', 'probe', 'yandex', 'yandexgpt-lite',
      'ok', null, 10, null, 5, 100);
    raise exception 'DB4_AI_CALLS_INVALID_MODULE_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
  -- промпт-хеш не 64 hex.
  begin
    perform projectceo_platform_api.record_ai_call(
      'brief', 'probe', 'yandex', 'yandexgpt-lite',
      'ok', null, 10, 'не-хеш', 5, 100);
    raise exception 'DB4_AI_CALLS_BAD_SHA_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
end
$shape_denied$;
commit;

-- === Человеческих ролей у двери нет ==========================================

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $authenticated_denied$
begin
  perform projectceo_platform_api.record_ai_call(
    'brief', 'probe', 'yandex', 'yandexgpt-lite',
    'ok', null, 10, null, 5, 100);
  raise exception 'DB4_AI_CALLS_AUTHENTICATED_ACCEPTED';
exception when insufficient_privilege then null;
end
$authenticated_denied$;
rollback;

begin;
set local role anon;
do $anon_denied$
begin
  perform projectceo_platform_api.record_ai_call(
    'brief', 'probe', 'yandex', 'yandexgpt-lite',
    'ok', null, 10, null, 5, 100);
  raise exception 'DB4_AI_CALLS_ANON_ACCEPTED';
exception when insufficient_privilege then null;
end
$anon_denied$;
rollback;

-- === Текстов промптов в схеме не существует ==================================

begin;
do $no_text_columns$
declare
  v_text_columns integer;
begin
  set local role pi_table_owner;
  select count(*) into v_text_columns
  from information_schema.columns
  where table_schema = 'projectceo_platform'
    and table_name = 'ai_calls'
    and column_name in ('prompt_text', 'completion_text', 'prompt', 'response');
  if v_text_columns <> 0 then
    raise exception 'DB4_AI_CALLS_TEXT_COLUMNS_PRESENT:%', v_text_columns;
  end if;
end
$no_text_columns$;
commit;

select 'DB4_AI_CALLS_OK' as result;
