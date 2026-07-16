\set ON_ERROR_STOP on

-- Append-only enforcement is behavioral, not merely a trigger-presence check.
do $append_only_update$
begin
  begin
    update project_intelligence.graph_node_revisions
    set title = 'Mutation must be rejected'
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000001'
      and revision_id = 'decision-r1';
    raise exception 'DB2_EXPECTED_APPEND_ONLY_UPDATE_FAILURE';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'PROJECT_INTELLIGENCE_APPEND_ONLY' then
        raise;
      end if;
  end;
end
$append_only_update$;

do $append_only_delete$
begin
  begin
    delete from project_intelligence.graph_node_revisions
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000001'
      and revision_id = 'decision-r1';
    raise exception 'DB2_EXPECTED_APPEND_ONLY_DELETE_FAILURE';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'PROJECT_INTELLIGENCE_APPEND_ONLY' then
        raise;
      end if;
  end;
end
$append_only_delete$;

-- Failure after the domain insert must roll back the domain row, command,
-- audit event and state increment as one statement-level subtransaction.
do $rollback$
begin
  perform set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    true
  );
  perform set_config(
    'project_intelligence.test_fail_after_domain',
    'on',
    true
  );

  begin
    perform project_intelligence_api.review_claim(
      '10000000-0000-4000-8000-000000000006',
      'decision-r1',
      'decision-r1',
      0,
      'confirmed',
      'rollback-injected'
    );
    raise exception 'DB2_EXPECTED_INJECTED_FAILURE';
  exception
    when sqlstate 'P1011' then
      if sqlerrm <> 'DOMAIN_CONTRACT_VIOLATION' then
        raise;
      end if;
  end;

  perform set_config(
    'project_intelligence.test_fail_after_domain',
    'off',
    true
  );

  if not exists (
    select 1
    from project_intelligence.project_workflows
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000006'
      and state_revision = 0
  ) or exists (
    select 1
    from project_intelligence.human_reviews
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1
    from project_intelligence.command_records
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1
    from project_intelligence.audit_events
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000006'
  ) then
    raise exception 'DB2_INJECTED_FAILURE_DID_NOT_ROLL_BACK';
  end if;
end
$rollback$;

-- Durable idempotency semantics: success, different-digest conflict, then stale
-- CAS under another key. Rejected calls must not change any persistence count.
do $idempotency_and_cas$
declare
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  perform set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    true
  );

  v_result := project_intelligence_api.review_claim(
    '10000000-0000-4000-8000-000000000006',
    'decision-r1',
    'decision-r1',
    0,
    'confirmed',
    'rollback-success'
  );
  if (v_result ->> 'replay')::boolean
     or (v_result ->> 'stateRevision')::bigint <> 1 then
    raise exception 'DB2_IDEMPOTENT_SUCCESS_RESULT:%', v_result;
  end if;

  select jsonb_build_object(
    'state', pw.state_revision,
    'reviews', (
      select count(*)
      from project_intelligence.human_reviews hr
      where hr.organization_id = pw.organization_id
        and hr.project_id = pw.project_id
    ),
    'commands', (
      select count(*)
      from project_intelligence.command_records cr
      where cr.organization_id = pw.organization_id
        and cr.project_id = pw.project_id
    ),
    'audit', (
      select count(*)
      from project_intelligence.audit_events ae
      where ae.organization_id = pw.organization_id
        and ae.project_id = pw.project_id
    )
  )
  into v_before
  from project_intelligence.project_workflows pw
  where pw.organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and pw.project_id = '10000000-0000-4000-8000-000000000006';

  begin
    perform project_intelligence_api.review_claim(
      '10000000-0000-4000-8000-000000000006',
      'decision-r1',
      'decision-r1',
      0,
      'rejected',
      'rollback-success'
    );
    raise exception 'DB2_EXPECTED_IDEMPOTENCY_CONFLICT';
  exception
    when sqlstate 'P1007' then
      if sqlerrm <> 'IDEMPOTENCY_CONFLICT' then
        raise;
      end if;
  end;

  begin
    perform project_intelligence_api.review_claim(
      '10000000-0000-4000-8000-000000000006',
      'decision-r1',
      'decision-r1',
      0,
      'confirmed',
      'rollback-stale-new-key'
    );
    raise exception 'DB2_EXPECTED_STATE_STALE';
  exception
    when sqlstate 'P1006' then
      if sqlerrm <> 'STATE_STALE' then
        raise;
      end if;
  end;

  select jsonb_build_object(
    'state', pw.state_revision,
    'reviews', (
      select count(*)
      from project_intelligence.human_reviews hr
      where hr.organization_id = pw.organization_id
        and hr.project_id = pw.project_id
    ),
    'commands', (
      select count(*)
      from project_intelligence.command_records cr
      where cr.organization_id = pw.organization_id
        and cr.project_id = pw.project_id
    ),
    'audit', (
      select count(*)
      from project_intelligence.audit_events ae
      where ae.organization_id = pw.organization_id
        and ae.project_id = pw.project_id
    )
  )
  into v_after
  from project_intelligence.project_workflows pw
  where pw.organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and pw.project_id = '10000000-0000-4000-8000-000000000006';

  if v_after is distinct from v_before
     or v_after <> '{"audit":1,"commands":1,"reviews":1,"state":1}'::jsonb then
    raise exception 'DB2_REJECTED_COMMAND_MUTATED_STATE:%:%', v_before, v_after;
  end if;
