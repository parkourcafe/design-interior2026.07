-- R1 upload slice A: private control only. No policy seeds, broker grants,
-- storage side effects, legacy intake insertion, validation or readiness claims.
begin;

create function remhaos_integration._external_upload_format_policy(p_format text)
returns table(max_bytes bigint, validation_profile text)
language plpgsql immutable set search_path='' as $f$
begin
 case p_format
 when 'skp' then max_bytes:=100000000; validation_profile:='skp-original-retention-v1';
 when 'dwg' then max_bytes:=100000000; validation_profile:='dwg-original-retention-v1';
 when 'glb' then max_bytes:=100000000; validation_profile:='glb-viewable-input-v1';
 when 'dae-package' then max_bytes:=100000000; validation_profile:='dae-package-conversion-input-v1';
 when 'pdf' then max_bytes:=52428800; validation_profile:='legacy-pdf-intake-v1';
 when 'jpg','jpeg','png' then max_bytes:=26214400; validation_profile:='legacy-image-intake-v1';
 else perform projectceo_product._raise('P1111','validation_failed','{"reason":"upload_format_invalid"}');
 end case;
 return next;
end $f$;

-- A trusted configuration bridge can insert these facts only after obtaining
-- actual entitlement and runtime evidence. No runtime role can issue a binding.
-- References identify that external authority; their mere shape is not proof.
create table remhaos_integration.external_upload_policy_bindings (
 organization_id uuid not null, project_id uuid not null, policy_binding_id uuid not null,
 authority_reference text not null check (char_length(btrim(authority_reference)) between 1 and 500),
 authority_revision text not null check (char_length(btrim(authority_revision)) between 1 and 160),
 authority_evidence_digest bytea not null check (octet_length(authority_evidence_digest)=32),
 runtime_authority_reference text not null check (char_length(btrim(runtime_authority_reference)) between 1 and 500),
 runtime_evidence_digest bytea not null check (octet_length(runtime_evidence_digest)=32),
 logical_byte_allowance bigint not null check (logical_byte_allowance between 1 and 9007199254740991),
 temporary_physical_byte_cap bigint not null check (temporary_physical_byte_cap between 1 and 9007199254740991),
 representation_budget_bytes bigint not null check (representation_budget_bytes between 0 and 1000000000),
 adapter_id text not null check (char_length(btrim(adapter_id)) between 1 and 128),
 storage_policy_version text not null check (char_length(btrim(storage_policy_version)) between 1 and 160),
 data_plane_cell text not null check (data_plane_cell='ru'),
 pin_mode text not null check (pin_mode in ('provider_version','sealed_copy')),
 sandbox_policy_version text not null check (char_length(btrim(sandbox_policy_version)) between 1 and 160),
 scanner_policy_version text not null check (char_length(btrim(scanner_policy_version)) between 1 and 160),
 signature_policy_version text not null check (char_length(btrim(signature_policy_version)) between 1 and 160),
 accepted_profiles text[] not null check (cardinality(accepted_profiles)>0 and array_position(accepted_profiles,null) is null and accepted_profiles <@ array['skp-original-retention-v1','dwg-original-retention-v1','glb-viewable-input-v1','dae-package-conversion-input-v1','legacy-pdf-intake-v1','legacy-image-intake-v1']::text[]),
 finalize_lease_seconds integer not null check (finalize_lease_seconds between 1 and 1800),
 finalize_recovery_seconds integer not null check (finalize_recovery_seconds between finalize_lease_seconds and 1800),
 valid_from timestamptz not null, valid_until timestamptz not null check (valid_until>valid_from),
 recorded_at timestamptz not null default statement_timestamp(),
 primary key(organization_id,project_id,policy_binding_id),
 foreign key(organization_id,project_id) references project_intelligence.project_workflows(organization_id,project_id)
);
create table remhaos_integration.external_upload_policy_heads (
 organization_id uuid not null, project_id uuid not null, policy_binding_id uuid not null,
 revision bigint not null default 0 check (revision between 0 and 9007199254740991),
 cancellation_revision bigint not null default 0 check (cancellation_revision between 0 and 9007199254740991),
 write_eligible boolean not null, processing_eligible boolean not null, read_eligible boolean not null,
 primary key(organization_id,project_id),
 foreign key(organization_id,project_id,policy_binding_id) references remhaos_integration.external_upload_policy_bindings
);
create table remhaos_integration.external_upload_quota_ledgers (
 organization_id uuid not null, project_id uuid not null,
 logical_used bigint not null default 0 check (logical_used>=0),
 logical_reserved bigint not null default 0 check (logical_reserved>=0),
 physical_used bigint not null default 0 check (physical_used>=0),
 physical_reserved bigint not null default 0 check (physical_reserved>=0),
 physical_orphan bigint not null default 0 check (physical_orphan>=0),
 revision bigint not null default 0 check (revision between 0 and 9007199254740991),
 primary key(organization_id,project_id),
 foreign key(organization_id,project_id) references remhaos_integration.external_upload_policy_heads
);
create table remhaos_integration.external_upload_reservations (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 reservation_id uuid not null, session_id uuid not null, policy_binding_id uuid not null,
 logical_budget bigint not null check (logical_budget between 1 and 9007199254740991),
 physical_budget bigint not null check (physical_budget between 1 and 9007199254740991),
 logical_reserved bigint not null check (logical_reserved between 0 and logical_budget),
 logical_used bigint not null default 0 check (logical_used between 0 and logical_budget),
 physical_reserved bigint not null check (physical_reserved between 0 and physical_budget),
 physical_used bigint not null default 0 check (physical_used between 0 and physical_budget),
 physical_orphan bigint not null default 0 check (physical_orphan between 0 and physical_budget),
 state text not null default 'reserved' check (state in ('reserved','committed','orphaned','reconciled')),
 revision bigint not null default 0 check (revision between 0 and 9007199254740991),
 primary key(organization_id,project_id,package_id,reservation_id),
 unique(organization_id,project_id,package_id,session_id),
 unique(organization_id,project_id,package_id,reservation_id,session_id),
 foreign key(organization_id,project_id) references remhaos_integration.external_upload_quota_ledgers,
 foreign key(organization_id,project_id,package_id) references projectceo_foundation.project_packages(organization_id,project_id,id),
 foreign key(organization_id,project_id,policy_binding_id) references remhaos_integration.external_upload_policy_bindings,
 check (logical_reserved+logical_used<=logical_budget),
 check (physical_reserved+physical_used+physical_orphan<=physical_budget)
);
create table remhaos_integration.external_upload_sessions (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 session_id uuid not null, intake_id uuid not null, reservation_id uuid not null, policy_binding_id uuid not null,
 policy_cancellation_revision bigint not null check (policy_cancellation_revision between 0 and 9007199254740991),
 created_by_user_id uuid not null, actor_id text not null check (actor_id=created_by_user_id::text),
 requested_format text not null check (requested_format in ('skp','dwg','glb','dae-package','pdf','jpg','jpeg','png')),
 source_role text not null default 'document' check (source_role='document'),
 display_filename text check (display_filename=btrim(display_filename) and char_length(display_filename) between 1 and 500 and display_filename !~ '[/\\[:cntrl:]]'),
 declared_byte_length bigint not null check (declared_byte_length>0),
 created_at timestamptz not null default statement_timestamp(), expires_at timestamptz not null,
 state text not null default 'open' check (state in ('open','finalizing','finalized','cancelled','expired','failed')),
 revision bigint not null default 0 check (revision between 0 and 9007199254740991),
 cancellation_revision bigint not null default 0 check (cancellation_revision between 0 and 9007199254740991),
 grant_revocation_state text not null default 'not_requested' check (grant_revocation_state in ('not_requested','pending','acknowledged')),
 primary key(organization_id,project_id,package_id,session_id),
 unique(organization_id,project_id,package_id,intake_id),
 unique(organization_id,project_id,package_id,session_id,intake_id),
 foreign key(organization_id,project_id,package_id,reservation_id,session_id) references remhaos_integration.external_upload_reservations(organization_id,project_id,package_id,reservation_id,session_id),
 foreign key(organization_id,project_id,policy_binding_id) references remhaos_integration.external_upload_policy_bindings,
 foreign key(organization_id,created_by_user_id) references project_intelligence.organization_members(organization_id,user_id),
 check (expires_at>created_at and expires_at<=created_at+interval '30 minutes')
);
alter table remhaos_integration.external_upload_reservations add foreign key(organization_id,project_id,package_id,session_id)
 references remhaos_integration.external_upload_sessions deferrable initially deferred;

