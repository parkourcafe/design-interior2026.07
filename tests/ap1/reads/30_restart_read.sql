\set ON_ERROR_STOP on

begin;
set local role authenticated;
set local request.jwt.claim.sub =
  '34444444-4444-4444-8444-444444444444';
do $ap1_restart_read$
declare
  v_read jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read(
    '41111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_read #> '{data,recipientDistributions}') <> 1
     or v_read #>> '{data,recipientDistributions,0,acknowledged}' <> 'false'
  then
    raise exception 'AP1_RESTART_READ_CHANGED:%', v_read;
  end if;
end
$ap1_restart_read$;
rollback;

select 'AP1_RESTART_READ_OK' as result;
