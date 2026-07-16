-- ProjectCEO RU Foundation: enrollment, project/package-scoped access,
-- invitations and expiring guest grants.
--
-- Additive only. This migration creates a separate private Foundation schema so
-- the frozen DB2 31-relation / six-RPC contract remains unchanged.

begin;

set check_function_bodies = on;

create schema projectceo_foundation authorization pi_table_owner;
create schema projectceo_api authorization pi_table_owner;

revoke all on schema projectceo_foundation
  from public, anon, authenticated, service_role;
revoke all on schema projectceo_api
  from public, anon, authenticated, service_role;

alter default privileges for role pi_table_owner
  in schema projectceo_foundation
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role pi_table_owner
  in schema projectceo_foundation
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role pi_table_owner
  in schema projectceo_api
  revoke execute on functions from public, anon, authenticated, service_role;

alter table project_intelligence.project_workflows
  add constraint project_workflows_one_organization_per_project_key
  unique (project_id);

create table projectceo_foundation.project_packages (
  organization_id uuid not null,
  project_id uuid not null,
  id uuid not null,
  stable_key text not null
    check (
      char_length(btrim(stable_key)) between 1 and 160
      and stable_key = btrim(stable_key)
    ),
  kind text not null check (kind in ('project_root', 'work_package')),
  parent_package_id uuid,
  name text not null
    check (
      char_length(btrim(name)) between 1 and 500
      and name = btrim(name)
    ),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, id),
  constraint project_packages_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint project_packages_stable_key_key
    unique (organization_id, project_id, stable_key),
  constraint project_packages_parent_fkey
    foreign key (organization_id, project_id, parent_package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict
    deferrable initially deferred,
  constraint project_packages_root_shape_check
    check (
      (kind = 'project_root' and parent_package_id is null)
      or (kind = 'work_package' and parent_package_id is not null)
    ),
  constraint project_packages_not_self_parent_check
    check (parent_package_id is null or parent_package_id <> id)
);

create unique index project_packages_one_root_idx
  on projectceo_foundation.project_packages (organization_id, project_id)
  where kind = 'project_root';
create index project_packages_parent_idx
  on projectceo_foundation.project_packages (
    organization_id,
    project_id,
    parent_package_id
  )
  where parent_package_id is not null;

create table projectceo_foundation.project_memberships (
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  role text not null check (role in (
    'owner_lead',
    'architect',
    'builder',
    'client_approver'
  )),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, user_id),
  constraint project_memberships_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint project_memberships_organization_member_fkey
    foreign key (organization_id, user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict
);

create index project_memberships_user_idx
  on projectceo_foundation.project_memberships (
    user_id,
    organization_id,
    project_id
  );
create index project_memberships_organization_member_idx
  on projectceo_foundation.project_memberships (organization_id, user_id);

create table projectceo_foundation.package_memberships (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  user_id uuid not null,
  role text not null check (role in (
    'architect',
    'builder',
    'client_approver'
  )),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, user_id),
  constraint package_memberships_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint package_memberships_organization_member_fkey
    foreign key (organization_id, user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict
);

create index package_memberships_user_idx
  on projectceo_foundation.package_memberships (
    user_id,
    organization_id,
    project_id,
    package_id
  );
create index package_memberships_organization_member_idx
  on projectceo_foundation.package_memberships (organization_id, user_id);

create table projectceo_foundation.project_member_capabilities (
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  capability text not null check (capability in (
    'view_project',
    'manage_project',
    'manage_access',
    'register_source',
    'review_source',
    'review_claim',
    'create_selection',
    'review_selection',
    'publish_baseline',
    'publish_release',
    'distribute_release',
    'acknowledge_release',
    'revise_decision',
    'create_change',
    'review_change_impact',
    'upload_photo_evidence',
    'review_milestone',
    'view_audit'
  )),
  granted_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, user_id, capability),
  constraint project_member_capabilities_membership_fkey
    foreign key (organization_id, project_id, user_id)
    references projectceo_foundation.project_memberships (
      organization_id,
      project_id,
      user_id
    )
    on delete restrict
);

create table projectceo_foundation.package_member_capabilities (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  user_id uuid not null,
  capability text not null check (capability in (
    'view_project',
    'register_source',
    'acknowledge_release',
    'create_change',
    'upload_photo_evidence',
    'review_milestone'
  )),
  granted_at timestamptz not null default statement_timestamp(),
  primary key (
    organization_id,
    project_id,
    package_id,
    user_id,
    capability
  ),
  constraint package_member_capabilities_membership_fkey
    foreign key (organization_id, project_id, package_id, user_id)
    references projectceo_foundation.package_memberships (
      organization_id,
      project_id,
      package_id,
      user_id
    )
    on delete restrict
);

create table projectceo_foundation.invitations (
  organization_id uuid not null,
  project_id uuid not null,
  invitation_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid,
  scope_kind text not null check (scope_kind in ('project', 'package')),
  recipient_email text not null
    check (
      recipient_email = lower(btrim(recipient_email))
      and char_length(recipient_email) between 3 and 320
      and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
  recipient_email_digest bytea not null
    check (octet_length(recipient_email_digest) = 32),
  token_digest bytea not null check (octet_length(token_digest) = 32),
  role text not null check (role in (
    'architect',
    'builder',
    'client_approver'
  )),
  expires_at timestamptz not null,
  created_by_user_id uuid not null,
  replaces_invitation_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, invitation_id),
  constraint invitations_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint invitations_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint invitations_creator_fkey
    foreign key (organization_id, project_id, created_by_user_id)
    references projectceo_foundation.project_memberships (
      organization_id,
      project_id,
      user_id
    )
    on delete restrict,
  constraint invitations_replaces_fkey
    foreign key (organization_id, project_id, replaces_invitation_id)
    references projectceo_foundation.invitations (
      organization_id,
      project_id,
      invitation_id
    )
    on delete restrict,
  constraint invitations_scope_check
    check (
      (scope_kind = 'project' and package_id is null)
      or (scope_kind = 'package' and package_id is not null)
    ),
  constraint invitations_expiry_check
    check (expires_at > created_at),
  constraint invitations_token_digest_key unique (token_digest)
);

