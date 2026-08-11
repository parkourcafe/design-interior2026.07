#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

# Гонки СОЗДАНИЯ живой связи, а не её поздней финализации.
#
# Финализация двух связей одного чата (её проверяет `run-concurrency.zsh`)
# доказывает, что победитель один. Но она уже опоздала: к тому моменту обе
# связи существуют, обе занимают чат, и вопрос лишь в том, какая откроет приём.
# Инвариант «одна живая связь» нарушается РАНЬШЕ — при вставке. Сюда и целится
# этот файл.
#
# СИНХРОНИЗАЦИЯ — НАБЛЮДАЕМАЯ ЗАЩЁЛКА, А НЕ `sleep`.
#
#   1. контролёр берёт ИСКЛЮЧИТЕЛЬНУЮ advisory-блокировку и держит её;
#   2. сценарий ждёт, пока блокировка НАБЛЮДАЕМО выдана (`pg_locks.granted`);
#   3. участники берут ту же блокировку РАЗДЕЛЯЕМОЙ — и встают в очередь;
#   4. контролёр ждёт, пока в `pg_locks` появятся ровно N неудовлетворённых
#      ожиданий, и только тогда отпускает;
#   5. разделяемую блокировку все участники получают ОДНОВРЕМЕННО.
#
# `sleep 0.4` вместо этого означал бы «наверное, успели». На загруженном
# раннере не успевают, и тест из доказательства превращается в лотерею, которая
# чаще всего выпадает зелёной.

: "${PI_DB4_DATABASE:?PI_DB4_DATABASE is required}"

owner_a=31111111-1111-4111-8111-111111111111
owner_b=33333333-3333-4333-8333-333333333333
project_b=42222222-2222-4222-8222-222222222222

tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db4-tg-concurrency.XXXXXX")
trap 'rm -rf "${tmpdir}"' EXIT INT TERM

# Две среды исполнения, один текст запросов: в CI база живёт в контейнере, на
# машине разработчика — в локальном кластере. Выбор среды не должен менять сам
# сценарий, иначе доказывать он будет разные вещи в разных местах.
psql_exec() {
  local app=$1
  local sql=$2
  if [[ -n "${PI_DB4_CONTAINER:-}" ]]; then
    docker exec \
      -e PGPASSWORD="${PI_DB4_PASSWORD:-}" \
      -e PGAPPNAME="${app}" \
      "${PI_DB4_CONTAINER}" \
      psql -X --quiet --tuples-only --no-align \
        --set ON_ERROR_STOP=1 \
        --username postgres \
        --dbname "${PI_DB4_DATABASE}" \
        --command "${sql}"
  else
    PGAPPNAME="${app}" psql -X --quiet --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --dbname "${PI_DB4_DATABASE}" \
      --command "${sql}"
  fi
}

fail() {
  print -u2 -r -- "TELEGRAM_CONCURRENCY_FAILED: $1"
  shift
  for file in "$@"; do
    [[ -f "${file}" ]] && { print -u2 -r -- "--- ${file:t} ---"; sed -n '1,80p' "${file}" >&2 }
  done
  exit 1
}

LATCH_CLASS=424242

# Контролёр защёлки: держит её, пока не увидит нужное число ожидающих.
latch_controller() {
  local slot=$1 waiters=$2
  print -r -- "select pg_catalog.pg_advisory_lock(${LATCH_CLASS}, ${slot});
do \$latch\$
declare
  v_waiting integer;
  v_spins integer := 0;
begin
  loop
    select count(*) into v_waiting
    from pg_catalog.pg_locks
    where locktype = 'advisory'
      and classid = ${LATCH_CLASS} and objid = ${slot}
      and not granted;
    exit when v_waiting >= ${waiters};
    v_spins := v_spins + 1;
    if v_spins > 600 then
      raise exception 'DB4_TGC_LATCH_NEVER_REACHED_QUORUM:%', v_waiting;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
end
\$latch\$;
select pg_catalog.pg_advisory_unlock(${LATCH_CLASS}, ${slot});"
}

