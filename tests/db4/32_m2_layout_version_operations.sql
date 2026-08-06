\set ON_ERROR_STOP on

-- Behavioral DB boundary for immutable M2 LayoutDocument publication.
-- Runs after 31 so Approved Commit lineage and read-v5 coexist in one project.

select state_revision as state_revision,
  jsonb_build_object(
    'contractVersion', 'archidom.layout-document/0.1',
    'documentId', 'layout-document-db4-secondary',
    'projectId', '41111111-1111-4111-8111-111111111111',
    'name', 'Кухня-гостиная · Value engineered',
    'canonicalUnits', 'mm', 'stateRevision', 18,
    'floor', jsonb_build_object(
      'id', 'floor-db4-secondary', 'label', 'Этаж 1',
      'elevationMm', 0, 'clearHeightMm', 3100
    ),
    'variant', jsonb_build_object(
      'id', 'db4-variant-value', 'label', 'Value engineered',
      'status', 'published'
    ),
    'nodes', jsonb_build_array(
      jsonb_build_object('id','node-a','xMm',0,'yMm',0,'locked',false),
      jsonb_build_object('id','node-b','xMm',5000,'yMm',0,'locked',false)
    ),
    'walls', jsonb_build_array(jsonb_build_object(
      'id','wall-a','startNodeId','node-a','endNodeId','node-b',
      'thicknessMm',150,'heightMm',3100,'kind','partition','locked',false
    )),
    'openings', jsonb_build_array(jsonb_build_object(
      'id','opening-a','parentWallId','wall-a','offsetMm',900,
      'widthMm',1000,'heightMm',2200,'sillMm',0,'kind','door','locked',false
    )),
    'columns', '[]'::jsonb, 'objects', '[]'::jsonb,
    'clearanceZones', '[]'::jsonb, 'materials', '[]'::jsonb,
    'materialAssignments', '[]'::jsonb, 'lights', '[]'::jsonb,
    'metadata', jsonb_build_object(
      'sourceRefs', jsonb_build_array('source:external-package-r1'),
      'warnings', '[]'::jsonb
    )
  ) as layout_content
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db4_layout2_

select projectceo_product._m2_layout_semantic_hash(
  :'db4_layout2_layout_content'::jsonb
) as semantic_hash,
projectceo_product._m2_layout_semantic_hash(jsonb_set(
  :'db4_layout2_layout_content'::jsonb,
  '{documentId}', '"layout-document-db4-version-reuse"'::jsonb
)) as version_reuse_hash
\gset db4_layout2_

-- Fixed TS↔DB canonical vector: punctuation/case/Unicode code-point ordering,
-- recursive ephemeral removal, and both JavaScript safe-integer thresholds.
do $canonical_parity$
declare
  v_document jsonb := jsonb_build_object(
    'contractVersion','archidom.layout-document/0.1',
    'documentId','document.canonical-parity',
    'projectId','project.canonical-parity',
    'name','Canonical parity vector','canonicalUnits','mm','stateRevision',42,
    'floor',jsonb_build_object('id','floor.canonical-parity','label','Floor',
      'elevationMm',-9007199254740991,'clearHeightMm',9007199254740991,
      'session',jsonb_build_object('selected',true)),
    'variant',jsonb_build_object('id','variant.canonical-parity','label','Variant','status','draft'),
    'nodes',jsonb_build_array(
      jsonb_build_object('id',U&'\+010000.astral','xMm',0,'yMm',9007199254740991,'locked',false,
        'nested',jsonb_build_object('retained',jsonb_build_object('threshold',6),'stateRevision',906,'updatedAt','2099-01-07T00:00:00.000Z','selection',jsonb_build_object('entityId',U&'\+010000.astral'),'session',jsonb_build_object('zoom',7))),
      jsonb_build_object('id','a.lower','xMm',0,'yMm',1,'locked',false,
        'nested',jsonb_build_object('retained',jsonb_build_object('threshold',4),'stateRevision',904,'updatedAt','2099-01-05T00:00:00.000Z','selection',jsonb_build_object('entityId','a.lower'),'session',jsonb_build_object('zoom',5))),
      jsonb_build_object('id','-dash','xMm',-9007199254740991,'yMm',1,'locked',false,
        'nested',jsonb_build_object('retained',jsonb_build_object('threshold',0),'stateRevision',900,'updatedAt','2099-01-01T00:00:00.000Z','selection',jsonb_build_object('entityId','-dash'),'session',jsonb_build_object('zoom',1))),
      jsonb_build_object('id',U&'\E000.bmp','xMm',0,'yMm',1,'locked',false,
        'nested',jsonb_build_object('retained',jsonb_build_object('threshold',5),'stateRevision',905,'updatedAt','2099-01-06T00:00:00.000Z','selection',jsonb_build_object('entityId',U&'\E000.bmp'),'session',jsonb_build_object('zoom',6))),
      jsonb_build_object('id','_under','xMm',0,'yMm',1,'locked',false,
        'nested',jsonb_build_object('retained',jsonb_build_object('threshold',3),'stateRevision',903,'updatedAt','2099-01-04T00:00:00.000Z','selection',jsonb_build_object('entityId','_under'),'session',jsonb_build_object('zoom',4))),
      jsonb_build_object('id','A.upper','xMm',0,'yMm',1,'locked',false,
        'nested',jsonb_build_object('retained',jsonb_build_object('threshold',2),'stateRevision',902,'updatedAt','2099-01-03T00:00:00.000Z','selection',jsonb_build_object('entityId','A.upper'),'session',jsonb_build_object('zoom',3))),
      jsonb_build_object('id','.dot','xMm',0,'yMm',1,'locked',false,
        'nested',jsonb_build_object('retained',jsonb_build_object('threshold',1),'stateRevision',901,'updatedAt','2099-01-02T00:00:00.000Z','selection',jsonb_build_object('entityId','.dot'),'session',jsonb_build_object('zoom',2)))
    ),
    'walls','[]'::jsonb,'openings','[]'::jsonb,'columns','[]'::jsonb,
    'objects','[]'::jsonb,'clearanceZones','[]'::jsonb,'materials','[]'::jsonb,
    'materialAssignments','[]'::jsonb,'lights','[]'::jsonb,
    'metadata',jsonb_build_object('sourceRefs',jsonb_build_array('contract:sql-c-collation-parity'),
      'warnings','[]'::jsonb,'retained',jsonb_build_object('minimumSafeInteger',-9007199254740991,'zero',0,'maximumSafeInteger',9007199254740991),
      'stateRevision',7,'session',jsonb_build_object('locale','ru-RU')),
    'updatedAt','2099-12-31T23:59:59.999Z',
    'selection',jsonb_build_object('entityId','-dash'),
    'session',jsonb_build_object('locale','en-US')
  );
