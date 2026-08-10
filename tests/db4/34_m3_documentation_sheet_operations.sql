\set ON_ERROR_STOP on

-- M3 DB boundary. Runs after the Cycle 6 file, which leaves a published
-- `m2_m3_handoff` behind: that row is the only door into M3, so the scenario
-- uses the real one instead of inventing a lookalike.
--
-- What is proven here: provenance is derived on the server and cannot be
-- assigned by the caller; the approved selection set bounds what a sheet may
-- reference; sheet numbers stay unambiguous inside a package; attachment
-- appends a revision and leaves the previous one byte-for-byte; the private
-- schema is unreachable without the RPC.

select workflow.state_revision as state_revision
from project_intelligence.project_workflows workflow
where workflow.project_id='41111111-1111-4111-8111-111111111111'
\gset m3_

-- The same value is mirrored into a session setting: psql does not interpolate
-- variables inside dollar-quoted blocks, and the replay below must send the
-- byte-identical request the first call sent.
select set_config('db4.m3_state_revision', :'m3_state_revision', false);

-- The owner registers a sheet against the exact published handoff. Neither the
-- room, nor the layout signature, nor the approved commit is passed in.
begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
select projectceo_m3_api.register_documentation_sheet(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'cycle6-handoff','74000000-0000-4000-8000-000000000021',
  'm3-sheet-a101','A-101','План расстановки',
  '75000000-0000-4000-8000-000000000001',
  array[]::text[],
  'Регистрация листа по согласованному решению M2',
  :'m3_state_revision'::bigint,'m3-sheet-a101-register'
);
commit;

do $m3_origin_derived$
declare v_sheet projectceo_m3.documentation_sheet_revisions;
  v_handoff projectceo_product.m2_workspace_revisions;
begin
  select * into v_sheet from projectceo_m3.documentation_sheet_revisions sheet
  where sheet.sheet_id='m3-sheet-a101';
  select * into v_handoff from projectceo_product.m2_workspace_revisions handoff
  where handoff.entity_kind='m2_m3_handoff' and handoff.entity_id='cycle6-handoff';
  if v_sheet is null then raise exception 'DB4_M3_SHEET_NOT_PERSISTED'; end if;
  if v_sheet.revision_no<>1 or v_sheet.supersedes_revision_id is not null then
    raise exception 'DB4_M3_SHEET_LINEAGE';
  end if;
  if v_sheet.room_id is distinct from v_handoff.payload->>'roomId'
     or v_sheet.approved_m2_commit_revision_id
        is distinct from v_handoff.payload->>'approvedCommitRevisionId'
     or v_sheet.design_intent_revision_id
        is distinct from v_handoff.payload->>'designIntentRevisionId'
     or v_sheet.layout_revision_id is distinct from v_handoff.payload->>'layoutRevisionId'
     or v_sheet.layout_document_id
        is distinct from v_handoff.payload#>>'{chosenVariant,layoutDocumentId}'
     or v_sheet.layout_version_id
        is distinct from v_handoff.payload#>>'{chosenVariant,layoutVersionId}'
     or v_sheet.semantic_hash
        is distinct from v_handoff.payload#>>'{chosenVariant,semanticHash}'
     or v_sheet.handoff_contract_version is distinct from v_handoff.payload->>'schemaVersion' then
    raise exception 'DB4_M3_ORIGIN_NOT_DERIVED';
  end if;
  if cardinality(v_sheet.specification_revision_ids)<>0 then
    raise exception 'DB4_M3_SPECIFICATIONS_INVENTED';
  end if;
end
$m3_origin_derived$;

-- Replaying the identical command returns the first result and writes nothing.
begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $m3_idempotent$
declare v_replay jsonb;
begin
  select projectceo_m3_api.register_documentation_sheet(
    '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
    'cycle6-handoff','74000000-0000-4000-8000-000000000021',
    'm3-sheet-a101','A-101','План расстановки',
    '75000000-0000-4000-8000-000000000001',
    array[]::text[],
    'Регистрация листа по согласованному решению M2',
    current_setting('db4.m3_state_revision')::bigint,'m3-sheet-a101-register'
  ) into v_replay;
  if v_replay->'result'->>'revisionId' is distinct from '75000000-0000-4000-8000-000000000001'
     or (v_replay->>'replay')::boolean is distinct from true then
    raise exception 'DB4_M3_REPLAY_RESULT';
  end if;
end
$m3_idempotent$;
rollback;

