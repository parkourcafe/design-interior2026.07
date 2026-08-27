-- RemHaOS Integration Gateway PR5: persist the human-selected target kind.
--
-- Additive function replacement. Review remains the single idempotent command;
-- the selected target is stored on the candidate before it becomes official.

begin;

set local check_function_bodies = on;

create or replace function remhaos_integration_api.review_import_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_target jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_candidate remhaos_integration.import_candidates%rowtype;
  v_context record;
  v_target jsonb := remhaos_integration._assert_json_object(
    coalesce(p_target, '{}'::jsonb),
    'target'
  );
  v_target_kind text;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_next_status text;
  v_result jsonb;
begin
  if p_decision not in ('accepted', 'rejected') then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"decision"}'::jsonb
    );
  end if;

  select * into v_candidate
  from remhaos_integration.import_candidates candidate
  where candidate.id = p_candidate_id
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"importCandidate"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_foundation._authorize_project_human(
    v_candidate.project_id,
    'review_source'
  );
  if v_context.organization_id <> v_candidate.organization_id then
    perform remhaos_integration._raise(
      'P1209',
      'scope_conflict',
      '{"reason":"IMPORT_CANDIDATE_SCOPE"}'::jsonb
    );
  end if;

  v_target_kind := coalesce(v_target ->> 'targetKind', v_candidate.target_kind);
  if v_target_kind not in (
    'source',
    'reference',
    'selection',
    'evidence',
    'other'
  ) then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"targetKind"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'actorId', v_context.actor_id,
      'candidateId', p_candidate_id,
      'decision', p_decision,
      'target', v_target
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id,
    v_candidate.project_id,
    'review_import_candidate',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;
  if v_candidate.status not in ('candidate', 'reviewing') then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"importCandidate"}'::jsonb
    );
  end if;

  v_next_status := p_decision;
  update remhaos_integration.import_candidates
  set status = v_next_status,
      target_kind = v_target_kind,
      reviewed_by = v_context.actor_user_id,
      reviewed_at = statement_timestamp(),
      provenance = provenance || jsonb_build_object(
        'reviewTargetKind',
        v_target_kind
      )
  where id = v_candidate.id
  returning * into v_candidate;

  v_result := jsonb_build_object(
    'candidateId', v_candidate.id,
    'status', v_candidate.status,
    'targetKind', v_candidate.target_kind
  );

  return remhaos_integration._complete_command(
    v_context.organization_id,
    v_candidate.project_id,
    'review_import_candidate',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'import_candidate_reviewed',
    v_next_status,
    jsonb_build_object('decision', v_next_status)
  );
end
$function$;

alter function remhaos_integration_api.review_import_candidate(
  uuid,
  text,
  jsonb,
  text
) owner to pi_table_owner;

commit;
