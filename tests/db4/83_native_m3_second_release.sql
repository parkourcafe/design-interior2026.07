\set ON_ERROR_STOP on

-- SYNTHETIC SQL evidence only. Requires durable scenario 81 and the existing
-- disposable M4 Increment 1 / V1 Impact enables. No new runtime grants, private
-- business-table seed, human service-role command, real price or source claim.
-- A handoff-only release with unchanged decision/selection refs is legitimately
-- allowed by validate_product_release_impact_review(). This scenario instead
-- replaces both refs and proves the substantive change gate before version 2.
begin;

create function pg_temp.native83_snapshot() returns jsonb language plpgsql as $$
declare t record; digest text; result jsonb := '{}'::jsonb;
begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('project_intelligence','projectceo_foundation','projectceo_product','projectceo_m3','projectceo_m4')
      and c.relkind='r' order by n.nspname,c.relname loop
    execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',t.nspname,t.relname) into digest;
    result := result || jsonb_build_object(t.nspname||'.'||t.relname,digest);
  end loop;
  return result;
end $$;

create function pg_temp.native83_denied(command text, expected text, reason text default null)
returns void language plpgsql as $$
declare actual text; detail text;
begin
  begin
    execute command;
  exception when others then
    get stacked diagnostics actual = returned_sqlstate, detail = pg_exception_detail;
  end;
  if actual is distinct from expected
    or (reason is not null and coalesce(nullif(detail,''),'{}')::jsonb->>'reason' is distinct from reason) then
    raise exception 'DB4_83_EXPECTED_%_%, GOT_%:%',expected,reason,coalesce(actual,'success'),detail;
  end if;
end $$;

create function pg_temp.native83_release_refused(command text) returns void language plpgsql as $$
declare p uuid := '41111111-1111-4111-8111-111111111111'; k uuid := '81777777-7777-4777-8777-777777777777';
  before_data jsonb; context jsonb;
begin
  before_data := pg_temp.native83_snapshot();
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  context := projectceo_m3_api.get_native_m3_release_context(p,k)->'data';
  if context->'structurallyComplete' is distinct from 'true'::jsonb then
    raise exception 'DB4_83_IMPACT_PROBE_REQUIRES_COMPLETE_NATIVE_CONTEXT:%',context;
  end if;
  perform pg_temp.native83_denied(format(
    'select projectceo_product_api.publish_native_m3_release_request_bound(%L,%L,%L,%L,%L,%L,%L,%L)',
    p,k,context->>'baselineId',context->>'previousVersionId',context->>'stateRevision',context->>'contextDigest',command,command),
    'P1110','HUMAN_REVIEWED_IMPACT_REQUIRED');
  reset role;
  if before_data is distinct from pg_temp.native83_snapshot() then
    raise exception 'DB4_83_DENIED_RELEASE_MUTATED_DATA:%',command;
  end if;
end $$;

-- This checkpoint schema is test-only, has no runtime grants, and retains the
-- exact first input for later concurrency/restart probes without rewriting it.
create table native_m3_fixture.second_release (
  context jsonb not null,
  response jsonb not null,
  change_request_id uuid not null,
  impact_run_id uuid not null,
  first_release_row jsonb not null,
  first_context_row jsonb not null,
  first_refs jsonb not null
);
create temporary table native83_first as
select to_jsonb(v) release_row,to_jsonb(c) context_row,
  (select jsonb_agg(to_jsonb(r) order by r.target_kind,r.ordinal)
   from projectceo_product.production_package_version_refs r
   where r.project_id=v.project_id and r.production_package_version_id=v.production_package_version_id) refs
from projectceo_product.production_package_versions v
join projectceo_m3.production_package_native_contexts c
  on c.organization_id=v.organization_id and c.project_id=v.project_id
  and c.production_package_version_id=v.production_package_version_id
where v.project_id='41111111-1111-4111-8111-111111111111'
  and v.package_id='81777777-7777-4777-8777-777777777777'
  and v.production_package_version_id='release:native81-release';

