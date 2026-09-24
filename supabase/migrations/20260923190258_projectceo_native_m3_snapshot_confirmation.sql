-- HTTP preview confirmation for the existing native child-release engine.
-- Original coordinates are retained by the caller for replay; current state
-- must not replace them. No second command ledger or revision engine is added.
begin;
-- 20260923174529 placed the original engine in projectceo_product and its
-- native binding wrapper at the public name. Preserve BOTH before replacing
-- that public name with a replay-only compatibility door.
alter function projectceo_product.publish_work_package_release_request_bound(
  uuid,uuid,text,text,bigint,text,text
) rename to _publish_work_package_release_engine;
do $rename_engine_self_references$
declare definition text;
  anchor text := 'publish_work_package_release_request_bound.';
begin
  definition := pg_get_functiondef('projectceo_product._publish_work_package_release_engine(uuid,uuid,text,text,bigint,text,text)'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 6 then
    raise exception 'NATIVE_ENGINE_SELF_REFERENCE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,anchor,'_publish_work_package_release_engine.');
end
$rename_engine_self_references$;
revoke all on function projectceo_product._publish_work_package_release_engine(
  uuid,uuid,text,text,bigint,text,text
) from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;

do $move_native_binding$
declare definition text;
  anchor text := 'projectceo_product.publish_work_package_release_request_bound(';
begin
  definition := pg_get_functiondef('projectceo_product_api.publish_work_package_release_request_bound(uuid,uuid,text,text,bigint,text,text)'::regprocedure);
  -- The native binding invokes the engine once for a new publication and once
  -- for its exact replay branch. Both must remain private after the move.
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 2 then
    raise exception 'NATIVE_BINDING_ENGINE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,anchor,'projectceo_product._publish_work_package_release_engine(');
end
$move_native_binding$;
alter function projectceo_product_api.publish_work_package_release_request_bound(
  uuid,uuid,text,text,bigint,text,text
) set schema projectceo_product;
revoke all on function projectceo_product.publish_work_package_release_request_bound(
  uuid,uuid,text,text,bigint,text,text
) from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;

-- The historical no-digest public signature stays callable only as an exact
-- replay. Fresh publication through Data API must use the confirmation door
-- below. The actual engine has already moved to the private schema.
create or replace function projectceo_product_api.publish_work_package_release_request_bound(
  project_id uuid, package_id uuid, expected_baseline_id text,
  expected_previous_version_id text, expected_state_revision bigint,
  command_ref text, idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare ctx record; v_key_digest bytea; result jsonb;
begin
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  select * into strict ctx from projectceo_foundation._authorize_package_human(
    project_id,package_id,'publish_release');
  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  if not exists(select 1 from projectceo_product.command_records record
    where record.organization_id=ctx.organization_id and record.project_id=publish_work_package_release_request_bound.project_id
      and record.operation='publish_work_package_release_request_bound' and record.key_digest=v_key_digest) then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"NATIVE_CONTEXT_CONFIRMATION_REQUIRED"}');
  end if;
  result := projectceo_product.publish_work_package_release_request_bound(
    project_id, package_id, expected_baseline_id, expected_previous_version_id,
    expected_state_revision, command_ref, idempotency_key);
  if coalesce((result->>'replay')::boolean, false) is not true then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"NATIVE_CONTEXT_CONFIRMATION_REQUIRED"}');
  end if;
  return result;
end
$function$;
alter function projectceo_product_api.publish_work_package_release_request_bound(
  uuid,uuid,text,text,bigint,text,text
) owner to pi_table_owner;
revoke all on function projectceo_product_api.publish_work_package_release_request_bound(
  uuid,uuid,text,text,bigint,text,text
) from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;

create function projectceo_product_api.publish_native_m3_release_request_bound(
  project_id uuid, package_id uuid, expected_baseline_id text,
  expected_previous_version_id text, expected_state_revision bigint,
  expected_context_digest text, command_ref text, idempotency_key text
 ) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
#variable_conflict use_variable
declare ctx record; result jsonb; saved_digest text; v_key_digest bytea;
  has_existing_replay boolean; current_context jsonb;
  locked_state bigint;
begin
  if expected_context_digest is null or expected_context_digest !~ '^sha256:[0-9a-f]{64}$' then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"NATIVE_CONTEXT_DIGEST_INVALID"}');
  end if;
  select * into strict ctx from projectceo_foundation._authorize_package_human(
    project_id,package_id,'publish_release');
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  -- Serialize classification with the binding engine. Without this lock, a
  -- concurrent same-key retry can inspect pre-commit context and refuse before
  -- the first transaction's command record becomes replayable.
  select workflow.state_revision into strict locked_state
    from project_intelligence.project_workflows workflow
    where workflow.organization_id=ctx.organization_id
      and workflow.project_id=publish_native_m3_release_request_bound.project_id
    for update;
  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  select exists(select 1 from projectceo_product.command_records record
    where record.organization_id=ctx.organization_id and record.project_id=publish_native_m3_release_request_bound.project_id
      and record.operation='publish_work_package_release_request_bound' and record.key_digest=v_key_digest)
    into has_existing_replay;
  if not has_existing_replay then
    if locked_state is distinct from expected_state_revision then
      perform projectceo_product._raise('P1107','stale_state',jsonb_build_object('currentStateRevision',locked_state));
    end if;
    current_context := projectceo_m3_api.get_native_m3_release_context(project_id,package_id)->'data';
    if current_context->'structurallyComplete' is distinct from 'true'::jsonb then
      perform projectceo_product._raise('P1111','validation_failed','{"reason":"NATIVE_M3_CONTEXT_INCOMPLETE"}');
    end if;
    if current_context->>'contextDigest' is distinct from expected_context_digest then
      perform projectceo_product._raise('P1107','stale_state','{"reason":"NATIVE_CONTEXT_DIGEST_MISMATCH"}');
    end if;
  end if;
  -- The preserved private native binding reauthorizes, locks workflow + authority rows,
  -- handles exact actor/request replay, validates native completeness and the
  -- impact gate, and atomically saves the release and its context.
  result := projectceo_product.publish_work_package_release_request_bound(
    project_id,package_id,expected_baseline_id,expected_previous_version_id,
    expected_state_revision,command_ref,idempotency_key);
  select binding.context_digest into saved_digest
    from projectceo_m3.production_package_native_contexts binding
    where binding.organization_id=ctx.organization_id
      and binding.project_id=publish_native_m3_release_request_bound.project_id
      and binding.package_id=publish_native_m3_release_request_bound.package_id
      and binding.production_package_version_id=result#>>'{result,id}';
  if saved_digest is null then
    -- A legacy replay without native lineage cannot be upgraded into proof.
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"NATIVE_RELEASE_CONTEXT_REQUIRED"}');
  end if;
  if saved_digest is distinct from expected_context_digest then
    -- This is one database transaction. A new mismatched confirmation rolls
    -- back release/context/audit/command writes; replay never rewrites history.
    if (result->>'replay')::boolean then
      perform projectceo_product._raise('P1108','idempotency_conflict','{"reason":"NATIVE_CONTEXT_DIGEST_MISMATCH"}');
    else
      perform projectceo_product._raise('P1107','stale_state','{"reason":"NATIVE_CONTEXT_DIGEST_MISMATCH"}');
    end if;
  end if;
  return result;
end
$function$;
alter function projectceo_product_api.publish_native_m3_release_request_bound(
  uuid,uuid,text,text,bigint,text,text,text
) owner to pi_table_owner;
revoke all on function projectceo_product_api.publish_native_m3_release_request_bound(
  uuid,uuid,text,text,bigint,text,text,text
) from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
revoke execute on function
  projectceo_product_api.publish_native_m3_release_request_bound(uuid, uuid, text, text, bigint, text, text, text)
from authenticated;

-- Future audited module opening must expose the confirmation door as well as
-- the replay-only compatibility signature. Do not open M3 production here.
do $m3_module_signature$
declare definition text;
  anchor text := '''projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text)'',';
begin
  definition := pg_get_functiondef('projectceo_platform._module_signatures(text)'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
    raise exception 'NATIVE_M3_MODULE_SIGNATURE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,anchor,anchor || E'\n      ''projectceo_product_api.publish_native_m3_release_request_bound(uuid, uuid, text, text, bigint, text, text, text)'',\n      ''projectceo_m3_api.get_native_m3_release_context(uuid, uuid)'',');
end
$m3_module_signature$;
commit;
