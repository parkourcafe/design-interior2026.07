\set ON_ERROR_STOP on

-- DB4-62 runs after a populated upgrade: DB4-20 published this historical
-- child through the original API before the native binding migration. Its
-- actor-bound replay remains valid without invented native lineage. New
-- publication needs the complete native human command chain tested in DB4-81.
begin;
do $strict_work_package_release$
declare
  p uuid := '41111111-1111-4111-8111-111111111111';
  k uuid := '49999999-9999-4999-8999-999999999999';
  s bigint; b text; previous text; detail text; t record; digest text;
  legacy record; legacy_version record; legacy_state bigint; replay jsonb; sources jsonb;
  before_data jsonb := '{}'::jsonb; after_data jsonb := '{}'::jsonb;
begin
  select * into strict legacy_version from projectceo_product.production_package_versions
    where project_id=p and production_package_version_id='release:db4-publish-work-package-v1';
  if legacy_version.package_id is distinct from k
    or legacy_version.baseline_id is distinct from 'baseline:db4-publish-baseline-v1'
    or legacy_version.previous_version_id is not null then
    raise exception 'DB4_WORK_PACKAGE_LEGACY_VERSION_FIXTURE_CHANGED';
  end if;
  select * into strict legacy from projectceo_product.command_records c
    where c.project_id=p and c.operation='publish_work_package_release_request_bound'
      and c.key_digest=project_intelligence._sha256_text('db4-publish-work-package-v1');
  -- The existing raw publication increments state once; verify the derived
  -- original input against its persisted request digest before replaying it.
  legacy_state := legacy.resulting_state_revision - 1;
  if legacy.actor_type is distinct from 'human'
    or legacy.actor_user_id is distinct from '31111111-1111-4111-8111-111111111111'::uuid
    or legacy.logical_result->>'id' is distinct from legacy_version.production_package_version_id
    or legacy.request_digest is distinct from project_intelligence._sha256_jsonb(jsonb_build_object(
      'commandRef','db4-publish-work-package-v1','expectedBaselineId',legacy_version.baseline_id,
      'expectedPreviousVersionId',null,'expectedStateRevision',legacy_state,
      'operation','publish_work_package_release_request_bound','packageId',k,'projectId',p)) then
    raise exception 'DB4_WORK_PACKAGE_LEGACY_COMMAND_FIXTURE_CHANGED';
  end if;
  if exists(select 1 from projectceo_m3.production_package_native_contexts
    where project_id=p and production_package_version_id=legacy_version.production_package_version_id) then
    raise exception 'DB4_WORK_PACKAGE_LEGACY_LINEAGE_WAS_INVENTED';
  end if;
  if not exists (
    select 1 from projectceo_foundation.source_materializations m
    where m.project_id=p and m.package_id=k
      and m.source_revision_id='revision-source-1'
  ) then raise exception 'DB4_WORK_PACKAGE_SOURCE_FIXTURE_MISSING'; end if;
  select coalesce(jsonb_agg(revision_id order by ordinal),'[]'::jsonb) into sources
    from projectceo_product.production_package_version_refs
    where project_id=p and production_package_version_id=legacy_version.production_package_version_id
      and target_kind='source_revision';
  if sources is distinct from '["revision-source-1"]'::jsonb then
    raise exception 'DB4_WORK_PACKAGE_LEGACY_SOURCE_SCOPE_CHANGED';
  end if;
  select state_revision into strict s from project_intelligence.project_workflows where project_id=p;
  select baseline_id into strict b from projectceo_product.project_baselines
    where project_id=p and published_at is not null order by version_no desc limit 1;
  select production_package_version_id into previous from projectceo_product.production_package_versions
    where project_id=p and package_id=k order by version_no desc limit 1;
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('project_intelligence','projectceo_foundation','projectceo_product','projectceo_m3')
      and c.relkind='r' order by n.nspname,c.relname loop
    execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',t.nspname,t.relname) into digest;
    before_data := before_data || jsonb_build_object(t.nspname||'.'||t.relname,digest);
  end loop;
  set local role authenticated;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  replay := projectceo_product_api.publish_work_package_release_request_bound(
    p,k,legacy_version.baseline_id,null,legacy_state,
    'db4-publish-work-package-v1','db4-publish-work-package-v1');
  if replay is distinct from jsonb_build_object(
    'operation','publish_work_package_release_request_bound','replay',true,
    'stateRevision',legacy.resulting_state_revision,'result',legacy.logical_result) then
    raise exception 'DB4_WORK_PACKAGE_LEGACY_REPLAY_ENVELOPE_CHANGED';
  end if;
  begin
    perform projectceo_product_api.publish_work_package_release_request_bound(
      p,k,legacy_version.baseline_id,null,legacy_state,
      'db4-62-changed-legacy-command','db4-publish-work-package-v1');
    raise exception 'DB4_WORK_PACKAGE_LEGACY_REPLAY_INPUT_CHANGED';
  exception when sqlstate 'P1108' then null; end;
  -- DB3 enrolled this second actor as an architect. Require the precise replay
  -- mismatch reason, rather than accepting an unrelated authorization denial.
  set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
  begin
    perform projectceo_product_api.publish_work_package_release_request_bound(
      p,k,legacy_version.baseline_id,null,legacy_state,
      'db4-publish-work-package-v1','db4-publish-work-package-v1');
    raise exception 'DB4_WORK_PACKAGE_LEGACY_REPLAY_ACTOR_CHANGED';
  exception when sqlstate 'P1103' then
    get stacked diagnostics detail = pg_exception_detail;
    if detail::jsonb->>'reason' is distinct from 'IDEMPOTENCY_ACTOR_MISMATCH' then
      raise exception 'DB4_WORK_PACKAGE_LEGACY_WRONG_ACTOR_DENIAL:%',detail;
    end if;
  end;
  set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
  begin
    perform projectceo_product_api.publish_work_package_release_request_bound(
      p,k,b,previous,s,'db4-62-incomplete','db4-62-incomplete');
    raise exception 'DB4_WORK_PACKAGE_NATIVE_GATE_BYPASSED';
  exception when sqlstate 'P1111' then
    get stacked diagnostics detail = pg_exception_detail;
    if detail::jsonb->>'reason' is distinct from 'NATIVE_CONTEXT_CONFIRMATION_REQUIRED' then
      raise exception 'DB4_WORK_PACKAGE_WRONG_VALIDATION:%',detail;
    end if;
  end;
  reset role;
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('project_intelligence','projectceo_foundation','projectceo_product','projectceo_m3')
      and c.relkind='r' order by n.nspname,c.relname loop
    execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',t.nspname,t.relname) into digest;
    after_data := after_data || jsonb_build_object(t.nspname||'.'||t.relname,digest);
  end loop;
  if before_data is distinct from after_data then raise exception 'DB4_WORK_PACKAGE_REPLAY_OR_DENIAL_WROTE_DATA'; end if;
  if exists(select 1 from projectceo_m3.production_package_native_contexts
    where project_id=p and production_package_version_id=legacy_version.production_package_version_id) then
    raise exception 'DB4_WORK_PACKAGE_REPLAY_BACKFILLED_NATIVE_LINEAGE';
  end if;
end
$strict_work_package_release$;
rollback;
select 'DB4_WORK_PACKAGE_RELEASE_REQUEST_BOUND_OK' as result;
