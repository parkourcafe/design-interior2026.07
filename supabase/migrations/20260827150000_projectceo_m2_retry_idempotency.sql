-- Keep request-bound M2 retries replayable after the server re-reads state.
-- `expected_state_revision` remains an optimistic-concurrency guard on a new
-- mutation, but it is transport state rather than semantic command identity.
-- This additive migration preserves the existing function bodies and removes
-- only that field from their request digests.

begin;

do $block$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'projectceo_product_api._append_m2_workspace_revision_v4(uuid,uuid,text,text,text,text,text,jsonb,text,bigint,text)'::regprocedure
  ) into v_definition;
  if position('''expectedStateRevision'', expected_state_revision, ''packageId''' in v_definition) = 0 then
    raise exception 'M2_RETRY_DIGEST_TARGET_NOT_FOUND: approved commit function';
  end if;
  v_definition := replace(
    v_definition,
    '''expectedStateRevision'', expected_state_revision, ''packageId''',
    '''packageId'''
  );
  if position('array_agg(key order by key)' in v_definition) = 0 then
    raise exception 'M2_APPROVED_COMMIT_SORT_TARGET_NOT_FOUND';
  end if;
  v_definition := replace(
    v_definition,
    'array_agg(key order by key)',
    'array_agg(key order by key collate "C")'
  );
  execute v_definition;

  select pg_get_functiondef(
    'projectceo_product_api.append_m2_workspace_revision(uuid,uuid,text,text,text,text,text,jsonb,text,bigint,text)'::regprocedure
  ) into v_definition;
  if position('''expectedStateRevision'', expected_state_revision, ''packageId''' in v_definition) = 0 then
    raise exception 'M2_RETRY_DIGEST_TARGET_NOT_FOUND: layout version function';
  end if;
  v_definition := replace(
    v_definition,
    '''expectedStateRevision'', expected_state_revision, ''packageId''',
    '''packageId'''
  );
  execute v_definition;

  select pg_get_functiondef(proc.oid) into v_definition
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'projectceo_product'
    and proc.proname = '_append_m2_cycle6_revision'
    and proc.prokind = 'f'
  limit 1;
  if v_definition is null then
    raise exception 'M2_RETRY_DIGEST_TARGET_NOT_FOUND: client review function';
  end if;
  if position('''reason'', p_reason, ''expectedStateRevision'', p_expected_state_revision' in v_definition) = 0 then
    raise exception 'M2_RETRY_DIGEST_TARGET_NOT_FOUND: client review function';
  end if;
  v_definition := replace(
    v_definition,
    '''reason'', p_reason, ''expectedStateRevision'', p_expected_state_revision',
    '''reason'', p_reason'
  );
  execute v_definition;
end
$block$;

commit;
