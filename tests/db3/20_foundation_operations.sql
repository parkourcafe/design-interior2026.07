\set ON_ERROR_STOP on

insert into auth.users (id, email, email_confirmed_at) values
  (
    '31111111-1111-4111-8111-111111111111',
    'owner@example.test',
    statement_timestamp()
  ),
  (
    '32222222-2222-4222-8222-222222222222',
    'architect@example.test',
    statement_timestamp()
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'outsider@example.test',
    statement_timestamp()
  );

insert into public.designers (id, name, studio_name) values
  ('31111111-1111-4111-8111-111111111111', 'Owner', 'ProjectCEO A'),
  ('33333333-3333-4333-8333-333333333333', 'Outsider', 'ProjectCEO B');

insert into public.projects (
  id,
  designer_id,
  client_name,
  status,
  intake_token
) values
  (
    '41111111-1111-4111-8111-111111111111',
    '31111111-1111-4111-8111-111111111111',
    'Foundation A',
    'active_project',
    'db3-foundation-a'
  ),
  (
    '42222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    'Foundation B',
    'active_project',
    'db3-foundation-b'
  );

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.enroll_organization_project(
  '41111111-1111-4111-8111-111111111111',
  'db3-enroll-owner'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select projectceo_api.enroll_organization_project(
  '42222222-2222-4222-8222-222222222222',
  'db3-enroll-outsider'
);
commit;

do $enrollment_assertions$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  if v_org is null then raise exception 'DB3_ENROLLMENT_WORKFLOW_MISSING'; end if;
  if (
    select state_revision
    from project_intelligence.project_workflows
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
  ) <> 1 then
    raise exception 'DB3_ENROLLMENT_STATE';
  end if;
  if not exists (
    select 1
    from projectceo_foundation.project_packages
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
      and id = '41111111-1111-4111-8111-111111111111'
      and kind = 'project_root'
  ) then raise exception 'DB3_ROOT_PACKAGE_MISSING'; end if;
  if (
    select count(*)
    from projectceo_foundation.project_member_capabilities
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
      and user_id = '31111111-1111-4111-8111-111111111111'
  ) <> 18 then
    raise exception 'DB3_OWNER_CAPABILITY_PRESET';
  end if;
end
$enrollment_assertions$;

insert into projectceo_foundation.project_packages (
  organization_id,
  project_id,
  id,
  stable_key,
  kind,
  parent_package_id,
  name
)
select
  pw.organization_id,
  pw.project_id,
  '49999999-9999-4999-8999-999999999999',
  'work-package:test',
  'work_package',
  pw.project_id,
  'Test work package'
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.package_memberships (
  organization_id,
  project_id,
  package_id,
  user_id,
  role
)
select
  pw.organization_id,
  pw.project_id,
  '49999999-9999-4999-8999-999999999999',
  '31111111-1111-4111-8111-111111111111',
  'architect'
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111';

insert into projectceo_foundation.package_member_capabilities (
  organization_id,
  project_id,
  package_id,
  user_id,
  capability
)
select
  pw.organization_id,
  pw.project_id,
  '49999999-9999-4999-8999-999999999999',
  '31111111-1111-4111-8111-111111111111',
  'register_source'
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111';

begin;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $package_authorization_deduplicated$
declare
  v_count bigint;
  v_project_wide boolean;
begin
  select count(*), bool_and(a.project_wide)
    into v_count, v_project_wide
  from projectceo_foundation._authorize_package_human(
    '41111111-1111-4111-8111-111111111111',
    '49999999-9999-4999-8999-999999999999',
    'register_source'
  ) a;
  if v_count <> 1 or v_project_wide is not true then
    raise exception 'DB3_PACKAGE_AUTHORIZATION_AMBIGUOUS';
  end if;
end
$package_authorization_deduplicated$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.enroll_organization_project(
  '41111111-1111-4111-8111-111111111111',
  'db3-enroll-owner'
);
select projectceo_api.enroll_organization_project(
  '41111111-1111-4111-8111-111111111111',
  'db3-enroll-owner-second-key'
);
commit;

do $enrollment_replay$
begin
  if (
    select state_revision
    from project_intelligence.project_workflows
    where project_id = '41111111-1111-4111-8111-111111111111'
  ) <> 1 then
    raise exception 'DB3_ENROLLMENT_REPLAY_CHANGED_STATE';
  end if;
  if (
    select count(*)
    from project_intelligence.project_workflows
    where project_id = '41111111-1111-4111-8111-111111111111'
  ) <> 1 then
    raise exception 'DB3_ONE_PROJECT_ONE_ORGANIZATION';
  end if;
end
$enrollment_replay$;

select statement_timestamp() + interval '1 day' as invitation_expires_at
\gset db3_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.create_invitation(
  '41111111-1111-4111-8111-111111111111',
  null,
  'architect@example.test',
  'architect',
  :'db3_invitation_expires_at'::timestamptz,
  decode(
    '3b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
    'hex'
  ),
  1,
  'db3-create-invite'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $invitation_token_digest_reuse_rejected$
begin
  begin
    perform projectceo_api.create_invitation(
      '41111111-1111-4111-8111-111111111111',
      null,
      'architect@example.test',
      'architect',
      statement_timestamp() + interval '1 day',
      decode(
        '3b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
        'hex'
      ),
      2,
      'db3-reused-invite-token'
    );
    raise exception 'DB3_INVITATION_TOKEN_DIGEST_REUSED';
  exception when sqlstate 'P1108' then null;
  end;
end
$invitation_token_digest_reuse_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.create_invitation(
  '41111111-1111-4111-8111-111111111111',
  null,
  'architect@example.test',
  'architect',
  :'db3_invitation_expires_at'::timestamptz,
  decode(
    '3b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
    'hex'
  ),
  1,
  'db3-create-invite'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.create_invitation(
  '41111111-1111-4111-8111-111111111111',
  null,
  'architect@example.test',
  'architect',
  statement_timestamp() + interval '1 day',
  decode(
    '4b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
    'hex'
  ),
  2,
  'db3-reissue-invite'
);
commit;

do $invitation_reissue_assertions$
declare
  v_old uuid;
  v_new uuid;
  v_replaced uuid;
begin
  select invitation_id into v_old
  from projectceo_foundation.invitations
  where token_digest = decode(
    '3b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
    'hex'
  );
  select invitation_id, replaces_invitation_id into v_new, v_replaced
  from projectceo_foundation.invitations
  where token_digest = decode(
    '4b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
    'hex'
  );
  if v_old is null or v_new is null or v_replaced is distinct from v_old then
    raise exception 'DB3_INVITATION_REISSUE_LINK_MISSING';
  end if;
  if (
    select count(*)
    from projectceo_foundation.invitations i
    where i.recipient_email = 'architect@example.test'
      and i.scope_kind = 'project'
      and not exists (
        select 1
        from projectceo_foundation.invitation_events ie
        where ie.organization_id = i.organization_id
          and ie.project_id = i.project_id
          and ie.invitation_id = i.invitation_id
          and ie.event_type in ('accepted', 'revoked', 'expired')
      )
  ) <> 1 then
    raise exception 'DB3_INVITATION_REISSUE_ACTIVE_COUNT';
  end if;
end
$invitation_reissue_assertions$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
set local request.jwt.claim.email_verified = 'true';
set local request.jwt.claims =
  '{"email":"architect@example.test","email_verified":true,"amr":[{"method":"email","timestamp":1770000000}]}';
do $generic_email_amr_rejected$
begin
  begin
    perform projectceo_api.accept_invitation(
      decode(
        '4b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
        'hex'
      ),
      'db3-generic-email-amr-accept'
    );
    raise exception 'DB3_GENERIC_EMAIL_AMR_ACCEPTED';
  exception when sqlstate 'P1102' then null;
  end;
end
$generic_email_amr_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
set local request.jwt.claim.email_verified = 'true';
set local request.jwt.claims =
  '{"email":"architect@example.test","email_verified":true,"amr":[{"method":"password","timestamp":1770000000}]}';
do $password_only_identity_rejected$
begin
  begin
    perform projectceo_api.accept_invitation(
      decode(
        '4b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
        'hex'
      ),
      'db3-password-only-accept'
    );
    raise exception 'DB3_PASSWORD_ONLY_IDENTITY_ACCEPTED';
  exception when sqlstate 'P1102' then null;
  end;
end
$password_only_identity_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
set local request.jwt.claims =
  '{"email":"architect@example.test","email_verified":true,"amr":[{"method":"magiclink","timestamp":1770000000}]}';
do $superseded_invitation_rejected$
begin
  begin
    perform projectceo_api.accept_invitation(
      decode(
        '3b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
        'hex'
      ),
      'db3-superseded-accept'
    );
    raise exception 'DB3_SUPERSEDED_INVITATION_ACCEPTED';
  exception when sqlstate 'P1106' then null;
  end;
end
$superseded_invitation_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
set local request.jwt.claims =
  '{"email":"architect@example.test","email_verified":true,"amr":[{"method":"magiclink","timestamp":1770000000}]}';
select projectceo_api.accept_invitation(
  decode(
    '4b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
    'hex'
  ),
  'db3-accept-invite'
);
commit;

do $invitation_assertions$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  if not exists (
    select 1
    from projectceo_foundation.project_memberships
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
      and user_id = '32222222-2222-4222-8222-222222222222'
      and role = 'architect'
      and status = 'active'
  ) then raise exception 'DB3_INVITATION_MEMBERSHIP_MISSING'; end if;
  if (
    select count(*)
    from projectceo_foundation.project_member_capabilities
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
      and user_id = '32222222-2222-4222-8222-222222222222'
  ) <> 16 then
    raise exception 'DB3_ARCHITECT_CAPABILITY_PRESET';
  end if;
end
$invitation_assertions$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
-- The request-claims compatibility migration cannot query managed auth.users
-- from the pi_table_owner definer. Duplicate-scope rejection is authoritative
-- at acceptance, where the actor UUID is already known; creation itself must
-- remain harmless and transactional.
select projectceo_api.create_invitation(
  '41111111-1111-4111-8111-111111111111',
  null,
  'architect@example.test',
  'architect',
  statement_timestamp() + interval '1 day',
  decode(
    '5b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
    'hex'
  ),
  4,
  'db3-existing-member-invite'
);
rollback;

-- A legacy email string without verified mailbox identity must never accept.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $unverified_identity$
begin
  begin
    perform projectceo_api.accept_invitation(
      decode(
        '4b6ffb50dbed0e257176b0dcbe7fc1e15b1850e823679304bd321b5dd3c06af7',
        'hex'
      ),
      'db3-unverified-accept'
    );
    raise exception 'DB3_UNVERIFIED_IDENTITY_ACCEPTED';
  exception
    when sqlstate 'P1102' then null;
  end;
end
$unverified_identity$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.create_invitation(
  '41111111-1111-4111-8111-111111111111',
  null,
  'outsider@example.test',
  'builder',
  statement_timestamp() + interval '1 day',
  decode(
    'd067257793e5462160385cee41daf688ffa16685b386e175a17cfbaf6a8aa7b0',
    'hex'
  ),
  4,
  'db3-create-revoked-invite'
);
commit;

select invitation_id as revoked_invitation_id
from projectceo_foundation.invitations
where token_digest = decode(
  'd067257793e5462160385cee41daf688ffa16685b386e175a17cfbaf6a8aa7b0',
  'hex'
)
\gset db3_revoked_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.revoke_invitation(
  '41111111-1111-4111-8111-111111111111',
  :'db3_revoked_revoked_invitation_id',
  5,
  'db3-revoke-invite'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims =
  '{"email":"outsider@example.test","email_verified":true,"amr":[{"method":"otp","timestamp":1770000000}]}';
do $revoked_invitation_deny$
begin
  begin
    perform projectceo_api.accept_invitation(
      decode(
        'd067257793e5462160385cee41daf688ffa16685b386e175a17cfbaf6a8aa7b0',
        'hex'
      ),
      'db3-accept-revoked'
    );
    raise exception 'DB3_REVOKED_INVITATION_ACCEPTED';
  exception when sqlstate 'P1106' then null;
  end;
end
$revoked_invitation_deny$;
rollback;

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
  created_at
)
select
  pw.organization_id,
  pw.project_id,
  '53333333-3333-4333-8333-333333333333',
  null,
  'project',
  'outsider@example.test',
  extensions.digest(
    convert_to('outsider@example.test', 'UTF8'),
    'sha256'
  ),
  decode(
    '3a0a5a4e05194363e8449d0be8833c7bb204b426dc12f883bff37fa76eff3fe7',
    'hex'
  ),
  'builder',
  statement_timestamp() - interval '1 hour',
  '31111111-1111-4111-8111-111111111111',
  statement_timestamp() - interval '2 hours'
from project_intelligence.project_workflows pw
where pw.project_id = '41111111-1111-4111-8111-111111111111';

begin;
set local role service_role;
select projectceo_api.expire_invitation(
  '41111111-1111-4111-8111-111111111111',
  '53333333-3333-4333-8333-333333333333',
  6,
  'db3-expire-invite'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims =
  '{"email":"outsider@example.test","email_verified":true,"amr":[{"method":"otp","timestamp":1770000000}]}';
do $expired_invitation_deny$
begin
  begin
    perform projectceo_api.accept_invitation(
      decode(
        '3a0a5a4e05194363e8449d0be8833c7bb204b426dc12f883bff37fa76eff3fe7',
        'hex'
      ),
      'db3-accept-expired'
    );
    raise exception 'DB3_EXPIRED_INVITATION_ACCEPTED';
  exception when sqlstate 'P1105' then null;
  end;
end
$expired_invitation_deny$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.register_source_inventory(
  '41111111-1111-4111-8111-111111111111',
  jsonb_build_array(
    jsonb_build_object(
      'physicalRecordId', '51111111-1111-4111-8111-111111111111',
      'sanitizedName', 'source-001.pdf',
      'hierarchy', jsonb_build_object(
        'projectId', '41111111-1111-4111-8111-111111111111',
        'packageId', '41111111-1111-4111-8111-111111111111',
        'floorId', 'floor-first',
        'zoneId', 'zone-public',
        'disciplineId', 'architecture'
      ),
      'availability', 'materialized',
      'documentStatus', 'current',
      'sizeBytes', 1024,
      'checksum',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'sourceRevisionId', 'revision-source-1',
      'semanticConflict', false
    ),
    jsonb_build_object(
      'physicalRecordId', '52222222-2222-4222-8222-222222222222',
      'sanitizedName', 'source-002.pdf',
      'hierarchy', jsonb_build_object(
        'projectId', '41111111-1111-4111-8111-111111111111',
        'packageId', '41111111-1111-4111-8111-111111111111',
        'floorId', 'floor-second',
        'zoneId', 'zone-kitchen',
        'disciplineId', 'architecture'
      ),
      'availability', 'placeholder',
      'documentStatus', 'reference',
      'sizeBytes', null,
      'checksum', null,
      'sourceRevisionId', null,
      'semanticConflict', false
    )
  ),
  jsonb_build_object(
    'projectId', '41111111-1111-4111-8111-111111111111',
    'entries', jsonb_build_array(),
    'exactHashGroups', jsonb_build_array()
  ),
  7,
  'db3-register-inventory'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.authorize_source_upload(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'application/pdf',
  'pdf',
  2048,
  'drawing-preview'
);
do $unsupported_upload$
begin
  begin
    perform projectceo_api.authorize_source_upload(
      '41111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'application/octet-stream',
      'dwg',
      2048,
      'document'
    );
    raise exception 'DB3_RAW_DWG_AUTHORIZED';
  exception
    when sqlstate 'P1110' then null;
  end;
end
$unsupported_upload$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $invalid_source_revision_closure$
declare
  v_case record;
  v_source jsonb;
  v_nodes jsonb;
  v_revisions jsonb;
begin
  for v_case in
    select *
    from jsonb_to_recordset(jsonb_build_array(
      jsonb_build_object(
        'caseId', 'missing-revision',
        'requestedRevisionId', 'invalid-revision-missing',
        'revisionId', 'invalid-revision-present',
        'nodeKind', 'source',
        'nodeCurrentRevisionId', 'invalid-revision-present',
        'payloadSourceId', 'source-invalid-closure'
      ),
      jsonb_build_object(
        'caseId', 'wrong-node-kind',
        'requestedRevisionId', 'invalid-revision-kind',
        'revisionId', 'invalid-revision-kind',
        'nodeKind', 'requirement',
        'nodeCurrentRevisionId', 'invalid-revision-kind',
        'payloadSourceId', 'source-invalid-closure'
      ),
      jsonb_build_object(
        'caseId', 'not-current-revision',
        'requestedRevisionId', 'invalid-revision-current',
        'revisionId', 'invalid-revision-current',
        'nodeKind', 'source',
        'nodeCurrentRevisionId', 'invalid-revision-other',
        'payloadSourceId', 'source-invalid-closure'
      ),
      jsonb_build_object(
        'caseId', 'wrong-source-binding',
        'requestedRevisionId', 'invalid-revision-source',
        'revisionId', 'invalid-revision-source',
        'nodeKind', 'source',
        'nodeCurrentRevisionId', 'invalid-revision-source',
        'payloadSourceId', 'different-source'
      )
    )) as c(
      "caseId" text,
      "requestedRevisionId" text,
      "revisionId" text,
      "nodeKind" text,
      "nodeCurrentRevisionId" text,
      "payloadSourceId" text
    )
  loop
    v_source := jsonb_build_object(
      'sourceId', 'source-invalid-closure',
      'sourceRevisionId', v_case."requestedRevisionId",
      'kind', 'pdf',
      'checksumHex',
        'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      'packageId', '41111111-1111-4111-8111-111111111111',
      'metadata', jsonb_build_object(
        'originalFilename', 'invalid-closure.pdf',
        'mediaType', 'application/pdf',
        'sizeBytes', 1024,
        'extension', 'pdf',
        'sourceRole', 'document',
        'declaredRevision', null,
        'documentStatus', 'current'
      )
    );
    v_nodes := jsonb_build_array(jsonb_build_object(
      'nodeId', 'node-invalid-source',
      'kind', v_case."nodeKind",
      'stableKey', 'source:invalid-closure',
      'currentRevisionId', v_case."nodeCurrentRevisionId"
    ));
    v_revisions := jsonb_build_array(jsonb_build_object(
      'revisionId', v_case."revisionId",
      'nodeId', 'node-invalid-source',
      'revisionNo', 1,
      'title', 'Invalid source binding',
      'payload', jsonb_build_object(
        'schemaVersion', 'project-ceo/source-metadata/0.1',
        'sourceId', v_case."payloadSourceId"
      ),
      'origin', 'import',
      'claimStatus', 'extracted',
      'unknownReason', null,
      'replacesRevisionId', null,
      'contentDigestHex',
        'cececececececececececececececececececececececececececececececece'
    ));

    begin
      perform projectceo_api.ingest_source_graph(
        '41111111-1111-4111-8111-111111111111',
        v_source,
        '[]'::jsonb,
        v_nodes,
        v_revisions,
        '[]'::jsonb,
        '[]'::jsonb,
        8,
        'db3-invalid-source-binding-' || v_case."caseId"
      );
      raise exception 'DB3_INVALID_SOURCE_BINDING_ACCEPTED:%', v_case."caseId";
    exception when sqlstate 'P1111' then null;
    end;
  end loop;

end
$invalid_source_revision_closure$;
rollback;

do $invalid_source_revision_not_persisted$
begin
  if exists (
    select 1
    from project_intelligence.sources
    where source_id = 'source-invalid-closure'
  ) then
    raise exception 'DB3_INVALID_SOURCE_BINDING_PERSISTED';
  end if;
end
$invalid_source_revision_not_persisted$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.ingest_source_graph(
  '41111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'sourceId', 'source-pdf-1',
    'sourceRevisionId', 'revision-source-1',
    'kind', 'pdf',
    'checksumHex',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'packageId', '41111111-1111-4111-8111-111111111111',
    'metadata', jsonb_build_object(
      'originalFilename', 'Second floor plan.pdf',
      'mediaType', 'application/pdf',
      'sizeBytes', 2048,
      'extension', 'pdf',
      'sourceRole', 'drawing-preview',
      'declaredRevision', 'R1',
      'documentStatus', 'current'
    )
  ),
  jsonb_build_array(jsonb_build_object(
    'fragmentId', 'fragment-pdf-1',
    'locatorKind', 'pdf',
    'locator', jsonb_build_object('kind', 'pdf', 'page', 1)
  )),
  jsonb_build_array(
    jsonb_build_object(
      'nodeId', 'node-source-1',
      'kind', 'source',
      'stableKey', 'source:pdf:1',
      'currentRevisionId', 'revision-source-1'
    ),
    jsonb_build_object(
      'nodeId', 'node-requirement-1',
      'kind', 'requirement',
      'stableKey', 'requirement:egress',
      'currentRevisionId', 'revision-requirement-1'
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'revisionId', 'revision-source-1',
      'nodeId', 'node-source-1',
      'revisionNo', 1,
      'title', 'Source PDF',
      'payload', jsonb_build_object(
        'schemaVersion', 'project-ceo/source-metadata/0.1',
        'sourceId', 'source-pdf-1'
      ),
      'origin', 'import',
      'claimStatus', 'extracted',
      'unknownReason', null,
      'replacesRevisionId', null,
      'contentDigestHex',
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    ),
    jsonb_build_object(
      'revisionId', 'revision-requirement-1',
      'nodeId', 'node-requirement-1',
      'revisionNo', 1,
      'title', 'Egress requirement',
      'payload', jsonb_build_object(
        'schemaVersion', 'project-ceo/requirement/0.1',
        'text', 'Keep egress clear'
      ),
      'origin', 'ai',
      'claimStatus', 'interpreted',
      'unknownReason', null,
      'replacesRevisionId', null,
      'contentDigestHex',
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    )
  ),
  jsonb_build_array(jsonb_build_object(
    'evidenceLinkId', 'evidence-requirement-1',
    'nodeRevisionId', 'revision-requirement-1',
    'sourceFragmentId', 'fragment-pdf-1'
  )),
  jsonb_build_array(jsonb_build_object(
    'edgeId', 'edge-requirement-source-1',
    'fromNodeId', 'node-requirement-1',
    'toNodeId', 'node-source-1',
    'relation', 'derived_from'
  )),
  8,
  'db3-ingest-source'
);
commit;

do $ingestion_assertions$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  if (
    select count(*)
    from project_intelligence.sources
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
  ) <> 1 then raise exception 'DB3_SOURCE_COUNT'; end if;
  if (
    select count(*)
    from project_intelligence.graph_nodes
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
  ) <> 2 then raise exception 'DB3_GRAPH_NODE_COUNT'; end if;
  if not exists (
    select 1
    from project_intelligence.evidence_links
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
      and node_revision_id = 'revision-requirement-1'
  ) then raise exception 'DB3_AI_EVIDENCE_MISSING'; end if;
  if not exists (
    select 1
    from project_intelligence.graph_nodes n
    join project_intelligence.graph_node_revisions r
      on r.organization_id = n.organization_id
     and r.project_id = n.project_id
     and r.node_id = n.node_id
     and r.revision_id = n.current_revision_id
    where n.organization_id = v_org
      and n.project_id = '41111111-1111-4111-8111-111111111111'
      and n.node_id = 'node-source-1'
      and n.kind = 'source'
      and n.current_revision_id = 'revision-source-1'
      and r.payload ->> 'sourceId' = 'source-pdf-1'
  ) then raise exception 'DB3_SOURCE_REVISION_CLOSURE_MISSING'; end if;
  if not exists (
    select 1
    from projectceo_foundation.command_records cr
    where cr.organization_id = v_org
      and cr.project_id = '41111111-1111-4111-8111-111111111111'
      and cr.operation = 'ingest_source_graph'
      and cr.logical_result ->> 'sourceRevisionId' = 'revision-source-1'
  ) then raise exception 'DB3_INGESTION_RESULT_REVISION_MISMATCH'; end if;
  if exists (
    select 1
    from projectceo_foundation.audit_events
    where organization_id = v_org
      and project_id = '41111111-1111-4111-8111-111111111111'
      and controlled_metadata::text ~*
        '(Second floor plan|originalFilename|storageObjectPath|token|email)'
  ) then raise exception 'DB3_AUDIT_LEAK'; end if;
end
$ingestion_assertions$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select project_intelligence_api.review_claim(
  '41111111-1111-4111-8111-111111111111',
  'revision-source-1',
  'revision-source-1',
  9,
  'confirmed',
  'db3-review-source'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select project_intelligence_api.review_claim(
  '41111111-1111-4111-8111-111111111111',
  'revision-requirement-1',
  'revision-requirement-1',
  10,
  'confirmed',
  'db3-review-requirement'
);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select project_intelligence_api.publish_version(
  '41111111-1111-4111-8111-111111111111',
  null,
  11,
  'DB3 approved baseline',
  '[]'::jsonb,
  'db3-publish-baseline'
);
commit;

select latest_version_id as version_id
from project_intelligence.project_workflows
where project_id = '41111111-1111-4111-8111-111111111111'
\gset db3_published_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $work_package_guest_grant_rejected$
begin
  begin
    perform projectceo_api.create_guest_access_grant(
      '41111111-1111-4111-8111-111111111111',
      '49999999-9999-4999-8999-999999999999',
      'work-package-release-not-bound',
      false,
      statement_timestamp() + interval '1 day',
      decode(
        '79276fb7ea9a7cbf177917c46e813f0f17f65589f386d59e9b3642339a8f779e',
        'hex'
      ),
      12,
      'db3-create-work-package-guest'
    );
    raise exception 'DB3_WORK_PACKAGE_GUEST_GRANT_CREATED';
  exception when sqlstate 'P1109' then null;
  end;
end
$work_package_guest_grant_rejected$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.create_guest_access_grant(
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  :'db3_published_version_id',
  false,
  statement_timestamp() + interval '1 day',
  decode(
    '89276fb7ea9a7cbf177917c46e813f0f17f65589f386d59e9b3642339a8f779e',
    'hex'
  ),
  12,
  'db3-create-guest'
);
commit;

begin;
set local role anon;
do $guest_projection$
declare
  v_result jsonb;
begin
  v_result := projectceo_api.read_guest_release(decode(
    '89276fb7ea9a7cbf177917c46e813f0f17f65589f386d59e9b3642339a8f779e',
    'hex'
  ));
  if nullif(v_result #>> '{data,release,versionId}', '') is null
     or v_result #>> '{data,package,id}'
       <> '41111111-1111-4111-8111-111111111111'
     or v_result -> 'data' ?| array[
       'memberships',
       'sourceRegistry',
       'audit'
     ] then
    raise exception 'DB3_GUEST_PROJECTION_SCOPE';
  end if;
end
$guest_projection$;
rollback;

select grant_id as grant_id
from projectceo_foundation.guest_access_grants
where token_digest = decode(
  '89276fb7ea9a7cbf177917c46e813f0f17f65589f386d59e9b3642339a8f779e',
  'hex'
)
\gset db3_guest_

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.revoke_guest_access_grant(
  '41111111-1111-4111-8111-111111111111',
  :'db3_guest_grant_id',
  13,
  'db3-revoke-guest'
);
commit;

begin;
set local role anon;
do $guest_revoke_deny$
begin
  begin
    perform projectceo_api.read_guest_release(decode(
      '89276fb7ea9a7cbf177917c46e813f0f17f65589f386d59e9b3642339a8f779e',
      'hex'
    ));
    raise exception 'DB3_REVOKED_GUEST_READ';
  exception when sqlstate 'P1106' then null;
  end;
end
$guest_revoke_deny$;
rollback;

-- Failure after domain writes must roll back Source, metadata and state.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
set local projectceo.test_fail_after_domain = 'on';
do $rollback_injection$
begin
  begin
    perform projectceo_api.ingest_source_graph(
      '41111111-1111-4111-8111-111111111111',
      jsonb_build_object(
        'sourceId', 'source-rollback',
        'sourceRevisionId', 'revision-source-rollback',
        'kind', 'pdf',
        'checksumHex',
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'packageId', '41111111-1111-4111-8111-111111111111',
        'metadata', jsonb_build_object(
          'originalFilename', 'rollback.pdf',
          'mediaType', 'application/pdf',
          'sizeBytes', 1024,
          'extension', 'pdf',
          'sourceRole', 'document',
          'declaredRevision', null,
          'documentStatus', 'current'
        )
      ),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'nodeId', 'node-source-rollback',
        'kind', 'source',
        'stableKey', 'source:rollback',
        'currentRevisionId', 'revision-source-rollback'
      )),
      jsonb_build_array(jsonb_build_object(
        'revisionId', 'revision-source-rollback',
        'nodeId', 'node-source-rollback',
        'revisionNo', 1,
        'title', 'Rollback source',
        'payload', jsonb_build_object('sourceId', 'source-rollback'),
        'origin', 'import',
        'claimStatus', 'extracted',
        'unknownReason', null,
        'replacesRevisionId', null,
        'contentDigestHex',
          'abababababababababababababababababababababababababababababababab'
      )),
      '[]'::jsonb,
      '[]'::jsonb,
      14,
      'db3-ingest-rollback'
    );
    raise exception 'DB3_INJECTED_FAILURE_DID_NOT_FIRE';
  exception
    when sqlstate 'P1112' then null;
  end;
end
$rollback_injection$;
rollback;

do $rollback_assertion$
begin
  if exists (
    select 1 from project_intelligence.sources where source_id = 'source-rollback'
  ) then raise exception 'DB3_ROLLBACK_SOURCE_PERSISTED'; end if;
  if (
    select state_revision
    from project_intelligence.project_workflows
    where project_id = '41111111-1111-4111-8111-111111111111'
  ) <> 14 then raise exception 'DB3_ROLLBACK_STATE_CHANGED'; end if;
end
$rollback_assertion$;

-- Project-scoped reads exclude another Organization.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $tenant_read$
declare
  v_result jsonb;
begin
  v_result := projectceo_api.list_projects();
  if jsonb_array_length(v_result -> 'data') = 0
     or exists (
       select 1
       from jsonb_array_elements(v_result -> 'data') item
       where item ->> 'projectId'
         <> '41111111-1111-4111-8111-111111111111'
     ) then
    raise exception 'DB3_CROSS_TENANT_PROJECT_LIST';
  end if;
end
$tenant_read$;
rollback;

-- Suspension and inactive membership deny immediately.
update project_intelligence.organizations
set status = 'suspended'
where id = (
  select organization_id
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111'
);
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $suspended_deny$
begin
  begin
    perform projectceo_api.get_project_summary(
      '41111111-1111-4111-8111-111111111111'
    );
    raise exception 'DB3_SUSPENDED_ORG_READ';
  exception when sqlstate 'P1103' then null;
  end;
end
$suspended_deny$;
rollback;
update project_intelligence.organizations
set status = 'active'
where id = (
  select organization_id
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111'
);

update project_intelligence.organization_members
set status = 'inactive'
where organization_id = (
  select organization_id
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111'
)
and user_id = '32222222-2222-4222-8222-222222222222';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '32222222-2222-4222-8222-222222222222';
do $inactive_deny$
begin
  begin
    perform projectceo_api.get_project_summary(
      '41111111-1111-4111-8111-111111111111'
    );
    raise exception 'DB3_INACTIVE_MEMBER_READ';
  exception when sqlstate 'P1103' then null;
  end;
end
$inactive_deny$;
rollback;
update project_intelligence.organization_members
set status = 'active'
where organization_id = (
  select organization_id
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111'
)
and user_id = '32222222-2222-4222-8222-222222222222';

-- Account deletion cannot silently cascade immutable Project Intelligence.
do $account_delete_restrict$
begin
  begin
    delete from auth.users
    where id = '31111111-1111-4111-8111-111111111111';
    raise exception 'DB3_ACCOUNT_DELETE_BYPASSED_RESTRICT';
  exception
    when foreign_key_violation then null;
  end;
end
$account_delete_restrict$;

select 'DB3_FOUNDATION_OPERATIONS_OK' as result;