create table remhaos_integration.external_upload_finalize_claims (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 claim_id uuid not null, session_id uuid not null, session_revision bigint not null check (session_revision>0),
 part_manifest_digest bytea not null check (octet_length(part_manifest_digest)=32),
 attempt integer not null check (attempt>0), fence bigint not null check (fence between 1 and 9007199254740991),
 principal_binding_reference text not null check (char_length(btrim(principal_binding_reference)) between 1 and 500),
 token_digest bytea not null check (octet_length(token_digest)=32),
 claimed_at timestamptz not null default statement_timestamp(), expires_at timestamptz not null, recovery_deadline timestamptz not null,
 state text not null default 'active' check (state in ('active','consumed','superseded','cancelled','expired')),
 primary key(organization_id,project_id,package_id,claim_id),
 unique(organization_id,project_id,package_id,session_id,claim_id,fence),
 unique(organization_id,project_id,package_id,session_id,fence),
 foreign key(organization_id,project_id,package_id,session_id) references remhaos_integration.external_upload_sessions,
 check (expires_at>claimed_at and recovery_deadline>=expires_at)
);
create unique index external_upload_one_active_finalize on remhaos_integration.external_upload_finalize_claims(organization_id,project_id,package_id,session_id) where state='active';
create table remhaos_integration.external_upload_seal_receipts (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 receipt_id uuid not null, session_id uuid not null, claim_id uuid not null, fence bigint not null,
 policy_binding_id uuid not null, adapter_id text not null, storage_policy_version text not null,
 pin_mode text not null check (pin_mode in ('provider_version','sealed_copy')),
 private_locator text not null check (char_length(btrim(private_locator)) between 1 and 2000),
 immutable_provider_version text, seal_identity uuid, copy_sha256 bytea, copy_byte_length bigint,
 observed_byte_length bigint not null check (observed_byte_length>0),
 object_identity_digest bytea not null check (octet_length(object_identity_digest)=32),
 sealing_evidence_digest bytea not null check (octet_length(sealing_evidence_digest)=32),
 source_claim_digest bytea not null check (octet_length(source_claim_digest)=32),
 closure_evidence_digest bytea not null check (octet_length(closure_evidence_digest)=32),
 observed_at timestamptz not null default statement_timestamp(),
 primary key(organization_id,project_id,package_id,receipt_id),
 unique(organization_id,project_id,package_id,session_id,claim_id,fence),
 unique(organization_id,project_id,package_id,session_id,receipt_id),
 foreign key(organization_id,project_id,package_id,session_id,claim_id,fence) references remhaos_integration.external_upload_finalize_claims(organization_id,project_id,package_id,session_id,claim_id,fence),
 foreign key(organization_id,project_id,policy_binding_id) references remhaos_integration.external_upload_policy_bindings,
 check (((pin_mode='provider_version' and immutable_provider_version is not null and char_length(btrim(immutable_provider_version))>0 and seal_identity is null and copy_sha256 is null and copy_byte_length is null)
 or (pin_mode='sealed_copy' and immutable_provider_version is null and seal_identity is not null and octet_length(copy_sha256)=32 and copy_byte_length=observed_byte_length)) is true)
);
create table remhaos_integration.external_upload_generations (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 generation_id uuid not null, session_id uuid not null, intake_id uuid not null, seal_receipt_id uuid not null,
 observed_byte_length bigint not null check (observed_byte_length>0), requested_format text not null,
 created_by_user_id uuid not null, finalized_at timestamptz not null default statement_timestamp(),
 primary key(organization_id,project_id,package_id,generation_id),
 unique(organization_id,project_id,package_id,session_id),
 unique(organization_id,project_id,package_id,intake_id),
 foreign key(organization_id,project_id,package_id,session_id,intake_id) references remhaos_integration.external_upload_sessions(organization_id,project_id,package_id,session_id,intake_id),
 foreign key(organization_id,project_id,package_id,session_id,seal_receipt_id) references remhaos_integration.external_upload_seal_receipts(organization_id,project_id,package_id,session_id,receipt_id),
 foreign key(organization_id,created_by_user_id) references project_intelligence.organization_members(organization_id,user_id)
);
create table remhaos_integration.external_upload_outbox (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 operation_id uuid not null, session_id uuid not null, generation_id uuid,
 kind text not null check (kind in ('enqueue_validation','revoke_upload','reconcile_upload')),
 target_fence bigint not null check (target_fence between 0 and 9007199254740991),
 state text not null default 'pending' check (state in ('pending','claimed','completed','failed')),
 revision bigint not null default 0 check (revision between 0 and 9007199254740991),
 attempts integer not null default 0 check (attempts between 0 and 3),
 available_at timestamptz not null default statement_timestamp(),
 primary key(organization_id,project_id,package_id,operation_id),
 unique(organization_id,project_id,package_id,session_id,kind,target_fence),
 foreign key(organization_id,project_id,package_id,session_id) references remhaos_integration.external_upload_sessions,
 foreign key(organization_id,project_id,package_id,generation_id) references remhaos_integration.external_upload_generations,
 check ((kind='enqueue_validation' and generation_id is not null) or (kind<>'enqueue_validation' and generation_id is null))
);

