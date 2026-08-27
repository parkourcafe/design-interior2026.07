\set ON_ERROR_STOP on

select workflow.organization_id as org_a
from project_intelligence.project_workflows workflow
where workflow.project_id = '71111111-1111-4111-8111-111111111111'
\gset dbig_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select remhaos_integration_api.get_project_link_access(
  '71111111-1111-4111-8111-111111111111'
) as access;
do $dbig_owner_access$
declare
  v_access jsonb;
begin
  v_access := remhaos_integration_api.get_project_link_access(
    '71111111-1111-4111-8111-111111111111'
  );
  if v_access ->> 'clientProjection' <> 'false'
     or v_access ->> 'canContribute' <> 'true'
     or v_access ->> 'canPublish' <> 'true' then
    raise exception 'DBIG_OWNER_LINK_ACCESS_INVALID:%', v_access;
  end if;
end
$dbig_owner_access$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select (
  remhaos_integration_api.create_project_link(
    '71111111-1111-4111-8111-111111111111',
    'reference',
    'Reference catalog',
    'https://example.com/catalog#private-fragment',
    array['reference', 'catalog'],
    'Initial project reference',
    'dbig-link-create'
  ) -> 'result' ->> 'linkId'
) as link_id
\gset dbig_
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.link_id = :'dbig_link_id';
do $dbig_link_create_replay$
declare
  v_result jsonb;
  v_link_id uuid;
