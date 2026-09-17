begin;

-- A source snapshot is the immutable provenance anchor before M2 claims
-- exist. It is deliberately narrower than the retired public publish_version
-- door: only a human who can revise a decision may call it, no claim node may
-- yet exist, and the caller cannot select arbitrary revisions.
create function projectceo_api.publish_source_snapshot(
  project_id uuid,
  expected_latest_version_id text,
  expected_state_revision bigint,
  label text,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(project_id, 'revise_decision');

  if exists (
    select 1
    from project_intelligence.graph_nodes node
    where node.organization_id = v_context.organization_id
      and node.project_id = project_id
      and node.kind not in ('source', 'area')
  ) then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"SOURCE_SNAPSHOT_REQUIRES_SOURCE_GRAPH_ONLY"}'::jsonb
    );
  end if;

  return project_intelligence_api.publish_version(
    project_id,
    expected_latest_version_id,
    expected_state_revision,
    label,
    '[]'::jsonb,
    idempotency_key
  );
end
$function$;

alter function projectceo_api.publish_source_snapshot(uuid, text, bigint, text, text)
  owner to pi_table_owner;
revoke all on function projectceo_api.publish_source_snapshot(uuid, text, bigint, text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_api.publish_source_snapshot(uuid, text, bigint, text, text)
  to authenticated;

commit;
