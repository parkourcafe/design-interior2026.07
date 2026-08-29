-- Close the two public-schema RLS gaps reported by the hosted Supabase
-- security advisor without adding a privileged application path.
--
-- `project_passport_revisions` is an internal append-only registry. The
-- application updates the legacy `projects.passport` read model; a protected
-- trigger appends the immutable revision atomically. No Data API role,
-- including service_role, receives direct table privileges.
--
-- `contract_documents` remains the request-bound owner/designer route that is
-- already implemented in app/api/dashboard/contracts/route.ts. Only the
-- project's exact designer_id may read, insert an initial uploaded document,
-- or advance its status. Studio members, ProjectCEO builder/client members,
-- other tenants and unauthenticated callers receive no row access.

begin;

-- === Immutable passport registry ===========================================

alter table public.projects
  add column passport_revision_llm_ok boolean;

alter table public.projects
  add constraint projects_passport_revision_llm_ok_transient_check
  check (passport_revision_llm_ok is null);

alter table public.project_passport_revisions enable row level security;
alter table public.project_passport_revisions force row level security;
revoke all on table public.project_passport_revisions
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter table public.project_passport_revisions owner to pi_table_owner;

create policy project_passport_revisions_internal_owner
on public.project_passport_revisions
for all
to pi_table_owner
using (true)
with check (true);

create function projectceo_foundation.append_legacy_passport_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_requested boolean := new.passport_revision_llm_ok is not null;
  v_llm_ok boolean := coalesce(new.passport_revision_llm_ok, false);
  v_revision_no bigint;
begin
  -- The transport value is never persisted in the public projects read model.
  new.passport_revision_llm_ok := null;

  if new.passport is null
     or (not v_requested and new.passport is not distinct from old.passport) then
    return new;
  end if;

  -- Serialize revision allocation per legacy project. This also removes the
  -- SELECT max()+1 race that previously lived in the server route.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.id::text, 0)
  );

  select coalesce(max(revision.revision_no), 0) + 1
  into v_revision_no
  from public.project_passport_revisions revision
  where revision.project_id = new.id;

  insert into public.project_passport_revisions (
    project_id,
    revision_no,
    passport,
    llm_ok
  ) values (
    new.id,
    v_revision_no,
    new.passport,
    v_llm_ok
  );

  return new;
end
$function$;

alter function projectceo_foundation.append_legacy_passport_revision()
  owner to pi_table_owner;
revoke all on function projectceo_foundation.append_legacy_passport_revision()
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

create trigger projects_append_passport_revision
  before update of passport, passport_revision_llm_ok on public.projects
  for each row
  execute function projectceo_foundation.append_legacy_passport_revision();

-- === Request-bound contract documents ======================================

alter table public.contract_documents enable row level security;
alter table public.contract_documents force row level security;
revoke all on table public.contract_documents
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant select on table public.contract_documents to authenticated;
grant insert (
  project_id,
  storage_path,
  original_name,
  sha256,
  size_bytes,
  status
) on public.contract_documents to authenticated;
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
