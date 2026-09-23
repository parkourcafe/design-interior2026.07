\set ON_ERROR_STOP on
\if :{?native_m3_runtime_fixture}
\else
  \set native_m3_runtime_fixture false
\endif

-- SYNTHETIC SQL evidence only: no HTTP/Auth acceptance or real project data.
-- Legacy Auth/source/area fixtures are reused. One new public.projects row is
-- a direct synthetic legacy business fixture for the empty-baseline case.
-- All new private domain rows use human RPCs. The child never substitutes root.
begin;

do $default_deny$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role','pi_human_executor','pi_worker_executor'] loop
    if has_function_privilege(r,'projectceo_m3_api.get_native_m3_release_context(uuid,uuid)','EXECUTE') then
      raise exception 'DB4_81_DEFAULT_EXECUTE_GRANTED:%',r;
    end if;
    execute format('set local role %I',r);
    begin
      perform projectceo_m3_api.get_native_m3_release_context(null,null);
      raise exception 'DB4_81_DEFAULT_CALL_ALLOWED:%',r;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end
$default_deny$;
grant execute on function projectceo_m3_api.get_native_m3_release_context(uuid,uuid) to authenticated;

-- Snapshot every private business table, including state, audit and command
-- ledgers. This catches updates as well as inserts on the read path.
create function pg_temp.native81_snapshot() returns jsonb language plpgsql as $$
declare t record; digest text; result jsonb := '{}'::jsonb;
begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('project_intelligence','projectceo_foundation','projectceo_product','projectceo_m3')
      and c.relkind='r' order by n.nspname,c.relname loop
    execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',t.nspname,t.relname) into digest;
    result := result || jsonb_build_object(t.nspname||'.'||t.relname,digest);
  end loop;
  return result;
end $$;

create function pg_temp.native81_denied(command text, expected text, reason text default null)
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
    raise exception 'DB4_81_EXPECTED_%_%, GOT_%:%',expected,reason,coalesce(actual,'success'),detail;
  end if;
end $$;

create function pg_temp.native81_release_refused(p uuid, k uuid, command text,
  expected text default 'P1111', reason text default 'NATIVE_M3_CONTEXT_INCOMPLETE')
returns void language plpgsql as $$
declare before_data jsonb; s bigint; b text; previous text;
begin
  before_data := pg_temp.native81_snapshot();
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  select baseline_id into b from projectceo_product.project_baselines
    where project_id=p and published_at is not null order by version_no desc limit 1;
  select production_package_version_id into previous from projectceo_product.production_package_versions
    where project_id=p and package_id=k order by version_no desc limit 1;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,coalesce(b,'baseline:missing'),previous,s,command,command),expected,reason);
  reset role;
  if before_data is distinct from pg_temp.native81_snapshot() then
    raise exception 'DB4_81_REFUSED_PUBLICATION_WROTE_DATA:%',command;
  end if;
end $$;