end
$idempotency_and_cas$;

-- A worker identity cannot invoke any human mutation. Dynamic SQL makes the
-- privilege failure catchable inside the test block.
begin;
set local role service_role;
do $worker_cannot_review$
begin
  begin
    execute $sql$
      select project_intelligence_api.review_claim(
        '10000000-0000-4000-8000-000000000002',
        'decision-r1',
        'decision-r1',
        0,
        'confirmed',
        'worker-must-not-review'
      )
    $sql$;
    raise exception 'DB2_WORKER_EXECUTED_HUMAN_OPERATION';
  exception
    when insufficient_privilege then
      null;
  end;
end
$worker_cannot_review$;
rollback;

-- FORCE RLS must expose only the active member's organization even to the
-- executor roles that own the security-definer RPCs.
begin;
set local role pi_human_executor;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
do $owner_rls$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from project_intelligence.project_workflows;
  if v_count <> 6 then
    raise exception 'DB2_OWNER_RLS_COUNT:%', v_count;
  end if;
end
$owner_rls$;
rollback;

begin;
set local role pi_human_executor;
set local request.jwt.claim.sub =
  '22222222-2222-4222-8222-222222222222';
do $outsider_rls$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from project_intelligence.project_workflows;
  if v_count <> 1 then
    raise exception 'DB2_OUTSIDER_RLS_COUNT:%', v_count;
  end if;
end
$outsider_rls$;
rollback;

-- RLS write isolation: org-A actor cannot append a review under org B.
begin;
set local role pi_human_executor;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';
do $cross_org_write_rls$
begin
  begin
    insert into project_intelligence.human_reviews (
      organization_id,
      project_id,
      review_id,
      target_revision_id,
      decision,
      actor_user_id
    )
    values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '20000000-0000-4000-8000-000000000001',
      'cross-org-rls-review',
      'decision-r1',
      'confirmed',
      '11111111-1111-4111-8111-111111111111'
    );
    raise exception 'DB2_CROSS_ORG_RLS_WRITE_SUCCEEDED';
  exception
    when insufficient_privilege then
      null;
  end;
end
$cross_org_write_rls$;
rollback;

-- Composite child FKs reject cross-project references even for a superuser
-- that bypasses RLS.
do $cross_org_fk$
begin
  begin
    insert into project_intelligence.graph_edges (
      organization_id,
      project_id,
      edge_id,
      from_node_id,
      to_node_id,
      relation
    )
    values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '20000000-0000-4000-8000-000000000001',
      'cross-org-fk-edge',
      'decision-main',
      'deliverable-main',
      'depends_on'
    );
    raise exception 'DB2_CROSS_ORG_FK_INSERT_SUCCEEDED';
  exception
    when foreign_key_violation then
      null;
  end;

  if exists (
    select 1
    from project_intelligence.graph_edges
    where organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and project_id = '20000000-0000-4000-8000-000000000001'
      and edge_id = 'cross-org-fk-edge'
  ) then
    raise exception 'DB2_CROSS_ORG_FK_ROW_PERSISTED';
  end if;
end
$cross_org_fk$;

select 'DB2_SECURITY_ROLLBACK_AND_ISOLATION_OK' as result;

-- Version snapshots, evidence projections and logical handoffs are append-only.
-- A snapshot may be inserted only by the owning operation, then must never be
-- rewritten or deleted.  A second handoff for the same semantic payload is
-- rejected by the version/run/digest key (a retry must use the original
-- idempotency key and replay the command instead).
do $snapshot_immutability$
declare
  v_version_id text;
  v_evidence_id text;
  v_handoff_id text;
  v_failed boolean;
begin
  select version_id into v_version_id
  from project_intelligence.version_nodes
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and project_id = '10000000-0000-4000-8000-000000000001'
  order by version_id collate "C"
  limit 1;
  select evidence_link_id into v_evidence_id
  from project_intelligence.version_evidence_links
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and project_id = '10000000-0000-4000-8000-000000000001'
  limit 1;
  select handoff_id into v_handoff_id
  from project_intelligence.logical_handoffs
  where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and project_id = '10000000-0000-4000-8000-000000000001'
  limit 1;

  v_failed := false;
  begin
    update project_intelligence.version_nodes
    set revision_id = revision_id
    where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and project_id = '10000000-0000-4000-8000-000000000001'
      and version_id = v_version_id;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'DB2_VERSION_SNAPSHOT_UPDATE_SUCCEEDED'; end if;

  if v_evidence_id is not null then
    v_failed := false;
    begin
      delete from project_intelligence.version_evidence_links
      where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        and project_id = '10000000-0000-4000-8000-000000000001'
        and version_id = v_version_id
        and evidence_link_id = v_evidence_id;
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'DB2_VERSION_EVIDENCE_DELETE_SUCCEEDED'; end if;
  end if;

  if v_handoff_id is not null then
    v_failed := false;
    begin
      update project_intelligence.logical_handoffs
      set logical_content = logical_content
      where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        and project_id = '10000000-0000-4000-8000-000000000001'
        and handoff_id = v_handoff_id;
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'DB2_HANDOFF_UPDATE_SUCCEEDED'; end if;
  end if;
end
$snapshot_immutability$;

select 'DB2_SNAPSHOT_EVIDENCE_HANDOFF_IMMUTABILITY_OK' as result;
