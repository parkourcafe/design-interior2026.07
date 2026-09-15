begin;

-- Additive closure correction; the original slice-A migration is immutable.
-- State pairs: open/finalizing -> reserved; finalized -> committed with
-- generation/claim/outbox closure; cancelled/expired/failed -> orphaned with
-- revoke/reconcile closure. Deferred checks preserve atomic multi-row commands.
create or replace function remhaos_integration._external_upload_terminal_consistency()
returns trigger language plpgsql security definer set search_path='' as $f$
declare s remhaos_integration.external_upload_sessions%rowtype; r remhaos_integration.external_upload_reservations%rowtype; g remhaos_integration.external_upload_generations%rowtype;
begin
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and session_id=new.session_id;
 select * into strict r from remhaos_integration.external_upload_reservations where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and reservation_id=s.reservation_id;
 select * into g from remhaos_integration.external_upload_generations where organization_id=s.organization_id and project_id=s.project_id and package_id=s.package_id and session_id=s.session_id;
 -- Every session state has exactly one reservation state in slice A.
 -- The reservation trigger below closes the reverse direction too, even when
 -- this transaction never updates the session or inserts a generation.
 if s.state in ('open','finalizing') and r.state<>'reserved' then
  raise exception 'UPLOAD_ACTIVE_RESERVATION_NOT_RESERVED';
 end if;
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

create constraint trigger external_upload_reservation_closure
 after insert or update on remhaos_integration.external_upload_reservations
 deferrable initially deferred for each row
 execute function remhaos_integration._external_upload_terminal_consistency();

alter function remhaos_integration._external_upload_terminal_consistency() owner to pi_table_owner;
revoke all on function remhaos_integration._external_upload_terminal_consistency()
 from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

commit;
