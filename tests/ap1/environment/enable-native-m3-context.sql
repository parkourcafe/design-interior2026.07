\set ON_ERROR_STOP on
-- LOCAL DISPOSABLE ONLY: authenticated metadata read, not publication authority.
-- Caller must verify named AP1 container and loopback endpoints before execution.
begin;
grant usage on schema projectceo_m3_api to authenticated;
grant execute on function projectceo_m3_api.get_native_m3_release_context(uuid,uuid) to authenticated;
commit;