create index invitations_project_created_idx
  on projectceo_foundation.invitations (
    organization_id,
    project_id,
    created_at desc
  );
create index invitations_package_idx
  on projectceo_foundation.invitations (
    organization_id,
    project_id,
    package_id
  )
  where package_id is not null;
create index invitations_creator_idx
  on projectceo_foundation.invitations (
    organization_id,
    project_id,
    created_by_user_id
  );
create index invitations_replaces_idx
  on projectceo_foundation.invitations (
    organization_id,
    project_id,
    replaces_invitation_id
  )
  where replaces_invitation_id is not null;

create table projectceo_foundation.invitation_events (
  organization_id uuid not null,
  project_id uuid not null,
  invitation_id uuid not null,
  event_id uuid not null default extensions.gen_random_uuid(),
  event_type text not null check (event_type in (
    'accepted',
    'revoked',
    'expired'
  )),
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_user_id uuid,
  accepted_user_id uuid,
  occurred_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, event_id),
  constraint invitation_events_invitation_fkey
    foreign key (organization_id, project_id, invitation_id)
    references projectceo_foundation.invitations (
      organization_id,
      project_id,
      invitation_id
    )
    on delete restrict,
  constraint invitation_events_actor_fkey
    foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint invitation_events_accepted_user_fkey
    foreign key (accepted_user_id)
    references auth.users (id)
    on delete restrict,
  constraint invitation_events_shape_check
    check (
      (
        event_type = 'accepted'
        and actor_type = 'human'
        and actor_user_id is not null
        and accepted_user_id = actor_user_id
      )
      or (
        event_type = 'revoked'
        and actor_type = 'human'
        and actor_user_id is not null
        and accepted_user_id is null
      )
      or (
        event_type = 'expired'
        and actor_type = 'system'
        and actor_user_id is null
        and accepted_user_id is null
      )
    ),
  constraint invitation_events_terminal_key
    unique (organization_id, project_id, invitation_id, event_type)
);

create index invitation_events_invitation_idx
  on projectceo_foundation.invitation_events (
    organization_id,
    project_id,
    invitation_id,
    occurred_at
  );
create index invitation_events_actor_idx
  on projectceo_foundation.invitation_events (
    organization_id,
    actor_user_id
  )
  where actor_user_id is not null;
create index invitation_events_accepted_user_idx
  on projectceo_foundation.invitation_events (accepted_user_id)
  where accepted_user_id is not null;

create table projectceo_foundation.guest_access_grants (
  organization_id uuid not null,
  project_id uuid not null,
  grant_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid not null,
  version_id text not null,
  token_digest bytea not null check (octet_length(token_digest) = 32),
  allow_acknowledgement boolean not null default false,
  expires_at timestamptz not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, grant_id),
  constraint guest_access_grants_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint guest_access_grants_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint guest_access_grants_version_fkey
    foreign key (organization_id, project_id, version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint guest_access_grants_creator_fkey
    foreign key (organization_id, project_id, created_by_user_id)
    references projectceo_foundation.project_memberships (
      organization_id,
      project_id,
      user_id
    )
    on delete restrict,
  constraint guest_access_grants_expiry_check
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '7 days'
    ),
  constraint guest_access_grants_token_digest_key unique (token_digest)
);

create table projectceo_foundation.guest_access_grant_events (
  organization_id uuid not null,
  project_id uuid not null,
  grant_id uuid not null,
  event_id uuid not null default extensions.gen_random_uuid(),
  event_type text not null check (event_type = 'revoked'),
  actor_user_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, event_id),
  constraint guest_access_grant_events_grant_fkey
    foreign key (organization_id, project_id, grant_id)
    references projectceo_foundation.guest_access_grants (
      organization_id,
      project_id,
      grant_id
    )
    on delete restrict,
  constraint guest_access_grant_events_actor_fkey
    foreign key (organization_id, project_id, actor_user_id)
    references projectceo_foundation.project_memberships (
      organization_id,
      project_id,
      user_id
    )
    on delete restrict,
  constraint guest_access_grant_events_revocation_key
    unique (organization_id, project_id, grant_id, event_type)
);

create index guest_access_grants_package_idx
  on projectceo_foundation.guest_access_grants (
    organization_id,
    project_id,
    package_id
  );
create index guest_access_grants_version_idx
  on projectceo_foundation.guest_access_grants (
    organization_id,
    project_id,
    version_id
  );
create index guest_access_grants_creator_idx
  on projectceo_foundation.guest_access_grants (
    organization_id,
    project_id,
    created_by_user_id
  );
create index guest_access_grant_events_actor_idx
  on projectceo_foundation.guest_access_grant_events (
    organization_id,
    project_id,
    actor_user_id
  );