do $preconditions$
declare signature text; saved record;
begin
  select * into strict saved from native_m3_fixture.published;
  if (select count(*) from native83_first)<>1
    or saved.response#>>'{result,id}' is distinct from 'release:native81-release'
    or saved.context#>>'{scope,packageId}' is distinct from '81777777-7777-4777-8777-777777777777'
    or (select context_row->'context' from native83_first) is distinct from saved.context
    or (select count(*) from projectceo_product.production_package_versions
      where project_id='41111111-1111-4111-8111-111111111111'
        and package_id='81777777-7777-4777-8777-777777777777')<>1 then
    raise exception 'DB4_83_DURABLE_FIRST_CHILD_RELEASE_REQUIRED';
  end if;
  foreach signature in array array[
    'projectceo_m4_api.submit_change_request(uuid,uuid,text,text,text,text,bigint,integer,bigint,text)',
    'projectceo_m4_api.review_change_impact(uuid,uuid,text,text,text,bigint,text)',
    'projectceo_product_api.publish_work_package_release_request_bound(uuid,uuid,text,text,bigint,text,text)',
    'projectceo_m3_api.get_native_m3_release_context(uuid,uuid)'
  ] loop
    if not has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'DB4_83_EXISTING_DISPOSABLE_ENABLE_REQUIRED:%',signature;
    end if;
  end loop;
  if has_function_privilege('authenticated',
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid,uuid,bigint,text)','EXECUTE')
    or not has_function_privilege('service_role',
    'projectceo_m4_api.calculate_change_impact_policy_bound(uuid,uuid,bigint,text)','EXECUTE') then
    raise exception 'DB4_83_IMPACT_WORKER_BOUNDARY_CHANGED';
  end if;
end $preconditions$;

-- Identity bootstrap only: the command is builder-only, and none of scenario
-- 81's owner/client/architect identities may be silently assigned another role.
insert into auth.users(id,email,email_confirmed_at) values
 ('83999999-9999-4999-8999-999999999999','native83-builder@example.invalid',now());
do $builder_enrollment$
begin
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_api.enroll_organization_project_scope(
    '41111111-1111-4111-8111-111111111111','81777777-7777-4777-8777-777777777777',
    'native81-child','Synthetic native child',
    '[{"userId":"83999999-9999-4999-8999-999999999999","role":"builder"}]'::jsonb,'native83-enroll-builder');
  reset role;
end $builder_enrollment$;

