-- WP32: server-enumerated native M3 metadata context for one child package.
-- This read neither publishes nor certifies files, content or production readiness.
-- STABLE gives authorization and every read the calling statement's MVCC snapshot;
-- there are no locks, business writes, release-engine changes or permanent grants.
begin;

create function projectceo_m3_api.get_native_m3_release_context(
  project_id uuid,
  package_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_package_kind text;
  v_data jsonb;
begin
  select * into strict v_context
  from projectceo_foundation._authorize_package_human(project_id, package_id, 'publish_release');

  -- A disposable read grant must not bypass the module's existing close gate.
  if not projectceo_platform.m3_read_gate_open() then
    perform projectceo_foundation._raise('P1113', 'module_disabled', '{}'::jsonb);
  end if;

  select package.kind into v_package_kind
  from projectceo_foundation.project_packages package
  where package.organization_id = v_context.organization_id
    and package.project_id = get_native_m3_release_context.project_id
    and package.id = get_native_m3_release_context.package_id
    and package.status = 'active';
  if v_package_kind is distinct from 'work_package' then
    perform projectceo_product._raise('P1109', 'scope_conflict',
      '{"reason":"WORK_PACKAGE_REQUIRED"}'::jsonb);
  end if;

  with baseline as materialized (
    select b.baseline_id
    from projectceo_product.project_baselines b
    where b.organization_id = v_context.organization_id
      and b.project_id = project_id and b.published_at is not null
    order by b.version_no desc limit 1
  ), baseline_refs as materialized (
    -- Project baseline refs must be narrowed through their persisted ownership.
    select distinct r.target_kind, r.revision_id
    from projectceo_product.project_baseline_refs r
    join baseline b on b.baseline_id = r.baseline_id
    join projectceo_product.claim_revision_descriptors d
      on d.organization_id = r.organization_id and d.project_id = r.project_id
      and d.revision_id = r.revision_id
    where r.organization_id = v_context.organization_id and r.project_id = project_id
      and d.package_id = package_id
      and r.target_kind in ('decision_revision', 'selection_revision')
  ), handoffs as materialized (
    select distinct on (h.entity_id collate "C") h.*
    from projectceo_product.m2_workspace_revisions h
    where h.organization_id = v_context.organization_id and h.project_id = project_id
      and h.package_id = package_id and h.entity_kind = 'm2_m3_handoff'
      and h.status = 'published'
    order by h.entity_id collate "C", h.revision_no desc
  ), handoff_selections as materialized (
    select h.entity_id, h.revision_id, selection.value as selection_revision_id
    from handoffs h
    cross join lateral jsonb_array_elements_text(
      coalesce(h.payload->'selectionRevisionIds', '[]'::jsonb)
    ) selection(value)
  ), latest_sheets as materialized (
    select distinct on (s.sheet_id collate "C") s.*
    from projectceo_m3.documentation_sheet_revisions s
    where s.organization_id = v_context.organization_id and s.project_id = project_id
      and s.package_id = package_id
    order by s.sheet_id collate "C", s.revision_no desc
  ), sheets as materialized (
    -- A sheet of a verifiably superseded handoff remains historical, not an
    -- unrepairable current finding. Replacement sheets must cover the current
    -- exact handoff; unknown/mismatched origins are not silently filtered out.
    select s.* from latest_sheets s
    where not exists (
      select 1 from projectceo_product.m2_workspace_revisions old_h
      join handoffs current_h on current_h.entity_id=old_h.entity_id
        and current_h.revision_no>old_h.revision_no
      where old_h.organization_id=s.organization_id and old_h.project_id=s.project_id
        and old_h.package_id=s.package_id and old_h.entity_kind='m2_m3_handoff'
        and old_h.status='published' and old_h.entity_id=s.handoff_id
        and old_h.revision_id=s.handoff_revision_id
    )
  ), checked_sheets as materialized (
    select s.*, h.entity_id is not null as current_handoff,
      h.entity_id is not null
      and s.room_id is not distinct from h.payload->>'roomId'
      and s.handoff_contract_version is not distinct from h.payload->>'schemaVersion'
      and s.approved_m2_commit_revision_id is not distinct from h.payload->>'approvedCommitRevisionId'
      and s.design_intent_revision_id is not distinct from h.payload->>'designIntentRevisionId'
      and s.layout_document_id is not distinct from h.payload#>>'{chosenVariant,layoutDocumentId}'
      and s.layout_version_id is not distinct from h.payload#>>'{chosenVariant,layoutVersionId}'
      and s.layout_revision_id is not distinct from h.payload->>'layoutRevisionId'
      and s.semantic_hash is not distinct from h.payload#>>'{chosenVariant,semanticHash}'
      and not exists (
        select 1 from unnest(s.specification_revision_ids) specification(revision_id)
        where not exists (
          select 1 from handoff_selections hs
          where hs.entity_id = h.entity_id and hs.revision_id = h.revision_id
            and hs.selection_revision_id = specification.revision_id
        )
      ) as origin_matches
    from sheets s
    -- Exact handoff identity matters even if two handoffs share an approved commit.
    left join handoffs h on h.entity_id = s.handoff_id and h.revision_id = s.handoff_revision_id
  ), findings as materialized (
    select 'BASELINE_REQUIRED'::text as code, package_id::text as subject
      where not exists (select 1 from baseline)
    union
    select 'PACKAGE_NOT_IN_BASELINE', package_id::text
      where exists (select 1 from baseline) and not exists (
        select 1 from projectceo_product.project_baseline_packages p
        join baseline b on b.baseline_id = p.baseline_id
        where p.organization_id = v_context.organization_id and p.project_id = project_id
          and p.package_id = package_id
      )
    union
    select 'HANDOFF_REQUIRED', package_id::text where not exists (select 1 from handoffs)
    union
    select 'ROOM_WITHOUT_SHEET', h.payload->>'roomId' from handoffs h
      where not exists (
        select 1 from checked_sheets s
        where s.handoff_id = h.entity_id and s.handoff_revision_id = h.revision_id
          and s.origin_matches
      )
    union
    select 'SPECIFICATION_NOT_COVERED', hs.selection_revision_id from handoff_selections hs
      where not exists (
        select 1 from checked_sheets s
        where s.handoff_id = hs.entity_id and s.handoff_revision_id = hs.revision_id
          and s.origin_matches and hs.selection_revision_id = any(s.specification_revision_ids)
      )
    union
    select 'SHEET_FROM_OTHER_HANDOFF', s.sheet_id from checked_sheets s where not s.current_handoff
    union
    select 'SHEET_ORIGIN_MISMATCH', s.sheet_id from checked_sheets s
      where s.current_handoff and not s.origin_matches
    union
    select 'DUPLICATE_SHEET_NUMBER', s.sheet_number from sheets s
      group by s.sheet_number having count(*) > 1
    union
    select 'HANDOFF_SELECTION_NOT_IN_BASELINE', hs.selection_revision_id from handoff_selections hs
      where exists (select 1 from baseline) and not exists (
        select 1 from baseline_refs r where r.target_kind = 'selection_revision'
          and r.revision_id = hs.selection_revision_id
      )
    union
    select 'HANDOFF_DESIGN_INTENT_NOT_IN_BASELINE', h.payload->>'designIntentRevisionId' from handoffs h
      where exists (select 1 from baseline) and not exists (
        select 1 from baseline_refs r where r.target_kind = 'decision_revision'
          and r.revision_id = h.payload->>'designIntentRevisionId'
      )
    union
    select 'BASELINE_SELECTION_WITHOUT_HANDOFF', r.revision_id from baseline_refs r
      where r.target_kind = 'selection_revision' and not exists (
        select 1 from handoff_selections hs where hs.selection_revision_id = r.revision_id
      )
  )
  select jsonb_build_object(
    'schemaVersion', 'remhaos.native-m3-release-context/1',
    'scope', jsonb_build_object('organizationId', v_context.organization_id,
      'projectId', project_id, 'packageId', package_id),
    'stateRevision', (select w.state_revision from project_intelligence.project_workflows w
      where w.organization_id = v_context.organization_id and w.project_id = project_id),
    'baselineId', (select b.baseline_id from baseline b),
    'previousVersionId', (select v.production_package_version_id
      from projectceo_product.production_package_versions v
      where v.organization_id = v_context.organization_id and v.project_id = project_id
        and v.package_id = package_id order by v.version_no desc limit 1),
    'handoffs', coalesce((select jsonb_agg(jsonb_build_object(
      'handoffId', h.entity_id, 'revisionId', h.revision_id, 'revisionNo', h.revision_no,
      'contractVersion', h.payload->>'schemaVersion', 'packageId', h.package_id,
      'roomId', h.payload->>'roomId',
      'approvedM2CommitRevisionId', h.payload->>'approvedCommitRevisionId',
      'designIntentRevisionId', h.payload->>'designIntentRevisionId',
      'layout', jsonb_build_object(
        'documentId', h.payload#>>'{chosenVariant,layoutDocumentId}',
        'versionId', h.payload#>>'{chosenVariant,layoutVersionId}',
        'revisionId', h.payload->>'layoutRevisionId',
        'semanticHash', h.payload#>>'{chosenVariant,semanticHash}'),
      'selectionRevisionIds', coalesce((select jsonb_agg(hs.selection_revision_id
        order by hs.selection_revision_id collate "C") from handoff_selections hs
        where hs.entity_id = h.entity_id and hs.revision_id = h.revision_id), '[]'::jsonb)
    ) order by h.entity_id collate "C") from handoffs h), '[]'::jsonb),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object(
      'sheetId', s.sheet_id, 'revisionId', s.revision_id, 'revisionNo', s.revision_no,
      'packageId', s.package_id, 'roomId', s.room_id,
      'sheetNumber', s.sheet_number, 'title', s.title,
      'specificationRevisionIds', coalesce((select jsonb_agg(spec.value order by spec.value collate "C")
        from unnest(s.specification_revision_ids) spec(value)), '[]'::jsonb),
      'origin', jsonb_build_object(
        'handoffId', s.handoff_id, 'handoffRevisionId', s.handoff_revision_id,
        'handoffContractVersion', s.handoff_contract_version,
        'approvedM2CommitRevisionId', s.approved_m2_commit_revision_id,
        'designIntentRevisionId', s.design_intent_revision_id,
        'layoutDocumentId', s.layout_document_id, 'layoutVersionId', s.layout_version_id,
        'layoutRevisionId', s.layout_revision_id, 'semanticHash', s.semantic_hash)
    ) order by s.sheet_number collate "C", s.sheet_id collate "C") from sheets s), '[]'::jsonb),
    'baselineDecisionRevisionIds', coalesce((select jsonb_agg(r.revision_id order by r.revision_id collate "C")
      from baseline_refs r where r.target_kind = 'decision_revision'), '[]'::jsonb),
    'baselineSelectionRevisionIds', coalesce((select jsonb_agg(r.revision_id order by r.revision_id collate "C")
      from baseline_refs r where r.target_kind = 'selection_revision'), '[]'::jsonb),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('code', f.code, 'subject', f.subject)
      order by f.code collate "C", f.subject collate "C") from findings f), '[]'::jsonb),
    'structurallyComplete', not exists (select 1 from findings)
  ) into v_data;

  -- Server-owned JSONB digest of this data before adding contextDigest. This is
  -- not the client canonical-JSON hash or an existing baseline/release signature.
  v_data := v_data || jsonb_build_object('contextDigest',
    'sha256:' || encode(project_intelligence._sha256_jsonb(v_data), 'hex'));
  return jsonb_build_object('requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data, 'error', null);
end
$function$;

alter function projectceo_m3_api.get_native_m3_release_context(uuid, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_m3_api.get_native_m3_release_context(uuid, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke execute on function
  projectceo_m3_api.get_native_m3_release_context(uuid, uuid)
from authenticated;

commit;
