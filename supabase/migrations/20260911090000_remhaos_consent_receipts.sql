-- S-MIG #7: repository/disposable consent evidence. No legal text, activation,
-- retention period, shared Auth configuration, or production approval is seeded.
begin;

create role remhaos_legal_owner nologin noinherit nobypassrls;
grant remhaos_legal_owner to postgres;
create schema remhaos_legal authorization remhaos_legal_owner;
revoke all on schema remhaos_legal from public, anon, authenticated, service_role;
grant usage on schema public to remhaos_legal_owner;
-- Only the isolated definer can resolve an intake capability. This is not a
-- human/service-role grant and does not expose project rows through PostgREST.
grant select (id, intake_token, intake_expires_at) on public.projects to remhaos_legal_owner;
create policy projects_legal_token_lookup on public.projects
  for select to remhaos_legal_owner using (true);

create table remhaos_legal.document_versions (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('intake', 'account')),
  version text not null check (btrim(version) <> ''),
  body text not null check (btrim(body) <> ''),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  operator text not null check (btrim(operator) <> ''),
  status text not null check (status in ('draft', 'approved')),
  effective_at timestamptz not null,
  approved_at timestamptz,
  approval_reference text,
  check (status <> 'approved' or (approved_at is not null and nullif(btrim(approval_reference), '') is not null)),
  unique (purpose, version)
);
-- convert_to is STABLE in PostgreSQL, so compute the immutable UTF-8 body
-- snapshot hash on INSERT rather than falsely marking a wrapper IMMUTABLE.
create function remhaos_legal._document_hash() returns trigger language plpgsql
set search_path = '' as $$
begin new.sha256 := encode(sha256(convert_to(new.body, 'UTF8')), 'hex'); return new; end;
$$;
create trigger document_hash before insert on remhaos_legal.document_versions
  for each row execute function remhaos_legal._document_hash();
create table remhaos_legal.active_requirements (
  purpose text primary key check (purpose in ('intake', 'account')),
  document_id uuid not null references remhaos_legal.document_versions(id),
  browser_ttl_seconds integer not null check (browser_ttl_seconds > 0),
  activation_reference text not null check (btrim(activation_reference) <> '')
);
create table remhaos_legal.receipts (
  ordinal bigint generated always as identity unique,
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  purpose text not null check (purpose in ('intake', 'account')),
  document_id uuid not null references remhaos_legal.document_versions(id),
  subject_kind text not null check (subject_kind in ('intake', 'preauth', 'authenticated')),
  actor_id uuid,
  project_id uuid,
  token_hash text,
  browser_hash text,
  accepted_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  check (
    (subject_kind = 'intake' and purpose = 'intake' and actor_id is null and project_id is not null
      and token_hash ~ '^[0-9a-f]{64}$' and browser_hash ~ '^[0-9a-f]{64}$'
      and token_hash is not null and browser_hash is not null and expires_at is not null)
    or (subject_kind = 'preauth' and purpose = 'account' and actor_id is null and project_id is null
      and token_hash is null and browser_hash ~ '^[0-9a-f]{64}$' and browser_hash is not null and expires_at is not null)
    or (subject_kind = 'authenticated' and purpose = 'account' and actor_id is not null and project_id is null
      and token_hash is null and browser_hash is null and expires_at is null)
  ),
  check (expires_at is null or expires_at > accepted_at)
);
create index receipts_subject_lookup on remhaos_legal.receipts
  (purpose, document_id, subject_kind, actor_id, browser_hash, accepted_at desc);
create index receipts_append_budget on remhaos_legal.receipts (subject_kind, accepted_at desc);
create table remhaos_legal.withdrawals (
  receipt_id uuid primary key references remhaos_legal.receipts(id),
  withdrawn_at timestamptz not null default clock_timestamp()
);

create function remhaos_legal._immutable() returns trigger language plpgsql
set search_path = '' as $$
begin raise exception using errcode = '42501', message = 'consent_evidence_immutable'; end;
$$;
create trigger immutable_document before update or delete on remhaos_legal.document_versions
  for each row execute function remhaos_legal._immutable();
