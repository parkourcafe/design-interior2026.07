\set ON_ERROR_STOP on

-- Cycle 6 DB boundary: all writes go through authenticated human RPCs. The
-- existing owner submits; a package-only client_approver reviews; only then may
-- an architect/owner derive M3 from the exact approved immutable M2 lineage.

insert into projectceo_foundation.package_memberships (
  organization_id, project_id, package_id, user_id, role, status
)
select workflow.organization_id, workflow.project_id, workflow.project_id,
  '32222222-2222-4222-8222-222222222222', 'client_approver', 'active'
from project_intelligence.project_workflows workflow
where workflow.project_id='41111111-1111-4111-8111-111111111111'
on conflict (organization_id,project_id,package_id,user_id)
do update set role='client_approver',status='active';

insert into projectceo_foundation.package_member_capabilities (
  organization_id,project_id,package_id,user_id,capability
)
select workflow.organization_id,workflow.project_id,workflow.project_id,
  '32222222-2222-4222-8222-222222222222','review_selection'
from project_intelligence.project_workflows workflow
where workflow.project_id='41111111-1111-4111-8111-111111111111'
on conflict do nothing;

-- Build three independently published layout ledger revisions through the
-- authenticated API. The submission must match all identities and hashes.
select set_config(
  'db4.cycle6_layout_payloads',
  (
    with base as (
      select payload->'layoutContent' as content
      from projectceo_product.m2_workspace_revisions
      where project_id='41111111-1111-4111-8111-111111111111'
        and entity_kind='layout_version'
      order by created_at
      limit 1
    ), variants(role_name) as (
      values ('preferred'),('value_engineered'),('premium')
    ), contents as (
      select role_name,
        jsonb_set(
          jsonb_set(
            jsonb_set(content,'{documentId}',to_jsonb('cycle6-layout-'||role_name)),
            '{variant,id}',to_jsonb('cycle6-variant-'||role_name)
          ),
          '{variant,status}','"published"'::jsonb
        ) as content
      from base cross join variants
    )
    select jsonb_object_agg(role_name,jsonb_build_object(
      'versionId','cycle6-layout-'||role_name||'@1',
      'roomId','cycle6-living-room',
      'variantId','cycle6-variant-'||role_name,
      'role',role_name,
      'semanticHash',projectceo_product._m2_layout_semantic_hash(content),
      'schemaVersion','project-ceo-m2-layout/0.1',
      'layoutContent',content
    ))::text
    from contents
  ),
  false
);
select set_config(
  'db4.cycle6_state_revision',
  (select state_revision::text from project_intelligence.project_workflows
   where project_id='41111111-1111-4111-8111-111111111111'),
  false
);

begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $publish_cycle6_layouts$
declare
  v_role text; v_index integer := 0; v_payload jsonb;
  v_state bigint := current_setting('db4.cycle6_state_revision')::bigint;
  v_revision uuid; v_result jsonb;
begin
  foreach v_role in array array['preferred','value_engineered','premium'] loop
    v_index := v_index + 1;
    v_revision := ('74000000-0000-4000-8000-'||lpad(v_index::text,12,'0'))::uuid;
    v_payload := current_setting('db4.cycle6_layout_payloads')::jsonb->v_role;
    v_result := projectceo_product_api.append_m2_workspace_revision(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'layout_version','cycle6-layout-'||v_role,v_revision::text,null,'published',v_payload,
      'Cycle 6 authoritative layout '||v_role,v_state,'cycle6-layout-'||v_role
    );
    v_state := (v_result->>'stateRevision')::bigint;
  end loop;
end
$publish_cycle6_layouts$;
commit;

select state_revision as state_revision,
  (
    select jsonb_agg(jsonb_build_object(
      'variantId',r.payload->>'variantId','role',r.payload->>'role',
      'layoutDocumentId',r.entity_id,'layoutVersionId',r.payload->>'versionId',
      'layoutRevisionId',r.revision_id,'semanticHash',r.payload->>'semanticHash',
      'selectionRevisionIds',jsonb_build_array('revision-selection-db4-r1'),
      'budget',jsonb_build_object('amountRub',125000,
        'staleSelectionRevisionIds','[]'::jsonb,
        'missingPriceSelectionRevisionIds','[]'::jsonb)
    ) order by case r.payload->>'role' when 'preferred' then 1 when 'value_engineered' then 2 else 3 end)
    from projectceo_product.m2_workspace_revisions r
    where r.project_id='41111111-1111-4111-8111-111111111111'
      and r.entity_kind='layout_version' and r.entity_id like 'cycle6-layout-%'
  ) as variants
