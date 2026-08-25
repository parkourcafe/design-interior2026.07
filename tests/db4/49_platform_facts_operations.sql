\set ON_ERROR_STOP on

-- DB4: платформенный реестр фактов (Фаза 2, A1; DEC-004/DEC-038).
-- Золотой проект 41111111-… засеян DB3 (owner 31111111-, архитектор
-- 32222222-). Здесь: провенанс как CHECK, идемпотентность и
-- state_revision-гейт командной двери, вытеснение как единственный
-- односторонний переход append-only, негативная аренда, чтение.
-- Значения в DO-блоки передаются через set_config/current_setting:
-- psql не интерполирует :переменные внутри доллар-кавычек.

begin;
insert into project_intelligence.sources (
  organization_id, project_id, source_id, kind, checksum
)
select
  pw.organization_id,
  pw.project_id,
  'platform-facts-source',
  'plain_text',
  decode('66d89b8f161e429a0b37c7916c8aa72e0998ba5afb19670fd050cdb5eaf3f64c', 'hex')
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111';
commit;

-- === 1. Архитектор создаёт human_stated факт ================================

begin;
-- Чтение ревизии — исполнителем ДО смены роли: authenticated не видит
-- приватные схемы напрямую (это и есть deny-by-default).
select state_revision as rev1
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_platform_api.create_project_fact(
  '41111111-1111-4111-8111-111111111111',
  'requirement',
  jsonb_build_object('title', 'Скрытая проводка в санузле'),
  'human_stated',
  null, null,
  'Заказчик озвучил на первичном созвоне',
  null,
  :'rev1',
  'db4-platform-fact-1'
) as fact1 \gset
select set_config('projectceo.db4_fact1', :'fact1'::jsonb -> 'result' ->> 'factId', false) as bridge1 \gset
select set_config('projectceo.db4_rev1', :'rev1', false) as bridge1r \gset
commit;

do $assert_fact_1$
declare
  v_count integer;
  v_stated_by boolean;
  v_records integer;
  v_revision bigint;
  v_fact1 uuid := current_setting('projectceo.db4_fact1')::uuid;
begin
  select count(*), bool_or(stated_by is not null) into v_count, v_stated_by
  from projectceo_platform.project_facts
  where project_id = '41111111-1111-4111-8111-111111111111'
    and fact_id = v_fact1;
  if v_count <> 1 or v_stated_by is not true then
    raise exception 'DB4_PLATFORM_FACT_1_INVALID:%', v_count;
  end if;
  select count(*) into v_records
  from projectceo_product.command_records
  where project_id = '41111111-1111-4111-8111-111111111111'
    and operation = 'create_project_fact';
  if v_records <> 1 then
    raise exception 'DB4_PLATFORM_FACT_1_COMMAND_RECORDS:%', v_records;
  end if;
  select state_revision into v_revision
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  if v_revision <> current_setting('projectceo.db4_rev1')::bigint + 1 then
    raise exception 'DB4_PLATFORM_FACT_1_STATE_REVISION_NOT_BUMPED:%', v_revision;
  end if;
end
$assert_fact_1$;

-- === 2. Повтор с тем же ключом — replay, дубля нет ==========================

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $replay_fact_1$
declare
  v_result jsonb;
  v_fact1 uuid := current_setting('projectceo.db4_fact1')::uuid;
begin
  select projectceo_platform_api.create_project_fact(
    '41111111-1111-4111-8111-111111111111',
    'requirement',
    jsonb_build_object('title', 'Скрытая проводка в санузле'),
    'human_stated',
    null, null,
    'Заказчик озвучил на первичном созвоне',
    null,
    current_setting('projectceo.db4_rev1')::bigint,
    'db4-platform-fact-1'
  ) into v_result;
  if v_result ->> 'factId' <> v_fact1::text then
    raise exception 'DB4_PLATFORM_FACT_1_REPLAY_ID_MISMATCH';
  end if;