# Ожидание, что защёлка НАБЛЮДАЕМО закрыта. Не `sleep`: условие проверяется, и
# его отсутствие — падение, а не молчаливое продолжение.
await_latch_closed() {
  local slot=$1
  psql_exec db4-tgc-latch-wait "
    do \$wait\$
    declare v_spins integer := 0;
    begin
      loop
        exit when exists (
          select 1 from pg_catalog.pg_locks
          where locktype = 'advisory'
            and classid = ${LATCH_CLASS} and objid = ${slot}
            and granted
        );
        v_spins := v_spins + 1;
        if v_spins > 600 then
          raise exception 'DB4_TGC_LATCH_NEVER_CLOSED';
        end if;
        perform pg_catalog.pg_sleep(0.05);
      end loop;
    end
    \$wait\$;" >/dev/null
}

# Участник гонки: встаёт на защёлку, и только потом делает свою работу.
racer() {
  local slot=$1 body=$2
  print -r -- "select pg_catalog.pg_advisory_lock_shared(${LATCH_CLASS}, ${slot});
select pg_catalog.pg_advisory_unlock_shared(${LATCH_CLASS}, ${slot});
${body}"
}

seed_intent() {
  local project=$1 actor=$2 nonce=$3
  # Намерение заводится напрямую: `create_binding_intent` отзывает предыдущее
  # незавершённое намерение того же проекта, и через него двух живых намерений
  # на один проект не получить — а гонка «один проект, два чата» требует
  # именно двух.
  psql_exec db4-tgc-seed-intent "
    insert into remhaos_channel.channel_link_intents (
      purpose, provider, nonce_digest, organization_id, project_id,
      actor_user_id, expires_at
    )
    select 'project_binding', 'telegram',
      pg_catalog.sha256(convert_to('${nonce}', 'UTF8')),
      pw.organization_id, pw.project_id, '${actor}',
      statement_timestamp() + interval '9 minutes'
    from project_intelligence.project_workflows pw
    where pw.project_id = '${project}'" >/dev/null
}

activate_body() {
  local nonce=$1 external_user=$2 bot=$3 chat=$4
  print -r -- "begin;
set local role service_role;
select remhaos_channel_api.activate_project_binding(
  pg_catalog.sha256(convert_to('${nonce}', 'UTF8')),
  ${external_user}, '${bot}', ${chat}, 'supergroup', 'notice-v1', true, true
);
commit;"
}

