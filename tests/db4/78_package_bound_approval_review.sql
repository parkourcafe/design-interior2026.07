\set ON_ERROR_STOP on

begin;

insert into auth.users(id,email,email_confirmed_at) values
 ('77111111-1111-4111-8111-111111111111','owner-77@example.invalid',now()),
 ('77222222-2222-4222-8222-222222222222','architect-77@example.invalid',now()),
 ('77333333-3333-4333-8333-333333333333','builder-77@example.invalid',now()),
 ('77444444-4444-4444-8444-444444444444','client-77@example.invalid',now()),
 ('77999999-9999-4999-8999-999999999999','preserved-77@example.invalid',now());
insert into public.designers(id,name) values
 ('77111111-1111-4111-8111-111111111111','DB4 owner 77');
insert into public.projects(id,designer_id,client_name,intake_token) values
 ('77555555-5555-4555-8555-555555555555','77111111-1111-4111-8111-111111111111','DB4 enrollment 77','db4-enrollment-77');

create temporary table enrollment_77(result jsonb, state_revision bigint) on commit drop;

do $enroll$
declare
  a jsonb;
  b jsonb;
  base jsonb;
  invitation jsonb;
  state bigint;
  token bytea := extensions.digest('db4-77-project-architect', 'sha256');
begin
  set local role authenticated;
  set local request.jwt.claim.sub='77111111-1111-4111-8111-111111111111';
  base := projectceo_api.enroll_organization_project('77555555-5555-4555-8555-555555555555','db4-77-base');
  reset role;
  select state_revision into state from project_intelligence.project_workflows where project_id='77555555-5555-4555-8555-555555555555';
  set local role authenticated;
  set local request.jwt.claim.sub='77111111-1111-4111-8111-111111111111';
  invitation := projectceo_api.create_invitation('77555555-5555-4555-8555-555555555555',null,'preserved-77@example.invalid','architect',statement_timestamp()+interval '1 day',token,state,'db4-77-project-invite');
  set local request.jwt.claim.sub='77999999-9999-4999-8999-999999999999';
  set local request.jwt.claims='{"email":"preserved-77@example.invalid","email_verified":true,"amr":[{"method":"magiclink","timestamp":1770000000}]}';
  perform projectceo_api.accept_invitation(token,'db4-77-project-accept');
  set local request.jwt.claim.sub='77111111-1111-4111-8111-111111111111';
  a := projectceo_api.enroll_organization_project_scope(
    '77555555-5555-4555-8555-555555555555','77666666-6666-4666-8666-666666666666',
    'package-a','Package A',jsonb_build_array(
      jsonb_build_object('userId','77222222-2222-4222-8222-222222222222','role','architect'),
      jsonb_build_object('userId','77333333-3333-4333-8333-333333333333','role','builder'),
      jsonb_build_object('userId','77444444-4444-4444-8444-444444444444','role','client_approver')
    ),'db4-77-package-a');
  b := projectceo_api.enroll_organization_project_scope(
    '77555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777',
    'package-b','Package B','[]'::jsonb,'db4-77-package-b');
  reset role;
  insert into enrollment_77
  select a, state_revision from project_intelligence.project_workflows
  where project_id='77555555-5555-4555-8555-555555555555';
  if b#>>'{result,packageId}' <> '77777777-7777-4777-8777-777777777777' then
    raise exception 'DB4_77_PACKAGE_B_ENROLLMENT_FAILED:%',b;
  end if;
end
$enroll$;

