#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

# Гонки Telegram Chat Bridge, которых нет в `run-concurrency.zsh`.
#
# Тот файл доказывает две: одновременную финализацию двух связей одного чата и
# четыре одновременные правки одного сообщения. Здесь — остальные из списка, и
# все они об одном: между созданием связи и открытием приёма проходит время, в
# которое посторонняя сессия успевает всё изменить.
#
# Приём один и тот же: одна сессия УДЕРЖИВАЕТ транзакцию открытой (`pg_sleep`
# после вызова), вторая стартует в это время. Так пересечение не «скорее всего
# случилось», а гарантировано конструкцией. Последовательный psql-скрипт этого
# не умеет вовсе: одна сессия — один вызов за раз.
#
# Идёт ПОСЛЕ сценариев 42–44 и после `run-concurrency.zsh`; чаты и проекты свои.

: "${PI_DB4_DATABASE:?PI_DB4_DATABASE is required}"

project_b=42222222-2222-4222-8222-222222222222
owner_b=33333333-3333-4333-8333-333333333333

tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pi-db4-tg-concurrency.XXXXXX")
trap 'rm -rf "${tmpdir}"' EXIT INT TERM

# Две среды исполнения, один текст запросов. В CI база живёт в контейнере, на
# машине разработчика — в локальном кластере; выбор среды не должен менять сам
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

