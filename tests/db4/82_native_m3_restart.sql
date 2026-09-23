\set ON_ERROR_STOP on

-- Main must really restart PostgreSQL between the concurrency checkpoint and
-- this file. Mocked SQL claims below are not HTTP/Auth acceptance evidence.
begin;
set local statement_timeout='25s';
set local lock_timeout='15s';
do $restart$
declare saved record; checkpoint jsonb; before_data jsonb; replay jsonb;
  live_context jsonb; foreign_actor text := '81888888-8888-4888-8888-888888888888';
begin
  if to_jsonb(pg_postmaster_start_time()) is not distinct from
    (select value from native_m3_fixture.checkpoints where name='server-start-before-restart') then
    raise exception 'DB4_NATIVE82_ACTUAL_SERVER_RESTART_REQUIRED';
  end if;
  select value into strict before_data from native_m3_fixture.checkpoints where name='before-restart';
  if native_m3_fixture.snapshot() is distinct from before_data then
    raise exception 'DB4_NATIVE82_RESTART_CHANGED_BUSINESS_STATE_AUDIT_OR_COMMAND_COUNTS';
  end if;
  -- Revalidate existence, exact cardinality, actor, metadata and the audit's
  -- inner-command linkage, then compare the complete saved rows across reboot.
  select value into strict checkpoint from native_m3_fixture.checkpoints
    where name='first-publication-evidence';
  if native_m3_fixture.first_publication_evidence() is distinct from checkpoint then
    raise exception 'DB4_NATIVE82_RESTART_CHANGED_FIRST_PUBLICATION_AUDIT_OR_INNER_COMMAND';
  end if;
  if (select state_revision from project_intelligence.project_workflows
      where project_id='41111111-1111-4111-8111-111111111111') is distinct from
    (select (value->>'stateRevision')::bigint from native_m3_fixture.checkpoints
      where name='restart-state-and-counts')
    or (select count(*) from native_m3_fixture.checkpoints where name like 'overlap-%') <> 3 then
    raise exception 'DB4_NATIVE82_RESTART_LOST_STATE_OR_LOCK_EVIDENCE';
  end if;
  select * into strict saved from native_m3_fixture.published;
  select value into strict checkpoint from native_m3_fixture.checkpoints where name='first-release-before-restart';
  if checkpoint is distinct from jsonb_build_object('context',saved.context,'response',saved.response)
    or saved.context->>'contextDigest' is distinct from
      'sha256:'||encode(project_intelligence._sha256_jsonb(saved.context-'contextDigest'),'hex') then
    raise exception 'DB4_NATIVE82_SAVED_CONTEXT_DIGEST_OR_RESPONSE_CHANGED';
  end if;
  if (select count(*) from projectceo_m3.production_package_native_contexts
    where project_id=(saved.context#>>'{scope,projectId}')::uuid
      and production_package_version_id=saved.response#>>'{result,id}'
      and context=saved.context and context_digest=saved.context->>'contextDigest') <> 1
    or (select count(*) from projectceo_product.production_package_versions
      where project_id=(saved.context#>>'{scope,projectId}')::uuid
        and package_id=(saved.context#>>'{scope,packageId}')::uuid
        and production_package_version_id=saved.response#>>'{result,id}') <> 1
    or (select count(*) from projectceo_product.command_records
      where project_id=(saved.context#>>'{scope,projectId}')::uuid
        and operation='publish_work_package_release_request_bound'
        and key_digest=project_intelligence._sha256_text('native81-release')
        and actor_user_id='31111111-1111-4111-8111-111111111111'
        and logical_result=saved.response->'result'
        and resulting_state_revision=(saved.response->>'stateRevision')::bigint) <> 1 then
    raise exception 'DB4_NATIVE82_RELEASE_LINEAGE_OR_COMMAND_NOT_EXACTLY_ONCE';
  end if;

  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  live_context := projectceo_m3_api.get_native_m3_release_context(
    (saved.context#>>'{scope,projectId}')::uuid,(saved.context#>>'{scope,packageId}')::uuid)->'data';
  -- Replay ORIGINAL input, deliberately not the current context/state/head.
  replay := projectceo_product_api.publish_work_package_release_request_bound(
    (saved.context#>>'{scope,projectId}')::uuid,(saved.context#>>'{scope,packageId}')::uuid,
    saved.context->>'baselineId',saved.context->>'previousVersionId',
    (saved.context->>'stateRevision')::bigint,'native81-release','native81-release');
  reset role;
  if replay is distinct from jsonb_set(saved.response,'{replay}','true'::jsonb)
    or live_context->>'contextDigest' is not distinct from saved.context->>'contextDigest'
    or not exists(select 1 from jsonb_array_elements(live_context->'handoffs') h
      where h->>'handoffId'='native81-handoff' and h->>'revisionId'='native82-race-handoff') then
    raise exception 'DB4_NATIVE82_RESTART_REPLAY_DID_NOT_PRESERVE_OLD_CONTEXT';
  end if;

  -- This different actor legitimately owns child architect capabilities; deny
  -- specifically because the original command belongs to another actor.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',foreign_actor,true);
  perform projectceo_m3_api.get_native_m3_release_context(
    (saved.context#>>'{scope,projectId}')::uuid,(saved.context#>>'{scope,packageId}')::uuid);
  reset role;
  perform native_m3_fixture.denied(native_m3_fixture.release_sql(saved.context,'native81-release'),
    'P1103',foreign_actor,'IDEMPOTENCY_ACTOR_MISMATCH');
  if native_m3_fixture.snapshot() is distinct from before_data then
    raise exception 'DB4_NATIVE82_RESTART_REPLAY_OR_FOREIGN_ACTOR_WROTE_DATA';
  end if;
end $restart$;
commit;
select 'DB4_NATIVE_M3_ACTUAL_RESTART_EXACT_REPLAY_NO_DUPLICATES_OK' result;