do $scope_shape$
declare org uuid;
begin
  select (result#>>'{result,organizationId}')::uuid into org from enrollment_77;
  if (select count(*) from projectceo_foundation.package_memberships where organization_id=org and project_id='77555555-5555-4555-8555-555555555555' and package_id='77666666-6666-4666-8666-666666666666') <> 3
     or exists(select 1 from projectceo_foundation.project_memberships where organization_id=org and project_id='77555555-5555-4555-8555-555555555555' and user_id in ('77222222-2222-4222-8222-222222222222','77333333-3333-4333-8333-333333333333','77444444-4444-4444-8444-444444444444'))
     or exists(select 1 from projectceo_foundation.package_memberships where organization_id=org and package_id='77777777-7777-4777-8777-777777777777') then
    raise exception 'DB4_77_MEMBER_SCOPE_ESCALATED';
  end if;
  if exists (
    select expected.user_id, expected.capability from (values
      ('77222222-2222-4222-8222-222222222222'::uuid,'view_project'),('77222222-2222-4222-8222-222222222222'::uuid,'review_milestone'),
      ('77333333-3333-4333-8333-333333333333'::uuid,'view_project'),('77333333-3333-4333-8333-333333333333'::uuid,'upload_photo_evidence'),
      ('77444444-4444-4444-8444-444444444444'::uuid,'view_project'),('77444444-4444-4444-8444-444444444444'::uuid,'review_selection')
    ) expected(user_id,capability)
    where not exists(select 1 from projectceo_foundation.package_member_capabilities actual where actual.organization_id=org and actual.project_id='77555555-5555-4555-8555-555555555555' and actual.package_id='77666666-6666-4666-8666-666666666666' and actual.user_id=expected.user_id and actual.capability=expected.capability)
  ) then raise exception 'DB4_77_PACKAGE_CAPABILITIES_INCOMPLETE'; end if;
  if not exists(select 1 from projectceo_foundation.project_member_capabilities where organization_id=org and project_id='77555555-5555-4555-8555-555555555555' and user_id='77111111-1111-4111-8111-111111111111' and capability='manage_access') then
    raise exception 'DB4_77_OWNER_PROJECT_SCOPE_MISSING';
  end if;
  if not exists(select 1 from projectceo_foundation.project_member_capabilities where organization_id=org and project_id='77555555-5555-4555-8555-555555555555' and user_id='77999999-9999-4999-8999-999999999999' and capability='review_source') then
    raise exception 'DB4_77_PREEXISTING_PROJECT_GRANT_NOT_PRESERVED';
  end if;
end
$scope_shape$;

do $validation_and_conflicts$
begin
  set local role authenticated;
  set local request.jwt.claim.sub='77111111-1111-4111-8111-111111111111';
  begin
    perform projectceo_api.enroll_organization_project_scope('77555555-5555-4555-8555-555555555555','77888888-8888-4888-8888-888888888888','invalid-null','Invalid null',null,'db4-77-null');
    raise exception 'DB4_77_NULL_MEMBERS_ACCEPTED';
  exception when sqlstate 'P1111' then null; end;
  begin
    perform projectceo_api.enroll_organization_project_scope('77555555-5555-4555-8555-555555555555','77888888-8888-4888-8888-888888888888','invalid-duplicate','Invalid duplicate',jsonb_build_array(
      jsonb_build_object('userId','77333333-3333-4333-8333-333333333333','role','builder'),jsonb_build_object('userId','77333333-3333-4333-8333-333333333333','role','builder')),'db4-77-duplicate');
    raise exception 'DB4_77_DUPLICATE_MEMBER_ACCEPTED';
  exception when sqlstate 'P1111' then null; end;
  begin
    perform projectceo_api.enroll_organization_project_scope('77555555-5555-4555-8555-555555555555','77888888-8888-4888-8888-888888888888','invalid-role','Invalid role',jsonb_build_array(jsonb_build_object('userId','77333333-3333-4333-8333-333333333333','role','owner_lead')),'db4-77-role');
    raise exception 'DB4_77_INVALID_ROLE_ACCEPTED';
  exception when sqlstate 'P1111' then null; end;
  begin
    perform projectceo_api.enroll_organization_project_scope('77555555-5555-4555-8555-555555555555','77666666-6666-4666-8666-666666666666','package-a-renamed','Package A','[]'::jsonb,'db4-77-package-identity');
    raise exception 'DB4_77_PACKAGE_IDENTITY_REPLACED';
  exception when sqlstate 'P1109' then null; end;
  begin
    perform projectceo_api.enroll_organization_project_scope('77555555-5555-4555-8555-555555555555','77666666-6666-4666-8666-666666666666','package-a','Package A',jsonb_build_array(jsonb_build_object('userId','77333333-3333-4333-8333-333333333333','role','architect')),'db4-77-package-role-conflict');
    raise exception 'DB4_77_PACKAGE_ROLE_REPLACED';
  exception when sqlstate 'P1109' then null; end;
  reset role;
end
$validation_and_conflicts$;

do $reads$
declare value jsonb; actor uuid;
begin
  set local role authenticated;
  foreach actor in array array['77222222-2222-4222-8222-222222222222'::uuid,'77333333-3333-4333-8333-333333333333'::uuid,'77444444-4444-4444-8444-444444444444'::uuid] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    value := projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555','77666666-6666-4666-8666-666666666666');
    if value#>>'{scope,packageId}' <> '77666666-6666-4666-8666-666666666666' then raise exception 'DB4_77_PACKAGE_A_READ_FAILED:%',actor; end if;
    begin perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777'); raise exception 'DB4_77_PACKAGE_B_READ_ESCALATED:%',actor; exception when sqlstate 'P1103' then null; end;
    begin perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555',null); raise exception 'DB4_77_PROJECT_READ_ESCALATED:%',actor; exception when sqlstate 'P1103' then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub','77999999-9999-4999-8999-999999999999',true);
  perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555',null);
  perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
  set local request.jwt.claim.sub='77111111-1111-4111-8111-111111111111';
  perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555',null);
  perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555','77666666-6666-4666-8666-666666666666');
  perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
  reset role;