begin
  if projectceo_product._m2_layout_semantic_hash(v_document)
     <> 'sha256:aecdc32fe4b6e5b920e53d4244c94832f1490cc2cf0935d2f134217b80f472d0' then
    raise exception 'DB4_LAYOUT_TS_DB_CANONICAL_PARITY';
  end if;
end
$canonical_parity$;

-- Direct authenticated RPC must accept the exact valid envelope and persist
-- server-derived actor/organization/audit metadata.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'layout_version', 'layout-document-db4-secondary',
  'layout-document-db4-secondary-revision-r1', null, 'published',
  jsonb_build_object(
    'versionId','layout-version-db4-secondary-r1','roomId','db4-room',
    'variantId','db4-variant-value','role','value_engineered',
    'semanticHash',:'db4_layout2_semantic_hash',
    'schemaVersion','project-ceo-m2-layout/0.1',
    'layoutContent',:'db4_layout2_layout_content'::jsonb
  ), 'DB4 valid exact layout publication', :'db4_layout2_state_revision'::bigint,
  'db4-layout-secondary-r1'
);
commit;

do $layout_storage_audit$
begin
  if not exists (
    select 1 from projectceo_product.m2_workspace_revisions revision
    where revision.entity_kind='layout_version'
      and revision.entity_id='layout-document-db4-secondary'
      and revision.payload->>'versionId'='layout-version-db4-secondary-r1'
      and revision.created_by_user_id='32222222-2222-4222-8222-222222222222'
  ) or not exists (
    select 1 from projectceo_product.audit_events event
    where event.event_type='m2_layout_version_revision_appended'
      and event.controlled_metadata->>'entity_id'='layout-document-db4-secondary'
  ) then raise exception 'DB4_LAYOUT_STORAGE_AUDIT'; end if;
end
$layout_storage_audit$;

-- Publish a second immutable revision of the same document. Read v5 is a
-- version-history contract, so both r1 and r2 must remain visible with exact
-- revisionId/versionId identity rather than collapsing to the latest row.
select state_revision as state_revision,
  jsonb_set(
    :'db4_layout2_layout_content'::jsonb,
    '{stateRevision}', '19'::jsonb
  ) as layout_content
from project_intelligence.project_workflows
where project_id='41111111-1111-4111-8111-111111111111'
\gset db4_layout2_r2_

