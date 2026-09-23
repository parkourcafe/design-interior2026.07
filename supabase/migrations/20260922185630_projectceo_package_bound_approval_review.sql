begin;

-- Resolve the approval's package internally. The existing transition remains
-- responsible for locking, exact status/revision, replay, audit and self-review.
create or replace function projectceo_product_api.review_approval_package(
  project_id uuid,
  approval_package_id text,
  expected_status text,
  decision text,
  reason text,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_organization_id uuid;
  v_package_id uuid;
begin
  if project_intelligence._request_user_id() is null then
    perform projectceo_product._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;
  perform projectceo_product._assert_text(approval_package_id, 'approvalPackageId', 160);
  select approval.organization_id, approval.package_id
    into v_organization_id, v_package_id
  from projectceo_product.approval_packages approval
  where approval.project_id = project_id
    and approval.approval_package_id = approval_package_id;
  if not found then
    perform projectceo_product._raise('P1103', 'forbidden', '{}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id, v_package_id, 'review_selection'
  );
  if v_context.organization_id is distinct from v_organization_id then
    perform projectceo_product._raise('P1103', 'forbidden', '{}'::jsonb);
  end if;
  return projectceo_product._transition_approval_package(
    v_context.organization_id, v_context.actor_user_id, v_context.actor_id,
    'review_approval_package', project_id, approval_package_id, expected_status,
    decision, reason, expected_state_revision, idempotency_key
  );
end
$function$;

alter function projectceo_product_api.review_approval_package(uuid,text,text,text,text,bigint,text)
  owner to pi_table_owner;
-- CREATE OR REPLACE preserves the existing endpoint ACL and module state.
commit;
