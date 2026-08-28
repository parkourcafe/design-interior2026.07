-- RemHaOS Integration Gateway PR3: make publish preparation replay-safe.
--
-- Additive replacement. A retry after the internal copy has already been
-- completed must be able to reach the idempotent publish command.

begin;

set local check_function_bodies = on;

create or replace function remhaos_integration_api.get_file_intake_storage(
  p_project_id uuid,
  p_intake_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_intake remhaos_integration.file_intakes%rowtype;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'publish_baseline');
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.organization_id = v_context.organization_id
    and intake.project_id = p_project_id
    and intake.intake_id = p_intake_id;
  if not found or v_intake.status not in ('ingested_candidate', 'published_internal_copy') then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"publishable_file_intake"}'::jsonb);
  end if;
  return jsonb_build_object(
    'organizationId', v_intake.organization_id,
    'projectId', v_intake.project_id,
    'intakeId', v_intake.intake_id,
    'packageId', v_intake.package_id,
    'bucket', 'client-uploads',
    'objectKey', case
      when v_intake.status = 'published_internal_copy' then v_intake.internal_object_key
      else v_intake.quarantine_object_key
    end,
    'internalObjectKey', v_intake.internal_object_key,
    'checksumHex', encode(v_intake.checksum, 'hex'),
    'mediaType', v_intake.media_type,
    'extension', v_intake.extension,
    'sourceRole', v_intake.source_role,
    'status', v_intake.status,
    'upsert', false
  );
end
$function$;

alter function remhaos_integration_api.get_file_intake_storage(uuid, uuid)
  owner to pi_table_owner;

commit;
