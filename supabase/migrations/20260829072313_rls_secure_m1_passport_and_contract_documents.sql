-- Close the two public-schema RLS gaps reported by the hosted Supabase
-- security advisor. Keep the M1 runtime split intact:
--   * passport revisions are written only by the token-authorized server route;
--   * contract documents are operated by the authenticated project owner.

begin;

alter table public.project_passport_revisions enable row level security;
alter table public.contract_documents enable row level security;

-- `project_passport_revisions` has no human Data API surface. The intake route
-- uses the server-only service role for its revision lookup and append. The
-- append-only trigger remains the independent UPDATE/DELETE guard.
revoke all on table public.project_passport_revisions
  from public, anon, authenticated, service_role;
grant select, insert on table public.project_passport_revisions
  to service_role;

-- Contract documents stay request-bound. Revoke hosted default grants first,
-- then expose only the operations used by the owner route. In particular,
-- authenticated callers cannot DELETE rows or rewrite checksum/path metadata.
revoke all on table public.contract_documents
  from public, anon, authenticated, service_role;
grant select, insert on table public.contract_documents to authenticated;
grant update (status) on table public.contract_documents to authenticated;

create policy contract_documents_owner_select
on public.contract_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.projects project
    where project.id = contract_documents.project_id
      and project.designer_id = (select auth.uid())
  )
);

create policy contract_documents_owner_insert
on public.contract_documents
for insert
to authenticated
with check (
  status = 'uploaded'
  and exists (
    select 1
    from public.projects project
    where project.id = contract_documents.project_id
      and project.designer_id = (select auth.uid())
  )
);

create policy contract_documents_owner_update
on public.contract_documents
for update
to authenticated
using (
  exists (
    select 1
    from public.projects project
    where project.id = contract_documents.project_id
      and project.designer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.projects project
    where project.id = contract_documents.project_id
      and project.designer_id = (select auth.uid())
  )
);

commit;
