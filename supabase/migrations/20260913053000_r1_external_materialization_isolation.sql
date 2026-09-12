-- R1 atomic materialization. New entrypoints remain private; legacy behavior is
-- retained only for legacy rows. No human acceptance or native graph is created.
begin;

alter table remhaos_integration.file_intakes add column r1_generation_id uuid;
alter table remhaos_integration.file_intakes add unique(organization_id,project_id,package_id,intake_id);
alter table remhaos_integration.file_intakes add foreign key(organization_id,project_id,package_id,r1_generation_id) references remhaos_integration.external_upload_generations;
alter table remhaos_integration.file_intakes drop constraint file_intakes_extension_check;
alter table remhaos_integration.file_intakes add constraint file_intakes_extension_check check(extension=lower(btrim(extension)) and extension in ('pdf','jpg','jpeg','png','csv','xlsx','skp','dwg','glb','zip'));
alter table remhaos_integration.file_intakes add check(extension not in ('skp','dwg','glb','zip') or r1_generation_id is not null);
drop index remhaos_integration.file_intakes_active_checksum_key;
create unique index file_intakes_active_checksum_key on remhaos_integration.file_intakes(organization_id,project_id,checksum) where status<>'rejected' and r1_generation_id is null;

alter table remhaos_integration.external_validation_completions add unique(organization_id,project_id,package_id,job_id,generation_id,validation_receipt_id,canonical_receipt_id);
alter table projectceo_foundation.external_asset_versions add unique(organization_id,project_id,package_id,asset_id,asset_version_id);
create table remhaos_integration.external_generation_intake_links (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 generation_id uuid not null, intake_id uuid not null, job_id uuid not null,
 validation_receipt_id uuid not null, canonical_receipt_id uuid not null,
 display_name_origin text not null check(display_name_origin in ('supplied','generated')),
 materialized_by_principal_id uuid not null references remhaos_integration.external_validation_principals,
 materialized_at timestamptz not null default statement_timestamp(),
 primary key(organization_id,project_id,package_id,generation_id),
 unique(organization_id,project_id,package_id,intake_id),
 unique(organization_id,project_id,package_id,generation_id,intake_id,job_id,validation_receipt_id,canonical_receipt_id),
 foreign key(organization_id,project_id,package_id,intake_id) references remhaos_integration.file_intakes(organization_id,project_id,package_id,intake_id),
 foreign key(organization_id,project_id,package_id,generation_id) references remhaos_integration.external_upload_generations,
 foreign key(organization_id,project_id,package_id,job_id,generation_id,validation_receipt_id,canonical_receipt_id) references remhaos_integration.external_validation_completions(organization_id,project_id,package_id,job_id,generation_id,validation_receipt_id,canonical_receipt_id)
);
create table remhaos_integration.external_asset_validation_lineage (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 asset_id uuid not null, asset_version_id uuid not null, generation_id uuid not null,
 intake_id uuid not null, job_id uuid not null, validation_receipt_id uuid not null, canonical_receipt_id uuid not null,
 primary key(organization_id,project_id,package_id,asset_version_id),
 unique(organization_id,project_id,package_id,generation_id),
 foreign key(organization_id,project_id,package_id,asset_id,asset_version_id) references projectceo_foundation.external_asset_versions(organization_id,project_id,package_id,asset_id,asset_version_id),
 foreign key(organization_id,project_id,package_id,generation_id,intake_id,job_id,validation_receipt_id,canonical_receipt_id) references remhaos_integration.external_generation_intake_links(organization_id,project_id,package_id,generation_id,intake_id,job_id,validation_receipt_id,canonical_receipt_id)
);

create function remhaos_integration._external_materialization_format(p_format text)
returns table(extension text,media_type text,source_kind text)
language plpgsql immutable set search_path='' as $f$
begin
 case p_format
 when 'skp' then extension:='skp'; media_type:='application/octet-stream'; source_kind:='skp';
 when 'dwg' then extension:='dwg'; media_type:='application/octet-stream'; source_kind:='dwg';
 when 'glb' then extension:='glb'; media_type:='model/gltf-binary'; source_kind:='glb';
 when 'dae-package' then extension:='zip'; media_type:='application/zip'; source_kind:='dae';
 when 'pdf' then extension:='pdf'; media_type:='application/pdf'; source_kind:='pdf';
 when 'jpg','jpeg' then extension:=p_format; media_type:='image/jpeg'; source_kind:='image';
 when 'png' then extension:='png'; media_type:='image/png'; source_kind:='image';
 else perform projectceo_product._raise('P1111','validation_failed','{}');
 end case;
 return next;
end $f$;

-- An R1 discriminator is immutable from insertion. The reserved identity also
-- prevents a malformed NULL discriminator from masquerading as a legacy row.
create function remhaos_integration._external_intake_identity_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare g remhaos_integration.external_upload_generations%rowtype; s remhaos_integration.external_upload_sessions%rowtype; fmt record;
begin
 if tg_op='DELETE' then
  if old.r1_generation_id is not null then raise exception 'R1_INTAKE_DELETE_DENIED'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and new.r1_generation_id is distinct from old.r1_generation_id then raise exception 'R1_INTAKE_DISCRIMINATOR_IMMUTABLE'; end if;
 if new.r1_generation_id is null then
  if exists(select 1 from remhaos_integration.external_upload_sessions x where x.organization_id=new.organization_id and x.project_id=new.project_id and x.intake_id=new.intake_id) then raise exception 'R1_RESERVED_ID_IS_NOT_LEGACY'; end if;
  return new;
 end if;
 if tg_op='UPDATE' and (to_jsonb(new)-array['status','review_decision','reviewed_at','reviewed_by_user_id','source_id','published_at','published_by_user_id']) is distinct from (to_jsonb(old)-array['status','review_decision','reviewed_at','reviewed_by_user_id','source_id','published_at','published_by_user_id']) then raise exception 'R1_INTAKE_MEASURED_IDENTITY_IMMUTABLE'; end if;
 select * into strict g from remhaos_integration.external_upload_generations where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and generation_id=new.r1_generation_id;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=g.organization_id and project_id=g.project_id and package_id=g.package_id and session_id=g.session_id;
 select * into fmt from remhaos_integration._external_materialization_format(g.requested_format);
 if new.intake_id<>g.intake_id or new.created_by_user_id is distinct from g.created_by_user_id or new.source_role<>'document' or new.extension<>fmt.extension or new.media_type<>fmt.media_type or new.original_filename is distinct from coalesce(s.display_filename,'external-'||g.intake_id::text||'.'||fmt.extension) then raise exception 'R1_INTAKE_GENERATION_IDENTITY_MISMATCH'; end if;
 if tg_op='INSERT' and (new.status<>'clean' or new.scan_outcome is distinct from 'clean' or new.review_decision is not null or new.reviewed_by_user_id is not null or new.reviewed_at is not null or new.source_id is not null or new.published_by_user_id is not null or new.published_at is not null) then raise exception 'R1_MATERIALIZATION_NOT_HUMAN_APPROVAL'; end if;
 return new;
end $f$;
create trigger r1_intake_identity before insert or update or delete on remhaos_integration.file_intakes for each row execute function remhaos_integration._external_intake_identity_guard();

create function remhaos_integration._is_legacy_file_intake(p_org uuid,p_project uuid,p_intake uuid)
returns boolean language sql stable security definer set search_path='' as $f$
 select exists(select 1 from remhaos_integration.file_intakes i where i.organization_id=p_org and i.project_id=p_project and i.intake_id=p_intake and i.r1_generation_id is null and not exists(select 1 from remhaos_integration.external_upload_sessions s where s.organization_id=i.organization_id and s.project_id=i.project_id and s.intake_id=i.intake_id))
