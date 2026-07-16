\set ON_ERROR_STOP on

-- Deterministic tenant/project fixtures. Project-local text IDs intentionally
-- repeat across projects to prove that every reference is composite-scoped.
begin;
set constraints all deferred;

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'db2-owner@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'db2-outsider@example.invalid');

insert into public.designers (id, name, studio_name)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'DB2 Owner',
    'DB2 Studio A'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'DB2 Outsider',
    'DB2 Studio B'
  );

insert into public.projects (id, designer_id, client_name, intake_token)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'Sequential operations',
    'db2-sequential'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'Concurrent replay',
    'db2-replay'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'Concurrent stale CAS',
    'db2-stale'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'Concurrent publication',
    'db2-publication'
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    'Concurrent impact review',
    'db2-impact-race'
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    'Injected rollback',
    'db2-rollback'
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'Other organization',
    'db2-other-org'
  );

insert into project_intelligence.organizations (
  id,
  cell_code,
  edition,
  legacy_designer_id
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'ru',
    'studio',
    '11111111-1111-4111-8111-111111111111'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'ru',
    'studio',
    '22222222-2222-4222-8222-222222222222'
  );

insert into project_intelligence.organization_members (
  organization_id,
  user_id,
  role,
  status
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'owner',
    'active'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'owner',
    'active'
  );

insert into project_intelligence.member_capabilities (
  organization_id,
  user_id,
  capability
)
select
  principals.organization_id,
  principals.user_id,
  capabilities.capability
from (
  values
    (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid
    ),
    (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid
    )
) as principals(organization_id, user_id)
cross join (
  values
    ('review_claim'),
    ('publish_version'),
    ('revise_decision'),
    ('calculate_change_impact'),
    ('review_change_impact'),
    ('build_logical_handoff')
) as capabilities(capability);

insert into project_intelligence.project_workflows (
  organization_id,
  project_id
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000002'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000003'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000004'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000005'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000006'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '20000000-0000-4000-8000-000000000001'
  );

-- Every fixture gets a stable decision. Projects used for impact also get a
-- downstream deliverable and a reverse-impact edge:
-- deliverable --depends_on--> decision.
insert into project_intelligence.graph_nodes (
  organization_id,
  project_id,
  node_id,
  kind,
  stable_key,
  current_revision_id
)
select
  workflow.organization_id,
  workflow.project_id,
  'decision-main',
  'decision',
  'decision-main',
  'decision-r1'
from project_intelligence.project_workflows workflow;