create table projectceo_foundation.command_records (
  command_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  operation text not null check (operation in (
    'enroll_organization_project',
    'create_invitation',
    'accept_invitation',
    'revoke_invitation',
    'expire_invitation',
    'create_guest_access_grant',
    'revoke_guest_access_grant',
    'register_source_inventory',
    'ingest_source_graph'
  )),
  key_digest bytea not null check (octet_length(key_digest) = 32),
  request_digest bytea not null check (octet_length(request_digest) = 32),
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_id text not null
    check (
      char_length(btrim(actor_id)) between 1 and 160
      and actor_id = btrim(actor_id)
    ),
  actor_user_id uuid,
  logical_result jsonb not null
    check (jsonb_typeof(logical_result) = 'object'),
  resulting_state_revision bigint not null
    check (resulting_state_revision between 0 and 9007199254740991),
  completed_at timestamptz not null default statement_timestamp(),
  constraint foundation_command_records_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint foundation_command_records_actor_fkey
    foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint foundation_command_records_idempotency_key
    unique (organization_id, project_id, operation, key_digest),
  constraint foundation_command_records_scope_id_key
    unique (organization_id, project_id, command_id),
  constraint foundation_command_records_actor_shape_check
    check (
      (actor_type = 'human' and actor_user_id is not null)
      or (actor_type = 'system' and actor_user_id is null)
    )
);

create table projectceo_foundation.audit_events (
  audit_event_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  command_id uuid not null,
  event_type text not null check (event_type in (
    'project_enrolled',
    'invitation_created',
    'invitation_accepted',
    'invitation_revoked',
    'invitation_expired',
    'guest_grant_created',
    'guest_grant_revoked',
    'source_inventory_registered',
    'source_graph_ingested'
  )),
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_id text not null
    check (
      char_length(btrim(actor_id)) between 1 and 160
      and actor_id = btrim(actor_id)
    ),
  request_id text not null
    check (
      char_length(btrim(request_id)) between 1 and 160
      and request_id = btrim(request_id)
    ),
  controlled_metadata jsonb not null
    check (
      jsonb_typeof(controlled_metadata) = 'object'
      and not (
        controlled_metadata ?| array[
          'email',
          'recipientEmail',
          'token',
          'tokenDigest',
          'originalFilename',
          'storagePath',
          'signedUrl'
        ]
      )
    ),
  occurred_at timestamptz not null default statement_timestamp(),
  constraint foundation_audit_events_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint foundation_audit_events_command_fkey
    foreign key (organization_id, project_id, command_id)
    references projectceo_foundation.command_records (
      organization_id,
      project_id,
      command_id
    )
    on delete restrict
);

create index foundation_command_records_actor_idx
  on projectceo_foundation.command_records (
    organization_id,
    actor_user_id
  )
  where actor_user_id is not null;
create index foundation_audit_events_project_occurred_idx
  on projectceo_foundation.audit_events (
    organization_id,
    project_id,
    occurred_at desc
  );
create index foundation_audit_events_command_idx
  on projectceo_foundation.audit_events (
    organization_id,
    project_id,
    command_id
  );

create function projectceo_foundation.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'PROJECTCEO_FOUNDATION_APPEND_ONLY';
end
$function$;

create function projectceo_foundation._raise(
  p_sqlstate text,
  p_code text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = p_sqlstate,
    message = p_code,
    detail = coalesce(p_detail, '{}'::jsonb)::text;
end
$function$;

create function projectceo_foundation._assert_idempotency_key(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := btrim(coalesce(p_value, ''));
begin
  if length(v_value) < 1 or length(v_value) > 512 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"idempotencyKey"}'::jsonb
    );
  end if;
  return v_value;
end
$function$;

create function projectceo_foundation._assert_state_revision(p_value bigint)
returns bigint
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null
     or p_value < 0
     or p_value > 9007199254740991 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"expectedStateRevision"}'::jsonb
    );
  end if;
  return p_value;
end
$function$;

create function projectceo_foundation._role_capabilities(p_role text)
returns table (capability text)
language sql
immutable
set search_path = ''
as $function$
  select value
  from unnest(
    case p_role
      when 'owner_lead' then array[
        'view_project', 'manage_project', 'manage_access', 'register_source',
        'review_source', 'review_claim', 'create_selection', 'review_selection',
        'publish_baseline', 'publish_release', 'distribute_release',
        'acknowledge_release', 'revise_decision', 'create_change',
        'review_change_impact', 'upload_photo_evidence', 'review_milestone',
        'view_audit'
      ]::text[]
      when 'architect' then array[
        'view_project', 'register_source', 'review_source', 'review_claim',
        'create_selection', 'review_selection', 'publish_baseline',
        'publish_release', 'distribute_release', 'acknowledge_release',
        'revise_decision', 'create_change', 'review_change_impact',
        'upload_photo_evidence', 'review_milestone', 'view_audit'
      ]::text[]
      when 'builder' then array[
        'view_project', 'register_source', 'acknowledge_release',
        'create_change', 'upload_photo_evidence'
      ]::text[]
      when 'client_approver' then array[
        'view_project', 'review_selection', 'acknowledge_release',
        'create_change', 'review_milestone'
      ]::text[]
      else array[]::text[]
    end
  ) value
$function$;

create function projectceo_foundation._package_role_capabilities(p_role text)
returns table (capability text)
language sql
immutable
set search_path = ''
as $function$
  select value
  from unnest(
    case p_role
      when 'architect' then array[
        'view_project', 'register_source', 'acknowledge_release',
        'create_change', 'upload_photo_evidence', 'review_milestone'
      ]::text[]
      when 'builder' then array[
        'view_project', 'register_source', 'acknowledge_release',
        'create_change', 'upload_photo_evidence'
      ]::text[]
      when 'client_approver' then array[
        'view_project', 'acknowledge_release', 'create_change',
        'review_milestone'
      ]::text[]
      else array[]::text[]
    end
  ) value
$function$;

