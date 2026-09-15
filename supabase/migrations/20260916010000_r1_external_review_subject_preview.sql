-- Read-only composition for a pre-handoff external-file review subject.
-- It persists no review evidence and cannot grant, decide or release anything.
begin;

create function projectceo_product_api.preview_external_review_subject(
  p_project_id uuid,
  p_package_id uuid,
  p_exact_refs jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_ref jsonb;
  v_resolved jsonb;
  v_refs jsonb := '[]'::jsonb;
  v_safe_refs jsonb;
  v_snapshot jsonb;
  v_digest bytea;
begin
  select * into v_context from projectceo_foundation._authorize_package_human(
    p_project_id, p_package_id, 'prepare_client_handoff'
  );
  if p_exact_refs is null or jsonb_typeof(p_exact_refs) is distinct from 'array'
    or jsonb_array_length(p_exact_refs) not between 1 and 2000
    or octet_length(p_exact_refs::text) > 1000000 then
    perform projectceo_product._raise('P1111','validation_failed','{"field":"exactRefs"}'::jsonb);
  end if;

  for v_ref in select value from jsonb_array_elements(p_exact_refs) loop
    v_resolved := projectceo_foundation.resolve_r1_external_release_attachment_ref(
      v_context.organization_id, p_project_id, p_package_id, v_ref
    );
    if exists (
      select 1 from jsonb_array_elements(v_refs) prior
      where prior->>'refIdentity' = v_resolved->>'refIdentity'
    ) then
      perform projectceo_product._raise('P1111','validation_failed','{"reason":"DUPLICATE_EXTERNAL_REF"}'::jsonb);
    end if;
    v_refs := v_refs || jsonb_build_array(v_resolved);
  end loop;
  select jsonb_agg(value order by (value->>'refIdentity') collate "C") into v_refs
  from jsonb_array_elements(v_refs);
  v_snapshot := jsonb_build_object(
    'schemaVersion','archidom.external-file-review-subject/0.1',
    'purpose','file_review',
    'organizationId',v_context.organization_id,
    'projectId',p_project_id,
    'packageId',p_package_id,
    'refs',v_refs
  );
  v_digest := project_intelligence._sha256_jsonb(v_snapshot);
  select jsonb_agg(jsonb_build_object(
    'ordinal', ordinal - 1,
    'kind', value->>'refKind',
    'digest', value->>'semanticDigest'
  ) order by ordinal) into v_safe_refs
  from jsonb_array_elements(v_refs) with ordinality refs(value, ordinal);

  return jsonb_build_object(
    'contractVersion','project-ceo-foundation/0.1',
    'requestId','db:'||extensions.gen_random_uuid()::text,
    'data',jsonb_build_object(
      'purpose','file_review',
      'snapshotSchemaVersion','archidom.external-file-review-subject/0.1',
      'subjectDigest','sha256:'||encode(v_digest,'hex'),
      'safeExactRefs',coalesce(v_safe_refs,'[]'::jsonb),
      'reviewReadiness','not_evaluated',
      'releaseEligibility','ineligible_file_review'
    ),
    'error',null
  );
end $function$;

alter function projectceo_product_api.preview_external_review_subject(uuid,uuid,jsonb) owner to pi_table_owner;
revoke all on function projectceo_product_api.preview_external_review_subject(uuid,uuid,jsonb)
  from public,anon,service_role,pi_human_executor,pi_worker_executor;
grant execute on function projectceo_product_api.preview_external_review_subject(uuid,uuid,jsonb) to authenticated;

commit;
