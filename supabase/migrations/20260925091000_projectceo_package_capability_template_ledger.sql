-- DEC-040 (решения владельца 25.09.2026) / финальный аудит 25.09.2026,
-- SEC-01 и SEC-02.
--
-- 1. Пакетная роль получает ровно пакетный шаблон прав
--    projectceo_foundation._package_role_capabilities(role). Для architect это
--    шесть минимальных прав: view_project, register_source,
--    acknowledge_release, create_change, upload_photo_evidence,
--    review_milestone. До этой миграции enrollment
--    (enroll_organization_project_scope, 20260922183823) выдавал пакетному
--    architect все 18 прав проектного шаблона, включая publish_baseline,
--    publish_release и manage_budget.
--
--    Граница ставится на таблицу, а не на одну функцию: любой продуктовый
--    путь, который пишет package_member_capabilities (enrollment, приглашение,
--    будущее восстановление доступа — все они SECURITY DEFINER-функции
--    pi_table_owner), получает только право из шаблона роли. Попытка выдать
--    право вне шаблона не молчит: она записывается в журнал как
--    denied_by_template.
--
-- 2. Широкие права, выданные до этой миграции, отзываются:
--    * пакетные права вне шаблона роли;
--    * проектное членство не-владельца, за которым нет принятого проектного
--      приглашения (так выглядели участники enrollment до WP-32: они получали
--      проектное членство и проектный шаблон прав). Членство переводится в
--      inactive, его права удаляются.
--    Отзыв — функция _revoke_legacy_capability_grants, чтобы её можно было
--    проверить тестом и повторить оператором на уже заполненной базе.
--    Активное пакетное членство после отзыва дополняется пакетным шаблоном
--    своей роли: минимальный доступ сохраняется, широкий — нет.
--    Известное ограничение: членство переводится в inactive, а не удаляется
--    (на него ссылаются FK журналов и источников), поэтому повторное
--    проектное приглашение отозванному участнику сейчас отклоняется
--    RECIPIENT_ALREADY_HAS_SCOPE. Восстановление проектного доступа — отдельный
--    аудируемый путь, вне Фазы 0.
--
-- 3. Проверяемый аудит выданных прав: append-only журнал
--    capability_grant_ledger (baseline / granted / revoked / denied_by_template)
--    пишется триггерами на обеих таблицах прав; функция
--    verify_capability_grants() сверяет текущее состояние с журналом и с
--    правилами и возвращает пустой набор, если нарушений нет.
--
-- R1-объекты, production и shared-окружения этой миграцией не затрагиваются.

begin;

create table projectceo_foundation.capability_grant_ledger (
  ledger_id bigint generated always as identity primary key,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  scope_kind text not null check (scope_kind in ('project', 'package')),
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid,
  user_id uuid not null,
  capability text not null check (char_length(capability) between 1 and 80),
  action text not null check (action in (
    'baseline', 'granted', 'revoked', 'denied_by_template'
  )),
  member_role text,
  reason text not null check (char_length(reason) between 1 and 120),
  actor_user_id uuid,
  constraint capability_grant_ledger_scope_shape check (
    (scope_kind = 'project' and package_id is null)
    or (scope_kind = 'package' and package_id is not null)
  )
);

create index capability_grant_ledger_subject_idx
  on projectceo_foundation.capability_grant_ledger
  (organization_id, project_id, user_id, capability, ledger_id);

alter table projectceo_foundation.capability_grant_ledger owner to pi_table_owner;
alter table projectceo_foundation.capability_grant_ledger enable row level security;
alter table projectceo_foundation.capability_grant_ledger force row level security;
revoke all on table projectceo_foundation.capability_grant_ledger
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy capability_grant_ledger_internal_owner
  on projectceo_foundation.capability_grant_ledger
  for all to pi_table_owner using (true) with check (true);
create trigger capability_grant_ledger_append_only
  before update or delete on projectceo_foundation.capability_grant_ledger
  for each row execute function projectceo_foundation.reject_append_only_mutation();

-- Причина изменения прав задаётся транзакционно (set_config(..., true))
-- операцией, которая меняет права; иначе — нейтральная 'command'.
create function projectceo_foundation._capability_change_reason()
returns text
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    nullif(pg_catalog.current_setting('projectceo.capability_change_reason', true), ''),
    'command'
  )