end
$reads$;

do $replay$
declare original jsonb; replayed jsonb; before_state bigint; after_state bigint;
begin
  select result,state_revision into original,before_state from enrollment_77;
  set local role authenticated; set local request.jwt.claim.sub='77111111-1111-4111-8111-111111111111';
  replayed := projectceo_api.enroll_organization_project_scope('77555555-5555-4555-8555-555555555555','77666666-6666-4666-8666-666666666666','package-a','Package A',jsonb_build_array(
    jsonb_build_object('userId','77222222-2222-4222-8222-222222222222','role','architect'),jsonb_build_object('userId','77333333-3333-4333-8333-333333333333','role','builder'),jsonb_build_object('userId','77444444-4444-4444-8444-444444444444','role','client_approver')),'db4-77-package-a');
  reset role;
  select state_revision into after_state from project_intelligence.project_workflows where project_id='77555555-5555-4555-8555-555555555555';
  if replayed->'result' is distinct from original->'result' or replayed->>'replay' <> 'true' or after_state <> before_state then raise exception 'DB4_77_REPLAY_CHANGED_STATE'; end if;
  begin
    set local role authenticated; set local request.jwt.claim.sub='77111111-1111-4111-8111-111111111111';
    perform projectceo_api.enroll_organization_project_scope('77555555-5555-4555-8555-555555555555','77666666-6666-4666-8666-666666666666','package-a','Changed','[]'::jsonb,'db4-77-package-a');
    raise exception 'DB4_77_CHANGED_PAYLOAD_ACCEPTED';
  exception when sqlstate 'P1108' then null; end;
end
$replay$;