insert into project_intelligence.graph_nodes (
  organization_id,
  project_id,
  node_id,
  kind,
  stable_key,
  current_revision_id
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  project_id,
  'deliverable-main',
  'deliverable',
  'deliverable-main',
  'deliverable-r1'
from (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000005'::uuid)
) projects(project_id);

insert into project_intelligence.graph_node_revisions (
  organization_id,
  project_id,
  revision_id,
  node_id,
  revision_no,
  title,
  payload,
  origin,
  claim_status,
  content_digest,
  created_by_type,
  created_by_id
)
select
  workflow.organization_id,
  workflow.project_id,
  'decision-r1',
  'decision-main',
  1,
  'Use natural stone for the worktop',
  '{"material":"natural_stone","subject":"worktop"}'::jsonb,
  'human',
  'interpreted',
  extensions.digest(
    convert_to(
      '{"material":"natural_stone","subject":"worktop"}'::jsonb::text,
      'UTF8'
    ),
    'sha256'
  ),
  'human',
  case workflow.organization_id
    when 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      then '11111111-1111-4111-8111-111111111111'
    else '22222222-2222-4222-8222-222222222222'
  end
from project_intelligence.project_workflows workflow;

insert into project_intelligence.graph_node_revisions (
  organization_id,
  project_id,
  revision_id,
  node_id,
  revision_no,
  title,
  payload,
  origin,
  claim_status,
  content_digest,
  created_by_type,
  created_by_id
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  project_id,
  'deliverable-r1',
  'deliverable-main',
  1,
  'Update the finish schedule',
  '{"format":"finish_schedule","subject":"worktop"}'::jsonb,
  'human',
  'interpreted',
  extensions.digest(
    convert_to(
      '{"format":"finish_schedule","subject":"worktop"}'::jsonb::text,
      'UTF8'
    ),
    'sha256'
  ),
  'human',
  '11111111-1111-4111-8111-111111111111'
from (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000005'::uuid)
) projects(project_id);

insert into project_intelligence.graph_edges (
  organization_id,
  project_id,
  edge_id,
  from_node_id,
  to_node_id,
  relation
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  project_id,
  'edge-deliverable-decision',
  'deliverable-main',
  'decision-main',
  'depends_on'
from (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid),
    ('10000000-0000-4000-8000-000000000005'::uuid)
) projects(project_id);

commit;

-- Full six-operation path on the sequential project.
begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.review_claim(
  '10000000-0000-4000-8000-000000000001',
  'decision-r1',
  'decision-r1',
  0,
  'confirmed',
  'sequential-review-v1'
) as response
\gset sequential_review_
commit;

select
  (:'sequential_review_response'::jsonb ->> 'stateRevision')::bigint
    as state_revision
\gset sequential_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.publish_version(
  '10000000-0000-4000-8000-000000000001',
  null,
  :sequential_state_revision,
  'Initial approved baseline',
  '[]'::jsonb,
  'sequential-publish-v1'
) as response
\gset sequential_publish_v1_
commit;

select
  (:'sequential_publish_v1_response'::jsonb ->> 'stateRevision')::bigint
    as state_revision,
  :'sequential_publish_v1_response'::jsonb
    #>> '{result,version,id}' as version_id
\gset sequential_v1_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.revise_decision(
  '10000000-0000-4000-8000-000000000001',
  'decision-main',
  :'sequential_v1_version_id',
  'decision-r1',
  :sequential_v1_state_revision,
  'Use quartz composite for the worktop',
  '{"material":"quartz_composite","subject":"worktop"}'::jsonb,
  'schedule_constraint',
  'Natural stone lead time exceeds the approved schedule.',
  'sequential-revise-r2'
) as response
\gset sequential_revise_
commit;

select
  (:'sequential_revise_response'::jsonb ->> 'stateRevision')::bigint
    as state_revision,
  :'sequential_revise_response'::jsonb
    #>> '{result,changeSet,id}' as change_set_id
\gset sequential_changed_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.publish_version(
  '10000000-0000-4000-8000-000000000001',
  :'sequential_v1_version_id',
  :sequential_changed_state_revision,
  'Approved baseline after material change',
  '[]'::jsonb,
  'sequential-publish-v2'
) as response
\gset sequential_publish_v2_
commit;

select
  (:'sequential_publish_v2_response'::jsonb ->> 'stateRevision')::bigint
    as state_revision
\gset sequential_v2_

begin;
set local role service_role;
select project_intelligence_api.calculate_impact(
  '10000000-0000-4000-8000-000000000001',
  :'sequential_changed_change_set_id',
  :sequential_v2_state_revision,
  'sequential-calculate-impact'
) as response
\gset sequential_impact_
commit;

select
  (:'sequential_impact_response'::jsonb ->> 'stateRevision')::bigint
    as state_revision,
  :'sequential_impact_response'::jsonb
    #>> '{result,id}' as impact_run_id,
  :'sequential_impact_response'::jsonb
    #>> '{result,impacts,0,impactId}' as impact_id
\gset sequential_impact_result_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.review_impact(
  '10000000-0000-4000-8000-000000000001',
  :'sequential_impact_result_impact_run_id',
  :'sequential_impact_result_impact_id',
  'needs_review',
  'accepted',
  'downstream_update_required',
  :sequential_impact_result_state_revision,
  'sequential-review-impact'
) as response
\gset sequential_impact_review_
commit;

select
  (:'sequential_impact_review_response'::jsonb ->> 'stateRevision')::bigint
    as state_revision
\gset sequential_reviewed_

begin;
set local role service_role;
select project_intelligence_api.build_handoff(
  '10000000-0000-4000-8000-000000000001',
  :'sequential_impact_result_impact_run_id',
  :sequential_reviewed_state_revision,
  'sequential-build-handoff'
) as response
\gset sequential_handoff_
commit;

-- Prepare an independent impact in needs_review for the multi-session race.
begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.review_claim(
  '10000000-0000-4000-8000-000000000005',
  'decision-r1',
  'decision-r1',
  0,
  'confirmed',
  'impact-race-review-v1'
) as response
\gset impact_race_review_
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.publish_version(
  '10000000-0000-4000-8000-000000000005',
  null,
  1,
  'Impact race baseline',
  '[]'::jsonb,
  'impact-race-publish-v1'
) as response
\gset impact_race_publish_v1_
commit;

select
  :'impact_race_publish_v1_response'::jsonb
    #>> '{result,version,id}' as version_id
\gset impact_race_v1_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.revise_decision(
  '10000000-0000-4000-8000-000000000005',
  'decision-main',
  :'impact_race_v1_version_id',
  'decision-r1',
  2,
  'Use quartz composite for the worktop',
  '{"material":"quartz_composite","subject":"worktop"}'::jsonb,
  'schedule_constraint',
  'Lead time exceeds the approved schedule.',
  'impact-race-revise-r2'
) as response
\gset impact_race_revise_
commit;

select
  :'impact_race_revise_response'::jsonb
    #>> '{result,changeSet,id}' as change_set_id
\gset impact_race_changed_

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
select project_intelligence_api.publish_version(
  '10000000-0000-4000-8000-000000000005',
  :'impact_race_v1_version_id',
  3,
  'Impact race changed baseline',
  '[]'::jsonb,
  'impact-race-publish-v2'
) as response
\gset impact_race_publish_v2_
commit;

begin;
set local role service_role;
select project_intelligence_api.calculate_impact(
  '10000000-0000-4000-8000-000000000005',
  :'impact_race_changed_change_set_id',
  4,
  'impact-race-calculate'
) as response
\gset impact_race_calculated_
commit;

do $assert$
declare
  v_state bigint;
begin
  select state_revision
    into v_state
  from project_intelligence.project_workflows
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and project_id = '10000000-0000-4000-8000-000000000001';

  if v_state <> 7 then
    raise exception 'DB2_SEQUENTIAL_STATE:%', v_state;
  end if;

  if (select count(*) from project_intelligence.project_versions
      where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        and project_id = '10000000-0000-4000-8000-000000000001') <> 2
     or (select count(*) from project_intelligence.change_set_publications
         where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           and project_id = '10000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from project_intelligence.impact_runs
         where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           and project_id = '10000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from project_intelligence.impact_reviews
         where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           and project_id = '10000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from project_intelligence.logical_handoffs
         where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           and project_id = '10000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from project_intelligence.command_records
         where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           and project_id = '10000000-0000-4000-8000-000000000001') <> 7
     or (select count(*) from project_intelligence.audit_events
         where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
           and project_id = '10000000-0000-4000-8000-000000000001') <> 7
  then
    raise exception 'DB2_SEQUENTIAL_PERSISTENCE_COUNTS';
  end if;

  if not exists (
    select 1
    from project_intelligence.project_workflows
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000005'
      and state_revision = 5
  ) or (
    select count(*)
    from project_intelligence.impacts
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000005'
  ) <> 1 or exists (
    select 1
    from project_intelligence.impact_reviews
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000005'
  ) then
    raise exception 'DB2_IMPACT_RACE_FIXTURE';
  end if;
end
$assert$;

select 'DB2_SEED_AND_SEQUENTIAL_OPERATIONS_OK' as result;
