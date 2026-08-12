\set ON_ERROR_STOP on

-- Неоднозначный поиск ожидающей связи — это НАРУШЕНИЕ ИНВАРИАНТА, а не выбор.
--
-- `find_pending_notice_binding` раньше разрешал неоднозначность через
-- `order by created_at desc limit 1`. Такой ответ выглядит рабочим и прячет
-- главное: вторая ожидающая связь остаётся жить, занимает чат и никем не
-- разбирается. Функция обязана отказать кодом `P1112`, а не выбрать удачную.
--
-- Проверить это на здоровой базе нельзя: уникальный индекс делает состояние
-- невозможным. Поэтому состояние создаётся ИСКУССТВЕННО и ровно на время одной
-- транзакции — индекс снимается, две строки вставляются, функция вызывается, и
-- всё откатывается целиком. DDL в PostgreSQL транзакционен, поэтому `rollback`
-- возвращает индекс вместе со строками: за пределами этого файла база о
-- случившемся не знает.

\set project_b '42222222-2222-4222-8222-222222222222'
\set project_c '43333333-3333-4333-8333-333333333333'
\set owner_a '31111111-1111-4111-8111-111111111111'

-- Состояние ДО: инвариант держится, ожидающих связей на этих чатах нет.
do $before$
begin
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    where c.relname = 'project_channel_bindings_one_live_per_chat'
      and i.indisvalid and i.indisunique
  ) then
    raise exception 'DB4_TGA_CHAT_INDEX_MISSING_BEFORE';
  end if;
  if exists (
    select 1 from remhaos_channel.project_channel_bindings
    where external_chat_id in (-109000, -109001)
  ) then
    raise exception 'DB4_TGA_FIXTURE_CHATS_NOT_CLEAN';
  end if;
end
$before$;

begin;

-- Снимается ИМЕННО тот индекс, который защищает инвариант, и только он: если
-- однажды его переименуют или ослабят, этот сценарий упадёт здесь — и это
-- верное падение.
drop index remhaos_channel.project_channel_bindings_one_live_per_chat;

-- Две ожидающие связи ДВУХ РАЗНЫХ проектов на ОДНОМ чате. Разные проекты — не
-- случайность: инвариант по проекту снимать не требуется, и снимать его было бы
-- лишним послаблением.
insert into remhaos_channel.project_channel_bindings (
  organization_id, project_id, binding_id, provider, bot_instance_id,
  external_chat_id, external_chat_type, status, notice_version,
  initiated_by_user_id
)
select pw.organization_id, pw.project_id,
  case pw.project_id
    when :'project_b'::uuid then '7a000000-0000-4000-8000-00000000000a'::uuid
    else '7b000000-0000-4000-8000-00000000000b'::uuid
  end,
  'telegram', 'db4-ambiguity-bot', -109000, 'supergroup', 'notice_pending',
  'notice-v1', :'owner_a'
from project_intelligence.project_workflows pw
where pw.project_id in (:'project_b'::uuid, :'project_c'::uuid);

do $seed_is_ambiguous$
begin
  if (
    select count(*) from remhaos_channel.project_channel_bindings
    where external_chat_id = -109000 and status = 'notice_pending'
  ) <> 2 then
    raise exception 'DB4_TGA_AMBIGUITY_NOT_CONSTRUCTED';
  end if;
end
$seed_is_ambiguous$;

-- И обратная сторона: при ОДНОЙ ожидающей связи функция отвечает именно ею.
-- Без этой проверки предыдущая доказывала бы лишь то, что функция умеет
-- падать, — например, всегда.
insert into remhaos_channel.project_channel_bindings (
  organization_id, project_id, binding_id, provider, bot_instance_id,
  external_chat_id, external_chat_type, status, notice_version,
  initiated_by_user_id
)
select pw.organization_id, pw.project_id,
  '7c000000-0000-4000-8000-00000000000c'::uuid,
  'telegram', 'db4-ambiguity-bot', -109001, 'supergroup', 'notice_pending',
  'notice-v1', :'owner_a'
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111';

set local role service_role;

do $ambiguity_is_refused$
declare
  v_refused boolean := false;
  v_sqlstate text;
begin
  begin
    perform remhaos_channel_api.find_pending_notice_binding('db4-ambiguity-bot', -109000);
  exception
    when sqlstate 'P1112' then
      v_refused := true;
    when others then
      -- Любой другой код означает, что функция отказала не по той причине —
      -- например, упала на `too many rows` вместо осознанного отказа.
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      raise exception 'DB4_TGA_WRONG_SQLSTATE:%', v_sqlstate;
  end;

  -- Проверка стоит СНАРУЖИ обработчика: подними её внутрь — и собственное
  -- падение теста поймалось бы веткой `when others` и было бы переименовано в
  -- «не тот SQLSTATE». Первая редакция была написана именно так, и негативный
  -- контроль показал не ту причину, что произошла.
  if not v_refused then
    raise exception 'DB4_TGA_AMBIGUITY_NOT_DETECTED';
  end if;
end
$ambiguity_is_refused$;

do $single_is_returned$
declare
  v_data jsonb;
begin
  v_data := remhaos_channel_api.find_pending_notice_binding(
    'db4-ambiguity-bot', -109001
  ) -> 'data';
  if not (v_data ->> 'pending')::boolean then
    raise exception 'DB4_TGA_SINGLE_PENDING_NOT_FOUND:%', v_data;
  end if;
  if v_data ->> 'bindingId' is distinct from '7c000000-0000-4000-8000-00000000000c' then
    raise exception 'DB4_TGA_SINGLE_PENDING_WRONG_ID:%', v_data ->> 'bindingId';
  end if;
end
$single_is_returned$;

rollback;

-- Состояние ПОСЛЕ: искусственная порча откачена целиком — и строки, и индекс.
do $after$
begin
  if exists (
    select 1 from remhaos_channel.project_channel_bindings
    where external_chat_id in (-109000, -109001)
  ) then
    raise exception 'DB4_TGA_ARTIFICIAL_ROWS_SURVIVED_ROLLBACK';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    where c.relname = 'project_channel_bindings_one_live_per_chat'
      and i.indisvalid and i.indisunique
  ) then
    raise exception 'DB4_TGA_CHAT_INDEX_NOT_RESTORED';
  end if;

  -- И инвариант снова невозможно нарушить обычным путём.
  begin
    insert into remhaos_channel.project_channel_bindings (
      organization_id, project_id, provider, bot_instance_id,
      external_chat_id, external_chat_type, status, notice_version,
      initiated_by_user_id
    )
    select pw.organization_id, pw.project_id, 'telegram', 'db4-ambiguity-bot',
      -109000, 'supergroup', 'notice_pending', 'notice-v1',
      '31111111-1111-4111-8111-111111111111'
    from project_intelligence.project_workflows pw
    where pw.project_id in (
      '42222222-2222-4222-8222-222222222222',
      '43333333-3333-4333-8333-333333333333'
    );
    raise exception 'DB4_TGA_INDEX_NO_LONGER_ENFORCES';
  exception when unique_violation then null;
  end;
end
$after$;

\echo DB4_TELEGRAM_PENDING_AMBIGUITY_OK
