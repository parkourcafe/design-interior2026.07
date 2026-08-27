-- Canonical role-safe projection for the released M4/AP1 archive surface.
--
-- The historical workspace read is retained as an internal source for the
-- versioned v2-v9 contracts.  Archive callers use the unversioned function
-- below, whose role is resolved from request-bound membership only.  This keeps
-- the M4 V2/V3 read contracts and their existing ACLs unchanged.

begin;

set local check_function_bodies = on;

do $precondition$
begin
  if to_regprocedure(
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)'
  ) is null then
    raise exception 'PROJECTCEO_WORKSPACE_READ_MISSING';
  end if;
  if to_regprocedure('project_intelligence._request_user_id()') is null then
    raise exception 'PROJECTCEO_REQUEST_USER_ID_MISSING';
  end if;
end
$precondition$;

alter function projectceo_read_api.get_project_workspace_read(uuid, uuid)
  rename to get_project_workspace_read_unfiltered;

revoke all on function
  projectceo_read_api.get_project_workspace_read_unfiltered(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

create function projectceo_read_api._published_role_projection(
  p_data jsonb,
  p_role text,
  p_project_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_latest_baseline jsonb := p_data -> 'latestBaseline';
  v_latest_baseline_id text := coalesce(
    v_latest_baseline ->> 'id',
    v_latest_baseline ->> 'versionId',
    v_latest_baseline ->> 'baselineId'
  );
  v_raw_versions jsonb := coalesce(p_data -> 'packageVersions', '[]'::jsonb);
  v_recipient_distributions jsonb := coalesce(
    p_data -> 'recipientDistributions',
    '[]'::jsonb
  );
  v_version_ids text[] := '{}'::text[];
  v_decision_ids text[] := '{}'::text[];
  v_selection_ids text[] := '{}'::text[];
  v_package_ids text[] := '{}'::text[];
  v_safe_versions jsonb := '[]'::jsonb;
  v_safe_baseline jsonb := null;
  v_safe_decisions jsonb := '[]'::jsonb;
  v_safe_selections jsonb := '[]'::jsonb;
  v_safe_packages jsonb := '[]'::jsonb;
  v_safe_artifacts jsonb := '[]'::jsonb;
  v_safe_distribution_summary jsonb := '[]'::jsonb;
  v_safe_recipient_distributions jsonb := '[]'::jsonb;
begin
  if p_role not in ('owner_lead', 'architect', 'builder', 'client_approver') then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"ROLE_PROJECTION_UNRESOLVED"}'::jsonb
    );
  end if;

  -- Owner and architect are internal project roles.  They retain the
  -- historical authenticated workspace envelope; only builder/client need a
  -- reduced released-package view here.
  if p_role not in ('builder', 'client_approver') then
    return p_data;
  end if;

  if p_role = 'client_approver' then
    select coalesce(array_agg(distinct distribution ->>
      'productionPackageVersionId'), '{}'::text[])
    into v_version_ids
    from jsonb_array_elements(v_recipient_distributions) distribution
    join jsonb_array_elements(v_raw_versions) version
      on version ->> 'id' = distribution ->> 'productionPackageVersionId'
     and version ->> 'status' = 'published'
    where nullif(distribution ->> 'productionPackageVersionId', '') is not null;
  else
    select coalesce(array_agg(distinct version ->> 'id'), '{}'::text[])
    into v_version_ids
    from jsonb_array_elements(v_raw_versions) version
    where version ->> 'status' = 'published'
      and nullif(version ->> 'id', '') is not null;
  end if;

  select coalesce(array_agg(distinct ref.value), '{}'::text[])
  into v_decision_ids
  from jsonb_array_elements(v_raw_versions) version
  cross join lateral jsonb_array_elements_text(coalesce(
    version #> '{exactRevisionRefs,decisions}',
    '[]'::jsonb
  )) ref
  where version ->> 'id' = any(v_version_ids)
    and version ->> 'status' = 'published';

  select coalesce(array_agg(distinct ref.value), '{}'::text[])
  into v_selection_ids
  from jsonb_array_elements(v_raw_versions) version
  cross join lateral jsonb_array_elements_text(coalesce(
    version #> '{exactRevisionRefs,selections}',
    '[]'::jsonb
  )) ref
  where version ->> 'id' = any(v_version_ids)
    and version ->> 'status' = 'published';

  select coalesce(array_agg(distinct version ->> 'packageId'), '{}'::text[])
  into v_package_ids
  from jsonb_array_elements(v_raw_versions) version
  where version ->> 'id' = any(v_version_ids)
    and version ->> 'status' = 'published'
    and nullif(version ->> 'packageId', '') is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'baselineId', version -> 'baselineId',
    'id', version -> 'id',
    'packageId', version -> 'packageId',
    'publishedAt', version -> 'publishedAt',
    'semanticHash', version -> 'semanticHash',
    'status', version -> 'status',
    'versionNo', version -> 'versionNo'
  ) order by version ->> 'packageId', (version ->> 'versionNo')::integer), '[]'::jsonb)
  into v_safe_versions
  from jsonb_array_elements(v_raw_versions) version
  where version ->> 'id' = any(v_version_ids)
    and version ->> 'status' = 'published';

  if v_latest_baseline_id is not null and exists (
    select 1
    from jsonb_array_elements(v_raw_versions) version
    where version ->> 'id' = any(v_version_ids)
      and version ->> 'baselineId' = v_latest_baseline_id
      and version ->> 'status' = 'published'
  ) then
    v_safe_baseline := jsonb_build_object(
      'baselineId', v_latest_baseline_id,
      'id', v_latest_baseline_id,
      'publishedAt', v_latest_baseline -> 'publishedAt',
      'semanticHash', coalesce(
        v_latest_baseline -> 'semanticHash',
        v_latest_baseline -> 'graphDigest'
      ),
      'versionNo', v_latest_baseline -> 'versionNo'
    );
  end if;

  if p_role = 'client_approver' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'areaNodeId', descriptor.area_node_id,
      'claimStatus', revision.claim_status,
      'id', descriptor.node_id,
      'packageId', descriptor.package_id,
      'resolution', revision.payload ->> 'resolution',
      'reviewStatus', 'approved',
      'revisionId', descriptor.revision_id,
      'revisionNo', descriptor.revision_no,
      'title', revision.title,
      'evidence', '[]'::jsonb
    ) order by descriptor.package_id::text, descriptor.node_id), '[]'::jsonb)
    into v_safe_decisions
    from projectceo_product.claim_revision_descriptors descriptor
    join project_intelligence.graph_node_revisions revision
      on revision.organization_id = descriptor.organization_id
     and revision.project_id = descriptor.project_id
     and revision.node_id = descriptor.node_id
     and revision.revision_id = descriptor.revision_id
    where descriptor.organization_id = p_organization_id
      and descriptor.project_id = p_project_id
      and descriptor.kind = 'decision'
      and descriptor.revision_id = any(v_decision_ids)
      and descriptor.package_id::text = any(v_package_ids);

    select coalesce(jsonb_agg(jsonb_build_object(
      'area', coalesce(area_revision.title, descriptor.area_node_id),
      'areaNodeId', descriptor.area_node_id,
      'claimStatus', revision.claim_status,
      'decisionRevisionId', descriptor.decision_revision_id,
      'evidence', '[]'::jsonb,
      'id', descriptor.node_id,
      'packageId', descriptor.package_id,
      'priceObservation', null,
      'revisionHistory', '[]'::jsonb,
      'revisionId', descriptor.revision_id,
      'revisionNo', descriptor.revision_no,
      'reviewStatus', 'approved',
      'specification', coalesce((
        select jsonb_object_agg(spec.key, spec.value)
        from jsonb_each(coalesce(revision.payload -> 'specification', '{}'::jsonb)) spec
        where jsonb_typeof(spec.value) in ('string', 'number', 'boolean')
          and spec.key !~* '(price|cost|margin|markup|purchase|supplier|wholesale|amount|budget|vendor|sku)'
      ), '{}'::jsonb),
      'title', revision.title
    ) order by descriptor.package_id::text, descriptor.node_id), '[]'::jsonb)
    into v_safe_selections
    from projectceo_product.claim_revision_descriptors descriptor
    join project_intelligence.graph_node_revisions revision
      on revision.organization_id = descriptor.organization_id
     and revision.project_id = descriptor.project_id
     and revision.node_id = descriptor.node_id
     and revision.revision_id = descriptor.revision_id
    left join project_intelligence.graph_nodes area
      on area.organization_id = descriptor.organization_id
     and area.project_id = descriptor.project_id
     and area.node_id = descriptor.area_node_id
    left join project_intelligence.graph_node_revisions area_revision
      on area_revision.organization_id = area.organization_id
     and area_revision.project_id = area.project_id
     and area_revision.node_id = area.node_id
     and area_revision.revision_id = area.current_revision_id
    where descriptor.organization_id = p_organization_id
      and descriptor.project_id = p_project_id
      and descriptor.kind = 'selection'
      and descriptor.revision_id = any(v_selection_ids)
      and descriptor.package_id::text = any(v_package_ids);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', package -> 'id',
    'kind', package -> 'kind',
    'name', package -> 'name',
    'status', package -> 'status'
  ) order by package ->> 'id'), '[]'::jsonb)
  into v_safe_packages
  from jsonb_array_elements(coalesce(p_data -> 'packages', '[]'::jsonb)) package
  where package ->> 'id' = any(v_package_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'artifactId', artifact -> 'artifactId',
    'format', artifact -> 'format',
    'id', artifact -> 'id',
    'packageId', artifact -> 'packageId',
    'productionPackageVersionId', artifact -> 'productionPackageVersionId',
    'semanticHash', artifact -> 'semanticHash'
  ) order by artifact ->> 'createdAt', artifact ->> 'id'), '[]'::jsonb)
  into v_safe_artifacts
  from jsonb_array_elements(coalesce(p_data -> 'releaseArtifacts', '[]'::jsonb)) artifact
  where artifact ->> 'productionPackageVersionId' = any(v_version_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'acknowledged', distribution -> 'acknowledged',
    'acknowledgedAt', distribution -> 'acknowledgedAt',
    'artifactId', distribution -> 'artifactId',
    'distributedAt', distribution -> 'distributedAt',
    'distributionId', distribution -> 'distributionId',
    'packageId', distribution -> 'packageId',
    'productionPackageVersionId',
      distribution -> 'productionPackageVersionId',
    'semanticHash', distribution -> 'semanticHash'
  ) order by distribution ->> 'distributedAt' desc), '[]'::jsonb)
  into v_safe_recipient_distributions
  from jsonb_array_elements(v_recipient_distributions) distribution
  where distribution ->> 'productionPackageVersionId' = any(v_version_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'acknowledgementCount', case
      when distribution ->> 'acknowledged' = 'true' then 1 else 0 end,
    'packageId', distribution -> 'packageId',
    'productionPackageVersionId', distribution -> 'productionPackageVersionId',
    'recipientCount', 1
  ) order by distribution ->> 'distributedAt' desc), '[]'::jsonb)
  into v_safe_distribution_summary
  from jsonb_array_elements(v_safe_recipient_distributions) distribution
  where distribution ->> 'productionPackageVersionId' = any(v_version_ids);

  return jsonb_build_object(
    'approvalPackages', '[]'::jsonb,
    'decisions', v_safe_decisions,
    'distributionSummary', v_safe_distribution_summary,
    'executionPackages', case
      when p_role = 'builder' then coalesce(p_data -> 'executionPackages', '[]'::jsonb)
      else '[]'::jsonb
    end,
    'extensionStatus', '{}'::jsonb,
    'latestBaseline', v_safe_baseline,
    'noChangeTerminals', '[]'::jsonb,
    'packages', v_safe_packages,
    'packageVersions', v_safe_versions,
    'projectMetadata', jsonb_build_object(
      'areaM2', p_data -> 'projectMetadata' -> 'areaM2',
      'location', p_data -> 'projectMetadata' -> 'location',
      'model', 'full_project',
      'name', p_data -> 'projectMetadata' -> 'name'
    ),
    'recipientDistributions', v_safe_recipient_distributions,
    'releaseArtifacts', v_safe_artifacts,
    'releaseRecipients', '[]'::jsonb,
    'reviewQueue', '[]'::jsonb,
    'selections', v_safe_selections,
    'sourceStats', jsonb_build_object(
      'duplicateGroups', 0,
      'materializedRecords', 0,
      'physicalRecords', 0,
      'placeholders', 0,
      'quarantinedGroups', 0,
      'reviewQueue', 0,
      'uniqueBlobs', 0
    ),
    'sources', '[]'::jsonb,
    'unresolvedImpactReviewCount', 0
  );
