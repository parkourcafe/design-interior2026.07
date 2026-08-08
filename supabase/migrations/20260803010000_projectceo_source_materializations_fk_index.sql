-- Harden the AP1 inventory bridge: the composite foreign key from
-- source_materializations to source_inventory_records must have a matching
-- leading index for the DB3 security invariant and predictable deletes.

begin;

create index if not exists source_materializations_inventory_idx
  on projectceo_foundation.source_materializations (
    organization_id,
    project_id,
    primary_physical_record_id
  );

commit;
