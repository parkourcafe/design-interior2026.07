#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

# Disposable SQL-role/claim simulation only, not HTTP/Auth acceptance. Requires
# the intentionally committed DB81 fixture. DB83 may have added a second release.
# The authority race covers exact replay, not first-time publication success.
: "${PI_DB4_CONTAINER:?PI_DB4_CONTAINER is required}"
: "${PI_DB4_DATABASE:?PI_DB4_DATABASE is required}"
: "${PI_DB4_PASSWORD:?PI_DB4_PASSWORD is required}"
[[ ${PI_DB4_CONTAINER} == pi-db4-* && ${PI_DB4_DATABASE} == pi_db4 ]] || exit 64

probe_dir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db4-native-m3.XXXXXX")
typeset -a children=()
cleanup() {
  local cleanup_status=$1 child
  trap - EXIT INT TERM
  set +e
  if (( cleanup_status != 0 )); then
    # Killing docker exec alone may leave its PostgreSQL session alive. Restrict
    # termination to this harness's two application names in this disposable DB.
    sql native82-cleanup >/dev/null <<'SQL'
select pg_terminate_backend(a.pid,1000) from pg_stat_activity a
where a.datname=current_database() and a.datname='pi_db4'
  and a.usename='postgres' and a.backend_type='client backend'
  and a.application_name in ('native82-holder','native82-waiter')
  and a.pid<>pg_backend_pid();
SQL
    if (( $? != 0 )); then
      print -u2 -r -- 'DB4_NATIVE82_CLEANUP_BACKEND_TERMINATION_FAILED'
    fi
  fi
  for child in ${children[@]}; do kill "${child}" 2>/dev/null || true; done
  for child in ${children[@]}; do wait "${child}" 2>/dev/null || true; done
  rm -f "${probe_dir}/holder.out" "${probe_dir}/waiter.out"
  rmdir "${probe_dir}" 2>/dev/null || true
  exit "${cleanup_status}"
}
trap 'cleanup $?' EXIT
trap 'exit 130' INT TERM

sql() {
  docker exec -i -e PGPASSWORD="${PI_DB4_PASSWORD}" -e PGAPPNAME="$1" \
    -e PGOPTIONS='-c statement_timeout=25000 -c lock_timeout=15000 -c idle_in_transaction_session_timeout=30000' \
    "${PI_DB4_CONTAINER}" psql -X -qAt --set ON_ERROR_STOP=1 \
      --username postgres --dbname "${PI_DB4_DATABASE}"
}
fail() {
  print -u2 -r -- "DB4_NATIVE_M3_CONCURRENCY_FAILED: $1"
  # Emit bounded synthetic diagnostics before EXIT cleanup, including failure
  # before the second session launches or the holder's readiness marker exists.
  local log
  for log in "${probe_dir}/holder.out" "${probe_dir}/waiter.out"; do
    if [[ -f ${log} ]]; then sed -n '1,120p' "${log}" >&2; fi
  done
  exit "${2:-1}"
}
wait_ready() {
  local slot=$1 ready attempt ready_status
  for attempt in {1..200}; do
    ready_status=0
    ready=$(sql native82-observer <<SQL
select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
  where l.locktype='advisory' and l.classid=8182 and l.objid=${slot}
    and l.objsubid=2 and l.granted and a.application_name='native82-holder'
    and a.datname=current_database());
SQL
) || ready_status=$?
    if (( ready_status != 0 )); then fail "readiness observer failed" "${ready_status}"; fi
    [[ ${ready} == t ]] && return 0
    sleep 0.05
  done
  fail "holder readiness marker ${slot} missing"
}
finish_pair() {
  local holder_status=0 waiter_status=0
  wait "${children[1]}" || holder_status=$?
  wait "${children[2]}" || waiter_status=$?
  children=()
  if (( holder_status != 0 || waiter_status != 0 )); then
    fail "parallel statuses ${holder_status}/${waiter_status}" \
      "$(( holder_status != 0 ? holder_status : waiter_status ))"
  fi
}

