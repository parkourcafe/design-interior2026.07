begin;
set local search_path = pg_catalog, projectceo_foundation, extensions;

-- Preserve the command-record identity contract in the append-only asset audit.
-- Validate existing rows; never rewrite attribution to make the constraint pass.
alter table projectceo_foundation.external_asset_events
  add constraint external_asset_events_actor_identity_check
    check (
      (
        actor_type = 'human'
        and actor_user_id is not null
        and actor_id = actor_user_id::text
      )
      or (
        actor_type = 'system'
        and actor_user_id is null
        and actor_id like 'system:%'
      )
    );

commit;