$function$;

-- SECURITY INVOKER намеренно: продуктовые пути выдачи прав — SECURITY
-- DEFINER-функции владельца pi_table_owner (enrollment, приглашение,
-- восстановление доступа), и именно они ограничиваются шаблоном. Прямая
-- привилегированная запись SQL (оператор, фикстуры одноразовых тестов) не
-- является продуктовым путём: она не блокируется, но попадает в журнал и
-- помечается verify_capability_grants() как package_capability_outside_template.
create function projectceo_foundation._clamp_package_capability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_role text;
begin
  if current_user <> 'pi_table_owner' then
    return new;
  end if;
  select pm.role into v_role
  from projectceo_foundation.package_memberships pm
  where pm.organization_id = new.organization_id
    and pm.project_id = new.project_id
    and pm.package_id = new.package_id
    and pm.user_id = new.user_id;
  if v_role is null then
    perform projectceo_foundation._raise(
      'P1109', 'scope_conflict',
      '{"reason":"PACKAGE_CAPABILITY_WITHOUT_MEMBERSHIP"}'::jsonb
    );
  end if;
  if not exists (
    select 1
    from projectceo_foundation._package_role_capabilities(v_role) template
    where template.capability = new.capability
  ) then
    insert into projectceo_foundation.capability_grant_ledger (
      scope_kind, organization_id, project_id, package_id, user_id,
      capability, action, member_role, reason, actor_user_id
    ) values (
      'package', new.organization_id, new.project_id, new.package_id, new.user_id,
      new.capability, 'denied_by_template', v_role,
      projectceo_foundation._capability_change_reason(), project_intelligence._request_user_id()
    );
    return null;
  end if;
  return new;
end
$function$;

create function projectceo_foundation._record_capability_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_scope text := case tg_table_name
    when 'package_member_capabilities' then 'package'
    else 'project'
  end;
  v_package uuid;
  v_role text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  if v_scope = 'package' then
    v_package := v_row.package_id;
    select pm.role into v_role
    from projectceo_foundation.package_memberships pm
    where pm.organization_id = v_row.organization_id
      and pm.project_id = v_row.project_id
      and pm.package_id = v_row.package_id
      and pm.user_id = v_row.user_id;
  else
    select pm.role into v_role
    from projectceo_foundation.project_memberships pm
    where pm.organization_id = v_row.organization_id
      and pm.project_id = v_row.project_id
      and pm.user_id = v_row.user_id;
  end if;
  insert into projectceo_foundation.capability_grant_ledger (
    scope_kind, organization_id, project_id, package_id, user_id,
    capability, action, member_role, reason, actor_user_id
  ) values (
    v_scope, v_row.organization_id, v_row.project_id, v_package, v_row.user_id,
    v_row.capability,
    case tg_op when 'DELETE' then 'revoked' else 'granted' end,
    v_role, projectceo_foundation._capability_change_reason(), project_intelligence._request_user_id()
  );
  return null;
end
$function$;

create trigger package_member_capabilities_template_clamp
  before insert on projectceo_foundation.package_member_capabilities
  for each row execute function projectceo_foundation._clamp_package_capability();
create trigger package_member_capabilities_ledger
  after insert or delete on projectceo_foundation.package_member_capabilities
  for each row execute function projectceo_foundation._record_capability_change();
create trigger project_member_capabilities_ledger
  after insert or delete on projectceo_foundation.project_member_capabilities
  for each row execute function projectceo_foundation._record_capability_change();

-- Проектное членство не-владельца законно только через принятое проектное
-- приглашение с той же ролью.
create function projectceo_foundation._project_membership_has_invitation(
  p_organization_id uuid,
  p_project_id uuid,
  p_user_id uuid,
  p_role text
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from projectceo_foundation.invitations i
    join projectceo_foundation.invitation_events e
      on e.organization_id = i.organization_id
     and e.project_id = i.project_id
     and e.invitation_id = i.invitation_id
     and e.event_type = 'accepted'
    where i.organization_id = p_organization_id
      and i.project_id = p_project_id
      and i.scope_kind = 'project'
      and i.role = p_role
      and e.accepted_user_id = p_user_id
  )
$function$;

