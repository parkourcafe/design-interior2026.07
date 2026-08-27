\set ON_ERROR_STOP on

-- Disposable-only M4 V2/V3 owner gate for AP1/AP6.
-- This file is never a migration and must not be run against production. The
-- general M4 application flag is a separate hard-off; both gates are required.
-- The three command doors plus replay are the complete approved V2/V3 surface.

begin;

grant execute on function
  projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text),
  projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text),
  projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text),
  projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text),
  projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text),
  projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)
  to authenticated;

-- Milestone definition is an explicit local precondition helper, not a client
-- command in the M4 surface. It is needed to create the AP1 acceptance target.
grant execute on function
  projectceo_m4_api.define_milestone(uuid, uuid, text, text, jsonb, bigint, text)
  to authenticated;

do $enabled$
declare
  v_missing text;
  v_leaked text;
begin
  select signature into v_missing
  from unnest(array[
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)',
    'projectceo_m4_api.define_milestone(uuid, uuid, text, text, jsonb, bigint, text)'
  ]) signature
  where not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  limit 1;
  if v_missing is not null then
    raise exception 'PROJECTCEO_M4_V2_V3_NOT_ENABLED:%', v_missing;
  end if;

  select format('%s:%s', role_name, signature) into v_leaked
  from unnest(array['anon', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)',
    'projectceo_m4_api.define_milestone(uuid, uuid, text, text, jsonb, bigint, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_leaked is not null then
    raise exception 'PROJECTCEO_M4_V2_V3_WRONG_ROLE:%', v_leaked;
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M4_WORKER_HUMAN_LEAKED';
  end if;
end
$enabled$;

commit;

select 'AP1_M4_V2_V3_OWNER_GO_OK' as result;