-- The existing disposable enable opens only the public request-bound door.
-- The native lineage and both underlying release primitives remain private.
do $publication_private_boundary$
declare r text; signature text; command text;
begin
  if not has_function_privilege('authenticated',
    'projectceo_product_api.publish_work_package_release_request_bound(uuid,uuid,text,text,bigint,text,text)','EXECUTE') then
    raise exception 'DB4_81_EXISTING_DISPOSABLE_RELEASE_ENABLE_BROKEN';
  end if;
  if not has_function_privilege('authenticated',
    'projectceo_product_api.publish_native_m3_release_request_bound(uuid,uuid,text,text,bigint,text,text,text)','EXECUTE') then
    raise exception 'DB4_81_NATIVE_CONFIRMATION_ENABLE_BROKEN';
  end if;
  if not exists(select 1 from pg_class where oid='projectceo_m3.production_package_native_contexts'::regclass
    and relrowsecurity and relforcerowsecurity) then
    raise exception 'DB4_81_NATIVE_LINEAGE_RLS_NOT_FORCED';
  end if;
  foreach r in array array['anon','authenticated','service_role','pi_human_executor','pi_worker_executor'] loop
    foreach signature in array array[
      'projectceo_product.publish_work_package_release_request_bound(uuid,uuid,text,text,bigint,text,text)',
      'projectceo_product_api.publish_production_package_version(uuid,jsonb,bigint,text)'
    ] loop
      if has_function_privilege(r,signature,'EXECUTE') then
        raise exception 'DB4_81_RAW_RELEASE_GRANTED:%:%',r,signature;
      end if;
    end loop;
    if has_table_privilege(r,'projectceo_m3.production_package_native_contexts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'DB4_81_NATIVE_LINEAGE_DIRECT_GRANT:%',r;
    end if;
    execute format('set local role %I',r);
    perform pg_temp.native81_denied(
      'select projectceo_product.publish_work_package_release_request_bound(null,null,null,null,null,null,null)','42501');
    perform pg_temp.native81_denied(
      'select projectceo_product_api.publish_production_package_version(null,null,null,null)','42501');
    if r <> 'authenticated' then
      perform pg_temp.native81_denied(
        'select projectceo_product_api.publish_work_package_release_request_bound(null,null,null,null,null,null,null)','42501');
      perform pg_temp.native81_denied(
        'select projectceo_product_api.publish_native_m3_release_request_bound(null,null,null,null,null,null,null,null)','42501');
    end if;
    foreach command in array array[
      'select * from projectceo_m3.production_package_native_contexts',
      'insert into projectceo_m3.production_package_native_contexts select * from projectceo_m3.production_package_native_contexts where false',
      'update projectceo_m3.production_package_native_contexts set context=context where false',
      'delete from projectceo_m3.production_package_native_contexts where false',
      'truncate projectceo_m3.production_package_native_contexts'
    ] loop
      perform pg_temp.native81_denied(command,'42501');
    end loop;
    reset role;
  end loop;
end $publication_private_boundary$;

create function pg_temp.native81_read(p uuid, k uuid, expected_codes text[], complete boolean default false)
returns jsonb language plpgsql as $$
declare before_data jsonb; first jsonb; second jsonb; org uuid; code text;
begin
  before_data := pg_temp.native81_snapshot();
  select organization_id into org from project_intelligence.project_workflows where project_id=p;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  first := projectceo_m3_api.get_native_m3_release_context(p,k);
  second := projectceo_m3_api.get_native_m3_release_context(p,k);
  reset role;
  if first->'data' is distinct from second->'data'
    or first#>>'{data,contextDigest}' !~ '^sha256:[0-9a-f]{64}$'
    or first#>>'{data,contextDigest}' is distinct from
      'sha256:'||encode(project_intelligence._sha256_jsonb((first->'data')-'contextDigest'),'hex')
    or first#>>'{data,schemaVersion}' is distinct from 'remhaos.native-m3-release-context/1'
    or first#>'{data,scope}' is distinct from jsonb_build_object('organizationId',org,'projectId',p,'packageId',k)
    or (first#>>'{data,structurallyComplete}')::boolean is distinct from complete
    or first->'error' is distinct from 'null'::jsonb
    or before_data is distinct from pg_temp.native81_snapshot() then
    raise exception 'DB4_81_READ_CONTRACT_OR_WRITE:%',first;
  end if;
  foreach code in array expected_codes loop
    if not exists(select 1 from jsonb_array_elements(first#>'{data,findings}') f where f->>'code'=code) then
      raise exception 'DB4_81_MISSING_FINDING:%:%',code,first;
    end if;
  end loop;
  if complete and first#>'{data,findings}' <> '[]'::jsonb then raise exception 'DB4_81_COMPLETE_WITH_FINDINGS'; end if;
  return first->'data';
end $$;

-- Explicit direct synthetic legacy business seed, used as enrollment input.
insert into auth.users(id,email,email_confirmed_at) values
 ('81888888-8888-4888-8888-888888888888','native81-architect@example.invalid',now());
insert into public.projects(id,designer_id,client_name,intake_token) values
 ('81555555-5555-4555-8555-555555555555','31111111-1111-4111-8111-111111111111','SYNTHETIC native M3 empty','synthetic-db4-native81');
do $enrollment$
begin
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_api.enroll_organization_project_scope(
    '81555555-5555-4555-8555-555555555555','81666666-6666-4666-8666-666666666666',
    'native81-empty','Synthetic empty child','[]'::jsonb,'native81-empty-enroll');
  perform projectceo_api.enroll_organization_project_scope(
    '41111111-1111-4111-8111-111111111111','81777777-7777-4777-8777-777777777777',
    'native81-child','Synthetic native child',
    '[{"userId":"32222222-2222-4222-8222-222222222222","role":"client_approver"},{"userId":"81888888-8888-4888-8888-888888888888","role":"architect"}]'::jsonb,'native81-child-enroll');
  reset role;
end $enrollment$;
select pg_temp.native81_read('81555555-5555-4555-8555-555555555555','81666666-6666-4666-8666-666666666666',array['BASELINE_REQUIRED','HANDOFF_REQUIRED']);
select pg_temp.native81_read('41111111-1111-4111-8111-111111111111','81777777-7777-4777-8777-777777777777',array['PACKAGE_NOT_IN_BASELINE','HANDOFF_REQUIRED']);
select pg_temp.native81_release_refused('41111111-1111-4111-8111-111111111111',
  '81777777-7777-4777-8777-777777777777','native81-no-handoff');

-- Harness 53 restores M3 open before this file. A context EXECUTE grant alone
-- must not bypass the shared gate, which follows this M3-only command grant.
do $module_gate_denied$
declare before_data jsonb;
begin
  if not projectceo_platform.m3_read_gate_open() then
    raise exception 'DB4_81_HARNESS_M3_GATE_NOT_OPEN';
  end if;
  before_data := pg_temp.native81_snapshot();
  revoke execute on function projectceo_m3_api.register_documentation_sheet(
    uuid,uuid,text,text,text,text,text,text,text[],text,bigint,text) from authenticated;
  if projectceo_platform.m3_read_gate_open() then
    raise exception 'DB4_81_REVOKED_COMMAND_DID_NOT_CLOSE_GATE';
  end if;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  begin
    perform projectceo_m3_api.get_native_m3_release_context(
      '41111111-1111-4111-8111-111111111111','81777777-7777-4777-8777-777777777777');
    raise exception 'DB4_81_CONTEXT_GRANT_BYPASSED_CLOSED_GATE';
  exception when sqlstate 'P1113' then null; end;
  reset role;
  perform pg_temp.native81_release_refused('41111111-1111-4111-8111-111111111111',
    '81777777-7777-4777-8777-777777777777','native81-closed-gate','P1113',null);
  grant execute on function projectceo_m3_api.register_documentation_sheet(
    uuid,uuid,text,text,text,text,text,text,text[],text,bigint,text) to authenticated;
  if not projectceo_platform.m3_read_gate_open()
    or before_data is distinct from pg_temp.native81_snapshot() then
    raise exception 'DB4_81_GATE_RESTORE_OR_READ_MUTATION';
  end if;
end $module_gate_denied$;

do $scope_denied$
begin
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  begin
    perform projectceo_m3_api.get_native_m3_release_context('41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111');
    raise exception 'DB4_81_ROOT_ALLOWED';
  exception when sqlstate 'P1109' then null; end;
  set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
  begin
    perform projectceo_m3_api.get_native_m3_release_context('41111111-1111-4111-8111-111111111111','81777777-7777-4777-8777-777777777777');
    raise exception 'DB4_81_OTHER_ACTOR_ALLOWED';
  exception when sqlstate 'P1103' then null; end;
  set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
  begin
    perform projectceo_m3_api.get_native_m3_release_context('81555555-5555-4555-8555-555555555555','81666666-6666-4666-8666-666666666666');
    raise exception 'DB4_81_UNGRANTED_PACKAGE_ALLOWED';
  exception when sqlstate 'P1103' then null; end;
  reset role;
end $scope_denied$;

do $native_child_lineage$
declare
  p uuid := '41111111-1111-4111-8111-111111111111';
  k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; result jsonb; evidence jsonb; content jsonb; base_content jsonb;
  variants jsonb := '[]'::jsonb; variant_role text; doc text; rid text; payload jsonb;
begin
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  select layout.payload->'layoutContent' into strict base_content from projectceo_product.m2_workspace_revisions layout
    where layout.project_id=p and layout.entity_kind='layout_version' order by layout.created_at,layout.revision_id limit 1;
  select jsonb_build_object('evidenceVersionId',evidence_version_id,'evidenceLinkId',evidence_link_id,
    'sourceId',source_id,'sourceNodeId',source_node_id,'sourceRevisionId',source_revision_id,'fragmentId',fragment_id)
    into strict evidence from projectceo_product.revision_evidence_refs
    where project_id=p order by claim_revision_id,evidence_link_id limit 1;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  result := projectceo_product_api.append_decision_revision(p,k,'native81-intent','native81-intent-r1',null,
    'human_origin','Synthetic design intent','Synthetic decision',null,'proposed','[]','Synthetic human intent',s,'native81-intent');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.append_selection_revision(p,k,'native81-selection','native81-selection-r1',null,
    'human_origin','Synthetic selection','node-area-db4','native81-intent-r1','{"material":"synthetic"}','[]','Synthetic selection',s,'native81-selection');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.append_price_observation(p,'native81-selection-r1','native81-price',125000,evidence,'synthetic:test',s,'native81-price');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.create_approval_package(p,k,'native81-approval',
    '[{"targetKind":"decision_revision","entityId":"native81-intent","revisionId":"native81-intent-r1"},{"targetKind":"selection_revision","entityId":"native81-selection","revisionId":"native81-selection-r1"}]',s,'native81-approval');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.submit_approval_package(p,'native81-approval','draft',s,'native81-submit-approval');
  s := (result->>'stateRevision')::bigint;
  set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
  result := projectceo_product_api.review_approval_package(p,'native81-approval','submitted','approved','Synthetic client approval',s,'native81-review-approval');
  s := (result->>'stateRevision')::bigint;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  foreach variant_role in array array['preferred','value_engineered','premium'] loop
    reset role;
    doc := 'native81-layout-'||variant_role; rid := doc||'-r1';
    content := jsonb_set(jsonb_set(jsonb_set(base_content,'{documentId}',to_jsonb(doc)),
      '{variant,id}',to_jsonb(doc||'-variant')),'{variant,status}','"published"');
    payload := jsonb_build_object('versionId',doc||'@1','roomId','native81-room','variantId',doc||'-variant',
      'role',variant_role,'semanticHash',projectceo_product._m2_layout_semantic_hash(content),
      'schemaVersion','project-ceo-m2-layout/0.1','layoutContent',content);
    set local role authenticated;
    result := projectceo_product_api.append_m2_workspace_revision(p,k,'layout_version',doc,rid,null,'published',payload,'Synthetic layout',s,doc);
    s := (result->>'stateRevision')::bigint;
    variants := variants || jsonb_build_array(jsonb_build_object('variantId',doc||'-variant','role',variant_role,
      'layoutDocumentId',doc,'layoutVersionId',doc||'@1','layoutRevisionId',rid,'semanticHash',payload->>'semanticHash',
      'selectionRevisionIds',jsonb_build_array('native81-selection-r1'),
      'budget',jsonb_build_object('amountRub',125000,'staleSelectionRevisionIds','[]'::jsonb,'missingPriceSelectionRevisionIds','[]'::jsonb)));
  end loop;
  result := projectceo_product_api.submit_m2_client_review(p,k,'native81-submission','native81-submission-r1',null,
    'native81-approval','native81-room','native81-intent-r1',variants,
    to_char(statement_timestamp()+interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS"Z"'),30,'Synthetic client submission',s,'native81-submission');
  s := (result->>'stateRevision')::bigint;
  set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
  result := projectceo_product_api.review_m2_client_submission(p,k,'native81-submission','native81-review-r1',
    'native81-submission-r1','native81-layout-preferred-variant','approved','Synthetic client review',s,'native81-review');
  -- Review appends multiple ledger entries; refresh authoritative state outside
  -- the human role instead of guessing the number of increments.
  reset role;
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_product_api.publish_m2_m3_handoff(p,k,'native81-handoff','native81-handoff-r1',null,
    'approved-native81-submission','native81-review-r1','Synthetic exact handoff',s,'native81-handoff');
  reset role;
end $native_child_lineage$;

select pg_temp.native81_read('41111111-1111-4111-8111-111111111111','81777777-7777-4777-8777-777777777777',
  array['ROOM_WITHOUT_SHEET','SPECIFICATION_NOT_COVERED','HANDOFF_SELECTION_NOT_IN_BASELINE','HANDOFF_DESIGN_INTENT_NOT_IN_BASELINE']);
select pg_temp.native81_release_refused('41111111-1111-4111-8111-111111111111',
  '81777777-7777-4777-8777-777777777777','native81-no-sheet');

do $sheet_and_baseline$
declare p uuid := '41111111-1111-4111-8111-111111111111'; k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; v text; b text; result jsonb;
begin
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_m3_api.register_documentation_sheet(p,k,'native81-handoff','native81-handoff-r1',
    'native81-sheet','N-81','Synthetic sheet','native81-sheet-r1',array[]::text[],'Synthetic registration',s,'native81-sheet');
  reset role;
  result := pg_temp.native81_read(p,k,array['SPECIFICATION_NOT_COVERED']);
  if exists(select 1 from jsonb_array_elements(result->'findings') f where f->>'code'='ROOM_WITHOUT_SHEET') then
    raise exception 'DB4_81_REGISTERED_ROOM_NOT_COVERED'; end if;
  perform pg_temp.native81_release_refused(p,k,'native81-partial-sheet');
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_m3_api.attach_documentation_sheet_specifications(p,k,'native81-sheet','native81-sheet-r2','native81-sheet-r1',
    array['native81-selection-r1'],'Synthetic specification attachment',s,'native81-attach');
  reset role;
  perform pg_temp.native81_read(p,k,array['HANDOFF_SELECTION_NOT_IN_BASELINE']);
  perform pg_temp.native81_release_refused(p,k,'native81-old-baseline');
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_api.register_source_inventory(p,
    jsonb_build_array(jsonb_build_object(
      'physicalRecordId','81eeeeee-1111-4111-8111-111111111111',
      'sanitizedName','native81-package-source.pdf',
      'hierarchy',jsonb_build_object('projectId',p,'packageId',k,
        'floorId','floor-db4','zoneId','zone-db4','disciplineId','architecture'),
      'availability','materialized','documentStatus','current','sizeBytes',2048,
      'checksum',repeat('b',64),'sourceRevisionId','revision-source-1','semanticConflict',false)),
    jsonb_build_object('projectId',p,'entries',jsonb_build_array(),'exactHashGroups',jsonb_build_array()),
    s,'native81-materialization');
  reset role;
  -- Scenario 54 deliberately leaves root decision r2 current while only r1 is
  -- approved. Atomic baseline includes all project approvals; approve that
  -- synthetic revision through the normal human doors within this rollback.
  -- Publishing a graph snapshot alone cannot repair a superseded approval.
  if not exists(select 1 from project_intelligence.graph_nodes n
    where n.project_id=p and n.node_id='node-decision-54'
      and n.current_revision_id='revision-decision-54-r2') then
    raise exception 'DB4_81_SCENARIO54_PRECONDITION_CHANGED';
  end if;
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  result := projectceo_product_api.create_approval_package(p,p,'native81-current-54',
    '[{"targetKind":"decision_revision","entityId":"node-decision-54","revisionId":"revision-decision-54-r2"}]',s,'native81-current-54');
  s := (result->>'stateRevision')::bigint;
  result := projectceo_product_api.submit_approval_package(p,'native81-current-54','draft',s,'native81-submit-current-54');
  s := (result->>'stateRevision')::bigint;
  set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
  perform projectceo_product_api.review_approval_package(p,'native81-current-54','submitted','approved',
    'Synthetic approval of current scenario 54 revision',s,'native81-review-current-54');
  reset role;
  select state_revision,latest_version_id into s,v from project_intelligence.project_workflows where project_id=p;
  select baseline_id into b from projectceo_product.project_baselines where project_id=p order by version_no desc limit 1;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_product_api.publish_baseline_atomic(p,v,b,s,'native81-baseline','native81-baseline');
  reset role;
  result := pg_temp.native81_read(p,k,array[]::text[],true);
  if jsonb_array_length(result->'handoffs')<>1 or jsonb_array_length(result->'sheets')<>1
     or result#>>'{sheets,0,revisionId}'<>'native81-sheet-r2'
     or result->'baselineSelectionRevisionIds'<>'["native81-selection-r1"]'::jsonb
     or result->'baselineDecisionRevisionIds'<>'["native81-intent-r1"]'::jsonb then
    raise exception 'DB4_81_CHILD_CONTEXT_LEAK_OR_LATEST_REVISION:%',result;
  end if;
end $sheet_and_baseline$;

-- Retain the exact prepublication context as test evidence for later replay
-- after newer human revisions make the live context incomplete.
create temporary table native81_published(context jsonb not null, response jsonb not null);
do $native_publication$
declare
  p uuid := '41111111-1111-4111-8111-111111111111';
  k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; b text; previous text; observed jsonb; first jsonb; replay jsonb;
  before_data jsonb; lineage record; sources jsonb; keys text[];
begin
  observed := pg_temp.native81_read(p,k,array[]::text[],true);
  s := (observed->>'stateRevision')::bigint;
  b := observed->>'baselineId'; previous := observed->>'previousVersionId';
  if previous is not null then raise exception 'DB4_81_FIRST_NATIVE_RELEASE_EXPECTED'; end if;
  before_data := pg_temp.native81_snapshot();
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,b,previous,s-1,'native81-stale-state','native81-stale-state'),'P1107');
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,'baseline:obsolete',previous,s,'native81-stale-baseline','native81-stale-baseline'),'P1107');
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,b,'release:obsolete',s,'native81-stale-previous','native81-stale-previous'),'P1107');
  set local request.jwt.claim.sub='';
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,b,previous,s,'native81-no-actor','native81-no-actor'),'P1101');
  set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,b,previous,s,'native81-other-org','native81-other-org'),'P1103');
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,p,b,previous,s,'native81-root-release','native81-root-release'),'P1109','WORK_PACKAGE_REQUIRED');
  reset role;
  if before_data is distinct from pg_temp.native81_snapshot() then
    raise exception 'DB4_81_STALE_OR_UNAUTHORIZED_RELEASE_WROTE_DATA';
  end if;

  -- M3 publication requires the internal read gate, but granting the separate
  -- public read RPC is not a prerequisite for a definer to obtain its context.
  revoke execute on function projectceo_m3_api.get_native_m3_release_context(uuid,uuid) from authenticated;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  first := projectceo_product_api.publish_native_m3_release_request_bound(
    p,k,b,previous,s,observed->>'contextDigest','native81-release','native81-release');
  reset role;
  grant execute on function projectceo_m3_api.get_native_m3_release_context(uuid,uuid) to authenticated;
  select array_agg(key order by key) into keys from jsonb_object_keys(first) key;
  if keys is distinct from array['operation','replay','result','stateRevision']
    or first->>'operation' is distinct from 'publish_work_package_release_request_bound'
    or first->>'replay' is distinct from 'false'
    or first#>>'{result,id}' is distinct from 'release:native81-release'
    or (first->>'stateRevision')::bigint <= s then
    raise exception 'DB4_81_PUBLICATION_ENVELOPE_CHANGED:%',first;
  end if;
  select * into strict lineage from projectceo_m3.production_package_native_contexts
    where project_id=p and production_package_version_id=first#>>'{result,id}';
  if lineage.organization_id::text is distinct from observed#>>'{scope,organizationId}'
    or lineage.package_id is distinct from k
    or lineage.context is distinct from observed
    or lineage.context_digest is distinct from observed->>'contextDigest'
    or lineage.context_digest is distinct from 'sha256:'||encode(project_intelligence._sha256_jsonb(lineage.context-'contextDigest'),'hex')
    or lineage.created_by_user_id is distinct from '31111111-1111-4111-8111-111111111111'::uuid
    or lineage.created_at is null then
    raise exception 'DB4_81_NATIVE_PUBLICATION_LINEAGE_MISMATCH';
  end if;
  if not exists(select 1 from projectceo_product.production_package_versions v
    where v.organization_id=lineage.organization_id and v.project_id=p and v.package_id=k
      and v.production_package_version_id=first#>>'{result,id}' and v.baseline_id=b) then
    raise exception 'DB4_81_NATIVE_VERSION_SCOPE_MISMATCH';
  end if;
  select coalesce(jsonb_agg(revision_id order by ordinal),'[]'::jsonb) into sources
    from projectceo_product.production_package_version_refs
    where project_id=p and production_package_version_id=first#>>'{result,id}' and target_kind='source_revision';
  if sources <> '["revision-source-1"]'::jsonb or exists (
    select 1 from projectceo_product.production_package_version_refs r
    where r.project_id=p and r.production_package_version_id=first#>>'{result,id}' and r.target_kind='source_revision'
      and not exists(select 1 from projectceo_foundation.source_materializations m
        where m.organization_id=r.organization_id and m.project_id=p and m.package_id=k and m.source_revision_id=r.revision_id)
  ) then raise exception 'DB4_81_NATIVE_SOURCE_SCOPE_NOT_STRICT'; end if;
  if not exists(select 1 from projectceo_product.command_records c
    where c.project_id=p and c.operation='publish_work_package_release_request_bound'
      and c.logical_result=first->'result' and c.actor_user_id=lineage.created_by_user_id
      and c.resulting_state_revision=(first->>'stateRevision')::bigint) then
    raise exception 'DB4_81_NATIVE_RELEASE_COMMAND_RECORD_MISSING';
  end if;

  -- The no-digest public compatibility signature is replay-only after this
  -- migration. Its attempted fresh write must roll back completely.
  before_data := pg_temp.native81_snapshot();
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  select production_package_version_id into previous from projectceo_product.production_package_versions
    where project_id=p and package_id=k order by version_no desc limit 1;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,b,previous,s,'native81-generic-fresh','native81-generic-fresh'),
    'P1111','NATIVE_CONTEXT_CONFIRMATION_REQUIRED');
  reset role;
  if before_data is distinct from pg_temp.native81_snapshot() then
    raise exception 'DB4_81_GENERIC_FRESH_CONFIRMATION_REFUSAL_WROTE_DATA';
  end if;

  before_data := pg_temp.native81_snapshot();
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  replay := projectceo_product_api.publish_native_m3_release_request_bound(
    p,k,b,previous,s,observed->>'contextDigest','native81-release','native81-release');
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_native_m3_release_request_bound(%L,%L,%L,%L,%L,%L,%L,%L)',
    p,k,b,previous,s,'sha256:'||repeat('0',64),'native81-release','native81-release'),
    'P1108','NATIVE_CONTEXT_DIGEST_MISMATCH');
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,b,previous,s,'native81-different-command','native81-release'),'P1108');
  -- This actor has its own legitimate architect membership in the same child;
  -- a generic authorization denial would not prove actor-bound idempotency.
  set local request.jwt.claim.sub='81888888-8888-4888-8888-888888888888';
  perform projectceo_m3_api.get_native_m3_release_context(p,k);
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    p,k,b,previous,s,'native81-release','native81-release'),'P1103','IDEMPOTENCY_ACTOR_MISMATCH');
  reset role;
  if replay is distinct from jsonb_set(first,'{replay}','true'::jsonb)
    or before_data is distinct from pg_temp.native81_snapshot() then
    raise exception 'DB4_81_NATIVE_REPLAY_CHANGED_DATA_OR_ENVELOPE';
  end if;
  perform pg_temp.native81_denied(format(
    'update projectceo_m3.production_package_native_contexts set context=context where project_id=%L and production_package_version_id=%L',
    p,first#>>'{result,id}'),'55000');
  perform pg_temp.native81_denied(format(
    'delete from projectceo_m3.production_package_native_contexts where project_id=%L and production_package_version_id=%L',
    p,first#>>'{result,id}'),'55000');
  if before_data is distinct from pg_temp.native81_snapshot() then raise exception 'DB4_81_NATIVE_LINEAGE_MUTATED'; end if;
  insert into native81_published values(observed,first);
end $native_publication$;

do $native_delivery_projection$
declare
  p uuid := '41111111-1111-4111-8111-111111111111';
  k uuid := '81777777-7777-4777-8777-777777777777';
  actor text; delivery jsonb; before_data jsonb;
begin
  -- Root versions and artifacts must exist for the isolation check to be meaningful.
  if not exists(select 1 from projectceo_product.production_package_versions where project_id=p and package_id=p)
    or not exists(select 1 from projectceo_product.release_artifacts where project_id=p and package_id=p) then
    raise exception 'DB4_81_ROOT_DELIVERY_FIXTURE_MISSING';
  end if;
  before_data := pg_temp.native81_snapshot();
  foreach actor in array array['31111111-1111-4111-8111-111111111111','81888888-8888-4888-8888-888888888888'] loop
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',actor,true);
    delivery := projectceo_api.get_project_delivery(p,k);
    reset role;
    if delivery->'error' is distinct from 'null'::jsonb
      or delivery#>>'{data,projectId}' is distinct from p::text
      or delivery#>>'{data,package,id}' is distinct from k::text
      or jsonb_array_length(delivery#>'{data,packageVersions}') is distinct from 1
      or delivery#>>'{data,packageVersions,0,id}' is distinct from 'release:native81-release'
      or delivery#>>'{data,packageVersions,0,packageId}' is distinct from k::text
      or delivery#>'{data,releaseArtifacts}' is distinct from '[]'::jsonb
      or delivery#>'{data,distributions}' is distinct from '[]'::jsonb
      or delivery#>'{data,acknowledgements}' is distinct from '[]'::jsonb then
      raise exception 'DB4_81_NATIVE_DELIVERY_SCOPE_LEAK:%:%',actor,delivery;
    end if;
  end loop;
  if before_data is distinct from pg_temp.native81_snapshot() then
    raise exception 'DB4_81_NATIVE_DELIVERY_READ_WROTE_DATA';
  end if;
end $native_delivery_projection$;

do $exact_handoff_and_duplicates$
declare p uuid := '41111111-1111-4111-8111-111111111111'; k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; result jsonb;
begin
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  -- A second identity with the same commit must have its OWN sheet coverage.
  perform projectceo_product_api.publish_m2_m3_handoff(p,k,'native81-parallel','native81-parallel-r1',null,
    'approved-native81-submission','native81-review-r1','Synthetic parallel handoff',s,'native81-parallel');
  reset role;
  perform pg_temp.native81_read(p,k,array['ROOM_WITHOUT_SHEET','SPECIFICATION_NOT_COVERED']);
  perform pg_temp.native81_release_refused(p,k,'native81-uncovered-second-handoff');
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  begin
    perform projectceo_m3_api.register_documentation_sheet(p,k,'native81-parallel','native81-parallel-r1',
      'native81-duplicate','N-81','Synthetic duplicate','native81-duplicate-r1',array[]::text[],'Synthetic duplicate denied',s,'native81-duplicate');
    raise exception 'DB4_81_DUPLICATE_NUMBER_ALLOWED';
  exception when sqlstate 'P1111' then null; end;
  begin
    perform projectceo_m3_api.register_documentation_sheet(p,k,'native81-parallel','native81-handoff-r1',
      'native81-mismatch','N-83','Synthetic mismatch','native81-mismatch-r1',array[]::text[],'Synthetic mismatch denied',s,'native81-mismatch');
    raise exception 'DB4_81_EXACT_HANDOFF_MISMATCH_ALLOWED';
  exception when sqlstate 'P1111' then null; end;
  perform projectceo_m3_api.register_documentation_sheet(p,k,'native81-parallel','native81-parallel-r1',
    'native81-parallel-sheet','N-82','Synthetic parallel sheet','native81-parallel-sheet-r1',array['native81-selection-r1'],'Synthetic parallel covered',s,'native81-parallel-sheet');
  reset role;
  perform pg_temp.native81_read(p,k,array[]::text[],true);
  select state_revision into s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_product_api.publish_m2_m3_handoff(p,k,'native81-handoff','native81-handoff-r2','native81-handoff-r1',
    'approved-native81-submission','native81-review-r1','Synthetic handoff superseded',s,'native81-handoff-r2');
  reset role;
  result := pg_temp.native81_read(p,k,array['ROOM_WITHOUT_SHEET','SPECIFICATION_NOT_COVERED']);
  if jsonb_array_length(result->'handoffs')<>2 then raise exception 'DB4_81_HANDOFF_LATEST_NOT_SELECTED'; end if;
  if exists(select 1 from jsonb_array_elements(result->'findings') f where f->>'code'='SHEET_FROM_OTHER_HANDOFF')
    or exists(select 1 from jsonb_array_elements(result->'sheets') sheet where sheet->>'sheetId'='native81-sheet') then
    raise exception 'DB4_81_VALID_SUPERSEDED_SHEET_BLOCKS_CURRENT_CONTEXT';
  end if;
  perform pg_temp.native81_release_refused(p,k,'native81-superseded-handoff');
end $exact_handoff_and_duplicates$;

do $replay_after_context_change$
declare saved record; before_data jsonb; replay jsonb;
begin
  select * into strict saved from native81_published;
  before_data := pg_temp.native81_snapshot();
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform pg_temp.native81_denied(format(
    'select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    saved.context#>>'{scope,projectId}',saved.context#>>'{scope,packageId}',
    saved.context->>'baselineId',saved.context->>'previousVersionId',
    saved.context->>'stateRevision','native81-obsolete-context','native81-obsolete-context'),'P1107');
  replay := projectceo_product_api.publish_native_m3_release_request_bound(
    (saved.context#>>'{scope,projectId}')::uuid,(saved.context#>>'{scope,packageId}')::uuid,
    saved.context->>'baselineId',saved.context->>'previousVersionId',
    (saved.context->>'stateRevision')::bigint,saved.context->>'contextDigest','native81-release','native81-release');
  reset role;
  if replay is distinct from jsonb_set(saved.response,'{replay}','true'::jsonb)
    or before_data is distinct from pg_temp.native81_snapshot()
    or (select context from projectceo_m3.production_package_native_contexts
      where production_package_version_id='release:native81-release'
        and project_id='41111111-1111-4111-8111-111111111111') is distinct from saved.context then
    raise exception 'DB4_81_REPLAY_RECOMPUTED_OR_REWROTE_NATIVE_CONTEXT';
  end if;
end $replay_after_context_change$;

do $replacement_sheet_restores_completeness$
declare
  p uuid := '41111111-1111-4111-8111-111111111111';
  k uuid := '81777777-7777-4777-8777-777777777777';
  s bigint; current_context jsonb; saved record; before_data jsonb; replay jsonb;
begin
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_m3_api.register_documentation_sheet(p,k,'native81-handoff','native81-handoff-r2',
    'native81-current-sheet','N-83','Synthetic replacement sheet','native81-current-sheet-r1',
    array['native81-selection-r1'],'Synthetic current handoff coverage',s,'native81-current-sheet');
  reset role;
  current_context := pg_temp.native81_read(p,k,array[]::text[],true);
  if jsonb_array_length(current_context->'handoffs')<>2
    or jsonb_array_length(current_context->'sheets')<>2
    or not exists(select 1 from jsonb_array_elements(current_context->'sheets') sheet
      where sheet->>'sheetId'='native81-current-sheet'
        and sheet#>>'{origin,handoffRevisionId}'='native81-handoff-r2')
    or exists(select 1 from jsonb_array_elements(current_context->'sheets') sheet where sheet->>'sheetId'='native81-sheet')
    or not exists(select 1 from projectceo_m3.documentation_sheet_revisions
      where project_id=p and package_id=k and sheet_id='native81-sheet' and revision_id='native81-sheet-r2') then
    raise exception 'DB4_81_REPLACEMENT_SHEET_CONTEXT_OR_HISTORY_CHANGED';
  end if;
  select * into strict saved from native81_published;
  before_data := pg_temp.native81_snapshot();
  set local role authenticated; set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  replay := projectceo_product_api.publish_native_m3_release_request_bound(p,k,
    saved.context->>'baselineId',saved.context->>'previousVersionId',
    (saved.context->>'stateRevision')::bigint,saved.context->>'contextDigest','native81-release','native81-release');
  reset role;
  if replay is distinct from jsonb_set(saved.response,'{replay}','true'::jsonb)
    or before_data is distinct from pg_temp.native81_snapshot()
    or (select context from projectceo_m3.production_package_native_contexts
      where project_id=p and production_package_version_id='release:native81-release') is distinct from saved.context then
    raise exception 'DB4_81_REPAIRED_CONTEXT_CHANGED_HISTORICAL_RELEASE';
  end if;
end $replacement_sheet_restores_completeness$;

-- Coverage boundaries: corrupt persisted provenance and duplicate-number rows
-- cannot be produced through the human APIs (server-derived origin + immutable
-- number registry). Their refusal is tested, not private-table corruption.
-- Distinct-room geometry, HTTP/Auth, concurrency and restart are not this SQL
-- fixture's evidence. Default runs roll back. The separately selected native
-- runtime mode persists this synthetic fixture ONLY in the owned DB4 container
-- for real second-session/restart tests; it is not an external project receipt.
\if :native_m3_runtime_fixture
do $owned_fixture_database$
begin
  if current_database() <> 'pi_db4' then raise exception 'NATIVE_FIXTURE_DATABASE_REJECTED'; end if;
end $owned_fixture_database$;
create schema native_m3_fixture;
revoke all on schema native_m3_fixture from public,anon,authenticated,service_role;
create table native_m3_fixture.published as select context,response from native81_published;
revoke all on table native_m3_fixture.published from public,anon,authenticated,service_role;
commit;
select 'DB4_NATIVE_M3_DURABLE_SYNTHETIC_FIXTURE_READY' result;
\else
rollback;
do $grant_rolled_back$
begin
  if has_function_privilege('authenticated','projectceo_m3_api.get_native_m3_release_context(uuid,uuid)','EXECUTE') then
    raise exception 'DB4_81_TEST_GRANT_ESCAPED_TRANSACTION';
  end if;
end $grant_rolled_back$;
\endif
select 'DB4_NATIVE_M3_RELEASE_CONTEXT_SYNTHETIC_SQL_OK' result;