end
$function$;

create function projectceo_read_api.get_project_workspace_read(
  project_id uuid,
  package_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_actor_user_id uuid := project_intelligence._request_user_id();
  v_read jsonb;
  v_organization_id uuid;
  v_role text;
begin
  if v_actor_user_id is null then
    perform projectceo_foundation._raise(
      'P1101',
      'unauthenticated',
      '{}'::jsonb
    );
  end if;

  v_read := projectceo_read_api.get_project_workspace_read_unfiltered(
    project_id,
    package_id
  );

  if v_read -> 'error' is not null and v_read -> 'error' <> 'null'::jsonb then
    return v_read;
  end if;

  v_organization_id := (v_read #>> '{scope,organizationId}')::uuid;
  if v_organization_id is null then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"ROLE_PROJECTION_SCOPE_MISSING"}'::jsonb
    );
  end if;

  -- The claim can select an actor, never a role.  Role and effective scope are
  -- resolved from the same active membership rows used by the Foundation
  -- authorizer, with project membership taking precedence over package scope.
  select membership.role
  into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_organization_id
    and membership.project_id = project_id
    and membership.user_id = v_actor_user_id
    and membership.status = 'active'
  order by case membership.role
    when 'owner_lead' then 1
    when 'architect' then 2
    when 'builder' then 3
    when 'client_approver' then 4
    else 99
  end
  limit 1;

  if v_role is null and package_id is not null then
    select membership.role
    into v_role
    from projectceo_foundation.package_memberships membership
    where membership.organization_id = v_organization_id
      and membership.project_id = project_id
      and membership.package_id = package_id
      and membership.user_id = v_actor_user_id
      and membership.status = 'active'
    order by case membership.role
      when 'builder' then 1
      when 'client_approver' then 2
      else 99
    end
    limit 1;
  end if;

  if v_role is null then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"ROLE_PROJECTION_UNRESOLVED"}'::jsonb
    );
  end if;

  return jsonb_set(
    v_read,
    '{data}',
    projectceo_read_api._published_role_projection(
      v_read -> 'data',
      v_role,
      project_id,
      v_organization_id
    ),
    true
  );