begin
  v_result := remhaos_integration_api.create_project_link(
    '71111111-1111-4111-8111-111111111111',
    'reference',
    'Reference catalog',
    'https://example.com/catalog#private-fragment',
    array['reference', 'catalog'],
    'Initial project reference',
    'dbig-link-create'
  );
  v_link_id := (v_result #>> '{result,linkId}')::uuid;
  if v_result ->> 'replay' <> 'true'
     or v_link_id <> current_setting('dbig.link_id')::uuid then
    raise exception 'DBIG_LINK_CREATE_REPLAY_INVALID:%', v_result;
  end if;
  if jsonb_array_length(
    remhaos_integration_api.list_project_links(
      '71111111-1111-4111-8111-111111111111'
    )
  ) <> 1 then
    raise exception 'DBIG_LINK_DUPLICATE_CREATED';
  end if;
end
$dbig_link_create_replay$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
do $dbig_dangerous_urls$
declare
  p_url text;
begin
  foreach p_url in array array[
    'javascript:alert(1)',
    'file:///tmp/design.pdf',
    'https://user:pass@example.com/private',
    'http://localhost:8080/admin',
    'http://127.0.0.1/admin',
    'http://2130706433/admin',
    'https://example.com/?token=secret-value'
  ] loop
    begin
      perform remhaos_integration_api.create_project_link(
        '71111111-1111-4111-8111-111111111111',
        'reference',
        'Rejected URL',
        p_url,
        array[]::text[],
        null,
        'dbig-danger-' || left(md5(p_url), 12)
      );
      raise exception 'DBIG_DANGEROUS_URL_ACCEPTED:%', p_url;
    exception when sqlstate 'P1211' then null;
    end;
  end loop;
end
$dbig_dangerous_urls$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '64444444-4444-4444-8444-444444444444';
do $dbig_client_hidden$
declare
  v_list jsonb;
  v_access jsonb;
begin
  v_access := remhaos_integration_api.get_project_link_access(
    '71111111-1111-4111-8111-111111111111'
  );
  v_list := remhaos_integration_api.list_project_links(
    '71111111-1111-4111-8111-111111111111'
  );
  if v_access ->> 'clientProjection' <> 'true'
     or v_access ->> 'canContribute' <> 'false'
     or v_access ->> 'canPublish' <> 'false'
     or jsonb_array_length(v_list) <> 0 then
    raise exception 'DBIG_CLIENT_INTERNAL_LINK_VISIBLE:%:%', v_access, v_list;
  end if;
end
$dbig_client_hidden$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local dbig.link_id = :'dbig_link_id';
do $dbig_link_revise$
declare
  v_result jsonb;
  v_link_id uuid;
begin
  v_link_id := current_setting('dbig.link_id')::uuid;
  v_result := remhaos_integration_api.revise_project_link(
    '71111111-1111-4111-8111-111111111111',
    v_link_id,
    'https://example.com/catalog-v2#ignored',
    array['updated'],
    'Second revision',
    null,
    'dbig-link-revise-1'
  );
  if v_result #>> '{result,revisionNo}' <> '2' then
    raise exception 'DBIG_LINK_REVISION_INVALID:%', v_result;
  end if;
  begin
    perform remhaos_integration_api.revise_project_link(
      '71111111-1111-4111-8111-111111111111',
      v_link_id,
      'https://example.com/catalog-v2#ignored',
      array['updated'],
      'Second revision',
      null,
      'dbig-link-revise-duplicate'
    );
    raise exception 'DBIG_DUPLICATE_REVISION_WITHOUT_REASON_ACCEPTED';
  exception when sqlstate 'P1211' then null;
  end;
end
$dbig_link_revise$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select remhaos_integration_api.publish_project_link_to_client(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_link_id'::uuid,
  1,
  'dbig-link-publish-1'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
select remhaos_integration_api.revise_project_link(
  '71111111-1111-4111-8111-111111111111',
  :'dbig_link_id'::uuid,
  'https://example.com/catalog-v3',
  array['latest'],
  'Superseding team revision',
  'new project context',
  'dbig-link-revise-2'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '64444444-4444-4444-8444-444444444444';
set local dbig.link_id = :'dbig_link_id';
do $dbig_client_projection$
declare
  v_list jsonb;
  v_link_id uuid;
begin
  v_link_id := current_setting('dbig.link_id')::uuid;
  v_list := remhaos_integration_api.list_project_links(
    '71111111-1111-4111-8111-111111111111'
  );
  if jsonb_array_length(v_list) <> 1
     or v_list #>> '{0,revisionNo}' <> '1'
     or v_list #>> '{0,normalizedUrl}' <> 'https://example.com/catalog'
     or v_list #>> '{0,createdBy}' is not null
     or v_list #>> '{0,clientProjection}' <> 'true' then
    raise exception 'DBIG_CLIENT_PROJECTION_INVALID:%', v_list;
  end if;
  begin
    perform remhaos_integration_api.publish_project_link_to_client(
      '71111111-1111-4111-8111-111111111111',
      v_link_id,
      2,
      'dbig-client-publish'
    );
    raise exception 'DBIG_CLIENT_PUBLISH_ACCEPTED';
  exception when sqlstate 'P1103' then null;
  end;
end
$dbig_client_projection$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '64444444-4444-4444-8444-444444444444';
do $dbig_client_create_denied$
begin
  begin
    perform remhaos_integration_api.create_project_link(
      '71111111-1111-4111-8111-111111111111',
      'reference',
      'Client cannot create',
      'https://example.com/client',
      array[]::text[],
      null,
      'dbig-client-create'
    );
    raise exception 'DBIG_CLIENT_CREATE_ACCEPTED';
  exception when sqlstate 'P1103' then null;
  end;
end
$dbig_client_create_denied$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
do $dbig_idempotency_conflict$
begin
  begin
    perform remhaos_integration_api.create_project_link(
      '71111111-1111-4111-8111-111111111111',
      'reference',
      'Changed request',
      'https://example.com/changed',
      array[]::text[],
      null,
      'dbig-link-create'
    );
    raise exception 'DBIG_LINK_IDEMPOTENCY_CONFLICT_ACCEPTED';
  exception when sqlstate 'P1208' then null;
  end;
end
$dbig_idempotency_conflict$;
commit;

select 'DBIG_PROJECT_LINKS_OK' as result;