create trigger immutable_receipt before update or delete on remhaos_legal.receipts
  for each row execute function remhaos_legal._immutable();
create trigger immutable_withdrawal before update or delete on remhaos_legal.withdrawals
  for each row execute function remhaos_legal._immutable();

create trigger immutable_document_truncate before truncate on remhaos_legal.document_versions
  for each statement execute function remhaos_legal._immutable();
create trigger immutable_receipt_truncate before truncate on remhaos_legal.receipts
  for each statement execute function remhaos_legal._immutable();
create trigger immutable_withdrawal_truncate before truncate on remhaos_legal.withdrawals
  for each statement execute function remhaos_legal._immutable();

create function remhaos_legal._validate_activation() returns trigger language plpgsql
set search_path = '' as $$
begin
  if not exists (select 1 from remhaos_legal.document_versions d where d.id = new.document_id
    and d.purpose = new.purpose and d.status = 'approved') then
    raise exception using errcode = '22023', message = 'approved_consent_document_required';
  end if;
  return new;
end;
$$;
create trigger validate_activation before insert or update on remhaos_legal.active_requirements
  for each row execute function remhaos_legal._validate_activation();

-- Auth identity is derived from the gateway's signed request claims. This avoids
-- requiring new grants on the managed auth schema (same contract as auth.uid()).
create function remhaos_legal._actor() returns uuid language sql stable
set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

create function public.get_current_consent_document(p_purpose text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'purpose', d.purpose, 'version', d.version,
    'sha256', d.sha256, 'body', d.body, 'operator', d.operator)
  from remhaos_legal.active_requirements a join remhaos_legal.document_versions d on d.id = a.document_id
  where a.purpose = p_purpose and d.purpose = p_purpose and d.status = 'approved'
    and d.effective_at <= clock_timestamp();
$$;

