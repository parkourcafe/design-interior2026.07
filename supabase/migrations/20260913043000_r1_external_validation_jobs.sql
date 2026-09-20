-- R1 slice B: private durable validation coordination and measured facts.
-- No broker transport, authority seeds, runtime EXECUTE, intake/asset publication,
-- real scanner attestation or constant-time credential verification is provided.
begin;
create table remhaos_integration.external_validation_hosts (
 host_id uuid primary key, slot_cap integer not null check(slot_cap between 1 and 64),
 authority_reference text not null check(char_length(btrim(authority_reference)) between 1 and 500),
 evidence_digest bytea not null check(octet_length(evidence_digest)=32),
 valid_until timestamptz not null
);
create table remhaos_integration.external_validation_principals (
 principal_id uuid primary key, host_id uuid not null references remhaos_integration.external_validation_hosts,
 actor_id text not null unique check(actor_id like 'system:%' and char_length(actor_id) between 8 and 160),
 credential_digest bytea not null check(octet_length(credential_digest)=32),
 worker_slot_cap integer not null check(worker_slot_cap between 1 and 2),
 authentication_authority_reference text not null check(char_length(btrim(authentication_authority_reference)) between 1 and 500),
 authentication_evidence_digest bytea not null check(octet_length(authentication_evidence_digest)=32),
 valid_until timestamptz not null
);
create table remhaos_integration.external_validation_principal_heads (
 principal_id uuid primary key references remhaos_integration.external_validation_principals,
 active boolean not null, revision bigint not null default 0 check(revision between 0 and 9007199254740991)
);
create table remhaos_integration.external_validation_principal_scopes (
 principal_id uuid not null references remhaos_integration.external_validation_principals,
 organization_id uuid not null, project_id uuid not null, package_id uuid not null, policy_binding_id uuid not null,
 authority_reference text not null check(char_length(btrim(authority_reference)) between 1 and 500),
 evidence_digest bytea not null check(octet_length(evidence_digest)=32), valid_until timestamptz not null,
 primary key(principal_id,organization_id,project_id,package_id,policy_binding_id),
 foreign key(organization_id,project_id,package_id) references projectceo_foundation.project_packages(organization_id,project_id,id),
 foreign key(organization_id,project_id,policy_binding_id) references remhaos_integration.external_upload_policy_bindings
);
create table remhaos_integration.external_validation_jobs (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null, job_id uuid not null,
 generation_id uuid not null, session_id uuid not null, policy_binding_id uuid not null, validation_profile text not null,
 state text not null default 'queued' check(state in ('queued','leased','succeeded','failed')),
 attempt integer not null default 0 check(attempt between 0 and 3), fence bigint not null default 0 check(fence between 0 and 9007199254740991),
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 available_at timestamptz not null default statement_timestamp(),
 principal_id uuid references remhaos_integration.external_validation_principals,
 host_id uuid references remhaos_integration.external_validation_hosts, worker_slot integer, host_slot integer,
 lease_digest bytea check(octet_length(lease_digest)=32), lease_expires_at timestamptz, attempt_started_at timestamptz, walltime_deadline timestamptz,
 session_cancellation_revision bigint not null, policy_cancellation_revision bigint not null,
 failure_reason text check(failure_reason in ('transient_io','scanner_unavailable','lease_expired','malware','invalid_format','cancelled','attempts_exhausted')),
 primary key(organization_id,project_id,package_id,job_id),
 unique(organization_id,project_id,package_id,generation_id),
 unique(organization_id,project_id,package_id,job_id,generation_id),
 foreign key(organization_id,project_id,package_id,generation_id) references remhaos_integration.external_upload_generations,
 foreign key(organization_id,project_id,package_id,session_id) references remhaos_integration.external_upload_sessions,
 foreign key(organization_id,project_id,policy_binding_id) references remhaos_integration.external_upload_policy_bindings,
 check((state<>'leased' or (principal_id is not null and host_id is not null and worker_slot between 1 and 2 and host_slot between 1 and 64 and lease_digest is not null and attempt>0 and fence>0 and lease_expires_at>attempt_started_at and lease_expires_at<=walltime_deadline and walltime_deadline=attempt_started_at+interval '300 seconds')) is true)
);
create unique index external_validation_one_project_job on remhaos_integration.external_validation_jobs(organization_id,project_id) where state='leased';
create unique index external_validation_one_worker_slot on remhaos_integration.external_validation_jobs(principal_id,worker_slot) where state='leased';
create unique index external_validation_one_host_slot on remhaos_integration.external_validation_jobs(host_id,host_slot) where state='leased';
create table remhaos_integration.external_validation_project_slots (
 organization_id uuid not null, project_id uuid not null, package_id uuid, job_id uuid, fence bigint,
 primary key(organization_id,project_id),
 foreign key(organization_id,project_id) references project_intelligence.project_workflows(organization_id,project_id),
 foreign key(organization_id,project_id,package_id,job_id) references remhaos_integration.external_validation_jobs,
 check((job_id is null and package_id is null and fence is null) or (job_id is not null and package_id is not null and fence>0))
);
create table remhaos_integration.external_validation_attempts (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null, job_id uuid not null,
 generation_id uuid not null, attempt integer not null check(attempt between 1 and 3), fence bigint not null check(fence>0),
 principal_id uuid not null references remhaos_integration.external_validation_principals,
 lease_digest bytea not null check(octet_length(lease_digest)=32), started_at timestamptz not null, walltime_deadline timestamptz not null,
 primary key(organization_id,project_id,package_id,job_id,attempt,fence),
 unique(organization_id,project_id,package_id,job_id,fence),
 foreign key(organization_id,project_id,package_id,job_id,generation_id) references remhaos_integration.external_validation_jobs(organization_id,project_id,package_id,job_id,generation_id),
 check(walltime_deadline=started_at+interval '300 seconds')
);
create table remhaos_integration.external_validation_receipts (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null, receipt_id uuid not null,
 job_id uuid not null, generation_id uuid not null, attempt integer not null, fence bigint not null,
 object_identity_digest bytea not null check(octet_length(object_identity_digest)=32),
 outcome text not null check(outcome in ('successful','failed')), reason text,
 source_sha256 bytea check(octet_length(source_sha256)=32), byte_length bigint check(byte_length>0), validated_format text,
 validation_profile text not null, policy_binding_id uuid not null,
 structure_policy_version text, structure_result text check(structure_result in ('valid','invalid','unavailable')),
 av_outcome text check(av_outcome in ('clean','infected','scan_failed')),
 scanner_adapter_version text, engine_version text, executable_sha256 bytea check(octet_length(executable_sha256)=32),
 signature_version bigint check(signature_version>0), signature_bundle_sha256 bytea check(octet_length(signature_bundle_sha256)=32),
 signature_policy_version text, scan_started_at timestamptz, scan_completed_at timestamptz,
 sandbox_attestation_reference text, sandbox_evidence_digest bytea check(octet_length(sandbox_evidence_digest)=32),
 completion_request_id uuid not null,
 primary key(organization_id,project_id,package_id,receipt_id),
 unique(organization_id,project_id,package_id,job_id,attempt,fence),
 unique(organization_id,project_id,package_id,receipt_id,generation_id),
 foreign key(organization_id,project_id,package_id,job_id,attempt,fence) references remhaos_integration.external_validation_attempts,
 foreign key(organization_id,project_id,package_id,job_id,generation_id) references remhaos_integration.external_validation_jobs(organization_id,project_id,package_id,job_id,generation_id),
 foreign key(organization_id,project_id,policy_binding_id) references remhaos_integration.external_upload_policy_bindings,
 check((outcome='failed' and char_length(btrim(reason))>0 or outcome='successful' and reason is null and source_sha256 is not null and byte_length>0 and validated_format is not null and char_length(btrim(structure_policy_version))>0 and structure_result='valid' and av_outcome='clean' and char_length(btrim(scanner_adapter_version))>0 and char_length(btrim(engine_version))>0 and executable_sha256 is not null and signature_version>0 and signature_bundle_sha256 is not null and char_length(btrim(signature_policy_version))>0 and scan_started_at is not null and scan_completed_at>=scan_started_at and char_length(btrim(sandbox_attestation_reference))>0 and sandbox_evidence_digest is not null) is true)
);
create table remhaos_integration.external_canonical_object_receipts (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null, receipt_id uuid not null,
 generation_id uuid not null, validation_receipt_id uuid not null,
 object_identity_digest bytea not null check(octet_length(object_identity_digest)=32),
 private_locator text not null check(char_length(btrim(private_locator)) between 1 and 2000),
 source_sha256 bytea not null check(octet_length(source_sha256)=32), byte_length bigint not null check(byte_length>0),
 persistence_policy_version text not null check(char_length(btrim(persistence_policy_version))>0),
 verification_evidence_digest bytea not null check(octet_length(verification_evidence_digest)=32),
 verified_at timestamptz not null,
 primary key(organization_id,project_id,package_id,receipt_id),
 unique(organization_id,project_id,package_id,generation_id,object_identity_digest),
 unique(organization_id,project_id,package_id,receipt_id,generation_id,validation_receipt_id),
 foreign key(organization_id,project_id,package_id,validation_receipt_id,generation_id) references remhaos_integration.external_validation_receipts(organization_id,project_id,package_id,receipt_id,generation_id)
);
create table remhaos_integration.external_validation_completions (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null, job_id uuid not null, generation_id uuid not null,
 validation_receipt_id uuid not null, canonical_receipt_id uuid not null, attempt integer not null, fence bigint not null,
 principal_id uuid not null references remhaos_integration.external_validation_principals, completed_at timestamptz not null default statement_timestamp(),
 primary key(organization_id,project_id,package_id,job_id),
 unique(organization_id,project_id,package_id,generation_id),
 foreign key(organization_id,project_id,package_id,job_id,generation_id) references remhaos_integration.external_validation_jobs(organization_id,project_id,package_id,job_id,generation_id),
 foreign key(organization_id,project_id,package_id,canonical_receipt_id,generation_id,validation_receipt_id) references remhaos_integration.external_canonical_object_receipts(organization_id,project_id,package_id,receipt_id,generation_id,validation_receipt_id),
 foreign key(organization_id,project_id,package_id,job_id,attempt,fence) references remhaos_integration.external_validation_attempts
);

