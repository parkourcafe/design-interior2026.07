-- RemHaOS Integration Gateway PR2: project URL references.
--
-- Additive only. These are link-only references, not provider connections or
-- synchronization state. Creating a link never performs a network request.

begin;

set local check_function_bodies = on;

alter table remhaos_integration.command_records
  drop constraint if exists command_records_operation_check;
alter table remhaos_integration.command_records
  add constraint command_records_operation_check
  check (operation in (
    'activate_oauth_connection',
    'disconnect_integration_connection',
    'bind_project_connection',
    'unbind_project_connection',
    'create_project_link',
    'revise_project_link',
    'archive_project_link',
    'publish_project_link_to_client',
    'review_import_candidate',
    'record_verified_webhook',
    'enqueue_integration_job',
    'complete_integration_job',
    'fail_integration_job',
    'upsert_external_object',
    'create_import_candidate'
  ));

create function remhaos_integration._normalize_project_link_url(p_value text)
returns table (normalized_url text, domain text)
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := btrim(coalesce(p_value, ''));
  v_no_fragment text;
  v_authority text;
  v_host text;
  v_port text := '';
  v_scheme text;
  v_suffix text;
  v_query text;
  v_query_start integer;
  v_octets text[];
  v_second_octet integer;
begin
  if length(v_value) < 1
     or length(v_value) > 4096
     or v_value ~ '[[:cntrl:][:space:]]' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"url"}'::jsonb
    );
  end if;

  v_no_fragment := split_part(v_value, '#', 1);
  if v_no_fragment !~* '^https?://' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"url","reason":"SCHEME_NOT_ALLOWED"}'::jsonb
    );
  end if;

  v_scheme := lower(substring(v_no_fragment from '^([a-z]+)://'));
  v_authority := substring(v_no_fragment from '^[a-z][a-z0-9+.-]*://([^/?#]*)');
  if v_authority is null or v_authority = '' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"url","reason":"HOST_REQUIRED"}'::jsonb
    );
  end if;

  -- Reject userinfo, encoded authority characters and IPv6 literals. The
  -- latter keeps the no-fetch policy deterministic across environments.
  if v_authority ~ '@'
     or v_authority ~* '%[0-9a-f]{2}'
     or v_authority ~ '[\[\]]' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"url","reason":"AUTHORITY_NOT_ALLOWED"}'::jsonb
    );
  end if;

  v_port := coalesce(substring(v_authority from '(:[0-9]{1,5})$'), '');
  if v_port = '' and v_authority ~ ':' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"url","reason":"PORT_NOT_ALLOWED"}'::jsonb
    );
  end if;
  if v_port <> '' and substring(v_port from 2)::integer > 65535 then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"url","reason":"PORT_NOT_ALLOWED"}'::jsonb
    );
  end if;
  v_host := lower(
    case
      when v_port <> '' then left(v_authority, length(v_authority) - length(v_port))
      else v_authority
    end
  );

  if v_host = ''
     or v_host ~ ':'
     or v_host ~ '^[0-9]+$'
     or v_host = 'localhost'
     or v_host like '%.localhost'
     or v_host like '%.local'
     or v_host like '%.internal'
     or v_host like '%.lan'
     or v_host like '%.home'
     or v_host like '%.test'
     or v_host like '%.invalid' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"url","reason":"PRIVATE_HOST_NOT_ALLOWED"}'::jsonb
    );
  end if;

  if v_host ~ '^[0-9]+(\.[0-9]+){3}$' then
    v_octets := string_to_array(v_host, '.');
    if exists (
      select 1
      from unnest(v_octets) octet
      where octet::integer > 255
    ) then
      perform remhaos_integration._raise(
        'P1211',
        'validation_failed',
        '{"field":"url","reason":"HOST_NOT_ALLOWED"}'::jsonb
      );
    end if;
    v_second_octet := v_octets[2]::integer;
    if v_octets[1]::integer = 0
       or v_octets[1]::integer = 10
       or v_octets[1]::integer = 127
       or (v_octets[1]::integer = 169 and v_second_octet = 254)
       or (v_octets[1]::integer = 172 and v_second_octet between 16 and 31)
       or (v_octets[1]::integer = 192 and v_second_octet = 168) then
      perform remhaos_integration._raise(
        'P1211',
        'validation_failed',
        '{"field":"url","reason":"PRIVATE_HOST_NOT_ALLOWED"}'::jsonb
      );
    end if;
  end if;

  v_query_start := strpos(v_no_fragment, '?');
  if v_query_start > 0 then
    v_query := substring(v_no_fragment from v_query_start + 1);
    if v_query ~* '(^|&)(token|key|secret|signature|auth|code|access_token|refresh_token|client_secret|credential|password|private_key|jwt|state)(=|&|$)'
       or v_query ~* '(^|&)[^=&]*%[0-9a-f]{2}' then
      perform remhaos_integration._raise(
        'P1211',
        'validation_failed',
        '{"field":"url","reason":"SECRET_QUERY_NOT_ALLOWED"}'::jsonb
      );
    end if;
  end if;

  v_suffix := regexp_replace(
    v_no_fragment,
    '^[a-z][a-z0-9+.-]*://[^/?#]*',
    '',
    1,
    1,
    'i'
  );
  normalized_url := v_scheme || '://' || v_host || v_port || v_suffix;
  domain := v_host;
  return next;