create function projectceo_foundation._authorize_project_human(
  p_project_id uuid,
  p_capability text
)
returns table (
  organization_id uuid,
  actor_user_id uuid,
  actor_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    perform projectceo_foundation._raise(
      'P1101',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;

  select count(*), min(pw.organization_id::text)::uuid
    into v_count, organization_id
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
  where pw.project_id = p_project_id;

  if v_count = 0 then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"PROJECT_CAPABILITY_REQUIRED"}'::jsonb
    );
  elsif v_count <> 1 then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"AMBIGUOUS_PROJECT_SCOPE"}'::jsonb
    );
  end if;

  actor_user_id := v_user_id;
  actor_id := v_user_id::text;
  return next;
end
$function$;

create function projectceo_foundation._authorize_package_human(
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
begin
  if v_user_id is null then
    perform projectceo_foundation._raise(
      'P1101',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;

  return query
  select
    pw.organization_id,
    v_user_id,
    v_user_id::text,
    true
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
  select
    pw.organization_id,
    v_user_id,
    v_user_id::text,
    false
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
  where pw.project_id = p_project_id;

  if not found then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"PACKAGE_CAPABILITY_REQUIRED"}'::jsonb
    );
  end if;
end
$function$;

create function projectceo_foundation._replay_or_null(
  p_organization_id uuid,
  p_project_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_record projectceo_foundation.command_records%rowtype;
begin
  select *
    into v_record
  from projectceo_foundation.command_records cr
  where cr.organization_id = p_organization_id
    and cr.project_id = p_project_id
    and cr.operation = p_operation
    and cr.key_digest = p_key_digest;

  if not found then
    return null;
  end if;
  if v_record.request_digest <> p_request_digest then
    perform projectceo_foundation._raise(
      'P1108',
      'idempotency_conflict',
      jsonb_build_object('operation', p_operation)
    );
  end if;
  return jsonb_build_object(
    'operation', p_operation,
    'replay', true,
    'stateRevision', v_record.resulting_state_revision,
    'result', v_record.logical_result
  );
end
$function$;

create function projectceo_foundation._complete_project_command(
  p_organization_id uuid,
  p_project_id uuid,
  p_operation text,
  p_key_digest bytea,
  p_request_digest bytea,
  p_actor_type text,
  p_actor_id text,
  p_actor_user_id uuid,
  p_logical_result jsonb,
  p_event_type text,
  p_controlled_metadata jsonb,
  p_previous_state_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_command_id uuid := extensions.gen_random_uuid();
  v_next_state_revision bigint := p_previous_state_revision + 1;
begin
  if p_previous_state_revision >= 9007199254740991 then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"STATE_REVISION_EXHAUSTED"}'::jsonb
    );
  end if;

  if current_setting('projectceo.test_fail_after_domain', true) = 'on' then
    perform projectceo_foundation._raise(
      'P1112',
      'internal_error',
      '{"reason":"INJECTED_FAILURE_AFTER_DOMAIN"}'::jsonb
    );
  end if;

  insert into projectceo_foundation.command_records (
    command_id,
    organization_id,
    project_id,
    operation,
    key_digest,
    request_digest,
    actor_type,
    actor_id,
    actor_user_id,
    logical_result,
    resulting_state_revision
  )
  values (
    v_command_id,
    p_organization_id,
    p_project_id,
    p_operation,
    p_key_digest,
    p_request_digest,
    p_actor_type,
    p_actor_id,
    p_actor_user_id,
    p_logical_result,
    v_next_state_revision
  );

  insert into projectceo_foundation.audit_events (
    organization_id,
    project_id,
    command_id,
    event_type,
    actor_type,
    actor_id,
    request_id,
    controlled_metadata
  )
  values (
    p_organization_id,
    p_project_id,
    v_command_id,
    p_event_type,
    p_actor_type,
    p_actor_id,
    'db:' || extensions.gen_random_uuid()::text,
    coalesce(p_controlled_metadata, '{}'::jsonb)
  );

  update project_intelligence.project_workflows pw
  set state_revision = v_next_state_revision,
      updated_at = statement_timestamp()
  where pw.organization_id = p_organization_id
    and pw.project_id = p_project_id
    and pw.state_revision = p_previous_state_revision;

  if not found then
    perform projectceo_foundation._raise(
      'P1107',
      'stale_state',
      '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'operation', p_operation,
    'replay', false,
    'stateRevision', v_next_state_revision,
    'result', p_logical_result
  );
end
$function$;

create function projectceo_foundation._bootstrap_project_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into projectceo_foundation.project_packages (
    organization_id,
    project_id,
    id,
    stable_key,
    kind,
    parent_package_id,
    name
  )
  values (
    new.organization_id,
    new.project_id,
    new.project_id,
    'project-root',
    'project_root',
    null,
    'Project root'
  )
  on conflict (organization_id, project_id, id) do nothing;

  insert into projectceo_foundation.project_memberships (
    organization_id,
    project_id,
    user_id,
    role
  )
  select
    new.organization_id,
    new.project_id,
    om.user_id,
    'owner_lead'
  from project_intelligence.organization_members om
  where om.organization_id = new.organization_id
    and om.role = 'owner'
    and om.status = 'active'
  on conflict (organization_id, project_id, user_id) do nothing;

  insert into projectceo_foundation.project_member_capabilities (
    organization_id,
    project_id,
    user_id,
    capability
  )
  select
    pm.organization_id,
    pm.project_id,
    pm.user_id,
    rc.capability
  from projectceo_foundation.project_memberships pm
  cross join lateral projectceo_foundation._role_capabilities(pm.role) rc
  where pm.organization_id = new.organization_id
    and pm.project_id = new.project_id
  on conflict do nothing;

  return new;
end
$function$;

create trigger project_workflows_foundation_bootstrap
after insert on project_intelligence.project_workflows
for each row execute function projectceo_foundation._bootstrap_project_scope();

