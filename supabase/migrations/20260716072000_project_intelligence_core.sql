-- Project Intelligence DB2 core persistence.
--
-- Additive only: this migration creates a private, opt-in persistence boundary.
-- It does not rewrite or backfill the legacy public application tables.

begin;

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_table_owner') then
    create role pi_table_owner nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_human_executor') then
    create role pi_human_executor nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_worker_executor') then
    create role pi_worker_executor nologin noinherit nobypassrls;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname in ('pi_table_owner', 'pi_human_executor', 'pi_worker_executor')
      and (
        rolcanlogin
        or rolinherit
        or rolsuper
        or rolcreatedb
        or rolcreaterole
        or rolreplication
        or rolbypassrls
      )
  ) then
    raise exception
      'Project Intelligence roles must be NOLOGIN, NOINHERIT and non-privileged';
  end if;
end
$roles$;

create schema project_intelligence authorization pi_table_owner;
create schema project_intelligence_api authorization pi_table_owner;

revoke all on schema project_intelligence from public, anon, authenticated, service_role;
revoke all on schema project_intelligence_api from public, anon, authenticated, service_role;
grant usage on schema project_intelligence to pi_human_executor, pi_worker_executor;
grant usage on schema project_intelligence_api
  to pi_human_executor, pi_worker_executor;

alter default privileges for role pi_table_owner
  in schema project_intelligence
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role pi_table_owner
  in schema project_intelligence
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role pi_table_owner
  in schema project_intelligence_api
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role pi_table_owner
  in schema project_intelligence_api
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role pi_human_executor
  in schema project_intelligence_api
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role pi_worker_executor
  in schema project_intelligence_api
  revoke execute on functions from public, anon, authenticated, service_role;

create function project_intelligence.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'PROJECT_INTELLIGENCE_APPEND_ONLY',
    detail = format('%I.%I rejects %s', tg_table_schema, tg_table_name, tg_op);
end
$function$;

create function project_intelligence.is_valid_source_locator(
  p_locator_kind text,
  p_locator jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_box jsonb;
  v_numbers numeric[];
  v_start numeric;
  v_end numeric;
begin
  if jsonb_typeof(p_locator) <> 'object'
     or p_locator ->> 'kind' is distinct from p_locator_kind then
    return false;
  end if;

  case p_locator_kind
    when 'pdf' then
      if jsonb_typeof(p_locator -> 'page') <> 'number' then
        return false;
      end if;
      v_start := (p_locator ->> 'page')::numeric;
      if v_start < 1 or trunc(v_start) <> v_start then
        return false;
      end if;
      if p_locator ? 'bbox' then
        v_box := p_locator -> 'bbox';
        if jsonb_typeof(v_box) <> 'array' or jsonb_array_length(v_box) <> 4 then
          return false;
        end if;
        select array_agg(value::numeric order by ordinality)
          into v_numbers
        from jsonb_array_elements_text(v_box) with ordinality;
        if v_numbers[1] < 0 or v_numbers[2] < 0
           or v_numbers[3] > 1 or v_numbers[4] > 1
           or v_numbers[1] >= v_numbers[3]
           or v_numbers[2] >= v_numbers[4] then
          return false;
        end if;
      end if;
    when 'transcript' then
      if jsonb_typeof(p_locator -> 'startMs') <> 'number'
         or jsonb_typeof(p_locator -> 'endMs') <> 'number' then
        return false;
      end if;
      v_start := (p_locator ->> 'startMs')::numeric;
      v_end := (p_locator ->> 'endMs')::numeric;
      if v_start < 0 or trunc(v_start) <> v_start
         or v_end <= v_start or trunc(v_end) <> v_end then
        return false;
      end if;
      if p_locator ? 'speaker'
         and (
           jsonb_typeof(p_locator -> 'speaker') <> 'string'
           or btrim(p_locator ->> 'speaker') = ''
         ) then
        return false;
      end if;
    when 'image' then
      if p_locator ->> 'coordinateSystem' not in ('pixel', 'normalized') then
        return false;
      end if;
      v_box := p_locator -> 'bbox';
      if jsonb_typeof(v_box) <> 'array' or jsonb_array_length(v_box) <> 4 then
        return false;
      end if;
      select array_agg(value::numeric order by ordinality)
        into v_numbers
      from jsonb_array_elements_text(v_box) with ordinality;
      if v_numbers[1] < 0 or v_numbers[2] < 0
         or v_numbers[1] >= v_numbers[3]
         or v_numbers[2] >= v_numbers[4] then
        return false;
      end if;
      if p_locator ->> 'coordinateSystem' = 'normalized'
         and (v_numbers[3] > 1 or v_numbers[4] > 1) then
        return false;
      end if;
    when 'spreadsheet' then
      if jsonb_typeof(p_locator -> 'sheet') <> 'string'
         or btrim(p_locator ->> 'sheet') = ''
         or jsonb_typeof(p_locator -> 'cellRange') <> 'string'
         or btrim(p_locator ->> 'cellRange') = '' then
        return false;
      end if;
    when 'email' then
      if jsonb_typeof(p_locator -> 'messageId') <> 'string'
         or btrim(p_locator ->> 'messageId') = '' then
        return false;
      end if;
      if not (p_locator ? 'paragraph') and not (p_locator ? 'part') then
        return false;
      end if;
      if p_locator ? 'paragraph' then
        if jsonb_typeof(p_locator -> 'paragraph') <> 'number' then
          return false;
        end if;
        v_start := (p_locator ->> 'paragraph')::numeric;
        if v_start < 1 or trunc(v_start) <> v_start then
          return false;
        end if;
      end if;
      if p_locator ? 'part'
         and (
           jsonb_typeof(p_locator -> 'part') <> 'string'
           or btrim(p_locator ->> 'part') = ''
         ) then
        return false;
      end if;
    when 'plain_text' then
      if jsonb_typeof(p_locator -> 'startCharacter') <> 'number'
         or jsonb_typeof(p_locator -> 'endCharacter') <> 'number' then
        return false;
      end if;
      v_start := (p_locator ->> 'startCharacter')::numeric;
      v_end := (p_locator ->> 'endCharacter')::numeric;
      if v_start < 0 or trunc(v_start) <> v_start
         or v_end <= v_start or trunc(v_end) <> v_end then
        return false;
      end if;
    else
      return false;
  end case;

  return true;
exception
  when data_exception or invalid_text_representation or numeric_value_out_of_range then
    return false;
end
$function$;

create table project_intelligence.deployment_cells (
  cell_code text primary key
    check (cell_code in ('us', 'ru')),
  created_at timestamptz not null default clock_timestamp()
);

insert into project_intelligence.deployment_cells (cell_code) values ('ru');

create table project_intelligence.organizations (
  id uuid primary key,
  cell_code text not null,
  edition text not null check (edition in ('studio', 'renovation')),
  legacy_designer_id uuid unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default clock_timestamp(),
  constraint organizations_id_cell_code_key unique (id, cell_code),
  constraint organizations_cell_code_fkey
    foreign key (cell_code)
    references project_intelligence.deployment_cells (cell_code)
    on delete restrict,
  constraint organizations_legacy_designer_id_fkey
    foreign key (legacy_designer_id)
    references public.designers (id)
    on delete restrict
);

create index organizations_cell_code_idx
  on project_intelligence.organizations (cell_code);

create table project_intelligence.organization_members (
  organization_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, user_id),
  constraint organization_members_organization_id_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint organization_members_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete restrict
);

create index organization_members_user_id_idx
  on project_intelligence.organization_members (user_id);

create table project_intelligence.member_capabilities (
  organization_id uuid not null,
  user_id uuid not null,
  capability text not null check (capability in (
    'review_claim',
    'publish_version',
    'revise_decision',
    'calculate_change_impact',
    'review_change_impact',
    'build_logical_handoff'
  )),
  granted_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, user_id, capability),
  constraint member_capabilities_member_fkey
    foreign key (organization_id, user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict
);

create table project_intelligence.project_workflows (
  organization_id uuid not null,
  project_id uuid not null,
  state_revision bigint not null default 0
    check (state_revision between 0 and 9007199254740991),
  latest_version_id text,
  enrolled_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id),
  constraint project_workflows_organization_id_fkey
    foreign key (organization_id)
    references project_intelligence.organizations (id)
    on delete restrict,
  constraint project_workflows_project_id_fkey
    foreign key (project_id)
    references public.projects (id)
    on delete restrict,
  constraint project_workflows_latest_version_id_check
    check (
      latest_version_id is null
      or (
        char_length(btrim(latest_version_id)) between 1 and 160
        and latest_version_id = btrim(latest_version_id)
      )
    )
);

