\set ON_ERROR_STOP on

-- DB4 compatibility check: the M4 V2/V3 RPCs exist and remain closed by the
-- immutable migration guardrail. The disposable AP1 script is intentionally
-- inspected here but not executed, so DB4 retains production-like default deny.

do $compatibility$
declare
  v_missing text;
  v_open text;
begin
  select signature into v_missing
  from unnest(array[
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)'
  ]) signature
  where to_regprocedure(signature) is null
  limit 1;
  if v_missing is not null then
    raise exception 'DB4_M4_V2_V3_SIGNATURE_MISSING:%', v_missing;
  end if;

  select format('%s:%s', role_name, signature) into v_open
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  cross join unnest(array[
    'projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)',
    'projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)',
    'projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)',
    'projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)',
    'projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)',
    'projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)'
  ]) signature
  where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  limit 1;
  if v_open is not null then
    raise exception 'DB4_M4_V2_V3_DEFAULT_DENY_BROKEN:%', v_open;
  end if;
end
$compatibility$;

select 'DB4_M4_V2_V3_COMPATIBILITY_OK' as result;
