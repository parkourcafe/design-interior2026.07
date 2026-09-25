-- Correct default PUBLIC execution on the two Aldo trigger helpers.
-- Existing migrations and append-only triggers remain unchanged.
begin;
alter function projectceo_product.reject_m2_client_review_comment_mutation() owner to pi_table_owner;
revoke all on function projectceo_product.reject_m2_client_review_comment_mutation()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
alter function projectceo_platform.reject_project_stage_revision_mutation() owner to pi_table_owner;
revoke all on function projectceo_platform.reject_project_stage_revision_mutation()
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
commit;