sql native82-setup <<'SQL'
begin;
do $$
begin
  if (select count(*) from native_m3_fixture.published) <> 1 then
    raise exception 'DB4_NATIVE82_COMMITTED_FIRST_RELEASE_REQUIRED';
  end if;
  if not exists(select 1 from native_m3_fixture.published
    where response#>>'{result,id}'='release:native81-release') then
    raise exception 'DB4_NATIVE82_WRONG_FIXTURE';
  end if;
end $$;
create table native_m3_fixture.checkpoints(name text primary key, value jsonb not null);
revoke all on schema native_m3_fixture from public, anon, authenticated, service_role;
revoke all on all tables in schema native_m3_fixture from public, anon, authenticated, service_role;

-- Invoker-only test helpers. Nothing here grants a human business-table access.
create function native_m3_fixture.snapshot(exclude_authority boolean default false)
returns jsonb language plpgsql as $$
declare t record; item jsonb; result jsonb := '{}'; exclusion text;
begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','project_intelligence','projectceo_foundation',
      'projectceo_product','projectceo_m3','projectceo_m4') and c.relkind='r'
    order by n.nspname,c.relname loop
    exclusion := '';
    if exclude_authority and t.nspname='project_intelligence' and t.relname='organization_members' then
      exclusion := $where$ where not (t.user_id='31111111-1111-4111-8111-111111111111'::uuid
        and t.organization_id=(select (context#>>'{scope,organizationId}')::uuid
          from native_m3_fixture.published))$where$;
    end if;
    execute format('select jsonb_build_object(''count'',count(*),''digest'',
      md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')))
      from %I.%I t%s',t.nspname,t.relname,exclusion) into item;
    result := result || jsonb_build_object(t.nspname||'.'||t.relname,item);
  end loop;
  return result;
end $$;

create function native_m3_fixture.release_sql(context jsonb, command_ref text)
returns text language sql immutable as $$
  select format('select projectceo_product_api.publish_work_package_release_request_bound(%L,%L,%L,%L,%L,%L,%L)',
    context#>>'{scope,projectId}',context#>>'{scope,packageId}',context->>'baselineId',
    context->>'previousVersionId',context->>'stateRevision',command_ref,command_ref)
$$;

create function native_m3_fixture.replay_first() returns void language plpgsql as $$
declare saved record; replay jsonb;
begin
  select * into strict saved from native_m3_fixture.published;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  replay := projectceo_product_api.publish_work_package_release_request_bound(
    (saved.context#>>'{scope,projectId}')::uuid,(saved.context#>>'{scope,packageId}')::uuid,
    saved.context->>'baselineId',saved.context->>'previousVersionId',
    (saved.context->>'stateRevision')::bigint,'native81-release','native81-release');
  reset role;
  if replay is distinct from jsonb_set(saved.response,'{replay}','true'::jsonb) then
    raise exception 'DB4_NATIVE82_REPLAY_ENVELOPE_CHANGED';
  end if;
end $$;

-- Affirmative publication evidence, not merely an unchanged table snapshot:
-- exactly one inner publication command and exactly one audit event must name
-- this first release, with the original actor, result, state and exact metadata.
create function native_m3_fixture.first_publication_evidence() returns jsonb language plpgsql as $$
declare saved record; inner_command record; publication_audit record;
  organization uuid; project uuid; release_id text;
begin
  select * into strict saved from native_m3_fixture.published;
  organization := (saved.context#>>'{scope,organizationId}')::uuid;
  project := (saved.context#>>'{scope,projectId}')::uuid;
  release_id := saved.response#>>'{result,id}';
  if (select count(*) from projectceo_product.command_records c
      where c.organization_id=organization and c.project_id=project
        and c.operation='publish_production_package_version' and c.logical_result->>'id'=release_id) <> 1
    or (select count(*) from projectceo_product.audit_events a
      where a.organization_id=organization and a.project_id=project
        and a.event_type='production_package_version_published'
        and a.controlled_metadata->>'production_package_version_id'=release_id) <> 1 then
    raise exception 'DB4_NATIVE82_FIRST_PUBLICATION_COMMAND_OR_AUDIT_NOT_EXACTLY_ONCE';
  end if;
  select * into strict inner_command from projectceo_product.command_records c
    where c.organization_id=organization and c.project_id=project
      and c.operation='publish_production_package_version' and c.logical_result->>'id'=release_id;
  select * into strict publication_audit from projectceo_product.audit_events a
    where a.organization_id=organization and a.project_id=project
      and a.event_type='production_package_version_published'
      and a.controlled_metadata->>'production_package_version_id'=release_id;
  if inner_command.actor_type is distinct from 'human'
    or inner_command.actor_id is distinct from '31111111-1111-4111-8111-111111111111'
    or inner_command.actor_user_id is distinct from '31111111-1111-4111-8111-111111111111'::uuid
    or inner_command.logical_result is distinct from saved.response->'result'
    or inner_command.resulting_state_revision is distinct from (saved.response->>'stateRevision')::bigint
    or inner_command.key_digest is distinct from project_intelligence._sha256_text(
      'work-release:'||encode(project_intelligence._sha256_text('native81-release'),'hex'))
    or publication_audit.command_id is distinct from inner_command.command_id
    or publication_audit.actor_type is distinct from 'human'
    or publication_audit.actor_id is distinct from inner_command.actor_id
    or publication_audit.controlled_metadata is distinct from jsonb_build_object(
      'baseline_id',saved.context->>'baselineId',
      'package_id',saved.context#>>'{scope,packageId}',
      'production_package_version_id',release_id,
      'semantic_hash',saved.response#>>'{result,semanticHash}',
      'version_no',saved.response#>'{result,versionNo}') then
    raise exception 'DB4_NATIVE82_FIRST_PUBLICATION_ACTOR_METADATA_OR_COMMAND_MISMATCH';
  end if;
  return jsonb_build_object('innerCommand',to_jsonb(inner_command),'publicationAudit',to_jsonb(publication_audit));
end $$;

create function native_m3_fixture.denied(command text, expected text,
  actor text default '31111111-1111-4111-8111-111111111111', reason text default null)
returns void language plpgsql as $$
declare actual text; detail text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',actor,true);
  begin
    execute command;
  exception when others then
    get stacked diagnostics actual=returned_sqlstate, detail=pg_exception_detail;
  end;
  reset role;
  if actual is distinct from expected or
    (reason is not null and coalesce(nullif(detail,''),'{}')::jsonb->>'reason' is distinct from reason) then
    raise exception 'DB4_NATIVE82_EXPECTED_%_GOT_%:%',expected,coalesce(actual,'success'),detail;
  end if;
end $$;

-- Read a new snapshot of backend activity on every iteration. Sleep merely
-- bounds polling; success requires an observed, actual blocker relationship.
create function native_m3_fixture.await_waiter(checkpoint_name text)
returns void language plpgsql as $$
declare waiter record; deadline timestamptz := clock_timestamp()+interval '20 seconds';
begin
  loop
    perform pg_stat_clear_snapshot();
    select a.pid,a.wait_event_type,a.wait_event,pg_blocking_pids(a.pid) blockers
      into waiter from pg_stat_activity a
      where a.datname=current_database() and a.application_name='native82-waiter'
        and a.state='active' and a.wait_event_type='Lock'
        and pg_backend_pid()=any(pg_blocking_pids(a.pid));
    if found then
      insert into native_m3_fixture.checkpoints values(checkpoint_name,
        jsonb_build_object('holderPid',pg_backend_pid(),'waiterPid',waiter.pid,
          'waitEventType',waiter.wait_event_type,'waitEvent',waiter.wait_event,
          'blockingPids',to_jsonb(waiter.blockers)));
      return;
    end if;
    if clock_timestamp()>=deadline then raise exception 'DB4_NATIVE82_NO_LOCK_OVERLAP:%',checkpoint_name; end if;
    perform pg_sleep(0.025);
  end loop;
end $$;

insert into native_m3_fixture.checkpoints values
  ('before-authority',native_m3_fixture.snapshot()),
  ('except-authority',native_m3_fixture.snapshot(true));
insert into native_m3_fixture.checkpoints
select 'authority-row',to_jsonb(m) from project_intelligence.organization_members m
where m.user_id='31111111-1111-4111-8111-111111111111'
  and m.organization_id=(select (context#>>'{scope,organizationId}')::uuid from native_m3_fixture.published)
  and m.status='active';
do $$
declare current_context jsonb;
begin
  if not exists(select 1 from native_m3_fixture.checkpoints where name='authority-row') then
    raise exception 'DB4_NATIVE82_ACTIVE_AUTHORITY_REQUIRED';
  end if;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  current_context := projectceo_m3_api.get_native_m3_release_context(
    '41111111-1111-4111-8111-111111111111','81777777-7777-4777-8777-777777777777')->'data';
  reset role;
  insert into native_m3_fixture.checkpoints values('current-context',current_context);
end $$;
revoke all on all functions in schema native_m3_fixture from public, anon, authenticated, service_role;
commit;
SQL

# Replay completes first and retains its real authority row lock. Revocation
# must wait for that successful transaction before changing the authority row.
sql native82-holder >"${probe_dir}/holder.out" 2>&1 <<'SQL' &
begin;
select native_m3_fixture.replay_first();
select pg_advisory_xact_lock(8182,1);
select native_m3_fixture.await_waiter('overlap-replay-first');
commit;
SQL
children+=($!)
wait_ready 1
sql native82-waiter >"${probe_dir}/waiter.out" 2>&1 <<'SQL' &
begin;
-- Deliberate privileged authority fault injection in this disposable fixture.
update project_intelligence.organization_members set status='inactive'
where user_id='31111111-1111-4111-8111-111111111111'
  and organization_id=(select (context#>>'{scope,organizationId}')::uuid from native_m3_fixture.published);
commit;
SQL
children+=($!)
finish_pair

sql native82-after-first <<'SQL'
begin;
do $$
begin
  if native_m3_fixture.snapshot(true) is distinct from
    (select value from native_m3_fixture.checkpoints where name='except-authority') then
    raise exception 'DB4_NATIVE82_REPLAY_OR_REVOCATION_MUTATED_BUSINESS';
  end if;
  if not exists(select 1 from project_intelligence.organization_members m
    join native_m3_fixture.checkpoints c on c.name='authority-row'
      and m.organization_id=(c.value->>'organization_id')::uuid
      and m.user_id=(c.value->>'user_id')::uuid
    where to_jsonb(m)=jsonb_set(c.value,'{status}','"inactive"')) then
    raise exception 'DB4_NATIVE82_AUTHORITY_FAULT_NOT_EXACT';
  end if;
  perform native_m3_fixture.denied(native_m3_fixture.release_sql(
    (select context from native_m3_fixture.published),'native81-release'),'P1103');
  perform native_m3_fixture.denied(native_m3_fixture.release_sql(
    (select value from native_m3_fixture.checkpoints where name='current-context'),'native82-revoked-new'),'P1103');
end $$;
update project_intelligence.organization_members m set status=c.value->>'status'
from native_m3_fixture.checkpoints c where c.name='authority-row'
  and m.organization_id=(c.value->>'organization_id')::uuid and m.user_id=(c.value->>'user_id')::uuid;
select native_m3_fixture.replay_first();
do $$ begin
  if native_m3_fixture.snapshot() is distinct from
    (select value from native_m3_fixture.checkpoints where name='before-authority') then
    raise exception 'DB4_NATIVE82_FIRST_RESTORE_OR_REPLAY_MUTATED_BUSINESS';
  end if;
end $$;
commit;
SQL

# Revoke first, but keep it uncommitted while the new public call initially
# sees active authority. Its FOR SHARE must wait, then reauthorize to P1103.
sql native82-holder >"${probe_dir}/holder.out" 2>&1 <<'SQL' &
begin;
update project_intelligence.organization_members set status='inactive'
where user_id='31111111-1111-4111-8111-111111111111'
  and organization_id=(select (context#>>'{scope,organizationId}')::uuid from native_m3_fixture.published);
select pg_advisory_xact_lock(8182,2);
select native_m3_fixture.await_waiter('overlap-revocation-first');
commit;
SQL
children+=($!)
wait_ready 2
sql native82-waiter >"${probe_dir}/waiter.out" 2>&1 <<'SQL' &
begin;
select native_m3_fixture.denied(native_m3_fixture.release_sql(
  (select value from native_m3_fixture.checkpoints where name='current-context'),'native82-wait-revocation'),'P1103');
commit;
SQL
children+=($!)
finish_pair

sql native82-after-revocation <<'SQL'
begin;
do $$ begin
  if native_m3_fixture.snapshot(true) is distinct from
    (select value from native_m3_fixture.checkpoints where name='except-authority') then
    raise exception 'DB4_NATIVE82_POST_WAIT_REFUSAL_MUTATED_BUSINESS';
  end if;
end $$;
update project_intelligence.organization_members m set status=c.value->>'status'
from native_m3_fixture.checkpoints c where c.name='authority-row'
  and m.organization_id=(c.value->>'organization_id')::uuid and m.user_id=(c.value->>'user_id')::uuid;
select native_m3_fixture.replay_first();
do $$ begin
  if native_m3_fixture.snapshot() is distinct from
    (select value from native_m3_fixture.checkpoints where name='before-authority') then
    raise exception 'DB4_NATIVE82_SECOND_RESTORE_OR_REPLAY_MUTATED_BUSINESS';
  end if;
end $$;
commit;
SQL

# Current handoff identity and its persisted commit are read afresh; DB83 may
# have advanced both. No approved commit, release or impact is seeded privately.
sql native82-holder >"${probe_dir}/holder.out" 2>&1 <<'SQL' &
begin;
do $$
declare handoff record; s bigint;
begin
  select * into strict handoff from projectceo_product.m2_workspace_revisions
    where project_id='41111111-1111-4111-8111-111111111111'
      and package_id='81777777-7777-4777-8777-777777777777'
      and entity_kind='m2_m3_handoff' and entity_id='native81-handoff'
    order by revision_no desc limit 1;
  select state_revision into strict s from project_intelligence.project_workflows
    where project_id=handoff.project_id;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  perform projectceo_product_api.publish_m2_m3_handoff(handoff.project_id,handoff.package_id,
    handoff.entity_id,'native82-race-handoff',handoff.revision_id,
    handoff.payload->>'approvedCommitId',handoff.payload->>'approvedCommitRevisionId',
    'Synthetic workflow lock overlap',s,'native82-race-handoff');
  reset role;
end $$;
insert into native_m3_fixture.checkpoints values('after-human-handoff',native_m3_fixture.snapshot());
select pg_advisory_xact_lock(8182,3);
select native_m3_fixture.await_waiter('overlap-workflow-context');
commit;
SQL
children+=($!)
wait_ready 3
sql native82-waiter >"${probe_dir}/waiter.out" 2>&1 <<'SQL' &
begin;
select native_m3_fixture.denied(native_m3_fixture.release_sql(
  (select value from native_m3_fixture.checkpoints where name='current-context'),'native82-old-context'),'P1107');
commit;
SQL
children+=($!)
finish_pair

sql native82-checkpoint <<'SQL'
begin;
select native_m3_fixture.replay_first();
do $$
declare before_data jsonb; after_data jsonb; table_name text;
begin
  after_data := native_m3_fixture.snapshot();
  if after_data is distinct from (select value from native_m3_fixture.checkpoints where name='after-human-handoff') then
    raise exception 'DB4_NATIVE82_STALE_RELEASE_OR_REPLAY_MUTATED_BUSINESS';
  end if;
  select value into strict before_data from native_m3_fixture.checkpoints where name='before-authority';
  foreach table_name in array array['projectceo_product.production_package_versions',
    'projectceo_product.production_package_version_refs','projectceo_m3.production_package_native_contexts'] loop
    if after_data->table_name is distinct from before_data->table_name then
      raise exception 'DB4_NATIVE82_EXTRA_OR_OVERWRITTEN_RELEASE:%',table_name;
    end if;
  end loop;
  if (select count(*) from native_m3_fixture.checkpoints where name like 'overlap-%') <> 3 then
    raise exception 'DB4_NATIVE82_MISSING_LOCK_PROOF';
  end if;
  if not exists(select 1 from native_m3_fixture.published p
    join projectceo_m3.production_package_native_contexts c
      on c.project_id=(p.context#>>'{scope,projectId}')::uuid
        and c.production_package_version_id=p.response#>>'{result,id}'
    where c.context=p.context and c.context_digest=p.context->>'contextDigest') then
    raise exception 'DB4_NATIVE82_FIRST_CONTEXT_OVERWRITTEN';
  end if;
end $$;
insert into native_m3_fixture.checkpoints values
  ('before-restart',native_m3_fixture.snapshot()),
  ('server-start-before-restart',to_jsonb(pg_postmaster_start_time())),
  ('first-publication-evidence',native_m3_fixture.first_publication_evidence());
insert into native_m3_fixture.checkpoints
select 'restart-state-and-counts',jsonb_build_object(
  'stateRevision',(select state_revision from project_intelligence.project_workflows
    where project_id='41111111-1111-4111-8111-111111111111'),
  'productCommands',value#>'{projectceo_product.command_records,count}',
  'productAudit',value#>'{projectceo_product.audit_events,count}',
  'foundationCommands',value#>'{projectceo_foundation.command_records,count}',
  'foundationAudit',value#>'{projectceo_foundation.audit_events,count}',
  'coreCommands',value#>'{project_intelligence.command_records,count}',
  'coreAudit',value#>'{project_intelligence.audit_events,count}')
from native_m3_fixture.checkpoints where name='before-restart';
insert into native_m3_fixture.checkpoints
select 'first-release-before-restart',jsonb_build_object('context',context,'response',response)
from native_m3_fixture.published;
commit;
select 'DB4_NATIVE_M3_LOCK_OVERLAP_REPLAY_REVOCATION_CONTEXT_OK';
SQL
