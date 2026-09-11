\set ON_ERROR_STOP on
-- Disposable-only fixtures; all approval/activation text is synthetic test data.
begin;
create function pg_temp.expect(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'DB4_CONSENT:%',p_message; end if; end;
$$;
create function pg_temp.denied(p_sql text,p_code text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlstate = p_code then return; end if; raise;
  end;
  raise exception 'DB4_CONSENT_UNEXPECTED_ALLOW:%',p_sql;
end;
$$;
select pg_temp.expect(not has_schema_privilege('anon','remhaos_legal','USAGE'),'anon schema');
select pg_temp.expect(not has_schema_privilege('authenticated','remhaos_legal','USAGE'),'auth schema');
select pg_temp.expect(not has_schema_privilege('service_role','remhaos_legal','USAGE'),'service schema');
select pg_temp.expect(not has_function_privilege('service_role','public.accept_my_consent(uuid,boolean,uuid)','EXECUTE'),'service human rpc');
select pg_temp.expect(not has_function_privilege('anon','public.accept_my_consent(uuid,boolean,uuid)','EXECUTE'),'anon account rpc');
select pg_temp.expect(not has_function_privilege('service_role','public.record_browser_consent(text,text,text,uuid,boolean,uuid)','EXECUTE'),'service browser rpc');
select pg_temp.expect(bool_and(c.relrowsecurity and c.relforcerowsecurity), 'force rls')
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='remhaos_legal' and c.relkind='r';
select pg_temp.expect(bool_and(coalesce(array_to_string(p.proconfig,','),'') ~ '(^|,)search_path=""(,|$)'), 'fixed paths')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='remhaos_legal';

set local role authenticated;
set local request.jwt.claim.sub = '';
select pg_temp.expect(not public.has_my_consent(), 'absent auth');
select pg_temp.expect(public.get_current_consent_document('account') is null, 'no seeded document');
reset role;
insert into public.projects(id,intake_token,intake_expires_at) values
 ('60000000-0000-4000-8000-000000000001','db4-consent-project-a',clock_timestamp()+interval '10 minutes'),
 ('60000000-0000-4000-8000-000000000002','db4-consent-project-b',null);
insert into remhaos_legal.document_versions(id,purpose,version,body,operator,status,effective_at,approved_at,approval_reference) values
 ('60000000-0000-4000-8000-000000000011','intake','fixture-1','TEST ONLY intake document','Synthetic test operator','approved','2020-01-01','2020-01-01','rolled back fixture'),
 ('60000000-0000-4000-8000-000000000012','account','fixture-1','TEST ONLY account document','Synthetic test operator','approved','2020-01-01','2020-01-01','rolled back fixture'),
 ('60000000-0000-4000-8000-000000000013','intake','fixture-2','TEST ONLY replacement document','Synthetic test operator','approved','2020-01-01','2020-01-01','rolled back fixture'),
 ('60000000-0000-4000-8000-000000000014','intake','draft','TEST ONLY draft document','Synthetic test operator','draft','2020-01-01',null,null),
 ('60000000-0000-4000-8000-000000000015','account','future','TEST ONLY future document','Synthetic test operator','approved','2999-01-01','2020-01-01','rolled back fixture');
select pg_temp.denied($q$insert into remhaos_legal.active_requirements values ('intake','60000000-0000-4000-8000-000000000014',600,'test')$q$,'22023');
select pg_temp.denied($q$insert into remhaos_legal.active_requirements values ('intake','60000000-0000-4000-8000-000000000012',600,'test')$q$,'22023');
insert into remhaos_legal.active_requirements values
 ('intake','60000000-0000-4000-8000-000000000011',600,'rolled back fixture'),
 ('account','60000000-0000-4000-8000-000000000012',600,'rolled back fixture');

set local role anon;
select pg_temp.denied('select * from remhaos_legal.receipts','42501');
select pg_temp.denied($q$select public.record_browser_consent('intake','db4-consent-project-a',repeat('a',64),'60000000-0000-4000-8000-000000000011',false,'60000000-0000-4000-8000-000000000031')$q$,'22023');
select pg_temp.denied($q$select public.record_browser_consent('intake','db4-consent-project-a',repeat('a',64),'60000000-0000-4000-8000-000000000011',null,'60000000-0000-4000-8000-000000000031')$q$,'22023');
select pg_temp.denied($q$select public.record_browser_consent('intake','db4-consent-project-a','bad','60000000-0000-4000-8000-000000000011',true,'60000000-0000-4000-8000-000000000031')$q$,'22023');
select pg_temp.denied($q$select public.record_browser_consent('intake','wrong-token',repeat('a',64),'60000000-0000-4000-8000-000000000011',true,'60000000-0000-4000-8000-000000000031')$q$,'42501');
select pg_temp.denied($q$select public.record_browser_consent('intake','db4-consent-project-a',repeat('a',64),'60000000-0000-4000-8000-000000000014',true,'60000000-0000-4000-8000-000000000031')$q$,'22023');
select pg_temp.expect(public.get_current_consent_document('intake')->>'operator'='Synthetic test operator','operator snapshot');
select pg_temp.expect(public.get_current_consent_document('intake')->>'sha256'=encode(sha256(convert_to('TEST ONLY intake document','UTF8')),'hex'),'document hash');
select public.record_browser_consent('intake','db4-consent-project-a',repeat('a',64),'60000000-0000-4000-8000-000000000011',true,'60000000-0000-4000-8000-000000000031') as receipt_a \gset
select pg_temp.expect(public.record_browser_consent('intake','db4-consent-project-a',repeat('a',64),'60000000-0000-4000-8000-000000000011',true,'60000000-0000-4000-8000-000000000031')=:'receipt_a'::jsonb,'idempotent exact replay');
select pg_temp.expect(public.has_browser_consent('intake','db4-consent-project-a',repeat('a',64)),'accepted browser');
select pg_temp.expect(not public.has_browser_consent('intake','db4-consent-project-a',repeat('b',64)),'second browser denied');
select pg_temp.expect(public.get_browser_consent_receipt('intake','db4-consent-project-a',repeat('b',64)) is null,'cross browser discovery');
select pg_temp.expect(public.get_browser_consent_receipt('intake','db4-consent-project-b',repeat('a',64)) is null,'cross project discovery');
select pg_temp.expect(public.get_browser_consent_receipt('intake','db4-consent-project-a',repeat('a',64))=:'receipt_a'::jsonb,'own discovery');
select pg_temp.expect(not public.has_browser_consent('intake','db4-consent-project-b',repeat('a',64)),'cross project denied');
select pg_temp.expect(not public.has_browser_consent('unknown','',repeat('a',64)),'unknown purpose');
select pg_temp.expect(not public.has_browser_consent('intake','db4-consent-project-a',null),'missing browser proof');
select pg_temp.denied($q$select public.record_browser_consent('intake','db4-consent-project-b',repeat('a',64),'60000000-0000-4000-8000-000000000011',true,'60000000-0000-4000-8000-000000000031')$q$,'22023');
select pg_temp.denied(format('select public.withdraw_browser_consent(%L,%L,%L,%L)','intake','db4-consent-project-a',repeat('b',64),(:'receipt_a'::jsonb->>'receiptId')),'42501');
select public.withdraw_browser_consent('intake','db4-consent-project-a',repeat('a',64),(:'receipt_a'::jsonb->>'receiptId')::uuid);
select public.withdraw_browser_consent('intake','db4-consent-project-a',repeat('a',64),(:'receipt_a'::jsonb->>'receiptId')::uuid);
select pg_temp.expect(not public.has_browser_consent('intake','db4-consent-project-a',repeat('a',64)),'withdrawn proof denied');
select pg_temp.denied($q$select public.record_browser_consent('intake','db4-consent-project-a',repeat('a',64),'60000000-0000-4000-8000-000000000011',true,'60000000-0000-4000-8000-000000000031')$q$,'22023');
select public.record_browser_consent('intake','db4-consent-project-a',repeat('a',64),'60000000-0000-4000-8000-000000000011',true,'60000000-0000-4000-8000-000000000032') as receipt_after \gset
select pg_temp.expect(public.has_browser_consent('intake','db4-consent-project-a',repeat('a',64)),'explicit reacceptance');
select public.record_browser_consent('account','',repeat('c',64),'60000000-0000-4000-8000-000000000012',true,'60000000-0000-4000-8000-000000000033');
select pg_temp.expect(public.has_browser_consent('account','',repeat('c',64)),'preauth browser receipt');
reset role;
select pg_temp.expect((select count(*)=1 from remhaos_legal.withdrawals),'withdrawal idempotency');
select pg_temp.expect((select expires_at <= p.intake_expires_at from remhaos_legal.receipts r join public.projects p on p.id=r.project_id where r.request_id='60000000-0000-4000-8000-000000000031'),'token expiry cap');
select pg_temp.denied($q$update remhaos_legal.document_versions set body='changed' where id='60000000-0000-4000-8000-000000000011'$q$,'42501');
select pg_temp.denied('delete from remhaos_legal.receipts','42501');
select pg_temp.denied('delete from remhaos_legal.withdrawals','42501');
select pg_temp.denied('truncate remhaos_legal.document_versions cascade','42501');
update remhaos_legal.active_requirements set document_id='60000000-0000-4000-8000-000000000013' where purpose='intake';
set local role anon;
select pg_temp.expect(not public.has_browser_consent('intake','db4-consent-project-a',repeat('a',64)),'document switch invalidates old receipt');
select pg_temp.expect(public.get_browser_consent_receipt('intake','db4-consent-project-a',repeat('a',64)) is not null,'discovery survives document replacement');
reset role;
update remhaos_legal.active_requirements set document_id='60000000-0000-4000-8000-000000000011' where purpose='intake';
update public.projects set intake_token='db4-consent-rotated' where id='60000000-0000-4000-8000-000000000001';
set local role anon;
select pg_temp.expect(not public.has_browser_consent('intake','db4-consent-project-a',repeat('a',64)),'old token rotation');
select pg_temp.expect(not public.has_browser_consent('intake','db4-consent-rotated',repeat('a',64)),'new token cannot inherit receipt');
select pg_temp.expect(public.get_browser_consent_receipt('intake','db4-consent-project-a',repeat('a',64))=:'receipt_after'::jsonb,'withdrawal discovery survives token rotation');
reset role;
delete from public.projects where id='60000000-0000-4000-8000-000000000001';
set local role anon;
select pg_temp.expect(public.get_browser_consent_receipt('intake','db4-consent-project-a',repeat('a',64))=:'receipt_after'::jsonb,'withdrawal discovery survives project deletion');
select public.withdraw_browser_consent('intake','db4-consent-project-a',repeat('a',64),(:'receipt_after'::jsonb->>'receiptId')::uuid);
select pg_temp.expect(public.get_browser_consent_receipt('intake','db4-consent-project-a',repeat('a',64)) is null,'withdrawn tombstone hidden');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000041';
select pg_temp.expect(not public.has_my_consent(),'preauth cannot stand in for authenticated receipt');
select public.accept_my_consent('60000000-0000-4000-8000-000000000012',true,'60000000-0000-4000-8000-000000000034') as receipt_user \gset
select pg_temp.expect(public.has_my_consent(),'authenticated acceptance');
select pg_temp.expect(public.get_my_consent_receipt()=:'receipt_user'::jsonb,'authenticated discovery');
select pg_temp.expect(public.accept_my_consent('60000000-0000-4000-8000-000000000012',true,'60000000-0000-4000-8000-000000000034')=:'receipt_user'::jsonb,'authenticated replay');
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000042';
select pg_temp.expect(not public.has_my_consent(),'cross user gate');
select pg_temp.expect(public.get_my_consent_receipt() is null,'cross user discovery');
select pg_temp.denied(format('select public.withdraw_my_consent(%L)',(:'receipt_user'::jsonb->>'receiptId')),'42501');
select pg_temp.denied($q$select public.accept_my_consent('60000000-0000-4000-8000-000000000012',true,'60000000-0000-4000-8000-000000000034')$q$,'22023');
set local request.jwt.claim.sub = '60000000-0000-4000-8000-000000000041';
select public.withdraw_my_consent((:'receipt_user'::jsonb->>'receiptId')::uuid);
select public.withdraw_my_consent((:'receipt_user'::jsonb->>'receiptId')::uuid);
select pg_temp.expect(not public.has_my_consent(),'authenticated withdrawal');
reset role;
set local role anon;
do $$
begin
  for i in 1..10 loop
    perform public.record_browser_consent('account','',repeat('e',64),'60000000-0000-4000-8000-000000000012',true,gen_random_uuid());
  end loop;
end;
$$;
select pg_temp.denied($q$select public.record_browser_consent('account','',repeat('e',64),'60000000-0000-4000-8000-000000000012',true,gen_random_uuid())$q$,'P0429');
reset role;
-- Deterministic expired fixture does not mutate a receipt or sleep in the suite.
insert into remhaos_legal.receipts(request_id,purpose,document_id,subject_kind,browser_hash,accepted_at,expires_at)
values ('60000000-0000-4000-8000-000000000035','account','60000000-0000-4000-8000-000000000012','preauth',repeat('d',64),'2020-01-01','2020-01-02');
set local role anon;
select pg_temp.expect(not public.has_browser_consent('account','',repeat('d',64)),'expired browser receipt');
select pg_temp.denied($q$select public.record_browser_consent('account','',repeat('d',64),'60000000-0000-4000-8000-000000000012',true,'60000000-0000-4000-8000-000000000035')$q$,'22023');
reset role;
update remhaos_legal.active_requirements set document_id='60000000-0000-4000-8000-000000000015' where purpose='account';
set local role authenticated;
select pg_temp.expect(public.get_current_consent_document('account') is null,'future document not effective');
select pg_temp.expect(not public.has_my_consent(),'future requirement denies');
select pg_temp.denied($q$select public.accept_my_consent('60000000-0000-4000-8000-000000000015',true,'60000000-0000-4000-8000-000000000036')$q$,'22023');
reset role;
rollback;
select 'DB4_CONSENT_RECEIPTS_OK' as result;
