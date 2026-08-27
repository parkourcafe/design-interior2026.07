\set ON_ERROR_STOP on

-- Add one pure package-scoped builder.  This is test-only setup; production
-- enrollment remains invitation-driven and is exercised by the AP1 E2E gate.
insert into auth.users (id, email, email_confirmed_at) values
  (
    '34444444-4444-4444-8444-444444444444',
    'package-builder@example.test',
    statement_timestamp()
  ),
  (
    '35555555-5555-4555-8555-555555555555',
    'package-client@example.test',
    statement_timestamp()
  );

insert into project_intelligence.organization_members (
  organization_id,
  user_id,
  role
)
select
  workflow.organization_id,
  '34444444-4444-4444-8444-444444444444',
  'member'
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into project_intelligence.organization_members (
  organization_id,
  user_id,
  role
)
select
  workflow.organization_id,
  '35555555-5555-4555-8555-555555555555',
  'member'
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.package_memberships (
  organization_id,
  project_id,
  package_id,
  user_id,
  role
)
select
  workflow.organization_id,
  workflow.project_id,
  workflow.project_id,
  '34444444-4444-4444-8444-444444444444',
  'builder'
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.package_memberships (
  organization_id,
  project_id,
  package_id,
  user_id,
  role
)
select
  workflow.organization_id,
  workflow.project_id,
  workflow.project_id,
  '35555555-5555-4555-8555-555555555555',
  'client_approver'
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.package_member_capabilities (
  organization_id,
  project_id,
  package_id,
  user_id,
  capability
)
select
  workflow.organization_id,
  workflow.project_id,
  workflow.project_id,
  '34444444-4444-4444-8444-444444444444',
  capability.capability
from project_intelligence.project_workflows workflow
cross join projectceo_foundation._package_role_capabilities('builder') capability
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.package_member_capabilities (
  organization_id,
  project_id,
  package_id,
  user_id,
  capability
)
select
  workflow.organization_id,
  workflow.project_id,
  workflow.project_id,
  '35555555-5555-4555-8555-555555555555',
  capability.capability
from project_intelligence.project_workflows workflow
cross join projectceo_foundation._package_role_capabilities(
  'client_approver'
) capability
where workflow.project_id = '41111111-1111-4111-8111-111111111111';

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset ap1_distribution_first_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.distribute_release_request_bound(
  '41111111-1111-4111-8111-111111111111',
  'release-db4-root-v1',
  '34444444-4444-4444-8444-444444444444',
  :'ap1_distribution_first_state_revision'::bigint,
  'ap1-read-pending-builder-distribution'
) as envelope
\gset ap1_distribution_first_
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset ap1_distribution_retry_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.distribute_release_request_bound(
  '41111111-1111-4111-8111-111111111111',
  'release-db4-root-v1',
  '34444444-4444-4444-8444-444444444444',
  :'ap1_distribution_retry_state_revision'::bigint,
  'ap1-read-pending-builder-distribution'
) as envelope
\gset ap1_distribution_retry_
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset ap1_distribution_after_

select
  set_config(
    'projectceo.ap1_dist_first_envelope',
    :'ap1_distribution_first_envelope',
    false
  ),
  set_config(
    'projectceo.ap1_dist_retry_envelope',
    :'ap1_distribution_retry_envelope',
    false
  ),
  set_config(
    'projectceo.ap1_dist_retry_state',
    :'ap1_distribution_retry_state_revision',
    false
  ),
  set_config(
    'projectceo.ap1_dist_after_state',
    :'ap1_distribution_after_state_revision',
    false
  );

do $ap1_distribution_exact_retry$
begin
  if coalesce((current_setting(
       'projectceo.ap1_dist_first_envelope'
     )::jsonb ->> 'replay')::boolean, true)
     or coalesce((current_setting(
       'projectceo.ap1_dist_retry_envelope'
     )::jsonb ->> 'replay')::boolean, false) is not true
     or current_setting(
       'projectceo.ap1_dist_first_envelope'
     )::jsonb #>> '{result,distributionId}' <>
       current_setting(
         'projectceo.ap1_dist_retry_envelope'
       )::jsonb #>> '{result,distributionId}'
     or current_setting('projectceo.ap1_dist_after_state')::bigint <>
       current_setting('projectceo.ap1_dist_retry_state')::bigint
  then
    raise exception 'AP1_DISTRIBUTION_EXACT_RETRY_FAILED';
  end if;