$f$;

create function remhaos_integration._assert_external_materialization(p_org uuid,p_project uuid,p_package uuid,p_generation uuid)
returns void language plpgsql security definer set search_path='' as $f$
declare g remhaos_integration.external_upload_generations%rowtype; s remhaos_integration.external_upload_sessions%rowtype; link remhaos_integration.external_generation_intake_links%rowtype;
 lineage remhaos_integration.external_asset_validation_lineage%rowtype; i remhaos_integration.file_intakes%rowtype; v remhaos_integration.external_validation_receipts%rowtype;
 canonical remhaos_integration.external_canonical_object_receipts%rowtype; sealed remhaos_integration.external_upload_seal_receipts%rowtype;
 asset projectceo_foundation.external_assets%rowtype; version projectceo_foundation.external_asset_versions%rowtype; reservation remhaos_integration.external_upload_reservations%rowtype; fmt record;
begin
 select * into strict g from remhaos_integration.external_upload_generations where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=p_org and project_id=p_project and package_id=p_package and session_id=g.session_id;
 select * into link from remhaos_integration.external_generation_intake_links where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation;
 if not found then raise exception 'R1_MATERIALIZATION_LINK_MISSING'; end if;
 select * into lineage from remhaos_integration.external_asset_validation_lineage where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation;
 if not found then raise exception 'R1_MATERIALIZATION_ASSET_LINEAGE_MISSING'; end if;
 select * into strict i from remhaos_integration.file_intakes where organization_id=p_org and project_id=p_project and package_id=p_package and intake_id=link.intake_id;
 select * into strict v from remhaos_integration.external_validation_receipts where organization_id=p_org and project_id=p_project and package_id=p_package and receipt_id=link.validation_receipt_id;
 select * into strict canonical from remhaos_integration.external_canonical_object_receipts where organization_id=p_org and project_id=p_project and package_id=p_package and receipt_id=link.canonical_receipt_id;
 select * into strict sealed from remhaos_integration.external_upload_seal_receipts where organization_id=p_org and project_id=p_project and package_id=p_package and receipt_id=g.seal_receipt_id;
 select * into strict version from projectceo_foundation.external_asset_versions where organization_id=p_org and project_id=p_project and package_id=p_package and asset_version_id=lineage.asset_version_id;
 select * into strict asset from projectceo_foundation.external_assets where organization_id=p_org and project_id=p_project and package_id=p_package and asset_id=lineage.asset_id;
 select * into strict reservation from remhaos_integration.external_upload_reservations where organization_id=p_org and project_id=p_project and package_id=p_package and reservation_id=s.reservation_id;
 select * into fmt from remhaos_integration._external_materialization_format(g.requested_format);
 if not exists(select 1 from remhaos_integration.external_validation_completions c join remhaos_integration.external_validation_jobs j using(organization_id,project_id,package_id,job_id,generation_id) where c.organization_id=p_org and c.project_id=p_project and c.package_id=p_package and c.generation_id=p_generation and c.job_id=link.job_id and c.validation_receipt_id=v.receipt_id and c.canonical_receipt_id=canonical.receipt_id and j.state='succeeded') then raise exception 'R1_MATERIALIZATION_COMPLETION_MISSING'; end if;
 if i.r1_generation_id is distinct from p_generation or i.intake_id<>g.intake_id or i.checksum is distinct from v.source_sha256 or i.size_bytes is distinct from v.byte_length or i.size_bytes<>g.observed_byte_length or i.scan_outcome is distinct from 'clean' or v.outcome<>'successful' or canonical.source_sha256<>i.checksum or canonical.byte_length<>i.size_bytes or v.validated_format<>g.requested_format or canonical.validation_receipt_id<>v.receipt_id or i.extension<>fmt.extension or i.media_type<>fmt.media_type or i.quarantine_object_key<>sealed.private_locator or i.internal_object_key<>canonical.private_locator or i.created_by_user_id is distinct from s.created_by_user_id or i.scanned_at is distinct from v.scan_completed_at then raise exception 'R1_MATERIALIZATION_INTAKE_BYTES_MISMATCH'; end if;
 if link.display_name_origin is distinct from (case when s.display_filename is null then 'generated' else 'supplied' end) or i.original_filename is distinct from coalesce(s.display_filename,'external-'||i.intake_id::text||'.'||fmt.extension) then raise exception 'R1_MATERIALIZATION_LABEL_MISMATCH'; end if;
 if version.asset_id<>asset.asset_id or version.server_sha256<>i.checksum or version.byte_length<>i.size_bytes or version.validated_format<>g.requested_format or version.private_storage_locator<>canonical.private_locator or version.origin_intake_generation<>g.generation_id::text or version.created_by_user_id is distinct from s.created_by_user_id or asset.created_by_user_id is distinct from s.created_by_user_id or asset.source_kind<>fmt.source_kind then raise exception 'R1_MATERIALIZATION_ASSET_BYTES_MISMATCH'; end if;
 if not exists(select 1 from remhaos_integration.file_intake_events e join remhaos_integration.external_validation_principals p on p.principal_id=link.materialized_by_principal_id where e.organization_id=p_org and e.project_id=p_project and e.intake_id=i.intake_id and e.event_type='file_scan_completed' and e.actor_type='system' and e.actor_id=p.actor_id and e.actor_user_id is null and e.sanitized_metadata->>'generationId'=p_generation::text and e.sanitized_metadata->>'validationReceiptId'=v.receipt_id::text) or not exists(select 1 from projectceo_foundation.external_asset_events e join remhaos_integration.external_validation_principals p on p.principal_id=link.materialized_by_principal_id where e.organization_id=p_org and e.project_id=p_project and e.package_id=p_package and e.asset_id=asset.asset_id and e.event_type='scan_passed' and e.actor_type='system' and e.actor_id=p.actor_id and e.actor_user_id is null and e.sanitized_payload->>'assetVersionId'=version.asset_version_id::text and e.sanitized_payload->>'validationReceiptId'=v.receipt_id::text) then raise exception 'R1_MATERIALIZATION_EVENTS_MISSING'; end if;
 if reservation.state<>'materialized' or reservation.logical_used<>i.size_bytes or reservation.logical_reserved<>reservation.logical_budget-i.size_bytes or reservation.physical_used<>i.size_bytes or reservation.physical_reserved<>3*(reservation.logical_budget-i.size_bytes) or reservation.physical_orphan<>reservation.physical_budget-i.size_bytes-3*(reservation.logical_budget-i.size_bytes) then raise exception 'R1_MATERIALIZATION_ACCOUNTING_MISMATCH'; end if;
end $f$;

create function remhaos_integration._external_materialization_constraint()
returns trigger language plpgsql security definer set search_path='' as $f$
declare generation uuid;
begin
 if tg_table_name='file_intakes' then generation:=new.r1_generation_id;
 elsif tg_table_name='external_asset_versions' then
  select generation_id into generation from remhaos_integration.external_upload_generations where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and generation_id::text=new.origin_intake_generation;
  if generation is not null and not exists(select 1 from remhaos_integration.external_asset_validation_lineage l where l.organization_id=new.organization_id and l.project_id=new.project_id and l.package_id=new.package_id and l.asset_id=new.asset_id and l.asset_version_id=new.asset_version_id and l.generation_id=generation) then raise exception 'R1_INSERTED_ASSET_VERSION_LINEAGE_MISSING'; end if;
 else generation:=new.generation_id;
 end if;
 if generation is not null then perform remhaos_integration._assert_external_materialization(new.organization_id,new.project_id,new.package_id,generation); end if;
 return null;