end
$replay_fact_1$;
commit;

-- Счётчик строк — исполнителем: authenticated в приватную схему не ходит.
do $replay_count$
declare
  v_count integer;
begin
  select count(*) into v_count
  from projectceo_platform.project_facts
  where project_id = '41111111-1111-4111-8111-111111111111';
  if v_count <> 1 then
    raise exception 'DB4_PLATFORM_FACT_1_REPLAY_DUPLICATE:%', v_count;
  end if;
end
$replay_count$;

-- === 3-6. Отказы валидации и провенанса =====================================

begin;
-- Ревизия нужна валидная во ВСЕХ негативах: state_revision-гейт стоит
-- до специфических проверок, иначе ловится не тот код отказа.
select state_revision as revneg
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select set_config('projectceo.db4_revneg', :'revneg', false) as bridgen \gset
do $validation_denials$
declare
  v_project uuid := '41111111-1111-4111-8111-111111111111';
  v_content jsonb := jsonb_build_object('title', 'Факт без провенанса');
  v_rev bigint := current_setting('projectceo.db4_revneg')::bigint;
begin
  begin
    perform projectceo_platform_api.create_project_fact(
      v_project, 'requirement', v_content, 'extracted',
      null, null, null, null, v_rev, 'db4-platform-neg-1');
    raise exception 'DB4_PLATFORM_EXTRACTED_WITHOUT_SOURCE_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_platform_api.create_project_fact(
      v_project, 'requirement', v_content, 'extracted',
      'no-such-source', 'revision-x', null, null, v_rev, 'db4-platform-neg-2');
    raise exception 'DB4_PLATFORM_EXTRACTED_UNKNOWN_SOURCE_ACCEPTED';
  exception when sqlstate 'P1104' then null;
  end;
  begin
    perform projectceo_platform_api.create_project_fact(
      v_project, 'constraint', v_content, 'human_stated',
      null, null, null, null, v_rev, 'db4-platform-neg-3');
    raise exception 'DB4_PLATFORM_HUMAN_STATED_WITHOUT_REASON_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_platform_api.create_project_fact(
      v_project, 'risk', v_content, 'human_stated',
      null, null, 'причина', null, v_rev, 'db4-platform-neg-4');
    raise exception 'DB4_PLATFORM_INVALID_FACT_TYPE_ACCEPTED';
  exception when sqlstate 'P1111' then null;
  end;
end
$validation_denials$;
commit;

-- === 7. extracted-факт с реальным источником ================================

begin;
select state_revision as rev2
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_platform_api.create_project_fact(
  '41111111-1111-4111-8111-111111111111',
  'constraint',
  jsonb_build_object('title', 'Несущая колонна на плане'),
  'extracted',
  'platform-facts-source',
  'platform-facts-revision-1',
  null,
  null,
  :'rev2',
  'db4-platform-fact-2'
) as fact2 \gset
select set_config('projectceo.db4_fact2', :'fact2'::jsonb -> 'result' ->> 'factId', false) as bridge2 \gset
commit;

do $assert_fact_2$
declare
  v_source text;
  v_revision text;
  v_stated_by boolean;
  v_fact2 uuid := current_setting('projectceo.db4_fact2')::uuid;
begin
  select source_id, source_revision_id, stated_by
  into v_source, v_revision, v_stated_by
  from projectceo_platform.project_facts
  where project_id = '41111111-1111-4111-8111-111111111111'
    and fact_id = v_fact2;
  if v_source <> 'platform-facts-source'
    or v_revision <> 'platform-facts-revision-1'
    or v_stated_by is not null then
    raise exception 'DB4_PLATFORM_FACT_2_PROVENANCE_INVALID';
  end if;
end
$assert_fact_2$;

-- === 8. Вытеснение: новая ревизия факта =====================================