from project_intelligence.project_workflows
where project_id='41111111-1111-4111-8111-111111111111'
\gset cycle6_

select set_config('db4.cycle6_variants', :'cycle6_variants', false);
select set_config('db4.cycle6_state_revision', :'cycle6_state_revision', false);
begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $cycle6_authoritative_submission_negatives$
declare v_case text; v_variants jsonb; v_approval text; v_design_intent text;
begin
  foreach v_case in array array['nonexistent_selection','forged_amount','unknown_approval','wrong_design_intent'] loop
    v_variants := current_setting('db4.cycle6_variants')::jsonb;
    v_approval := 'approval-db4-m2-exact';
    v_design_intent := 'revision-decision-db4-r1';
    if v_case='nonexistent_selection' then
      v_variants := jsonb_set(v_variants,'{0,selectionRevisionIds}',
        '["revision-selection-does-not-exist"]'::jsonb);
    elsif v_case='forged_amount' then
      v_variants := jsonb_set(v_variants,'{0,budget,amountRub}','125001'::jsonb);
    elsif v_case='unknown_approval' then
      v_approval := 'approval-does-not-exist';
    else
      v_design_intent := 'decision-does-not-exist';
    end if;
    begin
      perform projectceo_product_api.submit_m2_client_review(
        '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
        'cycle6-negative-'||v_case,'73999999-0000-4000-8000-'||lpad(array_position(
          array['nonexistent_selection','forged_amount','unknown_approval','wrong_design_intent'],v_case)::text,12,'0'),
        null,v_approval,'cycle6-living-room',v_design_intent,v_variants,
        '2026-08-06T10:00:00+08:00',30,'Authoritative snapshot negative',
        current_setting('db4.cycle6_state_revision')::bigint,'cycle6-authoritative-'||v_case);
      raise exception 'DB4_CYCLE6_AUTHORITATIVE_NEGATIVE_ALLOWED_%',upper(v_case);
    exception when sqlstate 'P1111' then null;
    end;
  end loop;
end
$cycle6_authoritative_submission_negatives$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
select projectceo_product_api.submit_m2_client_review(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'cycle6-submission','74000000-0000-4000-8000-000000000010',null,
  'approval-db4-m2-exact','cycle6-living-room','revision-decision-db4-r1',
  :'cycle6_variants'::jsonb,'2026-08-06T10:00:00+08:00',30,
  'Cycle 6 exact client submission',:'cycle6_state_revision'::bigint,'cycle6-submit'
);
commit;

-- M3 cannot be built merely because some approved commit exists: the latest
-- assigned client submission must have an approved review of the same snapshot.
select set_config(
  'db4.cycle6_state_revision',
  (select state_revision::text from project_intelligence.project_workflows
   where project_id='41111111-1111-4111-8111-111111111111'),
  false
);
begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $m3_before_review_denied$
declare v_state bigint;
begin
  v_state := current_setting('db4.cycle6_state_revision')::bigint;
  begin
    perform projectceo_product_api.publish_m2_m3_handoff(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff-early','74000000-0000-4000-8000-000000000020',null,
      'db4-approved-commit','db4-approved-commit-r1','Must not skip client review',v_state,'cycle6-handoff-early');
    raise exception 'DB4_CYCLE6_M3_SKIPPED_REVIEW';
  exception when sqlstate 'P1111' then null;
  end;
end
$m3_before_review_denied$;
rollback;

update projectceo_foundation.project_memberships set role='client_approver'
where project_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';

select state_revision as state_revision from project_intelligence.project_workflows
where project_id='41111111-1111-4111-8111-111111111111'
\gset cycle6_
begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
select projectceo_product_api.review_m2_client_submission(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'cycle6-submission','74000000-0000-4000-8000-000000000011',
  '74000000-0000-4000-8000-000000000010','cycle6-variant-preferred','approved',
  'Клиент согласовал предпочтительный вариант',:'cycle6_state_revision'::bigint,'cycle6-review'
);
commit;