end $f$;
create constraint trigger r1_intake_materialization_closure after insert or update on remhaos_integration.file_intakes deferrable initially deferred for each row execute function remhaos_integration._external_materialization_constraint();
create constraint trigger r1_asset_materialization_closure after insert on projectceo_foundation.external_asset_versions deferrable initially deferred for each row execute function remhaos_integration._external_materialization_constraint();
create constraint trigger r1_intake_link_closure after insert on remhaos_integration.external_generation_intake_links deferrable initially deferred for each row execute function remhaos_integration._external_materialization_constraint();
create constraint trigger r1_asset_lineage_closure after insert on remhaos_integration.external_asset_validation_lineage deferrable initially deferred for each row execute function remhaos_integration._external_materialization_constraint();

alter table remhaos_integration.external_upload_reservations drop constraint external_upload_reservations_state_check;
alter table remhaos_integration.external_upload_reservations add constraint external_upload_reservations_state_check check(state in ('reserved','committed','orphaned','reconciled','materialized'));

create or replace function remhaos_integration._external_upload_reservation_accounting()
returns trigger language plpgsql security definer set search_path='' as $f$
declare h remhaos_integration.external_upload_policy_heads%rowtype;
 b remhaos_integration.external_upload_policy_bindings%rowtype;
 l remhaos_integration.external_upload_quota_ledgers%rowtype;
 old_lr bigint:=0; old_lu bigint:=0; old_pr bigint:=0; old_pu bigint:=0; old_po bigint:=0; measured_bytes bigint;
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
  if not ((old.state='reserved' and new.state in ('committed','orphaned')) or (old.state='committed' and new.state in ('orphaned','materialized'))) then raise exception 'UPLOAD_RESERVATION_STATE_TRANSITION'; end if;
  -- Physical bytes cannot disappear in this slice. A later trusted cleanup
  -- receipt transaction must explicitly extend this boundary before releasing.
  if new.physical_reserved+new.physical_used+new.physical_orphan<>old.physical_reserved+old.physical_used+old.physical_orphan then raise exception 'UPLOAD_PHYSICAL_LIABILITY_UNACKNOWLEDGED'; end if;
  if new.state='orphaned' and (new.logical_reserved<>0 or new.logical_used<>0 or new.physical_reserved<>0 or new.physical_used<>0 or new.physical_orphan<>old.physical_reserved+old.physical_used+old.physical_orphan) then raise exception 'UPLOAD_ORPHAN_LIABILITY'; end if;
  if new.state='committed' and (new.logical_reserved<>old.logical_reserved or new.logical_used<>old.logical_used) then raise exception 'UPLOAD_PROCESSING_RESERVATION_REQUIRED'; end if;
  if new.state='materialized' then
   select v.byte_length into measured_bytes from remhaos_integration.external_generation_intake_links intake_link
   join remhaos_integration.external_upload_generations g on g.organization_id=intake_link.organization_id and g.project_id=intake_link.project_id and g.package_id=intake_link.package_id and g.generation_id=intake_link.generation_id
   join remhaos_integration.external_validation_completions c on c.organization_id=intake_link.organization_id and c.project_id=intake_link.project_id and c.package_id=intake_link.package_id and c.job_id=intake_link.job_id and c.generation_id=intake_link.generation_id and c.validation_receipt_id=intake_link.validation_receipt_id and c.canonical_receipt_id=intake_link.canonical_receipt_id
   join remhaos_integration.external_validation_receipts v on v.organization_id=intake_link.organization_id and v.project_id=intake_link.project_id and v.package_id=intake_link.package_id and v.receipt_id=intake_link.validation_receipt_id
   join remhaos_integration.external_asset_validation_lineage a on a.organization_id=intake_link.organization_id and a.project_id=intake_link.project_id and a.package_id=intake_link.package_id and a.generation_id=intake_link.generation_id and a.intake_id=intake_link.intake_id
   where intake_link.organization_id=new.organization_id and intake_link.project_id=new.project_id and intake_link.package_id=new.package_id and g.session_id=new.session_id;
   if measured_bytes is null or old.logical_used<>0 or old.logical_reserved<>old.logical_budget or old.physical_used<>0 or old.physical_orphan<>0 or old.physical_reserved<>old.physical_budget
    or new.logical_used<>measured_bytes or new.logical_reserved<>old.logical_budget-measured_bytes or new.physical_used<>measured_bytes or new.physical_reserved<>3*(old.logical_budget-measured_bytes) or new.physical_orphan<>old.physical_budget-measured_bytes-3*(old.logical_budget-measured_bytes) then raise exception 'R1_MATERIALIZATION_RESERVATION_PROOF_REQUIRED'; end if;
  end if;
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

create or replace function remhaos_integration._external_upload_terminal_consistency()
returns trigger language plpgsql security definer set search_path='' as $f$
declare s remhaos_integration.external_upload_sessions%rowtype; r remhaos_integration.external_upload_reservations%rowtype; g remhaos_integration.external_upload_generations%rowtype;
begin
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and session_id=new.session_id;
 select * into strict r from remhaos_integration.external_upload_reservations where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and reservation_id=s.reservation_id;
 select * into g from remhaos_integration.external_upload_generations where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and session_id=s.session_id;
 if s.state in ('open','finalizing') and r.state<>'reserved' then raise exception 'UPLOAD_ACTIVE_RESERVATION_NOT_RESERVED'; end if;
 if s.state='finalized' then
  if r.state='materialized' then perform remhaos_integration._assert_external_materialization(s.organization_id,s.project_id,s.package_id,g.generation_id); end if;
  if g.generation_id is null or (r.state not in ('committed','materialized') and not (r.state='orphaned' and exists(select 1 from remhaos_integration.external_validation_jobs j where j.organization_id=s.organization_id and j.project_id=s.project_id and j.package_id=s.package_id and j.generation_id=g.generation_id and j.state='failed'))) or not exists(select 1 from remhaos_integration.external_upload_outbox x where x.organization_id=s.organization_id and x.project_id=s.project_id and x.package_id=s.package_id and x.session_id=s.session_id and x.generation_id=g.generation_id and x.kind='enqueue_validation') or not exists(
   select 1 from remhaos_integration.external_upload_seal_receipts z join remhaos_integration.external_upload_finalize_claims c using(organization_id,project_id,package_id,session_id,claim_id,fence)
   where z.organization_id=s.organization_id and z.project_id=s.project_id and z.package_id=s.package_id and z.receipt_id=g.seal_receipt_id and c.state='consumed') then raise exception 'UPLOAD_FINALIZE_CLOSURE_MISSING'; end if;
 elsif g.generation_id is not null then raise exception 'UPLOAD_GENERATION_NOT_FINALIZED';
 elsif s.state in ('cancelled','expired','failed') then
  if r.state<>'orphaned' or (select count(*) from remhaos_integration.external_upload_outbox x where x.organization_id=s.organization_id and x.project_id=s.project_id and x.package_id=s.package_id and x.session_id=s.session_id and x.target_fence=s.cancellation_revision and x.kind in ('revoke_upload','reconcile_upload'))<>2 then raise exception 'UPLOAD_TERMINAL_LIABILITY_MISSING'; end if;
 end if;
 return null;
end $f$;

