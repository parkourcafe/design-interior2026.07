-- ProjectCEO Foundation integration hardening.
--
-- Additive replacement wrappers preserve the frozen callable signatures while
-- closing mailbox-proof, invitation reissue, package-release and ingestion
-- closure gaps found by Wave 3 integration review.

begin;

set local check_function_bodies = on;

grant usage on schema auth to pi_table_owner;
grant execute on function auth.jwt() to pi_table_owner;

create or replace function projectceo_foundation._authorize_package_human(
  p_project_id uuid,
  p_package_id uuid,
  p_capability text
)
returns table (
  organization_id uuid,
  actor_user_id uuid,
  actor_id text,
  project_wide boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_candidate_count bigint;
  v_organization_count bigint;
begin
  if v_user_id is null then
    perform projectceo_foundation._raise(
      'P1101',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;

  with candidates as (
    select pw.organization_id, true as project_wide
    from project_intelligence.project_workflows pw
    join project_intelligence.organizations o
      on o.id = pw.organization_id
     and o.cell_code = 'ru'
     and o.status = 'active'
    join project_intelligence.organization_members om
      on om.organization_id = pw.organization_id
     and om.user_id = v_user_id
     and om.status = 'active'
    join projectceo_foundation.project_memberships pm
      on pm.organization_id = pw.organization_id
     and pm.project_id = pw.project_id
     and pm.user_id = v_user_id
     and pm.status = 'active'
    join projectceo_foundation.project_member_capabilities pc
      on pc.organization_id = pm.organization_id
     and pc.project_id = pm.project_id
     and pc.user_id = pm.user_id
     and pc.capability = p_capability
    join projectceo_foundation.project_packages pp
      on pp.organization_id = pw.organization_id
     and pp.project_id = pw.project_id
     and pp.id = p_package_id
     and pp.status = 'active'
    where pw.project_id = p_project_id
    union all
    select pw.organization_id, false as project_wide
    from project_intelligence.project_workflows pw
    join project_intelligence.organizations o
      on o.id = pw.organization_id
     and o.cell_code = 'ru'
     and o.status = 'active'
    join project_intelligence.organization_members om
      on om.organization_id = pw.organization_id
     and om.user_id = v_user_id
     and om.status = 'active'
    join projectceo_foundation.package_memberships pm
      on pm.organization_id = pw.organization_id
     and pm.project_id = pw.project_id
     and pm.package_id = p_package_id
     and pm.user_id = v_user_id
     and pm.status = 'active'
    join projectceo_foundation.package_member_capabilities pc
      on pc.organization_id = pm.organization_id
     and pc.project_id = pm.project_id
     and pc.package_id = pm.package_id
     and pc.user_id = pm.user_id
     and pc.capability = p_capability
    join projectceo_foundation.project_packages pp
      on pp.organization_id = pw.organization_id
     and pp.project_id = pw.project_id
     and pp.id = pm.package_id
     and pp.status = 'active'
    where pw.project_id = p_project_id
  )
  select
    count(*),
    count(distinct candidates.organization_id),
    min(candidates.organization_id::text)::uuid,
    bool_or(candidates.project_wide)
  into
    v_candidate_count,
    v_organization_count,
    organization_id,
    project_wide
  from candidates;

  if v_candidate_count = 0 then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"PACKAGE_CAPABILITY_REQUIRED"}'::jsonb
    );
  elsif v_organization_count <> 1 then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"AMBIGUOUS_PACKAGE_SCOPE"}'::jsonb
    );
  end if;

  actor_user_id := v_user_id;
  actor_id := v_user_id::text;
  return next;
end
$function$;

alter function projectceo_api.create_invitation(
  uuid, uuid, text, text, timestamptz, bytea, bigint, text
) set schema projectceo_foundation;
alter function projectceo_foundation.create_invitation(
  uuid, uuid, text, text, timestamptz, bytea, bigint, text
) rename to _create_invitation_v1;

alter function projectceo_api.accept_invitation(bytea, text)
  set schema projectceo_foundation;
alter function projectceo_foundation.accept_invitation(bytea, text)
  rename to _accept_invitation_v1;

alter function projectceo_api.create_guest_access_grant(
  uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
) set schema projectceo_foundation;
alter function projectceo_foundation.create_guest_access_grant(
  uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
) rename to _create_guest_access_grant_v1;

alter function projectceo_api.ingest_source_graph(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text
) set schema projectceo_foundation;
alter function projectceo_foundation.ingest_source_graph(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text
) rename to _ingest_source_graph_v1;

