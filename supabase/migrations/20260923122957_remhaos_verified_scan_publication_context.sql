-- Project-scoped read projection only. Existing authorization, R1 isolation and
-- publication/review doors are unchanged; no Storage or RPC grants are added.
begin;
create or replace function remhaos_integration_api.get_file_intake_storage(
  p_project_id uuid, p_intake_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_context record;
  v_intake remhaos_integration.file_intakes%rowtype;
  v_receipt jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id,'publish_baseline');
  select * into v_intake from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id)
    and intake.organization_id=v_context.organization_id and intake.project_id=p_project_id and intake.intake_id=p_intake_id;
  if not found or v_intake.status not in ('ingested_candidate','published_internal_copy') then
    perform remhaos_integration._raise('P1204','not_found','{"entity":"publishable_file_intake"}'::jsonb);
  end if;
  select jsonb_build_object('receiptId',e.receipt_id,'evidenceDigest',encode(e.evidence_digest,'hex'),
    'checksumHex',encode(t.checksum,'hex'),'byteLength',t.byte_length) into v_receipt
  from remhaos_integration.file_scan_tasks t
  join remhaos_integration.file_scan_evidence e on e.task_id=t.task_id and e.attempt=t.attempt and e.fence=t.fence
  where t.organization_id=v_intake.organization_id and t.project_id=v_intake.project_id
    and t.package_id=v_intake.package_id and t.intake_id=v_intake.intake_id
    and t.state='completed' and t.checksum=v_intake.checksum and t.byte_length=v_intake.size_bytes
    and t.canonical_key=v_intake.internal_object_key and t.quarantine_key=v_intake.quarantine_object_key
    and t.source_role=v_intake.source_role and t.extension=v_intake.extension and t.media_type=v_intake.media_type
    and e.evidence->>'outcome'='clean' and e.evidence->>'canonicalSha256'=encode(v_intake.checksum,'hex')
    and e.evidence->'canonicalByteLength'=to_jsonb(v_intake.size_bytes)
    and v_intake.scan_outcome='clean' and v_intake.review_decision='accepted';
  return jsonb_build_object(
    'organizationId',v_intake.organization_id,'projectId',v_intake.project_id,'intakeId',v_intake.intake_id,
    'packageId',v_intake.package_id,'bucket','client-uploads',
    'objectKey',case when v_intake.status='published_internal_copy' then v_intake.internal_object_key else v_intake.quarantine_object_key end,
    'internalObjectKey',v_intake.internal_object_key,'checksumHex',encode(v_intake.checksum,'hex'),
    'mediaType',v_intake.media_type,'extension',v_intake.extension,'sourceRole',v_intake.source_role,
    'status',v_intake.status,'upsert',false,'canonicalReceipt',v_receipt
  );
end $function$;
-- CREATE OR REPLACE preserves the existing owner and ACL. No new grant.
commit;