create function remhaos_integration._external_upload_operational_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare cap bigint; allowed text[]; r remhaos_integration.external_upload_reservations%rowtype;
begin
 if tg_op='DELETE' then raise exception 'EXTERNAL_UPLOAD_OPERATIONAL_DELETE_DENIED'; end if;
 if tg_table_name='external_upload_sessions' then
  select max_bytes into cap from remhaos_integration._external_upload_format_policy(new.requested_format);
  if new.declared_byte_length>cap then perform projectceo_product._raise('P1111','validation_failed','{"reason":"upload_size_invalid"}'); end if;
  if tg_op='INSERT' then
   select * into strict r from remhaos_integration.external_upload_reservations where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and reservation_id=new.reservation_id;
   if r.session_id<>new.session_id or r.policy_binding_id<>new.policy_binding_id or r.logical_budget<new.declared_byte_length or r.physical_budget<3*r.logical_budget then raise exception 'UPLOAD_SESSION_RESERVATION_MISMATCH'; end if;
   if new.state<>'open' or new.revision<>0 or new.cancellation_revision<>0 or new.grant_revocation_state<>'not_requested' then raise exception 'UPLOAD_SESSION_INITIAL_STATE'; end if;
   return new;
  end if;
  allowed:=array['state','revision','cancellation_revision','grant_revocation_state'];
  if new.state is distinct from old.state and not (
   (old.state='open' and new.state in ('finalizing','cancelled','expired','failed')) or
   (old.state='finalizing' and new.state in ('finalized','cancelled','expired','failed'))
  ) then raise exception 'UPLOAD_SESSION_STATE_TRANSITION'; end if;
  if new.cancellation_revision<old.cancellation_revision or
   (new.state in ('cancelled','expired','failed') and old.state in ('open','finalizing') and
    (new.cancellation_revision<>old.cancellation_revision+1 or new.grant_revocation_state<>'pending')) then raise exception 'UPLOAD_CANCELLATION_FENCE'; end if;
 elsif tg_table_name='external_upload_policy_heads' then
  if tg_op='INSERT' then return new; end if;
  allowed:=array['policy_binding_id','revision','cancellation_revision','write_eligible','processing_eligible','read_eligible'];
  if new.cancellation_revision<old.cancellation_revision then raise exception 'UPLOAD_POLICY_REVISION_REGRESSION'; end if;
 elsif tg_table_name='external_upload_quota_ledgers' then
  if tg_op='INSERT' then
   if new.logical_used<>0 or new.logical_reserved<>0 or new.physical_used<>0 or new.physical_reserved<>0 or new.physical_orphan<>0 or new.revision<>0 then raise exception 'UPLOAD_LEDGER_INITIAL_STATE'; end if;
   return new;
  end if;
  allowed:=array['logical_used','logical_reserved','physical_used','physical_reserved','physical_orphan','revision'];
 elsif tg_table_name='external_upload_finalize_claims' then
  if tg_op='INSERT' then return new; end if;
  if (to_jsonb(new)-'state') is distinct from (to_jsonb(old)-'state') or old.state<>'active' or new.state not in ('consumed','superseded','cancelled','expired') then raise exception 'UPLOAD_CLAIM_IMMUTABLE'; end if;
  return new;
 elsif tg_table_name='external_upload_outbox' then
  if tg_op='INSERT' then
   if new.state<>'pending' or new.revision<>0 or new.attempts<>0 then raise exception 'UPLOAD_OUTBOX_INITIAL_STATE'; end if;
   return new;
  end if;
  allowed:=array['state','revision','attempts','available_at'];
  if new.attempts<old.attempts or new.attempts>old.attempts+1 or old.state in ('completed','failed') then raise exception 'UPLOAD_OUTBOX_TERMINAL'; end if;
 end if;
 if (to_jsonb(new)-allowed) is distinct from (to_jsonb(old)-allowed) then raise exception 'UPLOAD_ORIGIN_IMMUTABLE'; end if;
 if old.revision>=9007199254740991 or new.revision<>old.revision+1 then raise exception 'UPLOAD_REVISION_REQUIRED'; end if;
 return new;
