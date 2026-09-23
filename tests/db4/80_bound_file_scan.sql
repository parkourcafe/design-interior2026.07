\set ON_ERROR_STOP on

-- Synthetic SQL contract evidence ONLY. The hashes, policy and scan evidence
-- below are invented fixtures: this proves neither authenticated HTTP nor AV,
-- sandbox isolation, Storage bytes, canonical copy, or a real-file acceptance.
-- All grants/configuration/fixtures roll back; no private business-table seed.
begin;

create function pg_temp.scan80_denied(command text, expected text)
returns void language plpgsql as $f$
declare actual text;
begin
  begin
    execute command;
  exception when others then
    get stacked diagnostics actual = returned_sqlstate;
  end;
  if actual is distinct from expected then
    raise exception 'DB4_80_EXPECTED_%, GOT_%', expected, coalesce(actual,'success');
  end if;
end $f$;

do $default_acl$
declare role_name text; signature text; table_name text;
begin
  foreach role_name in array array['anon','authenticated','service_role','pi_human_executor','pi_worker_executor'] loop
    foreach signature in array array[
      'remhaos_integration.configure_disposable_file_scan_policy(jsonb,boolean)',
      'remhaos_integration._lock_file_scan_authority(uuid,uuid,uuid,uuid)',
      'remhaos_integration._locked_bound_file_scan(uuid,text)',
      'remhaos_integration_api.request_bound_file_scan(uuid,uuid,text,text)',
      'remhaos_integration_api.claim_bound_file_scan(uuid,text,text,text)',
      'remhaos_integration_api.complete_bound_file_scan(uuid,text,integer,bigint,text,jsonb,text)',
      'remhaos_integration_api.cancel_bound_file_scan(uuid)'
    ] loop
      if has_function_privilege(role_name,signature,'execute') then
        raise exception 'DB4_80_DEFAULT_EXECUTE_GRANTED: % %',role_name,signature;
      end if;
    end loop;
    foreach table_name in array array['file_scan_policies','file_scan_gate','file_scan_tasks','file_scan_claims','file_scan_evidence'] loop
      if has_table_privilege(role_name,'remhaos_integration.'||table_name,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'DB4_80_PRIVATE_TABLE_GRANTED: % %',role_name,table_name;
      end if;
      if not exists(select 1 from pg_class where oid=('remhaos_integration.'||table_name)::regclass and relrowsecurity and relforcerowsecurity) then
        raise exception 'DB4_80_RLS_NOT_FORCED: %',table_name;
      end if;
    end loop;
  end loop;
  if (select enabled from remhaos_integration.file_scan_gate where singleton) then
    raise exception 'DB4_80_GATE_OPEN_BY_DEFAULT';
  end if;
  if not has_function_privilege('authenticated','remhaos_integration_api.get_file_intake_storage(uuid,uuid)','execute') then
    raise exception 'DB4_80_STORAGE_READ_HUMAN_GRANT_MISSING';
  end if;
  foreach role_name in array array['anon','service_role','pi_human_executor','pi_worker_executor'] loop
    if has_function_privilege(role_name,'remhaos_integration_api.get_file_intake_storage(uuid,uuid)','execute') then
      raise exception 'DB4_80_STORAGE_READ_GRANT_BROADENED: %',role_name;
    end if;
  end loop;
end $default_acl$;

-- The same minimal Auth/legacy fixture as DB4_79. Enrollment and all intake
-- lifecycle setup use existing human APIs, never privileged domain inserts.
insert into auth.users(id,email,email_confirmed_at) values
 ('80111111-1111-4111-8111-111111111111','owner-80@example.invalid',now()),
 ('80222222-2222-4222-8222-222222222222','outsider-80@example.invalid',now());
insert into public.designers(id,name) values ('80111111-1111-4111-8111-111111111111','DB4 owner80');
insert into public.projects(id,designer_id,client_name,intake_token) values
 ('80333333-3333-4333-8333-333333333333','80111111-1111-4111-8111-111111111111','DB4 scan80','db4-scan80');

-- Transaction-local equivalent of enable-bound-file-scanner.sql, but retain
-- closed gate first so its independent denial is exercised after EXECUTE grant.
grant usage on schema remhaos_integration_api to authenticated,service_role;
grant execute on function remhaos_integration_api.request_bound_file_scan(uuid,uuid,text,text),
  remhaos_integration_api.cancel_bound_file_scan(uuid) to authenticated;
grant execute on function remhaos_integration_api.claim_bound_file_scan(uuid,text,text,text),
  remhaos_integration_api.complete_bound_file_scan(uuid,text,integer,bigint,text,jsonb,text) to service_role;

do $contract$
declare
  project uuid := '80333333-3333-4333-8333-333333333333';
  intake uuid; task uuid; pending_intake uuid; pending_task uuid;
  a jsonb; b jsonb; claim jsonb; evidence jsonb; changed jsonb; policy jsonb;
  cap text := repeat('c',64); lease text := repeat('d',64);
  cap_digest text := encode(extensions.digest(repeat('c',64),'sha256'),'hex');
  lease_digest text := encode(extensions.digest(repeat('d',64),'sha256'),'hex');
  mismatch jsonb; receipt uuid; completion_digest text; evidence_key text;
  evidence_count bigint; event_count bigint;
begin
  set local role authenticated;
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  set local request.jwt.claims='{"role":"authenticated"}';
  perform projectceo_api.enroll_organization_project_scope(project,'80444444-4444-4444-8444-444444444444',
    'scan80','Scan80','[]','db4-80-enroll');
  a := remhaos_integration_api.create_file_intake(project,'fixture.pdf','application/pdf','pdf',32,repeat('a',64),'document','db4-80-intake');
  intake := (a#>>'{result,intakeId}')::uuid;
  perform remhaos_integration_api.mark_file_intake_uploaded(project,intake,'db4-80-uploaded');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,%L,%L)',project,intake,cap_digest,'db4-80-request'),'P1103');
  reset role;

  policy := jsonb_build_object('policyVersion','wp32-clamav-local17/v1',
    'imageId','sha256:'||repeat('1',64),'engineVersion','1.5.4',
    'executableSha256',repeat('2',64),'receiverSha256',repeat('3',64),
    'signatureBundleSha256',repeat('4',64),'signatureVersion',1,
    'signatureTimestamp',floor(extract(epoch from clock_timestamp()))::bigint);
  perform pg_temp.scan80_denied(format('select remhaos_integration.configure_disposable_file_scan_policy(%L,true)',policy-'receiverSha256'),'P1111');
  perform pg_temp.scan80_denied(format('select remhaos_integration.configure_disposable_file_scan_policy(%L,true)',policy||'{"unexpected":true}'),'P1111');
  perform pg_temp.scan80_denied(format('select remhaos_integration.configure_disposable_file_scan_policy(%L,true)',policy||jsonb_build_object('signatureTimestamp',1)),'P1105');
  perform remhaos_integration.configure_disposable_file_scan_policy(policy,true);

  set local role authenticated;
  set local request.jwt.claim.sub='80222222-2222-4222-8222-222222222222';
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,%L,%L)',project,intake,cap_digest,'db4-80-outsider'),'P1103');
  set local request.jwt.claim.sub='';
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,%L,%L)',project,intake,cap_digest,'db4-80-anonymous'),'P1101');
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,%L,%L)',project,'80999999-9999-4999-8999-999999999999',cap_digest,'db4-80-missing'),'P1104');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,null,%L,%L)',project,cap_digest,'db4-80-null-intake'),'P1111');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,null,%L)',project,intake,'db4-80-null-cap'),'P1111');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,%L,null)',project,intake,cap_digest),'P1211');
  a := remhaos_integration_api.request_bound_file_scan(project,intake,cap_digest,'db4-80-request');
  task := (a#>>'{result,taskId}')::uuid;
  b := remhaos_integration_api.request_bound_file_scan(project,intake,cap_digest,'db4-80-request');
  if a->'result' is distinct from b->'result' or a->>'replay'<>'false' or b->>'replay'<>'true' then raise exception 'DB4_80_REQUEST_REPLAY'; end if;
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,%L,%L)',project,intake,repeat('e',64),'db4-80-request'),'P1108');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,%L,%L)',project,intake,cap_digest,'db4-80-duplicate'),'P1109');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,%L,%L)',task,cap,lease_digest,'db4-80-claim'),'42501');

  set local role service_role;
  -- Even a worker SQL role cannot claim with a human request role.
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,%L,%L)',task,cap,lease_digest,'db4-80-claim'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.request_bound_file_scan(%L,%L,%L,%L)',project,intake,cap_digest,'db4-80-worker-request'),'42501');
  set local request.jwt.claims='{"role":"service_role"}';
  set local request.jwt.claim.sub='';
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,%L,%L)',task,repeat('f',64),lease_digest,'db4-80-claim'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(null,%L,%L,%L)',cap,lease_digest,'db4-80-null-task'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,null,%L,%L)',task,lease_digest,'db4-80-null-cap'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,null,%L)',task,cap,'db4-80-null-lease'),'P1111');
  a := remhaos_integration_api.claim_bound_file_scan(task,cap,lease_digest,'db4-80-claim');
  b := remhaos_integration_api.claim_bound_file_scan(task,cap,lease_digest,'db4-80-claim');
  if a->'result' is distinct from b->'result' or a->>'replay'<>'false' or b->>'replay'<>'true' then raise exception 'DB4_80_CLAIM_REPLAY'; end if;
  claim := a->'result';
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,%L,%L)',task,cap,repeat('f',64),'db4-80-claim'),'P1108');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,%L,%L)',task,cap,lease_digest,'db4-80-other-claim'),'P1109');
  evidence := jsonb_build_object('schemaVersion','remhaos.file-scan-evidence/1',
    'taskId',task,'attempt',claim->'attempt','fence',claim->'fence','nonce',claim->'nonce',
    'sourceSha256',repeat('a',64),'byteLength',32,'storageAfterSha256',repeat('a',64),
    'policy',policy,'scanStartedAt',claim->'claimedAt','scanCompletedAt',clock_timestamp(),
    'outcome','clean','exitCode',0,'sandboxEvidenceSha256',repeat('5',64),
    'canonicalSha256',repeat('a',64),'canonicalByteLength',32,'canonicalVerifiedAt',clock_timestamp());
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,%L,%L,%L)',task,cap,repeat('f',64),evidence,'db4-80-complete'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,2,%L,%L,%L)',task,cap,lease,evidence,'db4-80-complete'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,null,1,%L,%L,%L)',task,cap,lease,evidence,'db4-80-complete'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,null,%L,%L,%L)',task,cap,lease,evidence,'db4-80-complete'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,null,%L,%L)',task,cap,evidence,'db4-80-complete'),'P1103');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,%L,null,%L)',task,cap,lease,'db4-80-complete'),'P1111');
  for evidence_key in select jsonb_object_keys(evidence) loop
    changed := jsonb_set(evidence,array[evidence_key],'null'::jsonb);
    perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,%L,%L,%L)',task,cap,lease,changed,'db4-80-complete'),'P1111');
  end loop;
  for mismatch in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('taskId','80999999-9999-4999-8999-999999999999'),
    jsonb_build_object('nonce','80999999-9999-4999-8999-999999999999'),
    jsonb_build_object('attempt',2),jsonb_build_object('fence',2),
    jsonb_build_object('sourceSha256',repeat('b',64)),jsonb_build_object('byteLength',33),
    jsonb_build_object('storageAfterSha256',repeat('b',64)),jsonb_build_object('policy',policy||'{"signatureVersion":2}'),
    jsonb_build_object('canonicalSha256',repeat('b',64)),jsonb_build_object('canonicalByteLength',33),
    jsonb_build_object('canonicalVerifiedAt',null),jsonb_build_object('exitCode',1),
    jsonb_build_object('scanStartedAt','2000-01-01T00:00:00Z'),jsonb_build_object('scanCompletedAt','2999-01-01T00:00:00Z'),
    jsonb_build_object('unexpected',true))) loop
    changed := evidence||mismatch;
    perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,%L,%L,%L)',task,cap,lease,changed,'db4-80-complete'),'P1111');
  end loop;
  reset role;
  if exists(select 1 from remhaos_integration.file_scan_evidence where task_id=task)
    or (select status from remhaos_integration.file_intakes where intake_id=intake)<>'scan_pending' then raise exception 'DB4_80_INVALID_EVIDENCE_MUTATED_STATE'; end if;
  set local role service_role;
  a := remhaos_integration_api.complete_bound_file_scan(task,cap,1,1,lease,evidence,'db4-80-complete');
  receipt := (a#>>'{result,receiptId}')::uuid;
  completion_digest := a#>>'{result,evidenceDigest}';
  reset role;
  select count(*) into evidence_count from remhaos_integration.file_scan_evidence where task_id=task;
  select count(*) into event_count from remhaos_integration.file_intake_events where intake_id=intake;
  set local role service_role;
  b := remhaos_integration_api.complete_bound_file_scan(task,cap,1,1,lease,evidence,'db4-80-complete');
  if a->'result' is distinct from b->'result' or a->>'replay'<>'false' or b->>'replay'<>'true' then raise exception 'DB4_80_COMPLETE_REPLAY'; end if;
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,%L,%L,%L)',task,cap,lease,evidence||jsonb_build_object('sandboxEvidenceSha256',repeat('6',64)),'db4-80-complete'),'P1108');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,%L,%L,%L)',task,cap,lease,evidence,'db4-80-other-complete'),'P1108');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,%L,%L)',task,cap,lease_digest,'db4-80-claim'),'P1107');
  reset role;
  if evidence_count<>1 or evidence_count<>(select count(*) from remhaos_integration.file_scan_evidence where task_id=task)
    or event_count<>(select count(*) from remhaos_integration.file_intake_events where intake_id=intake)
    or (select status from remhaos_integration.file_intakes where intake_id=intake)<>'clean'
    or (select state from remhaos_integration.file_scan_tasks where task_id=task)<>'completed' then raise exception 'DB4_80_COMPLETION_NOT_EXACTLY_ONCE'; end if;
  perform pg_temp.scan80_denied(format('update remhaos_integration.file_scan_evidence set evidence=%L where receipt_id=%L',evidence,receipt),'55000');
  perform pg_temp.scan80_denied(format('delete from remhaos_integration.file_scan_evidence where receipt_id=%L',receipt),'55000');
  perform pg_temp.scan80_denied(format('delete from remhaos_integration.file_scan_claims where task_id=%L',task),'55000');
  perform pg_temp.scan80_denied('update remhaos_integration.file_scan_policies set policy=policy','55000');
  perform pg_temp.scan80_denied(format('update remhaos_integration.file_scan_tasks set checksum=decode(%L,''hex'') where task_id=%L',repeat('b',64),task),'P0001');

  set local role authenticated;
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  set local request.jwt.claims='{"role":"authenticated"}';
  b := remhaos_integration_api.request_bound_file_scan(project,intake,cap_digest,'db4-80-request');
  if b#>>'{result,taskId}' is distinct from task::text or b->>'replay'<>'true' then raise exception 'DB4_80_TERMINAL_REQUEST_REPLAY'; end if;
  -- A completed clean scan alone is not human approval or publication.
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.get_file_intake_storage(%L,%L)',project,intake),'P1204');
  perform remhaos_integration_api.review_file_intake(project,intake,'accepted','Synthetic DB4 review','db4-80-review');
  a := remhaos_integration_api.get_file_intake_storage(project,intake);
  if a->>'status' is distinct from 'ingested_candidate'
    or a->'canonicalReceipt' is distinct from jsonb_build_object(
      'receiptId',receipt,'evidenceDigest',completion_digest,'checksumHex',repeat('a',64),'byteLength',32)
    or a->>'intakeId' is distinct from intake::text
    or a->>'projectId' is distinct from project::text then
    raise exception 'DB4_80_REVIEWED_CANONICAL_RECEIPT_MISMATCH';
  end if;
  set local request.jwt.claim.sub='80222222-2222-4222-8222-222222222222';
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.get_file_intake_storage(%L,%L)',project,intake),'P1103');
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  perform pg_temp.scan80_denied('select remhaos_integration_api.cancel_bound_file_scan(null)','P1104');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.cancel_bound_file_scan(%L)',task),'P1109');
  a := remhaos_integration_api.create_file_intake(project,'pending.pdf','application/pdf','pdf',32,repeat('b',64),'document','db4-80-pending');
  pending_intake := (a#>>'{result,intakeId}')::uuid;
  perform remhaos_integration_api.mark_file_intake_uploaded(project,pending_intake,'db4-80-pending-uploaded');
  a := remhaos_integration_api.request_bound_file_scan(project,pending_intake,cap_digest,'db4-80-cancel-request');
  pending_task := (a#>>'{result,taskId}')::uuid;
  set local role service_role;
  set local request.jwt.claims='{"role":"service_role"}';
  set local request.jwt.claim.sub='';
  perform remhaos_integration_api.claim_bound_file_scan(pending_task,cap,lease_digest,'db4-80-cancel-claim');
  set local role authenticated;
  set local request.jwt.claims='{"role":"authenticated"}';
  set local request.jwt.claim.sub='80222222-2222-4222-8222-222222222222';
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.cancel_bound_file_scan(%L)',pending_task),'P1103');
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  a := remhaos_integration_api.cancel_bound_file_scan(pending_task);
  b := remhaos_integration_api.cancel_bound_file_scan(pending_task);
  if a->'result' is distinct from b->'result' or a->>'replay'<>'false' or b->>'replay'<>'true' then raise exception 'DB4_80_CANCEL_REPLAY'; end if;
  set local role service_role;
  set local request.jwt.claims='{"role":"service_role"}';
  set local request.jwt.claim.sub='';
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,%L,%L)',pending_task,cap,lease_digest,'db4-80-cancelled-claim'),'P1106');
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,%L,%L,%L)',pending_task,cap,lease,evidence,'db4-80-cancelled-complete'),'P1106');

  set local role authenticated;
  set local request.jwt.claim.sub='80111111-1111-4111-8111-111111111111';
  set local request.jwt.claims='{"role":"authenticated"}';
  a := remhaos_integration_api.request_bound_file_scan(project,pending_intake,cap_digest,'db4-80-revoked-request');
  pending_task := (a#>>'{result,taskId}')::uuid;
  set local role service_role;
  set local request.jwt.claims='{"role":"service_role"}';
  set local request.jwt.claim.sub='';
  perform remhaos_integration_api.claim_bound_file_scan(pending_task,cap,lease_digest,'db4-80-revoked-claim');
  reset role;
  perform remhaos_integration.configure_disposable_file_scan_policy(null,false);
  set local role service_role;
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.complete_bound_file_scan(%L,%L,1,1,%L,%L,%L)',pending_task,cap,lease,evidence,'db4-80-revoked-complete'),'P1106');
  reset role;
  -- Reopening the same policy cannot resurrect tasks from the old gate epoch.
  perform remhaos_integration.configure_disposable_file_scan_policy(policy,true);
  set local role service_role;
  perform pg_temp.scan80_denied(format('select remhaos_integration_api.claim_bound_file_scan(%L,%L,%L,%L)',pending_task,cap,lease_digest,'db4-80-revoked-claim'),'P1106');
  reset role;
  if exists(select 1 from remhaos_integration.file_scan_evidence where task_id=pending_task)
    or (select status from remhaos_integration.file_intakes where intake_id=pending_intake)<>'scan_pending' then raise exception 'DB4_80_REVOCATION_MUTATED_INTAKE'; end if;
end $contract$;

rollback;
select 'DB4_BOUND_FILE_SCAN_SYNTHETIC_CONTRACT_OK';