end
$function$;

-- Keep the legacy delivery envelope usable, but do not let it bypass the
-- published-role projection through the renamed internal function.
create or replace function projectceo_api.get_project_delivery(
  project_id uuid,
  package_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_read jsonb;
  v_data jsonb;
  v_acknowledgements jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read(
    project_id,
    package_id
  );
  v_data := v_read -> 'data';

  select coalesce(jsonb_agg(jsonb_build_object(
    'acknowledged', true,
    'packageId', summary -> 'packageId',
    'productionPackageVersionId',
      summary -> 'productionPackageVersionId'
  )), '[]'::jsonb)
  into v_acknowledgements
  from jsonb_array_elements(
    coalesce(v_data -> 'distributionSummary', '[]'::jsonb)
  ) summary
  cross join lateral generate_series(
    1,
    coalesce((summary ->> 'acknowledgementCount')::integer, 0)
  ) acknowledged_ordinal;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', v_read ->> 'requestId',
    'data', jsonb_build_object(
      'acknowledgements', v_acknowledgements,
      'distributions', coalesce(
        v_data -> 'recipientDistributions',
        '[]'::jsonb
      ),
      'extensionStatus', v_data -> 'extensionStatus',
      'latestBaseline', v_data -> 'latestBaseline',
      'noChangeTerminals', v_data -> 'noChangeTerminals',
      'package', case
        when package_id is null then null
        else (
          select package
          from jsonb_array_elements(v_data -> 'packages') package
          where package ->> 'id' = package_id::text
          limit 1
        )
      end,
      'packageVersions', v_data -> 'packageVersions',
      'projectId', project_id,
      'releaseArtifacts', v_data -> 'releaseArtifacts',
      'unresolvedImpactReviewCount',
        v_data -> 'unresolvedImpactReviewCount'
    ),
    'error', null
  );