create function projectceo_foundation.validate_package_parent_cycle()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.parent_package_id is null then
    return new;
  end if;
  if exists (
    with recursive ancestors(id) as (
      select new.parent_package_id
      union all
      select parent.parent_package_id
      from projectceo_foundation.project_packages parent
      join ancestors a on a.id = parent.id
      where parent.organization_id = new.organization_id
        and parent.project_id = new.project_id
        and parent.parent_package_id is not null
    )
    select 1 from ancestors where id = new.id
  ) then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"PACKAGE_CYCLE"}'::jsonb
    );
  end if;
  return new;
end
$function$;

create trigger project_packages_cycle_guard
before insert on projectceo_foundation.project_packages
for each row execute function projectceo_foundation.validate_package_parent_cycle();

create or replace function project_intelligence._human_context(
  p_project_id uuid,
  p_capability text
)
returns table (
  organization_id uuid,
  actor_user_id uuid,
  actor_id text
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_capability text;
begin
  v_capability := case p_capability
    when 'publish_version' then 'publish_baseline'
    else p_capability
  end;

  return query
  select c.organization_id, c.actor_user_id, c.actor_id
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    v_capability
  ) c;
end
$function$;

create or replace function projectceo_api.enroll_organization_project(
  project_id uuid,
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
  v_owner_id uuid;
  v_organization_id uuid;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  if v_actor_user_id is null then
    perform projectceo_foundation._raise(
      'P1101',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object('projectId', project_id)
  );

  select p.designer_id
    into v_owner_id
  from public.projects p
  where p.id = project_id
  for update;

  if not found then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"project"}'::jsonb
    );
  end if;
  if v_owner_id is distinct from v_actor_user_id then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"LEGACY_PROJECT_OWNER_REQUIRED"}'::jsonb
    );
  end if;

  select pw.organization_id, pw.state_revision
    into v_organization_id, v_state_revision
  from project_intelligence.project_workflows pw
  where pw.project_id = project_id;

  if found then
    v_replay := projectceo_foundation._replay_or_null(
      v_organization_id,
      project_id,
      'enroll_organization_project',
      v_key_digest,
      v_request_digest
    );
    if v_replay is not null then
      return v_replay;
    end if;

    if not exists (
      select 1
      from project_intelligence.organizations o
      where o.id = v_organization_id
        and o.legacy_designer_id = v_actor_user_id
    ) then
      perform projectceo_foundation._raise(
        'P1109',
        'scope_conflict',
        '{"reason":"PROJECT_ALREADY_ENROLLED"}'::jsonb
      );
    end if;

    v_result := jsonb_build_object(
      'organizationId', v_organization_id,
      'ownerUserId', v_actor_user_id,
      'projectId', project_id,
      'rootPackageId', project_id
    );

    insert into projectceo_foundation.command_records (
      organization_id,
      project_id,
      operation,
      key_digest,
      request_digest,
      actor_type,
      actor_id,
      actor_user_id,
      logical_result,
      resulting_state_revision
    )
    values (
      v_organization_id,
      project_id,
      'enroll_organization_project',
      v_key_digest,
      v_request_digest,
      'human',
      v_actor_user_id::text,
      v_actor_user_id,
      v_result,
      v_state_revision
    );

    return jsonb_build_object(
      'operation', 'enroll_organization_project',
      'replay', true,
      'stateRevision', v_state_revision,
      'result', v_result
    );
  end if;

  select o.id
    into v_organization_id
  from project_intelligence.organizations o
  where o.legacy_designer_id = v_actor_user_id
  for update;

  if not found then
    v_organization_id := extensions.gen_random_uuid();
    insert into project_intelligence.organizations (
      id,
      cell_code,
      edition,
      legacy_designer_id,
      status
    )
    values (
      v_organization_id,
      'ru',
      'renovation',
      v_actor_user_id,
      'active'
    );
  end if;

  insert into project_intelligence.organization_members (
    organization_id,
    user_id,
    role,
    status
  )
  values (v_organization_id, v_actor_user_id, 'owner', 'active')
  on conflict (organization_id, user_id) do nothing;

  insert into project_intelligence.member_capabilities (
    organization_id,
    user_id,
    capability
  )
  select v_organization_id, v_actor_user_id, capability
  from unnest(array[
    'review_claim',
    'publish_version',
    'revise_decision',
    'calculate_change_impact',
    'review_change_impact',
    'build_logical_handoff'
  ]::text[]) capability
  on conflict do nothing;

  insert into project_intelligence.project_workflows (
    organization_id,
    project_id,
    state_revision
  )
  values (v_organization_id, project_id, 0);

  v_result := jsonb_build_object(
    'organizationId', v_organization_id,
    'ownerUserId', v_actor_user_id,
    'projectId', project_id,
    'rootPackageId', project_id
  );

  return projectceo_foundation._complete_project_command(
    v_organization_id,
    project_id,
    'enroll_organization_project',
    v_key_digest,
    v_request_digest,
    'human',
    v_actor_user_id::text,
    v_actor_user_id,
    v_result,
    'project_enrolled',
    jsonb_build_object(
      'organization_id', v_organization_id,
      'project_id', project_id,
      'root_package_id', project_id
    ),
    0
  );