notice_call() {
  local binding=$1 initiator_admin=$2 bot_admin=$3
  print -r -- "begin;
set local role service_role;
select remhaos_channel_api.mark_channel_notice_posted(
  '${binding}'::uuid, 'notice-v1', ${initiator_admin}, ${bot_admin}
) -> 'data' ->> 'changed';
commit;"
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Право отобрали, пока подключение ещё не завершено
# ─────────────────────────────────────────────────────────────────────────────
#
# Отзыв происходит В ТО ВРЕМЯ, пока транзакция активации ещё открыта. Проверки
# активации к моменту финализации уже недействительны — и финализация обязана
# это заметить, а не открыть приём по вчерашнему праву.

psql_exec db4-tgc-intent "
  begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '${owner_b}';
  select remhaos_channel_api.create_binding_intent(
    '${project_b}', pg_catalog.sha256(convert_to('db4-tgc-late-b', 'UTF8')), 600
  );
  commit;" >/dev/null

activate_call="begin;
set local role service_role;
select remhaos_channel_api.activate_project_binding(
  pg_catalog.sha256(convert_to('db4-tgc-late-b', 'UTF8')),
  777002, 'db4-bot', -100800, 'supergroup', 'notice-v1', true, true
);
select pg_sleep(2);
commit;"

set +e
psql_exec db4-tgc-activate "${activate_call}" >"${tmpdir}/activate.out" 2>&1 &
activate_pid=$!
sleep 0.4
psql_exec db4-tgc-revoke "
  begin;
  delete from projectceo_foundation.project_member_capabilities
  where project_id = '${project_b}'
    and user_id = '${owner_b}'
    and capability = 'manage_project_integrations';
  commit;" >"${tmpdir}/revoke.out" 2>&1 &
revoke_pid=$!
wait "${activate_pid}"; activate_status=$?
wait "${revoke_pid}"; revoke_status=$?
set -e

if [[ "${activate_status}" != "0" || "${revoke_status}" != "0" ]]; then
  fail "overlapping activation/revocation did not both complete" \
    "${tmpdir}/activate.out" "${tmpdir}/revoke.out"
fi

binding_b=$(psql_exec db4-tgc-binding "
  select binding_id::text from remhaos_channel.project_channel_bindings
  where external_chat_id = -100800 and status = 'notice_pending'")
if [[ -z "${binding_b}" ]]; then
  fail "activation left no notice_pending binding on -100800" "${tmpdir}/activate.out"
fi

set +e
psql_exec db4-tgc-notice-revoked "$(notice_call "${binding_b}" true true)" \
  >"${tmpdir}/notice-revoked.out" 2>&1
notice_revoked_status=$?
set -e
if [[ "${notice_revoked_status}" == "0" ]]; then
  fail "capture opened after the capability was revoked mid-activation" \
    "${tmpdir}/notice-revoked.out"
fi
if ! rg -q 'forbidden' "${tmpdir}/notice-revoked.out"; then
  fail "revoked capability produced the wrong refusal" "${tmpdir}/notice-revoked.out"
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
# 2. Понизили инициатора и бота — и приём при этом никто не открыл
# ─────────────────────────────────────────────────────────────────────────────
#
# Две финализации сразу, обе со снятым администраторством (у одной — у
# человека, у другой — у бота), и параллельно с ними попытка приёма. Ноль
# сохранённых событий здесь так же важен, как два отказа: связь существует, но
# участников ещё не предупредили.

ingest_pending_call="begin;
set local role service_role;
select remhaos_channel_api.ingest_channel_update(
  'db4-bot', 9301, -100800, 901, 'message', 777002, null, null, null,
  '{\"kind\":\"message\",\"text\":\"before notice\",\"attachmentCount\":0}'::jsonb
) -> 'data' ->> 'stored';
commit;"

set +e
psql_exec db4-tgc-demoted-bot "$(notice_call "${binding_b}" true false)" \
  >"${tmpdir}/demoted-bot.out" 2>&1 &
demoted_bot_pid=$!
psql_exec db4-tgc-demoted-initiator "$(notice_call "${binding_b}" false true)" \
  >"${tmpdir}/demoted-initiator.out" 2>&1 &
demoted_initiator_pid=$!
psql_exec db4-tgc-ingest-pending "${ingest_pending_call}" \
  >"${tmpdir}/ingest-pending.out" 2>&1 &
ingest_pending_pid=$!
wait "${demoted_bot_pid}"; demoted_bot_status=$?
wait "${demoted_initiator_pid}"; demoted_initiator_status=$?
wait "${ingest_pending_pid}"; ingest_pending_status=$?
set -e

if [[ "${demoted_bot_status}" == "0" ]]; then
  fail "capture opened while the bot was not an administrator" "${tmpdir}/demoted-bot.out"
fi
if [[ "${demoted_initiator_status}" == "0" ]]; then
  fail "capture opened while the initiator was not an administrator" \
    "${tmpdir}/demoted-initiator.out"
fi
if [[ "${ingest_pending_status}" != "0" ]]; then
  fail "ingest before notice raised instead of refusing quietly" \
    "${tmpdir}/ingest-pending.out"
fi
if ! rg -qx 'false' "${tmpdir}/ingest-pending.out"; then
  fail "ingest before notice claimed to store the message" "${tmpdir}/ingest-pending.out"
fi

pending_state=$(psql_exec db4-tgc-pending-assert "
  select b.status || '|' || b.capture_state || '|' || (
    select count(*)::text from remhaos_channel.channel_events e
    where e.external_chat_id = -100800
  )
  from remhaos_channel.project_channel_bindings b
  where b.binding_id = '${binding_b}'::uuid")
if [[ "${pending_state}" != "notice_pending|none|0" ]]; then
  fail "binding or capture drifted during the demotion race: ${pending_state}"
fi

# Администраторство вернулось — связь доводится до активной.
psql_exec db4-tgc-notice-final "$(notice_call "${binding_b}" true true)" >/dev/null

# ─────────────────────────────────────────────────────────────────────────────
# 3. Очередь: истёкшая аренда, перезахват, опоздавший воркер
# ─────────────────────────────────────────────────────────────────────────────

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

# `claim` глобален: он выдаёт первую готовую запись очереди, чья бы она ни
# была. Если предыдущий сценарий оставил свою в работе, дальше мы проверяли бы
# чужую строку и упали бы с невнятной причиной. Проверка адресная.
claim_owner=$(psql_exec db4-tgc-claim-owner "
  select project_id::text from remhaos_channel.notification_outbox
  where notification_id = '${notification_id}'::uuid")
if [[ "${claim_owner}" != "${project_b}" ]]; then
  fail "claim returned a notification of another project: ${claim_owner}"
fi

# Завершение ПОСЛЕ истечения аренды, но ДО того, как её кто-либо перезахватил.
# Совпадающего токена мало: аренда уже не действует, и запись больше не наша.
psql_exec db4-tgc-expire "
  update remhaos_channel.notification_outbox
  set lease_expires_at = statement_timestamp() - interval '1 minute'
  where notification_id = '${notification_id}'::uuid" >/dev/null

expired_completion=$(psql_exec db4-tgc-complete-expired "
  begin;
  set local role service_role;
  select remhaos_channel_api.mark_notification_sent(
    '${notification_id}'::uuid, '${lease_first}'::uuid, 4242
  ) -> 'data' ->> 'changed';
  commit;")
if [[ "${expired_completion}" != "false" ]]; then
  fail "an expired lease completed the record before any reclaim: ${expired_completion}"
fi

state_after_expired=$(psql_exec db4-tgc-state-after-expired "
  select state from remhaos_channel.notification_outbox
  where notification_id = '${notification_id}'::uuid")
if [[ "${state_after_expired}" != "sending" ]]; then
  fail "expired-lease completion changed the row anyway: ${state_after_expired}"
fi

# Два воркера перезахватывают ОДНОВРЕМЕННО: работа достаётся ровно одному.
reclaim_call="begin;
set local role service_role;
select coalesce(
  (remhaos_channel_api.claim_notification_batch(10, 60) -> 'data' -> 0) ->> 'leaseToken',
  'none'
);
commit;"

set +e
psql_exec db4-tgc-reclaim-a "${reclaim_call}" >"${tmpdir}/reclaim-a.out" 2>&1 &
reclaim_pid_a=$!
psql_exec db4-tgc-reclaim-b "${reclaim_call}" >"${tmpdir}/reclaim-b.out" 2>&1 &
reclaim_pid_b=$!
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

# Первый воркер возвращается со СТАРЫМ токеном — и ничего не меняет.
stale=$(psql_exec db4-tgc-stale "
  begin;
  set local role service_role;
  select remhaos_channel_api.mark_notification_sent(
    '${notification_id}'::uuid, '${lease_first}'::uuid, 4243
  ) -> 'data' ->> 'changed';
  commit;")
if [[ "${stale}" != "false" ]]; then
  fail "a stale worker completed work it no longer owned: ${stale}"
fi

# Связь отзывают, пока ДЕЙСТВУЮЩАЯ аренда ещё у второго воркера. Отменённое
# уведомление он воскресить не может — ни как sent, ни как retry.
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

print -r -- "DB4_TELEGRAM_OVERLAPPING_SESSIONS_OK"