-- Credential comparison is a private correlation check. It does not implement
-- the separately required broker transport or constant-time crypto boundary.
create function remhaos_integration._external_validation_authorize(
 p_principal_id uuid,p_principal_secret text,p_organization_id uuid,p_project_id uuid,p_package_id uuid,
 p_require_processing boolean default true
) returns remhaos_integration.external_validation_principals
language plpgsql security definer set search_path='' as $f$
declare p remhaos_integration.external_validation_principals%rowtype; h remhaos_integration.external_upload_policy_heads%rowtype;
begin
 select * into p from remhaos_integration.external_validation_principals where principal_id=p_principal_id;
 if not found or p_principal_secret is null or char_length(p_principal_secret) not between 32 and 512 or p.credential_digest is distinct from project_intelligence._sha256_text(p_principal_secret) or p.valid_until<=clock_timestamp() then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 if not exists(select 1 from remhaos_integration.external_validation_principal_scopes s where s.principal_id=p.principal_id and s.organization_id=p_organization_id and s.project_id=p_project_id and s.package_id=p_package_id and s.valid_until>clock_timestamp()) then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 perform 1 from project_intelligence.project_workflows where organization_id=p_organization_id and project_id=p_project_id for update;
 if not found then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 perform 1 from project_intelligence.organizations where id=p_organization_id for share;
 perform 1 from projectceo_foundation.project_packages where organization_id=p_organization_id and project_id=p_project_id and id=p_package_id for share;
 select * into strict h from remhaos_integration.external_upload_policy_heads where organization_id=p_organization_id and project_id=p_project_id for update;
 perform 1 from remhaos_integration.external_upload_quota_ledgers where organization_id=p_organization_id and project_id=p_project_id for update;
 insert into remhaos_integration.external_validation_project_slots(organization_id,project_id) values(p_organization_id,p_project_id) on conflict do nothing;
 perform 1 from remhaos_integration.external_validation_project_slots where organization_id=p_organization_id and project_id=p_project_id for update;
 perform 1 from remhaos_integration.external_validation_hosts where host_id=p.host_id and valid_until>clock_timestamp() for update;
 if not found then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 perform 1 from remhaos_integration.external_validation_principal_heads where principal_id=p.principal_id and active for share;
 if not found then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 if p.valid_until<=clock_timestamp() or not exists(select 1 from remhaos_integration.external_validation_hosts host_binding where host_binding.host_id=p.host_id and host_binding.valid_until>clock_timestamp()) or not exists(select 1 from remhaos_integration.external_validation_principal_scopes s where s.principal_id=p.principal_id and s.organization_id=p_organization_id and s.project_id=p_project_id and s.package_id=p_package_id and s.valid_until>clock_timestamp()) then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 if p_require_processing is not false and (not h.processing_eligible or not exists(
  select 1 from project_intelligence.organizations o join projectceo_foundation.project_packages pp on pp.organization_id=o.id
  where o.id=p_organization_id and o.status='active' and o.cell_code='ru' and pp.project_id=p_project_id and pp.id=p_package_id and pp.status='active') or not exists(
  select 1 from remhaos_integration.external_validation_principal_scopes s join remhaos_integration.external_upload_policy_bindings b using(organization_id,project_id,policy_binding_id)
  where s.principal_id=p.principal_id and s.organization_id=p_organization_id and s.project_id=p_project_id and s.package_id=p_package_id and s.policy_binding_id=h.policy_binding_id and s.valid_until>clock_timestamp() and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp())) then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 return p;