end
$function$;

alter function projectceo_read_api._published_role_projection(
  jsonb,
  text,
  uuid,
  uuid
)
  owner to pi_table_owner;
alter function projectceo_read_api.get_project_workspace_read(uuid, uuid)
  owner to pi_table_owner;
alter function projectceo_api.get_project_delivery(uuid, uuid)
  owner to pi_table_owner;

revoke all on function projectceo_read_api._published_role_projection(
  jsonb,
  text,
  uuid,
  uuid
)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on function projectceo_read_api.get_project_workspace_read(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant usage on schema projectceo_read_api to authenticated;
grant execute on function
  projectceo_read_api.get_project_workspace_read(uuid, uuid)
  to authenticated;

do $guard$
begin
  if to_regprocedure(
    'projectceo_read_api.get_project_workspace_read_unfiltered(uuid,uuid)'
  ) is null then
    raise exception 'PROJECTCEO_UNFILTERED_READ_MISSING';
  end if;
  if not has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_PUBLISHED_READ_UNREACHABLE';
  end if;
  if has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read_unfiltered(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'pi_human_executor',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'pi_worker_executor',
    'projectceo_read_api.get_project_workspace_read(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_PUBLISHED_READ_ACL_INVALID';
  end if;
  if not has_function_privilege(
    'authenticated',
    'projectceo_api.get_project_delivery(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_LEGACY_DELIVERY_UNREACHABLE';
  end if;
end
$guard$;

commit;
