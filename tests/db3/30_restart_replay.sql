\set ON_ERROR_STOP on

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $restart_replay$
declare
  v_result jsonb;
begin
  v_result := projectceo_api.enroll_organization_project(
    '41111111-1111-4111-8111-111111111111',
    'db3-enroll-owner'
  );
  if (v_result ->> 'replay')::boolean is not true then
    raise exception 'DB3_RESTART_REPLAY_FALSE';
  end if;
end
$restart_replay$;
commit;

do $restart_count$
begin
  if (
    select count(*)
    from project_intelligence.project_workflows
    where project_id = '41111111-1111-4111-8111-111111111111'
  ) <> 1 then
    raise exception 'DB3_RESTART_DUPLICATE_WORKFLOW';
  end if;
end
$restart_count$;

select 'DB3_RESTART_REPLAY_OK' as result;