begin;
select state_revision as rev3
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_platform_api.create_project_fact(
  '41111111-1111-4111-8111-111111111111',
  'constraint',
  jsonb_build_object('title', 'Несущая колонна на плане (уточнено по ревизии 2)'),
  'extracted',
  'platform-facts-source',
  'platform-facts-revision-2',
  null,
  current_setting('projectceo.db4_fact2')::uuid,
  :'rev3',
  'db4-platform-fact-3'
) as fact3 \gset
select set_config('projectceo.db4_fact3', :'fact3'::jsonb -> 'result' ->> 'factId', false) as bridge3 \gset
commit;

do $assert_supersede$
declare
  v_old_superseded timestamptz;
  v_old_by uuid;
  v_old_title text;
  v_new_title text;
  v_fact2 uuid := current_setting('projectceo.db4_fact2')::uuid;
  v_fact3 uuid := current_setting('projectceo.db4_fact3')::uuid;
begin
  select superseded_at, superseded_by, content ->> 'title'
  into v_old_superseded, v_old_by, v_old_title
  from projectceo_platform.project_facts
  where project_id = '41111111-1111-4111-8111-111111111111'
    and fact_id = v_fact2;
  if v_old_superseded is null or v_old_by <> v_fact3 then
    raise exception 'DB4_PLATFORM_SUPERSEDE_NOT_RECORDED';
  end if;
  select content ->> 'title' into v_new_title
  from projectceo_platform.project_facts
  where project_id = '41111111-1111-4111-8111-111111111111'
    and fact_id = v_fact3;
  if v_old_title = v_new_title then
    raise exception 'DB4_PLATFORM_SUPERSEDE_SAME_TITLE';
  end if;
end
$assert_supersede$;

-- Повторное вытеснение уже вытесненного — P1104.
begin;
select state_revision as rev4
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111' \gset
select set_config('projectceo.db4_rev4', :'rev4', false) as bridge4 \gset
begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $double_supersede_denied$
declare
  v_fact2 uuid := current_setting('projectceo.db4_fact2')::uuid;
  v_rev4 bigint := current_setting('projectceo.db4_rev4')::bigint;
begin
  perform projectceo_platform_api.create_project_fact(
    '41111111-1111-4111-8111-111111111111',
    'constraint',
    jsonb_build_object('title', 'Третья ревизия поверх вытесненной'),
    'extracted',
    'platform-facts-source',
    'platform-facts-revision-3',
    null,
    v_fact2,
    v_rev4,
    'db4-platform-neg-5');
  raise exception 'DB4_PLATFORM_DOUBLE_SUPERSEDE_ACCEPTED';
exception when sqlstate 'P1104' then null;
end
$double_supersede_denied$;
commit;

-- === 9. Append-only: UPDATE/DELETE и обратный переход запрещены =============

begin;
do $append_only_denied$
declare
  v_fact1 uuid := current_setting('projectceo.db4_fact1')::uuid;
  v_fact2 uuid := current_setting('projectceo.db4_fact2')::uuid;
begin
  begin
    update projectceo_platform.project_facts
    set content = jsonb_build_object('title', 'переписано')
    where project_id = '41111111-1111-4111-8111-111111111111'
      and fact_id = v_fact1;
    raise exception 'DB4_PLATFORM_UPDATE_ACCEPTED';
  exception
    when object_not_in_prerequisite_state then null;
    when insufficient_privilege then null;
  end;
  begin
    delete from projectceo_platform.project_facts
    where project_id = '41111111-1111-4111-8111-111111111111'
      and fact_id = v_fact1;
    raise exception 'DB4_PLATFORM_DELETE_ACCEPTED';
  exception
    when object_not_in_prerequisite_state then null;
    when insufficient_privilege then null;
  end;
  begin
    update projectceo_platform.project_facts
    set superseded_at = null, superseded_by = null
    where project_id = '41111111-1111-4111-8111-111111111111'
      and fact_id = v_fact2;
    raise exception 'DB4_PLATFORM_UNSUPERSEDE_ACCEPTED';
  exception
    when object_not_in_prerequisite_state then null;
    when insufficient_privilege then null;
  end;