-- Exact replay is harmless even after state advancement; a different command
-- with a stale submission revision is controlled and appends nothing.
select set_config(
  'db4.cycle6_review_expected_state',
  :'cycle6_state_revision',
  false
);
begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $cycle6_review_replay$
declare v_result jsonb;
begin
  v_result := projectceo_product_api.review_m2_client_submission(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
    'cycle6-submission','74000000-0000-4000-8000-000000000011',
    '74000000-0000-4000-8000-000000000010','cycle6-variant-preferred','approved',
    'Клиент согласовал предпочтительный вариант',
    current_setting('db4.cycle6_review_expected_state')::bigint,'cycle6-review'
  );
  if not coalesce((v_result->>'replay')::boolean,false) then
    raise exception 'CYCLE6_REPLAY_FALSE' using errcode='P1112';
  end if;
end
$cycle6_review_replay$;
commit;

-- Approval must materialize/link one immutable approved commit carrying the
-- exact reviewed layout ledger revision and snapshot identities.
do $cycle6_approved_commit_binding$
begin
  if not exists (
    select 1 from projectceo_product.m2_workspace_revisions commit
    where commit.project_id='41111111-1111-4111-8111-111111111111'
      and commit.package_id='41111111-1111-4111-8111-111111111111'
      and commit.entity_kind='approved_commit' and commit.status='approved'
      and commit.payload->>'clientSubmissionId'='cycle6-submission'
      and commit.payload->>'clientReviewRevisionId'='74000000-0000-4000-8000-000000000011'
      and commit.payload#>>'{chosenVariant,variantId}'='cycle6-variant-preferred'
      and commit.payload#>>'{chosenVariant,layoutRevisionId}'='74000000-0000-4000-8000-000000000001'
  ) then raise exception 'DB4_CYCLE6_APPROVED_COMMIT_BINDING'; end if;
  if not exists (
    select 1 from projectceo_product.command_records command
    where command.project_id='41111111-1111-4111-8111-111111111111'
      and command.operation='append_m2_approved_commit_revision'
      and command.logical_result->>'entityKind'='approved_commit'
      and command.logical_result->>'revisionId'='74000000-0000-4000-8000-000000000011'
  ) then raise exception 'DB4_CYCLE6_APPROVED_COMMIT_COMMAND'; end if;
  if not exists (
    select 1 from projectceo_product.audit_events event
    join projectceo_product.command_records command
      on command.organization_id=event.organization_id
     and command.project_id=event.project_id and command.command_id=event.command_id
    where event.project_id='41111111-1111-4111-8111-111111111111'
      and command.operation='append_m2_approved_commit_revision'
      and event.event_type='m2_approved_commit_revision_appended'
  ) then raise exception 'DB4_CYCLE6_APPROVED_COMMIT_AUDIT'; end if;
end
$cycle6_approved_commit_binding$;

-- The generic M2 append endpoint must not be a second, weaker way to mint an
-- approved commit. Even a package client with review_selection cannot clone
-- the legitimate snapshot while changing any authoritative field.
select set_config(
  'db4.cycle6_approved_commit_payload',
  (select commit.payload::text
   from projectceo_product.m2_workspace_revisions commit
   where commit.project_id='41111111-1111-4111-8111-111111111111'
     and commit.entity_kind='approved_commit'
     and commit.payload->>'clientSubmissionId'='cycle6-submission'
   order by commit.revision_no desc limit 1),
  false
);
select set_config(
  'db4.cycle6_state_revision',
  (select state_revision::text from project_intelligence.project_workflows
   where project_id='41111111-1111-4111-8111-111111111111'),
  false
);
select set_config(
  'db4.cycle6_approved_commit_count',
  (select count(*)::text from projectceo_product.m2_workspace_revisions
   where project_id='41111111-1111-4111-8111-111111111111'
     and entity_kind='approved_commit' and entity_id='approved-cycle6-submission'),
  false
);
select set_config(
  'db4.cycle6_approved_commit_command_count',
  (select count(*)::text from projectceo_product.command_records
   where project_id='41111111-1111-4111-8111-111111111111'
     and operation='append_m2_approved_commit_revision'),
  false
);
select set_config(
  'db4.cycle6_approved_commit_audit_count',
  (select count(*)::text from projectceo_product.audit_events event
   join projectceo_product.command_records command
     on command.organization_id=event.organization_id
    and command.project_id=event.project_id and command.command_id=event.command_id
   where event.project_id='41111111-1111-4111-8111-111111111111'
     and command.operation='append_m2_approved_commit_revision'),
  false
);

begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $cycle6_generic_approved_commit_bypass_denied$
declare v_case text; v_payload jsonb; v_index integer;
begin
  foreach v_case in array array['budget','selection','room','intent','timestamp'] loop
    v_index := array_position(array['budget','selection','room','intent','timestamp'],v_case);
    v_payload := current_setting('db4.cycle6_approved_commit_payload')::jsonb
      - array['clientSubmissionId','clientReviewRevisionId'];
    v_payload := jsonb_set(v_payload,'{chosenVariant}',
      (v_payload->'chosenVariant')-'layoutRevisionId');
    if v_case='budget' then
      v_payload := jsonb_set(v_payload,'{budget,amountRub}','125001'::jsonb);
    elsif v_case='selection' then
      v_payload := jsonb_set(v_payload,'{approvedSelectionRevisionIds}',
        '["revision-selection-does-not-exist"]'::jsonb);
    elsif v_case='room' then
      v_payload := jsonb_set(v_payload,'{roomId}','"forged-room"'::jsonb);
    elsif v_case='intent' then
      v_payload := jsonb_set(v_payload,'{designIntentRevisionId}','"decision-does-not-exist"'::jsonb);
    else
      v_payload := jsonb_set(v_payload,'{reviewedAt}','"2026-08-07T10:00:00+08:00"'::jsonb);
    end if;
    begin
      perform projectceo_product_api.append_m2_workspace_revision(
        '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
        'approved_commit','approved-cycle6-submission',
        '76000000-0000-4000-8000-'||lpad(v_index::text,12,'0'),
        '74000000-0000-4000-8000-000000000011','approved',v_payload,
        'Forged generic approved commit '||v_case,
        current_setting('db4.cycle6_state_revision')::bigint,'cycle6-bypass-'||v_case);
      raise exception 'DB4_CYCLE6_GENERIC_APPROVED_COMMIT_BYPASS_%',upper(v_case);
    exception when sqlstate 'P1111' then null;
    end;
  end loop;
end
$cycle6_generic_approved_commit_bypass_denied$;
commit;

do $cycle6_no_forged_approved_commit_side_effects$
begin
  if (select state_revision from project_intelligence.project_workflows
      where project_id='41111111-1111-4111-8111-111111111111')
       <> current_setting('db4.cycle6_state_revision')::bigint then
    raise exception 'DB4_CYCLE6_FORGED_APPROVED_COMMIT_STATE_ADVANCED';
  end if;
  if (select count(*) from projectceo_product.m2_workspace_revisions
      where project_id='41111111-1111-4111-8111-111111111111'
        and entity_kind='approved_commit' and entity_id='approved-cycle6-submission')
       <> current_setting('db4.cycle6_approved_commit_count')::bigint then
    raise exception 'DB4_CYCLE6_FORGED_APPROVED_COMMIT_PERSISTED';
  end if;
  if (select count(*) from projectceo_product.command_records
      where project_id='41111111-1111-4111-8111-111111111111'
        and operation='append_m2_approved_commit_revision')
       <> current_setting('db4.cycle6_approved_commit_command_count')::bigint then
    raise exception 'DB4_CYCLE6_FORGED_APPROVED_COMMIT_COMMAND';
  end if;
  if exists (
    select 1 from projectceo_product.audit_events event
    join projectceo_product.command_records command
      on command.organization_id=event.organization_id
     and command.project_id=event.project_id and command.command_id=event.command_id
    where event.project_id='41111111-1111-4111-8111-111111111111'
      and command.logical_result->>'revisionId' like '76000000-0000-4000-8000-%'
  ) then raise exception 'DB4_CYCLE6_FORGED_APPROVED_COMMIT_AUDIT'; end if;
  if (select count(*) from projectceo_product.audit_events event
      join projectceo_product.command_records command
        on command.organization_id=event.organization_id
       and command.project_id=event.project_id and command.command_id=event.command_id
      where event.project_id='41111111-1111-4111-8111-111111111111'
        and command.operation='append_m2_approved_commit_revision')
       <> current_setting('db4.cycle6_approved_commit_audit_count')::bigint then
    raise exception 'DB4_CYCLE6_FORGED_APPROVED_COMMIT_AUDIT_COUNT';
  end if;
  if exists (
    select 1 from projectceo_product.m2_workspace_revisions handoff
    where handoff.project_id='41111111-1111-4111-8111-111111111111'
      and handoff.entity_kind='m2_m3_handoff'
      and handoff.payload->>'approvedCommitRevisionId' like '76000000-0000-4000-8000-%'
  ) then raise exception 'DB4_CYCLE6_FORGED_M3'; end if;