end
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
  v_invitation_id uuid := extensions.gen_random_uuid();
  v_normalized_email text := lower(btrim(coalesce(recipient_email, '')));
  v_scope text := case when package_id is null then 'project' else 'package' end;
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

  select pw.state_revision
    into v_state_revision
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
  if v_replay is not null then
    return v_replay;
  end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_foundation._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

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
    created_by_user_id
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
    v_context.actor_user_id
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
  v_email_confirmed boolean := false;
  v_claim_verified boolean :=
    lower(coalesce(
      current_setting('request.jwt.claim.email_verified', true),
      'false'
    )) = 'true';
  v_invitation projectceo_foundation.invitations%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
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

  select lower(btrim(u.email)),
         (to_jsonb(u) ->> 'email_confirmed_at') is not null
    into v_email, v_email_confirmed
  from auth.users u
  where u.id = v_actor_user_id;

  if v_email is null or not (v_email_confirmed or v_claim_verified) then
    perform projectceo_foundation._raise(
      'P1102',
      'identity_unverified',
      '{}'::jsonb
    );
  end if;

  select *
    into v_invitation
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
  if v_invitation.recipient_email <> v_email then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"RECIPIENT_IDENTITY_MISMATCH"}'::jsonb
    );
  end if;
  if exists (
    select 1
    from projectceo_foundation.invitation_events ie
    where ie.organization_id = v_invitation.organization_id
      and ie.project_id = v_invitation.project_id
      and ie.invitation_id = v_invitation.invitation_id
      and ie.event_type = 'revoked'
  ) then
    perform projectceo_foundation._raise('P1106', 'revoked', '{}'::jsonb);
  end if;
  if v_invitation.expires_at <= statement_timestamp()
     or exists (
       select 1
       from projectceo_foundation.invitation_events ie
       where ie.organization_id = v_invitation.organization_id
         and ie.project_id = v_invitation.project_id
         and ie.invitation_id = v_invitation.invitation_id
         and ie.event_type = 'expired'
     ) then
    perform projectceo_foundation._raise('P1105', 'expired', '{}'::jsonb);
  end if;

  v_result := jsonb_build_object(
    'invitationId', v_invitation.invitation_id,
    'organizationId', v_invitation.organization_id,
    'packageId', v_invitation.package_id,
    'projectId', v_invitation.project_id,
    'role', v_invitation.role,
    'scope', v_invitation.scope_kind,
    'userId', v_actor_user_id
  );

  if exists (
    select 1
    from projectceo_foundation.invitation_events ie
    where ie.organization_id = v_invitation.organization_id
      and ie.project_id = v_invitation.project_id
      and ie.invitation_id = v_invitation.invitation_id
      and ie.event_type = 'accepted'
      and ie.accepted_user_id = v_actor_user_id
  ) then
    select pw.state_revision into v_state_revision
    from project_intelligence.project_workflows pw
    where pw.organization_id = v_invitation.organization_id
      and pw.project_id = v_invitation.project_id;
    return jsonb_build_object(
      'operation', 'accept_invitation',
      'replay', true,
      'stateRevision', v_state_revision,
      'result', v_result
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'invitationId', v_invitation.invitation_id,
    'userId', v_actor_user_id
  ));

  select pw.state_revision
    into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_invitation.organization_id
    and pw.project_id = v_invitation.project_id
  for update;

  v_replay := projectceo_foundation._replay_or_null(
    v_invitation.organization_id,
    v_invitation.project_id,
    'accept_invitation',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  insert into project_intelligence.organization_members (
    organization_id,
    user_id,
    role,
    status
  )
  values (
    v_invitation.organization_id,
    v_actor_user_id,
    'member',
    'active'
  )
  on conflict (organization_id, user_id) do nothing;

  if v_invitation.scope_kind = 'project' then
    insert into projectceo_foundation.project_memberships (
      organization_id,
      project_id,
      user_id,
      role,
      status
    )
    values (
      v_invitation.organization_id,
      v_invitation.project_id,
      v_actor_user_id,
      v_invitation.role,
      'active'
    );

    insert into projectceo_foundation.project_member_capabilities (
      organization_id,
      project_id,
      user_id,
      capability
    )
    select
      v_invitation.organization_id,
      v_invitation.project_id,
      v_actor_user_id,
      rc.capability
    from projectceo_foundation._role_capabilities(v_invitation.role) rc;
  else
    insert into projectceo_foundation.package_memberships (
      organization_id,
      project_id,
      package_id,
      user_id,
      role,
      status
    )
    values (
      v_invitation.organization_id,
      v_invitation.project_id,
      v_invitation.package_id,
      v_actor_user_id,
      v_invitation.role,
      'active'
    );

    insert into projectceo_foundation.package_member_capabilities (
      organization_id,
      project_id,
      package_id,
      user_id,
      capability
    )
    select
      v_invitation.organization_id,
      v_invitation.project_id,
      v_invitation.package_id,
      v_actor_user_id,
      rc.capability
    from projectceo_foundation._package_role_capabilities(v_invitation.role) rc;
  end if;

  insert into projectceo_foundation.invitation_events (
    organization_id,
    project_id,
    invitation_id,
    event_type,
    actor_type,
    actor_user_id,
    accepted_user_id
  )
  values (
    v_invitation.organization_id,
    v_invitation.project_id,
    v_invitation.invitation_id,
    'accepted',
    'human',
    v_actor_user_id,
    v_actor_user_id
  );

  return projectceo_foundation._complete_project_command(
    v_invitation.organization_id,
    v_invitation.project_id,
    'accept_invitation',
    v_key_digest,
    v_request_digest,
    'human',
    v_actor_user_id::text,
    v_actor_user_id,
    v_result,
    'invitation_accepted',
    jsonb_build_object(
      'invitation_id', v_invitation.invitation_id,
      'package_id', v_invitation.package_id,
      'role', v_invitation.role,
      'scope', v_invitation.scope_kind
    ),
    v_state_revision
  );
end
$function$;

create or replace function projectceo_api.revoke_invitation(
  project_id uuid,
  invitation_id uuid,
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
  v_invitation projectceo_foundation.invitations%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'manage_access'
  );
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  select * into v_invitation
  from projectceo_foundation.invitations i
  where i.organization_id = v_context.organization_id
    and i.project_id = project_id
    and i.invitation_id = invitation_id
  for update;
  if not found then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"invitation"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object('invitationId', invitation_id)
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_foundation._replay_or_null(
    v_context.organization_id,
    project_id,
    'revoke_invitation',
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
    select 1 from projectceo_foundation.invitation_events ie
    where ie.organization_id = v_context.organization_id
      and ie.project_id = project_id
      and ie.invitation_id = invitation_id
      and ie.event_type = 'accepted'
  ) then
    perform projectceo_foundation._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"INVITATION_ALREADY_ACCEPTED"}'::jsonb
    );
  end if;

  insert into projectceo_foundation.invitation_events (
    organization_id,
    project_id,
    invitation_id,
    event_type,
    actor_type,
    actor_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    invitation_id,
    'revoked',
    'human',
    v_context.actor_user_id
  );
  v_result := jsonb_build_object(
    'invitationId', invitation_id,
    'revoked', true
  );
  return projectceo_foundation._complete_project_command(
    v_context.organization_id,
    project_id,
    'revoke_invitation',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'invitation_revoked',
    jsonb_build_object('invitation_id', invitation_id),
    v_state_revision
  );