end
$function$;

create function remhaos_integration._assert_project_link_category(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_value text := lower(btrim(coalesce(p_value, '')));
begin
  if v_value not in ('reference', 'product', 'vendor', 'legal', 'ai', 'tool', 'other') then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"category"}'::jsonb
    );
  end if;
  return v_value;
end
$function$;

create function remhaos_integration._assert_project_link_tags(p_values text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_values text[] := coalesce(p_values, array[]::text[]);
begin
  if cardinality(v_values) > 12
     or array_position(v_values, null) is not null
     or exists (
       select 1
       from unnest(v_values) tag
       where length(btrim(tag)) < 1
          or length(btrim(tag)) > 40
          or btrim(tag) <> tag
          or tag ~ '[[:cntrl:]]'
     ) then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"tags"}'::jsonb
    );
  end if;
  return v_values;
end
$function$;

create table remhaos_integration.project_links (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  category text not null
    check (category in ('reference', 'product', 'vendor', 'legal', 'ai', 'tool', 'other')),
  domain text not null
    check (
      char_length(btrim(domain)) between 1 and 255
      and domain = lower(btrim(domain))
      and domain !~ '[[:cntrl:][:space:]]'
    ),
  title text not null
    check (
      char_length(btrim(title)) between 1 and 200
      and title = btrim(title)
      and title !~ '[[:cntrl:]]'
    ),
  tags text[] not null default array[]::text[]
    check (tags = remhaos_integration._assert_project_link_tags(tags)),
  visibility text not null default 'candidate'
    check (visibility in ('internal', 'candidate', 'published_to_client')),
  current_revision_no integer not null default 1
    check (current_revision_no > 0),
  published_revision_no integer
    check (published_revision_no is null or published_revision_no > 0),
  created_by uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  published_by uuid,
  published_at timestamptz,
  archived_at timestamptz,
  constraint project_links_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint project_links_creator_fkey
    foreign key (organization_id, project_id, created_by)
    references projectceo_foundation.project_memberships (organization_id, project_id, user_id)
    on delete restrict,
  constraint project_links_publisher_fkey
    foreign key (organization_id, project_id, published_by)
    references projectceo_foundation.project_memberships (organization_id, project_id, user_id)
    on delete restrict,
  constraint project_links_publish_shape_check
    check (
      (
        published_revision_no is null
        and published_by is null
        and published_at is null
      )
      or (
        published_revision_no is not null
        and published_by is not null
        and published_at is not null
        and visibility = 'published_to_client'
      )
    ),
  constraint project_links_scope_id_key unique (organization_id, project_id, id)
);