create index project_workflows_project_id_idx
  on project_intelligence.project_workflows (project_id);
create index project_workflows_latest_version_id_idx
  on project_intelligence.project_workflows
  (organization_id, project_id, latest_version_id)
  where latest_version_id is not null;

create table project_intelligence.sources (
  organization_id uuid not null,
  project_id uuid not null,
  source_id text not null
    check (
      char_length(btrim(source_id)) between 1 and 160
      and source_id = btrim(source_id)
    ),
  kind text not null check (kind in (
    'pdf',
    'transcript',
    'audio',
    'image',
    'spreadsheet',
    'email',
    'plain_text',
    'questionnaire'
  )),
  checksum bytea not null check (octet_length(checksum) = 32),
  storage_object_path text
    check (
      storage_object_path is null
      or (
        char_length(btrim(storage_object_path)) between 1 and 2048
        and storage_object_path = btrim(storage_object_path)
      )
    ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, source_id),
  constraint sources_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint sources_checksum_key
    unique (organization_id, project_id, checksum)
);

create table project_intelligence.source_fragments (
  organization_id uuid not null,
  project_id uuid not null,
  fragment_id text not null
    check (
      char_length(btrim(fragment_id)) between 1 and 160
      and fragment_id = btrim(fragment_id)
    ),
  source_id text not null
    check (
      char_length(btrim(source_id)) between 1 and 160
      and source_id = btrim(source_id)
    ),
  locator_kind text not null check (locator_kind in (
    'pdf',
    'transcript',
    'image',
    'spreadsheet',
    'email',
    'plain_text'
  )),
  locator jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, fragment_id),
  constraint source_fragments_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint source_fragments_source_fkey
    foreign key (organization_id, project_id, source_id)
    references project_intelligence.sources (organization_id, project_id, source_id)
    on delete restrict,
  constraint source_fragments_locator_check
    check (
      project_intelligence.is_valid_source_locator(locator_kind, locator)
    )
);

create index source_fragments_source_idx
  on project_intelligence.source_fragments
  (organization_id, project_id, source_id);

create table project_intelligence.graph_nodes (
  organization_id uuid not null,
  project_id uuid not null,
  node_id text not null
    check (
      char_length(btrim(node_id)) between 1 and 160
      and node_id = btrim(node_id)
    ),
  kind text not null check (kind in (
    'area',
    'source',
    'requirement',
    'assumption',
    'decision',
    'risk',
    'deliverable',
    'item',
    'approval'
  )),
  stable_key text not null
    check (
      char_length(btrim(stable_key)) between 1 and 160
      and stable_key = btrim(stable_key)
    ),
  current_revision_id text not null
    check (
      char_length(btrim(current_revision_id)) between 1 and 160
      and current_revision_id = btrim(current_revision_id)
    ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, node_id),
  constraint graph_nodes_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint graph_nodes_stable_key_key
    unique (organization_id, project_id, kind, stable_key)
);

create index graph_nodes_current_revision_idx
  on project_intelligence.graph_nodes
  (organization_id, project_id, node_id, current_revision_id);

create table project_intelligence.graph_node_revisions (
  organization_id uuid not null,
  project_id uuid not null,
  revision_id text not null
    check (
      char_length(btrim(revision_id)) between 1 and 160
      and revision_id = btrim(revision_id)
    ),
  node_id text not null
    check (
      char_length(btrim(node_id)) between 1 and 160
      and node_id = btrim(node_id)
    ),
  revision_no bigint not null
    check (revision_no between 0 and 9007199254740991),
  title text not null
    check (
      char_length(btrim(title)) between 1 and 1000
      and title = btrim(title)
    ),
  payload jsonb not null,
  origin text not null check (origin in ('human', 'ai', 'import', 'system')),
  claim_status text not null check (
    claim_status in ('extracted', 'interpreted', 'unknown')
  ),
  unknown_reason text,
  replaces_revision_id text
    check (
      replaces_revision_id is null
      or (
        char_length(btrim(replaces_revision_id)) between 1 and 160
        and replaces_revision_id = btrim(replaces_revision_id)
      )
    ),
  content_digest bytea not null check (octet_length(content_digest) = 32),
  created_by_type text not null check (
    created_by_type in ('human', 'ai', 'system')
  ),
  created_by_id text not null
    check (
      char_length(btrim(created_by_id)) between 1 and 160
      and created_by_id = btrim(created_by_id)
    ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, revision_id),
  constraint graph_node_revisions_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint graph_node_revisions_node_fkey
    foreign key (organization_id, project_id, node_id)
    references project_intelligence.graph_nodes (organization_id, project_id, node_id)
    on delete restrict
    deferrable initially deferred,
  constraint graph_node_revisions_node_revision_no_key
    unique (organization_id, project_id, node_id, revision_no),
  constraint graph_node_revisions_node_revision_id_key
    unique (organization_id, project_id, node_id, revision_id),
  constraint graph_node_revisions_replacement_fkey
    foreign key (
      organization_id,
      project_id,
      node_id,
      replaces_revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict
    deferrable initially deferred,
  constraint graph_node_revisions_replacement_check
    check (replaces_revision_id is null or replaces_revision_id <> revision_id),
  constraint graph_node_revisions_unknown_reason_check
    check (
      (
        claim_status = 'unknown'
        and unknown_reason is not null
        and char_length(btrim(unknown_reason)) between 1 and 2000
        and unknown_reason = btrim(unknown_reason)
      )
      or (
        claim_status <> 'unknown'
        and unknown_reason is null
      )
    ),
  constraint graph_node_revisions_creator_check
    check (
      (origin = 'human' and created_by_type = 'human')
      or origin <> 'human'
    )
);

create index graph_node_revisions_replacement_idx
  on project_intelligence.graph_node_revisions
  (organization_id, project_id, node_id, replaces_revision_id)
  where replaces_revision_id is not null;

alter table project_intelligence.graph_nodes
  add constraint graph_nodes_current_revision_fkey
  foreign key (
    organization_id,
    project_id,
    node_id,
    current_revision_id
  )
  references project_intelligence.graph_node_revisions (
    organization_id,
    project_id,
    node_id,
    revision_id
  )
  on delete restrict
  deferrable initially deferred;

create table project_intelligence.human_reviews (
  organization_id uuid not null,
  project_id uuid not null,
  review_id text not null
    check (
      char_length(btrim(review_id)) between 1 and 160
      and review_id = btrim(review_id)
    ),
  target_revision_id text not null
    check (
      char_length(btrim(target_revision_id)) between 1 and 160
      and target_revision_id = btrim(target_revision_id)
    ),
  decision text not null check (decision in ('confirmed', 'rejected')),
  actor_user_id uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, review_id),
  constraint human_reviews_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint human_reviews_target_revision_fkey
    foreign key (organization_id, project_id, target_revision_id)
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      revision_id
    )
    on delete restrict,
  constraint human_reviews_actor_fkey
    foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint human_reviews_target_revision_key
    unique (organization_id, project_id, target_revision_id)
);

create index human_reviews_actor_idx
  on project_intelligence.human_reviews (organization_id, actor_user_id);

create table project_intelligence.evidence_links (
  organization_id uuid not null,
  project_id uuid not null,
  evidence_link_id text not null
    check (
      char_length(btrim(evidence_link_id)) between 1 and 160
      and evidence_link_id = btrim(evidence_link_id)
    ),
  node_revision_id text not null
    check (
      char_length(btrim(node_revision_id)) between 1 and 160
      and node_revision_id = btrim(node_revision_id)
    ),
  source_fragment_id text not null
    check (
      char_length(btrim(source_fragment_id)) between 1 and 160
      and source_fragment_id = btrim(source_fragment_id)
    ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, evidence_link_id),
  constraint evidence_links_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint evidence_links_revision_fkey
    foreign key (organization_id, project_id, node_revision_id)
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      revision_id
    )
    on delete restrict,
  constraint evidence_links_fragment_fkey
    foreign key (organization_id, project_id, source_fragment_id)
    references project_intelligence.source_fragments (
      organization_id,
      project_id,
      fragment_id
    )
    on delete restrict,
  constraint evidence_links_revision_fragment_key
    unique (
      organization_id,
      project_id,
      node_revision_id,
      source_fragment_id
    )
);

create index evidence_links_fragment_idx
  on project_intelligence.evidence_links
  (organization_id, project_id, source_fragment_id);