end
$ap1_distribution_exact_retry$;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $ap1_distribution_key_conflict$
begin
  begin
    perform projectceo_product_api.distribute_release_request_bound(
      '41111111-1111-4111-8111-111111111111',
      'release-db4-root-v1',
      '32222222-2222-4222-8222-222222222222',
      current_setting('projectceo.ap1_dist_after_state')::bigint,
      'ap1-read-pending-builder-distribution'
    );
    raise exception 'AP1_DISTRIBUTION_CHANGED_RECIPIENT_REUSED_KEY';
  exception when sqlstate 'P1108' then null;
  end;
end
$ap1_distribution_key_conflict$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '32222222-2222-4222-8222-222222222222';
do $ap1_distribution_wrong_actor_before_replay$
begin
  begin
    perform projectceo_product_api.distribute_release_request_bound(
      '41111111-1111-4111-8111-111111111111',
      'release-db4-root-v1',
      '34444444-4444-4444-8444-444444444444',
      current_setting('projectceo.ap1_dist_after_state')::bigint,
      'ap1-read-pending-builder-distribution'
    );
    raise exception 'AP1_DISTRIBUTION_WRONG_ACTOR_REPLAYED';
  exception when sqlstate 'P1103' then null;
  end;
end
$ap1_distribution_wrong_actor_before_replay$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
select projectceo_product_api.distribute_release_request_bound(
  '41111111-1111-4111-8111-111111111111',
  'release-db4-root-v1',
  '35555555-5555-4555-8555-555555555555',
  :'ap1_distribution_after_state_revision'::bigint,
  'ap1-read-client-distribution'
);
commit;

select
  workflow.state_revision,
  distribution.distribution_id,
  'sha256:' || encode(distribution.artifact_semantic_digest, 'hex')
    as semantic_hash
from project_intelligence.project_workflows workflow
join projectceo_product.release_distributions distribution
  on distribution.organization_id = workflow.organization_id
 and distribution.project_id = workflow.project_id
 and distribution.recipient_user_id =
   '35555555-5555-4555-8555-555555555555'
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset ap1_ack_first_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '35555555-5555-4555-8555-555555555555';
select projectceo_product_api.acknowledge_release_request_bound(
  '41111111-1111-4111-8111-111111111111',
  :'ap1_ack_first_distribution_id'::uuid,
  :'ap1_ack_first_semantic_hash',
  :'ap1_ack_first_state_revision'::bigint,
  'ap1-read-client-acknowledgement'
) as envelope
\gset ap1_ack_first_
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset ap1_ack_retry_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '35555555-5555-4555-8555-555555555555';
select projectceo_product_api.acknowledge_release_request_bound(
  '41111111-1111-4111-8111-111111111111',
  :'ap1_ack_first_distribution_id'::uuid,
  :'ap1_ack_first_semantic_hash',
  :'ap1_ack_retry_state_revision'::bigint,
  'ap1-read-client-acknowledgement'
) as envelope
\gset ap1_ack_retry_
commit;

select state_revision
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset ap1_ack_after_

select
  set_config(
    'projectceo.ap1_ack_first_envelope',
    :'ap1_ack_first_envelope',
    false
  ),
  set_config(
    'projectceo.ap1_ack_retry_envelope',
    :'ap1_ack_retry_envelope',
    false
  ),
  set_config(
    'projectceo.ap1_ack_retry_state',
    :'ap1_ack_retry_state_revision',
    false
  ),
  set_config(
    'projectceo.ap1_ack_after_state',
    :'ap1_ack_after_state_revision',
    false
  ),
  set_config(
    'projectceo.ap1_ack_distribution_id',
    :'ap1_ack_first_distribution_id',
    false
  ),
  set_config(
    'projectceo.ap1_ack_semantic_hash',
    :'ap1_ack_first_semantic_hash',
    false
  );

do $ap1_ack_exact_retry$
begin
  if coalesce((current_setting(
       'projectceo.ap1_ack_first_envelope'
     )::jsonb ->> 'replay')::boolean, true)
     or coalesce((current_setting(
       'projectceo.ap1_ack_retry_envelope'
     )::jsonb ->> 'replay')::boolean, false) is not true
     or current_setting(
       'projectceo.ap1_ack_first_envelope'
     )::jsonb #>> '{result,acknowledgementId}' <>
       current_setting(
         'projectceo.ap1_ack_retry_envelope'
       )::jsonb #>> '{result,acknowledgementId}'
     or current_setting('projectceo.ap1_ack_after_state')::bigint <>
       current_setting('projectceo.ap1_ack_retry_state')::bigint
  then
    raise exception 'AP1_ACK_EXACT_RETRY_FAILED';
  end if;
