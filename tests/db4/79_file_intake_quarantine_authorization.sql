\set ON_ERROR_STOP on

-- Synthetic SQL authorization regression, NOT real-file or Storage runtime proof.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('79111111-1111-4111-8111-111111111111','owner-79@example.invalid',now()),
 ('79222222-2222-4222-8222-222222222222','outsider-79@example.invalid',now());
insert into public.designers(id,name) values ('79111111-1111-4111-8111-111111111111','DB4 owner79');
insert into public.projects(id,designer_id,client_name,intake_token) values
 ('79333333-3333-4333-8333-333333333333','79111111-1111-4111-8111-111111111111','DB4 quarantine79','db4-quarantine79');

do $authorization$
declare
  result jsonb;
  object_key text;
  intake uuid;
  function_id regprocedure := 'remhaos_integration_api.can_insert_file_intake_quarantine_object(text,text)'::regprocedure;
begin
  if has_function_privilege('anon', function_id, 'execute')
     or has_function_privilege('service_role', function_id, 'execute')
     or not has_function_privilege('authenticated', function_id, 'execute') then
    raise exception 'DB4_79_PREDICATE_GRANT_INVALID';
  end if;
  set local role authenticated;
  set local request.jwt.claim.sub='79111111-1111-4111-8111-111111111111';
  perform projectceo_api.enroll_organization_project_scope(
    '79333333-3333-4333-8333-333333333333','79444444-4444-4444-8444-444444444444',
    'quarantine79','Quarantine79','[]','db4-79-enroll');
  result := remhaos_integration_api.create_file_intake(
    '79333333-3333-4333-8333-333333333333','fixture.pdf','application/pdf','pdf',32,repeat('a',64),'document','db4-79-intake');
  object_key := result#>>'{result,objectKey}';
  intake := (result#>>'{result,intakeId}')::uuid;
  if remhaos_integration_api.can_insert_file_intake_quarantine_object('client-uploads', object_key) is not true then
    raise exception 'DB4_79_OWNER_REQUESTED_DENIED';
  end if;
  if remhaos_integration_api.can_insert_file_intake_quarantine_object('other-bucket', object_key) is not false
     or remhaos_integration_api.can_insert_file_intake_quarantine_object('client-uploads', object_key || '/extra') is not false
     or remhaos_integration_api.can_insert_file_intake_quarantine_object('client-uploads', replace(object_key,repeat('a',64),repeat('b',64))) is not false
     or remhaos_integration_api.can_insert_file_intake_quarantine_object('client-uploads', result#>>'{result,internalObjectKey}') is not false
     or remhaos_integration_api.can_insert_file_intake_quarantine_object('client-uploads', null) is not false then
    raise exception 'DB4_79_UNBOUND_PATH_ALLOWED';
  end if;
  set local request.jwt.claim.sub='79222222-2222-4222-8222-222222222222';
  if remhaos_integration_api.can_insert_file_intake_quarantine_object('client-uploads', object_key) is not false then
    raise exception 'DB4_79_OUTSIDER_ALLOWED';
  end if;
  set local request.jwt.claim.sub='';
  if remhaos_integration_api.can_insert_file_intake_quarantine_object('client-uploads', object_key) is not false then
    raise exception 'DB4_79_MISSING_SUBJECT_ALLOWED';
  end if;
  set local request.jwt.claim.sub='79111111-1111-4111-8111-111111111111';
  perform remhaos_integration_api.mark_file_intake_uploaded(
    '79333333-3333-4333-8333-333333333333',intake,'db4-79-mark-uploaded');
  if remhaos_integration_api.can_insert_file_intake_quarantine_object('client-uploads', object_key) is not false then
    raise exception 'DB4_79_POST_UPLOAD_WRITE_ALLOWED';
  end if;
  reset role;
end
$authorization$;

rollback;
select 'DB4_FILE_INTAKE_QUARANTINE_AUTHORIZATION_OK';
