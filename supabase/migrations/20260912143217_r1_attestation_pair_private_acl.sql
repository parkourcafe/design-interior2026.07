-- R1's pair validator is an internal trigger, never a runtime RPC. The original
-- migration creates it as the migration role, retaining PostgreSQL's default
-- PUBLIC EXECUTE grant. Keep that migration immutable and close this ACL here.
begin;

alter function projectceo_foundation.assert_external_attestation_pair()
  owner to pi_table_owner;

revoke all on function projectceo_foundation.assert_external_attestation_pair()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

-- Ownership and ACL change only: the existing trigger remains SECURITY INVOKER
-- with its empty search_path and validates the same immutable version pair.
commit;