-- Counted outside the authenticated role: that role cannot read the private
-- schema at all, which the closing checks of this file prove on purpose.
do $m3_replay_wrote_nothing$
declare v_rows bigint;
begin
  select count(*) into v_rows from projectceo_m3.documentation_sheet_revisions sheet
  where sheet.sheet_id='m3-sheet-a101';
  if v_rows<>1 then raise exception 'DB4_M3_REPLAY_WROTE_ROW'; end if;
end
$m3_replay_wrote_nothing$;

select workflow.state_revision as state_revision
from project_intelligence.project_workflows workflow
where workflow.project_id='41111111-1111-4111-8111-111111111111'
\gset m3_attach_
select set_config('db4.m3_state_revision', :'m3_attach_state_revision', false);

-- Controlled refusals: a second sheet on the same number, a selection outside
-- the approved set, and an unknown handoff never reach storage.
begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $m3_register_negatives$
declare v_state bigint; v_case text;
begin
  v_state := current_setting('db4.m3_state_revision')::bigint;
  foreach v_case in array array['duplicate_number','not_approved','unknown_handoff'] loop
    begin
      perform projectceo_m3_api.register_documentation_sheet(
        '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
        case when v_case='unknown_handoff' then 'cycle6-handoff-ghost' else 'cycle6-handoff' end,
        '74000000-0000-4000-8000-000000000021',
        'm3-sheet-'||v_case,
        case when v_case='duplicate_number' then 'A-101' else 'A-10'||length(v_case) end,
        'Отрицательный сценарий','75000000-0000-4000-8000-00000000009'||length(v_case)::text,
        case when v_case='not_approved'
          then array['revision-selection-not-approved']
          else array[]::text[] end,
        'Контролируемый отказ',v_state,'m3-negative-'||v_case);
      raise exception 'DB4_M3_REGISTER_NEGATIVE_ALLOWED_%',upper(v_case);
    exception when sqlstate 'P1111' then null;
    end;
  end loop;
end
$m3_register_negatives$;
rollback;

-- The client approver prepares nothing: the documentation package is the
-- studio side's authority, exactly as publishing the handoff is.
begin;
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $m3_client_forbidden$
declare v_state bigint;
begin
  v_state := current_setting('db4.m3_state_revision')::bigint;
  begin
    perform projectceo_m3_api.register_documentation_sheet(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021',
      'm3-sheet-client','A-900','Лист от клиента',
      '75000000-0000-4000-8000-000000000900',array[]::text[],
      'Клиент не готовит документацию',v_state,'m3-client-forbidden');
    raise exception 'DB4_M3_CLIENT_REGISTER_ALLOWED';
  exception when sqlstate 'P1103' or sqlstate 'P1102' then null;
  end;
end
$m3_client_forbidden$;
rollback;

-- Attaching an approved selection appends revision 2 and leaves revision 1 as
-- it was issued.
begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
select projectceo_m3_api.attach_documentation_sheet_specifications(
  '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
  'm3-sheet-a101','75000000-0000-4000-8000-000000000002',
  '75000000-0000-4000-8000-000000000001',
  array['revision-selection-db4-r1'],
  'Привязка утверждённого выбора к листу',
  :'m3_attach_state_revision'::bigint,'m3-sheet-a101-attach'
);
commit;

do $m3_attach_appended$
declare v_first projectceo_m3.documentation_sheet_revisions;
  v_second projectceo_m3.documentation_sheet_revisions;
begin
  select * into v_first from projectceo_m3.documentation_sheet_revisions sheet
  where sheet.sheet_id='m3-sheet-a101' and sheet.revision_no=1;
  select * into v_second from projectceo_m3.documentation_sheet_revisions sheet
  where sheet.sheet_id='m3-sheet-a101' and sheet.revision_no=2;
  if v_second is null then raise exception 'DB4_M3_ATTACH_NOT_APPENDED'; end if;
  if cardinality(v_first.specification_revision_ids)<>0 then
    raise exception 'DB4_M3_PREVIOUS_REVISION_MUTATED';
  end if;
  if v_second.specification_revision_ids is distinct from array['revision-selection-db4-r1'] then
    raise exception 'DB4_M3_ATTACH_SET';
  end if;
  if v_second.supersedes_revision_id is distinct from v_first.revision_id then
    raise exception 'DB4_M3_ATTACH_LINEAGE';
  end if;
  -- Provenance is a property of the sheet: it survives the new revision whole.
  if v_second.semantic_hash is distinct from v_first.semantic_hash
     or v_second.room_id is distinct from v_first.room_id
     or v_second.approved_m2_commit_revision_id
        is distinct from v_first.approved_m2_commit_revision_id then
    raise exception 'DB4_M3_ATTACH_ORIGIN_DRIFT';
  end if;