create function remhaos_integration._materialize_external_generation(
 p_principal uuid,p_principal_secret text,p_org uuid,p_project uuid,p_package uuid,p_generation uuid,p_key text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare principal remhaos_integration.external_validation_principals%rowtype;
 g remhaos_integration.external_upload_generations%rowtype; s remhaos_integration.external_upload_sessions%rowtype; completion remhaos_integration.external_validation_completions%rowtype;
 v remhaos_integration.external_validation_receipts%rowtype; canonical remhaos_integration.external_canonical_object_receipts%rowtype; sealed remhaos_integration.external_upload_seal_receipts%rowtype;
 lineage remhaos_integration.external_asset_validation_lineage%rowtype; context record; fmt record; asset uuid:=extensions.gen_random_uuid(); version uuid:=extensions.gen_random_uuid(); label text; result jsonb;
begin
 principal:=remhaos_integration._external_validation_authorize(p_principal,p_principal_secret,p_org,p_project,p_package);
 select * into g from remhaos_integration.external_upload_generations where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation;
 if not found then perform projectceo_product._raise('P1104','not_found','{}'); end if;
 select * into completion from remhaos_integration.external_validation_completions where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation;
 if not found then perform projectceo_product._raise('P1111','validation_failed','{"reason":"validated_generation_required"}'); end if;
 perform remhaos_integration._external_validation_job_current(p_org,p_project,p_package,completion.job_id,p_principal,null,null,null,false);
 select * into context from remhaos_integration._external_validation_replay(p_org,p_project,'materialize_external_generation',principal.actor_id,p_key,jsonb_build_object('packageId',p_package,'principalId',p_principal,'generationId',p_generation));
 if context.replay is not null then
  perform remhaos_integration._assert_external_materialization(p_org,p_project,p_package,p_generation);
  return context.replay;
 end if;
 select * into lineage from remhaos_integration.external_asset_validation_lineage where organization_id=p_org and project_id=p_project and package_id=p_package and generation_id=p_generation;
 if found then
  perform remhaos_integration._assert_external_materialization(p_org,p_project,p_package,p_generation);
  asset:=lineage.asset_id; version:=lineage.asset_version_id;
 else
  set constraints remhaos_integration.r1_intake_materialization_closure, projectceo_foundation.r1_asset_materialization_closure, remhaos_integration.r1_intake_link_closure, remhaos_integration.r1_asset_lineage_closure, remhaos_integration.external_upload_reservation_closure deferred;
  select * into strict s from remhaos_integration.external_upload_sessions where organization_id=p_org and project_id=p_project and package_id=p_package and session_id=g.session_id for update;
  perform 1 from remhaos_integration.external_upload_reservations where organization_id=p_org and project_id=p_project and package_id=p_package and reservation_id=s.reservation_id for update;
  select * into strict v from remhaos_integration.external_validation_receipts where organization_id=p_org and project_id=p_project and package_id=p_package and receipt_id=completion.validation_receipt_id;
  select * into strict canonical from remhaos_integration.external_canonical_object_receipts where organization_id=p_org and project_id=p_project and package_id=p_package and receipt_id=completion.canonical_receipt_id;
  select * into strict sealed from remhaos_integration.external_upload_seal_receipts where organization_id=p_org and project_id=p_project and package_id=p_package and receipt_id=g.seal_receipt_id;
  select * into fmt from remhaos_integration._external_materialization_format(v.validated_format);
  label:=coalesce(s.display_filename,'external-'||g.intake_id::text||'.'||fmt.extension);
  insert into remhaos_integration.file_intakes(organization_id,project_id,package_id,intake_id,r1_generation_id,original_filename,media_type,extension,source_role,size_bytes,checksum,quarantine_object_key,internal_object_key,status,scan_outcome,created_by_user_id,created_at,uploaded_at,scanned_at)
  values(p_org,p_project,p_package,g.intake_id,p_generation,label,fmt.media_type,fmt.extension,'document',v.byte_length,v.source_sha256,sealed.private_locator,canonical.private_locator,'clean','clean',g.created_by_user_id,s.created_at,g.finalized_at,v.scan_completed_at);
  insert into projectceo_foundation.external_assets(organization_id,project_id,package_id,asset_id,source_kind,created_by_user_id) values(p_org,p_project,p_package,asset,fmt.source_kind,g.created_by_user_id);
  insert into projectceo_foundation.external_asset_versions(organization_id,project_id,package_id,asset_id,asset_version_id,revision_no,server_sha256,byte_length,validated_format,private_storage_locator,origin_intake_generation,created_by_user_id)
  values(p_org,p_project,p_package,asset,version,1,v.source_sha256,v.byte_length,v.validated_format,canonical.private_locator,p_generation::text,g.created_by_user_id);
  insert into remhaos_integration.external_generation_intake_links(organization_id,project_id,package_id,generation_id,intake_id,job_id,validation_receipt_id,canonical_receipt_id,display_name_origin,materialized_by_principal_id)
  values(p_org,p_project,p_package,p_generation,g.intake_id,completion.job_id,v.receipt_id,canonical.receipt_id,case when s.display_filename is null then 'generated' else 'supplied' end,p_principal);
  insert into remhaos_integration.external_asset_validation_lineage values(p_org,p_project,p_package,asset,version,p_generation,g.intake_id,completion.job_id,v.receipt_id,canonical.receipt_id);
  update remhaos_integration.external_upload_reservations set state='materialized',revision=revision+1,logical_used=v.byte_length,logical_reserved=logical_budget-v.byte_length,physical_used=v.byte_length,physical_reserved=3*(logical_budget-v.byte_length),physical_orphan=physical_budget-v.byte_length-3*(logical_budget-v.byte_length)
  where organization_id=p_org and project_id=p_project and package_id=p_package and reservation_id=s.reservation_id;
  perform remhaos_integration._record_file_intake_event(p_org,p_project,g.intake_id,null,'clean','file_scan_completed','system',principal.actor_id,null,jsonb_build_object('generationId',p_generation,'validationReceiptId',v.receipt_id,'outcome','clean'));
  insert into projectceo_foundation.external_asset_events(organization_id,project_id,package_id,asset_id,sequence_no,event_type,actor_type,actor_id,actor_user_id,causation_id,request_id,sanitized_payload)
  values(p_org,p_project,p_package,asset,1,'scan_passed','system',principal.actor_id,null,completion.job_id::text,'db:'||extensions.gen_random_uuid()::text,jsonb_build_object('generationId',p_generation,'assetVersionId',version,'validationReceiptId',v.receipt_id));
 end if;
 perform remhaos_integration._assert_external_materialization(p_org,p_project,p_package,p_generation);
 set constraints remhaos_integration.r1_intake_materialization_closure, projectceo_foundation.r1_asset_materialization_closure, remhaos_integration.r1_intake_link_closure, remhaos_integration.r1_asset_lineage_closure, remhaos_integration.external_upload_reservation_closure immediate;
 set constraints remhaos_integration.r1_intake_materialization_closure, projectceo_foundation.r1_asset_materialization_closure, remhaos_integration.r1_intake_link_closure, remhaos_integration.r1_asset_lineage_closure, remhaos_integration.external_upload_reservation_closure deferred;
 result:=jsonb_build_object('generationId',p_generation,'intakeId',g.intake_id,'assetId',asset,'assetVersionId',version,'status','clean');
 return remhaos_integration._complete_command(p_org,p_project,'materialize_external_generation',context.key_digest,context.request_digest,'system',principal.actor_id,null,result,'materialize_external_generation','ok','{}');
end $f$;

-- Preserve every effective legacy signature, owner and ACL while narrowing data.
create temporary table r1_legacy_intake_acl on commit drop as select p.oid,p.proowner,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='remhaos_integration_api' and p.proname in ('create_file_intake','create_file_intake_worker','get_file_intake_storage','list_file_intakes','authorize_file_intake_download','mark_file_intake_uploaded','mark_file_intake_uploaded_worker','complete_file_intake_scan','review_file_intake','publish_file_intake');

-- Effective predecessor: 20260826023906_remhaos_file_intake_hardening.sql
create or replace function remhaos_integration_api.create_file_intake(
  p_project_id uuid,
  p_original_filename text,
  p_media_type text,
  p_extension text,
  p_size_bytes bigint,
  p_checksum_hex text,
  p_source_role text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_package_id uuid;
  v_intake_id uuid;
  v_checksum bytea;
  v_checksum_hex text := lower(btrim(coalesce(p_checksum_hex, '')));
  v_filename text := btrim(coalesce(p_original_filename, ''));
  v_media_type text := lower(btrim(coalesce(p_media_type, '')));
  v_extension text := lower(btrim(coalesce(p_extension, '')));
  v_policy jsonb;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
  v_state_revision bigint;
  v_existing remhaos_integration.file_intakes%rowtype;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'register_source');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  if v_filename = '' or length(v_filename) > 500 or v_filename ~ '[[:cntrl:]]' or v_filename ~ '[/\\]' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"originalFilename"}'::jsonb);
  end if;
  if p_source_role not in ('document', 'drawing-preview', 'reference', 'photo-evidence', 'correspondence', 'schedule') then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"sourceRole"}'::jsonb);
  end if;
  if v_checksum_hex !~ '^[a-f0-9]{64}$' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"checksum"}'::jsonb);
  end if;
  v_checksum := remhaos_integration._assert_bytea_32(decode(v_checksum_hex, 'hex'), 'checksum');
  v_policy := remhaos_integration._file_intake_policy(v_media_type, v_extension, p_size_bytes);

  select pp.id into v_package_id
  from projectceo_foundation.project_packages pp
  where pp.organization_id = v_context.organization_id
    and pp.project_id = p_project_id
    and pp.kind = 'project_root'
    and pp.status = 'active';
  if v_package_id is null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project_package"}'::jsonb);
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'extension', v_extension,
    'filename', v_filename,
    'mediaType', v_media_type,
    'projectId', p_project_id,
    'role', p_source_role,
    'sizeBytes', p_size_bytes,
    'checksum', v_checksum_hex
  ));
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id and pw.project_id = p_project_id
  for update;
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'create_file_intake', v_key_digest, v_request_digest
  );
  if v_replay is not null then
    if not remhaos_integration._is_legacy_file_intake(v_context.organization_id,p_project_id,(v_replay#>>'{result,intakeId}')::uuid) then
      perform remhaos_integration._raise('P1204','not_found','{"entity":"file_intake"}'::jsonb);
    end if;
    return v_replay;
  end if;

  select * into v_existing
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_context.organization_id
    and intake.project_id = p_project_id
    and intake.checksum = v_checksum
    and intake.status <> 'rejected'
  for update;
  if found then
    v_result := jsonb_build_object(
      'intakeId', v_existing.intake_id,
      'organizationId', v_existing.organization_id,
      'projectId', p_project_id,
      'packageId', v_existing.package_id,
      'bucket', 'client-uploads',
      'checksumHex', encode(v_existing.checksum, 'hex'),
      'mediaType', v_existing.media_type,
      'extension', v_existing.extension,
      'sourceRole', v_existing.source_role,
      'objectKey', v_existing.quarantine_object_key,
      'internalObjectKey', v_existing.internal_object_key,
      'status', v_existing.status,
      'reused', true
    );
    return remhaos_integration._complete_command(
      v_context.organization_id, p_project_id, 'create_file_intake', v_key_digest,
      v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
      v_result, 'file_intake_reused', 'file_intake_reused',
      jsonb_build_object('status', v_existing.status), null
    );
  end if;

  v_intake_id := extensions.gen_random_uuid();
  insert into remhaos_integration.file_intakes (
    organization_id, project_id, intake_id, package_id, original_filename,
    media_type, extension, source_role, size_bytes, checksum,
    quarantine_object_key, internal_object_key, status, created_by_user_id
  ) values (
    v_context.organization_id, p_project_id, v_intake_id, v_package_id, v_filename,
    v_policy ->> 'mediaType', v_policy ->> 'extension', p_source_role, p_size_bytes, v_checksum,
    remhaos_integration._file_intake_quarantine_key(
      v_context.organization_id, p_project_id, v_intake_id, v_checksum_hex, p_source_role, v_extension
    ),
    remhaos_integration._file_intake_internal_key(
      v_context.organization_id, p_project_id, v_checksum_hex, p_source_role, v_extension
    ),
    'requested', v_context.actor_user_id
  );
  perform remhaos_integration._record_file_intake_event(
    v_context.organization_id, p_project_id, v_intake_id, null, 'requested',
    'file_intake_requested', 'human', v_context.actor_id, v_context.actor_user_id,
    jsonb_build_object('extension', v_extension, 'media_type', v_media_type, 'size_bytes', p_size_bytes)
  );
  v_result := jsonb_build_object(
    'intakeId', v_intake_id,
    'organizationId', v_context.organization_id,
    'projectId', p_project_id,
    'packageId', v_package_id,
    'bucket', 'client-uploads',
    'checksumHex', v_checksum_hex,
    'mediaType', v_policy ->> 'mediaType',
    'extension', v_policy ->> 'extension',
    'sourceRole', p_source_role,
    'objectKey', remhaos_integration._file_intake_quarantine_key(
      v_context.organization_id, p_project_id, v_intake_id, v_checksum_hex, p_source_role, v_extension
    ),
    'internalObjectKey', remhaos_integration._file_intake_internal_key(
      v_context.organization_id, p_project_id, v_checksum_hex, p_source_role, v_extension
    ),
    'status', 'requested',
    'reused', false
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'create_file_intake', v_key_digest,
    v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'file_intake_requested', 'file_intake_requested',
    jsonb_build_object('intake_id', v_intake_id, 'status', 'requested'), null
  );
end
$function$;

-- Effective predecessor: 20260826058000_remhaos_file_intake_worker_ingest.sql
create or replace function remhaos_integration_api.create_file_intake_worker(
  p_project_id uuid,
  p_original_filename text,
  p_media_type text,
  p_extension text,
  p_size_bytes bigint,
  p_checksum_hex text,
  p_source_role text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_package_id uuid;
  v_intake_id uuid;
  v_checksum bytea;
  v_checksum_hex text := lower(btrim(coalesce(p_checksum_hex, '')));
  v_filename text := btrim(coalesce(p_original_filename, ''));
  v_media_type text := lower(btrim(coalesce(p_media_type, '')));
  v_extension text := lower(btrim(coalesce(p_extension, '')));
  v_policy jsonb;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
  v_state_revision bigint;
  v_existing remhaos_integration.file_intakes%rowtype;
begin
  select pw.organization_id, pw.state_revision
    into v_organization_id, v_state_revision
  from project_intelligence.project_workflows pw
  where pw.project_id = p_project_id
  for update;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project"}'::jsonb);
  end if;

  if v_filename = '' or length(v_filename) > 500 or v_filename ~ '[[:cntrl:]]' or v_filename ~ '[/\\]' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"originalFilename"}'::jsonb);
  end if;
  if p_source_role not in ('document', 'drawing-preview', 'reference', 'photo-evidence', 'correspondence', 'schedule') then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"sourceRole"}'::jsonb);
  end if;
  if v_checksum_hex !~ '^[a-f0-9]{64}$' then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"checksum"}'::jsonb);
  end if;
  v_checksum := remhaos_integration._assert_bytea_32(decode(v_checksum_hex, 'hex'), 'checksum');
  v_policy := remhaos_integration._file_intake_policy(v_media_type, v_extension, p_size_bytes);

  select pp.id into v_package_id
  from projectceo_foundation.project_packages pp
  where pp.organization_id = v_organization_id
    and pp.project_id = p_project_id
    and pp.kind = 'project_root'
    and pp.status = 'active';
  if v_package_id is null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project_package"}'::jsonb);
  end if;

  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'extension', v_extension,
    'filename', v_filename,
    'mediaType', v_media_type,
    'projectId', p_project_id,
    'role', p_source_role,
    'sizeBytes', p_size_bytes,
    'checksum', v_checksum_hex
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_organization_id, p_project_id, 'create_file_intake_worker', v_key_digest, v_request_digest
  );
  if v_replay is not null then
    if not remhaos_integration._is_legacy_file_intake(v_organization_id,p_project_id,(v_replay#>>'{result,intakeId}')::uuid) then
      perform remhaos_integration._raise('P1204','not_found','{"entity":"file_intake"}'::jsonb);
    end if;
    return v_replay;
  end if;

  select * into v_existing
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_organization_id
    and intake.project_id = p_project_id
    and intake.checksum = v_checksum
    and intake.status <> 'rejected'
  for update;
  if found then
    v_result := jsonb_build_object(
      'intakeId', v_existing.intake_id,
      'organizationId', v_existing.organization_id,
      'projectId', p_project_id,
      'packageId', v_existing.package_id,
      'bucket', 'client-uploads',
      'checksumHex', encode(v_existing.checksum, 'hex'),
      'mediaType', v_existing.media_type,
      'extension', v_existing.extension,
      'sourceRole', v_existing.source_role,
      'objectKey', v_existing.quarantine_object_key,
      'internalObjectKey', v_existing.internal_object_key,
      'status', v_existing.status,
      'reused', true
    );
    return remhaos_integration._complete_command(
      v_organization_id, p_project_id, 'create_file_intake_worker', v_key_digest,
      v_request_digest, 'system', 'system:google-drive-import-worker', null,
      v_result, 'file_intake_reused', 'file_intake_reused',
      jsonb_build_object('status', v_existing.status), null
    );
  end if;

  v_intake_id := extensions.gen_random_uuid();
  insert into remhaos_integration.file_intakes (
    organization_id, project_id, intake_id, package_id, original_filename,
    media_type, extension, source_role, size_bytes, checksum,
    quarantine_object_key, internal_object_key, status, created_by_user_id
  ) values (
    v_organization_id, p_project_id, v_intake_id, v_package_id, v_filename,
    v_policy ->> 'mediaType', v_policy ->> 'extension', p_source_role, p_size_bytes, v_checksum,
    remhaos_integration._file_intake_quarantine_key(
      v_organization_id, p_project_id, v_intake_id, v_checksum_hex, p_source_role, v_extension
    ),
    remhaos_integration._file_intake_internal_key(
      v_organization_id, p_project_id, v_checksum_hex, p_source_role, v_extension
    ),
    'requested', null
  );
  perform remhaos_integration._record_file_intake_event(
    v_organization_id, p_project_id, v_intake_id, null, 'requested',
    'file_intake_requested', 'system', 'system:google-drive-import-worker', null,
    jsonb_build_object('extension', v_extension, 'media_type', v_media_type, 'size_bytes', p_size_bytes)
  );
  v_result := jsonb_build_object(
    'intakeId', v_intake_id,
    'organizationId', v_organization_id,
    'projectId', p_project_id,
    'packageId', v_package_id,
    'bucket', 'client-uploads',
    'checksumHex', v_checksum_hex,
    'mediaType', v_policy ->> 'mediaType',
    'extension', v_policy ->> 'extension',
    'sourceRole', p_source_role,
    'objectKey', remhaos_integration._file_intake_quarantine_key(
      v_organization_id, p_project_id, v_intake_id, v_checksum_hex, p_source_role, v_extension
    ),
    'internalObjectKey', remhaos_integration._file_intake_internal_key(
      v_organization_id, p_project_id, v_checksum_hex, p_source_role, v_extension
    ),
    'status', 'requested',
    'reused', false
  );
  return remhaos_integration._complete_command(
    v_organization_id, p_project_id, 'create_file_intake_worker', v_key_digest,
    v_request_digest, 'system', 'system:google-drive-import-worker', null,
    v_result, 'file_intake_requested', 'file_intake_requested',
    jsonb_build_object('intake_id', v_intake_id, 'status', 'requested'), null
  );
end
$function$;

-- Effective predecessor: 20260826056000_remhaos_file_intake_publish_replay.sql
create or replace function remhaos_integration_api.get_file_intake_storage(
  p_project_id uuid,
  p_intake_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_intake remhaos_integration.file_intakes%rowtype;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'publish_baseline');
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_context.organization_id
    and intake.project_id = p_project_id
    and intake.intake_id = p_intake_id;
  if not found or v_intake.status not in ('ingested_candidate', 'published_internal_copy') then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"publishable_file_intake"}'::jsonb);
  end if;
  return jsonb_build_object(
    'organizationId', v_intake.organization_id,
    'projectId', v_intake.project_id,
    'intakeId', v_intake.intake_id,
    'packageId', v_intake.package_id,
    'bucket', 'client-uploads',
    'objectKey', case
      when v_intake.status = 'published_internal_copy' then v_intake.internal_object_key
      else v_intake.quarantine_object_key
    end,
    'internalObjectKey', v_intake.internal_object_key,
    'checksumHex', encode(v_intake.checksum, 'hex'),
    'mediaType', v_intake.media_type,
    'extension', v_intake.extension,
    'sourceRole', v_intake.source_role,
    'status', v_intake.status,
    'upsert', false
  );
end
$function$;

-- Effective predecessor: 20260826023906_remhaos_file_intake_hardening.sql
create or replace function remhaos_integration_api.list_file_intakes(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_client boolean;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'view_project');
  select exists (
    select 1 from projectceo_foundation.project_memberships membership
    where membership.organization_id = v_context.organization_id and membership.project_id = p_project_id
      and membership.user_id = v_context.actor_user_id and membership.role = 'client_approver' and membership.status = 'active'
  ) into v_client;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'intakeId', intake.intake_id,
      'projectId', intake.project_id,
      'packageId', case when v_client then null else intake.package_id end,
      'originalFilename', intake.original_filename,
      'mediaType', intake.media_type,
      'extension', intake.extension,
      'sourceRole', intake.source_role,
      'sizeBytes', intake.size_bytes,
      'status', intake.status,
      'scanOutcome', intake.scan_outcome,
      'reviewDecision', intake.review_decision,
      'sourceId', case when v_client then null else intake.source_id end,
      'createdAt', intake.created_at,
      'publishedAt', intake.published_at,
      'createdBy', case when v_client then null else intake.created_by_user_id end,
      'quarantineObjectKey', case when v_client then null else intake.quarantine_object_key end,
      'internalObjectKey', case when v_client then null else intake.internal_object_key end,
      'clientProjection', v_client
    ) order by intake.created_at desc, intake.intake_id)
    from remhaos_integration.file_intakes intake
    where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_context.organization_id and intake.project_id = p_project_id
      and (not v_client or intake.status = 'published_internal_copy')
  ), '[]'::jsonb);