create table project_intelligence.graph_edges (
  organization_id uuid not null,
  project_id uuid not null,
  edge_id text not null
    check (
      char_length(btrim(edge_id)) between 1 and 160
      and edge_id = btrim(edge_id)
    ),
  from_node_id text not null
    check (
      char_length(btrim(from_node_id)) between 1 and 160
      and from_node_id = btrim(from_node_id)
    ),
  to_node_id text not null
    check (
      char_length(btrim(to_node_id)) between 1 and 160
      and to_node_id = btrim(to_node_id)
    ),
  relation text not null check (relation in (
    'depends_on',
    'derived_from',
    'specified_by',
    'satisfies',
    'applies_to',
    'contains',
    'conflicts_with',
    'references'
  )),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, edge_id),
  constraint graph_edges_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint graph_edges_from_node_fkey
    foreign key (organization_id, project_id, from_node_id)
    references project_intelligence.graph_nodes (
      organization_id,
      project_id,
      node_id
    )
    on delete restrict,
  constraint graph_edges_to_node_fkey
    foreign key (organization_id, project_id, to_node_id)
    references project_intelligence.graph_nodes (
      organization_id,
      project_id,
      node_id
    )
    on delete restrict,
  constraint graph_edges_semantic_key
    unique (
      organization_id,
      project_id,
      from_node_id,
      to_node_id,
      relation
    ),
  constraint graph_edges_not_self_check
    check (from_node_id <> to_node_id)
);

create index graph_edges_reverse_impact_idx
  on project_intelligence.graph_edges
  (organization_id, project_id, to_node_id, relation, from_node_id);