create table remhaos_integration.project_link_revisions (
  organization_id uuid not null,
  project_id uuid not null,
  link_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  normalized_url text not null
    check (
      char_length(normalized_url) between 1 and 4096
      and normalized_url ~* '^https?://'
      and normalized_url !~ '[[:cntrl:][:space:]]'
    ),
  url_hash bytea not null check (octet_length(url_hash) = 32),
  note text
    check (
      note is null
      or (
        char_length(btrim(note)) between 1 and 2000
        and note = btrim(note)
        and note !~ '[[:cntrl:]]'
      )
    ),
  room_id uuid,
  selection_id uuid,
  decision_id uuid,
  captured_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  constraint project_link_revisions_link_fkey
    foreign key (organization_id, project_id, link_id)
    references remhaos_integration.project_links (organization_id, project_id, id)
    on delete restrict,
  constraint project_link_revisions_creator_fkey
    foreign key (organization_id, project_id, created_by)
    references projectceo_foundation.project_memberships (organization_id, project_id, user_id)
    on delete restrict,
  constraint project_link_revisions_scope_key
    unique (organization_id, project_id, link_id, revision_no),
  constraint project_link_revisions_link_revision_key
    unique (link_id, revision_no)
);

create index project_links_project_idx
  on remhaos_integration.project_links (organization_id, project_id, created_at desc)
  where archived_at is null;
create index project_links_created_by_idx
  on remhaos_integration.project_links (organization_id, project_id, created_by);
create index project_links_published_by_idx
  on remhaos_integration.project_links (organization_id, project_id, published_by)
  where published_by is not null;
create index project_link_revisions_project_idx
  on remhaos_integration.project_link_revisions (organization_id, project_id, captured_at desc);
create index project_link_revisions_created_by_idx
  on remhaos_integration.project_link_revisions (organization_id, project_id, created_by);

create trigger project_link_revisions_append_only
  before update or delete on remhaos_integration.project_link_revisions
  for each row execute function remhaos_integration.reject_append_only_mutation();

create function remhaos_integration_api.list_project_links(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_client_projection boolean;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'view_project');

  select exists (
    select 1
    from projectceo_foundation.project_memberships membership
    where membership.organization_id = v_context.organization_id
      and membership.project_id = p_project_id
      and membership.user_id = v_context.actor_user_id
      and membership.role = 'client_approver'
      and membership.status = 'active'
  ) into v_client_projection;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'linkId', link.id,
        'category', link.category,
        'domain', link.domain,
        'title', link.title,
        'tags', link.tags,
        'visibility', link.visibility,
        'currentRevisionNo', link.current_revision_no,
        'publishedRevisionNo', link.published_revision_no,
        'revisionNo', revision.revision_no,
        'normalizedUrl', revision.normalized_url,
        'note', revision.note,
        'capturedAt', revision.captured_at,
        'createdBy', case when v_client_projection then null else link.created_by end,
        'createdAt', link.created_at,
        'publishedAt', link.published_at,
        'clientProjection', v_client_projection
      )
      order by link.created_at desc, link.id
    )
    from remhaos_integration.project_links link
    join remhaos_integration.project_link_revisions revision
      on revision.organization_id = link.organization_id
     and revision.project_id = link.project_id
     and revision.link_id = link.id
     and revision.revision_no = case
       when v_client_projection then link.published_revision_no
       else link.current_revision_no
     end
    where link.organization_id = v_context.organization_id
      and link.project_id = p_project_id
      and link.archived_at is null
      and (
        not v_client_projection
        or link.visibility = 'published_to_client'
      )
      and (
        not v_client_projection
        or link.published_revision_no is not null
      )
  ), '[]'::jsonb);
end
$function$;