end
$ap1_ack_exact_retry$;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '35555555-5555-4555-8555-555555555555';
do $ap1_ack_key_conflict$
begin
  begin
    perform projectceo_product_api.acknowledge_release_request_bound(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.ap1_ack_distribution_id')::uuid,
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      current_setting('projectceo.ap1_ack_after_state')::bigint,
      'ap1-read-client-acknowledgement'
    );
    raise exception 'AP1_ACK_CHANGED_HASH_REUSED_KEY';
  exception when sqlstate 'P1108' then null;
  end;
end
$ap1_ack_key_conflict$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $ap1_ack_wrong_actor_before_replay$
begin
  begin
    perform projectceo_product_api.acknowledge_release_request_bound(
      '41111111-1111-4111-8111-111111111111',
      current_setting('projectceo.ap1_ack_distribution_id')::uuid,
      current_setting('projectceo.ap1_ack_semantic_hash'),
      current_setting('projectceo.ap1_ack_after_state')::bigint,
      'ap1-read-client-acknowledgement'
    );
    raise exception 'AP1_ACK_WRONG_ACTOR_REPLAYED';
  exception when sqlstate 'P1103' then null;
  end;
end
$ap1_ack_wrong_actor_before_replay$;
rollback;

do $ap1_read_unauthenticated$
begin
  begin
    perform projectceo_read_api.get_project_workspace_read(
      '41111111-1111-4111-8111-111111111111',
      null
    );
    raise exception 'AP1_READ_UNAUTHENTICATED_ALLOWED';
  exception when sqlstate 'P1101' then null;
  end;
