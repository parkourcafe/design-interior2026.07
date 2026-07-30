-- AP1: allow multiple physical inventory records to resolve to one immutable
-- materialized source revision while retaining exact M4 referential integrity.

begin;

create table projectceo_foundation.source_materializations (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  logical_source_id text not null
    check (
      char_length(btrim(logical_source_id)) between 1 and 160
      and logical_source_id = btrim(logical_source_id)
    ),
  source_revision_id text not null
    check (
      char_length(btrim(source_revision_id)) between 1 and 160
      and source_revision_id = btrim(source_revision_id)
    ),
  checksum bytea not null check (octet_length(checksum) = 32),
  primary_physical_record_id uuid not null,
  registered_at timestamptz not null default statement_timestamp(),
  primary key (
    organization_id,
    project_id,
    package_id,
    logical_source_id,
    source_revision_id,
    checksum
  ),
  constraint source_materializations_inventory_fkey
    foreign key (
      organization_id,
      project_id,
      primary_physical_record_id
    )
    references projectceo_foundation.source_inventory_records (
      organization_id,
      project_id,
      physical_record_id
    )
    on delete restrict,
  constraint source_materializations_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict
);

insert into projectceo_foundation.source_materializations (
  organization_id,
  project_id,
  package_id,
  logical_source_id,
  source_revision_id,
  checksum,
  primary_physical_record_id,
  registered_at
)
select distinct on (
  inventory.organization_id,
  inventory.project_id,
  inventory.package_id,
  inventory.logical_source_id,
  inventory.source_revision_id,
  inventory.checksum
)
  inventory.organization_id,
  inventory.project_id,
  inventory.package_id,
  inventory.logical_source_id,
  inventory.source_revision_id,
  inventory.checksum,
  inventory.physical_record_id,
  inventory.registered_at
from projectceo_foundation.source_inventory_records inventory
where inventory.availability = 'materialized'
order by
  inventory.organization_id,
  inventory.project_id,
  inventory.package_id,
  inventory.logical_source_id,
  inventory.source_revision_id,
  inventory.checksum,
  inventory.physical_record_id;

create function projectceo_foundation.capture_source_materialization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.availability = 'materialized' then
    insert into projectceo_foundation.source_materializations (
      organization_id,
      project_id,
      package_id,
      logical_source_id,
      source_revision_id,
      checksum,
      primary_physical_record_id,
      registered_at
    )
    values (
      new.organization_id,
      new.project_id,
      new.package_id,
      new.logical_source_id,
      new.source_revision_id,
      new.checksum,
      new.physical_record_id,
      new.registered_at
    )
    on conflict (
      organization_id,
      project_id,
      package_id,
      logical_source_id,
      source_revision_id,
      checksum
    ) do nothing;
  end if;
  return new;
end
$function$;

alter function projectceo_foundation.capture_source_materialization()
  owner to pi_table_owner;
revoke all on function
  projectceo_foundation.capture_source_materialization()
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

create trigger source_inventory_capture_materialization
after insert on projectceo_foundation.source_inventory_records
for each row execute function
  projectceo_foundation.capture_source_materialization();

alter table projectceo_m4.photo_evidence
  drop constraint m4_photo_inventory_fkey;
alter table projectceo_m4.handover_documents
  drop constraint m4_handover_docs_inventory_fkey;
alter table projectceo_foundation.source_inventory_records
  drop constraint source_inventory_exact_materialized_key;

alter table projectceo_m4.photo_evidence
  add constraint m4_photo_inventory_fkey
  foreign key (
    organization_id,
    project_id,
    package_id,
    source_id,
    source_revision_id,
    source_checksum
  )
  references projectceo_foundation.source_materializations (
    organization_id,
    project_id,
    package_id,
    logical_source_id,
    source_revision_id,
    checksum
  )
  on delete restrict;

alter table projectceo_m4.handover_documents
  add constraint m4_handover_docs_inventory_fkey
  foreign key (
    organization_id,
    project_id,
    package_id,
    source_id,
    source_revision_id,
    source_checksum
  )
  references projectceo_foundation.source_materializations (
    organization_id,
    project_id,
    package_id,
    logical_source_id,
    source_revision_id,
    checksum
  )
  on delete restrict;

create trigger source_materializations_append_only
before update or delete on projectceo_foundation.source_materializations
for each row execute function
  projectceo_foundation.reject_append_only_mutation();

alter table projectceo_foundation.source_materializations
  owner to pi_table_owner;
alter table projectceo_foundation.source_materializations
  enable row level security;
alter table projectceo_foundation.source_materializations
  force row level security;
revoke all on table projectceo_foundation.source_materializations
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy source_materializations_internal_owner
  on projectceo_foundation.source_materializations
  for all to pi_table_owner using (true) with check (true);

commit;