do $changed_approved_lineage$
declare p uuid := '41111111-1111-4111-8111-111111111111'; k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; result jsonb; evidence jsonb; variant record; variants jsonb := '[]'::jsonb;
begin
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  select jsonb_build_object('evidenceVersionId',evidence_version_id,'evidenceLinkId',evidence_link_id,
    'sourceId',source_id,'sourceNodeId',source_node_id,'sourceRevisionId',source_revision_id,'fragmentId',fragment_id)
    into strict evidence from projectceo_product.revision_evidence_refs
    where project_id=p order by claim_revision_id,evidence_link_id limit 1;
  -- Reuse the three immutable synthetic geometries. This is a change to intent
  -- and specification, not an invented geometry or drawing-authoring claim.
  for variant in select payload,entity_id,revision_id from projectceo_product.m2_workspace_revisions
    where project_id=p and package_id=k and entity_kind='layout_version'
      and entity_id in ('native81-layout-preferred','native81-layout-value_engineered','native81-layout-premium')
    order by entity_id loop
    variants := variants || jsonb_build_array(jsonb_build_object(
      'variantId',variant.payload->>'variantId','role',variant.payload->>'role',
      'layoutDocumentId',variant.entity_id,'layoutVersionId',variant.payload->>'versionId',
      'layoutRevisionId',variant.revision_id,'semanticHash',variant.payload->>'semanticHash',
      'selectionRevisionIds',jsonb_build_array('native81-selection-r2'),
      'budget',jsonb_build_object('amountRub',135000,
        'staleSelectionRevisionIds','[]'::jsonb,'missingPriceSelectionRevisionIds','[]'::jsonb)));
  end loop;
  if jsonb_array_length(variants)<>3 then raise exception 'DB4_83_THREE_LAYOUT_FIXTURES_REQUIRED'; end if;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  result := projectceo_product_api.append_decision_revision(p,k,'native81-intent','native81-intent-r2','native81-intent-r1',
    'human_origin','Synthetic revised intent','Synthetic replacement specification',null,'proposed','[]',
    'Synthetic substantive replacement',s,'native83-intent-r2');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.append_selection_revision(p,k,'native81-selection','native81-selection-r2','native81-selection-r1',
    'human_origin','Synthetic revised selection','node-area-db4','native81-intent-r2','{"material":"synthetic-revised"}','[]',
    'Synthetic replacement specification',s,'native83-selection-r2');
  s := (result->>'stateRevision')::bigint;
  -- RUB 135000 and the later delta 10000 are deliberately synthetic fixture
  -- values. Existing synthetic evidence is reused; neither is a market quote.
  result := projectceo_product_api.append_price_observation(p,'native81-selection-r2','native83-price',135000,
    evidence,'synthetic:test',s,'native83-price');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.create_approval_package(p,k,'native83-approval',
    '[{"targetKind":"decision_revision","entityId":"native81-intent","revisionId":"native81-intent-r2"},{"targetKind":"selection_revision","entityId":"native81-selection","revisionId":"native81-selection-r2"}]',s,'native83-approval');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.submit_approval_package(p,'native83-approval','draft',s,'native83-submit-approval');
  s := (result->>'stateRevision')::bigint;
  set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
  result := projectceo_product_api.review_approval_package(p,'native83-approval','submitted','approved',
    'Synthetic client approval of exact replacement revisions',s,'native83-review-approval');
  s := (result->>'stateRevision')::bigint;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  result := projectceo_product_api.submit_m2_client_review(p,k,'native83-submission','native83-submission-r1',null,
    'native83-approval','native81-room','native81-intent-r2',variants,
    to_char(statement_timestamp()+interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS"Z"'),30,
    'Synthetic replacement submission',s,'native83-submission');
  s := (result->>'stateRevision')::bigint;
  set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
  perform projectceo_product_api.review_m2_client_submission(p,k,'native83-submission','native83-review-r1',
    'native83-submission-r1','native81-layout-preferred-variant','approved','Synthetic client review',s,'native83-review');
  reset role;
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  result := projectceo_product_api.publish_m2_m3_handoff(p,k,'native81-handoff','native81-handoff-r3','native81-handoff-r2',
    'approved-native83-submission','native83-review-r1','Synthetic changed exact handoff',s,'native83-handoff');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.publish_m2_m3_handoff(p,k,'native81-parallel','native81-parallel-r2','native81-parallel-r1',
    'approved-native83-submission','native83-review-r1','Synthetic changed parallel handoff',s,'native83-parallel');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_m3_api.register_documentation_sheet(p,k,'native81-handoff','native81-handoff-r3',
    'native83-sheet','N-84','Synthetic replacement documentation','native83-sheet-r1',
    array['native81-selection-r2'],'Synthetic changed handoff covered',s,'native83-sheet');
  s := (result->>'stateRevision')::bigint;
  perform projectceo_m3_api.register_documentation_sheet(p,k,'native81-parallel','native81-parallel-r2',
    'native83-parallel-sheet','N-85','Synthetic replacement parallel documentation','native83-parallel-sheet-r1',
    array['native81-selection-r2'],'Synthetic changed parallel handoff covered',s,'native83-parallel-sheet');
  reset role;
end $changed_approved_lineage$;

-- The ordinary claim RPCs do not fabricate dependency edges. Ingest an explicit
-- synthetic source graph through the same human API used by AP5 impact fixtures:
-- one downstream deliverable depends on each changed root, yielding two impacts.
-- No bytes were uploaded; this graph is only SQL fixture evidence.
do $synthetic_dependency_graph$
declare p uuid := '41111111-1111-4111-8111-111111111111'; k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; source_payload jsonb; deliverable_payload jsonb; revisions jsonb;
begin
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  source_payload := jsonb_build_object('schemaVersion','project-ceo/source-metadata/0.1','sourceId','native83-source');
  deliverable_payload := jsonb_build_object('schemaVersion','project-ceo-deliverable/0.1','packageId',k,'synthetic',true);
  revisions := jsonb_build_array(
    jsonb_build_object('revisionId','native83-source-r1','nodeId','native83-source-node','revisionNo',1,
      'title','Synthetic dependency source','payload',source_payload,'origin','human','claimStatus','human_origin',
      'unknownReason',null,'replacesRevisionId',null,'contentDigestHex',encode(project_intelligence._sha256_jsonb(source_payload),'hex')),
    jsonb_build_object('revisionId','native83-deliverable-r1','nodeId','native83-deliverable','revisionNo',1,
      'title','Synthetic downstream deliverable','payload',deliverable_payload,'origin','human','claimStatus','human_origin',
      'unknownReason',null,'replacesRevisionId',null,'contentDigestHex',encode(project_intelligence._sha256_jsonb(deliverable_payload),'hex')));
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_api.ingest_source_graph(p,
    jsonb_build_object('sourceId','native83-source','sourceRevisionId','native83-source-r1','kind','pdf',
      'checksumHex',repeat('83',32),'packageId',k,
      'metadata',jsonb_build_object('originalFilename','synthetic-native83-dependency.pdf','mediaType','application/pdf',
        'sizeBytes',83,'extension','pdf','sourceRole','drawing-preview','declaredRevision','synthetic-r1','documentStatus','current')),
    '[]'::jsonb,
    '[{"nodeId":"native83-source-node","kind":"source","stableKey":"native83-source","currentRevisionId":"native83-source-r1"},{"nodeId":"native83-deliverable","kind":"deliverable","stableKey":"native83-deliverable","currentRevisionId":"native83-deliverable-r1"}]'::jsonb,
    revisions,'[]'::jsonb,
    '[{"edgeId":"native83-deliverable-intent","fromNodeId":"native83-deliverable","toNodeId":"native81-intent","relation":"depends_on"},{"edgeId":"native83-deliverable-selection","fromNodeId":"native83-deliverable","toNodeId":"native81-selection","relation":"specified_by"}]'::jsonb,
    s,'native83-dependency-graph');
  reset role;
end $synthetic_dependency_graph$;

-- Adversarial coverage probe, isolated before the real proposed baseline:
-- extending the downstream graph to depth 8 must not turn all RETURNED reviews
-- into permission to release. The private sentinel rolls back the entire probe,
-- including a release if the guard unexpectedly allows it, before asserting the
-- verdict. The ordinary two-impact complete scenario then uses its original graph.
do $partial_depth_release_denied$
declare
  p uuid := '41111111-1111-4111-8111-111111111111';
  k uuid := '81777777-7777-4777-8777-777777777777';
  before_data jsonb; source_payload jsonb; payload jsonb; nodes jsonb; revisions jsonb;
  edges jsonb := '[]'::jsonb; s bigint; latest text; prior text; node_id text; previous_node text;
  depth integer; response jsonb; probe_context jsonb; change_id uuid; run_id uuid;
  impact record; reviewed integer := 0; actual_state text; actual_detail text;
  refused boolean := false; policy jsonb;
begin
  before_data := pg_temp.native83_snapshot();
  policy := projectceo_m4._impact_policy();
  if (policy->>'maxDepth')::integer is distinct from 7 then
    raise exception 'DB4_83_DEPTH_PROBE_REQUIRES_CANONICAL_DEPTH_SEVEN';
  end if;
  begin
    -- The existing native83-deliverable is distance 1 from each of the two
    -- changed roots. Seven new dependants reach distances 2..8. Only distances
    -- 1..7 are returned: 14 impacts, with at least 15 known including the cutoff.
    source_payload := jsonb_build_object('schemaVersion','project-ceo/source-metadata/0.1',
      'sourceId','native83-depth-source');
    nodes := jsonb_build_array(jsonb_build_object('nodeId','native83-depth-source-node','kind','source',
      'stableKey','native83-depth-source','currentRevisionId','native83-depth-source-r1'));
    revisions := jsonb_build_array(jsonb_build_object('revisionId','native83-depth-source-r1',
      'nodeId','native83-depth-source-node','revisionNo',1,'title','Synthetic depth probe source',
      'payload',source_payload,'origin','human','claimStatus','human_origin','unknownReason',null,
      'replacesRevisionId',null,'contentDigestHex',encode(project_intelligence._sha256_jsonb(source_payload),'hex')));
    previous_node := 'native83-deliverable';
    for depth in 2..8 loop
      node_id := 'native83-depth-deliverable-'||depth;
      payload := jsonb_build_object('schemaVersion','project-ceo-deliverable/0.1','packageId',k,
        'synthetic',true,'depth',depth);
      nodes := nodes || jsonb_build_array(jsonb_build_object('nodeId',node_id,'kind','deliverable',
        'stableKey',node_id,'currentRevisionId',node_id||'-r1'));
      revisions := revisions || jsonb_build_array(jsonb_build_object('revisionId',node_id||'-r1',
        'nodeId',node_id,'revisionNo',1,'title','Synthetic depth probe dependant','payload',payload,
        'origin','human','claimStatus','human_origin','unknownReason',null,'replacesRevisionId',null,
        'contentDigestHex',encode(project_intelligence._sha256_jsonb(payload),'hex')));
      edges := edges || jsonb_build_array(jsonb_build_object('edgeId','native83-depth-edge-'||depth,
        'fromNodeId',node_id,'toNodeId',previous_node,'relation','depends_on'));
      previous_node := node_id;
    end loop;
    select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
    set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
    perform projectceo_api.ingest_source_graph(p,
      jsonb_build_object('sourceId','native83-depth-source','sourceRevisionId','native83-depth-source-r1',
        'kind','pdf','checksumHex',repeat('84',32),'packageId',k,
        'metadata',jsonb_build_object('originalFilename','synthetic-native83-depth-probe.pdf',
          'mediaType','application/pdf','sizeBytes',84,'extension','pdf','sourceRole','drawing-preview',
          'declaredRevision','synthetic-r1','documentStatus','current')),
      '[]'::jsonb,nodes,revisions,'[]'::jsonb,edges,s,'native83-depth-ingest');
    reset role;
    select state_revision,latest_version_id into strict s,latest
      from project_intelligence.project_workflows where project_id=p;
    select saved.context->>'baselineId' into strict prior from native_m3_fixture.published saved;
    set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
    perform projectceo_product_api.publish_baseline_atomic(p,latest,prior,s,
      'native83-depth-baseline','native83-depth-baseline');
    probe_context := projectceo_m3_api.get_native_m3_release_context(p,k)->'data';
    reset role;
    if probe_context->'structurallyComplete' is distinct from 'true'::jsonb
      or probe_context->'findings' is distinct from '[]'::jsonb
      or probe_context->>'baselineId' is distinct from 'baseline:native83-depth-baseline'
      or probe_context->>'previousVersionId' is distinct from 'release:native81-release' then
      raise exception 'DB4_83_DEPTH_PROBE_NATIVE_PREREQUISITE_INVALID:%',probe_context;
    end if;
    select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
    set local role authenticated; set local request.jwt.claim.sub='83999999-9999-4999-8999-999999999999';
    response := projectceo_m4_api.submit_change_request(p,k,prior,'baseline:native83-depth-baseline',
      'release:native81-release','Synthetic depth coverage probe',10000,1,s,'native83-depth-change');
    reset role;
    change_id := (response#>>'{result,id}')::uuid;
    if response#>>'{result,rootCount}' is distinct from '2' then
      raise exception 'DB4_83_DEPTH_PROBE_TWO_CHANGED_ROOTS_REQUIRED:%',response;
    end if;
    select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
    set local role service_role;
    response := projectceo_m4_api.calculate_change_impact_policy_bound(p,change_id,s,'native83-depth-impact');
    reset role;
    run_id := (response#>>'{result,id}')::uuid;
    if not exists(select 1 from projectceo_m4.impact_runs r
      where r.project_id=p and r.package_id=k and r.impact_run_id=run_id and r.change_request_id=change_id
        and r.target_baseline_id='baseline:native83-depth-baseline' and r.coverage_status='partial_depth'
        and r.policy_version=policy->>'version' and r.max_depth=7
        and r.max_impacts=(policy->>'maxImpacts')::integer and r.returned_impact_count=14
        and r.known_impact_count_lower_bound=15 and r.has_more_beyond_depth
        and r.cutoff_reason='depth_boundary' and r.superseded_at is null)
      or (select count(*) from projectceo_m4.impacts i where i.project_id=p and i.impact_run_id=run_id)<>14
      or (select count(distinct i.changed_node_id) from projectceo_m4.impacts i
        where i.project_id=p and i.impact_run_id=run_id)<>2
      or (select count(*) from projectceo_m4.impacts i
        where i.project_id=p and i.impact_run_id=run_id and i.distance=7)<>2
      or exists(select 1 from projectceo_m4.impacts i where i.project_id=p and i.impact_run_id=run_id
        and (i.distance not between 1 and 7 or i.impacted_node_id='native83-depth-deliverable-8'
          or i.changed_revision_id not in ('native81-intent-r2','native81-selection-r2'))) then
      raise exception 'DB4_83_DEPTH_PROBE_PARTIAL_FOURTEEN_REQUIRED:%',response;
    end if;
    for impact in select i.impact_id from projectceo_m4.impacts i
      where i.project_id=p and i.impact_run_id=run_id order by i.impact_id loop
      select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
      set local role authenticated; set local request.jwt.claim.sub='81888888-8888-4888-8888-888888888888';
      response := projectceo_m4_api.review_change_impact(p,run_id,impact.impact_id,'resolved',
        'Synthetic returned impact reviewed; depth coverage remains incomplete',s,'native83-depth-review-'||impact.impact_id);
      reset role;
      reviewed := reviewed+1;
    end loop;
    if reviewed<>14 or response#>'{result,allReturnedImpactsReviewed}' is distinct from 'true'::jsonb
      or response#>'{result,coverageComplete}' is distinct from 'false'::jsonb
      or response#>'{result,impactReviewComplete}' is distinct from 'false'::jsonb then
      raise exception 'DB4_83_DEPTH_PROBE_REVIEW_COVERAGE_SHAPE_INVALID:%',response;
    end if;
    set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
    probe_context := projectceo_m3_api.get_native_m3_release_context(p,k)->'data';
    if probe_context->'structurallyComplete' is distinct from 'true'::jsonb then
      raise exception 'DB4_83_DEPTH_PROBE_NATIVE_CONTEXT_BECAME_INCOMPLETE';
    end if;
    begin
      response := projectceo_product_api.publish_native_m3_release_request_bound(p,k,
        probe_context->>'baselineId',probe_context->>'previousVersionId',
        (probe_context->>'stateRevision')::bigint,probe_context->>'contextDigest','native83-depth-release','native83-depth-release');
    exception when sqlstate 'P1110' then
      get stacked diagnostics actual_state=returned_sqlstate,actual_detail=pg_exception_detail;
      if coalesce(nullif(actual_detail,''),'{}')::jsonb->>'reason' is distinct from 'HUMAN_REVIEWED_IMPACT_REQUIRED' then
        raise;
      end if;
      refused := true;
    end;
    reset role;
    if not refused and (
      response->'replay' is distinct from 'false'::jsonb
      or response#>>'{result,id}' is distinct from 'release:native83-depth-release'
      or not exists(select 1 from projectceo_product.production_package_versions v
        where v.project_id=p and v.package_id=k and v.production_package_version_id='release:native83-depth-release'
          and v.previous_version_id='release:native81-release' and v.version_no=2
          and v.baseline_id='baseline:native83-depth-baseline')
      or not exists(select 1 from projectceo_m3.production_package_native_contexts c
        where c.project_id=p and c.package_id=k and c.production_package_version_id='release:native83-depth-release'
          and c.context=probe_context)) then
      raise exception 'DB4_83_DEPTH_PROBE_UNEXPECTED_PUBLICATION_ENVELOPE:%',response;
    end if;
    -- Check deferred constraints before the forced rollback, so success cannot
    -- mean merely a release that would have failed at transaction completion.
    set constraints all immediate;
    raise sqlstate 'Z8301' using message='DB4_83_ROLL_BACK_DEPTH_PROBE';
  exception when sqlstate 'Z8301' then null;
  end;
  reset role;
  if before_data is distinct from pg_temp.native83_snapshot() then
    raise exception 'DB4_83_DEPTH_PROBE_ESCAPED_ROLLBACK';
  end if;
  if not refused then
    raise exception 'DB4_83_PARTIAL_DEPTH_RELEASE_ALLOWED: coverage=partial_depth maxDepth=7 reviewed=14 allReturnedImpactsReviewed=true coverageComplete=false impactReviewComplete=false; probe fully rolled back';
  end if;
end $partial_depth_release_denied$;

do $proposed_baseline$
declare p uuid := '41111111-1111-4111-8111-111111111111'; k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; latest text; prior text; context jsonb;
begin
  select state_revision,latest_version_id into strict s,latest from project_intelligence.project_workflows where project_id=p;
  select baseline_id into strict prior from projectceo_product.project_baselines where project_id=p order by version_no desc limit 1;
  if prior is distinct from (select saved.context->>'baselineId' from native_m3_fixture.published saved) then
    raise exception 'DB4_83_FIRST_BASELINE_MUST_BE_CURRENT';
  end if;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_product_api.publish_baseline_atomic(p,latest,prior,s,'native83-baseline','native83-baseline');
  context := projectceo_m3_api.get_native_m3_release_context(p,k)->'data';
  reset role;
  if context->'structurallyComplete' is distinct from 'true'::jsonb
    or context->>'baselineId' is distinct from 'baseline:native83-baseline'
    or context->>'previousVersionId' is distinct from 'release:native81-release'
    or context->'baselineDecisionRevisionIds' is distinct from '["native81-intent-r2"]'::jsonb
    or context->'baselineSelectionRevisionIds' is distinct from '["native81-selection-r2"]'::jsonb
    or jsonb_array_length(context->'handoffs')<>2 or jsonb_array_length(context->'sheets')<>2
    or exists(select 1 from jsonb_array_elements(context->'sheets') sheet
      where sheet->>'sheetId' not in ('native83-sheet','native83-parallel-sheet')) then
    raise exception 'DB4_83_CHANGED_CONTEXT_INVALID:%',context;
  end if;
end $proposed_baseline$;

select pg_temp.native83_release_refused('native83-no-change');

create temporary table native83_impact(change_request_id uuid not null,impact_run_id uuid);
do $change_and_calculation$
declare p uuid := '41111111-1111-4111-8111-111111111111'; k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; prior text; response jsonb; change_id uuid; run_id uuid; before_data jsonb; policy jsonb;
begin
  select saved.context->>'baselineId' into strict prior from native_m3_fixture.published saved;
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  before_data := pg_temp.native83_snapshot();
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform pg_temp.native83_denied(format(
    'select projectceo_m4_api.submit_change_request(%L,%L,%L,%L,%L,%L,10000,1,%L,%L)',
    p,k,prior,'baseline:native83-baseline','release:native81-release',
    'Synthetic fixture replacement',s,'native83-owner-change-denied'),'P1103','BUILDER_ROLE_REQUIRED');
  reset role;
  if before_data is distinct from pg_temp.native83_snapshot() then raise exception 'DB4_83_OWNER_DENIAL_WROTE_DATA'; end if;
  set local role authenticated; set local request.jwt.claim.sub='83999999-9999-4999-8999-999999999999';
  response := projectceo_m4_api.submit_change_request(p,k,prior,'baseline:native83-baseline','release:native81-release',
    'Synthetic fixture replacement',10000,1,s,'native83-change');
  reset role;
  change_id := (response#>>'{result,id}')::uuid;
  if response#>>'{result,rootCount}' is distinct from '2'
    or response#>>'{result,initiatorRole}' is distinct from 'builder' then
    raise exception 'DB4_83_REPLACEMENT_ROOTS_INVALID:%',response;
  end if;
  insert into native83_impact values(change_id,null);
  perform pg_temp.native83_release_refused('native83-no-calculation');
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  set local role service_role;
  response := projectceo_m4_api.calculate_change_impact_policy_bound(p,change_id,s,'native83-impact');
  reset role;
  run_id := (response#>>'{result,id}')::uuid;
  update native83_impact set impact_run_id=run_id;
  policy := projectceo_m4._impact_policy();
  if not exists(select 1 from projectceo_m4.impact_runs r where r.project_id=p and r.impact_run_id=run_id
    and r.package_id=k and r.change_request_id=change_id and r.target_baseline_id='baseline:native83-baseline'
    and r.coverage_status='complete' and r.policy_version=policy->>'version'
    and r.max_depth=(policy->>'maxDepth')::integer and r.max_impacts=(policy->>'maxImpacts')::integer
    and r.returned_impact_count=2 and r.known_impact_count_lower_bound=2
    and not r.has_more_beyond_depth and r.cutoff_reason is null and r.superseded_at is null)
    or (select count(*) from projectceo_m4.impacts i where i.project_id=p and i.impact_run_id=run_id)<>2
    or exists(select 1 from projectceo_m4.impacts i where i.project_id=p and i.impact_run_id=run_id
      and (i.impacted_node_id<>'native83-deliverable' or i.distance<>1
        or i.changed_revision_id not in ('native81-intent-r2','native81-selection-r2'))) then
    raise exception 'DB4_83_POLICY_BOUND_COMPLETE_TWO_IMPACTS_REQUIRED:%',response;
  end if;
end $change_and_calculation$;

select pg_temp.native83_release_refused('native83-unreviewed-impact');

do $all_human_reviews$
declare p uuid := '41111111-1111-4111-8111-111111111111'; s bigint; impact record; response jsonb; reviewed integer:=0;
begin
  for impact in select i.impact_run_id,i.impact_id from projectceo_m4.impacts i
    join native83_impact f on f.impact_run_id=i.impact_run_id where i.project_id=p order by i.impact_id loop
    select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
    set local role authenticated; set local request.jwt.claim.sub='81888888-8888-4888-8888-888888888888';
    response := projectceo_m4_api.review_change_impact(p,impact.impact_run_id,impact.impact_id,'resolved',
      'Synthetic downstream dependency reviewed against replacement documentation',s,'native83-review-'||impact.impact_id);
    reset role;
    reviewed := reviewed+1;
    if reviewed=1 then
      if response#>'{result,impactReviewComplete}' is distinct from 'false'::jsonb then
        raise exception 'DB4_83_PARTIAL_REVIEW_REPORTED_COMPLETE';
      end if;
      perform pg_temp.native83_release_refused('native83-one-impact-unreviewed');
    end if;
  end loop;
  if reviewed<>2 or response#>'{result,impactReviewComplete}' is distinct from 'true'::jsonb
    or response#>'{result,allReturnedImpactsReviewed}' is distinct from 'true'::jsonb
    or response#>'{result,coverageComplete}' is distinct from 'true'::jsonb then
    raise exception 'DB4_83_COMPLETE_HUMAN_REVIEW_REQUIRED:%',response;
  end if;
end $all_human_reviews$;

do $second_new_release$
declare p uuid := '41111111-1111-4111-8111-111111111111'; k uuid := '81777777-7777-4777-8777-777777777777';
  context jsonb; response jsonb; replay jsonb; before_data jsonb; saved record; first_rows record; lineage record;
begin
  select * into strict saved from native_m3_fixture.published;
  select * into strict first_rows from native83_first;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  context := projectceo_m3_api.get_native_m3_release_context(p,k)->'data';
  response := projectceo_product_api.publish_native_m3_release_request_bound(p,k,context->>'baselineId',
    context->>'previousVersionId',(context->>'stateRevision')::bigint,context->>'contextDigest','native83-release','native83-release');
  reset role;
  if response->'replay' is distinct from 'false'::jsonb
    or response#>>'{result,id}' is distinct from 'release:native83-release'
    or response#>>'{result,previousVersionId}' is distinct from 'release:native81-release'
    or response#>>'{result,versionNo}' is distinct from '2'
    or response#>>'{result,packageId}' is distinct from k::text
    or not exists(select 1 from projectceo_product.production_package_versions v where v.project_id=p and v.package_id=k
      and v.production_package_version_id='release:native83-release' and v.version_no=2
      and v.previous_version_id='release:native81-release' and v.baseline_id='baseline:native83-baseline'
      and v.semantic_content#>'{exactRevisionRefs,decisions}'='["native81-intent-r2"]'::jsonb
      and v.semantic_content#>'{exactRevisionRefs,selections}'='["native81-selection-r2"]'::jsonb) then
    raise exception 'DB4_83_NEW_CHILD_VERSION_TWO_REQUIRED:%',response;
  end if;
  select * into strict lineage from projectceo_m3.production_package_native_contexts
    where project_id=p and production_package_version_id='release:native83-release';
  if lineage.package_id is distinct from k or lineage.context is distinct from context
    or lineage.context_digest is distinct from context->>'contextDigest'
    or lineage.context_digest is not distinct from saved.context->>'contextDigest'
    or lineage.created_by_user_id is distinct from '31111111-1111-4111-8111-111111111111'::uuid
    or lineage.context_digest is distinct from 'sha256:'||encode(project_intelligence._sha256_jsonb(context-'contextDigest'),'hex') then
    raise exception 'DB4_83_NEW_EXACT_CONTEXT_REQUIRED';
  end if;
  before_data := pg_temp.native83_snapshot();
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  replay := projectceo_product_api.publish_native_m3_release_request_bound(p,k,context->>'baselineId',
    context->>'previousVersionId',(context->>'stateRevision')::bigint,context->>'contextDigest','native83-release','native83-release');
  if replay is distinct from jsonb_set(response,'{replay}','true'::jsonb) then raise exception 'DB4_83_SECOND_REPLAY_INVALID'; end if;
  replay := projectceo_product_api.publish_native_m3_release_request_bound(p,k,saved.context->>'baselineId',
    saved.context->>'previousVersionId',(saved.context->>'stateRevision')::bigint,saved.context->>'contextDigest','native81-release','native81-release');
  reset role;
  if replay is distinct from jsonb_set(saved.response,'{replay}','true'::jsonb)
    or before_data is distinct from pg_temp.native83_snapshot() then raise exception 'DB4_83_REPLAYS_WROTE_DATA'; end if;
  perform pg_temp.native83_denied(format(
    'update projectceo_m3.production_package_native_contexts set context=context where project_id=%L and production_package_version_id=%L',
    p,'release:native83-release'),'55000');
  perform pg_temp.native83_denied(format(
    'delete from projectceo_m3.production_package_native_contexts where project_id=%L and production_package_version_id=%L',
    p,'release:native83-release'),'55000');
  if before_data is distinct from pg_temp.native83_snapshot()
    or (select to_jsonb(v) from projectceo_product.production_package_versions v
      where v.project_id=p and v.production_package_version_id='release:native81-release') is distinct from first_rows.release_row
    or (select to_jsonb(c) from projectceo_m3.production_package_native_contexts c
      where c.project_id=p and c.production_package_version_id='release:native81-release') is distinct from first_rows.context_row
    or (select jsonb_agg(to_jsonb(r) order by r.target_kind,r.ordinal) from projectceo_product.production_package_version_refs r
      where r.project_id=p and r.production_package_version_id='release:native81-release') is distinct from first_rows.refs then
    raise exception 'DB4_83_IMMUTABLE_RELEASE_HISTORY_CHANGED';
  end if;
  if (select count(*) from projectceo_product.production_package_versions v where v.project_id=p and v.package_id=k)<>2
    or (select count(*) from projectceo_m3.production_package_native_contexts c where c.project_id=p and c.package_id=k)<>2
    or (select count(*) from projectceo_product.command_records c where c.project_id=p
      and c.operation='publish_work_package_release_request_bound'
      and c.logical_result->>'id'='release:native83-release')<>1
    or (select count(*) from projectceo_product.command_records c where c.project_id=p
      and c.operation='publish_production_package_version'
      and c.logical_result->>'id'='release:native83-release')<>1
    or (select count(*) from projectceo_product.audit_events a where a.project_id=p
      and a.event_type='production_package_version_published'
      and a.controlled_metadata->>'production_package_version_id'='release:native83-release')<>1 then
    raise exception 'DB4_83_VERSION_COMMAND_OR_AUDIT_NOT_EXACTLY_ONCE';
  end if;
  insert into native_m3_fixture.second_release
    select context,response,f.change_request_id,f.impact_run_id,
      first_rows.release_row,first_rows.context_row,first_rows.refs from native83_impact f;
end $second_new_release$;

commit;
select 'DB4_NATIVE_M3_SECOND_CHILD_RELEASE_SYNTHETIC_SQL_OK' result;