select projectceo_product._m2_layout_semantic_hash(
  :'db4_layout2_r2_layout_content'::jsonb
) as semantic_hash
\gset db4_layout2_r2_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
select projectceo_product_api.append_m2_workspace_revision(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'layout_version', 'layout-document-db4-secondary',
  'layout-document-db4-secondary-revision-r2',
  'layout-document-db4-secondary-revision-r1', 'published',
  jsonb_build_object(
    'versionId','layout-version-db4-secondary-r2','roomId','db4-room',
    'variantId','db4-variant-value','role','value_engineered',
    'semanticHash',:'db4_layout2_r2_semantic_hash',
    'schemaVersion','project-ceo-m2-layout/0.1',
    'layoutContent',:'db4_layout2_r2_layout_content'::jsonb
  ), 'DB4 immutable layout history revision two',
  :'db4_layout2_r2_state_revision'::bigint, 'db4-layout-secondary-r2'
);
commit;

select state_revision as state_revision
from project_intelligence.project_workflows
where project_id='41111111-1111-4111-8111-111111111111'
\gset db4_layout_negative_

-- psql variables are not expanded inside dollar-quoted DO bodies. Preserve the
-- exact test inputs as session-local settings before entering authenticated
-- role so the negative loop exercises the public RPC rather than parser quirks.
select set_config(
  'projectceo.db4_layout_negative_content',
  :'db4_layout2_layout_content', false
);
select set_config(
  'projectceo.db4_layout_version_reuse_hash',
  :'db4_layout2_version_reuse_hash', false
);
select set_config(
  'projectceo.db4_layout_negative_state_revision',
  :'db4_layout_negative_state_revision', false
);

-- Malformed, unknown-field, wrong-type, broken-reference, impossible geometry,
-- excessive-depth/value/entity-count and version-id reuse all fail closed at
-- the direct RPC boundary. Every attempt is caught inside one rolled-back txn.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $layout_negatives$
declare
  v_base jsonb := current_setting(
    'projectceo.db4_layout_negative_content'
  )::jsonb;
  v_payload jsonb;
  v_bad jsonb;
  v_case text;
begin
  foreach v_case in array array['malformed','unknown','type','reference','geometry','depth','value','entity_count','version_reuse'] loop
    v_bad := v_base;
    if v_case='malformed' then v_bad := '{}'::jsonb;
    elsif v_case='unknown' then v_bad := v_bad || '{"unexpected":true}'::jsonb;
    elsif v_case='type' then v_bad := jsonb_set(v_bad,'{nodes,0,locked}','"false"'::jsonb);
    elsif v_case='reference' then v_bad := jsonb_set(v_bad,'{walls,0,endNodeId}','"missing-node"'::jsonb);
    elsif v_case='geometry' then v_bad := jsonb_set(v_bad,'{openings,0,widthMm}','9000'::jsonb);
    elsif v_case='depth' then v_bad := v_bad || jsonb_build_object('deep',
      '{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":1}}}}}}}}}}}}}}}}}'::jsonb);
    elsif v_case='value' then v_bad := jsonb_set(v_bad,'{stateRevision}','9007199254740992'::jsonb);
    elsif v_case='entity_count' then
      select jsonb_agg(jsonb_build_object('id','zone-'||n)) into v_payload
      from generate_series(1,2049) n;
      v_bad := jsonb_set(v_bad,'{clearanceZones}',v_payload);
    elsif v_case='version_reuse' then
      v_bad := jsonb_set(v_bad,'{documentId}','"layout-document-db4-version-reuse"'::jsonb);
    end if;
    v_payload := jsonb_build_object(
      'versionId',case when v_case='version_reuse' then 'layout-version-db4-secondary-r1' else 'invalid-'||v_case end,
      'roomId','db4-room','variantId','db4-variant-value','role','value_engineered',
      'semanticHash',case when v_case='version_reuse'
        then current_setting('projectceo.db4_layout_version_reuse_hash')
        else 'sha256:'||repeat('0',64) end,
      'schemaVersion','project-ceo-m2-layout/0.1','layoutContent',v_bad
    );
    begin
      perform projectceo_product_api.append_m2_workspace_revision(
        '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
        'layout_version',case when v_case='version_reuse' then 'layout-document-db4-version-reuse' else 'invalid-'||v_case end,
        'invalid-revision-'||v_case,null,'published',v_payload,
        'DB4 direct RPC negative '||v_case,
        current_setting('projectceo.db4_layout_negative_state_revision')::bigint,
        'db4-layout-invalid-'||v_case
      );
      raise exception 'DB4_LAYOUT_NEGATIVE_ALLOWED_%', upper(v_case);
    exception when sqlstate 'P1111' then null;
    end;
  end loop;
end
$layout_negatives$;
rollback;

-- An Approved Commit cannot reuse valid human approval provenance while
-- changing the exact room or variant role away from its published lineage.
select set_config(
  'projectceo.db4_approved_layout_payload',
  (
    select revision.payload::text
    from projectceo_product.m2_workspace_revisions revision
    where revision.entity_kind='approved_commit'
      and revision.entity_id='db4-approved-commit'
  ), false
);
select set_config(
  'projectceo.db4_approved_layout_state_revision',
  (
    select state_revision::text
    from project_intelligence.project_workflows
    where project_id='41111111-1111-4111-8111-111111111111'
  ), false
);
begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $approved_layout_lineage_negatives$
declare
  v_payload jsonb;
  v_state bigint;
  v_case text;