end $f$;

create function remhaos_integration._external_validation_replay(
 p_org uuid,p_project uuid,p_operation text,p_actor text,p_key text,p_payload jsonb
) returns table(key_digest bytea,request_digest bytea,replay jsonb)
language plpgsql security definer set search_path='' as $f$
#variable_conflict use_variable
begin
 if p_key is null or p_key<>btrim(p_key) or char_length(p_key) not between 1 and 512 then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
 key_digest:=project_intelligence._sha256_text(p_key);
 request_digest:=project_intelligence._sha256_jsonb(jsonb_build_object('organizationId',p_org,'projectId',p_project,'operation',p_operation,'actor',p_actor,'payload',p_payload));
 replay:=remhaos_integration._replay_or_null(p_org,p_project,p_operation,key_digest,request_digest);
 return next;
end $f$;

create function remhaos_integration._enqueue_external_validation_job(p_org uuid,p_project uuid,p_package uuid,p_generation uuid)
returns uuid language plpgsql security definer set search_path='' as $f$
declare g remhaos_integration.external_upload_generations%rowtype; s remhaos_integration.external_upload_sessions%rowtype; id uuid; profile text;
begin
 perform 1 from project_intelligence.project_workflows where organization_id=p_org and project_id=p_project for update;
 perform 1 from remhaos_integration.external_upload_policy_heads where organization_id=p_org and project_id=p_project for update;
 select * into strict g from remhaos_integration.external_upload_generations where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=p_org and project_id=p_project and package_id=p_package and session_id=g.session_id for update;
 if s.state<>'finalized' or s.cancellation_revision<>0 or not exists(select 1 from remhaos_integration.external_upload_outbox x where x.organization_id=p_org and x.project_id=p_project and x.package_id=p_package and x.session_id=s.session_id and x.generation_id=g.generation_id and x.kind='enqueue_validation') then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
 select job_id into id from remhaos_integration.external_validation_jobs where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation;
 if found then return id; end if;
 select validation_profile into profile from remhaos_integration._external_upload_format_policy(g.requested_format);
 id:=extensions.gen_random_uuid();
 insert into remhaos_integration.external_validation_jobs(organization_id,project_id,package_id,job_id,generation_id,session_id,policy_binding_id,validation_profile,session_cancellation_revision,policy_cancellation_revision)
 values(p_org,p_project,p_package,id,p_generation,g.session_id,s.policy_binding_id,profile,s.cancellation_revision,s.policy_cancellation_revision);
 update remhaos_integration.external_upload_outbox set state='completed',revision=revision+1,attempts=attempts+1 where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation and kind='enqueue_validation' and state in ('pending','claimed');
 return id;
end $f$;

create function remhaos_integration._external_validation_job_current(
 p_org uuid,p_project uuid,p_package uuid,p_job uuid,p_principal uuid,p_attempt integer,p_fence bigint,p_lease_secret text,p_require_live boolean
) returns remhaos_integration.external_validation_jobs
language plpgsql security definer set search_path='' as $f$
declare j remhaos_integration.external_validation_jobs%rowtype; s remhaos_integration.external_upload_sessions%rowtype; h remhaos_integration.external_upload_policy_heads%rowtype;
begin
 select * into strict j from remhaos_integration.external_validation_jobs where organization_id=p_org and project_id=p_project and package_id=p_package and job_id=p_job;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=p_org and project_id=p_project and package_id=p_package and session_id=j.session_id for update;
 select * into strict j from remhaos_integration.external_validation_jobs where organization_id=p_org and project_id=p_project and package_id=p_package and job_id=p_job for update;
 select * into strict h from remhaos_integration.external_upload_policy_heads where organization_id=p_org and project_id=p_project;
 if s.state<>'finalized' or s.cancellation_revision<>j.session_cancellation_revision or h.policy_binding_id<>j.policy_binding_id or h.cancellation_revision<>j.policy_cancellation_revision or not h.processing_eligible then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 if p_require_live is not false and (j.state<>'leased' or j.principal_id is distinct from p_principal or j.attempt is distinct from p_attempt or j.fence is distinct from p_fence or p_lease_secret is null or char_length(p_lease_secret) not between 32 and 512 or j.lease_digest is distinct from project_intelligence._sha256_text(p_lease_secret) or j.lease_expires_at<=clock_timestamp() or j.walltime_deadline<=clock_timestamp()) then perform projectceo_product._raise('P1107','stale_state','{}'); end if;
 return j;
end $f$;