end
$cycle6_no_forged_approved_commit_side_effects$;

select commit.entity_id as commit_id, commit.revision_id as commit_revision_id,
  workflow.state_revision as state_revision
from projectceo_product.m2_workspace_revisions commit
join project_intelligence.project_workflows workflow
  on workflow.organization_id=commit.organization_id and workflow.project_id=commit.project_id
where commit.project_id='41111111-1111-4111-8111-111111111111'
  and commit.entity_kind='approved_commit'
  and commit.payload->>'clientSubmissionId'='cycle6-submission'
order by commit.revision_no desc limit 1
\gset cycle6_commit_

begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
select projectceo_product_api.publish_m2_m3_handoff(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'cycle6-handoff','74000000-0000-4000-8000-000000000021',null,
  :'cycle6_commit_commit_id',:'cycle6_commit_commit_revision_id',
  'Передача точного согласованного M2 в M3',:'cycle6_commit_state_revision'::bigint,'cycle6-handoff'
);
commit;

do $cycle6_m3_exact_binding$
begin
  if not exists (
    select 1 from projectceo_product.m2_workspace_revisions handoff
    join projectceo_product.m2_workspace_revisions commit
      on commit.organization_id=handoff.organization_id
     and commit.project_id=handoff.project_id
     and commit.entity_kind='approved_commit'
     and commit.entity_id=handoff.payload->>'approvedCommitId'
    where handoff.entity_kind='m2_m3_handoff' and handoff.entity_id='cycle6-handoff'
      and commit.payload->>'clientSubmissionId'='cycle6-submission'
      and handoff.payload->>'layoutRevisionId'='74000000-0000-4000-8000-000000000001'
      and handoff.payload->'selectionRevisionIds'=jsonb_build_array('revision-selection-db4-r1')
  ) then raise exception 'DB4_CYCLE6_M3_EXACT_BINDING'; end if;
end
$cycle6_m3_exact_binding$;

-- Direct malformed decisions, identifiers and reasons fail with the controlled
-- validation SQLSTATE rather than reaching storage.
select set_config(
  'db4.cycle6_state_revision',
  (select state_revision::text from project_intelligence.project_workflows
   where project_id='41111111-1111-4111-8111-111111111111'),
  false
);
begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $cycle6_direct_negatives$
declare v_state bigint; v_case text;
begin
  v_state := current_setting('db4.cycle6_state_revision')::bigint;
  foreach v_case in array array['decision','id','reason','json'] loop
    begin
      if v_case='json' then
        perform projectceo_product_api.submit_m2_client_review(
          '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
          'invalid-json','74000000-0000-4000-8000-000000000099',null,'approval-db4-m2-exact',
          'cycle6-living-room','design-intent-cycle6-r1','{}'::jsonb,'bad',0,'Valid reason',v_state,'cycle6-invalid-json');
      else
        perform projectceo_product_api.review_m2_client_submission(
          '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
          case when v_case='id' then repeat('x',161) else 'cycle6-submission' end,
          '74000000-0000-4000-8000-000000000090','74000000-0000-4000-8000-000000000010',
          'cycle6-variant-preferred',case when v_case='decision' then 'maybe' else 'approved' end,
          case when v_case='reason' then ' x ' else 'Controlled negative review' end,
          v_state,'cycle6-invalid-'||v_case);
      end if;
      raise exception 'DB4_CYCLE6_DIRECT_NEGATIVE_ALLOWED_%',upper(v_case);
    exception when sqlstate 'P1111' then null;
    end;
  end loop;
