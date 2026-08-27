\set ON_ERROR_STOP on

-- Disposable-only cleanup between repeated AP1 runs. This is not a migration:
-- a successful run intentionally opens V2/V3 until its container is discarded.
-- The cleanup restores the default boundary before the next run and never
-- targets a linked Supabase project.
begin;
revoke execute on function
  projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text),
  projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text),
  projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text),
  projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text),
  projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text),
  projectceo_m4_api.replay_accept_milestone(uuid, uuid, text),
  projectceo_m4_api.define_milestone(uuid, uuid, text, text, jsonb, bigint, text)
from authenticated, anon, service_role;
revoke execute on function
  projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)
from authenticated;
do $cleanup$
begin
  if exists (select 1 from pg_roles where rolname = 'pi_db5_execution_tester') then
    execute 'drop owned by pi_db5_execution_tester';
    execute 'drop role pi_db5_execution_tester';
  end if;
end
$cleanup$;
grant execute on function
  projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)
to service_role;
commit;

select 'AP1_REPEATABLE_SURFACE_RESET_OK' as result;