end
$m3_attach_appended$;

select set_config(
  'db4.m3_state_revision',
  (select state_revision::text from project_intelligence.project_workflows
   where project_id='41111111-1111-4111-8111-111111111111'),
  false
);

-- Re-attaching the same selection, attaching to a stale revision and attaching
-- to an unknown sheet are all refused.
begin;
set local role authenticated;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $m3_attach_negatives$
declare v_state bigint;
begin
  v_state := current_setting('db4.m3_state_revision')::bigint;
  begin
    perform projectceo_m3_api.attach_documentation_sheet_specifications(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'm3-sheet-a101','75000000-0000-4000-8000-000000000003',
      '75000000-0000-4000-8000-000000000002',
      array['revision-selection-db4-r1'],
      'Повторная привязка того же выбора',v_state,'m3-attach-duplicate');
    raise exception 'DB4_M3_ATTACH_DUPLICATE_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
  begin
    perform projectceo_m3_api.attach_documentation_sheet_specifications(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'm3-sheet-a101','75000000-0000-4000-8000-000000000004',
      '75000000-0000-4000-8000-000000000001',
      array[]::text[],
      'Привязка к устаревшей ревизии',v_state,'m3-attach-stale');
    raise exception 'DB4_M3_ATTACH_STALE_ALLOWED';
  exception when sqlstate 'P1107' then null;
  end;
  begin
    perform projectceo_m3_api.attach_documentation_sheet_specifications(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'm3-sheet-ghost','75000000-0000-4000-8000-000000000005',null,
      array[]::text[],
      'Привязка к несуществующему листу',v_state,'m3-attach-ghost');
    raise exception 'DB4_M3_ATTACH_GHOST_ALLOWED';
  exception when sqlstate 'P1111' then null;
  end;
end
$m3_attach_negatives$;
rollback;

-- Every write is on the shared ledger: two operations, two audit events, no
-- second revision mechanism.
do $m3_ledger$
begin
  if not exists (
    select 1 from projectceo_product.command_records record
    where record.operation='register_m3_documentation_sheet'
  ) or not exists (
    select 1 from projectceo_product.command_records record
    where record.operation='attach_m3_documentation_sheet_specifications'
  ) then raise exception 'DB4_M3_COMMAND_LEDGER'; end if;
  if not exists (
    select 1 from projectceo_product.audit_events event
    where event.event_type='m3_documentation_sheet_registered'
  ) or not exists (
    select 1 from projectceo_product.audit_events event
    where event.event_type='m3_documentation_sheet_specifications_attached'
  ) then raise exception 'DB4_M3_AUDIT_LEDGER'; end if;
end
$m3_ledger$;

-- Issued revisions are immutable, and the number registry cannot be rewritten
-- to free a taken number.
do $m3_immutable$
begin
  begin
    update projectceo_m3.documentation_sheet_revisions set reason='mutated'
    where sheet_id='m3-sheet-a101';
    raise exception 'DB4_M3_MUTABLE';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from projectceo_m3.documentation_sheet_numbers where sheet_id='m3-sheet-a101';
    raise exception 'DB4_M3_NUMBER_RELEASED';
  exception when sqlstate '55000' then null;
  end;
end
$m3_immutable$;

-- The private schema is not a read surface: authenticated and anon reach the
-- data only through the RPC, and anon not even through that.
set role authenticated;
set request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $m3_private_schema$
begin
  begin
    perform 1 from projectceo_m3.documentation_sheet_revisions;
    raise exception 'DB4_M3_PRIVATE_SCHEMA_READABLE';
  exception when insufficient_privilege then null;
  end;
end
$m3_private_schema$;
reset role;

begin;
set local role anon;
do $m3_anon_denied$
begin
  begin
    perform projectceo_m3_api.register_documentation_sheet(
      '41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',
      'cycle6-handoff','74000000-0000-4000-8000-000000000021',
      'm3-sheet-anon','A-950','Лист от анонима',
      '75000000-0000-4000-8000-000000000950',array[]::text[],
      'Аноним не пишет',1,'m3-anon');
    raise exception 'DB4_M3_ANON_ALLOWED';
  exception when insufficient_privilege or sqlstate 'P1101' then null;
  end;
end
$m3_anon_denied$;
rollback;

select 'DB4_M3_DOCUMENTATION_SHEET_OK' result;