begin
  v_payload := current_setting('projectceo.db4_approved_layout_payload')::jsonb;
  v_state := current_setting(
    'projectceo.db4_approved_layout_state_revision'
  )::bigint;
  foreach v_case in array array['room','role'] loop
    begin
      perform projectceo_product_api.append_m2_workspace_revision(
        '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
        'approved_commit','db4-approved-layout-mismatch-'||v_case,
        'db4-approved-layout-mismatch-'||v_case||'-r1',null,'approved',
        case when v_case='room'
          then jsonb_set(v_payload,'{roomId}','"wrong-room"'::jsonb)
          else jsonb_set(v_payload,'{chosenVariant,role}','"premium"'::jsonb) end,
        'DB4 approved layout mismatch '||v_case,v_state,
        'db4-approved-layout-mismatch-'||v_case
      );
      raise exception 'DB4_APPROVED_LAYOUT_MISMATCH_ALLOWED_%',upper(v_case);
    exception when sqlstate 'P1111' then null;
    end;
  end loop;
end
$approved_layout_lineage_negatives$;
rollback;

-- Read v5: project-wide null package and exact package filters return the
-- published latest versions. Owner/architect/client approver see content;
-- builder receives the immutable envelope with layoutContent redacted.
set role authenticated;
set request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $layout_owner_read$
declare v_project jsonb; v_package jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v5(
    '41111111-1111-4111-8111-111111111111',null) into v_project;
  select projectceo_read_api.get_project_workspace_read_v5(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111') into v_package;
  if jsonb_array_length(v_project#>'{data,m2LayoutVersions}') <> 3
     or jsonb_array_length(v_package#>'{data,m2LayoutVersions}') <> 3
     or not (v_project#>'{data,m2LayoutVersions,0,payload}' ? 'layoutContent')
     or v_package#>>'{data,m2LayoutVersions,0,id}' <> 'layout-document-db4'
     or v_package#>>'{data,m2LayoutVersions,0,revisionId}' <> 'layout-version-db4-revision-r1'
     or v_package#>>'{data,m2LayoutVersions,0,payload,versionId}' <> 'layout-version-db4-r1'
     or v_package#>>'{data,m2LayoutVersions,1,id}' <> 'layout-document-db4-secondary'
     or v_package#>>'{data,m2LayoutVersions,1,revisionId}' <> 'layout-document-db4-secondary-revision-r1'
     or v_package#>>'{data,m2LayoutVersions,1,payload,versionId}' <> 'layout-version-db4-secondary-r1'
     or v_package#>>'{data,m2LayoutVersions,2,id}' <> 'layout-document-db4-secondary'
     or v_package#>>'{data,m2LayoutVersions,2,revisionId}' <> 'layout-document-db4-secondary-revision-r2'
     or v_package#>>'{data,m2LayoutVersions,2,payload,versionId}' <> 'layout-version-db4-secondary-r2' then
    raise exception 'DB4_LAYOUT_READ_V5_OWNER_OR_FILTER';
  end if;
end
$layout_owner_read$;
reset role;

set role authenticated;
set request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $layout_architect_read$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v5(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111') into v_read;
  if not (v_read#>'{data,m2LayoutVersions,0,payload}' ? 'layoutContent') then
    raise exception 'DB4_LAYOUT_READ_V5_ARCHITECT';
  end if;
end
$layout_architect_read$;
reset role;

update projectceo_foundation.project_memberships set role='client_approver'
where project_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $layout_client_read$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v5(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111') into v_read;
  if not (v_read#>'{data,m2LayoutVersions,0,payload}' ? 'layoutContent') then
    raise exception 'DB4_LAYOUT_READ_V5_CLIENT_APPROVER';
  end if;
end
$layout_client_read$;
reset role;

update projectceo_foundation.project_memberships set role='builder'
where project_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $layout_builder_read$
declare v_read jsonb;
begin
  select projectceo_read_api.get_project_workspace_read_v5(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111') into v_read;
  if jsonb_array_length(v_read#>'{data,m2LayoutVersions}') <> 3
     or exists (
       select 1 from jsonb_array_elements(v_read#>'{data,m2LayoutVersions}') row
       where row#>'{payload}' ? 'layoutContent'
     ) then raise exception 'DB4_LAYOUT_READ_V5_BUILDER_REDACTION'; end if;
end
$layout_builder_read$;
reset role;

update projectceo_foundation.project_memberships set role='architect'
where project_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';

select 'DB4_M2_LAYOUT_VERSION_OK' as result;
