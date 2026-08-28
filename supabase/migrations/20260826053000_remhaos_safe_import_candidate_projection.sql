-- RemHaOS Integration Gateway PR6: safe candidate provenance projection.
--
-- Additive only. Provider-private candidate provenance stays in the private
-- table; application reads expose only the fields needed for human review.

begin;

set local check_function_bodies = on;

create or replace function remhaos_integration_api.list_import_candidates(
  p_project_id uuid,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    'review_source'
  );
  if p_status is not null and p_status not in (
    'candidate',
    'reviewing',
    'accepted',
    'rejected',
    'superseded'
  ) then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"status"}'::jsonb
    );
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'candidateId', candidate.id,
        'sourceKind', candidate.source_kind,
        'status', candidate.status,
        'targetKind', candidate.target_kind,
        'scanState', candidate.scan_state,
        'serverSha256', candidate.server_sha256,
        'provenance', jsonb_strip_nulls(jsonb_build_object(
          'providerCode', case
            when candidate.provenance ->> 'providerCode' in (
              'google_drive',
              'telegram',
              'url_reference'
            ) then candidate.provenance ->> 'providerCode'
          end,
          'exactExternalRevision', case
            when jsonb_typeof(candidate.provenance -> 'exactExternalRevision') = 'string'
              and char_length(candidate.provenance ->> 'exactExternalRevision') between 1 and 255
              and candidate.provenance ->> 'exactExternalRevision' !~ '[[:cntrl:]]'
            then candidate.provenance ->> 'exactExternalRevision'
          end,
          'intakeId', case
            when candidate.provenance ->> 'intakeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then candidate.provenance ->> 'intakeId'
          end,
          'selectionMode', case
            when candidate.provenance ->> 'selectionMode' = 'explicit_selected_object'
            then 'explicit_selected_object'
          end
        )),
        'createdAt', candidate.created_at,
        'reviewedAt', candidate.reviewed_at
      )
      order by candidate.created_at desc, candidate.id
    )
    from remhaos_integration.import_candidates candidate
    where candidate.organization_id = v_context.organization_id
      and candidate.project_id = p_project_id
      and (p_status is null or candidate.status = p_status)
  ), '[]'::jsonb);
end
$function$;

alter function remhaos_integration_api.list_import_candidates(uuid, text)
  owner to pi_table_owner;

commit;