assert_race_outcome() {
  local label=$1 status_a=$2 status_b=$3 out_a=$4 out_b=$5
  if [[ $(( status_a + status_b )) == 0 ]]; then
    fail "${label}: both creations succeeded" "${out_a}" "${out_b}"
  fi
  if [[ "${status_a}" != "0" && "${status_b}" != "0" ]]; then
    fail "${label}: both creations failed" "${out_a}" "${out_b}"
  fi
  if ! rg -q 'scope_conflict' "${out_a}" "${out_b}"; then
    fail "${label}: loser did not get a controlled conflict" "${out_a}" "${out_b}"
  fi
  if rg -qi 'duplicate key value|23505' "${out_a}" "${out_b}"; then
    fail "${label}: a raw uniqueness violation leaked out" "${out_a}" "${out_b}"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Два бота, один чат, два проекта — вставка одновременно
# ─────────────────────────────────────────────────────────────────────────────

psql_exec db4-tgc-projects "
  insert into public.projects (id, designer_id, client_name, status, intake_token)
  values
    ('47777777-7777-4777-8777-777777777777','${owner_a}','Race G','active_project','db4-tgc-g'),
    ('48888888-8888-4888-8888-888888888888','${owner_a}','Race H','active_project','db4-tgc-h'),
    ('49999999-9999-4999-8999-999999999999','${owner_a}','Race I','active_project','db4-tgc-i')" >/dev/null

for proj in 47777777-7777-4777-8777-777777777777 \
  48888888-8888-4888-8888-888888888888 \
  49999999-9999-4999-8999-999999999999; do
  psql_exec db4-tgc-enroll "
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = '${owner_a}';
    select projectceo_api.enroll_organization_project('${proj}', 'db4-tgc-enroll-${proj}');
    commit;" >/dev/null
done

seed_intent 47777777-7777-4777-8777-777777777777 "${owner_a}" db4-tgc-chat-g
seed_intent 48888888-8888-4888-8888-888888888888 "${owner_a}" db4-tgc-chat-h

set +e
psql_exec db4-tgc-latch-1 "$(latch_controller 1 2)" >"${tmpdir}/latch-1.out" 2>&1 &
latch_pid_1=$!
set -e
await_latch_closed 1

set +e
psql_exec db4-tgc-chat-a \
  "$(racer 1 "$(activate_body db4-tgc-chat-g 777001 db4-bot-alpha -102000)")" \
  >"${tmpdir}/chat-a.out" 2>&1 &
chat_pid_a=$!
psql_exec db4-tgc-chat-b \
  "$(racer 1 "$(activate_body db4-tgc-chat-h 777001 db4-bot-beta -102000)")" \
  >"${tmpdir}/chat-b.out" 2>&1 &
chat_pid_b=$!
wait "${latch_pid_1}" || fail "latch controller failed" "${tmpdir}/latch-1.out"
wait "${chat_pid_a}"; chat_status_a=$?
wait "${chat_pid_b}"; chat_status_b=$?
set -e

assert_race_outcome "cross-bot chat race" \
  "${chat_status_a}" "${chat_status_b}" "${tmpdir}/chat-a.out" "${tmpdir}/chat-b.out"

chat_live=$(psql_exec db4-tgc-chat-assert "
  select count(*)::text from remhaos_channel.project_channel_bindings
  where external_chat_id = -102000
    and status in ('pending', 'notice_pending', 'active')")
if [[ "${chat_live}" != "1" ]]; then
  fail "cross-bot chat race left ${chat_live} live bindings on one chat"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Один проект, два чата — вставка одновременно
# ─────────────────────────────────────────────────────────────────────────────

seed_intent 49999999-9999-4999-8999-999999999999 "${owner_a}" db4-tgc-proj-1
seed_intent 49999999-9999-4999-8999-999999999999 "${owner_a}" db4-tgc-proj-2

set +e
psql_exec db4-tgc-latch-2 "$(latch_controller 2 2)" >"${tmpdir}/latch-2.out" 2>&1 &
latch_pid_2=$!
set -e
await_latch_closed 2

set +e
psql_exec db4-tgc-proj-a \
  "$(racer 2 "$(activate_body db4-tgc-proj-1 777001 db4-bot-alpha -103000)")" \
  >"${tmpdir}/proj-a.out" 2>&1 &
proj_pid_a=$!
psql_exec db4-tgc-proj-b \
  "$(racer 2 "$(activate_body db4-tgc-proj-2 777001 db4-bot-alpha -103001)")" \
  >"${tmpdir}/proj-b.out" 2>&1 &
proj_pid_b=$!
wait "${latch_pid_2}" || fail "latch controller failed" "${tmpdir}/latch-2.out"
wait "${proj_pid_a}"; proj_status_a=$?
wait "${proj_pid_b}"; proj_status_b=$?
set -e

assert_race_outcome "one-project two-chat race" \
  "${proj_status_a}" "${proj_status_b}" "${tmpdir}/proj-a.out" "${tmpdir}/proj-b.out"

proj_live=$(psql_exec db4-tgc-proj-assert "
  select count(*)::text from remhaos_channel.project_channel_bindings
  where project_id = '49999999-9999-4999-8999-999999999999'
    and status in ('pending', 'notice_pending', 'active')")
if [[ "${proj_live}" != "1" ]]; then
  fail "one-project race left ${proj_live} live bindings for one project"
fi

# Ни одной осиротевшей ожидающей связи после обеих гонок: проигравшая вставка
# не должна оставлять за собой строку, которую никто уже не доведёт до конца.
orphans=$(psql_exec db4-tgc-orphans "
  select count(*)::text from remhaos_channel.project_channel_bindings
  where status = 'notice_pending'
    and external_chat_id in (-102000, -103000, -103001)")
if [[ "${orphans}" != "2" ]]; then
  fail "races left ${orphans} pending bindings, expected exactly two winners"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Право отобрали между `notice_pending` и финализацией
# ─────────────────────────────────────────────────────────────────────────────
#
# Здесь конкуренции нет и не требуется: под проверкой ОКНО между двумя шагами,
# а не столкновение двух транзакций. Изображать гонку там, где её нет, значит
# доказывать не то, что написано.

psql_exec db4-tgc-intent-b "
  begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '${owner_b}';
  select remhaos_channel_api.create_binding_intent(
    '${project_b}', pg_catalog.sha256(convert_to('db4-tgc-late-b', 'UTF8')), 600
  );
  commit;" >/dev/null

psql_exec db4-tgc-activate-b "$(activate_body db4-tgc-late-b 777002 db4-bot -100800)" >/dev/null

binding_b=$(psql_exec db4-tgc-binding "
  select binding_id::text from remhaos_channel.project_channel_bindings
  where external_chat_id = -100800 and status = 'notice_pending'")
if [[ -z "${binding_b}" ]]; then
  fail "activation left no notice_pending binding on -100800"
fi

psql_exec db4-tgc-revoke "
  delete from projectceo_foundation.project_member_capabilities
  where project_id = '${project_b}'
    and user_id = '${owner_b}'
    and capability = 'manage_project_integrations'" >/dev/null

notice_call() {
  local binding=$1 initiator_admin=$2 bot_admin=$3
  print -r -- "begin;
set local role service_role;
select remhaos_channel_api.mark_channel_notice_posted(
  '${binding}'::uuid, 'notice-v1', ${initiator_admin}, ${bot_admin}
) -> 'data' ->> 'changed';
commit;"
}

set +e
psql_exec db4-tgc-notice-revoked "$(notice_call "${binding_b}" true true)" \
  >"${tmpdir}/notice-revoked.out" 2>&1
notice_revoked_status=$?
set -e
if [[ "${notice_revoked_status}" == "0" ]]; then
  fail "capture opened after the capability was revoked" "${tmpdir}/notice-revoked.out"
fi
if ! rg -q 'forbidden' "${tmpdir}/notice-revoked.out"; then
  fail "revoked capability produced the wrong refusal" "${tmpdir}/notice-revoked.out"
fi

# Понижение любой из сторон — тоже отказ, и тоже без открытого приёма.
for pair in "true false" "false true"; do
  set +e
  psql_exec db4-tgc-demoted "$(notice_call "${binding_b}" ${=pair})" \
    >"${tmpdir}/demoted.out" 2>&1
  demoted_status=$?
  set -e
  if [[ "${demoted_status}" == "0" ]]; then
    fail "capture opened with a demoted party (${pair})" "${tmpdir}/demoted.out"
  fi
done

ingest_pending=$(psql_exec db4-tgc-ingest-pending "
  begin;
  set local role service_role;
  select remhaos_channel_api.ingest_channel_update(
    'db4-bot', 9301, -100800, 901, 'message', 777002, null, null, null,
    '{\"kind\":\"message\",\"text\":\"before notice\",\"attachmentCount\":0}'::jsonb
  ) -> 'data' ->> 'stored';
  commit;")
if [[ "${ingest_pending}" != "false" ]]; then
  fail "ingest before notice claimed to store the message: ${ingest_pending}"
fi

# Отказ, который повтор не лечит, ЗАКРЫВАЕТ связь: иначе она вечно занимает и
# чат, и проект, а владелец не может подключиться заново.
terminated=$(psql_exec db4-tgc-terminate "
  begin;
  set local role service_role;
  select remhaos_channel_api.terminate_pending_binding(
    '${binding_b}'::uuid, 'suspended', 'initiator_not_chat_admin'
  ) -> 'data' ->> 'terminated';
  commit;")
if [[ "${terminated}" != "true" ]]; then
  fail "terminating an unrecoverable pending binding did nothing: ${terminated}"
fi

after_terminate=$(psql_exec db4-tgc-after-terminate "
  select count(*)::text from remhaos_channel.project_channel_bindings
  where project_id = '${project_b}'
    and status in ('pending', 'notice_pending', 'active')")
if [[ "${after_terminate}" != "0" ]]; then
  fail "terminated binding still counts as live: ${after_terminate}"
fi

psql_exec db4-tgc-restore "
  insert into projectceo_foundation.project_member_capabilities (
    organization_id, project_id, user_id, capability
  )
  select pm.organization_id, pm.project_id, pm.user_id, 'manage_project_integrations'
  from projectceo_foundation.project_memberships pm
  where pm.project_id = '${project_b}' and pm.user_id = '${owner_b}'
  on conflict do nothing" >/dev/null

# ─────────────────────────────────────────────────────────────────────────────
# 4. Очередь: истёкшая аренда, перезахват, опоздавший воркер
# ─────────────────────────────────────────────────────────────────────────────

psql_exec db4-tgc-rebind-intent "
  begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '${owner_b}';
  select remhaos_channel_api.create_binding_intent(
    '${project_b}', pg_catalog.sha256(convert_to('db4-tgc-queue-b', 'UTF8')), 600
  );
  commit;" >/dev/null
psql_exec db4-tgc-rebind "$(activate_body db4-tgc-queue-b 777002 db4-bot -100801)" >/dev/null
queue_binding=$(psql_exec db4-tgc-queue-binding "
  select binding_id::text from remhaos_channel.project_channel_bindings
  where external_chat_id = -100801 and status = 'notice_pending'")
psql_exec db4-tgc-queue-notice "$(notice_call "${queue_binding}" true true)" >/dev/null

psql_exec db4-tgc-enqueue "
  begin;
  set local role service_role;
  select remhaos_channel_api.enqueue_notification(
    '${project_b}', 'release_distribution', 'db4-tgc-dist',
    'telegram-release/1', '{\"projectName\":\"DB4\"}'::jsonb, 'db4-tgc-key'
  );
  commit;" >/dev/null

claim=$(psql_exec db4-tgc-claim "
  begin;
  set local role service_role;
  select (remhaos_channel_api.claim_notification_batch(10, 60) -> 'data' -> 0)::text;
  commit;")
notification_id=$(print -r -- "${claim}" | rg -o '"notificationId": "[^"]+' | rg -o '[0-9a-f-]{36}')
lease_first=$(print -r -- "${claim}" | rg -o '"leaseToken": "[^"]+' | rg -o '[0-9a-f-]{36}')
if [[ -z "${notification_id}" || -z "${lease_first}" ]]; then
  fail "claim did not return a notification with a lease token: ${claim}"
fi

# `claim` глобален: он выдаёт первую готовую запись, чья бы она ни была. Если
# предыдущий сценарий оставил свою в работе, дальше мы проверяли бы чужую
# строку и упали бы с невнятной причиной. Проверка адресная.
claim_owner=$(psql_exec db4-tgc-claim-owner "
  select project_id::text from remhaos_channel.notification_outbox
  where notification_id = '${notification_id}'::uuid")
if [[ "${claim_owner}" != "${project_b}" ]]; then
  fail "claim returned a notification of another project: ${claim_owner}"
fi

psql_exec db4-tgc-expire "
  update remhaos_channel.notification_outbox
  set lease_expires_at = statement_timestamp() - interval '1 minute'
  where notification_id = '${notification_id}'::uuid" >/dev/null

# Завершение ПОСЛЕ истечения аренды, но ДО того, как её кто-либо перезахватил —
# и в успех, и в отказ. Совпадающего токена мало: аренда уже не действует, и
# запись больше не наша. `mark_notification_failed` проверяется отдельно:
# у него другой путь и свой счётчик попыток.
expired_sent=$(psql_exec db4-tgc-expired-sent "
  begin;
  set local role service_role;
  select remhaos_channel_api.mark_notification_sent(
    '${notification_id}'::uuid, '${lease_first}'::uuid, 4242
  ) -> 'data' ->> 'changed';
  commit;")
if [[ "${expired_sent}" != "false" ]]; then
  fail "an expired lease marked the record sent before any reclaim: ${expired_sent}"
fi

# Отдельной проверкой, а не рядом с `sent`: у отказа свой путь и свой счётчик
# попыток, и «оба вернули false» скрыло бы, что один из них считает по-другому.
expired_failed=$(psql_exec db4-tgc-expired-failed "
  begin;
  set local role service_role;
  select remhaos_channel_api.mark_notification_failed(
    '${notification_id}'::uuid, '${lease_first}'::uuid, 'expired_attempt', 30
  ) -> 'data' ->> 'changed';
  commit;")
if [[ "${expired_failed}" != "false" ]]; then
  fail "an expired lease marked the record failed before any reclaim: ${expired_failed}"
fi

state_after_expired=$(psql_exec db4-tgc-state-after-expired "
  select state || '|' || attempt_count::text
  from remhaos_channel.notification_outbox
  where notification_id = '${notification_id}'::uuid")
if [[ "${state_after_expired}" != "sending|1" ]]; then
  fail "expired-lease completion changed the row anyway: ${state_after_expired}"
fi

# Два воркера перезахватывают ОДНОВРЕМЕННО, за той же защёлкой.
reclaim_body="begin;
set local role service_role;
select coalesce(
  (remhaos_channel_api.claim_notification_batch(10, 60) -> 'data' -> 0) ->> 'leaseToken',
  'none'
);
commit;"

set +e
psql_exec db4-tgc-latch-3 "$(latch_controller 3 2)" >"${tmpdir}/latch-3.out" 2>&1 &
latch_pid_3=$!
set -e
await_latch_closed 3

set +e
psql_exec db4-tgc-reclaim-a "$(racer 3 "${reclaim_body}")" >"${tmpdir}/reclaim-a.out" 2>&1 &
reclaim_pid_a=$!
psql_exec db4-tgc-reclaim-b "$(racer 3 "${reclaim_body}")" >"${tmpdir}/reclaim-b.out" 2>&1 &
reclaim_pid_b=$!
wait "${latch_pid_3}" || fail "latch controller failed" "${tmpdir}/latch-3.out"
wait "${reclaim_pid_a}"; reclaim_status_a=$?
wait "${reclaim_pid_b}"; reclaim_status_b=$?
set -e

if [[ "${reclaim_status_a}" != "0" || "${reclaim_status_b}" != "0" ]]; then
  fail "concurrent reclaim raised" "${tmpdir}/reclaim-a.out" "${tmpdir}/reclaim-b.out"
fi
reclaim_none=$( (rg -cx 'none' "${tmpdir}/reclaim-a.out" "${tmpdir}/reclaim-b.out" || true) \
  | awk -F: '{ sum += $NF } END { print sum + 0 }')
if [[ "${reclaim_none}" != "1" ]]; then
  fail "concurrent reclaim handed the same work to both workers" \
    "${tmpdir}/reclaim-a.out" "${tmpdir}/reclaim-b.out"
fi
lease_second=$(cat "${tmpdir}/reclaim-a.out" "${tmpdir}/reclaim-b.out" \
  | rg -v '^none$' | rg -o '[0-9a-f-]{36}' | head -1)
if [[ -z "${lease_second}" || "${lease_second}" == "${lease_first}" ]]; then
  fail "reclaim did not rotate the fencing token: '${lease_second}'"
fi

# Первый воркер возвращается со СТАРЫМ токеном — и ничего не меняет, ни как
# успех, ни как отказ.
stale_sent=$(psql_exec db4-tgc-stale-sent "
  begin;
  set local role service_role;
  select remhaos_channel_api.mark_notification_sent(
    '${notification_id}'::uuid, '${lease_first}'::uuid, 4243
  ) -> 'data' ->> 'changed';
  commit;")
if [[ "${stale_sent}" != "false" ]]; then
  fail "a stale worker marked sent work it no longer owned: ${stale_sent}"
fi

stale_failed=$(psql_exec db4-tgc-stale-failed "
  begin;
  set local role service_role;
  select remhaos_channel_api.mark_notification_failed(
    '${notification_id}'::uuid, '${lease_first}'::uuid, 'stale_attempt', 30
  ) -> 'data' ->> 'changed';
  commit;")
if [[ "${stale_failed}" != "false" ]]; then
  fail "a stale worker marked failed work it no longer owned: ${stale_failed}"
fi

# И счётчик попыток чужой аренды не тронут: `mark_notification_failed`
# инкрементирует ретраи, и опоздавший воркер не имеет права двигать чужой.
stale_state=$(psql_exec db4-tgc-stale-state "
  select state || '|' || attempt_count::text
  from remhaos_channel.notification_outbox
  where notification_id = '${notification_id}'::uuid")
if [[ "${stale_state}" != "sending|2" ]]; then
  fail "a stale worker moved the row or its attempt counter: ${stale_state}"
fi

# Связь отзывают, пока ДЕЙСТВУЮЩАЯ аренда ещё у второго воркера.
psql_exec db4-tgc-disconnect "
  begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '${owner_b}';
  select remhaos_channel_api.disconnect_project_channel('${project_b}', 'db4-tgc');
  commit;" >/dev/null

after_revoke=$(psql_exec db4-tgc-after-revoke "
  begin;
  set local role service_role;
  select (remhaos_channel_api.mark_notification_sent(
      '${notification_id}'::uuid, '${lease_second}'::uuid, 4244
    ) -> 'data' ->> 'changed')
    || '|' || (remhaos_channel_api.mark_notification_failed(
      '${notification_id}'::uuid, '${lease_second}'::uuid, 'late', 30
    ) -> 'data' ->> 'changed');
  commit;")
if [[ "${after_revoke}" != "false|false" ]]; then
  fail "a live lease resurrected a cancelled notification: ${after_revoke}"
fi

final_state=$(psql_exec db4-tgc-final-state "
  select state from remhaos_channel.notification_outbox
  where notification_id = '${notification_id}'::uuid")
if [[ "${final_state}" != "cancelled" ]]; then
  fail "cancelled turned out not to be terminal: ${final_state}"
fi

print -r -- "DB4_TELEGRAM_CREATION_RACES_OK"
