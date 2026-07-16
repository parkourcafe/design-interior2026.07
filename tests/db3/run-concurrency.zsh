#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

: "${PI_DB3_CONTAINER:?PI_DB3_CONTAINER is required}"
: "${PI_DB3_DATABASE:?PI_DB3_DATABASE is required}"
: "${PI_DB3_PASSWORD:?PI_DB3_PASSWORD is required}"

container=${PI_DB3_CONTAINER}
database=${PI_DB3_DATABASE}
password=${PI_DB3_PASSWORD}
owner=31111111-1111-4111-8111-111111111111
project=43333333-3333-4333-8333-333333333333
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db3-concurrency.XXXXXX")
trap 'rm -rf "${tmpdir}"' EXIT INT TERM

psql_exec() {
  local app=$1
  local sql=$2
  docker exec \
    -e PGPASSWORD="${password}" \
    -e PGAPPNAME="${app}" \
    "${container}" \
    psql -X --quiet --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --username postgres \
      --dbname "${database}" \
      --command "${sql}"
}

psql_exec db3-concurrency-seed "
  insert into public.projects (
    id, designer_id, client_name, status, intake_token
  ) values (
    '${project}',
    '${owner}',
    'Concurrent Foundation',
    'active_project',
    'db3-concurrent-project'
  )
" >/dev/null

call="begin;
set local role authenticated;
set local request.jwt.claim.sub = '${owner}';
select projectceo_api.enroll_organization_project(
  '${project}',
  'db3-concurrent-enroll'
);
commit;"

set +e
psql_exec db3-enroll-a "${call}" >"${tmpdir}/a.out" 2>&1 &
pid_a=$!
psql_exec db3-enroll-b "${call}" >"${tmpdir}/b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}" != "0" || "${status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent enrollment failed"
  sed -n '1,120p' "${tmpdir}/a.out" >&2
  sed -n '1,120p' "${tmpdir}/b.out" >&2
  exit 1
fi