create function remhaos_integration_api.get_project_link_access(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'view_project');

  return jsonb_build_object(
    'clientProjection', exists (
      select 1
      from projectceo_foundation.project_memberships membership
      where membership.organization_id = v_context.organization_id
        and membership.project_id = p_project_id
        and membership.user_id = v_context.actor_user_id
        and membership.role = 'client_approver'
        and membership.status = 'active'
    ),
    'canContribute', exists (
      select 1
      from projectceo_foundation.project_member_capabilities capability
      where capability.organization_id = v_context.organization_id
        and capability.project_id = p_project_id
        and capability.user_id = v_context.actor_user_id
        and capability.capability = 'register_source'
    ),
    'canPublish', exists (
      select 1
      from projectceo_foundation.project_member_capabilities capability
      where capability.organization_id = v_context.organization_id
        and capability.project_id = p_project_id
        and capability.user_id = v_context.actor_user_id
        and capability.capability = 'publish_baseline'
    )
  );
end
$function$;

create function remhaos_integration_api.create_project_link(
  p_project_id uuid,
  p_category text,
  p_title text,
  p_url text,
  p_tags text[],
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_category text := remhaos_integration._assert_project_link_category(p_category);
  v_title text := remhaos_integration._assert_safe_text(p_title, 'title', 200);
  v_tags text[] := remhaos_integration._assert_project_link_tags(p_tags);
  v_note text := remhaos_integration._assert_safe_text(p_note, 'note', 2000, false);
  v_url record;
  v_link remhaos_integration.project_links%rowtype;
  v_revision remhaos_integration.project_link_revisions%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'register_source');
  select * into v_url
  from remhaos_integration._normalize_project_link_url(p_url);

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'actorId', v_context.actor_id,
    'projectId', p_project_id,
    'category', v_category,
    'title', v_title,
    'url', v_url.normalized_url,
    'tags', to_jsonb(v_tags),
    'note', v_note
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id,
    p_project_id,
    'create_project_link',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  insert into remhaos_integration.project_links (
    organization_id, project_id, category, domain, title, tags, visibility, created_by
  ) values (
    v_context.organization_id, p_project_id, v_category, v_url.domain,
    v_title, v_tags, 'candidate', v_context.actor_user_id
  ) returning * into v_link;

  insert into remhaos_integration.project_link_revisions (
    organization_id, project_id, link_id, revision_no, normalized_url,
    url_hash, note, created_by
  ) values (
    v_context.organization_id, p_project_id, v_link.id, 1, v_url.normalized_url,
    project_intelligence._sha256_text(v_url.normalized_url), v_note,
    v_context.actor_user_id
  ) returning * into v_revision;

  v_result := jsonb_build_object(
    'linkId', v_link.id,
    'revisionNo', v_revision.revision_no,
    'visibility', v_link.visibility,
    'domain', v_link.domain,
    'normalizedUrl', v_revision.normalized_url
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'create_project_link',
    v_key_digest, v_request_digest, 'human', v_context.actor_id,
    v_context.actor_user_id, v_result, 'project_link_created', 'created',
    jsonb_build_object('category', v_category, 'tagCount', cardinality(v_tags))
  );
end
$function$;

