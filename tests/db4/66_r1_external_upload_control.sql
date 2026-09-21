\set ON_ERROR_STOP on
-- This mode only reads/replays the exact fixture records. The repository harness
-- invokes it after a second real container restart; tmpfs proof invokes it without
-- restart and must not be reported as durable-storage verification.
\if :{?r1_upload_restart_check}
begin;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $upload_replay_check$
declare
 p uuid:='41111111-1111-4111-8111-111111111111'; o uuid; before_ledger jsonb; before_outbox jsonb; before_commands bigint; before_sessions bigint; before_reservations bigint;
 expected jsonb; receipt jsonb; original_session uuid; winning_key text;
begin
 select organization_id into strict o from project_intelligence.project_workflows where project_id=p;
 select to_jsonb(l) into strict before_ledger from remhaos_integration.external_upload_quota_ledgers l where organization_id=o and project_id=p;
 select jsonb_agg(to_jsonb(x) order by x.operation_id) into before_outbox from remhaos_integration.external_upload_outbox x where organization_id=o and project_id=p;
 select count(*) into before_commands from remhaos_integration.command_records where organization_id=o and project_id=p;
 select count(*) into before_sessions from remhaos_integration.external_upload_sessions where organization_id=o and project_id=p;
 select count(*) into before_reservations from remhaos_integration.external_upload_reservations where organization_id=o and project_id=p;
 if before_sessions<>3 or before_reservations<>3 or before_ledger->>'logical_reserved'<>'700' or before_ledger->>'physical_reserved'<>'2100' or before_ledger->>'physical_orphan'<>'300' then raise exception 'UPLOAD_REPLAY_FIXTURE_STATE_MISSING'; end if;
 select logical_result into strict expected from remhaos_integration.command_records where organization_id=o and project_id=p and operation='begin_external_upload' and key_digest=project_intelligence._sha256_text('a-first');
 receipt:=remhaos_integration._begin_external_upload(p,p,'pdf',100,'protected.pdf','a-first');
 if receipt->>'replay' is distinct from 'true' or receipt->'result' is distinct from expected then raise exception 'UPLOAD_REPLAY_ORIGINAL_SESSION_CHANGED'; end if;
 original_session:=(expected->>'sessionId')::uuid;
 select logical_result into strict expected from remhaos_integration.command_records where organization_id=o and project_id=p and operation='cancel_external_upload' and key_digest=project_intelligence._sha256_text('a-cancel');
 receipt:=remhaos_integration._cancel_external_upload(p,p,original_session,0,'a-cancel');
 if receipt->>'replay' is distinct from 'true' or receipt->'result' is distinct from expected then raise exception 'UPLOAD_REPLAY_CANCEL_CHANGED'; end if;
 select logical_result into strict expected from remhaos_integration.command_records where organization_id=o and project_id=p and operation='begin_external_upload' and key_digest=project_intelligence._sha256_text('a-finalize-fixture');
 receipt:=remhaos_integration._begin_external_upload(p,p,'pdf',100,null,'a-finalize-fixture');
 if receipt->>'replay' is distinct from 'true' or receipt->'result' is distinct from expected then raise exception 'UPLOAD_REPLAY_FINALIZED_SESSION_CHANGED'; end if;
 if not exists(select 1 from remhaos_integration.external_upload_sessions where organization_id=o and project_id=p and session_id=(expected->>'sessionId')::uuid and state='finalized') then raise exception 'UPLOAD_REPLAY_FINALIZED_FACT_MISSING'; end if;
 select k into strict winning_key from unnest(array['a-concurrency-1','a-concurrency-2']) k where exists(select 1 from remhaos_integration.command_records where organization_id=o and project_id=p and operation='begin_external_upload' and key_digest=project_intelligence._sha256_text(k));
 select logical_result into strict expected from remhaos_integration.command_records where organization_id=o and project_id=p and operation='begin_external_upload' and key_digest=project_intelligence._sha256_text(winning_key);
 receipt:=remhaos_integration._begin_external_upload(p,p,'pdf',600,null,winning_key);
 if receipt->>'replay' is distinct from 'true' or receipt->'result' is distinct from expected then raise exception 'UPLOAD_REPLAY_QUOTA_WINNER_CHANGED'; end if;
 if before_ledger is distinct from (select to_jsonb(l) from remhaos_integration.external_upload_quota_ledgers l where organization_id=o and project_id=p)
 or before_outbox is distinct from (select jsonb_agg(to_jsonb(x) order by x.operation_id) from remhaos_integration.external_upload_outbox x where organization_id=o and project_id=p)
 or before_commands<>(select count(*) from remhaos_integration.command_records where organization_id=o and project_id=p)
 or before_sessions<>(select count(*) from remhaos_integration.external_upload_sessions where organization_id=o and project_id=p)
 or before_reservations<>(select count(*) from remhaos_integration.external_upload_reservations where organization_id=o and project_id=p) then raise exception 'UPLOAD_REPLAY_DUPLICATED_EFFECT'; end if;