revoke all on function
  projectceo_foundation._create_invitation_v1(
    uuid, uuid, text, text, timestamptz, bytea, bigint, text
  ),
  projectceo_foundation._accept_invitation_v1(bytea, text),
  projectceo_foundation._create_guest_access_grant_v1(
    uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
  ),
  projectceo_foundation._ingest_source_graph_v1(
    uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text
  )
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

create function projectceo_foundation._has_email_ownership_amr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(auth.jwt() -> 'amr') = 'array'
          then auth.jwt() -> 'amr'
        else '[]'::jsonb
      end
    ) amr(entry)
    where lower(
      case jsonb_typeof(amr.entry)
        when 'object' then coalesce(amr.entry ->> 'method', '')
        when 'string' then trim(both '"' from amr.entry::text)
        else ''
      end
    ) in ('magiclink', 'otp', 'invite', 'email/signup')
  )
$function$;

create or replace function projectceo_api.create_invitation(
  project_id uuid,
  package_id uuid,
  recipient_email text,
  role text,
  expires_at timestamptz,
  token_digest bytea,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_normalized_email text := lower(btrim(coalesce(recipient_email, '')));
  v_scope text := case when package_id is null then 'project' else 'package' end;
  v_invitation_id uuid := extensions.gen_random_uuid();
  v_previous_invitation_id uuid;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'manage_access'
  );
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  if octet_length(token_digest) <> 32 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"tokenDigest"}'::jsonb
    );
  end if;
  if char_length(v_normalized_email) not between 3 and 320
     or v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"recipientEmail"}'::jsonb
    );
  end if;
  if role not in ('architect', 'builder', 'client_approver') then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"role"}'::jsonb
    );
  end if;
  if expires_at <= statement_timestamp()
     or expires_at > statement_timestamp() + interval '30 days' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"expiresAt"}'::jsonb
    );
  end if;
  if package_id is not null and not exists (
    select 1
    from projectceo_foundation.project_packages pp
    where pp.organization_id = v_context.organization_id
      and pp.project_id = project_id
      and pp.id = package_id
      and pp.status = 'active'
  ) then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"package"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'expiresAt', expires_at,
    'packageId', package_id,
    'recipientEmailDigest',
      encode(project_intelligence._sha256_text(v_normalized_email), 'hex'),
    'role', role,
    'tokenDigest', encode(token_digest, 'hex')
  ));

  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;

  v_replay := projectceo_foundation._replay_or_null(
    v_context.organization_id,
    project_id,
    'create_invitation',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_foundation._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  if exists (
    select 1
    from projectceo_foundation.invitations i
    where i.token_digest = token_digest
  ) then
    perform projectceo_foundation._raise(
      'P1108',
      'idempotency_conflict',
      '{"reason":"INVITATION_TOKEN_DIGEST_REUSED"}'::jsonb
    );
  end if;

  if exists (
    select 1
    from auth.users u
    where lower(btrim(u.email)) = v_normalized_email
      and (
        (
          package_id is null
          and exists (
            select 1
            from projectceo_foundation.project_memberships pm
            where pm.organization_id = v_context.organization_id
              and pm.project_id = project_id
              and pm.user_id = u.id
              and pm.status = 'active'
          )
        )
        or (
          package_id is not null
          and exists (
            select 1
            from projectceo_foundation.package_memberships pm
            where pm.organization_id = v_context.organization_id
              and pm.project_id = project_id
              and pm.package_id = package_id
              and pm.user_id = u.id
              and pm.status = 'active'
          )
        )
      )
  ) then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"RECIPIENT_ALREADY_HAS_SCOPE"}'::jsonb
    );
  end if;

  select i.invitation_id into v_previous_invitation_id
  from projectceo_foundation.invitations i
  where i.organization_id = v_context.organization_id
    and i.project_id = project_id
    and i.recipient_email_digest =
      project_intelligence._sha256_text(v_normalized_email)
    and i.scope_kind = v_scope
    and i.package_id is not distinct from package_id
    and i.expires_at > statement_timestamp()
    and not exists (
      select 1
      from projectceo_foundation.invitation_events ie
      where ie.organization_id = i.organization_id
        and ie.project_id = i.project_id
        and ie.invitation_id = i.invitation_id
        and ie.event_type in ('accepted', 'revoked', 'expired')
    )
  order by i.created_at desc, i.invitation_id desc
  limit 1;

  insert into projectceo_foundation.invitation_events (
    organization_id,
    project_id,
    invitation_id,
    event_type,
    actor_type,
    actor_user_id
  )
  select
    i.organization_id,
    i.project_id,
    i.invitation_id,
    'revoked',
    'human',
    v_context.actor_user_id
  from projectceo_foundation.invitations i
  where i.organization_id = v_context.organization_id
    and i.project_id = project_id
    and i.recipient_email_digest =
      project_intelligence._sha256_text(v_normalized_email)
    and i.scope_kind = v_scope
    and i.package_id is not distinct from package_id
    and i.expires_at > statement_timestamp()
    and not exists (
      select 1
      from projectceo_foundation.invitation_events ie
      where ie.organization_id = i.organization_id
        and ie.project_id = i.project_id
        and ie.invitation_id = i.invitation_id
        and ie.event_type in ('accepted', 'revoked', 'expired')
    )
  order by i.created_at, i.invitation_id;

  insert into projectceo_foundation.invitations (
    organization_id,
    project_id,
    invitation_id,
    package_id,
    scope_kind,
    recipient_email,
    recipient_email_digest,
    token_digest,
    role,
    expires_at,
    created_by_user_id,
    replaces_invitation_id
  )
  values (
    v_context.organization_id,
    project_id,
    v_invitation_id,
    package_id,
    v_scope,
    v_normalized_email,
    project_intelligence._sha256_text(v_normalized_email),
    token_digest,
    role,
    expires_at,
    v_context.actor_user_id,
    v_previous_invitation_id
  );

  v_result := jsonb_build_object(
    'expiresAt', expires_at,
    'invitationId', v_invitation_id,
    'packageId', package_id,
    'projectId', project_id,
    'role', role,
    'scope', v_scope
  );

  return projectceo_foundation._complete_project_command(
    v_context.organization_id,
    project_id,
    'create_invitation',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'invitation_created',
    jsonb_build_object(
      'invitation_id', v_invitation_id,
      'package_id', package_id,
      'replaces_invitation_id', v_previous_invitation_id,
      'role', role,
      'scope', v_scope
    ),
    v_state_revision
  );
