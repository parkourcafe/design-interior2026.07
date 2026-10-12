\set ON_ERROR_STOP on

-- DB4-97: уточнения клиента в M1-чтении паспорта выдаются сервером только
-- законным читателям (ТЗ 08.10 FIX-03, доработка 11.10, решение владельца п. 3;
-- миграция 20261011100000). Полномочие — DEC-041 §3, проверяется при каждом
-- чтении. Сид: tests/db3/20_foundation_operations.sql — проект 41111111,
-- владелец/дизайнер 31111111 (owner_lead). Архитектор, строитель и клиент
-- заводятся здесь (как в DB4-82). Весь файл — одна транзакция с откатом.

begin;

create function pg_temp.rev()
returns bigint language sql as $function$
  select state_revision from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111'
$function$;

-- Чтение от имени пользователя через тот же вход, что PostgREST.
create function pg_temp.read_as(p_user uuid, p_project uuid default '41111111-1111-4111-8111-111111111111')
returns jsonb language plpgsql as $function$
declare v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);
  select projectceo_read_api.get_m1_legacy_project_read(p_project) into v_result;
  perform pg_catalog.set_config('role', 'postgres', true);
  return v_result;
end
$function$;

create function pg_temp.call_as(p_user uuid, p_sql text)
returns jsonb language plpgsql as $function$
declare v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user::text, true);
  perform pg_catalog.set_config('role', 'authenticated', true);
  execute p_sql into v_result;
  perform pg_catalog.set_config('role', 'postgres', true);
  return v_result;
end
$function$;

create function pg_temp.expect_denied(p_user uuid, p_project uuid, p_label text)
returns void language plpgsql as $function$
declare v_state text;
begin
  begin
    perform pg_temp.read_as(p_user, p_project);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform pg_catalog.set_config('role', 'postgres', true);
    if v_state not in ('P1103', 'P1104', '42501') then
      raise exception 'DB4_97_WRONG_FAILURE:%:%', p_label, v_state;
    end if;
    return;
  end;
  raise exception 'DB4_97_EXPECTED_FAILURE:%', p_label;
end
$function$;

-- Проверка выдачи: паспорт без уточнений, флаг false; с уточнениями, флаг true.
create function pg_temp.assert_visible(p_result jsonb, p_expected boolean, p_label text)
returns void language plpgsql as $function$
declare
  v_passport jsonb := p_result #> '{data,passportRevision,passport}';
  v_flag text := p_result #>> '{data,passportRevision,clarificationsVisible}';
begin
  if v_passport is null then
    raise exception 'DB4_97_NO_PASSPORT:%:%', p_label, p_result;
  end if;
  -- Строго: флаг обязан быть ровно 'true' или 'false'; null — тоже отказ
  -- (сравнение через is distinct from, иначе null проскальзывает мимо if).
  if (v_passport ? 'clarifications') is distinct from p_expected
     or v_flag is distinct from p_expected::text then
    raise exception 'DB4_97_ASSERT:%:expected=% has_key=% flag=%',
      p_label, p_expected, v_passport ? 'clarifications', coalesce(v_flag, '<null>');
  end if;
  if p_expected and v_passport #>> '{clarifications,0,question_id}' <> 'cooking' then
    raise exception 'DB4_97_CLARIFICATION_CONTENT:%:%', p_label, v_passport -> 'clarifications';
  end if;
  -- Остальной паспорт одинаков для всех читателей.
  if (v_passport - 'clarifications') <> '{"object":{"type":"flat","area_m2":61,"city":"db4-97"}}'::jsonb then
    raise exception 'DB4_97_PASSPORT_CHANGED:%:%', p_label, v_passport - 'clarifications';
  end if;
end
$function$;

-- === Сид ======================================================================
insert into auth.users (id, email, email_confirmed_at) values
  ('97111111-1111-4111-8111-111111111111', 'builder-97@example.invalid', now()),
  ('97222222-2222-4222-8222-222222222222', 'client-97@example.invalid', now()),
  ('97333333-3333-4333-8333-333333333333', 'architect-97@example.invalid', now()),
  ('97444444-4444-4444-8444-444444444444', 'architect2-97@example.invalid', now());

do $seed$
declare v_org uuid;
begin
  select organization_id into v_org from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  insert into project_intelligence.organization_members (organization_id, user_id, role, status)
  values (v_org, '97111111-1111-4111-8111-111111111111', 'member', 'active'),
         (v_org, '97222222-2222-4222-8222-222222222222', 'member', 'active'),
         (v_org, '97333333-3333-4333-8333-333333333333', 'member', 'active'),
         (v_org, '97444444-4444-4444-8444-444444444444', 'member', 'active');
  insert into projectceo_foundation.project_memberships
    (organization_id, project_id, user_id, role, status)
  values
    (v_org, '41111111-1111-4111-8111-111111111111', '97111111-1111-4111-8111-111111111111', 'builder', 'active'),
    (v_org, '41111111-1111-4111-8111-111111111111', '97222222-2222-4222-8222-222222222222', 'client_approver', 'active'),
    (v_org, '41111111-1111-4111-8111-111111111111', '97333333-3333-4333-8333-333333333333', 'architect', 'active'),
    (v_org, '41111111-1111-4111-8111-111111111111', '97444444-4444-4444-8444-444444444444', 'architect', 'active');
  insert into projectceo_foundation.project_member_capabilities
    (organization_id, project_id, user_id, capability)
  select v_org, '41111111-1111-4111-8111-111111111111', member.user_id, rc.capability
  from (values
    ('97111111-1111-4111-8111-111111111111'::uuid, 'builder'),
    ('97222222-2222-4222-8222-222222222222'::uuid, 'client_approver'),
    ('97333333-3333-4333-8333-333333333333'::uuid, 'architect'),
    ('97444444-4444-4444-8444-444444444444'::uuid, 'architect')
  ) member(user_id, role)
  cross join lateral projectceo_foundation._role_capabilities(member.role) rc;

  -- Ревизия паспорта с уточнением — тем же триггером, что серверный маршрут.
  update public.projects
  set passport = '{"object":{"type":"flat","area_m2":61,"city":"db4-97"},
                   "clarifications":[{"question_id":"cooking","question":"Готовите дома?","text":"синтетика: +7 900 000-00-97, 4 500 000"}]}'::jsonb,
      passport_revision_llm_ok = true
  where id = '41111111-1111-4111-8111-111111111111';