end $upload_replay_check$;
commit;
select 'R1_UPLOAD_DURABLE_STATE_REPLAY_CHECK_OK' as result;
\else
begin;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $control$
declare
 p uuid:='41111111-1111-4111-8111-111111111111'; a uuid:='31111111-1111-4111-8111-111111111111'; o uuid;
 binding uuid:=extensions.gen_random_uuid(); response jsonb; replay jsonb; sid uuid; sid2 uuid; intake uuid; claim uuid:=extensions.gen_random_uuid(); receipt uuid:=extensions.gen_random_uuid(); generation uuid:=extensions.gen_random_uuid();
 l remhaos_integration.external_upload_quota_ledgers%rowtype;
 before_effects jsonb; after_effects jsonb; session_state text; reservation_state text; accepted_transitions text[]:=array[]::text[];
begin
 select organization_id into strict o from project_intelligence.project_workflows where project_id=p;
 begin
  perform remhaos_integration._begin_external_upload(p,p,'pdf',100,null,'a-missing-authority');
  raise exception 'UPLOAD_MISSING_AUTHORITY_ACCEPTED';
 exception when sqlstate 'P1111' then if sqlerrm<>'validation_failed' then raise; end if; end;
 -- Explicit synthetic, disposable authority; no production binding is seeded.
 insert into remhaos_integration.external_upload_policy_bindings(organization_id,project_id,policy_binding_id,authority_reference,authority_revision,authority_evidence_digest,runtime_authority_reference,runtime_evidence_digest,logical_byte_allowance,temporary_physical_byte_cap,representation_budget_bytes,adapter_id,storage_policy_version,data_plane_cell,pin_mode,sandbox_policy_version,scanner_policy_version,signature_policy_version,accepted_profiles,finalize_lease_seconds,finalize_recovery_seconds,valid_from,valid_until)
 values(o,p,binding,'synthetic:test-entitlement','fixture-1',decode(repeat('1',64),'hex'),'synthetic:test-runtime',decode(repeat('2',64),'hex'),1000,3000,0,'synthetic-adapter','fixture-1','ru','provider_version','synthetic-sandbox','synthetic-scanner','synthetic-signatures',array['legacy-pdf-intake-v1','legacy-image-intake-v1'],60,120,statement_timestamp()-interval '1 hour',statement_timestamp()+interval '1 hour');
 insert into remhaos_integration.external_upload_policy_heads(organization_id,project_id,policy_binding_id,write_eligible,processing_eligible,read_eligible) values(o,p,binding,true,true,true);
 insert into remhaos_integration.external_upload_quota_ledgers(organization_id,project_id) values(o,p);
 response:=remhaos_integration._begin_external_upload(p,p,'pdf',100,'protected.pdf','a-first'); sid:=(response#>>'{result,sessionId}')::uuid;
 replay:=remhaos_integration._begin_external_upload(p,p,'pdf',100,'protected.pdf','a-first');
 if replay#>>'{result,sessionId}'<>sid::text or replay->>'replay'<>'true' then raise exception 'UPLOAD_REPLAY_CHANGED_ID'; end if;
 if response::text like '%protected.pdf%' then raise exception 'UPLOAD_FILENAME_LEAKED'; end if;
 -- Active second actor cannot reuse another actor's operation key.
 insert into projectceo_foundation.project_member_capabilities(organization_id,project_id,user_id,capability) values(o,p,'32222222-2222-4222-8222-222222222222','register_source') on conflict do nothing;
 begin
  perform set_config('request.jwt.claim.sub','32222222-2222-4222-8222-222222222222',true);
  perform remhaos_integration._begin_external_upload(p,p,'pdf',100,'protected.pdf','a-first');
  raise exception 'UPLOAD_CROSS_ACTOR_REPLAY';
 exception when sqlstate 'P1108' then null; end;
 perform set_config('request.jwt.claim.sub',a::text,true);
 begin
  perform remhaos_integration._begin_external_upload(p,'49999999-9999-4999-8999-999999999999','pdf',100,'protected.pdf','a-first');
  raise exception 'UPLOAD_CROSS_PACKAGE_REPLAY';
 exception when sqlstate 'P1208' then null; end;
 begin
  perform remhaos_integration._begin_external_upload('42222222-2222-4222-8222-222222222222','42222222-2222-4222-8222-222222222222','pdf',100,null,'a-foreign-tenant');
  raise exception 'UPLOAD_FOREIGN_TENANT';
 exception when sqlstate 'P1103' then null; end;
 begin
  update project_intelligence.organization_members set status='inactive' where organization_id=o and user_id=a;
  perform remhaos_integration._begin_external_upload(p,p,'pdf',100,'protected.pdf','a-first');
  raise exception 'UPLOAD_REVOKED_MEMBER_REPLAY';
 exception when sqlstate 'P1103' then null; end;
 -- Root-only capability never inherits to a child package. Roll back this
 -- synthetic permission arrangement and its successful reservation afterward.
 begin
  delete from projectceo_foundation.project_member_capabilities where organization_id=o and project_id=p and user_id=a and capability='register_source';
  delete from projectceo_foundation.package_member_capabilities where organization_id=o and project_id=p and user_id=a and capability='register_source';
  insert into projectceo_foundation.package_memberships(organization_id,project_id,package_id,user_id,role) values(o,p,p,a,'architect') on conflict do nothing;
  insert into projectceo_foundation.package_member_capabilities(organization_id,project_id,package_id,user_id,capability) values(o,p,p,a,'register_source');
  begin
   perform remhaos_integration._begin_external_upload(p,'49999999-9999-4999-8999-999999999999','pdf',50,null,'a-root-child-denial');
   raise exception 'UPLOAD_ROOT_INHERITED_CHILD';
  exception when sqlstate 'P1103' then null; end;
  perform remhaos_integration._begin_external_upload(p,p,'pdf',50,null,'a-root-only-positive');
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 begin
  delete from projectceo_foundation.project_member_capabilities where organization_id=o and project_id=p and user_id=a and capability='register_source';
  delete from projectceo_foundation.package_member_capabilities where organization_id=o and project_id=p and user_id=a and capability='register_source';
  insert into projectceo_foundation.package_member_capabilities(organization_id,project_id,package_id,user_id,capability) values(o,p,'49999999-9999-4999-8999-999999999999',a,'register_source');
  replay:=remhaos_integration._begin_external_upload(p,'49999999-9999-4999-8999-999999999999','pdf',50,null,'a-child-only-positive');
  if replay#>>'{result,packageId}'<>'49999999-9999-4999-8999-999999999999' then raise exception 'UPLOAD_CHILD_SCOPE_LOST'; end if;
  begin
   perform remhaos_integration._begin_external_upload(p,p,'pdf',50,null,'a-child-root-denial');
   raise exception 'UPLOAD_CHILD_BORROWED_ROOT';
  exception when sqlstate 'P1103' then null; end;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;

 select * into strict l from remhaos_integration.external_upload_quota_ledgers where organization_id=o and project_id=p;
 if l.logical_reserved<>100 or l.physical_reserved<>300 or l.revision<>1 then raise exception 'UPLOAD_RESERVATION_COUNTERS'; end if;
 begin
  perform remhaos_integration._begin_external_upload(p,p,'pdf',101,'protected.pdf','a-first');
  raise exception 'UPLOAD_CHANGED_REQUEST_REPLAY';
 exception when sqlstate 'P1208' then null; end;
 begin
  perform remhaos_integration._begin_external_upload(p,p,'pdf',950,null,'a-over-quota');
  raise exception 'UPLOAD_QUOTA_OVERRUN';
 exception when sqlstate 'P1111' then null; end;
 begin
  update remhaos_integration.external_upload_sessions set declared_byte_length=99,revision=revision+1 where session_id=sid;
  raise exception 'UPLOAD_ORIGIN_CHANGED';
 exception when raise_exception then if sqlerrm<>'UPLOAD_ORIGIN_IMMUTABLE' then raise; end if; end;
 -- Flush begin's queued session trigger before reservation-only mutations;
 -- otherwise an initial session event can conceal the missing symmetric trigger.
 set constraints all immediate;
 set constraints all deferred;
 foreach session_state in array array['open','finalizing'] loop
  begin
   if session_state='finalizing' then
    update remhaos_integration.external_upload_sessions set state='finalizing',revision=revision+1 where session_id=sid;
    set constraints all immediate;
    set constraints all deferred;
   end if;
   foreach reservation_state in array array['committed','orphaned'] loop
    begin
     if reservation_state='committed' then
      update remhaos_integration.external_upload_reservations set state='committed',revision=revision+1 where session_id=sid;
     else
      update remhaos_integration.external_upload_reservations set state='orphaned',revision=revision+1,logical_reserved=0,logical_used=0,
       physical_orphan=physical_reserved+physical_used+physical_orphan,physical_reserved=0,physical_used=0 where session_id=sid;
     end if;
     set constraints all immediate;
     accepted_transitions:=array_append(accepted_transitions,session_state||'->'||reservation_state);
     raise sqlstate 'P9001';
    exception
     when sqlstate 'P9001' then null;
     when raise_exception then if sqlerrm<>'UPLOAD_ACTIVE_RESERVATION_NOT_RESERVED' then raise; end if;
    end;
   end loop;
   raise sqlstate 'P9001';
  exception when sqlstate 'P9001' then null; end;
 end loop;
 if cardinality(accepted_transitions)>0 then raise exception 'UPLOAD_RESERVATION_ONLY_TERMINAL_ACCEPTED: %',accepted_transitions; end if;
 -- Cancel retains its existing current-authority requirement. Revocation must
 -- have no command, session, outbox or accounting effects. Trusted expiry and
 -- physical reconciliation remain future work, not permission added here.
 begin
  update remhaos_integration.external_upload_policy_heads set write_eligible=false,revision=revision+1 where organization_id=o and project_id=p;
  select jsonb_build_object('session',(select to_jsonb(s) from remhaos_integration.external_upload_sessions s where session_id=sid),
   'reservation',(select to_jsonb(r) from remhaos_integration.external_upload_reservations r where session_id=sid),
   'ledger',(select to_jsonb(q) from remhaos_integration.external_upload_quota_ledgers q where organization_id=o and project_id=p),
   'outbox',(select jsonb_agg(to_jsonb(x) order by operation_id) from remhaos_integration.external_upload_outbox x where session_id=sid),
   'commands',(select jsonb_agg(to_jsonb(c) order by command_id) from remhaos_integration.command_records c where organization_id=o and project_id=p)) into before_effects;
  begin
   perform remhaos_integration._cancel_external_upload(p,p,sid,0,'a-revoked-cancel');
   raise exception 'UPLOAD_REVOKED_CANCEL_ACCEPTED';
  exception when sqlstate 'P1111' then if sqlerrm<>'validation_failed' then raise; end if; end;
  select jsonb_build_object('session',(select to_jsonb(s) from remhaos_integration.external_upload_sessions s where session_id=sid),
   'reservation',(select to_jsonb(r) from remhaos_integration.external_upload_reservations r where session_id=sid),
   'ledger',(select to_jsonb(q) from remhaos_integration.external_upload_quota_ledgers q where organization_id=o and project_id=p),
   'outbox',(select jsonb_agg(to_jsonb(x) order by operation_id) from remhaos_integration.external_upload_outbox x where session_id=sid),
   'commands',(select jsonb_agg(to_jsonb(c) order by command_id) from remhaos_integration.command_records c where organization_id=o and project_id=p)) into after_effects;
  if before_effects is distinct from after_effects then raise exception 'UPLOAD_REVOKED_CANCEL_SIDE_EFFECT'; end if;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 begin
  perform remhaos_integration._cancel_external_upload(p,p,sid,1,'a-stale-cancel');
  raise exception 'UPLOAD_STALE_CANCEL';
 exception when sqlstate 'P1107' then null; end;
 perform remhaos_integration._cancel_external_upload(p,p,sid,0,'a-cancel');
 replay:=remhaos_integration._cancel_external_upload(p,p,sid,0,'a-cancel');
 if replay->>'replay'<>'true' then raise exception 'UPLOAD_CANCEL_REPLAY'; end if;
 if (select count(*) from remhaos_integration.external_upload_outbox where session_id=sid and target_fence=1 and kind in ('revoke_upload','reconcile_upload'))<>2 then raise exception 'UPLOAD_CANCEL_DUPLICATE_OR_WRONG_FENCE'; end if;
 select * into strict l from remhaos_integration.external_upload_quota_ledgers where organization_id=o and project_id=p;
 if l.logical_reserved<>0 or l.physical_reserved<>0 or l.physical_orphan<>300 then raise exception 'UPLOAD_CANCEL_LOST_BYTES'; end if;
 begin
  perform remhaos_integration._begin_external_upload(p,p,'pdf',1000,null,'a-physical-over');
  raise exception 'UPLOAD_ORPHAN_NOT_COUNTED';
 exception when sqlstate 'P1111' then null; end;
 begin
  update remhaos_integration.external_upload_reservations set state='reconciled',revision=revision+1,physical_orphan=0 where session_id=sid;
  raise exception 'UPLOAD_UNACKNOWLEDGED_RELEASE';
 exception when raise_exception then if sqlerrm not in ('UPLOAD_RESERVATION_STATE_TRANSITION','UPLOAD_PHYSICAL_LIABILITY_UNACKNOWLEDGED') then raise; end if; end;
 -- Removing current authority denies even an otherwise exact replay.
 begin
  update remhaos_integration.external_upload_policy_heads set write_eligible=false,revision=revision+1 where organization_id=o and project_id=p;
  perform remhaos_integration._begin_external_upload(p,p,'pdf',100,'protected.pdf','a-first');
  raise exception 'UPLOAD_REVOKED_REPLAY';
 exception when sqlstate 'P1111' then null; end;
 response:=remhaos_integration._begin_external_upload(p,p,'pdf',100,null,'a-finalize-fixture'); sid2:=(response#>>'{result,sessionId}')::uuid; intake:=(response#>>'{result,intakeId}')::uuid;
 update remhaos_integration.external_upload_sessions set state='finalizing',revision=revision+1 where session_id=sid2;
 begin
  update remhaos_integration.external_upload_policy_heads set cancellation_revision=cancellation_revision+1,revision=revision+1 where organization_id=o and project_id=p;
  insert into remhaos_integration.external_upload_finalize_claims(organization_id,project_id,package_id,claim_id,session_id,session_revision,part_manifest_digest,attempt,fence,principal_binding_reference,token_digest,expires_at,recovery_deadline)
  values(o,p,p,claim,sid2,1,decode(repeat('3',64),'hex'),1,1,'synthetic:broker',decode(repeat('4',64),'hex'),statement_timestamp()+interval '60 seconds',statement_timestamp()+interval '120 seconds');
  raise exception 'UPLOAD_POLICY_CANCEL_FENCE_IGNORED';
 exception when raise_exception then if sqlerrm<>'UPLOAD_FINALIZE_AUTHORITY_UNAVAILABLE' then raise; end if; end;
 insert into remhaos_integration.external_upload_finalize_claims(organization_id,project_id,package_id,claim_id,session_id,session_revision,part_manifest_digest,attempt,fence,principal_binding_reference,token_digest,expires_at,recovery_deadline)
 values(o,p,p,claim,sid2,1,decode(repeat('3',64),'hex'),1,1,'synthetic:broker',decode(repeat('4',64),'hex'),statement_timestamp()+interval '60 seconds',statement_timestamp()+interval '120 seconds');
 begin
  insert into remhaos_integration.external_upload_seal_receipts(organization_id,project_id,package_id,receipt_id,session_id,claim_id,fence,policy_binding_id,adapter_id,storage_policy_version,pin_mode,private_locator,immutable_provider_version,observed_byte_length,object_identity_digest,sealing_evidence_digest,source_claim_digest,closure_evidence_digest)
  values(o,p,p,receipt,sid2,claim,1,binding,'synthetic-adapter','fixture-1','provider_version','private/synthetic','version-1',99,decode(repeat('5',64),'hex'),decode(repeat('6',64),'hex'),decode(repeat('7',64),'hex'),decode(repeat('8',64),'hex'));
  raise exception 'UPLOAD_SHORT_SEAL_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'UPLOAD_SEAL_CORRELATION_INVALID' then raise; end if; end;
 insert into remhaos_integration.external_upload_seal_receipts(organization_id,project_id,package_id,receipt_id,session_id,claim_id,fence,policy_binding_id,adapter_id,storage_policy_version,pin_mode,private_locator,immutable_provider_version,observed_byte_length,object_identity_digest,sealing_evidence_digest,source_claim_digest,closure_evidence_digest)
 values(o,p,p,receipt,sid2,claim,1,binding,'synthetic-adapter','fixture-1','provider_version','private/synthetic','version-1',100,decode(repeat('5',64),'hex'),decode(repeat('6',64),'hex'),decode(repeat('7',64),'hex'),decode(repeat('8',64),'hex'));
 begin
  insert into remhaos_integration.external_upload_generations(organization_id,project_id,package_id,generation_id,session_id,intake_id,seal_receipt_id,observed_byte_length,requested_format,created_by_user_id) values(o,p,p,generation,sid2,intake,receipt,100,'pdf',a);
  set constraints remhaos_integration.external_upload_generation_closure immediate;
  raise exception 'UPLOAD_PARTIAL_FINALIZE_COMMITTED';
 exception when raise_exception then if sqlerrm<>'UPLOAD_GENERATION_NOT_FINALIZED' then raise; end if; end;
 insert into remhaos_integration.external_upload_generations(organization_id,project_id,package_id,generation_id,session_id,intake_id,seal_receipt_id,observed_byte_length,requested_format,created_by_user_id) values(o,p,p,generation,sid2,intake,receipt,100,'pdf',a);
 update remhaos_integration.external_upload_sessions set state='finalized',revision=revision+1 where session_id=sid2;
 update remhaos_integration.external_upload_finalize_claims set state='consumed' where claim_id=claim;
 update remhaos_integration.external_upload_reservations set state='committed',revision=revision+1 where session_id=sid2;
 begin
  insert into remhaos_integration.external_upload_outbox(organization_id,project_id,package_id,operation_id,session_id,generation_id,kind,target_fence) values(o,p,p,extensions.gen_random_uuid(),sid2,generation,'enqueue_validation',0);
  raise exception 'UPLOAD_STALE_ENQUEUE_FENCE';
 exception when raise_exception then if sqlerrm<>'UPLOAD_OUTBOX_GENERATION_SCOPE' then raise; end if; end;
 insert into remhaos_integration.external_upload_outbox(organization_id,project_id,package_id,operation_id,session_id,generation_id,kind,target_fence) values(o,p,p,extensions.gen_random_uuid(),sid2,generation,'enqueue_validation',1);
 set constraints all immediate;
 if exists(select 1 from remhaos_integration.file_intakes where intake_id=intake) then raise exception 'UPLOAD_PLACEHOLDER_INTAKE_CREATED'; end if;
 if has_function_privilege('authenticated','remhaos_integration._begin_external_upload(uuid,uuid,text,bigint,text,text)','EXECUTE') or has_table_privilege('service_role','remhaos_integration.external_upload_policy_bindings','INSERT') then raise exception 'UPLOAD_PRIVATE_BOUNDARY_EXPOSED'; end if;
end $control$;
-- Optional two-session proof for a dedicated disposable database. Normal DB4
-- rolls the fixture back; the isolated harness opts in and destroys its database.
\if :{?r1_upload_concurrency}
commit;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-upload-quota-contender-1'"'"'"'"'"'"'"'"'; begin; set local request.jwt.claim.sub='"'"'"'"'"'"'"'"'31111111-1111-4111-8111-111111111111'"'"'"'"'"'"'"'"'; select remhaos_integration._begin_external_upload('"'"'"'"'"'"'"'"'41111111-1111-4111-8111-111111111111'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'41111111-1111-4111-8111-111111111111'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'pdf'"'"'"'"'"'"'"'"',600,null,'"'"'"'"'"'"'"'"'a-concurrency-1'"'"'"'"'"'"'"'"'); select pg_sleep(3); commit;'"'"' > /tmp/r1-upload-race-1.log 2>&1 & first=$!; held=f; for attempt in $(seq 1 20); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-upload-quota-contender-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.05; done; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-upload-quota-contender-2'"'"'"'"'"'"'"'"'; begin; set local request.jwt.claim.sub='"'"'"'"'"'"'"'"'31111111-1111-4111-8111-111111111111'"'"'"'"'"'"'"'"'; select remhaos_integration._begin_external_upload('"'"'"'"'"'"'"'"'41111111-1111-4111-8111-111111111111'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'41111111-1111-4111-8111-111111111111'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'pdf'"'"'"'"'"'"'"'"',600,null,'"'"'"'"'"'"'"'"'a-concurrency-2'"'"'"'"'"'"'"'"'); select pg_sleep(3); commit;'"'"' > /tmp/r1-upload-race-2.log 2>&1 & second=$!; overlap=f; for attempt in $(seq 1 20); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a, pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-upload-quota-contender-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-upload-quota-contender-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"')'"'"'); [ "$overlap" = t ] && break; sleep 0.05; done; printf "%s\n" "$overlap" > /tmp/r1-upload-race-overlap.txt; wait "$first"; first_exit=$?; wait "$second"; second_exit=$?; printf "%s %s\n" "$first_exit" "$second_exit" > /tmp/r1-upload-race-exits.txt'
do $concurrent_reservations$
declare total integer; outcomes text; logs text;
begin
 select count(*) into total from remhaos_integration.command_records where operation='begin_external_upload' and key_digest in (project_intelligence._sha256_text('a-concurrency-1'),project_intelligence._sha256_text('a-concurrency-2'));
 outcomes:=btrim(pg_read_file('/tmp/r1-upload-race-exits.txt'),E' \n\r\t');
 logs:=pg_read_file('/tmp/r1-upload-race-1.log')||pg_read_file('/tmp/r1-upload-race-2.log');
 if btrim(pg_read_file('/tmp/r1-upload-race-overlap.txt'),E' \n\r\t')<>'t' then raise exception 'UPLOAD_CONCURRENT_LOCK_OVERLAP_NOT_OBSERVED'; end if;
 if total<>1 or outcomes not in ('0 1','1 0') and outcomes not in ('0 3','3 0') or position('upload_quota_exceeded' in logs)=0 then raise exception 'UPLOAD_CONCURRENT_QUOTA_FAILED: receipts %, exits %',total,outcomes; end if;
 if exists(select 1 from remhaos_integration.external_upload_quota_ledgers where project_id='41111111-1111-4111-8111-111111111111' and (logical_reserved<>700 or physical_reserved<>2100 or physical_orphan<>300)) then raise exception 'UPLOAD_CONCURRENT_COUNTERS'; end if;
end $concurrent_reservations$;
select 'R1_UPLOAD_QUOTA_LOCK_OVERLAP_OK' as overlap_result;
select 'R1_UPLOAD_TWO_CONNECTION_QUOTA_OK' as result;
\else
rollback;
\endif
select 'DB4_R1_UPLOAD_CONTROL_SLICE_A_OK' as result;
\endif