end
$ap1_read_unauthenticated$;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $ap1_owner_read$
declare
  v_read jsonb;
  v_legacy jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read(
    '41111111-1111-4111-8111-111111111111',
    null
  );
  if v_read ->> 'contractVersion' <>
       'project-ceo-authenticated-read/0.1'
     or v_read #>> '{scope,accessScope}' <> 'project'
     or v_read #>> '{scope,actorUserId}' <>
       '31111111-1111-4111-8111-111111111111'
     or jsonb_array_length(v_read #> '{data,packages}') <> 2
     or jsonb_array_length(v_read #> '{data,sources}') < 1
     or (v_read #>> '{data,sourceStats,physicalRecords}')::bigint < 1
     or jsonb_array_length(v_read #> '{data,decisions}') <> 1
     or jsonb_array_length(v_read #> '{data,selections}') <> 1
     or jsonb_array_length(v_read #> '{data,approvalPackages}') < 1
     or jsonb_array_length(v_read #> '{data,packageVersions}') < 2
     or jsonb_array_length(v_read #> '{data,releaseArtifacts}') < 1
     or jsonb_array_length(v_read #> '{data,recipientDistributions}') <> 0
     or jsonb_array_length(v_read #> '{data,releaseRecipients}') < 3
     or jsonb_array_length(v_read #> '{data,executionPackages}') <> 2
  then
    raise exception 'AP1_OWNER_READ_SHAPE:%', v_read;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_read #> '{data,distributionSummary}') summary
    where summary ->> 'productionPackageVersionId' = 'package-db4-root-v1'
      and (summary ->> 'recipientCount')::bigint = 3
      and (summary ->> 'acknowledgementCount')::bigint = 2
  ) then
    raise exception 'AP1_DISTRIBUTION_AGGREGATE_INVALID';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_read #> '{data,executionPackages}') execution
    where execution #>> '{scope,packageId}' =
        '41111111-1111-4111-8111-111111111111'
      and jsonb_array_length(execution #> '{data,changeRequests}') >= 1
      and jsonb_array_length(execution #> '{data,impactRuns}') >= 1
      and jsonb_array_length(execution #> '{data,milestones}') >= 1
      and jsonb_array_length(execution #> '{data,handoverDocuments}') >= 1
      and jsonb_array_length(execution #> '{data,constructionHandovers}') >= 1
  ) then
    raise exception 'AP1_M4_READ_MISSING';
  end if;

  v_legacy := projectceo_api.get_project_delivery(
    '41111111-1111-4111-8111-111111111111',
    null
  );
  if jsonb_array_length(v_legacy #> '{data,distributions}') <> 0 then
    raise exception 'AP1_LEGACY_OWNER_DISTRIBUTION_ID_LEAK';
  end if;
end
$ap1_owner_read$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '32222222-2222-4222-8222-222222222222';
do $ap1_architect_read$
declare
  v_read jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read(
    '41111111-1111-4111-8111-111111111111',
    null
  );
  if jsonb_array_length(v_read #> '{data,recipientDistributions}') <> 1
     or v_read #>> '{data,recipientDistributions,0,acknowledged}' <> 'true'
     or jsonb_array_length(v_read #> '{data,releaseRecipients}') < 3
     or v_read #>> '{data,projectMetadata,name}' <> 'Foundation A'
  then
    raise exception 'AP1_ARCHITECT_RECIPIENT_READ_INVALID:%', v_read;
  end if;
end
$ap1_architect_read$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '34444444-4444-4444-8444-444444444444';
do $ap1_package_builder_read$
declare
  v_read jsonb;
  v_distribution jsonb;
  v_legacy jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111'
  );
  v_distribution := v_read #> '{data,recipientDistributions,0}';
  if v_read #>> '{scope,accessScope}' <> 'package'
     or v_read #>> '{scope,packageId}' <>
       '41111111-1111-4111-8111-111111111111'
     or jsonb_array_length(v_read #> '{data,packages}') <> 1
     or jsonb_array_length(v_read #> '{data,releaseRecipients}') <> 0
     or jsonb_array_length(v_read #> '{data,recipientDistributions}') <> 1
     or v_distribution ->> 'acknowledged' <> 'false'
     or v_distribution ->> 'distributionId' is null
     or v_distribution ->> 'semanticHash' !~ '^sha256:[0-9a-f]{64}$'
     or jsonb_array_length(v_read #> '{data,executionPackages}') <> 1
     or v_read #>> '{data,projectMetadata,name}' <> 'Foundation A'
  then
    raise exception 'AP1_PACKAGE_BUILDER_READ_INVALID:%', v_read;
  end if;

  v_legacy := projectceo_api.get_project_delivery(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_legacy #> '{data,distributions}') <> 1
     or v_legacy #>> '{data,distributions,0,distributionId}' <>
       v_distribution ->> 'distributionId'
  then
    raise exception 'AP1_LEGACY_RECIPIENT_BRIDGE_INVALID';
  end if;

  begin
    perform projectceo_read_api.get_project_workspace_read(
      '41111111-1111-4111-8111-111111111111',
      null
    );
    raise exception 'AP1_PACKAGE_MEMBER_PROJECT_SCOPE_ALLOWED';
  exception when sqlstate 'P1103' then null;
  end;

  begin
    perform projectceo_read_api.get_project_workspace_read(
      '41111111-1111-4111-8111-111111111111',
      '49999999-9999-4999-8999-999999999999'
    );
    raise exception 'AP1_PACKAGE_MEMBER_SIBLING_SCOPE_ALLOWED';
  exception when sqlstate 'P1103' then null;
  end;
end
$ap1_package_builder_read$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '35555555-5555-4555-8555-555555555555';
do $ap1_package_client_read$
declare
  v_read jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111'
  );
  if v_read #>> '{scope,accessScope}' <> 'package'
     or jsonb_array_length(v_read #> '{data,packages}') <> 1
     or jsonb_array_length(v_read #> '{data,packageVersions}') <> 1
     or jsonb_array_length(v_read #> '{data,releaseArtifacts}') <> 1
     or jsonb_array_length(v_read #> '{data,recipientDistributions}') <> 1
     or jsonb_array_length(v_read #> '{data,releaseRecipients}') <> 0
     or jsonb_array_length(v_read #> '{data,sources}') <> 0
     or jsonb_array_length(v_read #> '{data,executionPackages}') <> 0
     or (v_read #>> '{data,sourceStats,physicalRecords}')::bigint <> 0
     or (v_read #>> '{data,sourceStats,uniqueBlobs}')::bigint <> 0
     or jsonb_array_length(v_read #> '{data,decisions}') <> 1
     or jsonb_array_length(v_read #> '{data,selections}') <> 1
     or v_read #>> '{data,selections,0,priceObservation}' is not null
     or jsonb_array_length(v_read #> '{data,selections,0,evidence}') <> 0
     or jsonb_array_length(v_read #> '{data,decisions,0,evidence}') <> 0
     or v_read #> '{data,packageVersions,0}' ? 'exactRevisionRefs'
  then
    raise exception 'AP1_PACKAGE_CLIENT_READ_INVALID:%', v_read;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_read #> '{data,distributionSummary}') summary
    where (summary ->> 'recipientCount')::bigint = 1
      and (summary ->> 'acknowledgementCount')::bigint = 1
  ) then
    raise exception 'AP1_PACKAGE_CLIENT_DISTRIBUTION_AGGREGATE_INVALID';
  end if;
end
$ap1_package_client_read$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '33333333-3333-4333-8333-333333333333';
do $ap1_cross_tenant_denied$
begin
  begin
    perform projectceo_read_api.get_project_workspace_read(
      '41111111-1111-4111-8111-111111111111',
      null
    );
    raise exception 'AP1_CROSS_TENANT_READ_ALLOWED';
  exception when sqlstate 'P1103' then null;
  end;
end
$ap1_cross_tenant_denied$;
rollback;

select 'AP1_AUTHENTICATED_READ_OK' as result;