create function remhaos_integration_api.revise_project_link(
  p_project_id uuid,
  p_link_id uuid,
  p_url text,
  p_tags text[],
  p_note text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_link remhaos_integration.project_links%rowtype;
  v_current remhaos_integration.project_link_revisions%rowtype;
  v_revision remhaos_integration.project_link_revisions%rowtype;
  v_url record;
  v_tags text[] := remhaos_integration._assert_project_link_tags(p_tags);
  v_note text := remhaos_integration._assert_safe_text(p_note, 'note', 2000, false);
  v_reason text := remhaos_integration._assert_safe_text(p_reason, 'reason', 500, false);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'register_source');
  select * into v_link
  from remhaos_integration.project_links link
  where link.organization_id = v_context.organization_id
    and link.project_id = p_project_id
    and link.id = p_link_id
  for update;
  if not found or v_link.archived_at is not null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"projectLink"}'::jsonb);
  end if;
  select * into v_current
  from remhaos_integration.project_link_revisions revision
  where revision.organization_id = v_link.organization_id
    and revision.project_id = v_link.project_id
    and revision.link_id = v_link.id
    and revision.revision_no = v_link.current_revision_no;
  select * into v_url
  from remhaos_integration._normalize_project_link_url(p_url);
  if v_current.normalized_url = v_url.normalized_url and v_reason is null then
    perform remhaos_integration._raise(
      'P1211', 'validation_failed',
      '{"field":"reason","reason":"DUPLICATE_URL_NEEDS_CONTEXT"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'actorId', v_context.actor_id,
    'projectId', p_project_id,
    'linkId', p_link_id,
    'url', v_url.normalized_url,
    'tags', to_jsonb(v_tags),
    'note', v_note,
    'reason', v_reason
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'revise_project_link',
    v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  insert into remhaos_integration.project_link_revisions (
    organization_id, project_id, link_id, revision_no, normalized_url,
    url_hash, note, created_by
  ) values (
    v_link.organization_id, v_link.project_id, v_link.id,
    v_link.current_revision_no + 1, v_url.normalized_url,
    project_intelligence._sha256_text(v_url.normalized_url), v_note,
    v_context.actor_user_id
  ) returning * into v_revision;

  update remhaos_integration.project_links
  set current_revision_no = v_revision.revision_no,
      tags = v_tags
  where organization_id = v_link.organization_id
    and project_id = v_link.project_id
    and id = v_link.id;

  v_result := jsonb_build_object(
    'linkId', v_link.id,
    'revisionNo', v_revision.revision_no,
    'publishedRevisionNo', v_link.published_revision_no,
    'domain', v_url.domain,
    'normalizedUrl', v_revision.normalized_url
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'revise_project_link',
    v_key_digest, v_request_digest, 'human', v_context.actor_id,
    v_context.actor_user_id, v_result, 'project_link_revised', 'created',
    jsonb_build_object('reasonProvided', v_reason is not null)
  );
end
$function$;

create function remhaos_integration_api.archive_project_link(
  p_project_id uuid,
  p_link_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_link remhaos_integration.project_links%rowtype;
  v_reason text := remhaos_integration._assert_reason(p_reason);
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'register_source');
  select * into v_link
  from remhaos_integration.project_links link
  where link.organization_id = v_context.organization_id
    and link.project_id = p_project_id
    and link.id = p_link_id
  for update;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"projectLink"}'::jsonb);
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'actorId', v_context.actor_id,
    'projectId', p_project_id,
    'linkId', p_link_id,
    'reason', v_reason
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'archive_project_link',
    v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_link.archived_at is not null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"projectLink"}'::jsonb);
  end if;

  update remhaos_integration.project_links
  set archived_at = statement_timestamp()
  where organization_id = v_link.organization_id
    and project_id = v_link.project_id
    and id = v_link.id;

  v_result := jsonb_build_object('linkId', v_link.id, 'archived', true);
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'archive_project_link',
    v_key_digest, v_request_digest, 'human', v_context.actor_id,
    v_context.actor_user_id, v_result, 'project_link_archived', 'archived',
    jsonb_build_object('reasonCode', 'human_requested')
  );
end
$function$;

