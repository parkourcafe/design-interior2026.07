-- WP-32 local repair. New doors remain revoked until an explicit environment gate.
-- A scoped capability authorizes a trusted SYSTEM worker; it is not AV attestation.
begin;
set local check_function_bodies = on;

create table remhaos_integration.file_scan_policies (
  digest bytea primary key check (octet_length(digest)=32),
  policy jsonb not null check (jsonb_typeof(policy)='object'),
  valid_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create table remhaos_integration.file_scan_gate (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  policy_digest bytea references remhaos_integration.file_scan_policies,
  epoch bigint not null default 0 check(epoch>=0),
  check(not enabled or policy_digest is not null)
);
insert into remhaos_integration.file_scan_gate(singleton) values(true);

create table remhaos_integration.file_scan_tasks (
  task_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null, project_id uuid not null, package_id uuid not null, intake_id uuid not null,
  requested_by uuid not null, capability_digest bytea not null check(octet_length(capability_digest)=32),
  checksum bytea not null check(octet_length(checksum)=32), byte_length bigint not null check(byte_length between 1 and 100000000),
  quarantine_key text not null, canonical_key text not null,
  source_role text not null, extension text not null, media_type text not null,
  policy_digest bytea not null references remhaos_integration.file_scan_policies,
  gate_epoch bigint not null,
  request_key_digest bytea not null check(octet_length(request_key_digest)=32),
  request_digest bytea not null check(octet_length(request_digest)=32),
  state text not null default 'queued' check(state in ('queued','leased','completed','cancelled')),
  attempt integer not null default 0 check(attempt between 0 and 3),
  fence bigint not null default 0 check(fence between 0 and 3),
  nonce uuid, lease_digest bytea check(octet_length(lease_digest)=32),
  claim_started_at timestamptz, lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
  foreign key(organization_id,project_id,package_id,intake_id)
    references remhaos_integration.file_intakes(organization_id,project_id,package_id,intake_id),
  foreign key(organization_id,requested_by) references project_intelligence.organization_members(organization_id,user_id),
  unique(organization_id,project_id,requested_by,request_key_digest),
  check(expires_at>created_at and expires_at<=created_at+interval '30 minutes'),
  check((state<>'leased' or (attempt>0 and fence=attempt and nonce is not null and lease_digest is not null
    and claim_started_at is not null and lease_expires_at>claim_started_at
    and lease_expires_at<=claim_started_at+interval '300 seconds' and lease_expires_at<=expires_at)) is true)
);
create unique index file_scan_one_active_intake on remhaos_integration.file_scan_tasks(organization_id,project_id,intake_id)
  where state in ('queued','leased');
create table remhaos_integration.file_scan_claims (
  task_id uuid not null references remhaos_integration.file_scan_tasks,
  attempt integer not null, fence bigint not null, nonce uuid not null,
  lease_digest bytea not null check(octet_length(lease_digest)=32),
  key_digest bytea not null check(octet_length(key_digest)=32),
  started_at timestamptz not null, expires_at timestamptz not null,
  primary key(task_id,attempt,fence), unique(task_id,key_digest)
);
create table remhaos_integration.file_scan_evidence (
  receipt_id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null unique references remhaos_integration.file_scan_tasks,
  attempt integer not null, fence bigint not null,
  key_digest bytea not null check(octet_length(key_digest)=32),
  evidence_digest bytea not null check(octet_length(evidence_digest)=32),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(task_id,attempt,fence) references remhaos_integration.file_scan_claims
);

do $tables$
declare name text;
begin
  foreach name in array array['file_scan_policies','file_scan_gate','file_scan_tasks','file_scan_claims','file_scan_evidence'] loop
    execute format('alter table remhaos_integration.%I owner to pi_table_owner',name);
    execute format('alter table remhaos_integration.%I enable row level security',name);
    execute format('alter table remhaos_integration.%I force row level security',name);
    execute format('revoke all on remhaos_integration.%I from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',name);
    execute format('create policy %I on remhaos_integration.%I for all to pi_table_owner using(true) with check(true)',name||'_owner_only',name);
  end loop;
  foreach name in array array['file_scan_policies','file_scan_claims','file_scan_evidence'] loop
    execute format('create trigger %I before update or delete on remhaos_integration.%I for each row execute function remhaos_integration.reject_append_only_mutation()',name||'_immutable',name);
  end loop;
end
$tables$;

-- Private deployment configuration, not a human/project API. Production stays disabled.
create function remhaos_integration.configure_disposable_file_scan_policy(p_policy jsonb,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $f$
declare keys text[]:=array['policyVersion','imageId','engineVersion','executableSha256','receiverSha256','signatureBundleSha256','signatureVersion','signatureTimestamp'];
  digest bytea; expires timestamptz;
begin
  if p_enabled is null then perform projectceo_foundation._raise('P1111','validation_failed','{}'); end if;
  if not p_enabled then update remhaos_integration.file_scan_gate set enabled=false,epoch=epoch+1; return; end if;
  if (jsonb_typeof(p_policy)='object' and p_policy?&keys and p_policy-keys='{}'::jsonb
    and p_policy->>'policyVersion'='wp32-clamav-local17/v1'
    and p_policy->>'imageId' ~ '^sha256:[a-f0-9]{64}$'
    and p_policy->>'engineVersion'='1.5.4'
    and p_policy->>'executableSha256' ~ '^[a-f0-9]{64}$'
    and p_policy->>'receiverSha256' ~ '^[a-f0-9]{64}$'
    and p_policy->>'signatureBundleSha256' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(p_policy->'signatureVersion')='number' and p_policy->>'signatureVersion' ~ '^[1-9][0-9]{0,9}$'
    and jsonb_typeof(p_policy->'signatureTimestamp')='number' and p_policy->>'signatureTimestamp' ~ '^[1-9][0-9]{0,10}$') is not true then
    perform projectceo_foundation._raise('P1111','validation_failed','{}');
  end if;
  expires:=to_timestamp((p_policy->>'signatureTimestamp')::bigint)+interval '24 hours';
  if expires<=clock_timestamp()+interval '300 seconds' or to_timestamp((p_policy->>'signatureTimestamp')::bigint)>clock_timestamp()+interval '5 minutes' then
    perform projectceo_foundation._raise('P1105','expired','{}');
  end if;
  digest:=project_intelligence._sha256_jsonb(p_policy);
  insert into remhaos_integration.file_scan_policies(digest,policy,valid_until) values(digest,p_policy,expires) on conflict do nothing;
  update remhaos_integration.file_scan_gate set enabled=true,policy_digest=digest,epoch=epoch+1;
end $f$;

create function remhaos_integration._lock_file_scan_authority(p_org uuid,p_project uuid,p_package uuid,p_user uuid)
returns void language plpgsql security definer set search_path='' as $f$
begin
  perform 1 from project_intelligence.organizations where id=p_org and status='active' and cell_code='ru' for share;
  if not found then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
  perform 1 from project_intelligence.organization_members where organization_id=p_org and user_id=p_user and status='active' for share;
  if not found then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
  perform 1 from projectceo_foundation.project_memberships where organization_id=p_org and project_id=p_project and user_id=p_user and status='active' for share;
  if not found then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
  perform 1 from projectceo_foundation.project_member_capabilities where organization_id=p_org and project_id=p_project and user_id=p_user and capability='manage_project_integrations' for share;
  if not found then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
  perform 1 from projectceo_foundation.project_packages where organization_id=p_org and project_id=p_project and id=p_package and status='active' and kind='project_root' for share;
  if not found then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
end $f$;

create function remhaos_integration_api.request_bound_file_scan(
  p_project_id uuid,p_intake_id uuid,p_capability_digest text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare c record; g remhaos_integration.file_scan_gate%rowtype; i remhaos_integration.file_intakes%rowtype;
  t remhaos_integration.file_scan_tasks%rowtype; kd bytea; rd bytea; valid_until timestamptz;
begin
  select * into c from projectceo_foundation._authorize_project_human(p_project_id,'manage_project_integrations');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  if p_intake_id is null or p_capability_digest is null or p_capability_digest !~ '^[a-f0-9]{64}$' then perform projectceo_foundation._raise('P1111','validation_failed','{}'); end if;
  select * into g from remhaos_integration.file_scan_gate where singleton for share;
  if g.enabled is not true then perform projectceo_foundation._raise('P1103','forbidden','{"reason":"SCANNER_GATE_CLOSED"}'); end if;
  select p.valid_until into valid_until from remhaos_integration.file_scan_policies p where p.digest=g.policy_digest;
  if valid_until<=clock_timestamp()+interval '300 seconds' then perform projectceo_foundation._raise('P1105','expired','{}'); end if;
  select * into i from remhaos_integration.file_intakes where organization_id=c.organization_id and project_id=p_project_id and intake_id=p_intake_id;
  if not found then perform projectceo_foundation._raise('P1104','not_found','{}'); end if;
  perform remhaos_integration._lock_file_scan_authority(i.organization_id,i.project_id,i.package_id,c.actor_user_id);
  select * into i from remhaos_integration.file_intakes where organization_id=c.organization_id and project_id=p_project_id and intake_id=p_intake_id for update;
  kd:=project_intelligence._sha256_text(p_idempotency_key);
  rd:=project_intelligence._sha256_jsonb(jsonb_build_object('intakeId',p_intake_id,'capabilityDigest',p_capability_digest));
  select * into t from remhaos_integration.file_scan_tasks where organization_id=c.organization_id and project_id=p_project_id and requested_by=c.actor_user_id and request_key_digest=kd;
  if found then
    if t.request_digest<>rd then perform projectceo_foundation._raise('P1108','idempotency_conflict','{}'); end if;
    return jsonb_build_object('operation','request_bound_file_scan','replay',true,'result',jsonb_build_object('taskId',t.task_id,'intakeId',t.intake_id));
  end if;
  if i.status<>'scan_pending' or not remhaos_integration._is_legacy_file_intake(i.organization_id,i.project_id,i.intake_id)
     or exists(select 1 from remhaos_integration.file_scan_tasks where organization_id=i.organization_id and project_id=i.project_id and intake_id=i.intake_id and state in ('queued','leased')) then
    perform projectceo_foundation._raise('P1109','scope_conflict','{}');
  end if;
  insert into remhaos_integration.file_scan_tasks(organization_id,project_id,package_id,intake_id,requested_by,capability_digest,checksum,byte_length,quarantine_key,canonical_key,source_role,extension,media_type,policy_digest,gate_epoch,request_key_digest,request_digest,expires_at)
  values(i.organization_id,i.project_id,i.package_id,i.intake_id,c.actor_user_id,decode(p_capability_digest,'hex'),i.checksum,i.size_bytes,i.quarantine_object_key,i.internal_object_key,i.source_role,i.extension,i.media_type,g.policy_digest,g.epoch,kd,rd,least(clock_timestamp()+interval '15 minutes',valid_until)) returning * into t;
  perform remhaos_integration._record_file_intake_event(i.organization_id,i.project_id,i.intake_id,i.status,i.status,
    'bound_file_scan_requested','human',c.actor_id,c.actor_user_id,jsonb_build_object('taskId',t.task_id));
  return jsonb_build_object('operation','request_bound_file_scan','replay',false,'result',jsonb_build_object('taskId',t.task_id,'intakeId',t.intake_id));
end $f$;

create function remhaos_integration._locked_bound_file_scan(p_task uuid,p_capability text)
returns remhaos_integration.file_scan_tasks language plpgsql security definer set search_path='' as $f$
declare t remhaos_integration.file_scan_tasks%rowtype; g remhaos_integration.file_scan_gate%rowtype; i remhaos_integration.file_intakes%rowtype;
begin
  if project_intelligence._request_jwt()->>'role' is distinct from 'service_role' or p_task is null or p_capability is null or p_capability !~ '^[a-f0-9]{64}$' then
    perform projectceo_foundation._raise('P1103','forbidden','{}');
  end if;
  select * into t from remhaos_integration.file_scan_tasks where task_id=p_task;
  if not found or t.capability_digest<>project_intelligence._sha256_text(p_capability) then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
  select * into g from remhaos_integration.file_scan_gate where singleton for share;
  if (g.enabled and g.epoch=t.gate_epoch and g.policy_digest=t.policy_digest) is not true then perform projectceo_foundation._raise('P1106','revoked','{}'); end if;
  perform remhaos_integration._lock_file_scan_authority(t.organization_id,t.project_id,t.package_id,t.requested_by);
  select * into i from remhaos_integration.file_intakes where organization_id=t.organization_id and project_id=t.project_id and intake_id=t.intake_id for update;
  if not found or (i.package_id=t.package_id and i.checksum=t.checksum and i.size_bytes=t.byte_length
      and i.quarantine_object_key=t.quarantine_key and i.internal_object_key=t.canonical_key
      and i.source_role=t.source_role and i.extension=t.extension and i.media_type=t.media_type
      and remhaos_integration._is_legacy_file_intake(i.organization_id,i.project_id,i.intake_id)) is not true then
    perform projectceo_foundation._raise('P1109','scope_conflict','{}');
  end if;
  select * into t from remhaos_integration.file_scan_tasks where task_id=p_task for update;
  if t.state='cancelled' then perform projectceo_foundation._raise('P1106','revoked','{}'); end if;
  if t.expires_at<=clock_timestamp() then perform projectceo_foundation._raise('P1105','expired','{}'); end if;
  return t;
end $f$;

create function remhaos_integration_api.claim_bound_file_scan(p_task uuid,p_capability text,p_lease_digest text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare t remhaos_integration.file_scan_tasks%rowtype; c remhaos_integration.file_scan_claims%rowtype;
  p remhaos_integration.file_scan_policies%rowtype; kd bytea; replay boolean:=false; claim_time timestamptz;
begin
  t:=remhaos_integration._locked_bound_file_scan(p_task,p_capability);
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  if p_lease_digest is null or p_lease_digest !~ '^[a-f0-9]{64}$' then perform projectceo_foundation._raise('P1111','validation_failed','{}'); end if;
  select * into p from remhaos_integration.file_scan_policies where digest=t.policy_digest;
  if p.valid_until<=clock_timestamp()+interval '300 seconds' then perform projectceo_foundation._raise('P1105','expired','{}'); end if;
  kd:=project_intelligence._sha256_text(p_idempotency_key);
  select * into c from remhaos_integration.file_scan_claims where task_id=p_task and key_digest=kd;
  if found then
    if c.lease_digest<>decode(p_lease_digest,'hex') then perform projectceo_foundation._raise('P1108','idempotency_conflict','{}'); end if;
    if t.state<>'leased' or t.fence<>c.fence or t.lease_expires_at<=clock_timestamp() then perform projectceo_foundation._raise('P1107','stale_state','{}'); end if;
    replay:=true;
  else
    if t.state='completed' or (t.state='leased' and t.lease_expires_at>clock_timestamp()) or t.attempt>=3 then perform projectceo_foundation._raise('P1109','scope_conflict','{}'); end if;
    if not exists(select 1 from remhaos_integration.file_intakes where organization_id=t.organization_id and project_id=t.project_id and intake_id=t.intake_id and status='scan_pending') then
      perform projectceo_foundation._raise('P1109','scope_conflict','{}');
    end if;
    claim_time:=clock_timestamp();
    update remhaos_integration.file_scan_tasks set state='leased',attempt=attempt+1,fence=fence+1,nonce=extensions.gen_random_uuid(),
      lease_digest=decode(p_lease_digest,'hex'),claim_started_at=claim_time,lease_expires_at=least(claim_time+interval '300 seconds',expires_at,p.valid_until)
      where task_id=p_task returning * into t;
    insert into remhaos_integration.file_scan_claims values(t.task_id,t.attempt,t.fence,t.nonce,t.lease_digest,kd,t.claim_started_at,t.lease_expires_at);
  end if;
  return jsonb_build_object('operation','claim_bound_file_scan','replay',replay,'result',jsonb_build_object(
    'taskId',t.task_id,'intakeId',t.intake_id,'organizationId',t.organization_id,'projectId',t.project_id,'packageId',t.package_id,
    'attempt',t.attempt,'fence',t.fence,'nonce',t.nonce,'claimedAt',t.claim_started_at,'expiresAt',t.lease_expires_at,
    'bucket','client-uploads','objectKey',t.quarantine_key,'canonicalKey',t.canonical_key,
    'checksumHex',encode(t.checksum,'hex'),'byteLength',t.byte_length,
    'sourceRole',t.source_role,'extension',t.extension,'mediaType',t.media_type,'policy',p.policy));
end $f$;

create function remhaos_integration_api.complete_bound_file_scan(
  p_task uuid,p_capability text,p_attempt integer,p_fence bigint,p_lease_secret text,p_evidence jsonb,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare t remhaos_integration.file_scan_tasks%rowtype; p remhaos_integration.file_scan_policies%rowtype;
  e remhaos_integration.file_scan_evidence%rowtype; ed bytea; kd bytea; replay boolean:=false;
  started timestamptz; completed timestamptz; canonical_verified timestamptz; outcome text;
  keys text[]:=array['schemaVersion','taskId','attempt','fence','nonce','sourceSha256','byteLength','storageAfterSha256',
    'policy','scanStartedAt','scanCompletedAt','outcome','exitCode','sandboxEvidenceSha256','canonicalSha256','canonicalByteLength','canonicalVerifiedAt'];
begin
  t:=remhaos_integration._locked_bound_file_scan(p_task,p_capability);
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  if p_attempt is null or p_fence is null or p_lease_secret is null or p_lease_secret !~ '^[a-f0-9]{64}$'
    or p_attempt<>t.attempt or p_fence<>t.fence or t.lease_digest is distinct from project_intelligence._sha256_text(p_lease_secret) then
    perform projectceo_foundation._raise('P1103','forbidden','{}');
  end if;
  if (jsonb_typeof(p_evidence)='object' and octet_length(p_evidence::text)<=16384 and p_evidence?&keys and p_evidence-keys='{}'::jsonb) is not true then
    perform projectceo_foundation._raise('P1111','validation_failed','{}');
  end if;
  ed:=project_intelligence._sha256_jsonb(p_evidence); kd:=project_intelligence._sha256_text(p_idempotency_key);
  select * into e from remhaos_integration.file_scan_evidence where task_id=p_task;
  if found then
    if e.evidence_digest<>ed or e.key_digest<>kd then perform projectceo_foundation._raise('P1108','idempotency_conflict','{}'); end if;
    replay:=true;
  else
    if t.state<>'leased' or t.lease_expires_at<=clock_timestamp() then perform projectceo_foundation._raise('P1105','expired','{}'); end if;
    select * into p from remhaos_integration.file_scan_policies where digest=t.policy_digest;
    begin
      started:=(p_evidence->>'scanStartedAt')::timestamptz; completed:=(p_evidence->>'scanCompletedAt')::timestamptz;
      canonical_verified:=(p_evidence->>'canonicalVerifiedAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      perform projectceo_foundation._raise('P1111','validation_failed','{}');
    end;
    outcome:=p_evidence->>'outcome';
    if (p_evidence->>'schemaVersion'='remhaos.file-scan-evidence/1'
      and p_evidence->>'taskId'=t.task_id::text and p_evidence->'attempt'=to_jsonb(t.attempt) and p_evidence->'fence'=to_jsonb(t.fence)
      and p_evidence->>'nonce'=t.nonce::text and p_evidence->>'sourceSha256'=encode(t.checksum,'hex')
      and p_evidence->'byteLength'=to_jsonb(t.byte_length) and p_evidence->>'storageAfterSha256'=encode(t.checksum,'hex')
      and p_evidence->'policy'=p.policy and p_evidence->>'sandboxEvidenceSha256' ~ '^[a-f0-9]{64}$'
      and started>=t.claim_started_at and completed>=started and completed<=clock_timestamp() and completed<=t.lease_expires_at
      and p.valid_until>clock_timestamp()
      and ((outcome='clean' and p_evidence->'exitCode'='0'::jsonb)
        or (outcome='infected' and p_evidence->'exitCode'='1'::jsonb)
        or (outcome='scan_failed' and p_evidence->'exitCode' in ('null'::jsonb,'1'::jsonb,'2'::jsonb)))
      and ((outcome<>'clean' and p_evidence->'canonicalSha256'='null'::jsonb and p_evidence->'canonicalByteLength'='null'::jsonb and p_evidence->'canonicalVerifiedAt'='null'::jsonb)
        or (outcome='clean' and p_evidence->>'canonicalSha256'=encode(t.checksum,'hex')
        and p_evidence->'canonicalByteLength'=to_jsonb(t.byte_length) and canonical_verified>=completed and canonical_verified<=clock_timestamp()))) is not true then
      perform projectceo_foundation._raise('P1111','validation_failed','{"reason":"SCAN_EVIDENCE_BINDING_REQUIRED"}');
    end if;
    insert into remhaos_integration.file_scan_evidence(task_id,attempt,fence,key_digest,evidence_digest,evidence)
      values(t.task_id,t.attempt,t.fence,kd,ed,p_evidence) returning * into e;
    perform remhaos_integration_api.complete_file_intake_scan(t.project_id,t.intake_id,outcome,'bound-scan:'||t.task_id::text);
    update remhaos_integration.file_scan_tasks set state='completed' where task_id=t.task_id;
    perform remhaos_integration._record_file_intake_event(t.organization_id,t.project_id,t.intake_id,outcome,outcome,
      'bound_file_scan_evidence_recorded','system','system:bound-file-scanner',null,
      jsonb_build_object('taskId',t.task_id,'receiptId',e.receipt_id,'evidenceDigest',encode(ed,'hex')));
  end if;
  return jsonb_build_object('operation','complete_bound_file_scan','replay',replay,'result',jsonb_build_object(
    'taskId',t.task_id,'intakeId',t.intake_id,'receiptId',e.receipt_id,'evidenceDigest',encode(e.evidence_digest,'hex'),'outcome',e.evidence->>'outcome'));
end $f$;

create function remhaos_integration_api.cancel_bound_file_scan(p_task uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare t remhaos_integration.file_scan_tasks%rowtype; c record; replay boolean;
begin
  select * into t from remhaos_integration.file_scan_tasks where task_id=p_task;
  if not found then perform projectceo_foundation._raise('P1104','not_found','{}'); end if;
  select * into c from projectceo_foundation._authorize_project_human(t.project_id,'manage_project_integrations');
  if c.organization_id<>t.organization_id then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
  perform remhaos_integration._lock_file_scan_authority(t.organization_id,t.project_id,t.package_id,c.actor_user_id);
  perform 1 from remhaos_integration.file_intakes where organization_id=t.organization_id and project_id=t.project_id and intake_id=t.intake_id for update;
  select * into t from remhaos_integration.file_scan_tasks where task_id=p_task for update;
  if t.state='completed' then perform projectceo_foundation._raise('P1109','scope_conflict','{}'); end if;
  replay:=t.state='cancelled';
  if not replay then
    update remhaos_integration.file_scan_tasks set state='cancelled' where task_id=p_task;
    perform remhaos_integration._record_file_intake_event(t.organization_id,t.project_id,t.intake_id,'scan_pending','scan_pending',
      'bound_file_scan_cancelled','human',c.actor_id,c.actor_user_id,jsonb_build_object('taskId',t.task_id));
  end if;
  return jsonb_build_object('operation','cancel_bound_file_scan','replay',replay,'result',jsonb_build_object('taskId',p_task));
end $f$;

-- Freeze task origin. Claims/evidence are separately append-only.
create function remhaos_integration._file_scan_task_guard()
returns trigger language plpgsql set search_path='' as $f$
begin
  if tg_op<>'UPDATE' or old.state in ('completed','cancelled') or
    (to_jsonb(new)-array['state','attempt','fence','nonce','lease_digest','claim_started_at','lease_expires_at'])
    is distinct from (to_jsonb(old)-array['state','attempt','fence','nonce','lease_digest','claim_started_at','lease_expires_at']) then
    raise exception 'FILE_SCAN_TASK_ORIGIN_IMMUTABLE';
  end if;
  if new.state='leased' then
    if new.attempt<>old.attempt+1 or new.fence<>old.fence+1 or (old.state='leased' and old.lease_expires_at>clock_timestamp()) then raise exception 'FILE_SCAN_TASK_FENCE_INVALID'; end if;
  elsif new.state in ('completed','cancelled') then
    if (new.attempt,new.fence,new.nonce,new.lease_digest,new.claim_started_at,new.lease_expires_at)
      is distinct from (old.attempt,old.fence,old.nonce,old.lease_digest,old.claim_started_at,old.lease_expires_at)
      or (new.state='completed' and old.state<>'leased') then raise exception 'FILE_SCAN_TASK_TRANSITION_INVALID'; end if;
  else raise exception 'FILE_SCAN_TASK_TRANSITION_INVALID'; end if;
  return new;
end $f$;
create trigger file_scan_task_guard before update or delete on remhaos_integration.file_scan_tasks
  for each row execute function remhaos_integration._file_scan_task_guard();

do $functions$
declare signature text;
begin
  foreach signature in array array[
    'remhaos_integration.configure_disposable_file_scan_policy(jsonb,boolean)',
    'remhaos_integration._lock_file_scan_authority(uuid,uuid,uuid,uuid)',
    'remhaos_integration._locked_bound_file_scan(uuid,text)',
    'remhaos_integration._file_scan_task_guard()',
    'remhaos_integration_api.request_bound_file_scan(uuid,uuid,text,text)',
    'remhaos_integration_api.claim_bound_file_scan(uuid,text,text,text)',
    'remhaos_integration_api.complete_bound_file_scan(uuid,text,integer,bigint,text,jsonb,text)',
    'remhaos_integration_api.cancel_bound_file_scan(uuid)'
  ] loop
    execute 'alter function '||signature||' owner to pi_table_owner';
    execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor';
  end loop;
end $functions$;
-- No permanent EXECUTE grants. Legacy primitive and R1 ACLs are unchanged.
commit;
