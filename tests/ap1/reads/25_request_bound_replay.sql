\set ON_ERROR_STOP on

select
  review.impact_run_id,
  review.impact_id
from projectceo_m4.impact_reviews review
where review.project_id = '41111111-1111-4111-8111-111111111111'
  and review.protected_reason =
    'Downstream deliverable updated and checked'
\gset ap1_m4_

select
  photo.milestone_id,
  photo.photo_evidence_id,
  photo.captured_at,
  photo.area_node_id,
  photo.source_id,
  photo.source_revision_id,
  photo.protected_note
from projectceo_m4.photo_evidence photo
where photo.project_id = '41111111-1111-4111-8111-111111111111'
  and photo.protected_note = 'Field photo after installation'
\gset ap1_m4_

select
  workflow.state_revision,
  (select count(*) from projectceo_product.command_records) command_count,
  (select count(*) from projectceo_product.audit_events) audit_count
from project_intelligence.project_workflows workflow
where workflow.project_id = '41111111-1111-4111-8111-111111111111'
\gset ap1_m4_before_

select
  set_config(
    'projectceo.ap1_m4_impact_run_id',
    :'ap1_m4_impact_run_id',
    false
  ),
  set_config(
    'projectceo.ap1_m4_impact_id',
    :'ap1_m4_impact_id',
    false
  ),
  set_config(
    'projectceo.ap1_m4_milestone_id',
    :'ap1_m4_milestone_id',
    false
  ),
  set_config(
    'projectceo.ap1_m4_area_node_id',
    :'ap1_m4_area_node_id',
    false
  ),
  set_config(
    'projectceo.ap1_m4_source_id',
    :'ap1_m4_source_id',
    false
  ),
  set_config(
    'projectceo.ap1_m4_source_revision_id',
    :'ap1_m4_source_revision_id',
    false
  ),
  set_config(
    'projectceo.ap1_m4_captured_at',
    :'ap1_m4_captured_at',
    false
  ),
  set_config(
    'projectceo.ap1_m4_protected_note',
    :'ap1_m4_protected_note',
    false
  ),
  set_config(
    'projectceo.ap1_m4_photo_evidence_id',
    :'ap1_m4_photo_evidence_id',
    false
  ),
  set_config(
    'projectceo.ap1_m4_before_state',
    :'ap1_m4_before_state_revision',
    false
  ),
  set_config(
    'projectceo.ap1_m4_before_commands',
    :'ap1_m4_before_command_count',
    false
  ),
  set_config(
    'projectceo.ap1_m4_before_audit',
    :'ap1_m4_before_audit_count',
    false
  );

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '31111111-1111-4111-8111-111111111111';
do $ap1_m4_exact_replays$
declare
  v_replay jsonb;
begin
  v_replay := projectceo_m4_api.replay_submit_change_request(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111',
    'baseline-db4-v1',
    'baseline-db5-v2',
    'package-db4-root-v1',
    'Client approved a floor finish replacement',
    175000,
    4,
    'db5-submit-change'
  );
  if coalesce((v_replay ->> 'replay')::boolean, false) is not true
     or v_replay ->> 'operation' <> 'submit_change_request' then
    raise exception 'AP1_M4_CHANGE_REPLAY_MISSING';
  end if;

  v_replay := projectceo_m4_api.replay_review_change_impact(
    '41111111-1111-4111-8111-111111111111',
    current_setting('projectceo.ap1_m4_impact_run_id')::uuid,
    current_setting('projectceo.ap1_m4_impact_id'),
    'resolved',
    'Downstream deliverable updated and checked',
    'db5-review-impact'
  );
  if coalesce((v_replay ->> 'replay')::boolean, false) is not true
     or v_replay ->> 'operation' <> 'review_change_impact' then
    raise exception 'AP1_M4_IMPACT_REPLAY_MISSING';
  end if;

  v_replay := projectceo_m4_api.replay_register_photo_evidence(
    '41111111-1111-4111-8111-111111111111',
    current_setting('projectceo.ap1_m4_milestone_id')::uuid,
    current_setting('projectceo.ap1_m4_area_node_id'),
    current_setting('projectceo.ap1_m4_source_id'),
    current_setting('projectceo.ap1_m4_source_revision_id'),
    current_setting('projectceo.ap1_m4_captured_at')::timestamptz,
    current_setting('projectceo.ap1_m4_protected_note'),
    'db5-register-photo'
  );
  if coalesce((v_replay ->> 'replay')::boolean, false) is not true
     or v_replay ->> 'operation' <> 'register_photo_evidence' then
    raise exception 'AP1_M4_PHOTO_REGISTER_REPLAY_MISSING';
  end if;

  v_replay := projectceo_m4_api.replay_review_photo_evidence(
    '41111111-1111-4111-8111-111111111111',
    current_setting('projectceo.ap1_m4_photo_evidence_id')::uuid,
    'accepted',
    'Photo confirms accepted work in the exact area',
    'db5-review-photo'
  );
  if coalesce((v_replay ->> 'replay')::boolean, false) is not true
     or v_replay ->> 'operation' <> 'review_photo_evidence' then
    raise exception 'AP1_M4_PHOTO_REVIEW_REPLAY_MISSING';
  end if;

  v_replay := projectceo_m4_api.replay_accept_milestone(
    '41111111-1111-4111-8111-111111111111',
    current_setting('projectceo.ap1_m4_milestone_id')::uuid,
    'db5-accept-milestone'
  );
  if coalesce((v_replay ->> 'replay')::boolean, false) is not true
     or v_replay ->> 'operation' <> 'accept_milestone' then
    raise exception 'AP1_M4_MILESTONE_REPLAY_MISSING';
  end if;

  begin
    perform projectceo_m4_api.replay_submit_change_request(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'baseline-db4-v1',
      'baseline-db5-v2',
      'package-db4-root-v1',
      'Changed reason under an accepted command key',
      175000,
      4,
      'db5-submit-change'
    );
    raise exception 'AP1_M4_CHANGED_PAYLOAD_REUSED_KEY';
  exception when sqlstate 'P1108' then null;
  end;
end
$ap1_m4_exact_replays$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '32222222-2222-4222-8222-222222222222';
do $ap1_m4_wrong_actor_before_replay$
begin
  begin
    perform projectceo_m4_api.replay_submit_change_request(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'baseline-db4-v1',
      'baseline-db5-v2',
      'package-db4-root-v1',
      'Client approved a floor finish replacement',
      175000,
      4,
      'db5-submit-change'
    );
    raise exception 'AP1_M4_WRONG_ACTOR_REPLAYED';
  exception when sqlstate 'P1103' then null;
  end;
end
$ap1_m4_wrong_actor_before_replay$;
rollback;

do $ap1_m4_replay_read_only$
begin
  if (
    select state_revision
    from project_intelligence.project_workflows
    where project_id = '41111111-1111-4111-8111-111111111111'
  ) <> current_setting('projectceo.ap1_m4_before_state')::bigint
     or (select count(*) from projectceo_product.command_records) <>
       current_setting('projectceo.ap1_m4_before_commands')::bigint
     or (select count(*) from projectceo_product.audit_events) <>
       current_setting('projectceo.ap1_m4_before_audit')::bigint
  then
    raise exception 'AP1_M4_REPLAY_PROBE_MUTATED_STATE';
  end if;
end
$ap1_m4_replay_read_only$;

select 'AP1_M4_REQUEST_BOUND_REPLAY_OK' as result;