end $f$;

-- Ledger lock serializes all reservations across sibling packages. The policy
-- head is locked first by command context and also here for private insertions.
create function remhaos_integration._external_upload_reservation_accounting()
returns trigger language plpgsql security definer set search_path='' as $f$
declare h remhaos_integration.external_upload_policy_heads%rowtype;
 b remhaos_integration.external_upload_policy_bindings%rowtype;
 l remhaos_integration.external_upload_quota_ledgers%rowtype;
 old_lr bigint:=0; old_lu bigint:=0; old_pr bigint:=0; old_pu bigint:=0; old_po bigint:=0;
begin
 if tg_op='DELETE' then raise exception 'UPLOAD_RESERVATION_DELETE_DENIED'; end if;
 -- Direct trusted-row callers must not wait in the inverse of command lock
 -- order. NOWAIT aborts such a contender instead of deadlocking a ledger-first
 -- command; all private commands acquire workflow/policy/ledger before writes.
 perform 1 from project_intelligence.project_workflows where organization_id=new.organization_id and project_id=new.project_id for update nowait;
 select * into strict h from remhaos_integration.external_upload_policy_heads where organization_id=new.organization_id and project_id=new.project_id for update nowait;
 select * into strict b from remhaos_integration.external_upload_policy_bindings where organization_id=h.organization_id and project_id=h.project_id and policy_binding_id=h.policy_binding_id;
 select * into strict l from remhaos_integration.external_upload_quota_ledgers where organization_id=new.organization_id and project_id=new.project_id for update nowait;
 if tg_op='INSERT' then
  if new.policy_binding_id<>h.policy_binding_id or not h.write_eligible or not h.processing_eligible or clock_timestamp()<b.valid_from or clock_timestamp()>=b.valid_until
   or new.logical_reserved<>new.logical_budget or new.physical_reserved<>new.physical_budget or new.logical_used<>0 or new.physical_used<>0 or new.physical_orphan<>0 or new.state<>'reserved' or new.revision<>0 then raise exception 'UPLOAD_RESERVATION_INITIAL_STATE'; end if;
 else
  if (to_jsonb(new)-array['logical_reserved','logical_used','physical_reserved','physical_used','physical_orphan','state','revision']) is distinct from (to_jsonb(old)-array['logical_reserved','logical_used','physical_reserved','physical_used','physical_orphan','state','revision'])
   or old.revision>=9007199254740991 or new.revision<>old.revision+1 then raise exception 'UPLOAD_RESERVATION_IMMUTABLE'; end if;
  if not ((old.state='reserved' and new.state in ('committed','orphaned')) or (old.state='committed' and new.state='orphaned')) then raise exception 'UPLOAD_RESERVATION_STATE_TRANSITION'; end if;
  -- Physical bytes cannot disappear in this slice. A later trusted cleanup
  -- receipt transaction must explicitly extend this boundary before releasing.
  if new.physical_reserved+new.physical_used+new.physical_orphan<>old.physical_reserved+old.physical_used+old.physical_orphan then raise exception 'UPLOAD_PHYSICAL_LIABILITY_UNACKNOWLEDGED'; end if;
  if new.state='orphaned' and (new.logical_reserved<>0 or new.logical_used<>0 or new.physical_reserved<>0 or new.physical_used<>0 or new.physical_orphan<>old.physical_reserved+old.physical_used+old.physical_orphan) then raise exception 'UPLOAD_ORPHAN_LIABILITY'; end if;
  if new.state='committed' and (new.logical_reserved<>old.logical_reserved or new.logical_used<>old.logical_used) then raise exception 'UPLOAD_PROCESSING_RESERVATION_REQUIRED'; end if;
  old_lr:=old.logical_reserved; old_lu:=old.logical_used; old_pr:=old.physical_reserved; old_pu:=old.physical_used; old_po:=old.physical_orphan;
 end if;
 if (new.logical_reserved+new.logical_used>old_lr+old_lu and (l.logical_reserved::numeric+l.logical_used+new.logical_reserved+new.logical_used-old_lr-old_lu)>b.logical_byte_allowance) or
 (new.physical_reserved+new.physical_used+new.physical_orphan>old_pr+old_pu+old_po and (l.physical_reserved::numeric+l.physical_used+l.physical_orphan+new.physical_reserved+new.physical_used+new.physical_orphan-old_pr-old_pu-old_po)>b.temporary_physical_byte_cap) then
  perform projectceo_product._raise('P1111','validation_failed','{"reason":"upload_quota_exceeded"}');
 end if;
 update remhaos_integration.external_upload_quota_ledgers set
 logical_reserved=logical_reserved+new.logical_reserved-old_lr, logical_used=logical_used+new.logical_used-old_lu,
 physical_reserved=physical_reserved+new.physical_reserved-old_pr, physical_used=physical_used+new.physical_used-old_pu,
 physical_orphan=physical_orphan+new.physical_orphan-old_po, revision=revision+1
 where organization_id=new.organization_id and project_id=new.project_id;
 return new;