end
$append_only_denied$;
commit;

-- === 10. Негативная аренда: строитель и неизвестный проект ==================

begin;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';
do $builder_denied$
begin
  perform projectceo_platform_api.create_project_fact(
    '41111111-1111-4111-8111-111111111111',
    'requirement',
    jsonb_build_object('title', 'Строитель не записывает факты'),
    'human_stated',
    null, null, 'попытка', null, 1, 'db4-platform-neg-6');
  raise exception 'DB4_PLATFORM_BUILDER_CREATE_ACCEPTED';
exception when sqlstate 'P1103' then null;
end
$builder_denied$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $foreign_project_denied$
begin
  perform projectceo_platform_api.list_project_facts(
    '99999999-9999-4999-8999-999999999999');
  raise exception 'DB4_PLATFORM_FOREIGN_PROJECT_READ_ACCEPTED';
exception when sqlstate 'P1103' then null;
end
$foreign_project_denied$;
commit;

-- === 11. Чтение: активные видны, вытесненный скрыт по умолчанию =============

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $read_assertions$
declare
  v_active jsonb;
  v_all jsonb;
  v_active_count integer;
  v_all_count integer;
  v_superseded_visible boolean := false;
  i integer;
  v_fact2 text := current_setting('projectceo.db4_fact2');
begin
  v_active := projectceo_platform_api.list_project_facts(
    '41111111-1111-4111-8111-111111111111');
  v_all := projectceo_platform_api.list_project_facts(
    '41111111-1111-4111-8111-111111111111', true);
  v_active_count := jsonb_array_length(v_active -> 'facts');
  v_all_count := jsonb_array_length(v_all -> 'facts');
  if v_all_count <> 3 or v_active_count <> 2 then
    raise exception 'DB4_PLATFORM_READ_COUNTS_INVALID:%/%', v_active_count, v_all_count;
  end if;
  for i in 0 .. v_active_count - 1 loop
    if v_active -> 'facts' -> i ->> 'factId' = v_fact2 then
      raise exception 'DB4_PLATFORM_SUPERSEDED_VISIBLE_BY_DEFAULT';
    end if;
  end loop;
  for i in 0 .. v_all_count - 1 loop
    if v_all -> 'facts' -> i ->> 'factId' = v_fact2 then
      v_superseded_visible := (v_all -> 'facts' -> i ->> 'supersededAt') is not null;
    end if;
  end loop;
  if not v_superseded_visible then
    raise exception 'DB4_PLATFORM_SUPERSEDED_NOT_IN_FULL_LIST';
  end if;
end
$read_assertions$;
commit;

-- === 12. anon недостижим, stale_state гейт ==================================

begin;
set local role anon;
do $anon_denied$
begin
  perform projectceo_platform_api.create_project_fact(
    '41111111-1111-4111-8111-111111111111',
    'requirement',
    jsonb_build_object('title', 'anon'),
    'human_stated',
    null, null, 'причина', null, 1, 'db4-platform-neg-7');
  raise exception 'DB4_PLATFORM_ANON_CREATE_ACCEPTED';
exception when insufficient_privilege then null;
end
$anon_denied$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $stale_denied$
begin
  perform projectceo_platform_api.create_project_fact(
    '41111111-1111-4111-8111-111111111111',
    'open_question',
    jsonb_build_object('title', 'Против устаревшей ревизии состояния'),
    'human_stated',
    null, null, 'причина', null,
    1,
    'db4-platform-neg-8');
  raise exception 'DB4_PLATFORM_STALE_STATE_ACCEPTED';
exception when sqlstate 'P1107' then null;
end
$stale_denied$;
commit;

select 'DB4_PLATFORM_FACTS_OK' as result;