create function project_intelligence.validate_revision_evidence()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.origin = 'ai'
     and new.claim_status in ('extracted', 'interpreted')
     and not exists (
       select 1
       from project_intelligence.evidence_links e
       where e.organization_id = new.organization_id
         and e.project_id = new.project_id
         and e.node_revision_id = new.revision_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_AI_REVISION_REQUIRES_EVIDENCE',
      detail = new.revision_id;
  end if;
  return null;
end
$function$;

create constraint trigger graph_node_revisions_evidence_closure
after insert or update on project_intelligence.graph_node_revisions
deferrable initially deferred
for each row execute function project_intelligence.validate_revision_evidence();

create table project_intelligence.project_versions (
  organization_id uuid not null,
  project_id uuid not null,
  version_id text not null
    check (
      char_length(btrim(version_id)) between 1 and 160
      and version_id = btrim(version_id)
    ),
  version_no bigint not null
    check (version_no between 0 and 9007199254740991),
  base_version_id text
    check (
      base_version_id is null
      or (
        char_length(btrim(base_version_id)) between 1 and 160
        and base_version_id = btrim(base_version_id)
      )
    ),
  label text
    check (
      label is null
      or (
        char_length(btrim(label)) between 1 and 500
        and label = btrim(label)
      )
    ),
  graph_digest bytea not null check (octet_length(graph_digest) = 32),
  contract_version text not null
    check (
      char_length(btrim(contract_version)) between 1 and 160
      and contract_version = btrim(contract_version)
    ),
  published_by_user_id uuid not null,
  published_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, version_id),
  constraint project_versions_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint project_versions_base_version_fkey
    foreign key (organization_id, project_id, base_version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint project_versions_publisher_fkey
    foreign key (organization_id, published_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint project_versions_version_no_key
    unique (organization_id, project_id, version_no),
  constraint project_versions_not_own_base_check
    check (base_version_id is null or base_version_id <> version_id)
);

create index project_versions_base_version_idx
  on project_intelligence.project_versions
  (organization_id, project_id, base_version_id)
  where base_version_id is not null;
create index project_versions_publisher_idx
  on project_intelligence.project_versions
  (organization_id, published_by_user_id);

alter table project_intelligence.project_workflows
  add constraint project_workflows_latest_version_fkey
  foreign key (organization_id, project_id, latest_version_id)
  references project_intelligence.project_versions (
    organization_id,
    project_id,
    version_id
  )
  on delete restrict
  deferrable initially deferred;

create table project_intelligence.version_nodes (
  organization_id uuid not null,
  project_id uuid not null,
  version_id text not null
    check (
      char_length(btrim(version_id)) between 1 and 160
      and version_id = btrim(version_id)
    ),
  node_id text not null
    check (
      char_length(btrim(node_id)) between 1 and 160
      and node_id = btrim(node_id)
    ),
  revision_id text not null
    check (
      char_length(btrim(revision_id)) between 1 and 160
      and revision_id = btrim(revision_id)
    ),
  primary key (organization_id, project_id, version_id, node_id),
  constraint version_nodes_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint version_nodes_version_fkey
    foreign key (organization_id, project_id, version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint version_nodes_node_fkey
    foreign key (organization_id, project_id, node_id)
    references project_intelligence.graph_nodes (
      organization_id,
      project_id,
      node_id
    )
    on delete restrict,
  constraint version_nodes_exact_revision_fkey
    foreign key (organization_id, project_id, node_id, revision_id)
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict
);

create index version_nodes_exact_revision_idx
  on project_intelligence.version_nodes
  (organization_id, project_id, node_id, revision_id);

create table project_intelligence.version_reviews (
  organization_id uuid not null,
  project_id uuid not null,
  version_id text not null
    check (
      char_length(btrim(version_id)) between 1 and 160
      and version_id = btrim(version_id)
    ),
  review_id text not null
    check (
      char_length(btrim(review_id)) between 1 and 160
      and review_id = btrim(review_id)
    ),
  primary key (organization_id, project_id, version_id, review_id),
  constraint version_reviews_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint version_reviews_version_fkey
    foreign key (organization_id, project_id, version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint version_reviews_review_fkey
    foreign key (organization_id, project_id, review_id)
    references project_intelligence.human_reviews (
      organization_id,
      project_id,
      review_id
    )
    on delete restrict
);

create index version_reviews_review_idx
  on project_intelligence.version_reviews
  (organization_id, project_id, review_id);

create table project_intelligence.version_sources (
  organization_id uuid not null,
  project_id uuid not null,
  version_id text not null
    check (
      char_length(btrim(version_id)) between 1 and 160
      and version_id = btrim(version_id)
    ),
  source_id text not null
    check (
      char_length(btrim(source_id)) between 1 and 160
      and source_id = btrim(source_id)
    ),
  primary key (organization_id, project_id, version_id, source_id),
  constraint version_sources_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint version_sources_version_fkey
    foreign key (organization_id, project_id, version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint version_sources_source_fkey
    foreign key (organization_id, project_id, source_id)
    references project_intelligence.sources (
      organization_id,
      project_id,
      source_id
    )
    on delete restrict
);

create index version_sources_source_idx
  on project_intelligence.version_sources
  (organization_id, project_id, source_id);

create table project_intelligence.version_source_fragments (
  organization_id uuid not null,
  project_id uuid not null,
  version_id text not null
    check (
      char_length(btrim(version_id)) between 1 and 160
      and version_id = btrim(version_id)
    ),
  fragment_id text not null
    check (
      char_length(btrim(fragment_id)) between 1 and 160
      and fragment_id = btrim(fragment_id)
    ),
  primary key (organization_id, project_id, version_id, fragment_id),
  constraint version_source_fragments_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint version_source_fragments_version_fkey
    foreign key (organization_id, project_id, version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint version_source_fragments_fragment_fkey
    foreign key (organization_id, project_id, fragment_id)
    references project_intelligence.source_fragments (
      organization_id,
      project_id,
      fragment_id
    )
    on delete restrict
);

create index version_source_fragments_fragment_idx
  on project_intelligence.version_source_fragments
  (organization_id, project_id, fragment_id);

create table project_intelligence.version_evidence_links (
  organization_id uuid not null,
  project_id uuid not null,
  version_id text not null
    check (
      char_length(btrim(version_id)) between 1 and 160
      and version_id = btrim(version_id)
    ),
  evidence_link_id text not null
    check (
      char_length(btrim(evidence_link_id)) between 1 and 160
      and evidence_link_id = btrim(evidence_link_id)
    ),
  primary key (
    organization_id,
    project_id,
    version_id,
    evidence_link_id
  ),
  constraint version_evidence_links_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint version_evidence_links_version_fkey
    foreign key (organization_id, project_id, version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint version_evidence_links_evidence_fkey
    foreign key (organization_id, project_id, evidence_link_id)
    references project_intelligence.evidence_links (
      organization_id,
      project_id,
      evidence_link_id
    )
    on delete restrict
);

create index version_evidence_links_evidence_idx
  on project_intelligence.version_evidence_links
  (organization_id, project_id, evidence_link_id);

-- Evidence attached to a published version must be evidence for a revision
-- selected by that same immutable snapshot.  The deferred check allows the
-- publish operation to append the snapshot rows in one transaction while
-- preventing cross-version evidence leakage.
create function project_intelligence.validate_version_evidence_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from project_intelligence.evidence_links el
    join project_intelligence.version_nodes vn
      on vn.organization_id = new.organization_id
     and vn.project_id = new.project_id
     and vn.version_id = new.version_id
     and vn.revision_id = el.node_revision_id
    where el.organization_id = new.organization_id
      and el.project_id = new.project_id
      and el.evidence_link_id = new.evidence_link_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_VERSION_EVIDENCE_OUT_OF_SCOPE',
      detail = new.evidence_link_id;
  end if;
  return null;
end
$function$;

create constraint trigger version_evidence_scope_closure
after insert or update on project_intelligence.version_evidence_links
deferrable initially deferred
for each row execute function project_intelligence.validate_version_evidence_scope();

create table project_intelligence.version_edges (
  organization_id uuid not null,
  project_id uuid not null,
  version_id text not null
    check (
      char_length(btrim(version_id)) between 1 and 160
      and version_id = btrim(version_id)
    ),
  edge_id text not null
    check (
      char_length(btrim(edge_id)) between 1 and 160
      and edge_id = btrim(edge_id)
    ),
  primary key (organization_id, project_id, version_id, edge_id),
  constraint version_edges_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint version_edges_version_fkey
    foreign key (organization_id, project_id, version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint version_edges_edge_fkey
    foreign key (organization_id, project_id, edge_id)
    references project_intelligence.graph_edges (
      organization_id,
      project_id,
      edge_id
    )
    on delete restrict
);

create index version_edges_edge_idx
  on project_intelligence.version_edges
  (organization_id, project_id, edge_id);

create function project_intelligence.validate_version_closure()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_base_no bigint;
begin
  if new.base_version_id is null then
    if new.version_no <> 1 then
      raise exception using
        errcode = '23514',
        message = 'PROJECT_INTELLIGENCE_FIRST_VERSION_NUMBER_INVALID',
        detail = new.version_id;
    end if;
  else
    select pv.version_no
      into v_base_no
    from project_intelligence.project_versions pv
    where pv.organization_id = new.organization_id
      and pv.project_id = new.project_id
      and pv.version_id = new.base_version_id;
    if v_base_no is null or new.version_no <> v_base_no + 1 then
      raise exception using
        errcode = '23514',
        message = 'PROJECT_INTELLIGENCE_VERSION_LINEAGE_INVALID',
        detail = new.version_id;
    end if;
  end if;

  if not exists (
    select 1
    from project_intelligence.version_nodes vn
    where vn.organization_id = new.organization_id
      and vn.project_id = new.project_id
      and vn.version_id = new.version_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_VERSION_REQUIRES_NODE',
      detail = new.version_id;
  end if;

  if exists (
    select 1
    from project_intelligence.version_reviews vr
    join project_intelligence.human_reviews hr
      on hr.organization_id = vr.organization_id
     and hr.project_id = vr.project_id
     and hr.review_id = vr.review_id
    where vr.organization_id = new.organization_id
      and vr.project_id = new.project_id
      and vr.version_id = new.version_id
      and not exists (
        select 1
        from project_intelligence.version_nodes vn
        where vn.organization_id = vr.organization_id
          and vn.project_id = vr.project_id
          and vn.version_id = vr.version_id
          and vn.revision_id = hr.target_revision_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_VERSION_REVIEW_NOT_SELECTED',
      detail = new.version_id;
  end if;

  if exists (
    select 1
    from project_intelligence.version_nodes vn
    join project_intelligence.graph_nodes gn
      on gn.organization_id = vn.organization_id
     and gn.project_id = vn.project_id
     and gn.node_id = vn.node_id
    join project_intelligence.graph_node_revisions gr
      on gr.organization_id = vn.organization_id
     and gr.project_id = vn.project_id
     and gr.revision_id = vn.revision_id
    where vn.organization_id = new.organization_id
      and vn.project_id = new.project_id
      and vn.version_id = new.version_id
      and gn.kind in ('decision', 'requirement')
      and gr.origin = 'ai'
      and not exists (
        select 1
        from project_intelligence.version_reviews vr
        join project_intelligence.human_reviews hr
          on hr.organization_id = vr.organization_id
         and hr.project_id = vr.project_id
         and hr.review_id = vr.review_id
        where vr.organization_id = vn.organization_id
          and vr.project_id = vn.project_id
          and vr.version_id = vn.version_id
          and hr.target_revision_id = vn.revision_id
          and hr.decision = 'confirmed'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_AI_SELECTION_REQUIRES_CONFIRMATION',
      detail = new.version_id;
  end if;

  if exists (
    select 1
    from project_intelligence.version_nodes vn
    join project_intelligence.graph_node_revisions gr
      on gr.organization_id = vn.organization_id
     and gr.project_id = vn.project_id
     and gr.revision_id = vn.revision_id
    where vn.organization_id = new.organization_id
      and vn.project_id = new.project_id
      and vn.version_id = new.version_id
      and gr.origin = 'ai'
      and gr.claim_status in ('extracted', 'interpreted')
      and not exists (
        select 1
        from project_intelligence.version_evidence_links vel
        join project_intelligence.evidence_links el
          on el.organization_id = vel.organization_id
         and el.project_id = vel.project_id
         and el.evidence_link_id = vel.evidence_link_id
        where vel.organization_id = vn.organization_id
          and vel.project_id = vn.project_id
          and vel.version_id = vn.version_id
          and el.node_revision_id = vn.revision_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_VERSION_AI_EVIDENCE_MISSING',
      detail = new.version_id;
  end if;

  if exists (
    select 1
    from project_intelligence.version_source_fragments vf
    join project_intelligence.source_fragments sf
      on sf.organization_id = vf.organization_id
     and sf.project_id = vf.project_id
     and sf.fragment_id = vf.fragment_id
    where vf.organization_id = new.organization_id
      and vf.project_id = new.project_id
      and vf.version_id = new.version_id
      and not exists (
        select 1
        from project_intelligence.version_sources vs
        where vs.organization_id = vf.organization_id
          and vs.project_id = vf.project_id
          and vs.version_id = vf.version_id
          and vs.source_id = sf.source_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_VERSION_FRAGMENT_SOURCE_MISSING',
      detail = new.version_id;
  end if;

  if exists (
    select 1
    from project_intelligence.version_evidence_links ve
    join project_intelligence.evidence_links el
      on el.organization_id = ve.organization_id
     and el.project_id = ve.project_id
     and el.evidence_link_id = ve.evidence_link_id
    where ve.organization_id = new.organization_id
      and ve.project_id = new.project_id
      and ve.version_id = new.version_id
      and (
        not exists (
          select 1
          from project_intelligence.version_nodes vn
          where vn.organization_id = ve.organization_id
            and vn.project_id = ve.project_id
            and vn.version_id = ve.version_id
            and vn.revision_id = el.node_revision_id
        )
        or not exists (
          select 1
          from project_intelligence.version_source_fragments vf
          where vf.organization_id = ve.organization_id
            and vf.project_id = ve.project_id
            and vf.version_id = ve.version_id
            and vf.fragment_id = el.source_fragment_id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_VERSION_EVIDENCE_CLOSURE_INVALID',
      detail = new.version_id;
  end if;

  if exists (
    select 1
    from project_intelligence.version_edges ve
    join project_intelligence.graph_edges ge
      on ge.organization_id = ve.organization_id
     and ge.project_id = ve.project_id
     and ge.edge_id = ve.edge_id
    where ve.organization_id = new.organization_id
      and ve.project_id = new.project_id
      and ve.version_id = new.version_id
      and (
        not exists (
          select 1
          from project_intelligence.version_nodes vn
          where vn.organization_id = ve.organization_id
            and vn.project_id = ve.project_id
            and vn.version_id = ve.version_id
            and vn.node_id = ge.from_node_id
        )
        or not exists (
          select 1
          from project_intelligence.version_nodes vn
          where vn.organization_id = ve.organization_id
            and vn.project_id = ve.project_id
            and vn.version_id = ve.version_id
            and vn.node_id = ge.to_node_id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_VERSION_EDGE_CLOSURE_INVALID',
      detail = new.version_id;
  end if;

  return null;
end
$function$;

create constraint trigger project_versions_closure
after insert or update on project_intelligence.project_versions
deferrable initially deferred
for each row execute function project_intelligence.validate_version_closure();

create table project_intelligence.change_sets (
  organization_id uuid not null,
  project_id uuid not null,
  change_set_id text not null
    check (
      char_length(btrim(change_set_id)) between 1 and 160
      and change_set_id = btrim(change_set_id)
    ),
  node_id text not null
    check (
      char_length(btrim(node_id)) between 1 and 160
      and node_id = btrim(node_id)
    ),
  from_version_id text not null
    check (
      char_length(btrim(from_version_id)) between 1 and 160
      and from_version_id = btrim(from_version_id)
    ),
  from_revision_id text not null
    check (
      char_length(btrim(from_revision_id)) between 1 and 160
      and from_revision_id = btrim(from_revision_id)
    ),
  to_revision_id text not null
    check (
      char_length(btrim(to_revision_id)) between 1 and 160
      and to_revision_id = btrim(to_revision_id)
    ),
  reason_code text not null check (reason_code in (
    'schedule_constraint',
    'budget_constraint',
    'client_preference',
    'scope_change',
    'technical_constraint',
    'regulatory_requirement',
    'correction'
  )),
  actor_user_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, change_set_id),
  constraint change_sets_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint change_sets_node_fkey
    foreign key (organization_id, project_id, node_id)
    references project_intelligence.graph_nodes (
      organization_id,
      project_id,
      node_id
    )
    on delete restrict,
  constraint change_sets_from_version_fkey
    foreign key (organization_id, project_id, from_version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint change_sets_from_revision_fkey
    foreign key (
      organization_id,
      project_id,
      node_id,
      from_revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint change_sets_to_revision_fkey
    foreign key (
      organization_id,
      project_id,
      node_id,
      to_revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint change_sets_actor_fkey
    foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint change_sets_revision_transition_check
    check (from_revision_id <> to_revision_id)
);

create index change_sets_node_idx
  on project_intelligence.change_sets
  (organization_id, project_id, node_id);
create index change_sets_from_version_idx
  on project_intelligence.change_sets
  (organization_id, project_id, from_version_id);
create index change_sets_from_revision_idx
  on project_intelligence.change_sets
  (organization_id, project_id, node_id, from_revision_id);
create index change_sets_to_revision_idx
  on project_intelligence.change_sets
  (organization_id, project_id, node_id, to_revision_id);
create index change_sets_actor_idx
  on project_intelligence.change_sets (organization_id, actor_user_id);

create table project_intelligence.change_set_reasons (
  organization_id uuid not null,
  project_id uuid not null,
  change_set_id text not null
    check (
      char_length(btrim(change_set_id)) between 1 and 160
      and change_set_id = btrim(change_set_id)
    ),
  protected_reason text not null
    check (
      char_length(btrim(protected_reason)) between 1 and 4000
      and protected_reason = btrim(protected_reason)
    ),
  primary key (organization_id, project_id, change_set_id),
  constraint change_set_reasons_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint change_set_reasons_change_set_fkey
    foreign key (organization_id, project_id, change_set_id)
    references project_intelligence.change_sets (
      organization_id,
      project_id,
      change_set_id
    )
    on delete restrict
);

create table project_intelligence.change_set_publications (
  organization_id uuid not null,
  project_id uuid not null,
  change_set_id text not null
    check (
      char_length(btrim(change_set_id)) between 1 and 160
      and change_set_id = btrim(change_set_id)
    ),
  to_version_id text not null
    check (
      char_length(btrim(to_version_id)) between 1 and 160
      and to_version_id = btrim(to_version_id)
    ),
  published_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, change_set_id),
  constraint change_set_publications_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint change_set_publications_change_set_fkey
    foreign key (organization_id, project_id, change_set_id)
    references project_intelligence.change_sets (
      organization_id,
      project_id,
      change_set_id
    )
    on delete restrict,
  constraint change_set_publications_to_version_fkey
    foreign key (organization_id, project_id, to_version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint change_set_publications_to_version_key
    unique (organization_id, project_id, to_version_id)
);

create function project_intelligence.validate_change_publication()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_change project_intelligence.change_sets%rowtype;
  v_target project_intelligence.project_versions%rowtype;
begin
  select *
    into v_change
  from project_intelligence.change_sets cs
  where cs.organization_id = new.organization_id
    and cs.project_id = new.project_id
    and cs.change_set_id = new.change_set_id;

  select *
    into v_target
  from project_intelligence.project_versions pv
  where pv.organization_id = new.organization_id
    and pv.project_id = new.project_id
    and pv.version_id = new.to_version_id;

  if v_target.base_version_id is distinct from v_change.from_version_id
     or not exists (
       select 1
       from project_intelligence.version_nodes vn
       where vn.organization_id = new.organization_id
         and vn.project_id = new.project_id
         and vn.version_id = v_change.from_version_id
         and vn.node_id = v_change.node_id
         and vn.revision_id = v_change.from_revision_id
     )
     or not exists (
       select 1
       from project_intelligence.version_nodes vn
       where vn.organization_id = new.organization_id
         and vn.project_id = new.project_id
         and vn.version_id = new.to_version_id
         and vn.node_id = v_change.node_id
         and vn.revision_id = v_change.to_revision_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_CHANGE_PUBLICATION_INVALID',
      detail = new.change_set_id;
  end if;

  return null;
end
$function$;

create constraint trigger change_set_publications_closure
after insert or update on project_intelligence.change_set_publications
deferrable initially deferred
for each row execute function project_intelligence.validate_change_publication();

alter table project_intelligence.change_set_publications
  add constraint change_set_publications_exact_binding_key
  unique (organization_id, project_id, change_set_id, to_version_id);

create table project_intelligence.impact_runs (
  organization_id uuid not null,
  project_id uuid not null,
  impact_run_id text not null
    check (
      char_length(btrim(impact_run_id)) between 1 and 160
      and impact_run_id = btrim(impact_run_id)
    ),
  change_set_id text not null
    check (
      char_length(btrim(change_set_id)) between 1 and 160
      and change_set_id = btrim(change_set_id)
    ),
  from_version_id text not null
    check (
      char_length(btrim(from_version_id)) between 1 and 160
      and from_version_id = btrim(from_version_id)
    ),
  to_version_id text not null
    check (
      char_length(btrim(to_version_id)) between 1 and 160
      and to_version_id = btrim(to_version_id)
    ),
  target_graph_digest bytea not null
    check (octet_length(target_graph_digest) = 32),
  algorithm jsonb not null check (jsonb_typeof(algorithm) = 'object'),
  result_digest bytea not null check (octet_length(result_digest) = 32),
  created_by_type text not null check (
    created_by_type in ('human', 'ai', 'system')
  ),
  created_by_id text not null
    check (
      char_length(btrim(created_by_id)) between 1 and 160
      and created_by_id = btrim(created_by_id)
    ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, impact_run_id),
  constraint impact_runs_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint impact_runs_change_set_fkey
    foreign key (organization_id, project_id, change_set_id)
    references project_intelligence.change_sets (
      organization_id,
      project_id,
      change_set_id
    )
    on delete restrict,
  constraint impact_runs_from_version_fkey
    foreign key (organization_id, project_id, from_version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint impact_runs_to_version_fkey
    foreign key (organization_id, project_id, to_version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint impact_runs_publication_fkey
    foreign key (
      organization_id,
      project_id,
      change_set_id,
      to_version_id
    )
    references project_intelligence.change_set_publications (
      organization_id,
      project_id,
      change_set_id,
      to_version_id
    )
    on delete restrict,
  constraint impact_runs_change_target_key
    unique (organization_id, project_id, change_set_id, to_version_id),
  constraint impact_runs_version_pair_check
    check (from_version_id <> to_version_id)
);

create index impact_runs_from_version_idx
  on project_intelligence.impact_runs
  (organization_id, project_id, from_version_id);
create index impact_runs_to_version_idx
  on project_intelligence.impact_runs
  (organization_id, project_id, to_version_id);

create table project_intelligence.impact_run_changes (
  organization_id uuid not null,
  project_id uuid not null,
  impact_run_id text not null
    check (
      char_length(btrim(impact_run_id)) between 1 and 160
      and impact_run_id = btrim(impact_run_id)
    ),
  node_id text not null
    check (
      char_length(btrim(node_id)) between 1 and 160
      and node_id = btrim(node_id)
    ),
  change_type text not null check (change_type in (
    'added',
    'removed',
    'changed',
    'revision_transition'
  )),
  from_revision_id text
    check (
      from_revision_id is null
      or (
        char_length(btrim(from_revision_id)) between 1 and 160
        and from_revision_id = btrim(from_revision_id)
      )
    ),
  to_revision_id text
    check (
      to_revision_id is null
      or (
        char_length(btrim(to_revision_id)) between 1 and 160
        and to_revision_id = btrim(to_revision_id)
      )
    ),
  changed_paths text[] not null default '{}'::text[]
    check (array_position(changed_paths, null) is null),
  impact_relevant boolean not null,
  primary key (organization_id, project_id, impact_run_id, node_id),
  constraint impact_run_changes_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint impact_run_changes_run_fkey
    foreign key (organization_id, project_id, impact_run_id)
    references project_intelligence.impact_runs (
      organization_id,
      project_id,
      impact_run_id
    )
    on delete restrict,
  constraint impact_run_changes_node_fkey
    foreign key (organization_id, project_id, node_id)
    references project_intelligence.graph_nodes (
      organization_id,
      project_id,
      node_id
    )
    on delete restrict,
  constraint impact_run_changes_from_revision_fkey
    foreign key (
      organization_id,
      project_id,
      node_id,
      from_revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint impact_run_changes_to_revision_fkey
    foreign key (
      organization_id,
      project_id,
      node_id,
      to_revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint impact_run_changes_shape_check
    check (
      (
        change_type = 'added'
        and from_revision_id is null
        and to_revision_id is not null
      )
      or (
        change_type = 'removed'
        and from_revision_id is not null
        and to_revision_id is null
      )
      or (
        change_type in ('changed', 'revision_transition')
        and from_revision_id is not null
        and to_revision_id is not null
        and from_revision_id <> to_revision_id
      )
    ),
  constraint impact_run_changes_paths_check
    check (
      (
        change_type = 'revision_transition'
        and cardinality(changed_paths) = 0
        and not impact_relevant
      )
      or (
        change_type <> 'revision_transition'
        and cardinality(changed_paths) > 0
        and impact_relevant
      )
    )
);

create index impact_run_changes_node_idx
  on project_intelligence.impact_run_changes
  (organization_id, project_id, node_id);
create index impact_run_changes_from_revision_idx
  on project_intelligence.impact_run_changes
  (organization_id, project_id, node_id, from_revision_id)
  where from_revision_id is not null;
create index impact_run_changes_to_revision_idx
  on project_intelligence.impact_run_changes
  (organization_id, project_id, node_id, to_revision_id)
  where to_revision_id is not null;

create table project_intelligence.impacts (
  organization_id uuid not null,
  project_id uuid not null,
  impact_id text not null
    check (
      char_length(btrim(impact_id)) between 1 and 160
      and impact_id = btrim(impact_id)
    ),
  impact_run_id text not null
    check (
      char_length(btrim(impact_run_id)) between 1 and 160
      and impact_run_id = btrim(impact_run_id)
    ),
  changed_node_id text not null
    check (
      char_length(btrim(changed_node_id)) between 1 and 160
      and changed_node_id = btrim(changed_node_id)
    ),
  impacted_node_id text not null
    check (
      char_length(btrim(impacted_node_id)) between 1 and 160
      and impacted_node_id = btrim(impacted_node_id)
    ),
  distance bigint not null
    check (distance between 1 and 64),
  node_path text[] not null
    check (
      array_position(node_path, null) is null
      and cardinality(node_path) = distance + 1
      and node_path[1] = changed_node_id
      and node_path[cardinality(node_path)] = impacted_node_id
    ),
  initial_status text not null default 'needs_review'
    check (initial_status = 'needs_review'),
  primary key (organization_id, project_id, impact_id),
  constraint impacts_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint impacts_run_fkey
    foreign key (organization_id, project_id, impact_run_id)
    references project_intelligence.impact_runs (
      organization_id,
      project_id,
      impact_run_id
    )
    on delete restrict,
  constraint impacts_changed_node_fkey
    foreign key (
      organization_id,
      project_id,
      impact_run_id,
      changed_node_id
    )
    references project_intelligence.impact_run_changes (
      organization_id,
      project_id,
      impact_run_id,
      node_id
    )
    on delete restrict,
  constraint impacts_impacted_node_fkey
    foreign key (organization_id, project_id, impacted_node_id)
    references project_intelligence.graph_nodes (
      organization_id,
      project_id,
      node_id
    )
    on delete restrict,
  constraint impacts_run_pair_key
    unique (
      organization_id,
      project_id,
      impact_run_id,
      changed_node_id,
      impacted_node_id
    ),
  constraint impacts_id_run_key
    unique (organization_id, project_id, impact_id, impact_run_id),
  constraint impacts_distinct_nodes_check
    check (changed_node_id <> impacted_node_id)
);

create index impacts_impacted_node_idx
  on project_intelligence.impacts
  (organization_id, project_id, impacted_node_id);

create table project_intelligence.impact_path_steps (
  organization_id uuid not null,
  project_id uuid not null,
  impact_id text not null
    check (
      char_length(btrim(impact_id)) between 1 and 160
      and impact_id = btrim(impact_id)
    ),
  step_no bigint not null
    check (step_no between 0 and 63),
  impact_run_id text not null
    check (
      char_length(btrim(impact_run_id)) between 1 and 160
      and impact_run_id = btrim(impact_run_id)
    ),
  edge_id text not null
    check (
      char_length(btrim(edge_id)) between 1 and 160
      and edge_id = btrim(edge_id)
    ),
  relation text not null check (relation in (
    'depends_on',
    'derived_from',
    'specified_by',
    'satisfies',
    'applies_to',
    'contains',
    'conflicts_with',
    'references'
  )),
  from_node_id text not null
    check (
      char_length(btrim(from_node_id)) between 1 and 160
      and from_node_id = btrim(from_node_id)
    ),
  to_node_id text not null
    check (
      char_length(btrim(to_node_id)) between 1 and 160
      and to_node_id = btrim(to_node_id)
    ),
  primary key (organization_id, project_id, impact_id, step_no),
  constraint impact_path_steps_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint impact_path_steps_impact_fkey
    foreign key (
      organization_id,
      project_id,
      impact_id,
      impact_run_id
    )
    references project_intelligence.impacts (
      organization_id,
      project_id,
      impact_id,
      impact_run_id
    )
    on delete restrict,
  constraint impact_path_steps_run_fkey
    foreign key (organization_id, project_id, impact_run_id)
    references project_intelligence.impact_runs (
      organization_id,
      project_id,
      impact_run_id
    )
    on delete restrict,
  constraint impact_path_steps_edge_fkey
    foreign key (organization_id, project_id, edge_id)
    references project_intelligence.graph_edges (
      organization_id,
      project_id,
      edge_id
    )
    on delete restrict,
  constraint impact_path_steps_propagating_relation_check
    check (relation in (
      'depends_on',
      'derived_from',
      'specified_by',
      'satisfies'
    )),
  constraint impact_path_steps_not_self_check
    check (from_node_id <> to_node_id)
);

create index impact_path_steps_impact_run_idx
  on project_intelligence.impact_path_steps
  (organization_id, project_id, impact_id, impact_run_id);
create index impact_path_steps_run_idx
  on project_intelligence.impact_path_steps
  (organization_id, project_id, impact_run_id);
create index impact_path_steps_edge_idx
  on project_intelligence.impact_path_steps
  (organization_id, project_id, edge_id);

create table project_intelligence.impact_reviews (
  organization_id uuid not null,
  project_id uuid not null,
  impact_review_id text not null
    check (
      char_length(btrim(impact_review_id)) between 1 and 160
      and impact_review_id = btrim(impact_review_id)
    ),
  impact_run_id text not null
    check (
      char_length(btrim(impact_run_id)) between 1 and 160
      and impact_run_id = btrim(impact_run_id)
    ),
  impact_id text not null
    check (
      char_length(btrim(impact_id)) between 1 and 160
      and impact_id = btrim(impact_id)
    ),
  previous_status text not null check (
    previous_status in ('needs_review', 'accepted', 'resolved', 'dismissed')
  ),
  disposition text not null check (
    disposition in ('accepted', 'resolved', 'dismissed')
  ),
  reason_code text not null check (reason_code in (
    'downstream_update_required',
    'cost_recalculation_required',
    'schedule_updated',
    'downstream_update_completed',
    'not_applicable_to_impacted_node',
    'not_applicable_to_deliverable'
  )),
  actor_user_id uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, impact_review_id),
  constraint impact_reviews_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint impact_reviews_run_fkey
    foreign key (organization_id, project_id, impact_run_id)
    references project_intelligence.impact_runs (
      organization_id,
      project_id,
      impact_run_id
    )
    on delete restrict,
  constraint impact_reviews_impact_fkey
    foreign key (
      organization_id,
      project_id,
      impact_id,
      impact_run_id
    )
    references project_intelligence.impacts (
      organization_id,
      project_id,
      impact_id,
      impact_run_id
    )
    on delete restrict,
  constraint impact_reviews_actor_fkey
    foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint impact_reviews_transition_check
    check (
      (
        previous_status = 'needs_review'
        and disposition in ('accepted', 'resolved', 'dismissed')
      )
      or (
        previous_status = 'accepted'
        and disposition in ('resolved', 'dismissed')
      )
    ),
  constraint impact_reviews_previous_status_key
    unique (organization_id, project_id, impact_id, previous_status)
);

create index impact_reviews_run_idx
  on project_intelligence.impact_reviews
  (organization_id, project_id, impact_run_id);
create index impact_reviews_impact_run_idx
  on project_intelligence.impact_reviews
  (organization_id, project_id, impact_id, impact_run_id);
create index impact_reviews_actor_idx
  on project_intelligence.impact_reviews
  (organization_id, actor_user_id);

create function project_intelligence.validate_impact_path()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_to_version_id text;
  v_step_count bigint;
begin
  select ir.to_version_id
    into v_to_version_id
  from project_intelligence.impact_runs ir
  where ir.organization_id = new.organization_id
    and ir.project_id = new.project_id
    and ir.impact_run_id = new.impact_run_id;

  select count(*)
    into v_step_count
  from project_intelligence.impact_path_steps ps
  where ps.organization_id = new.organization_id
    and ps.project_id = new.project_id
    and ps.impact_id = new.impact_id;

  if v_step_count <> new.distance
     or exists (
       select 1
       from generate_series(0, new.distance - 1) expected(step_no)
       where not exists (
         select 1
         from project_intelligence.impact_path_steps ps
         join project_intelligence.graph_edges ge
           on ge.organization_id = ps.organization_id
          and ge.project_id = ps.project_id
          and ge.edge_id = ps.edge_id
         where ps.organization_id = new.organization_id
           and ps.project_id = new.project_id
           and ps.impact_id = new.impact_id
           and ps.step_no = expected.step_no
           and ps.impact_run_id = new.impact_run_id
           and ps.relation = ge.relation
           and ps.from_node_id = ge.from_node_id
           and ps.to_node_id = ge.to_node_id
           and ps.to_node_id = new.node_path[expected.step_no + 1]
           and ps.from_node_id = new.node_path[expected.step_no + 2]
           and exists (
             select 1
             from project_intelligence.version_edges ve
             where ve.organization_id = ps.organization_id
               and ve.project_id = ps.project_id
               and ve.version_id = v_to_version_id
               and ve.edge_id = ps.edge_id
           )
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECT_INTELLIGENCE_IMPACT_PATH_INVALID',
      detail = new.impact_id;
  end if;

  return null;
end
$function$;

create constraint trigger impacts_path_closure
after insert or update on project_intelligence.impacts
deferrable initially deferred
for each row execute function project_intelligence.validate_impact_path();

alter table project_intelligence.impact_runs
  add constraint impact_runs_id_target_key
  unique (organization_id, project_id, impact_run_id, to_version_id);

create table project_intelligence.logical_handoffs (
  organization_id uuid not null,
  project_id uuid not null,
  handoff_id text not null
    check (
      char_length(btrim(handoff_id)) between 1 and 160
      and handoff_id = btrim(handoff_id)
    ),
  version_id text not null
    check (
      char_length(btrim(version_id)) between 1 and 160
      and version_id = btrim(version_id)
    ),
  impact_run_id text not null
    check (
      char_length(btrim(impact_run_id)) between 1 and 160
      and impact_run_id = btrim(impact_run_id)
    ),
  logical_content jsonb not null
    check (jsonb_typeof(logical_content) = 'object'),
  semantic_content_digest bytea not null
    check (octet_length(semantic_content_digest) = 32),
  contract_version text not null
    check (
      char_length(btrim(contract_version)) between 1 and 160
      and contract_version = btrim(contract_version)
    ),
  hash_contract_version text not null
    check (
      char_length(btrim(hash_contract_version)) between 1 and 160
      and hash_contract_version = btrim(hash_contract_version)
    ),
  artifact_descriptor jsonb not null
    check (jsonb_typeof(artifact_descriptor) = 'object'),
  created_by_type text not null check (
    created_by_type in ('human', 'ai', 'system')
  ),
  created_by_id text not null
    check (
      char_length(btrim(created_by_id)) between 1 and 160
      and created_by_id = btrim(created_by_id)
    ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, project_id, handoff_id),
  constraint logical_handoffs_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint logical_handoffs_version_fkey
    foreign key (organization_id, project_id, version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint logical_handoffs_run_target_fkey
    foreign key (
      organization_id,
      project_id,
      impact_run_id,
      version_id
    )
    references project_intelligence.impact_runs (
      organization_id,
      project_id,
      impact_run_id,
      to_version_id
    )
    on delete restrict,
  constraint logical_handoffs_semantic_key
    unique (
      organization_id,
      project_id,
      version_id,
      impact_run_id,
      semantic_content_digest
    )
);

create index logical_handoffs_run_target_idx
  on project_intelligence.logical_handoffs
  (organization_id, project_id, impact_run_id, version_id);

create table project_intelligence.handoff_impact_reviews (
  organization_id uuid not null,
  project_id uuid not null,
  handoff_id text not null
    check (
      char_length(btrim(handoff_id)) between 1 and 160
      and handoff_id = btrim(handoff_id)
    ),
  impact_review_id text not null
    check (
      char_length(btrim(impact_review_id)) between 1 and 160
      and impact_review_id = btrim(impact_review_id)
    ),
  primary key (
    organization_id,
    project_id,
    handoff_id,
    impact_review_id
  ),
  constraint handoff_impact_reviews_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint handoff_impact_reviews_handoff_fkey
    foreign key (organization_id, project_id, handoff_id)
    references project_intelligence.logical_handoffs (
      organization_id,
      project_id,
      handoff_id
    )
    on delete restrict,
  constraint handoff_impact_reviews_review_fkey
    foreign key (organization_id, project_id, impact_review_id)
    references project_intelligence.impact_reviews (
      organization_id,
      project_id,
      impact_review_id
    )
    on delete restrict
);

create index handoff_impact_reviews_review_idx
  on project_intelligence.handoff_impact_reviews
  (organization_id, project_id, impact_review_id);

create table project_intelligence.command_records (
  command_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  operation text not null check (operation in (
    'review_claim',
    'publish_version',
    'revise_decision',
    'calculate_impact',
    'review_impact',
    'build_handoff'
  )),
  key_digest bytea not null check (octet_length(key_digest) = 32),
  request_digest bytea not null check (octet_length(request_digest) = 32),
  digest_version text not null
    check (
      char_length(btrim(digest_version)) between 1 and 160
      and digest_version = btrim(digest_version)
    ),
  actor_type text not null check (actor_type in ('human', 'ai', 'system')),
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
  completed_at timestamptz not null default clock_timestamp(),
  constraint command_records_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint command_records_actor_fkey
    foreign key (organization_id, actor_user_id)
    references project_intelligence.organization_members (organization_id, user_id)
    on delete restrict,
  constraint command_records_idempotency_key
    unique (
      organization_id,
      project_id,
      operation,
      key_digest
    ),
  constraint command_records_scope_id_key
    unique (organization_id, project_id, command_id),
  constraint command_records_human_actor_check
    check (
      (actor_type = 'human' and actor_user_id is not null)
      or (actor_type <> 'human' and actor_user_id is null)
    )
);

create index command_records_actor_idx
  on project_intelligence.command_records
  (organization_id, actor_user_id)
  where actor_user_id is not null;

create table project_intelligence.audit_events (
  audit_event_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  command_id uuid not null,
  event_type text not null check (event_type in (
    'claim_review_confirmed',
    'claim_review_rejected',
    'project_version_published',
    'confirmed_decision_revised',
    'impact_run_created',
    'impact_reviewed',
    'logical_handoff_built'
  )),
  actor_type text not null check (actor_type in ('human', 'ai', 'system')),
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
    check (jsonb_typeof(controlled_metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint audit_events_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint audit_events_command_fkey
    foreign key (organization_id, project_id, command_id)
    references project_intelligence.command_records (
      organization_id,
      project_id,
      command_id
    )
    on delete restrict,
  constraint audit_events_metadata_allowlist_check
    check (
      (
        event_type in ('claim_review_confirmed', 'claim_review_rejected')
        and controlled_metadata - array[
          'review_id',
          'target_revision_id',
          'decision'
        ]::text[] = '{}'::jsonb
      )
      or (
        event_type = 'project_version_published'
        and controlled_metadata - array[
          'version_id',
          'base_version_id',
          'version_no',
          'selected_revision_count',
          'linked_change_set_ids'
        ]::text[] = '{}'::jsonb
      )
      or (
        event_type = 'confirmed_decision_revised'
        and controlled_metadata - array[
          'change_set_id',
          'node_id',
          'from_revision_id',
          'to_revision_id',
          'reason_code'
        ]::text[] = '{}'::jsonb
      )
      or (
        event_type = 'impact_run_created'
        and controlled_metadata - array[
          'impact_run_id',
          'change_set_id',
          'from_version_id',
          'to_version_id',
          'impact_count',
          'changed_node_count'
        ]::text[] = '{}'::jsonb
      )
      or (
        event_type = 'impact_reviewed'
        and controlled_metadata - array[
          'impact_review_id',
          'impact_run_id',
          'impact_id',
          'previous_status',
          'disposition',
          'reason_code'
        ]::text[] = '{}'::jsonb
      )
      or (
        event_type = 'logical_handoff_built'
        and controlled_metadata - array[
          'handoff_id',
          'version_id',
          'impact_run_id',
          'unresolved_impact_count',
          'resolved_impact_count'
        ]::text[] = '{}'::jsonb
      )
    )
);

create index audit_events_command_idx
  on project_intelligence.audit_events
  (organization_id, project_id, command_id);
create index audit_events_project_occurred_idx
  on project_intelligence.audit_events
  (organization_id, project_id, occurred_at desc);

create function project_intelligence.current_user_is_active_member(
  p_organization_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from project_intelligence.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = (select auth.uid())
      and om.status = 'active'
  )
$function$;

create function project_intelligence.current_user_has_capability(
  p_organization_id uuid,
  p_capability text
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select
    project_intelligence.current_user_is_active_member(p_organization_id)
    and exists (
      select 1
      from project_intelligence.member_capabilities mc
      where mc.organization_id = p_organization_id
        and mc.user_id = (select auth.uid())
        and mc.capability = p_capability
    )
$function$;

do $append_only$
declare
  v_table text;
begin
  foreach v_table in array array[
    'sources',
    'source_fragments',
    'graph_node_revisions',
    'human_reviews',
    'evidence_links',
    'graph_edges',
    'project_versions',
    'version_nodes',
    'version_reviews',
    'version_sources',
    'version_source_fragments',
    'version_evidence_links',
    'version_edges',
    'change_sets',
    'change_set_reasons',
    'change_set_publications',
    'impact_runs',
    'impact_run_changes',
    'impacts',
    'impact_path_steps',
    'impact_reviews',
    'logical_handoffs',
    'handoff_impact_reviews',
    'command_records',
    'audit_events'
  ]
  loop
    execute format(
      'create trigger %I before update or delete on project_intelligence.%I '
      || 'for each row execute function '
      || 'project_intelligence.reject_append_only_mutation()',
      v_table || '_append_only',
      v_table
    );
  end loop;
end
$append_only$;

do $table_security$
declare
  v_table text;
begin
  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'project_intelligence'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table project_intelligence.%I owner to pi_table_owner',
      v_table
    );
    execute format(
      'alter table project_intelligence.%I enable row level security',
      v_table
    );
    execute format(
      'alter table project_intelligence.%I force row level security',
      v_table
    );
    execute format(
      'revoke all on table project_intelligence.%I '
      || 'from public, anon, authenticated, service_role',
      v_table
    );
  end loop;
end
$table_security$;

alter function project_intelligence.reject_append_only_mutation()
  owner to pi_table_owner;
alter function project_intelligence.is_valid_source_locator(text, jsonb)
  owner to pi_table_owner;
alter function project_intelligence.validate_revision_evidence()
  owner to pi_table_owner;
alter function project_intelligence.validate_version_evidence_scope()
  owner to pi_table_owner;
alter function project_intelligence.validate_version_closure()
  owner to pi_table_owner;
alter function project_intelligence.validate_change_publication()
  owner to pi_table_owner;
alter function project_intelligence.validate_impact_path()
  owner to pi_table_owner;
alter function project_intelligence.current_user_is_active_member(uuid)
  owner to pi_table_owner;
alter function project_intelligence.current_user_has_capability(uuid, text)
  owner to pi_table_owner;

revoke all on all functions in schema project_intelligence
  from public, anon, authenticated, service_role;
grant execute
  on function project_intelligence.is_valid_source_locator(text, jsonb)
  to pi_human_executor, pi_worker_executor;
grant execute
  on function project_intelligence.validate_revision_evidence()
  to pi_human_executor, pi_worker_executor;
grant execute
  on function project_intelligence.validate_version_closure()
  to pi_human_executor, pi_worker_executor;
grant execute
  on function project_intelligence.validate_change_publication()
  to pi_human_executor, pi_worker_executor;
grant execute
  on function project_intelligence.validate_impact_path()
  to pi_human_executor, pi_worker_executor;
grant execute
  on function project_intelligence.current_user_is_active_member(uuid)
  to pi_human_executor;
grant execute
  on function project_intelligence.current_user_has_capability(uuid, text)
  to pi_human_executor;

grant usage on schema auth to pi_human_executor;
grant execute on function auth.uid() to pi_human_executor;

grant select on all tables in schema project_intelligence
  to pi_human_executor, pi_worker_executor;

grant update on table project_intelligence.project_workflows
  to pi_human_executor, pi_worker_executor;
grant update on table project_intelligence.graph_nodes
  to pi_human_executor;

-- UPDATE is needed for SELECT ... FOR UPDATE row locks on immutable entities.
-- The BEFORE trigger above still rejects every actual UPDATE and DELETE.
grant update on table
  project_intelligence.sources,
  project_intelligence.source_fragments,
  project_intelligence.graph_node_revisions,
  project_intelligence.human_reviews,
  project_intelligence.evidence_links,
  project_intelligence.graph_edges,
  project_intelligence.project_versions,
  project_intelligence.version_nodes,
  project_intelligence.version_reviews,
  project_intelligence.version_sources,
  project_intelligence.version_source_fragments,
  project_intelligence.version_evidence_links,
  project_intelligence.version_edges,
  project_intelligence.change_sets,
  project_intelligence.change_set_reasons,
  project_intelligence.change_set_publications,
  project_intelligence.impact_runs,
  project_intelligence.impact_run_changes,
  project_intelligence.impacts,
  project_intelligence.impact_path_steps,
  project_intelligence.impact_reviews,
  project_intelligence.logical_handoffs,
  project_intelligence.handoff_impact_reviews,
  project_intelligence.command_records,
  project_intelligence.audit_events
  to pi_human_executor, pi_worker_executor;

grant insert on table
  project_intelligence.graph_node_revisions,
  project_intelligence.human_reviews,
  project_intelligence.project_versions,
  project_intelligence.version_nodes,
  project_intelligence.version_reviews,
  project_intelligence.version_sources,
  project_intelligence.version_source_fragments,
  project_intelligence.version_evidence_links,
  project_intelligence.version_edges,
  project_intelligence.change_sets,
  project_intelligence.change_set_reasons,
  project_intelligence.change_set_publications,
  project_intelligence.impact_reviews,
  project_intelligence.command_records,
  project_intelligence.audit_events
  to pi_human_executor;

grant insert on table
  project_intelligence.impact_runs,
  project_intelligence.impact_run_changes,
  project_intelligence.impacts,
  project_intelligence.impact_path_steps,
  project_intelligence.logical_handoffs,
  project_intelligence.handoff_impact_reviews,
  project_intelligence.command_records,
  project_intelligence.audit_events
  to pi_worker_executor;

create policy deployment_cells_human_read
on project_intelligence.deployment_cells
for select to pi_human_executor
using (true);
create policy deployment_cells_worker_read
on project_intelligence.deployment_cells
for select to pi_worker_executor
using (true);

create policy organizations_human_member
on project_intelligence.organizations
for select to pi_human_executor
using (
  project_intelligence.current_user_is_active_member(id)
);
create policy organizations_worker_read
on project_intelligence.organizations
for select to pi_worker_executor
using (true);

create policy organization_members_human_self
on project_intelligence.organization_members
for select to pi_human_executor
using (
  user_id = (select auth.uid())
);
create policy organization_members_worker_read
on project_intelligence.organization_members
for select to pi_worker_executor
using (true);

create policy member_capabilities_human_self
on project_intelligence.member_capabilities
for select to pi_human_executor
using (
  user_id = (select auth.uid())
);
create policy member_capabilities_worker_read
on project_intelligence.member_capabilities
for select to pi_worker_executor
using (true);

do $tenant_policies$
declare
  v_table text;
begin
  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'project_intelligence'
      and c.relkind in ('r', 'p')
      and c.relname not in (
        'deployment_cells',
        'organizations',
        'organization_members',
        'member_capabilities'
      )
  loop
    execute format(
      'create policy %I on project_intelligence.%I '
      || 'for all to pi_human_executor '
      || 'using (project_intelligence.current_user_is_active_member(organization_id)) '
      || 'with check (project_intelligence.current_user_is_active_member(organization_id))',
      v_table || '_human_member',
      v_table
    );
    execute format(
      'create policy %I on project_intelligence.%I '
      || 'for all to pi_worker_executor using (true) with check (true)',
      v_table || '_worker',
      v_table
    );
  end loop;
end
$tenant_policies$;

commit;