end $f$;
create trigger external_upload_reservation_accounting before insert or update or delete on remhaos_integration.external_upload_reservations for each row execute function remhaos_integration._external_upload_reservation_accounting();

create function remhaos_integration._external_upload_ledger_consistency()
returns trigger language plpgsql security definer set search_path='' as $f$
declare l remhaos_integration.external_upload_quota_ledgers%rowtype; totals record;
begin
 select * into strict l from remhaos_integration.external_upload_quota_ledgers where organization_id=new.organization_id and project_id=new.project_id;
 select coalesce(sum(logical_used),0) lu,coalesce(sum(logical_reserved),0) lr,coalesce(sum(physical_used),0) pu,coalesce(sum(physical_reserved),0) pr,coalesce(sum(physical_orphan),0) po
 into totals from remhaos_integration.external_upload_reservations where organization_id=new.organization_id and project_id=new.project_id;
 if (l.logical_used,l.logical_reserved,l.physical_used,l.physical_reserved,l.physical_orphan) is distinct from (totals.lu,totals.lr,totals.pu,totals.pr,totals.po) then raise exception 'UPLOAD_LEDGER_RESERVATION_MISMATCH'; end if;
 return null;
end $f$;
create constraint trigger external_upload_ledger_consistency after insert or update on remhaos_integration.external_upload_quota_ledgers deferrable initially deferred for each row execute function remhaos_integration._external_upload_ledger_consistency();

create function remhaos_integration._external_upload_fact_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare s remhaos_integration.external_upload_sessions%rowtype; b remhaos_integration.external_upload_policy_bindings%rowtype;
 c remhaos_integration.external_upload_finalize_claims%rowtype; r remhaos_integration.external_upload_seal_receipts%rowtype;
begin
 perform 1 from project_intelligence.project_workflows where organization_id=new.organization_id and project_id=new.project_id for update;
 perform 1 from remhaos_integration.external_upload_policy_heads where organization_id=new.organization_id and project_id=new.project_id for update;
 perform 1 from remhaos_integration.external_upload_quota_ledgers where organization_id=new.organization_id and project_id=new.project_id for update;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and session_id=new.session_id for update;
 select * into strict b from remhaos_integration.external_upload_policy_bindings where organization_id=s.organization_id and project_id=s.project_id and policy_binding_id=s.policy_binding_id;
 if tg_table_name in ('external_upload_finalize_claims','external_upload_seal_receipts','external_upload_generations') then
  if not exists(select 1 from remhaos_integration.external_upload_policy_heads h where h.organization_id=s.organization_id and h.project_id=s.project_id and h.policy_binding_id=s.policy_binding_id and h.cancellation_revision=s.policy_cancellation_revision and h.write_eligible and h.processing_eligible) or clock_timestamp()<b.valid_from or clock_timestamp()>=b.valid_until then raise exception 'UPLOAD_FINALIZE_AUTHORITY_UNAVAILABLE'; end if;
 end if;
 if tg_table_name='external_upload_finalize_claims' then
  if new.fence<>(select coalesce(max(fence),0)+1 from remhaos_integration.external_upload_finalize_claims where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and session_id=s.session_id) or new.attempt<>(select coalesce(max(attempt),0)+1 from remhaos_integration.external_upload_finalize_claims where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and session_id=s.session_id) or exists(select 1 from remhaos_integration.external_upload_finalize_claims where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and session_id=s.session_id and part_manifest_digest<>new.part_manifest_digest) then raise exception 'UPLOAD_FINALIZE_FENCE_OR_MANIFEST'; end if;
  if s.state<>'finalizing' or s.revision<>new.session_revision or s.cancellation_revision<>0 or new.state<>'active'
   or new.expires_at>new.claimed_at+make_interval(secs=>b.finalize_lease_seconds) or new.recovery_deadline>new.claimed_at+make_interval(secs=>b.finalize_recovery_seconds) or new.recovery_deadline>s.expires_at
   or new.claimed_at>clock_timestamp() or new.expires_at<=clock_timestamp() then raise exception 'UPLOAD_FINALIZE_CLAIM_INVALID'; end if;
 elsif tg_table_name='external_upload_seal_receipts' then
  select * into strict c from remhaos_integration.external_upload_finalize_claims where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and claim_id=new.claim_id for update;
  if c.session_id<>s.session_id or c.fence<>new.fence or c.state<>'active' or c.expires_at<=clock_timestamp() or s.state<>'finalizing' or s.revision<>c.session_revision or s.cancellation_revision<>0
   or new.policy_binding_id<>s.policy_binding_id or new.adapter_id<>b.adapter_id or new.storage_policy_version<>b.storage_policy_version or new.pin_mode<>b.pin_mode
   or new.observed_byte_length<>s.declared_byte_length or new.observed_at<c.claimed_at or new.observed_at>clock_timestamp() then raise exception 'UPLOAD_SEAL_CORRELATION_INVALID'; end if;
 elsif tg_table_name='external_upload_generations' then
  select * into strict r from remhaos_integration.external_upload_seal_receipts where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and receipt_id=new.seal_receipt_id;
  select * into strict c from remhaos_integration.external_upload_finalize_claims where organization_id=r.organization_id and project_id=r.project_id and package_id=r.package_id and claim_id=r.claim_id for update;
  if s.state<>'finalizing' or s.cancellation_revision<>0 or s.revision<>c.session_revision or c.state<>'active' or c.expires_at<=clock_timestamp() or clock_timestamp()>=s.expires_at
   or r.session_id<>s.session_id or c.fence<>r.fence or new.intake_id<>s.intake_id or new.observed_byte_length<>r.observed_byte_length or new.requested_format<>s.requested_format or new.created_by_user_id<>s.created_by_user_id then raise exception 'UPLOAD_GENERATION_CORRELATION_INVALID'; end if;
 elsif tg_table_name='external_upload_outbox' and new.generation_id is not null then
  if not exists(select 1 from remhaos_integration.external_upload_generations g where g.organization_id=new.organization_id and g.project_id=new.project_id and g.package_id=new.package_id and g.generation_id=new.generation_id and g.session_id=new.session_id and exists(select 1 from remhaos_integration.external_upload_seal_receipts z where z.organization_id=g.organization_id and z.project_id=g.project_id and z.package_id=g.package_id and z.receipt_id=g.seal_receipt_id and z.fence=new.target_fence)) then raise exception 'UPLOAD_OUTBOX_GENERATION_SCOPE'; end if;
 end if;
 return new;