end
$function$;

-- Effective predecessor: 20260826023906_remhaos_file_intake_hardening.sql
create or replace function remhaos_integration_api.authorize_file_intake_download(
  p_project_id uuid,
  p_intake_id uuid,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_intake remhaos_integration.file_intakes%rowtype;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'view_project');
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 900 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"ttlSeconds"}'::jsonb);
  end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_context.organization_id and intake.project_id = p_project_id and intake.intake_id = p_intake_id;
  if not found or v_intake.status <> 'published_internal_copy' then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"published_file_intake"}'::jsonb);
  end if;
  return jsonb_build_object(
    'bucket', 'client-uploads', 'objectKey', v_intake.internal_object_key,
    'projectId', p_project_id, 'packageId', v_intake.package_id,
    'sourceId', v_intake.source_id, 'ttlSeconds', p_ttl_seconds
  );
end
$function$;

-- Effective predecessor: 20260826023906_remhaos_file_intake_hardening.sql
create or replace function remhaos_integration_api.mark_file_intake_uploaded(
  p_project_id uuid,
  p_intake_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_intake remhaos_integration.file_intakes%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select intake.* into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.project_id = p_project_id and intake.intake_id = p_intake_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_package_human(p_project_id, v_intake.package_id, 'register_source');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('intakeId', p_intake_id));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'mark_file_intake_uploaded', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_context.organization_id
    and intake.project_id = p_project_id and intake.intake_id = p_intake_id
  for update;
  if v_intake.status <> 'requested' then
    if v_intake.status in ('uploaded_to_quarantine', 'scan_pending') then
      v_result := jsonb_build_object('intakeId', p_intake_id, 'status', v_intake.status);
      return remhaos_integration._complete_command(
        v_context.organization_id, p_project_id, 'mark_file_intake_uploaded', v_key_digest,
        v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
        v_result, 'file_intake_upload_replayed', 'file_intake_upload_replayed', '{}', null
      );
    end if;
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"INVALID_INTAKE_STATE"}'::jsonb);
  end if;
  update remhaos_integration.file_intakes
  set status = 'uploaded_to_quarantine', uploaded_at = statement_timestamp()
  where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_context.organization_id, p_project_id, p_intake_id, 'requested', 'uploaded_to_quarantine',
    'file_uploaded_to_quarantine', 'human', v_context.actor_id, v_context.actor_user_id
  );
  update remhaos_integration.file_intakes
  set status = 'scan_pending'
  where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_context.organization_id, p_project_id, p_intake_id, 'uploaded_to_quarantine', 'scan_pending',
    'file_scan_queued', 'human', v_context.actor_id, v_context.actor_user_id
  );
  v_result := jsonb_build_object('intakeId', p_intake_id, 'status', 'scan_pending');
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'mark_file_intake_uploaded', v_key_digest,
    v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'file_intake_upload_accepted', 'file_intake_upload_accepted', '{}', null
  );
