\set ON_ERROR_STOP on
-- LOCAL DISPOSABLE ONLY. Caller must first verify the named AP1 container and
-- loopback API/database ports. This configures policy/ACL, not business fixtures.
-- :scan_policy_json is measured trusted runtime config; contains NO credentials.
begin;
select remhaos_integration.configure_disposable_file_scan_policy(:'scan_policy_json'::jsonb,true);
grant usage on schema remhaos_integration_api to authenticated,service_role;
grant execute on function
  remhaos_integration_api.request_bound_file_scan(uuid,uuid,text,text),
  remhaos_integration_api.cancel_bound_file_scan(uuid)
  to authenticated;
grant execute on function
  remhaos_integration_api.claim_bound_file_scan(uuid,text,text,text),
  remhaos_integration_api.complete_bound_file_scan(uuid,text,integer,bigint,text,jsonb,text)
  to service_role;
-- Legacy primitive, policy configuration, private tables and R1 stay ungranted.
commit;