end $f$;

create function remhaos_integration._external_upload_human_context(
 p_project_id uuid,p_package_id uuid,p_operation text,p_key text,p_payload jsonb
) returns table(organization_id uuid,actor_user_id uuid,policy_binding_id uuid,policy_cancellation_revision bigint,key_digest bytea,request_digest bytea,replay jsonb)
language plpgsql security definer set search_path='' as $f$
#variable_conflict use_variable
declare h remhaos_integration.external_upload_policy_heads%rowtype; b remhaos_integration.external_upload_policy_bindings%rowtype;
begin
 if p_operation not in ('begin_external_upload','cancel_external_upload','claim_external_upload_finalize','finalize_external_upload') or p_operation is null or p_key is null or char_length(btrim(p_key)) not between 1 and 512 or p_key<>btrim(p_key) then perform projectceo_product._raise('P1111','validation_failed','{"reason":"upload_command_invalid"}'); end if;
 select distinct a.organization_id,a.actor_user_id into strict organization_id,actor_user_id from projectceo_foundation._authorize_package_human(p_project_id,p_package_id,'register_source') a;
 -- Existing workflow lock serializes command keys before any reservation effect.
 perform 1 from project_intelligence.project_workflows w where w.organization_id=organization_id and w.project_id=p_project_id for update;
 perform 1 from project_intelligence.organizations x where x.id=organization_id for share;
 perform 1 from projectceo_foundation.project_packages x where x.organization_id=organization_id and x.project_id=p_project_id and x.id=p_package_id for share;
 perform 1 from project_intelligence.organization_members x where x.organization_id=organization_id and x.user_id=actor_user_id for share;
 perform 1 from projectceo_foundation.project_memberships x where x.organization_id=organization_id and x.project_id=p_project_id and x.user_id=actor_user_id for share;
 perform 1 from projectceo_foundation.project_member_capabilities x where x.organization_id=organization_id and x.project_id=p_project_id and x.user_id=actor_user_id and x.capability='register_source' for share;
 perform 1 from projectceo_foundation.package_memberships x where x.organization_id=organization_id and x.project_id=p_project_id and x.package_id=p_package_id and x.user_id=actor_user_id for share;
 perform 1 from projectceo_foundation.package_member_capabilities x where x.organization_id=organization_id and x.project_id=p_project_id and x.package_id=p_package_id and x.user_id=actor_user_id and x.capability='register_source' for share;
 perform 1 from projectceo_foundation._authorize_package_human(p_project_id,p_package_id,'register_source');
 select * into h from remhaos_integration.external_upload_policy_heads x where x.organization_id=organization_id and x.project_id=p_project_id for update;
 if not found then perform projectceo_product._raise('P1111','validation_failed','{"reason":"upload_authority_unavailable"}'); end if;
 select * into strict b from remhaos_integration.external_upload_policy_bindings x where x.organization_id=organization_id and x.project_id=p_project_id and x.policy_binding_id=h.policy_binding_id;
 if not h.write_eligible or not h.processing_eligible or clock_timestamp()<b.valid_from or clock_timestamp()>=b.valid_until or not exists(select 1 from remhaos_integration.external_upload_quota_ledgers x where x.organization_id=organization_id and x.project_id=p_project_id) then perform projectceo_product._raise('P1111','validation_failed','{"reason":"upload_authority_unavailable"}'); end if;
 policy_binding_id:=h.policy_binding_id;
 policy_cancellation_revision:=h.cancellation_revision;
 key_digest:=project_intelligence._sha256_text(p_key);
 request_digest:=project_intelligence._sha256_jsonb(jsonb_build_object('operation',p_operation,'organizationId',organization_id,'projectId',p_project_id,'packageId',p_package_id,'actorUserId',actor_user_id,'payload',p_payload));
 if exists(select 1 from remhaos_integration.command_records x where x.organization_id=organization_id and x.project_id=p_project_id and x.operation=p_operation and x.key_digest=key_digest and x.actor_user_id is distinct from actor_user_id) then perform projectceo_product._raise('P1108','idempotency_conflict','{}'); end if;
 replay:=remhaos_integration._replay_or_null(organization_id,p_project_id,p_operation,key_digest,request_digest);
 return next;
end $f$;