end
$function$;

-- Effective predecessor: 20260826058000_remhaos_file_intake_worker_ingest.sql
create or replace function remhaos_integration_api.mark_file_intake_uploaded_worker(
  p_project_id uuid,
  p_intake_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_organization_id uuid;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select pw.organization_id into v_organization_id
  from project_intelligence.project_workflows pw
  where pw.project_id = p_project_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"project"}'::jsonb);
  end if;

  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_organization_id
    and intake.project_id = p_project_id
    and intake.intake_id = p_intake_id
  for update;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;

  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('intakeId', p_intake_id));
  v_replay := remhaos_integration._replay_or_null(
    v_organization_id, p_project_id, 'mark_file_intake_uploaded_worker', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  if v_intake.status <> 'requested' then
    if v_intake.status in ('uploaded_to_quarantine', 'scan_pending') then
      v_result := jsonb_build_object('intakeId', p_intake_id, 'status', v_intake.status);
      return remhaos_integration._complete_command(
        v_organization_id, p_project_id, 'mark_file_intake_uploaded_worker', v_key_digest,
        v_request_digest, 'system', 'system:google-drive-import-worker', null,
        v_result, 'file_intake_upload_replayed', 'file_intake_upload_replayed', '{}', null
      );
    end if;
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"INVALID_INTAKE_STATE"}'::jsonb);
  end if;

  update remhaos_integration.file_intakes
  set status = 'uploaded_to_quarantine', uploaded_at = statement_timestamp()
  where organization_id = v_organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_organization_id, p_project_id, p_intake_id, 'requested', 'uploaded_to_quarantine',
    'file_uploaded_to_quarantine', 'system', 'system:google-drive-import-worker', null
  );
  update remhaos_integration.file_intakes
  set status = 'scan_pending'
  where organization_id = v_organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_organization_id, p_project_id, p_intake_id, 'uploaded_to_quarantine', 'scan_pending',
    'file_scan_queued', 'system', 'system:google-drive-import-worker', null
  );
  v_result := jsonb_build_object('intakeId', p_intake_id, 'status', 'scan_pending');
  return remhaos_integration._complete_command(
    v_organization_id, p_project_id, 'mark_file_intake_uploaded_worker', v_key_digest,
    v_request_digest, 'system', 'system:google-drive-import-worker', null,
    v_result, 'file_intake_upload_accepted', 'file_intake_upload_accepted', '{}', null
  );