end
$function$;

create or replace function projectceo_api.accept_invitation(
  token_digest bytea,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_actor_user_id uuid := auth.uid();
  v_email text;
  v_email_confirmed boolean;
  v_invitation projectceo_foundation.invitations%rowtype;
  v_state_revision bigint;
begin
  if v_actor_user_id is null then
    perform projectceo_foundation._raise(
      'P1101',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;
  if octet_length(token_digest) <> 32 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"tokenDigest"}'::jsonb
    );
  end if;
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  select
    lower(btrim(u.email)),
    (to_jsonb(u) ->> 'email_confirmed_at') is not null
  into v_email, v_email_confirmed
  from auth.users u
  where u.id = v_actor_user_id;

  if v_email is null
     or not coalesce(v_email_confirmed, false)
     or not projectceo_foundation._has_email_ownership_amr() then
    perform projectceo_foundation._raise(
      'P1102',
      'identity_unverified',
      '{}'::jsonb
    );
  end if;

  select * into v_invitation
  from projectceo_foundation.invitations i
  where i.token_digest = token_digest
  for update;
  if not found then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"invitation"}'::jsonb
    );
  end if;

  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_invitation.organization_id
    and pw.project_id = v_invitation.project_id
  for update;

  if v_invitation.recipient_email = v_email
     and not exists (
       select 1
       from projectceo_foundation.invitation_events ie
       where ie.organization_id = v_invitation.organization_id
         and ie.project_id = v_invitation.project_id
         and ie.invitation_id = v_invitation.invitation_id
         and ie.event_type in ('accepted', 'revoked', 'expired')
     )
     and (
       (
         v_invitation.scope_kind = 'project'
         and exists (
           select 1
           from projectceo_foundation.project_memberships pm
           where pm.organization_id = v_invitation.organization_id
             and pm.project_id = v_invitation.project_id
             and pm.user_id = v_actor_user_id
         )
       )
       or (
         v_invitation.scope_kind = 'package'
         and exists (
           select 1
           from projectceo_foundation.package_memberships pm
           where pm.organization_id = v_invitation.organization_id
             and pm.project_id = v_invitation.project_id
             and pm.package_id = v_invitation.package_id
             and pm.user_id = v_actor_user_id
         )
       )
     ) then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"RECIPIENT_ALREADY_HAS_SCOPE"}'::jsonb
    );
  end if;

  return projectceo_foundation._accept_invitation_v1(
    token_digest,
    idempotency_key
  );
end
$function$;

create or replace function projectceo_api.create_guest_access_grant(
  project_id uuid,
  package_id uuid,
  version_id text,
  allow_acknowledgement boolean,
  expires_at timestamptz,
  token_digest bytea,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_package_kind text;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'distribute_release'
  );

  select pp.kind into v_package_kind
  from projectceo_foundation.project_packages pp
  where pp.organization_id = v_context.organization_id
    and pp.project_id = project_id
    and pp.id = package_id
    and pp.status = 'active';
  if not found then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"package"}'::jsonb
    );
  end if;
  if v_package_kind <> 'project_root' then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"PACKAGE_RELEASE_BINDING_REQUIRED"}'::jsonb
    );
  end if;

  return projectceo_foundation._create_guest_access_grant_v1(
    project_id,
    package_id,
    version_id,
    allow_acknowledgement,
    expires_at,
    token_digest,
    expected_state_revision,
    idempotency_key
  );