do $approval_review$
declare s bigint; before_s bigint; after_s bigint; e bigint; first jsonb; replayed jsonb; p uuid; nid text; rid text; aid text;
begin
  for p,nid,rid,aid in select * from (values
    ('77666666-6666-4666-8666-666666666666'::uuid,'decision-77-a','decision-77-a-r1','approval-77-a'),
    ('77777777-7777-4777-8777-777777777777'::uuid,'decision-77-b','decision-77-b-r1','approval-77-b')
  ) v(package_id,node_id,revision_id,approval_id) loop
    reset role; select state_revision into s from project_intelligence.project_workflows where project_id='77555555-5555-4555-8555-555555555555';
    set local role authenticated; perform set_config('request.jwt.claim.sub','77111111-1111-4111-8111-111111111111',true);
    perform projectceo_product_api.append_decision_revision('77555555-5555-4555-8555-555555555555',p,nid,rid,null,'human_origin',nid,'Owner decision',null,'proposed','[]'::jsonb,'Owner authored',s,'db4-77-'||nid);
    reset role; select state_revision into s from project_intelligence.project_workflows where project_id='77555555-5555-4555-8555-555555555555';
    set local role authenticated; perform set_config('request.jwt.claim.sub','77111111-1111-4111-8111-111111111111',true);
    perform projectceo_product_api.create_approval_package('77555555-5555-4555-8555-555555555555',p,aid,jsonb_build_array(jsonb_build_object('targetKind','decision_revision','entityId',nid,'revisionId',rid)),s,'db4-77-create-'||aid);
    reset role; select state_revision into s from project_intelligence.project_workflows where project_id='77555555-5555-4555-8555-555555555555';
    set local role authenticated; perform set_config('request.jwt.claim.sub','77111111-1111-4111-8111-111111111111',true);
    perform projectceo_product_api.submit_approval_package('77555555-5555-4555-8555-555555555555',aid,'draft',s,'db4-77-submit-'||aid);
  end loop;
  reset role; select state_revision into before_s from project_intelligence.project_workflows where project_id='77555555-5555-4555-8555-555555555555';
  set local role authenticated; set local request.jwt.claim.sub='77444444-4444-4444-8444-444444444444';
  begin perform projectceo_product_api.review_approval_package('77555555-5555-4555-8555-555555555555','approval-77-b','submitted','approved','Sibling denied',before_s,'db4-77-review-b'); raise exception 'DB4_77_SIBLING_REVIEWED'; exception when sqlstate 'P1103' then null; end;
  set local request.jwt.claim.sub='77333333-3333-4333-8333-333333333333';
  begin perform projectceo_product_api.review_approval_package('77555555-5555-4555-8555-555555555555','approval-77-a','submitted','approved','Builder denied',before_s,'db4-77-review-builder'); raise exception 'DB4_77_BUILDER_REVIEWED'; exception when sqlstate 'P1103' then null; end;
  reset role;
  set local request.jwt.claim.sub='';
  begin perform projectceo_product_api.review_approval_package('77555555-5555-4555-8555-555555555555','approval-77-a','submitted','approved','Anon denied',before_s,'db4-77-review-anon'); raise exception 'DB4_77_ANON_REVIEWED'; exception when sqlstate 'P1101' then null; end;
  set local role authenticated; set local request.jwt.claim.sub='77444444-4444-4444-8444-444444444444';
  first:=projectceo_product_api.review_approval_package('77555555-5555-4555-8555-555555555555','approval-77-a','submitted','approved','Client approves A',before_s,'db4-77-review-a');
  reset role; select state_revision into after_s from project_intelligence.project_workflows where project_id='77555555-5555-4555-8555-555555555555';
  select count(*) into e from projectceo_product.approval_package_events where project_id='77555555-5555-4555-8555-555555555555' and approval_package_id='approval-77-a' and to_status='approved';
  set local role authenticated; set local request.jwt.claim.sub='77444444-4444-4444-8444-444444444444';
  replayed:=projectceo_product_api.review_approval_package('77555555-5555-4555-8555-555555555555','approval-77-a','submitted','approved','Client approves A',before_s,'db4-77-review-a');
  reset role;
  if after_s<>before_s+1 or e<>1 or replayed->'result' is distinct from first->'result' or replayed->>'replay'<>'true'
    or (select state_revision from project_intelligence.project_workflows where project_id='77555555-5555-4555-8555-555555555555')<>after_s
    or (select count(*) from projectceo_product.approval_package_events where project_id='77555555-5555-4555-8555-555555555555' and approval_package_id='approval-77-a' and to_status='approved')<>e then raise exception 'DB4_77_REVIEW_REPLAY_INVALID'; end if;
  begin set local role authenticated; set local request.jwt.claim.sub='77444444-4444-4444-8444-444444444444'; perform projectceo_product_api.review_approval_package('77555555-5555-4555-8555-555555555555','approval-77-a','submitted','approved','Changed',before_s,'db4-77-review-a'); raise exception 'DB4_77_REVIEW_CHANGED_ACCEPTED'; exception when sqlstate 'P1108' then null; end;
  reset role;
end
$approval_review$;


reset role;
do $preserved_after_enrollment$
begin
  set local role authenticated;
  set local request.jwt.claim.sub='77111111-1111-4111-8111-111111111111';
  perform projectceo_api.enroll_organization_project_scope(
    '77555555-5555-4555-8555-555555555555','77666666-6666-4666-8666-666666666666',
    'package-a','Package A',jsonb_build_array(jsonb_build_object(
      'userId','77999999-9999-4999-8999-999999999999','role','architect')),
    'db4-77-preserved-architect-package');
  set local request.jwt.claim.sub='77999999-9999-4999-8999-999999999999';
  perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555',null);
  perform projectceo_read_api.get_project_workspace_read('77555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
  reset role;
end
$preserved_after_enrollment$;

rollback;
select 'DB4_PACKAGE_BOUND_APPROVAL_REVIEW_OK' result;