end
$function$;

-- Effective predecessor: 20260826023906_remhaos_file_intake_hardening.sql
create or replace function remhaos_integration_api.complete_file_intake_scan(
  p_project_id uuid,
  p_intake_id uuid,
  p_outcome text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_status text;
  v_result jsonb;
begin
  if p_outcome not in ('clean', 'infected', 'scan_failed') then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"outcome"}'::jsonb);
  end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.project_id = p_project_id and intake.intake_id = p_intake_id
  for update;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('intakeId', p_intake_id, 'outcome', p_outcome));
  v_replay := remhaos_integration._replay_or_null(
    v_intake.organization_id, p_project_id, 'complete_file_intake_scan', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_intake.status <> 'scan_pending' then
    if v_intake.status = p_outcome then
      v_result := jsonb_build_object('intakeId', p_intake_id, 'status', v_intake.status, 'scanOutcome', p_outcome);
      return remhaos_integration._complete_command(
        v_intake.organization_id, p_project_id, 'complete_file_intake_scan', v_key_digest,
        v_request_digest, 'system', 'system:remhaos-file-scanner', null, v_result,
        'file_scan_replayed', 'file_scan_replayed', '{}', null
      );
    end if;
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"INVALID_INTAKE_STATE"}'::jsonb);
  end if;
  v_status := p_outcome;
  update remhaos_integration.file_intakes
  set status = v_status, scan_outcome = p_outcome, scanned_at = statement_timestamp()
  where organization_id = v_intake.organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_intake.organization_id, p_project_id, p_intake_id, 'scan_pending', v_status,
    'file_scan_completed', 'system', 'system:remhaos-file-scanner', null,
    jsonb_build_object('outcome', p_outcome)
  );
  v_result := jsonb_build_object('intakeId', p_intake_id, 'status', v_status, 'scanOutcome', p_outcome);
  return remhaos_integration._complete_command(
    v_intake.organization_id, p_project_id, 'complete_file_intake_scan', v_key_digest,
    v_request_digest, 'system', 'system:remhaos-file-scanner', null, v_result,
    'file_scan_completed', 'file_scan_completed', jsonb_build_object('outcome', p_outcome), null
  );
end
$function$;