create function remhaos_integration._claim_external_validation_job(
 p_principal uuid,p_principal_secret text,p_org uuid,p_project uuid,p_package uuid,p_profile text,p_lease_secret text,p_key text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare p remhaos_integration.external_validation_principals%rowtype; j remhaos_integration.external_validation_jobs%rowtype; r record; ws integer; hs integer; now_at timestamptz:=clock_timestamp(); result jsonb;
begin
 p:=remhaos_integration._external_validation_authorize(p_principal,p_principal_secret,p_org,p_project,p_package);
 if p_lease_secret is null or char_length(p_lease_secret) not between 32 and 512 then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
 select * into r from remhaos_integration._external_validation_replay(p_org,p_project,'claim_external_validation_job',p.actor_id,p_key,jsonb_build_object('packageId',p_package,'principalId',p_principal,'profile',p_profile,'leaseDigest',encode(project_intelligence._sha256_text(p_lease_secret),'hex')));
 if r.replay is not null then
  perform remhaos_integration._external_validation_job_current(p_org,p_project,p_package,(r.replay#>>'{result,jobId}')::uuid,p_principal,null,null,null,false);
  return r.replay;
 end if;
 if exists(select 1 from remhaos_integration.external_validation_project_slots where organization_id=p_org and project_id=p_project and job_id is not null) then perform projectceo_product._raise('P1107','stale_state','{"reason":"validation_project_slot_busy"}'); end if;
 select n into ws from generate_series(1,p.worker_slot_cap) n where not exists(select 1 from remhaos_integration.external_validation_jobs where principal_id=p_principal and state='leased' and worker_slot=n) order by n limit 1;
 select n into hs from generate_series(1,(select slot_cap from remhaos_integration.external_validation_hosts where host_id=p.host_id)) n where not exists(select 1 from remhaos_integration.external_validation_jobs where host_id=p.host_id and state='leased' and host_slot=n) order by n limit 1;
 if ws is null or hs is null then perform projectceo_product._raise('P1107','stale_state','{"reason":"validation_worker_slot_busy"}'); end if;
 select * into j from remhaos_integration.external_validation_jobs where organization_id=p_org and project_id=p_project and package_id=p_package and validation_profile=p_profile and state='queued' and available_at<=now_at and attempt<3 order by available_at,job_id limit 1 for update skip locked;
 if not found then perform projectceo_product._raise('P1104','not_found','{}'); end if;
 j:=remhaos_integration._external_validation_job_current(p_org,p_project,p_package,j.job_id,p_principal,null,null,null,false);
 now_at:=clock_timestamp();
 update remhaos_integration.external_validation_jobs set state='leased',attempt=attempt+1,fence=fence+1,revision=revision+1,principal_id=p.principal_id,host_id=p.host_id,worker_slot=ws,host_slot=hs,lease_digest=project_intelligence._sha256_text(p_lease_secret),attempt_started_at=now_at,walltime_deadline=now_at+interval '300 seconds',lease_expires_at=now_at+interval '60 seconds',failure_reason=null
 where organization_id=p_org and project_id=p_project and package_id=p_package and job_id=j.job_id returning * into j;
 insert into remhaos_integration.external_validation_attempts(organization_id,project_id,package_id,job_id,generation_id,attempt,fence,principal_id,lease_digest,started_at,walltime_deadline)
 values(p_org,p_project,p_package,j.job_id,j.generation_id,j.attempt,j.fence,p.principal_id,j.lease_digest,now_at,j.walltime_deadline);
 update remhaos_integration.external_validation_project_slots set package_id=p_package,job_id=j.job_id,fence=j.fence where organization_id=p_org and project_id=p_project;
 result:=jsonb_build_object('jobId',j.job_id,'generationId',j.generation_id,'attempt',j.attempt,'fence',j.fence,'leaseExpiresAt',j.lease_expires_at,'walltimeDeadline',j.walltime_deadline);
 return remhaos_integration._complete_command(p_org,p_project,'claim_external_validation_job',r.key_digest,r.request_digest,'system',p.actor_id,null,result,'claim_external_validation_job','ok','{}');
end $f$;

create function remhaos_integration._heartbeat_external_validation_job(p_principal uuid,p_principal_secret text,p_org uuid,p_project uuid,p_package uuid,p_job uuid,p_attempt integer,p_fence bigint,p_lease_secret text)
returns timestamptz language plpgsql security definer set search_path='' as $f$
declare j remhaos_integration.external_validation_jobs%rowtype; expires timestamptz;
begin
 perform remhaos_integration._external_validation_authorize(p_principal,p_principal_secret,p_org,p_project,p_package);
 j:=remhaos_integration._external_validation_job_current(p_org,p_project,p_package,p_job,p_principal,p_attempt,p_fence,p_lease_secret,true);
 expires:=least(clock_timestamp()+interval '60 seconds',j.walltime_deadline);
 update remhaos_integration.external_validation_jobs set lease_expires_at=expires,revision=revision+1 where organization_id=p_org and project_id=p_project and package_id=p_package and job_id=p_job;
 return expires;
end $f$;

alter table remhaos_integration.external_validation_receipts add column scanner_policy_version text;
alter table remhaos_integration.external_validation_receipts add column sandbox_policy_version text;
alter table remhaos_integration.external_validation_receipts add check(outcome<>'successful' or (scanner_policy_version is not null and sandbox_policy_version is not null));

create function remhaos_integration._external_validation_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare j remhaos_integration.external_validation_jobs%rowtype; g remhaos_integration.external_upload_generations%rowtype; s remhaos_integration.external_upload_sessions%rowtype; z remhaos_integration.external_upload_seal_receipts%rowtype;
 b remhaos_integration.external_upload_policy_bindings%rowtype; v remhaos_integration.external_validation_receipts%rowtype;
begin
 if tg_table_name='external_validation_principal_heads' then
  if tg_op='DELETE' or tg_op='UPDATE' and (new.principal_id<>old.principal_id or new.revision<>old.revision+1) then raise exception 'VALIDATION_PRINCIPAL_HEAD_IMMUTABLE'; end if;
  return new;
 end if;
 if tg_table_name='external_validation_jobs' then
  if tg_op='DELETE' then raise exception 'VALIDATION_JOB_DELETE_DENIED'; end if;
  select * into strict g from remhaos_integration.external_upload_generations where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and generation_id=new.generation_id;
  select * into strict s from remhaos_integration.external_upload_sessions where organization_id=g.organization_id and project_id=g.project_id and package_id=g.package_id and session_id=g.session_id;
  if new.session_id<>g.session_id or new.policy_binding_id<>s.policy_binding_id or new.validation_profile<>(select validation_profile from remhaos_integration._external_upload_format_policy(g.requested_format)) then raise exception 'VALIDATION_JOB_GENERATION_MISMATCH'; end if;
  if tg_op='INSERT' then
   if new.state<>'queued' or new.attempt<>0 or new.fence<>0 or new.revision<>0 or new.principal_id is not null or new.lease_digest is not null or new.session_cancellation_revision<>s.cancellation_revision or new.policy_cancellation_revision<>s.policy_cancellation_revision then raise exception 'VALIDATION_INITIAL_JOB_INVALID'; end if;
  else
   if (to_jsonb(new)-array['state','attempt','fence','revision','available_at','principal_id','host_id','worker_slot','host_slot','lease_digest','lease_expires_at','attempt_started_at','walltime_deadline','failure_reason']) is distinct from (to_jsonb(old)-array['state','attempt','fence','revision','available_at','principal_id','host_id','worker_slot','host_slot','lease_digest','lease_expires_at','attempt_started_at','walltime_deadline','failure_reason']) or old.revision>=9007199254740991 or new.revision<>old.revision+1 then raise exception 'VALIDATION_JOB_ORIGIN_IMMUTABLE'; end if;
   if old.state='queued' and new.state='leased' then
    if new.attempt<>old.attempt+1 or new.fence<>old.fence+1 or new.lease_expires_at>new.attempt_started_at+interval '60 seconds' then raise exception 'VALIDATION_ATTEMPT_FENCE_INVALID'; end if;
   elsif old.state='leased' and new.state in ('leased','queued','failed','succeeded') then
    if (new.attempt,new.fence,new.principal_id,new.host_id,new.worker_slot,new.host_slot,new.lease_digest,new.attempt_started_at,new.walltime_deadline) is distinct from (old.attempt,old.fence,old.principal_id,old.host_id,old.worker_slot,old.host_slot,old.lease_digest,old.attempt_started_at,old.walltime_deadline) or (new.state='leased' and (old.lease_expires_at<=clock_timestamp() or new.lease_expires_at<old.lease_expires_at or new.lease_expires_at>clock_timestamp()+interval '60 seconds')) then raise exception 'VALIDATION_LIVE_LEASE_INVALID'; end if;
   else raise exception 'VALIDATION_JOB_STATE_TRANSITION'; end if;
  end if;
  if new.state='leased' and not exists(select 1 from remhaos_integration.external_validation_principals p join remhaos_integration.external_validation_hosts h using(host_id) where p.principal_id=new.principal_id and p.host_id=new.host_id and new.worker_slot<=p.worker_slot_cap and new.host_slot<=h.slot_cap) then raise exception 'VALIDATION_SLOT_CAP'; end if;
  return new;
 end if;
 if tg_table_name in ('external_validation_attempts','external_validation_receipts','external_validation_completions') then
  select * into strict j from remhaos_integration.external_validation_jobs where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and job_id=new.job_id;
  if j.generation_id<>new.generation_id or j.attempt<>new.attempt or j.fence<>new.fence or j.state<>'leased' or j.lease_expires_at<=clock_timestamp() then raise exception 'VALIDATION_RECEIPT_STALE_FENCE'; end if;
  if tg_table_name='external_validation_attempts' then
   if new.principal_id<>j.principal_id or new.lease_digest<>j.lease_digest or new.started_at<>j.attempt_started_at or new.walltime_deadline<>j.walltime_deadline then raise exception 'VALIDATION_ATTEMPT_MISMATCH'; end if;
   return new;
  elsif tg_table_name='external_validation_completions' then
   select * into strict v from remhaos_integration.external_validation_receipts where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and receipt_id=new.validation_receipt_id;
   if new.principal_id<>j.principal_id or v.job_id<>j.job_id or v.attempt<>j.attempt or v.fence<>j.fence or v.outcome<>'successful' then raise exception 'VALIDATION_COMPLETION_MISMATCH'; end if;
   return new;
  end if;
 end if;
 if tg_table_name='external_validation_receipts' then
  select * into strict g from remhaos_integration.external_upload_generations where organization_id=j.organization_id and project_id=j.project_id and package_id=j.package_id and generation_id=j.generation_id;
  select * into strict z from remhaos_integration.external_upload_seal_receipts where organization_id=g.organization_id and project_id=g.project_id and package_id=g.package_id and receipt_id=g.seal_receipt_id;
  select * into strict b from remhaos_integration.external_upload_policy_bindings where organization_id=j.organization_id and project_id=j.project_id and policy_binding_id=j.policy_binding_id;
  if new.object_identity_digest<>z.object_identity_digest or new.policy_binding_id<>j.policy_binding_id or new.validation_profile<>j.validation_profile or not new.validation_profile=any(b.accepted_profiles)
   or (new.byte_length is not null and new.byte_length<>g.observed_byte_length) or (new.validated_format is not null and new.validated_format<>g.requested_format)
   or (z.copy_sha256 is not null and new.source_sha256 is not null and z.copy_sha256<>new.source_sha256) then raise exception 'VALIDATION_MEASUREMENT_GENERATION_MISMATCH'; end if;
  if new.outcome='successful' and (new.scanner_policy_version is distinct from b.scanner_policy_version or new.signature_policy_version is distinct from b.signature_policy_version or new.sandbox_policy_version is distinct from b.sandbox_policy_version or new.scan_started_at<j.attempt_started_at or new.scan_completed_at>clock_timestamp() or new.scan_completed_at>j.walltime_deadline) then raise exception 'VALIDATION_RUNTIME_POLICY_MISMATCH'; end if;
 elsif tg_table_name='external_canonical_object_receipts' then
  select * into strict v from remhaos_integration.external_validation_receipts where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and receipt_id=new.validation_receipt_id;
  select * into strict b from remhaos_integration.external_upload_policy_bindings where organization_id=v.organization_id and project_id=v.project_id and policy_binding_id=v.policy_binding_id;
  if v.outcome<>'successful' or new.generation_id<>v.generation_id or new.source_sha256 is distinct from v.source_sha256 or new.byte_length is distinct from v.byte_length or new.persistence_policy_version<>b.storage_policy_version or new.verified_at<v.scan_completed_at or new.verified_at>clock_timestamp() then raise exception 'VALIDATION_CANONICAL_BYTE_MISMATCH'; end if;
 end if;
 return new;
end $f$;

create function remhaos_integration._finish_external_validation_job(
 p_principal uuid,p_principal_secret text,p_org uuid,p_project uuid,p_package uuid,p_job uuid,p_attempt integer,p_fence bigint,p_lease_secret text,
 p_success boolean,p_validation_receipt uuid,p_canonical_receipt uuid,p_reason text,p_key text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare p remhaos_integration.external_validation_principals%rowtype; j remhaos_integration.external_validation_jobs%rowtype; s remhaos_integration.external_upload_sessions%rowtype;
 v remhaos_integration.external_validation_receipts%rowtype; r record; op text; next_state text; result jsonb;
begin
 p:=remhaos_integration._external_validation_authorize(p_principal,p_principal_secret,p_org,p_project,p_package);
 j:=remhaos_integration._external_validation_job_current(p_org,p_project,p_package,p_job,p_principal,p_attempt,p_fence,p_lease_secret,false);
 if p_success is null or (not p_success and (p_reason is null or p_reason not in ('transient_io','scanner_unavailable','malware','invalid_format','cancelled'))) or (p_success and (p_reason is not null or p_validation_receipt is null or p_canonical_receipt is null)) then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
 op:=case when p_success then 'complete_external_validation_job' else 'fail_external_validation_job' end;
 select * into r from remhaos_integration._external_validation_replay(p_org,p_project,op,p.actor_id,p_key,jsonb_build_object('packageId',p_package,'principalId',p_principal,'jobId',p_job,'attempt',p_attempt,'fence',p_fence,'leaseDigest',encode(project_intelligence._sha256_text(p_lease_secret),'hex'),'validationReceiptId',p_validation_receipt,'canonicalReceiptId',p_canonical_receipt,'reason',p_reason));
 if r.replay is not null then return r.replay; end if;
 j:=remhaos_integration._external_validation_job_current(p_org,p_project,p_package,p_job,p_principal,p_attempt,p_fence,p_lease_secret,true);
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=p_org and project_id=p_project and package_id=p_package and session_id=j.session_id;
 if p_success then
  select * into strict v from remhaos_integration.external_validation_receipts where organization_id=p_org and project_id=p_project and package_id=p_package and receipt_id=p_validation_receipt;
  insert into remhaos_integration.external_validation_completions(organization_id,project_id,package_id,job_id,generation_id,validation_receipt_id,canonical_receipt_id,attempt,fence,principal_id)
  values(p_org,p_project,p_package,p_job,j.generation_id,p_validation_receipt,p_canonical_receipt,j.attempt,j.fence,p.principal_id);
  -- Byte-validation success is not materialization. Keep logical and physical
  -- reservations conservatively held until slice D atomically inserts lineage
  -- and performs its corresponding measured accounting conversion.
  next_state:='succeeded';
 else
  if p_validation_receipt is not null then
   select * into strict v from remhaos_integration.external_validation_receipts where organization_id=p_org and project_id=p_project and package_id=p_package and receipt_id=p_validation_receipt;
   if v.job_id<>p_job or v.attempt<>j.attempt or v.fence<>j.fence or v.outcome<>'failed' or (p_reason='malware' and v.av_outcome is distinct from 'infected') or (p_reason='invalid_format' and v.structure_result is distinct from 'invalid') then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
  end if;
  if p_reason in ('malware','invalid_format') and p_validation_receipt is null then perform projectceo_product._raise('P1111','validation_failed','{"reason":"validation_failure_receipt_required"}'); end if;
  next_state:=case when p_reason in ('transient_io','scanner_unavailable') and j.attempt<3 then 'queued' else 'failed' end;
  if next_state='failed' then
   update remhaos_integration.external_upload_reservations set state='orphaned',revision=revision+1,logical_reserved=0,logical_used=0,physical_orphan=physical_reserved+physical_used+physical_orphan,physical_reserved=0,physical_used=0
   where organization_id=p_org and project_id=p_project and package_id=p_package and reservation_id=s.reservation_id;
  end if;
 end if;
 update remhaos_integration.external_validation_jobs set state=next_state,revision=revision+1,failure_reason=p_reason,available_at=clock_timestamp() where organization_id=p_org and project_id=p_project and package_id=p_package and job_id=p_job;
 update remhaos_integration.external_validation_project_slots set package_id=null,job_id=null,fence=null where organization_id=p_org and project_id=p_project and job_id=p_job and fence=j.fence;
 result:=jsonb_build_object('jobId',p_job,'generationId',j.generation_id,'attempt',j.attempt,'fence',j.fence,'state',next_state,'validationReceiptId',p_validation_receipt,'canonicalReceiptId',p_canonical_receipt);
 return remhaos_integration._complete_command(p_org,p_project,op,r.key_digest,r.request_digest,'system',p.actor_id,null,result,op,'ok',jsonb_strip_nulls(jsonb_build_object('reason',p_reason)));
end $f$;

create function remhaos_integration._reclaim_external_validation_job(p_principal uuid,p_principal_secret text,p_org uuid,p_project uuid,p_package uuid,p_job uuid,p_expected_attempt integer,p_expected_fence bigint,p_key text)
returns text language plpgsql security definer set search_path='' as $f$
declare j remhaos_integration.external_validation_jobs%rowtype; s remhaos_integration.external_upload_sessions%rowtype; h remhaos_integration.external_upload_policy_heads%rowtype; next_state text; p remhaos_integration.external_validation_principals%rowtype; r record;
begin
 -- Cleanup-only authority: a revoked processing entitlement must not keep an
 -- expired slot occupied. This path cannot claim work or accept measurements.
 p:=remhaos_integration._external_validation_authorize(p_principal,p_principal_secret,p_org,p_project,p_package,false);
 select * into r from remhaos_integration._external_validation_replay(p_org,p_project,'reclaim_external_validation_job',p.actor_id,p_key,jsonb_build_object('packageId',p_package,'principalId',p_principal,'jobId',p_job,'attempt',p_expected_attempt,'fence',p_expected_fence));
 if r.replay is not null then return r.replay#>>'{result,state}'; end if;
 select * into strict j from remhaos_integration.external_validation_jobs where organization_id=p_org and project_id=p_project and package_id=p_package and job_id=p_job;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=p_org and project_id=p_project and package_id=p_package and session_id=j.session_id for update;
 select * into strict j from remhaos_integration.external_validation_jobs where organization_id=p_org and project_id=p_project and package_id=p_package and job_id=p_job for update;
 if j.state<>'leased' or j.attempt is distinct from p_expected_attempt or j.fence is distinct from p_expected_fence or j.lease_expires_at>clock_timestamp() then perform projectceo_product._raise('P1107','stale_state','{}'); end if;
 select * into strict h from remhaos_integration.external_upload_policy_heads where organization_id=p_org and project_id=p_project;
 next_state:=case when j.attempt>=3 or not h.processing_eligible or h.policy_binding_id<>j.policy_binding_id or h.cancellation_revision<>j.policy_cancellation_revision or s.cancellation_revision<>j.session_cancellation_revision then 'failed' else 'queued' end;
 update remhaos_integration.external_validation_jobs set state=next_state,revision=revision+1,failure_reason='lease_expired',available_at=clock_timestamp() where organization_id=p_org and project_id=p_project and package_id=p_package and job_id=p_job;
 update remhaos_integration.external_validation_project_slots set package_id=null,job_id=null,fence=null where organization_id=p_org and project_id=p_project and job_id=p_job and fence=j.fence;
 if next_state='failed' then
  update remhaos_integration.external_upload_reservations set state='orphaned',revision=revision+1,logical_reserved=0,logical_used=0,physical_orphan=physical_reserved+physical_used+physical_orphan,physical_reserved=0,physical_used=0
  where organization_id=p_org and project_id=p_project and package_id=p_package and reservation_id=s.reservation_id;
 end if;
 perform remhaos_integration._complete_command(p_org,p_project,'reclaim_external_validation_job',r.key_digest,r.request_digest,'system',p.actor_id,null,jsonb_build_object('jobId',p_job,'attempt',j.attempt,'fence',j.fence,'state',next_state),'reclaim_external_validation_job','ok','{}');
 return next_state;
end $f$;

create function remhaos_integration._external_validation_closure()
returns trigger language plpgsql security definer set search_path='' as $f$
declare j remhaos_integration.external_validation_jobs%rowtype;
begin
 select * into strict j from remhaos_integration.external_validation_jobs where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and job_id=new.job_id;
 if j.state='leased' and (not exists(select 1 from remhaos_integration.external_validation_attempts a where a.organization_id=j.organization_id and a.project_id=j.project_id and a.package_id=j.package_id and a.job_id=j.job_id and a.attempt=j.attempt and a.fence=j.fence and a.principal_id=j.principal_id and a.lease_digest=j.lease_digest) or not exists(select 1 from remhaos_integration.external_validation_project_slots s where s.organization_id=j.organization_id and s.project_id=j.project_id and s.package_id=j.package_id and s.job_id=j.job_id and s.fence=j.fence)) then raise exception 'VALIDATION_LEASE_CLOSURE_MISSING'; end if;
 if j.state<>'leased' and exists(select 1 from remhaos_integration.external_validation_project_slots s where s.organization_id=j.organization_id and s.project_id=j.project_id and s.job_id=j.job_id) then raise exception 'VALIDATION_SLOT_NOT_RELEASED'; end if;
 if (j.state='succeeded') is distinct from exists(select 1 from remhaos_integration.external_validation_completions c where c.organization_id=j.organization_id and c.project_id=j.project_id and c.package_id=j.package_id and c.job_id=j.job_id and c.attempt=j.attempt and c.fence=j.fence) then raise exception 'VALIDATION_SUCCESS_CLOSURE_MISSING'; end if;
 return null;
end $f$;
create constraint trigger external_validation_job_closure after insert or update on remhaos_integration.external_validation_jobs deferrable initially deferred for each row execute function remhaos_integration._external_validation_closure();
create constraint trigger external_validation_completion_closure after insert on remhaos_integration.external_validation_completions deferrable initially deferred for each row execute function remhaos_integration._external_validation_closure();

create or replace function remhaos_integration._external_upload_terminal_consistency()
returns trigger language plpgsql security definer set search_path='' as $f$
declare s remhaos_integration.external_upload_sessions%rowtype; r remhaos_integration.external_upload_reservations%rowtype; g remhaos_integration.external_upload_generations%rowtype;
begin
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and session_id=new.session_id;
 select * into strict r from remhaos_integration.external_upload_reservations where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and reservation_id=s.reservation_id;
 select * into g from remhaos_integration.external_upload_generations where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and session_id=s.session_id;
 if s.state in ('open','finalizing') and r.state<>'reserved' then raise exception 'UPLOAD_ACTIVE_RESERVATION_NOT_RESERVED'; end if;
 if s.state='finalized' then
  if g.generation_id is null or (r.state<>'committed' and not (r.state='orphaned' and exists(select 1 from remhaos_integration.external_validation_jobs j where j.organization_id=s.organization_id and j.project_id=s.project_id and j.package_id=s.package_id and j.generation_id=g.generation_id and j.state='failed'))) or not exists(select 1 from remhaos_integration.external_upload_outbox x where x.organization_id=s.organization_id and x.project_id=s.project_id and x.package_id=s.package_id and x.session_id=s.session_id and x.generation_id=g.generation_id and x.kind='enqueue_validation') or not exists(
   select 1 from remhaos_integration.external_upload_seal_receipts z join remhaos_integration.external_upload_finalize_claims c using(organization_id,project_id,package_id,session_id,claim_id,fence)
   where z.organization_id=s.organization_id and z.project_id=s.project_id and z.package_id=s.package_id and z.receipt_id=g.seal_receipt_id and c.state='consumed') then raise exception 'UPLOAD_FINALIZE_CLOSURE_MISSING'; end if;
 elsif g.generation_id is not null then raise exception 'UPLOAD_GENERATION_NOT_FINALIZED';
 elsif s.state in ('cancelled','expired','failed') then
  if r.state<>'orphaned' or (select count(*) from remhaos_integration.external_upload_outbox x where x.organization_id=s.organization_id and x.project_id=s.project_id and x.package_id=s.package_id and x.session_id=s.session_id and x.target_fence=s.cancellation_revision and x.kind in ('revoke_upload','reconcile_upload'))<>2 then raise exception 'UPLOAD_TERMINAL_LIABILITY_MISSING'; end if;
 end if;
 return null;
end $f$;
create function remhaos_integration._complete_external_validation_job(p_principal uuid,p_principal_secret text,p_org uuid,p_project uuid,p_package uuid,p_job uuid,p_attempt integer,p_fence bigint,p_lease_secret text,p_validation_receipt uuid,p_canonical_receipt uuid,p_key text)
returns jsonb language sql security definer set search_path='' as $f$
 select remhaos_integration._finish_external_validation_job(p_principal,p_principal_secret,p_org,p_project,p_package,p_job,p_attempt,p_fence,p_lease_secret,true,p_validation_receipt,p_canonical_receipt,null,p_key)
$f$;
create function remhaos_integration._fail_external_validation_job(p_principal uuid,p_principal_secret text,p_org uuid,p_project uuid,p_package uuid,p_job uuid,p_attempt integer,p_fence bigint,p_lease_secret text,p_failed_receipt uuid,p_reason text,p_key text)
returns jsonb language sql security definer set search_path='' as $f$
 select remhaos_integration._finish_external_validation_job(p_principal,p_principal_secret,p_org,p_project,p_package,p_job,p_attempt,p_fence,p_lease_secret,false,p_failed_receipt,null,p_reason,p_key)
$f$;

create function remhaos_integration._external_validation_slot_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if tg_op='DELETE' or tg_op='UPDATE' and (new.organization_id,new.project_id) is distinct from (old.organization_id,old.project_id) then raise exception 'VALIDATION_PROJECT_SLOT_SCOPE_IMMUTABLE'; end if;
 if new.job_id is not null and not exists(select 1 from remhaos_integration.external_validation_jobs j where j.organization_id=new.organization_id and j.project_id=new.project_id and j.package_id=new.package_id and j.job_id=new.job_id and j.state='leased' and j.fence=new.fence) then raise exception 'VALIDATION_SLOT_FENCE_INVALID'; end if;
 if tg_op='UPDATE' and new.job_id is null and old.job_id is not null and exists(select 1 from remhaos_integration.external_validation_jobs j where j.organization_id=old.organization_id and j.project_id=old.project_id and j.job_id=old.job_id and j.state='leased') then raise exception 'VALIDATION_LIVE_SLOT_RELEASE_DENIED'; end if;
 return new;
end $f$;
create trigger external_validation_slot_guard before insert or update or delete on remhaos_integration.external_validation_project_slots for each row execute function remhaos_integration._external_validation_slot_guard();

do $registry$
declare operations text[]; definition text; literal_array text;
begin
 select pg_get_constraintdef(c.oid) into definition from pg_constraint c where c.conrelid='remhaos_integration.command_records'::regclass and c.conname='command_records_operation_check';
 -- A emits a typed array literal; older registries deparse as ARRAY['a','b'].
 -- Read either effective representation without restoring an historical list.
 literal_array:=(regexp_match(definition,$re$'(\{[^']+\})'$re$))[1];
 if literal_array is not null then operations:=literal_array::text[];
 else select array_agg(m[1]) into operations from regexp_matches(definition,$re$'([a-z0-9_]+)'$re$,'g') m;
 end if;
 if operations is null then raise exception 'VALIDATION_COMMAND_REGISTRY_MISSING'; end if;
 alter table remhaos_integration.command_records drop constraint command_records_operation_check;
 execute format('alter table remhaos_integration.command_records add constraint command_records_operation_check check(operation=any(%L::text[]))',operations||array['claim_external_validation_job','complete_external_validation_job','fail_external_validation_job','reclaim_external_validation_job']);
end $registry$;
do $security$
declare t text; f regprocedure;
begin
 foreach t in array array['external_validation_hosts','external_validation_principals','external_validation_principal_heads','external_validation_principal_scopes','external_validation_jobs','external_validation_project_slots','external_validation_attempts','external_validation_receipts','external_canonical_object_receipts','external_validation_completions'] loop
  if t not in ('external_validation_principal_heads','external_validation_jobs','external_validation_project_slots') then
   execute format('create trigger %I before update or delete on remhaos_integration.%I for each row execute function projectceo_foundation.reject_append_only_mutation()',t||'_append_only',t);
  end if;
  if t in ('external_validation_principal_heads','external_validation_jobs') then
   execute format('create trigger %I before insert or update or delete on remhaos_integration.%I for each row execute function remhaos_integration._external_validation_guard()',t||'_guard',t);
  elsif t in ('external_validation_attempts','external_validation_receipts','external_canonical_object_receipts','external_validation_completions') then
   execute format('create trigger %I before insert on remhaos_integration.%I for each row execute function remhaos_integration._external_validation_guard()',t||'_guard',t);
  end if;
  execute format('alter table remhaos_integration.%I owner to pi_table_owner',t);
  execute format('alter table remhaos_integration.%I enable row level security',t);
  execute format('alter table remhaos_integration.%I force row level security',t);
  execute format('revoke all on remhaos_integration.%I from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',t);
  execute format('create policy %I on remhaos_integration.%I for all to pi_table_owner using(true) with check(true)',t||'_owner_only',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='remhaos_integration' and p.proname in ('_external_validation_authorize','_external_validation_replay','_enqueue_external_validation_job','_external_validation_job_current','_claim_external_validation_job','_heartbeat_external_validation_job','_external_validation_guard','_finish_external_validation_job','_reclaim_external_validation_job','_external_validation_closure','_complete_external_validation_job','_fail_external_validation_job','_external_validation_slot_guard') loop
  execute format('alter function %s owner to pi_table_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',f);
 end loop;
end $security$;
commit;