end
$seed$;

-- === 1. Владелец / дизайнер (owner_lead) видит ==============================
select pg_temp.assert_visible(pg_temp.read_as('31111111-1111-4111-8111-111111111111'), true, 'owner_designer');

-- === 2. Архитектор без права не видит; гейт RPC его пропускает ==============
select pg_temp.assert_visible(pg_temp.read_as('97333333-3333-4333-8333-333333333333'), false, 'architect_without_grant');

-- === 3. Выдача права владельцем → архитектор видит ===========================
select pg_temp.call_as('31111111-1111-4111-8111-111111111111', pg_catalog.format(
  'select projectceo_platform_api.grant_passport_approval(%L, %L, %L, %s, %L)',
  '41111111-1111-4111-8111-111111111111', '97333333-3333-4333-8333-333333333333',
  'db4-97 доступ', pg_temp.rev(), 'db4-97-grant'));
select pg_temp.assert_visible(pg_temp.read_as('97333333-3333-4333-8333-333333333333'), true, 'architect_with_grant');
-- Второй архитектор право не получал — не видит (право персональное).
select pg_temp.assert_visible(pg_temp.read_as('97444444-4444-4444-8444-444444444444'), false, 'other_architect_no_grant');

-- === 4. Отзыв права → снова не видит, проверка при каждом чтении ============
select pg_temp.call_as('31111111-1111-4111-8111-111111111111', pg_catalog.format(
  'select projectceo_platform_api.revoke_passport_approval(%L, %L, %L, %s, %L)',
  '41111111-1111-4111-8111-111111111111', '97333333-3333-4333-8333-333333333333',
  'db4-97 отзыв', pg_temp.rev(), 'db4-97-revoke'));
select pg_temp.assert_visible(pg_temp.read_as('97333333-3333-4333-8333-333333333333'), false, 'architect_after_revoke');

-- Деактивация членства в организации закрывает уже само чтение
-- (_authorize_project_human → P1103), даже если строка права осталась: до
-- правила об уточнениях дело не доходит. Это сильнее, чем «паспорт без ключа».
select pg_temp.call_as('31111111-1111-4111-8111-111111111111', pg_catalog.format(
  'select projectceo_platform_api.grant_passport_approval(%L, %L, %L, %s, %L)',
  '41111111-1111-4111-8111-111111111111', '97444444-4444-4444-8444-444444444444',
  'db4-97 доступ 2', pg_temp.rev(), 'db4-97-grant-2'));
select pg_temp.assert_visible(pg_temp.read_as('97444444-4444-4444-8444-444444444444'), true, 'architect2_with_grant');
update project_intelligence.organization_members set status = 'inactive'
where user_id = '97444444-4444-4444-8444-444444444444';
select pg_temp.expect_denied('97444444-4444-4444-8444-444444444444', '41111111-1111-4111-8111-111111111111', 'architect2_inactive_member');

-- === 5. Клиент и строитель — RPC отказывает целиком, как и раньше ===========
select pg_temp.expect_denied('97222222-2222-4222-8222-222222222222', '41111111-1111-4111-8111-111111111111', 'client');
select pg_temp.expect_denied('97111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111', 'builder');

-- === 6. Чужой проект и чужая организация ====================================
-- Владелец организации B читает проект A — отказ; владелец A читает проект B — отказ.
select pg_temp.expect_denied('33333333-3333-4333-8333-333333333333', '41111111-1111-4111-8111-111111111111', 'other_org_owner');
select pg_temp.expect_denied('31111111-1111-4111-8111-111111111111', '42222222-2222-4222-8222-222222222222', 'owner_other_project');

-- === 7. Паспорт без уточнений: ключа нет ни у кого, флаг у владельца true ===
update public.projects
set passport = '{"object":{"type":"flat","area_m2":61,"city":"db4-97"}}'::jsonb,
    passport_revision_llm_ok = true
where id = '41111111-1111-4111-8111-111111111111';
do $no_key$
declare v jsonb;
begin
  v := pg_temp.read_as('31111111-1111-4111-8111-111111111111');
  if (v #> '{data,passportRevision,passport}') ? 'clarifications'
     or v #>> '{data,passportRevision,clarificationsVisible}' <> 'true' then
    raise exception 'DB4_97_NO_CLARIFICATIONS_SHAPE:%', v;
  end if;
end
$no_key$;

select 'DB4_97_M1_CLARIFICATIONS_AUTHORITY_OK' as result;

rollback;