-- Effective predecessor: 20260826023906_remhaos_file_intake_hardening.sql
create or replace function remhaos_integration_api.review_file_intake(
  p_project_id uuid,
  p_intake_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_context record;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.project_id = p_project_id and intake.intake_id = p_intake_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'review_source');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  if p_decision not in ('accepted', 'rejected') then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"decision"}'::jsonb);
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(btrim(p_reason)) > 2000 then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"reason"}'::jsonb);
  end if;
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('decision', p_decision, 'intakeId', p_intake_id, 'reason', btrim(p_reason)));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'review_file_intake', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_context.organization_id and intake.project_id = p_project_id and intake.intake_id = p_intake_id
  for update;
  if p_decision = 'accepted' and v_intake.status <> 'clean' then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"CLEAN_SCAN_REQUIRED"}'::jsonb);
  end if;
  if p_decision = 'rejected' and v_intake.status not in ('clean', 'scan_failed', 'infected', 'scan_pending') then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"INVALID_INTAKE_STATE"}'::jsonb);
  end if;
  if p_decision = 'accepted' then
    update remhaos_integration.file_intakes
    set status = 'human_reviewed', review_decision = 'accepted', reviewed_at = statement_timestamp(), reviewed_by_user_id = v_context.actor_user_id
    where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
    perform remhaos_integration._record_file_intake_event(
      v_context.organization_id, p_project_id, p_intake_id, 'clean', 'human_reviewed', 'file_human_reviewed',
      'human', v_context.actor_id, v_context.actor_user_id, jsonb_build_object('decision', p_decision)
    );
    update remhaos_integration.file_intakes
    set status = 'ingested_candidate'
    where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
    perform remhaos_integration._record_file_intake_event(
      v_context.organization_id, p_project_id, p_intake_id, 'human_reviewed', 'ingested_candidate', 'file_candidate_ready',
      'human', v_context.actor_id, v_context.actor_user_id, '{}'
    );
  else
    update remhaos_integration.file_intakes
    set status = 'rejected', review_decision = 'rejected', reviewed_at = statement_timestamp(), reviewed_by_user_id = v_context.actor_user_id
    where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
    perform remhaos_integration._record_file_intake_event(
      v_context.organization_id, p_project_id, p_intake_id, v_intake.status, 'rejected', 'file_human_rejected',
      'human', v_context.actor_id, v_context.actor_user_id, jsonb_build_object('decision', p_decision)
    );
  end if;
  v_result := jsonb_build_object('intakeId', p_intake_id, 'status', case when p_decision = 'accepted' then 'ingested_candidate' else 'rejected' end, 'decision', p_decision);
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'review_file_intake', v_key_digest, v_request_digest,
    'human', v_context.actor_id, v_context.actor_user_id, v_result, 'file_intake_reviewed',
    'file_intake_reviewed', jsonb_build_object('decision', p_decision), null
  );
end
$function$;

-- Effective predecessor: 20260826023906_remhaos_file_intake_hardening.sql
create or replace function remhaos_integration_api.publish_file_intake(
  p_project_id uuid,
  p_intake_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_context record;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_source_id text;
  v_source_kind text;
  v_result jsonb;
begin
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.project_id = p_project_id and intake.intake_id = p_intake_id;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"file_intake"}'::jsonb);
  end if;
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'publish_baseline');
  perform remhaos_integration._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('intakeId', p_intake_id));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'publish_file_intake', v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where remhaos_integration._is_legacy_file_intake(intake.organization_id,intake.project_id,intake.intake_id) and intake.organization_id = v_context.organization_id and intake.project_id = p_project_id and intake.intake_id = p_intake_id
  for update;
  if v_intake.status <> 'ingested_candidate' then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"HUMAN_REVIEW_REQUIRED"}'::jsonb);
  end if;
  if exists (
    select 1 from project_intelligence.sources source
    where source.organization_id = v_context.organization_id and source.project_id = p_project_id and source.checksum = v_intake.checksum
  ) then
    perform remhaos_integration._raise('P1209', 'scope_conflict', '{"reason":"SOURCE_ALREADY_REGISTERED"}'::jsonb);
  end if;
  v_source_id := 'file-intake-' || p_intake_id::text;
  v_source_kind := remhaos_integration._file_intake_source_kind(v_intake.media_type, v_intake.extension);
  insert into project_intelligence.sources (
    organization_id, project_id, source_id, kind, checksum, storage_object_path
  ) values (
    v_context.organization_id, p_project_id, v_source_id, v_source_kind, v_intake.checksum, v_intake.internal_object_key
  );
  insert into projectceo_foundation.source_protected_metadata (
    organization_id, project_id, source_id, package_id, original_filename, media_type,
    size_bytes, extension, source_role, document_status
  ) values (
    v_context.organization_id, p_project_id, v_source_id, v_intake.package_id, v_intake.original_filename,
    v_intake.media_type, v_intake.size_bytes, v_intake.extension, v_intake.source_role, 'current'
  );
  update remhaos_integration.file_intakes
  set status = 'published_internal_copy', source_id = v_source_id,
      published_at = statement_timestamp(), published_by_user_id = v_context.actor_user_id
  where organization_id = v_context.organization_id and project_id = p_project_id and intake_id = p_intake_id;
  perform remhaos_integration._record_file_intake_event(
    v_context.organization_id, p_project_id, p_intake_id, 'ingested_candidate', 'published_internal_copy',
    'file_internal_copy_published', 'human', v_context.actor_id, v_context.actor_user_id,
    jsonb_build_object('source_id', v_source_id)
  );
  v_result := jsonb_build_object('intakeId', p_intake_id, 'sourceId', v_source_id, 'status', 'published_internal_copy');
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'publish_file_intake', v_key_digest, v_request_digest,
    'human', v_context.actor_id, v_context.actor_user_id, v_result, 'file_internal_copy_published',
    'file_internal_copy_published', jsonb_build_object('source_id', v_source_id), null
  );
end
$function$;

do $legacy_acl$ begin if (select count(*) from r1_legacy_intake_acl)<>10 or exists(select 1 from r1_legacy_intake_acl a left join pg_proc p on p.oid=a.oid where p.oid is null or p.proowner is distinct from a.proowner or p.proacl is distinct from a.proacl) then raise exception 'R1_LEGACY_INTAKE_PRIVILEGES_CHANGED'; end if; end $legacy_acl$;

do $registry$
declare operations text[]; definition text; literal_array text;
begin
 select pg_get_constraintdef(c.oid) into definition from pg_constraint c where c.conrelid='remhaos_integration.command_records'::regclass and c.conname='command_records_operation_check';
 literal_array:=(regexp_match(definition,$re$'(\{[^']+\})'$re$))[1];
 if literal_array is not null then operations:=literal_array::text[];
 else select array_agg(m[1]) into operations from regexp_matches(definition,$re$'([a-z0-9_]+)'$re$,'g') m; end if;
 if operations is null then raise exception 'MATERIALIZATION_COMMAND_REGISTRY_MISSING'; end if;
 alter table remhaos_integration.command_records drop constraint command_records_operation_check;
 execute format('alter table remhaos_integration.command_records add constraint command_records_operation_check check(operation=any(%L::text[]))',operations||array['materialize_external_generation']);
end $registry$;
do $security$
declare t text; f regprocedure;
begin
 foreach t in array array['external_generation_intake_links','external_asset_validation_lineage'] loop
  execute format('create trigger %I before update or delete on remhaos_integration.%I for each row execute function projectceo_foundation.reject_append_only_mutation()',t||'_append_only',t);
  execute format('alter table remhaos_integration.%I owner to pi_table_owner',t);
  execute format('alter table remhaos_integration.%I enable row level security',t);
  execute format('alter table remhaos_integration.%I force row level security',t);
  execute format('revoke all on remhaos_integration.%I from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',t);
  execute format('create policy %I on remhaos_integration.%I for all to pi_table_owner using(true) with check(true)',t||'_owner_only',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='remhaos_integration' and p.proname in ('_external_materialization_format','_external_intake_identity_guard','_is_legacy_file_intake','_assert_external_materialization','_external_materialization_constraint','_materialize_external_generation') loop
  execute format('alter function %s owner to pi_table_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',f);
 end loop;
end $security$;
commit;
