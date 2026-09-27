\set ON_ERROR_STOP on

-- DB4: флаги моста проекта по умолчанию выключены (DEC-044 (c), миграция
-- 20260928110000). Сценарии TG1 (42–47) проверяют приём и уведомления при
-- включённом мосте, поэтому для всех проектов харнесса включаются «мост» и
-- «уведомления» — прямой записью от postgres, как включил бы их человек с
-- manage_project_integrations. «Файлы» не включаются: их проверяет DB4 85.

insert into remhaos_channel.bridge_scope_flags (
  organization_id, project_id, flag, enabled, changed_by_user_id
)
select pw.organization_id, pw.project_id, flag.name, true,
  coalesce((select om.user_id from project_intelligence.organization_members om
            where om.organization_id = pw.organization_id and om.status = 'active'
            order by om.user_id limit 1), '00000000-0000-4000-8000-000000000000')
from project_intelligence.project_workflows pw
cross join (values ('bridge'), ('notifications')) flag(name)
on conflict (organization_id, project_id, flag) do update set enabled = true;

-- Проекты, которые сценарии заводят позже, получают те же флаги при
-- зачислении. Только в базе харнесса: схема pi_test_fixture в продукте не
-- существует.
create schema if not exists pi_test_fixture;
create or replace function pi_test_fixture.enable_bridge_flags_for_new_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into remhaos_channel.bridge_scope_flags (
    organization_id, project_id, flag, enabled, changed_by_user_id
  )
  select new.organization_id, new.project_id, flag.name, true, '00000000-0000-4000-8000-000000000000'
  from (values ('bridge'), ('notifications')) flag(name)
  on conflict (organization_id, project_id, flag) do update set enabled = true;
  return null;
end
$function$;
drop trigger if exists pi_test_fixture_bridge_flags on project_intelligence.project_workflows;
create trigger pi_test_fixture_bridge_flags
  after insert on project_intelligence.project_workflows
  for each row execute function pi_test_fixture.enable_bridge_flags_for_new_project();