end
$function$;

create or replace function projectceo_api.expire_invitation(
  project_id uuid,
  invitation_id uuid,
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
  v_organization_id uuid;
  v_invitation projectceo_foundation.invitations%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  select pw.organization_id, pw.state_revision
    into v_organization_id, v_state_revision
  from project_intelligence.project_workflows pw
  join project_intelligence.organizations o
    on o.id = pw.organization_id
   and o.status = 'active'
  where pw.project_id = project_id
  for update of pw;
  if not found then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"project"}'::jsonb
    );
  end if;
  select * into v_invitation
  from projectceo_foundation.invitations i
  where i.organization_id = v_organization_id
    and i.project_id = project_id
    and i.invitation_id = invitation_id
  for update;
  if not found then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"invitation"}'::jsonb
    );
  end if;
  if v_invitation.expires_at > statement_timestamp() then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"reason":"INVITATION_NOT_EXPIRED"}'::jsonb
    );
  end if;
  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object('invitationId', invitation_id)
  );
  v_replay := projectceo_foundation._replay_or_null(
    v_organization_id,
    project_id,
    'expire_invitation',
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
  insert into projectceo_foundation.invitation_events (
    organization_id,
    project_id,
    invitation_id,
    event_type,
    actor_type
  )
  values (
    v_organization_id,
    project_id,
    invitation_id,
    'expired',
    'system'
  );
  v_result := jsonb_build_object(
    'expired', true,
    'invitationId', invitation_id
  );
  return projectceo_foundation._complete_project_command(
    v_organization_id,
    project_id,
    'expire_invitation',
    v_key_digest,
    v_request_digest,
    'system',
    'system:projectceo-foundation',
    null,
    v_result,
    'invitation_expired',
    jsonb_build_object('invitation_id', invitation_id),
    v_state_revision
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
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_grant_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'distribute_release'
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
  if expires_at <= statement_timestamp()
     or expires_at > statement_timestamp() + interval '7 days' then
    perform projectceo_foundation._raise(
      'P1111',
      'validation_failed',
      '{"field":"expiresAt"}'::jsonb
    );
  end if;
  if not exists (
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
  if not exists (
    select 1
    from project_intelligence.project_versions pv
    where pv.organization_id = v_context.organization_id
      and pv.project_id = project_id
      and pv.version_id = version_id
  ) then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"version"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'allowAcknowledgement', allow_acknowledgement,
    'expiresAt', expires_at,
    'packageId', package_id,
    'tokenDigest', encode(token_digest, 'hex'),
    'versionId', version_id
  ));
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_foundation._replay_or_null(
    v_context.organization_id,
    project_id,
    'create_guest_access_grant',
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

  insert into projectceo_foundation.guest_access_grants (
    organization_id,
    project_id,
    grant_id,
    package_id,
    version_id,
    token_digest,
    allow_acknowledgement,
    expires_at,
    created_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    v_grant_id,
    package_id,
    version_id,
    token_digest,
    allow_acknowledgement,
    expires_at,
    v_context.actor_user_id
  );
  v_result := jsonb_build_object(
    'allowAcknowledgement', allow_acknowledgement,
    'expiresAt', expires_at,
    'grantId', v_grant_id,
    'packageId', package_id,
    'projectId', project_id,
    'versionId', version_id
  );
  return projectceo_foundation._complete_project_command(
    v_context.organization_id,
    project_id,
    'create_guest_access_grant',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'guest_grant_created',
    jsonb_build_object(
      'allow_acknowledgement', allow_acknowledgement,
      'grant_id', v_grant_id,
      'package_id', package_id,
      'version_id', version_id
    ),
    v_state_revision
  );
end
$function$;

create or replace function projectceo_api.revoke_guest_access_grant(
  project_id uuid,
  grant_id uuid,
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
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'manage_access'
  );
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  if not exists (
    select 1
    from projectceo_foundation.guest_access_grants g
    where g.organization_id = v_context.organization_id
      and g.project_id = project_id
      and g.grant_id = grant_id
  ) then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"grant"}'::jsonb
    );
  end if;
  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object('grantId', grant_id)
  );
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id
  for update;
  v_replay := projectceo_foundation._replay_or_null(
    v_context.organization_id,
    project_id,
    'revoke_guest_access_grant',
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
  insert into projectceo_foundation.guest_access_grant_events (
    organization_id,
    project_id,
    grant_id,
    event_type,
    actor_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    grant_id,
    'revoked',
    v_context.actor_user_id
  );
  v_result := jsonb_build_object('grantId', grant_id, 'revoked', true);
  return projectceo_foundation._complete_project_command(
    v_context.organization_id,
    project_id,
    'revoke_guest_access_grant',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'guest_grant_revoked',
    jsonb_build_object('grant_id', grant_id),
    v_state_revision
  );
end
$function$;

do $append_only$
declare
  v_table text;
begin
  foreach v_table in array array[
    'project_packages',
    'invitations',
    'invitation_events',
    'guest_access_grants',
    'guest_access_grant_events',
    'command_records',
    'audit_events'
  ]
  loop
    execute format(
      'create trigger %I before update or delete on projectceo_foundation.%I '
      || 'for each row execute function '
      || 'projectceo_foundation.reject_append_only_mutation()',
      v_table || '_append_only',
      v_table
    );
  end loop;
end
$append_only$;

do $foundation_table_security$
declare
  v_table text;
begin
  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'projectceo_foundation'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table projectceo_foundation.%I owner to pi_table_owner',
      v_table
    );
    execute format(
      'alter table projectceo_foundation.%I enable row level security',
      v_table
    );
    execute format(
      'alter table projectceo_foundation.%I force row level security',
      v_table
    );
    execute format(
      'revoke all on table projectceo_foundation.%I '
      || 'from public, anon, authenticated, service_role, '
      || 'pi_human_executor, pi_worker_executor',
      v_table
    );
    execute format(
      'create policy %I on projectceo_foundation.%I '
      || 'for all to pi_table_owner using (true) with check (true)',
      v_table || '_internal_owner',
      v_table
    );
  end loop;