if [[ $(
  (rg -o '"replay": false' "${tmpdir}/a.out" "${tmpdir}/b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]] || [[ $(
  (rg -o '"replay": true' "${tmpdir}/a.out" "${tmpdir}/b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]]; then
  print -u2 -r -- "Concurrent enrollment replay contract failed"
  sed -n '1,120p' "${tmpdir}/a.out" >&2
  sed -n '1,120p' "${tmpdir}/b.out" >&2
  exit 1
fi

result=$(psql_exec db3-concurrency-assert "
  select count(*)::text
    || '|' || min(state_revision)::text
  from project_intelligence.project_workflows
  where project_id = '${project}'
")
if [[ "${result}" != "1|1" ]]; then
  print -u2 -r -- "Concurrent enrollment persisted invalid root: ${result}"
  exit 1
fi

expiry=$(psql_exec db3-concurrency-expiry "
  select (statement_timestamp() + interval '1 day')::text
")
invite_call="begin;
set local role authenticated;
set local request.jwt.claim.sub = '${owner}';
select projectceo_api.create_invitation(
  '${project}',
  null,
  'concurrent@example.test',
  'architect',
  '${expiry}'::timestamptz,
  decode(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'hex'
  ),
  1,
  'db3-concurrent-invite'
);
commit;"

set +e
psql_exec db3-invite-a "${invite_call}" >"${tmpdir}/invite-a.out" 2>&1 &
pid_a=$!
psql_exec db3-invite-b "${invite_call}" >"${tmpdir}/invite-b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[ "${status_a}" != "0" || "${status_b}" != "0" ]]; then
  print -u2 -r -- "Concurrent invitation replay failed"
  sed -n '1,120p' "${tmpdir}/invite-a.out" >&2
  sed -n '1,120p' "${tmpdir}/invite-b.out" >&2
  exit 1
fi

if [[ $(
  (rg -o '"replay": false' \
    "${tmpdir}/invite-a.out" "${tmpdir}/invite-b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]] || [[ $(
  (rg -o '"replay": true' \
    "${tmpdir}/invite-a.out" "${tmpdir}/invite-b.out" || true) \
    | wc -l | tr -d ' '
) != "1" ]]; then
  print -u2 -r -- "Concurrent invitation replay contract failed"
  sed -n '1,120p' "${tmpdir}/invite-a.out" >&2
  sed -n '1,120p' "${tmpdir}/invite-b.out" >&2
  exit 1
fi

result=$(psql_exec db3-concurrent-invite-assert "
  select pw.state_revision::text
    || '|' || count(i.*)::text
    || '|' || count(i.*) filter (
      where not exists (
        select 1
        from projectceo_foundation.invitation_events ie
        where ie.organization_id = i.organization_id
          and ie.project_id = i.project_id
          and ie.invitation_id = i.invitation_id
          and ie.event_type in ('accepted', 'revoked', 'expired')
      )
    )::text
    || '|' || count(ie.*)::text
  from project_intelligence.project_workflows pw
  left join projectceo_foundation.invitations i
    on i.organization_id = pw.organization_id
   and i.project_id = pw.project_id
   and i.recipient_email = 'concurrent@example.test'
  left join projectceo_foundation.invitation_events ie
    on ie.organization_id = i.organization_id
   and ie.project_id = i.project_id
   and ie.invitation_id = i.invitation_id
  where pw.project_id = '${project}'
  group by pw.state_revision
")
if [[ "${result}" != "2|1|1|0" ]]; then
  print -u2 -r -- "Concurrent invitation persisted invalid state: ${result}"
  exit 1
fi

reissue_call_a="begin;
set local role authenticated;
set local request.jwt.claim.sub = '${owner}';
select projectceo_api.create_invitation(
  '${project}',
  null,
  'concurrent@example.test',
  'architect',
  '${expiry}'::timestamptz,
  decode(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'hex'
  ),
  2,
  'db3-concurrent-reissue-a'
);
commit;"
reissue_call_b="begin;
set local role authenticated;
set local request.jwt.claim.sub = '${owner}';
select projectceo_api.create_invitation(
  '${project}',
  null,
  'concurrent@example.test',
  'architect',
  '${expiry}'::timestamptz,
  decode(
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'hex'
  ),
  2,
  'db3-concurrent-reissue-b'
);
commit;"

set +e
psql_exec db3-reissue-a \
  "${reissue_call_a}" >"${tmpdir}/reissue-a.out" 2>&1 &
pid_a=$!
psql_exec db3-reissue-b \
  "${reissue_call_b}" >"${tmpdir}/reissue-b.out" 2>&1 &
pid_b=$!
wait "${pid_a}"; status_a=$?
wait "${pid_b}"; status_b=$?
set -e

if [[
  ( "${status_a}" == "0" && "${status_b}" == "0" )
  || ( "${status_a}" != "0" && "${status_b}" != "0" )
]]; then
  print -u2 -r -- "Concurrent invitation reissue did not select one winner"
  sed -n '1,120p' "${tmpdir}/reissue-a.out" >&2
  sed -n '1,120p' "${tmpdir}/reissue-b.out" >&2
  exit 1
fi
if ! rg -q 'stale_state' \
  "${tmpdir}/reissue-a.out" "${tmpdir}/reissue-b.out"; then
  print -u2 -r -- "Concurrent invitation reissue loser was not stale"
  sed -n '1,120p' "${tmpdir}/reissue-a.out" >&2
  sed -n '1,120p' "${tmpdir}/reissue-b.out" >&2
  exit 1
fi

result=$(psql_exec db3-concurrent-reissue-assert "
  with scoped as (
    select i.*
    from projectceo_foundation.invitations i
    where i.project_id = '${project}'
      and i.recipient_email = 'concurrent@example.test'
  ),
  active as (
    select i.*
    from scoped i
    where not exists (
      select 1
      from projectceo_foundation.invitation_events ie
      where ie.organization_id = i.organization_id
        and ie.project_id = i.project_id
        and ie.invitation_id = i.invitation_id
        and ie.event_type in ('accepted', 'revoked', 'expired')
    )
  ),
  initial_invitation as (
    select invitation_id
    from scoped
    where token_digest = decode(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'hex'
    )
  )
  select pw.state_revision::text
    || '|' || (select count(*) from scoped)::text
    || '|' || (select count(*) from active)::text
    || '|' || (
      select count(*)
      from projectceo_foundation.invitation_events ie
      join scoped i
        on i.organization_id = ie.organization_id
       and i.project_id = ie.project_id
       and i.invitation_id = ie.invitation_id
      where ie.event_type in ('accepted', 'revoked', 'expired')
    )::text
    || '|' || coalesce((
      select (
        a.replaces_invitation_id = initial_invitation.invitation_id
      )::text
      from active a
      cross join initial_invitation
    ), 'false')
  from project_intelligence.project_workflows pw
  where pw.project_id = '${project}'
")
if [[ "${result}" != "3|2|1|1|true" ]]; then
  print -u2 -r -- "Concurrent invitation reissue invalid state: ${result}"
  exit 1
fi

print -r -- "DB3_CONCURRENCY_OK"