-- Private shared implementation. Browser hashes are capabilities and never
-- appear in return values. Raw intake tokens are never persisted here.
create function remhaos_legal._record(p_purpose text, p_kind text, p_token text,
  p_browser_hash text, p_document_id uuid, p_accepted boolean, p_request_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor uuid; v_project uuid; v_token_hash text; v_token_expiry timestamptz;
  v_ttl integer; v_now timestamptz; v_expiry timestamptz; v_receipt remhaos_legal.receipts;
begin
  if p_accepted is distinct from true or p_request_id is null or p_document_id is null then
    raise exception using errcode = '22023', message = 'explicit_consent_required';
  end if;
  if p_kind = 'authenticated' then
    v_actor := remhaos_legal._actor();
    if v_actor is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  elsif p_browser_hash is null or p_browser_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'browser_proof_required';
  end if;
  if p_purpose = 'intake' and p_kind = 'intake' then
    select id, intake_expires_at into v_project, v_token_expiry from public.projects
      where intake_token = p_token and (intake_expires_at is null or intake_expires_at > clock_timestamp());
    if v_project is null then raise exception using errcode = '42501', message = 'invalid_intake_capability'; end if;
    v_token_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  elsif p_purpose <> 'account' or p_kind not in ('preauth', 'authenticated') or nullif(p_token, '') is not null then
    raise exception using errcode = '22023', message = 'invalid_consent_scope';
  end if;
  select a.browser_ttl_seconds into v_ttl from remhaos_legal.active_requirements a
    join remhaos_legal.document_versions d on d.id = a.document_id
    where a.purpose = p_purpose and a.document_id = p_document_id and d.purpose = p_purpose
      and d.status = 'approved' and d.effective_at <= clock_timestamp() for share of a;
  if v_ttl is null then raise exception using errcode = '22023', message = 'active_consent_document_required'; end if;
  -- Serialize command-ID reuse, then subject acceptance/withdrawal. Shared lock
  -- order prevents replay/withdrawal deadlocks. No retained raw proof or PII.
  perform pg_advisory_xact_lock(hashtextextended('legal-request:' || p_request_id::text, 0));
  if v_project is not null then
    perform pg_advisory_xact_lock(hashtextextended('legal-intake:' || v_project::text, 0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('legal-subject:' || p_kind || ':' ||
    coalesce(v_actor::text, p_browser_hash) || ':' || coalesce(v_project::text, ''), 0));
  select * into v_receipt from remhaos_legal.receipts where request_id = p_request_id;
  if found then
    if v_receipt.purpose is distinct from p_purpose or v_receipt.document_id is distinct from p_document_id
      or v_receipt.subject_kind is distinct from p_kind or v_receipt.actor_id is distinct from v_actor
      or v_receipt.project_id is distinct from v_project or v_receipt.token_hash is distinct from v_token_hash
      or v_receipt.browser_hash is distinct from p_browser_hash then
      raise exception using errcode = '22023', message = 'consent_request_conflict';
    end if;
    if (v_receipt.expires_at is not null and v_receipt.expires_at <= clock_timestamp())
      or exists (select 1 from remhaos_legal.withdrawals where receipt_id = v_receipt.id) then
      raise exception using errcode = '22023', message = 'consent_request_no_longer_active';
    end if;
  else
    -- Operational append budget, NOT legal retention. Replays do not consume
    -- it. Intake is capped across browser proofs; preauth needs perimeter rate
    -- limiting too because anonymous callers can create new browser proofs.
    if (select count(*) from remhaos_legal.receipts r where r.subject_kind = p_kind
      and r.accepted_at > clock_timestamp() - interval '1 minute'
      and ((p_kind = 'intake' and r.project_id = v_project)
        or (p_kind = 'authenticated' and r.actor_id = v_actor)
        or (p_kind = 'preauth' and r.browser_hash = p_browser_hash))) >= 10 then
      raise exception using errcode = 'P0429', message = 'consent_rate_limited';
    end if;
    v_now := clock_timestamp();
    if p_kind <> 'authenticated' then
      v_expiry := least(v_now + make_interval(secs => v_ttl), v_token_expiry);
      if v_expiry <= v_now then raise exception using errcode = '42501', message = 'invalid_intake_capability'; end if;
    end if;
    insert into remhaos_legal.receipts(request_id, purpose, document_id, subject_kind, actor_id,
      project_id, token_hash, browser_hash, accepted_at, expires_at)
    values(p_request_id, p_purpose, p_document_id, p_kind, v_actor, v_project, v_token_hash,
      p_browser_hash, v_now, v_expiry) returning * into v_receipt;
  end if;
  return jsonb_build_object('receiptId', v_receipt.id, 'acceptedAt', v_receipt.accepted_at, 'expiresAt', v_receipt.expires_at);
end;
$$;

create function public.record_browser_consent(p_purpose text,p_token text,p_browser_hash text,
  p_document_id uuid,p_accepted boolean,p_request_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select remhaos_legal._record(p_purpose, case when p_purpose = 'intake' then 'intake' else 'preauth' end,
    p_token, p_browser_hash, p_document_id, p_accepted, p_request_id);
$$;
create function public.accept_my_consent(p_document_id uuid,p_accepted boolean,p_request_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select remhaos_legal._record('account', 'authenticated', null, null, p_document_id, p_accepted, p_request_id);
$$;

create function remhaos_legal._latest(p_purpose text, p_kind text, p_token text, p_browser_hash text, p_current boolean default true)
returns remhaos_legal.receipts language plpgsql set search_path = '' as $$
declare v_actor uuid; v_project uuid; v_token_hash text; v_document uuid; v_receipt remhaos_legal.receipts;
begin
  if p_kind = 'authenticated' then
    v_actor := remhaos_legal._actor();
    if v_actor is null then return null; end if;
  elsif p_browser_hash is null or p_browser_hash !~ '^[0-9a-f]{64}$' then return null;
  end if;
  if p_purpose = 'intake' and p_kind = 'intake' then
    if p_token is null or p_token = '' then return null; end if;
    if p_current then
      select id into v_project from public.projects where intake_token = p_token
        and (intake_expires_at is null or intake_expires_at > clock_timestamp());
      if v_project is null then return null; end if;
    end if;
    v_token_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  elsif p_purpose <> 'account' or p_kind not in ('preauth', 'authenticated') or nullif(p_token, '') is not null then
    return null;
  end if;
  select a.document_id into v_document from remhaos_legal.active_requirements a
    join remhaos_legal.document_versions d on d.id = a.document_id where a.purpose = p_purpose
    and d.status = 'approved' and d.purpose = p_purpose and d.effective_at <= clock_timestamp();
  if p_current and v_document is null then return null; end if;
  -- Only the latest acceptance counts: withdrawing it cannot resurrect an older
  -- receipt, even if multiple explicit acceptances exist for this subject.
  select r.* into v_receipt from remhaos_legal.receipts r where (not p_current or r.document_id = v_document)
    and r.purpose = p_purpose and r.subject_kind = p_kind and r.actor_id is not distinct from v_actor
    and ((not p_current and p_kind = 'intake') or r.project_id is not distinct from v_project)
    and r.token_hash is not distinct from v_token_hash
    and (p_current or not exists (select 1 from remhaos_legal.withdrawals w where w.receipt_id = r.id))
    and r.browser_hash is not distinct from p_browser_hash
    order by r.ordinal desc limit 1;
  return v_receipt;
end;
$$;
create function remhaos_legal._active(p_receipt remhaos_legal.receipts) returns boolean
language sql set search_path = '' as $$
  select p_receipt.id is not null and (p_receipt.expires_at is null or p_receipt.expires_at > clock_timestamp())
    and not exists (select 1 from remhaos_legal.withdrawals where receipt_id = p_receipt.id);
$$;
create function public.has_browser_consent(p_purpose text,p_token text,p_browser_hash text) returns boolean
language sql security definer set search_path = '' as $$
  select remhaos_legal._active(remhaos_legal._latest(p_purpose,
    case when p_purpose = 'intake' then 'intake' else 'preauth' end, p_token, p_browser_hash));
$$;
create function public.has_my_consent() returns boolean language sql security definer set search_path = '' as $$
  select remhaos_legal._active(remhaos_legal._latest('account', 'authenticated', null, null));
$$;

-- Withdrawal discovery is purpose/subject-bound but does not depend on the
-- currently active document; policy replacement must not strand old receipts.
create function remhaos_legal._receipt_json(p_receipt remhaos_legal.receipts) returns jsonb
language sql set search_path = '' as $$
  select case when p_receipt.id is not null and not exists (
    select 1 from remhaos_legal.withdrawals where receipt_id = p_receipt.id)
    then jsonb_build_object('receiptId',p_receipt.id,'acceptedAt',p_receipt.accepted_at,'expiresAt',p_receipt.expires_at)
    else null end;
$$;
create function public.get_browser_consent_receipt(p_purpose text,p_token text,p_browser_hash text) returns jsonb
language sql security definer set search_path = '' as $$
  select remhaos_legal._receipt_json(remhaos_legal._latest(p_purpose,
    case when p_purpose = 'intake' then 'intake' else 'preauth' end,p_token,p_browser_hash,false));
$$;
create function public.get_my_consent_receipt() returns jsonb
language sql security definer set search_path = '' as $$
  select remhaos_legal._receipt_json(remhaos_legal._latest('account','authenticated',null,null,false));
$$;

create function remhaos_legal._withdraw(p_purpose text,p_kind text,p_token text,p_browser_hash text,p_receipt_id uuid)
returns void language plpgsql set search_path = '' as $$
declare v_actor uuid; v_project uuid; v_token_hash text; v_receipt remhaos_legal.receipts;
begin
  if p_kind = 'authenticated' then
    v_actor := remhaos_legal._actor();
    if v_actor is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  elsif p_browser_hash is null or p_browser_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'invalid_consent_capability';
  end if;
  if p_purpose = 'intake' and p_kind = 'intake' then
    -- Revocation of the intake link must not revoke the right to withdraw.
    -- Only the receipt's two stored capability hashes authorize this operation.
    v_token_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
    select project_id into v_project from remhaos_legal.receipts where id = p_receipt_id
      and token_hash = v_token_hash and browser_hash = p_browser_hash and subject_kind = 'intake';
    if v_project is null then raise exception using errcode = '42501', message = 'invalid_consent_capability'; end if;
  elsif p_purpose <> 'account' or p_kind not in ('preauth','authenticated') or nullif(p_token,'') is not null then
    raise exception using errcode = '42501', message = 'invalid_consent_scope';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('legal-subject:' || p_kind || ':' ||
    coalesce(v_actor::text, p_browser_hash) || ':' || coalesce(v_project::text, ''), 0));
  select * into v_receipt from remhaos_legal.receipts where id = p_receipt_id;
  if not found or v_receipt.purpose is distinct from p_purpose or v_receipt.subject_kind is distinct from p_kind
    or v_receipt.actor_id is distinct from v_actor or v_receipt.project_id is distinct from v_project
    or v_receipt.token_hash is distinct from v_token_hash or v_receipt.browser_hash is distinct from p_browser_hash then
    raise exception using errcode = '42501', message = 'invalid_consent_capability';
  end if;
  -- Withdrawal remains possible after document replacement or proof expiry when
  -- the caller still proves its stored scope, even after project deletion; expiry
  -- never extends use authorization.
  insert into remhaos_legal.withdrawals(receipt_id) values(v_receipt.id) on conflict do nothing;
end;
$$;
create function public.withdraw_my_consent(p_receipt_id uuid) returns void
language sql security definer set search_path = '' as $$
  select remhaos_legal._withdraw('account','authenticated',null,null,p_receipt_id);
$$;
create function public.withdraw_browser_consent(p_purpose text,p_token text,p_browser_hash text,p_receipt_id uuid)
returns void language sql security definer set search_path = '' as $$
  select remhaos_legal._withdraw(p_purpose,case when p_purpose = 'intake' then 'intake' else 'preauth' end,
    p_token,p_browser_hash,p_receipt_id);
$$;

-- Definer-only private objects. The app cannot activate policies or inspect
-- receipts; authenticated human operations have no service-role grant.
do $$
declare t text; f record;
begin
  foreach t in array array['document_versions','active_requirements','receipts','withdrawals'] loop
    execute format('alter table remhaos_legal.%I owner to remhaos_legal_owner', t);
    execute format('alter table remhaos_legal.%I enable row level security', t);
    execute format('alter table remhaos_legal.%I force row level security', t);
    execute format('create policy legal_owner on remhaos_legal.%I for all to remhaos_legal_owner using (true) with check (true)', t);
    execute format('revoke all on remhaos_legal.%I from public, anon, authenticated, service_role', t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'remhaos_legal' or (n.nspname = 'public' and p.proname in
      ('get_current_consent_document','record_browser_consent','has_browser_consent','accept_my_consent',
       'has_my_consent','withdraw_my_consent','withdraw_browser_consent','get_browser_consent_receipt','get_my_consent_receipt')) loop
    execute format('alter function %s owner to remhaos_legal_owner', f.signature);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
  end loop;
end;
$$;
grant execute on function public.get_current_consent_document(text),
  public.record_browser_consent(text,text,text,uuid,boolean,uuid),
  public.get_browser_consent_receipt(text,text,text),public.has_browser_consent(text,text,text),public.withdraw_browser_consent(text,text,text,uuid) to anon, authenticated;
grant execute on function public.accept_my_consent(uuid,boolean,uuid),
  public.get_my_consent_receipt(),public.has_my_consent(),public.withdraw_my_consent(uuid) to authenticated;
commit;