-- p_project_id = null — вся база (миграция); иначе один проект (оператор,
-- тест).
create function projectceo_foundation._revoke_legacy_capability_grants(
  p_reason text,
  p_project_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_package_revoked integer;
  v_project_revoked integer;
  v_memberships_deactivated integer;
  v_package_backfilled integer;
begin
  if p_reason is null or char_length(p_reason) not between 1 and 120 then
    raise exception 'CAPABILITY_REVOKE_REASON_REQUIRED';
  end if;
  perform pg_catalog.set_config('projectceo.capability_change_reason', p_reason, true);

  with removed as (
    delete from projectceo_foundation.package_member_capabilities pc
    using projectceo_foundation.package_memberships pm
    where pm.organization_id = pc.organization_id
      and pm.project_id = pc.project_id
      and pm.package_id = pc.package_id
      and pm.user_id = pc.user_id
      and (p_project_id is null or pc.project_id = p_project_id)
      and not exists (
        select 1
        from projectceo_foundation._package_role_capabilities(pm.role) template
        where template.capability = pc.capability
      )
    returning 1
  )
  select count(*) into v_package_revoked from removed;

  with legacy as (
    select pm.organization_id, pm.project_id, pm.user_id
    from projectceo_foundation.project_memberships pm
    where pm.role <> 'owner_lead'
      and pm.status = 'active'
      and (p_project_id is null or pm.project_id = p_project_id)
      and not projectceo_foundation._project_membership_has_invitation(
        pm.organization_id, pm.project_id, pm.user_id, pm.role
      )
  ),
  removed as (
    delete from projectceo_foundation.project_member_capabilities pc
    using legacy
    where legacy.organization_id = pc.organization_id
      and legacy.project_id = pc.project_id
      and legacy.user_id = pc.user_id
    returning 1
  ),
  deactivated as (
    update projectceo_foundation.project_memberships pm
    set status = 'inactive'
    from legacy
    where legacy.organization_id = pm.organization_id
      and legacy.project_id = pm.project_id
      and legacy.user_id = pm.user_id
    returning 1
  )
  select (select count(*) from removed), (select count(*) from deactivated)
    into v_project_revoked, v_memberships_deactivated;

  -- Enrollment до WP-32 заводил пакетное членство без пакетных прав: после
  -- отзыва проектного доступа такой участник остался бы вовсе без доступа.
  -- Решение владельца — шесть минимальных прав, а не ноль: активное пакетное
  -- членство дополняется ровно шаблоном своей роли (запись идёт продуктовым
  -- путём и проходит через template clamp и журнал).
  with backfilled as (
    insert into projectceo_foundation.package_member_capabilities
      (organization_id, project_id, package_id, user_id, capability)
    select pm.organization_id, pm.project_id, pm.package_id, pm.user_id, template.capability
    from projectceo_foundation.package_memberships pm
    cross join lateral projectceo_foundation._package_role_capabilities(pm.role) template
    where pm.status = 'active'
      and (p_project_id is null or pm.project_id = p_project_id)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_package_backfilled from backfilled;

  perform pg_catalog.set_config('projectceo.capability_change_reason', '', true);

  return jsonb_build_object(
    'packageCapabilitiesRevoked', v_package_revoked,
    'projectCapabilitiesRevoked', v_project_revoked,
    'projectMembershipsDeactivated', v_memberships_deactivated,
    'packageTemplateBackfilled', v_package_backfilled
  );
end
$function$;

-- Сверка: пустой результат = права соответствуют шаблонам, журналу и
-- правилу «проектное членство не-владельца только по приглашению».
create function projectceo_foundation.verify_capability_grants()
returns table (
  violation text,
  scope_kind text,
  organization_id uuid,
  project_id uuid,
  package_id uuid,
  user_id uuid,
  capability text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with current_grants as (
    select 'project'::text as scope_kind, pc.organization_id, pc.project_id,
      null::uuid as package_id, pc.user_id, pc.capability
    from projectceo_foundation.project_member_capabilities pc
    union all
    select 'package', pc.organization_id, pc.project_id, pc.package_id,
      pc.user_id, pc.capability
    from projectceo_foundation.package_member_capabilities pc
  ),
  last_event as (
    select distinct on (l.scope_kind, l.organization_id, l.project_id,
        l.package_id, l.user_id, l.capability)
      l.scope_kind, l.organization_id, l.project_id, l.package_id,
      l.user_id, l.capability, l.action
    from projectceo_foundation.capability_grant_ledger l
    where l.action <> 'denied_by_template'
    order by l.scope_kind, l.organization_id, l.project_id, l.package_id,
      l.user_id, l.capability, l.ledger_id desc
  )
  select 'package_capability_outside_template', 'package', pc.organization_id,
    pc.project_id, pc.package_id, pc.user_id, pc.capability
  from projectceo_foundation.package_member_capabilities pc
  join projectceo_foundation.package_memberships pm
    on pm.organization_id = pc.organization_id
   and pm.project_id = pc.project_id
   and pm.package_id = pc.package_id
   and pm.user_id = pc.user_id
  where not exists (
    select 1
    from projectceo_foundation._package_role_capabilities(pm.role) template
    where template.capability = pc.capability
  )
  union all
  select 'current_grant_not_in_ledger', g.scope_kind, g.organization_id,
    g.project_id, g.package_id, g.user_id, g.capability
  from current_grants g
  left join last_event e
    on e.scope_kind = g.scope_kind
   and e.organization_id = g.organization_id
   and e.project_id = g.project_id
   and e.package_id is not distinct from g.package_id
   and e.user_id = g.user_id
   and e.capability = g.capability
  where e.action is null or e.action = 'revoked'
  union all
  select 'ledger_grant_missing_from_state', e.scope_kind, e.organization_id,
    e.project_id, e.package_id, e.user_id, e.capability
  from last_event e
  where e.action in ('baseline', 'granted')
    and not exists (
      select 1 from current_grants g
      where g.scope_kind = e.scope_kind
        and g.organization_id = e.organization_id
        and g.project_id = e.project_id
        and g.package_id is not distinct from e.package_id
        and g.user_id = e.user_id
        and g.capability = e.capability
    )
  union all
  select 'project_member_without_invitation', 'project', pm.organization_id,
    pm.project_id, null::uuid, pm.user_id, null::text
  from projectceo_foundation.project_memberships pm
  where pm.role <> 'owner_lead'
    and pm.status = 'active'
    and not projectceo_foundation._project_membership_has_invitation(
      pm.organization_id, pm.project_id, pm.user_id, pm.role
    )
$function$;

do $ownership$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'projectceo_foundation._capability_change_reason()',
    'projectceo_foundation._clamp_package_capability()',
    'projectceo_foundation._record_capability_change()',
    'projectceo_foundation._project_membership_has_invitation(uuid,uuid,uuid,text)',
    'projectceo_foundation._revoke_legacy_capability_grants(text,uuid)',
    'projectceo_foundation.verify_capability_grants()'
  ] loop
    execute pg_catalog.format('alter function %s owner to pi_table_owner', v_signature);
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role, '
      || 'pi_human_executor, pi_worker_executor',
      v_signature
    );
  end loop;
end
$ownership$;

-- Отзыв унаследованных широких прав и стартовый снимок журнала.
select projectceo_foundation._revoke_legacy_capability_grants('dec040_legacy_revoke');

insert into projectceo_foundation.capability_grant_ledger (
  scope_kind, organization_id, project_id, package_id, user_id,
  capability, action, member_role, reason
)
select 'project', pc.organization_id, pc.project_id, null, pc.user_id,
  pc.capability, 'baseline', pm.role, 'dec040_baseline'
from projectceo_foundation.project_member_capabilities pc
left join projectceo_foundation.project_memberships pm
  on pm.organization_id = pc.organization_id
 and pm.project_id = pc.project_id
 and pm.user_id = pc.user_id
union all
select 'package', pc.organization_id, pc.project_id, pc.package_id, pc.user_id,
  pc.capability, 'baseline', pm.role, 'dec040_baseline'
from projectceo_foundation.package_member_capabilities pc
left join projectceo_foundation.package_memberships pm
  on pm.organization_id = pc.organization_id
 and pm.project_id = pc.project_id
 and pm.package_id = pc.package_id
 and pm.user_id = pc.user_id;

do $postcondition$
begin
  if exists (select 1 from projectceo_foundation.verify_capability_grants()) then
    raise exception 'DEC040_CAPABILITY_GRANTS_NOT_CLEAN';
  end if;
end
$postcondition$;

commit;