end
$function$;

create or replace function projectceo_api.ingest_source_graph(
  project_id uuid,
  source jsonb,
  fragments jsonb,
  nodes jsonb,
  revisions jsonb,
  evidence_links jsonb,
  edges jsonb,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_package_id uuid;
  v_source_id text;
  v_source_revision_id text;
  v_revision_count bigint;
  v_revision_node_id text;
  v_revision_payload jsonb;
  v_node_count bigint;
  v_node_kind text;
  v_node_current_revision_id text;
  v_result jsonb;
begin
  if jsonb_typeof(source) <> 'object'
     or jsonb_typeof(nodes) <> 'array'
     or jsonb_typeof(revisions) <> 'array' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"INGESTION_SHAPE_INVALID"}'::jsonb
    );
  end if;

  v_package_id := (source ->> 'packageId')::uuid;
  perform *
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_package_id,
    'register_source'
  );

  v_source_id := btrim(coalesce(source ->> 'sourceId', ''));
  v_source_revision_id := btrim(
    coalesce(source ->> 'sourceRevisionId', '')
  );
  if v_source_id = '' or v_source_revision_id = '' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"SOURCE_REVISION_BINDING_INVALID"}'::jsonb
    );
  end if;

  select
    count(*),
    min(r."nodeId"),
    min(r.payload::text)::jsonb
  into
    v_revision_count,
    v_revision_node_id,
    v_revision_payload
  from jsonb_to_recordset(revisions) as r(
    "revisionId" text,
    "nodeId" text,
    payload jsonb
  )
  where r."revisionId" = v_source_revision_id;

  if v_revision_count <> 1
     or v_revision_payload ->> 'sourceId' is distinct from v_source_id then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"SOURCE_REVISION_BINDING_INVALID"}'::jsonb
    );
  end if;

  select
    count(*),
    min(n.kind),
    min(n."currentRevisionId")
  into
    v_node_count,
    v_node_kind,
    v_node_current_revision_id
  from jsonb_to_recordset(nodes) as n(
    "nodeId" text,
    kind text,
    "currentRevisionId" text
  )
  where n."nodeId" = v_revision_node_id;

  if v_node_count <> 1
     or v_node_kind <> 'source'
     or v_node_current_revision_id is distinct from v_source_revision_id then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"SOURCE_REVISION_BINDING_INVALID"}'::jsonb
    );
  end if;

  v_result := projectceo_foundation._ingest_source_graph_v1(
    project_id,
    source,
    fragments,
    nodes,
    revisions,
    evidence_links,
    edges,
    expected_state_revision,
    idempotency_key
  );

  if v_result #>> '{result,sourceRevisionId}'
     is distinct from v_source_revision_id then
    perform projectceo_foundation._raise(
      'P1112',
      'internal_error',
      '{"reason":"SOURCE_REVISION_RESULT_MISMATCH"}'::jsonb
    );
  end if;
  return v_result;
end
$function$;

alter function projectceo_foundation._authorize_package_human(
  uuid, uuid, text
) owner to pi_table_owner;
alter function projectceo_foundation._has_email_ownership_amr()
  owner to pi_table_owner;
alter function projectceo_api.create_invitation(
  uuid, uuid, text, text, timestamptz, bytea, bigint, text
) owner to pi_table_owner;
alter function projectceo_api.accept_invitation(bytea, text)
  owner to pi_table_owner;
alter function projectceo_api.create_guest_access_grant(
  uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
) owner to pi_table_owner;
alter function projectceo_api.ingest_source_graph(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text
) owner to pi_table_owner;

revoke all on function
  projectceo_foundation._has_email_ownership_amr(),
  projectceo_api.create_invitation(
    uuid, uuid, text, text, timestamptz, bytea, bigint, text
  ),
  projectceo_api.accept_invitation(bytea, text),
  projectceo_api.create_guest_access_grant(
    uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
  ),
  projectceo_api.ingest_source_graph(
    uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text
  )
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function
  projectceo_api.create_invitation(
    uuid, uuid, text, text, timestamptz, bytea, bigint, text
  ),
  projectceo_api.accept_invitation(bytea, text),
  projectceo_api.create_guest_access_grant(
    uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
  ),
  projectceo_api.ingest_source_graph(
    uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, text
  )
  to authenticated;

commit;