end
$foundation_table_security$;

create policy organizations_foundation_internal
on project_intelligence.organizations
for all to pi_table_owner
using (true)
with check (true);
create policy organization_members_foundation_internal
on project_intelligence.organization_members
for all to pi_table_owner
using (true)
with check (true);
create policy member_capabilities_foundation_internal
on project_intelligence.member_capabilities
for all to pi_table_owner
using (true)
with check (true);
create policy project_workflows_foundation_internal
on project_intelligence.project_workflows
for all to pi_table_owner
using (true)
with check (true);

grant usage on schema auth to pi_table_owner;
grant execute on function auth.uid() to pi_table_owner;
grant select on table auth.users to pi_table_owner;
grant select, update on table public.projects to pi_table_owner;

create policy projects_projectceo_enrollment_select
on public.projects
for select to pi_table_owner
using (designer_id = (select auth.uid()));
create policy projects_projectceo_enrollment_lock
on public.projects
for update to pi_table_owner
using (designer_id = (select auth.uid()))
with check (designer_id = (select auth.uid()));

alter function projectceo_foundation.reject_append_only_mutation()
  owner to pi_table_owner;
alter function projectceo_foundation._raise(text, text, jsonb)
  owner to pi_table_owner;
alter function projectceo_foundation._assert_idempotency_key(text)
  owner to pi_table_owner;
alter function projectceo_foundation._assert_state_revision(bigint)
  owner to pi_table_owner;
alter function projectceo_foundation._role_capabilities(text)
  owner to pi_table_owner;
alter function projectceo_foundation._package_role_capabilities(text)
  owner to pi_table_owner;
alter function projectceo_foundation._authorize_project_human(uuid, text)
  owner to pi_table_owner;
alter function projectceo_foundation._authorize_package_human(uuid, uuid, text)
  owner to pi_table_owner;
alter function projectceo_foundation._replay_or_null(
  uuid, uuid, text, bytea, bytea
) owner to pi_table_owner;
alter function projectceo_foundation._complete_project_command(
  uuid, uuid, text, bytea, bytea, text, text, uuid, jsonb, text, jsonb, bigint
) owner to pi_table_owner;
alter function projectceo_foundation._bootstrap_project_scope()
  owner to pi_table_owner;
alter function projectceo_foundation.validate_package_parent_cycle()
  owner to pi_table_owner;
alter function project_intelligence._human_context(uuid, text)
  owner to pi_table_owner;

alter function projectceo_api.enroll_organization_project(uuid, text)
  owner to pi_table_owner;
alter function projectceo_api.create_invitation(
  uuid, uuid, text, text, timestamptz, bytea, bigint, text
) owner to pi_table_owner;
alter function projectceo_api.accept_invitation(bytea, text)
  owner to pi_table_owner;
alter function projectceo_api.revoke_invitation(uuid, uuid, bigint, text)
  owner to pi_table_owner;
alter function projectceo_api.expire_invitation(uuid, uuid, bigint, text)
  owner to pi_table_owner;
alter function projectceo_api.create_guest_access_grant(
  uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
) owner to pi_table_owner;
alter function projectceo_api.revoke_guest_access_grant(
  uuid, uuid, bigint, text
) owner to pi_table_owner;

revoke all on all functions in schema projectceo_foundation
  from public, anon, authenticated, service_role;
grant usage on schema projectceo_foundation
  to pi_human_executor;
grant execute on function
  projectceo_foundation._authorize_project_human(uuid, text)
  to pi_human_executor;

revoke all on all functions in schema projectceo_api
  from public, anon, authenticated, service_role;
revoke create on schema projectceo_api from public;
grant usage on schema projectceo_api to authenticated, service_role;
grant execute on function
  projectceo_api.enroll_organization_project(uuid, text),
  projectceo_api.create_invitation(
    uuid, uuid, text, text, timestamptz, bytea, bigint, text
  ),
  projectceo_api.accept_invitation(bytea, text),
  projectceo_api.revoke_invitation(uuid, uuid, bigint, text),
  projectceo_api.create_guest_access_grant(
    uuid, uuid, text, boolean, timestamptz, bytea, bigint, text
  ),
  projectceo_api.revoke_guest_access_grant(uuid, uuid, bigint, text)
  to authenticated;
grant execute on function
  projectceo_api.expire_invitation(uuid, uuid, bigint, text)
  to service_role;

commit;