create function remhaos_integration_api.publish_project_link_to_client(
  p_project_id uuid,
  p_link_id uuid,
  p_revision_no integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_link remhaos_integration.project_links%rowtype;
  v_revision remhaos_integration.project_link_revisions%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(p_project_id, 'publish_baseline');
  select * into v_link
  from remhaos_integration.project_links link
  where link.organization_id = v_context.organization_id
    and link.project_id = p_project_id
    and link.id = p_link_id
  for update;
  if not found or v_link.archived_at is not null then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"projectLink"}'::jsonb);
  end if;
  if p_revision_no is null or p_revision_no < 1 or p_revision_no > v_link.current_revision_no then
    perform remhaos_integration._raise('P1211', 'validation_failed', '{"field":"revisionNo"}'::jsonb);
  end if;
  select * into v_revision
  from remhaos_integration.project_link_revisions revision
  where revision.organization_id = v_link.organization_id
    and revision.project_id = v_link.project_id
    and revision.link_id = v_link.id
    and revision.revision_no = p_revision_no;
  if not found then
    perform remhaos_integration._raise('P1204', 'not_found', '{"entity":"projectLinkRevision"}'::jsonb);
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'actorId', v_context.actor_id,
    'projectId', p_project_id,
    'linkId', p_link_id,
    'revisionNo', p_revision_no
  ));
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id, p_project_id, 'publish_project_link_to_client',
    v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  update remhaos_integration.project_links
  set visibility = 'published_to_client',
      published_revision_no = p_revision_no,
      published_by = v_context.actor_user_id,
      published_at = statement_timestamp()
  where organization_id = v_link.organization_id
    and project_id = v_link.project_id
    and id = v_link.id;

  v_result := jsonb_build_object(
    'linkId', v_link.id,
    'publishedRevisionNo', p_revision_no,
    'normalizedUrl', v_revision.normalized_url,
    'visibility', 'published_to_client'
  );
  return remhaos_integration._complete_command(
    v_context.organization_id, p_project_id, 'publish_project_link_to_client',
    v_key_digest, v_request_digest, 'human', v_context.actor_id,
    v_context.actor_user_id, v_result, 'project_link_published_to_client', 'published',
    jsonb_build_object('revisionNo', p_revision_no)
  );
end
$function$;

do $project_links_table_security$
declare
  v_table text;
begin
  foreach v_table in array array['project_links', 'project_link_revisions']
  loop
    execute format('alter table remhaos_integration.%I owner to pi_table_owner', v_table);
    execute format('alter table remhaos_integration.%I enable row level security', v_table);
    execute format('alter table remhaos_integration.%I force row level security', v_table);
    execute format(
      'revoke all on table remhaos_integration.%I from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',
      v_table
    );
    execute format(
      'create policy %I on remhaos_integration.%I for all to pi_table_owner using (true) with check (true)',
      v_table || '_internal_owner',
      v_table
    );
  end loop;
end
$project_links_table_security$;

alter function remhaos_integration._normalize_project_link_url(text)
  owner to pi_table_owner;
alter function remhaos_integration._assert_project_link_category(text)
  owner to pi_table_owner;
alter function remhaos_integration._assert_project_link_tags(text[])
  owner to pi_table_owner;
alter function remhaos_integration_api.list_project_links(uuid)
  owner to pi_table_owner;
alter function remhaos_integration_api.get_project_link_access(uuid)
  owner to pi_table_owner;
alter function remhaos_integration_api.create_project_link(uuid, text, text, text, text[], text, text)
  owner to pi_table_owner;
alter function remhaos_integration_api.revise_project_link(uuid, uuid, text, text[], text, text, text)
  owner to pi_table_owner;
alter function remhaos_integration_api.archive_project_link(uuid, uuid, text, text)
  owner to pi_table_owner;
alter function remhaos_integration_api.publish_project_link_to_client(uuid, uuid, integer, text)
  owner to pi_table_owner;

revoke all on function remhaos_integration._normalize_project_link_url(text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._assert_project_link_category(text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration._assert_project_link_tags(text[])
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.list_project_links(uuid)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.get_project_link_access(uuid)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.create_project_link(uuid, text, text, text, text[], text, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.revise_project_link(uuid, uuid, text, text[], text, text, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.archive_project_link(uuid, uuid, text, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function remhaos_integration_api.publish_project_link_to_client(uuid, uuid, integer, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function
  remhaos_integration_api.list_project_links(uuid),
  remhaos_integration_api.get_project_link_access(uuid),
  remhaos_integration_api.create_project_link(uuid, text, text, text, text[], text, text),
  remhaos_integration_api.revise_project_link(uuid, uuid, text, text[], text, text, text),
  remhaos_integration_api.archive_project_link(uuid, uuid, text, text),
  remhaos_integration_api.publish_project_link_to_client(uuid, uuid, integer, text)
  to authenticated;

commit;