create function remhaos_integration._begin_external_upload(
 p_project_id uuid,p_package_id uuid,p_format text,p_declared_byte_length bigint,p_display_filename text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare c record; f record; b remhaos_integration.external_upload_policy_bindings%rowtype;
 s uuid:=extensions.gen_random_uuid(); i uuid:=extensions.gen_random_uuid(); r uuid:=extensions.gen_random_uuid();
 logical_budget bigint; physical_budget bigint; expires timestamptz:=statement_timestamp()+interval '30 minutes'; result jsonb;
begin
 select * into f from remhaos_integration._external_upload_format_policy(p_format);
 if p_declared_byte_length is null or p_declared_byte_length not between 1 and f.max_bytes or (p_display_filename is not null and (p_display_filename<>btrim(p_display_filename) or char_length(p_display_filename) not between 1 and 500 or p_display_filename ~ '[/\\[:cntrl:]]')) then perform projectceo_product._raise('P1111','validation_failed','{"reason":"upload_command_invalid"}'); end if;
 select * into c from remhaos_integration._external_upload_human_context(p_project_id,p_package_id,'begin_external_upload',p_idempotency_key,jsonb_build_object('format',p_format,'declaredByteLength',p_declared_byte_length,'displayFilename',p_display_filename));
 if c.replay is not null then return c.replay; end if;
 select * into strict b from remhaos_integration.external_upload_policy_bindings where organization_id=c.organization_id and project_id=p_project_id and policy_binding_id=c.policy_binding_id;
 if not f.validation_profile=any(b.accepted_profiles) then perform projectceo_product._raise('P1111','validation_failed','{"reason":"upload_profile_unavailable"}'); end if;
 logical_budget:=p_declared_byte_length+b.representation_budget_bytes;
 -- Upload staging, immutable seal and canonical persistence may overlap.
 physical_budget:=logical_budget*3;
 insert into remhaos_integration.external_upload_reservations(organization_id,project_id,package_id,reservation_id,session_id,policy_binding_id,logical_budget,physical_budget,logical_reserved,physical_reserved)
 values(c.organization_id,p_project_id,p_package_id,r,s,c.policy_binding_id,logical_budget,physical_budget,logical_budget,physical_budget);
 insert into remhaos_integration.external_upload_sessions(organization_id,project_id,package_id,session_id,intake_id,reservation_id,policy_binding_id,policy_cancellation_revision,created_by_user_id,actor_id,requested_format,display_filename,declared_byte_length,expires_at)
 values(c.organization_id,p_project_id,p_package_id,s,i,r,c.policy_binding_id,c.policy_cancellation_revision,c.actor_user_id,c.actor_user_id::text,p_format,p_display_filename,p_declared_byte_length,expires);
 result:=jsonb_build_object('sessionId',s,'intakeId',i,'packageId',p_package_id,'format',p_format,'status','open','revision',0,'expiresAt',expires);
 return remhaos_integration._complete_command(c.organization_id,p_project_id,'begin_external_upload',c.key_digest,c.request_digest,'human',c.actor_user_id::text,c.actor_user_id,result,'begin_external_upload','ok','{}');
end $f$;

create function remhaos_integration._cancel_external_upload(
 p_project_id uuid,p_package_id uuid,p_session_id uuid,p_expected_revision bigint,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare c record; s remhaos_integration.external_upload_sessions%rowtype; result jsonb;
begin
 select * into c from remhaos_integration._external_upload_human_context(p_project_id,p_package_id,'cancel_external_upload',p_idempotency_key,jsonb_build_object('sessionId',p_session_id,'expectedRevision',p_expected_revision));
 select * into s from remhaos_integration.external_upload_sessions where organization_id=c.organization_id and project_id=p_project_id and package_id=p_package_id and session_id=p_session_id;
 if not found or s.created_by_user_id<>c.actor_user_id then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 if c.replay is not null then return c.replay; end if;
 -- Policy/workflow -> ledger -> session -> reservation is the command order.
 perform 1 from remhaos_integration.external_upload_quota_ledgers where organization_id=c.organization_id and project_id=p_project_id for update;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=c.organization_id and project_id=p_project_id and package_id=p_package_id and session_id=p_session_id for update;
 if p_expected_revision is null or s.revision<>p_expected_revision or s.state not in ('open','finalizing') or s.revision>=9007199254740991 then perform projectceo_product._raise('P1107','stale_state','{}'); end if;
 update remhaos_integration.external_upload_sessions set state='cancelled',revision=revision+1,cancellation_revision=cancellation_revision+1,grant_revocation_state='pending'
 where organization_id=c.organization_id and project_id=p_project_id and package_id=p_package_id and session_id=p_session_id;
 update remhaos_integration.external_upload_finalize_claims set state='cancelled' where organization_id=c.organization_id and project_id=p_project_id and package_id=p_package_id and session_id=p_session_id and state='active';
 update remhaos_integration.external_upload_reservations set state='orphaned',revision=revision+1,logical_reserved=0,logical_used=0,physical_orphan=physical_reserved+physical_used+physical_orphan,physical_reserved=0,physical_used=0
 where organization_id=c.organization_id and project_id=p_project_id and package_id=p_package_id and reservation_id=s.reservation_id;
 insert into remhaos_integration.external_upload_outbox(organization_id,project_id,package_id,operation_id,session_id,kind,target_fence)
 select c.organization_id,p_project_id,p_package_id,extensions.gen_random_uuid(),p_session_id,k,s.cancellation_revision+1 from unnest(array['revoke_upload','reconcile_upload']) k;
 result:=jsonb_build_object('sessionId',s.session_id,'intakeId',s.intake_id,'packageId',p_package_id,'format',s.requested_format,'status','cancelled','revision',s.revision+1);
 return remhaos_integration._complete_command(c.organization_id,p_project_id,'cancel_external_upload',c.key_digest,c.request_digest,'human',c.actor_user_id::text,c.actor_user_id,result,'cancel_external_upload','ok','{}');
end $f$;

-- Finalize fact storage is deliberately not a public or broker entrypoint. A
-- later authenticated broker provides a measured seal and consumes these facts
-- atomically with a validation job; no fake worker/configuration is installed.

-- End-of-transaction closure prevents committed orphan generations or terminal
-- sessions with invisible physical liabilities. Validation jobs are slice B;
-- slice A records only a durable, exact-generation enqueue operation.
create function remhaos_integration._external_upload_terminal_consistency()
returns trigger language plpgsql security definer set search_path='' as $f$
declare s remhaos_integration.external_upload_sessions%rowtype; r remhaos_integration.external_upload_reservations%rowtype; g remhaos_integration.external_upload_generations%rowtype;
begin
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and session_id=new.session_id;
 select * into strict r from remhaos_integration.external_upload_reservations where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and reservation_id=s.reservation_id;
 select * into g from remhaos_integration.external_upload_generations where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and session_id=s.session_id;
 if s.state='finalized' then
  if g.generation_id is null or r.state<>'committed' or not exists(select 1 from remhaos_integration.external_upload_outbox x where x.organization_id=s.organization_id and x.project_id=s.project_id and x.package_id=s.package_id and x.session_id=s.session_id and x.generation_id=g.generation_id and x.kind='enqueue_validation') or not exists(
   select 1 from remhaos_integration.external_upload_seal_receipts z join remhaos_integration.external_upload_finalize_claims c using(organization_id,project_id,package_id,session_id,claim_id,fence)
   where z.organization_id=s.organization_id and z.project_id=s.project_id and z.package_id=s.package_id and z.receipt_id=g.seal_receipt_id and c.state='consumed') then raise exception 'UPLOAD_FINALIZE_CLOSURE_MISSING'; end if;
 elsif g.generation_id is not null then raise exception 'UPLOAD_GENERATION_NOT_FINALIZED';
 elsif s.state in ('cancelled','expired','failed') then
  if r.state<>'orphaned' or (select count(*) from remhaos_integration.external_upload_outbox x where x.organization_id=s.organization_id and x.project_id=s.project_id and x.package_id=s.package_id and x.session_id=s.session_id and x.target_fence=s.cancellation_revision and x.kind in ('revoke_upload','reconcile_upload'))<>2 then raise exception 'UPLOAD_TERMINAL_LIABILITY_MISSING'; end if;
 end if;
 return null;
end $f$;
create constraint trigger external_upload_session_closure after insert or update on remhaos_integration.external_upload_sessions deferrable initially deferred for each row execute function remhaos_integration._external_upload_terminal_consistency();
create constraint trigger external_upload_generation_closure after insert on remhaos_integration.external_upload_generations deferrable initially deferred for each row execute function remhaos_integration._external_upload_terminal_consistency();

do $registry$
declare operations text[];
begin
 select array_agg(m[1]) into operations from pg_constraint c,
 lateral regexp_matches(pg_get_constraintdef(c.oid),$re$'([a-z0-9_]+)'$re$,'g') m
 where c.conrelid='remhaos_integration.command_records'::regclass and c.conname='command_records_operation_check';
 if operations is null then raise exception 'UPLOAD_COMMAND_REGISTRY_MISSING'; end if;
 alter table remhaos_integration.command_records drop constraint command_records_operation_check;
 execute format('alter table remhaos_integration.command_records add constraint command_records_operation_check check (operation=any(%L::text[]))',operations||array['begin_external_upload','cancel_external_upload','claim_external_upload_finalize','finalize_external_upload']);
end $registry$;

do $security$
declare t text; f regprocedure;
begin
 foreach t in array array['external_upload_policy_bindings','external_upload_policy_heads','external_upload_quota_ledgers','external_upload_reservations','external_upload_sessions','external_upload_finalize_claims','external_upload_seal_receipts','external_upload_generations','external_upload_outbox'] loop
  if t in ('external_upload_policy_bindings','external_upload_seal_receipts','external_upload_generations') then
   execute format('create trigger %I before update or delete on remhaos_integration.%I for each row execute function projectceo_foundation.reject_append_only_mutation()',t||'_append_only',t);
  elsif t<>'external_upload_reservations' then
   execute format('create trigger %I before insert or update or delete on remhaos_integration.%I for each row execute function remhaos_integration._external_upload_operational_guard()',t||'_operational',t);
  end if;
  if t in ('external_upload_finalize_claims','external_upload_seal_receipts','external_upload_generations','external_upload_outbox') then
   execute format('create trigger %I before insert on remhaos_integration.%I for each row execute function remhaos_integration._external_upload_fact_guard()',t||'_facts',t);
  end if;
  execute format('alter table remhaos_integration.%I owner to pi_table_owner',t);
  execute format('alter table remhaos_integration.%I enable row level security',t);
  execute format('alter table remhaos_integration.%I force row level security',t);
  execute format('revoke all on remhaos_integration.%I from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',t);
  execute format('create policy %I on remhaos_integration.%I for all to pi_table_owner using(true) with check(true)',t||'_owner_only',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='remhaos_integration' and p.proname in ('_external_upload_format_policy','_external_upload_operational_guard','_external_upload_reservation_accounting','_external_upload_ledger_consistency','_external_upload_fact_guard','_external_upload_human_context','_external_upload_terminal_consistency','_begin_external_upload','_cancel_external_upload') loop
  execute format('alter function %s owner to pi_table_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',f);
 end loop;
end $security$;
commit;
