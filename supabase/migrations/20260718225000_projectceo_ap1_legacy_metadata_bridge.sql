-- AP1: permit the trusted NOLOGIN table owner to project legacy public project
-- metadata for authenticated ProjectCEO project/package members.  The public
-- runtime still receives data only through the request-bound read function.

begin;

create policy projects_projectceo_membership_metadata_select
on public.projects
for select
to pi_table_owner
using (
  exists (
    select 1
    from projectceo_foundation.project_memberships membership
    where membership.project_id = projects.id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
  or exists (
    select 1
    from projectceo_foundation.package_memberships membership
    where membership.project_id = projects.id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

commit;