end
$cycle6_direct_negatives$;
rollback;

-- Assigned package client can read only its exact submission/review. Project
-- scope, wrong package, other tenant and builder/guest identities fail closed.
set role authenticated;
set request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $cycle6_client_read_v6$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v6(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111') into v_read;
  if jsonb_array_length(v_read#>'{data,m2ClientReviewSubmissions}')<>1
     or jsonb_array_length(v_read#>'{data,m2ClientReviews}')<>1
     or jsonb_array_length(v_read#>'{data,m2M3Handoffs}')<>0 then
    raise exception 'DB4_CYCLE6_CLIENT_READ_SCOPE';
  end if;
  select projectceo_read_api.get_project_workspace_read_v6(
    '41111111-1111-4111-8111-111111111111',null) into v_read;
  if jsonb_array_length(v_read#>'{data,m2ClientReviewSubmissions}')<>0 then
    raise exception 'DB4_CYCLE6_PROJECT_CLIENT_LEAK';
  end if;
  select projectceo_read_api.get_project_workspace_read_v6(
    '41111111-1111-4111-8111-111111111111','49999999-9999-4999-8999-999999999999') into v_read;
  if v_read->'error' is null or v_read->'error'='null'::jsonb then
    raise exception 'DB4_CYCLE6_WRONG_PACKAGE_READ';
  end if;
end
$cycle6_client_read_v6$;
reset role;

update projectceo_foundation.project_memberships set role='builder'
where project_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
update projectceo_foundation.package_memberships set role='builder'
where project_id='41111111-1111-4111-8111-111111111111'
  and package_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
update projectceo_foundation.package_member_capabilities set capability='view_project'
where project_id='41111111-1111-4111-8111-111111111111'
  and package_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222'
  and capability='review_selection';
set role authenticated;
set request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $cycle6_builder_no_leak$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v6(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111') into v_read;
  if jsonb_array_length(v_read#>'{data,m2ClientReviewSubmissions}')<>0
     or jsonb_array_length(v_read#>'{data,m2ClientReviews}')<>0
     or jsonb_array_length(v_read#>'{data,m2M3Handoffs}')<>0 then
    raise exception 'DB4_CYCLE6_BUILDER_LEAK';
  end if;
end
$cycle6_builder_no_leak$;
reset role;

begin;
set local role anon;
do $cycle6_guest_rpc_denied$
begin
  begin
    perform projectceo_read_api.get_project_workspace_read_v6(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111');
    raise exception 'DB4_CYCLE6_GUEST_READ_LEAK';
  exception when insufficient_privilege then null;
  end;
end
$cycle6_guest_rpc_denied$;
rollback;

update projectceo_foundation.project_memberships set role='client_approver'
where project_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
update projectceo_foundation.package_memberships set role='client_approver'
where project_id='41111111-1111-4111-8111-111111111111'
  and package_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
update projectceo_foundation.package_member_capabilities set capability='review_selection'
where project_id='41111111-1111-4111-8111-111111111111'
  and package_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222'
  and capability='view_project';

set role authenticated;
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $cycle6_other_org_denied$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v6(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111') into v_read;
  if v_read->'error' is null or v_read->'error'='null'::jsonb then raise exception 'DB4_CYCLE6_OTHER_ORG_READ'; end if;
end
$cycle6_other_org_denied$;
reset role;

-- Immutable/idempotent/stale behavior is shared by all Cycle 6 ledger kinds.
do $cycle6_immutable$
begin
  begin
    update projectceo_product.m2_workspace_revisions set reason='mutated'
    where entity_kind in ('m2_client_submission','m2_client_review','m2_m3_handoff');
    raise exception 'DB4_CYCLE6_MUTABLE';
  exception when sqlstate '55000' then null;
  end;
end
$cycle6_immutable$;

select 'DB4_M2_CLIENT_REVIEW_M3_HANDOFF_OK' result;
