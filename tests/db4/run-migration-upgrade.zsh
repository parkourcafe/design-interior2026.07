#!/bin/zsh
set -euo pipefail

# Обновление населённой базы: миграции ДО `20260811070000`, настоящая строка
# `sending` старой схемы, затем НАСТОЯЩИЙ файл `20260811070000`.
#
# Зачем отдельная база. Основной прогон DB4 применяет все миграции к ПУСТОЙ
# базе, поэтому неверный порядок «ограничение раньше нормализации» там не
# воспроизводится вовсе: строк `sending` в пустой базе нет. Ровно так дефект и
# доехал до ревью. Здесь строка заводится ДО применения файла, и проверяется он
# сам, а не его переписанная копия внутри сценария.

repo_root=${0:a:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
container="pi-db4-upgrade-${$}-${RANDOM}"
database=pi_db4_upgrade
password=pi_db4_local_only

# СОБСТВЕННЫЙ контейнер, а не отдельная база в общем.
#
# Роли PostgreSQL живут в кластере, а не в базе: `create role anon` из prelude
# в общем кластере падает «already exists», prelude обёрнут в транзакцию, и всё
# после этой строки не применяется. Чистый кластер — единственный способ
# прогнать НАСТОЯЩИЙ prelude и НАСТОЯЩИЕ миграции, ничего в них не подменяя.
cleanup() { docker rm -f "${container}" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run --detach --rm --name "${container}" --network none \
  --env POSTGRES_PASSWORD="${password}" --env POSTGRES_DB="${database}" \
  "${image}" >/dev/null

for attempt in {1..120}; do
  if docker exec -e PGPASSWORD="${password}" "${container}" \
      psql -X --tuples-only --no-align --username postgres --dbname "${database}" \
        --command 'select 1' 2>/dev/null | rg -qx '1'; then
    break
  fi
  if (( attempt == 120 )); then
    print -u2 -r -- "Upgrade fixture database did not become ready"
    exit 1
  fi
  sleep 0.25
done

psql_db() {
  docker exec -e PGPASSWORD="${password}" -i "${container}" \
    psql -X --set ON_ERROR_STOP=1 --username postgres --dbname "$1"
}

psql_query() {
  docker exec -e PGPASSWORD="${password}" "${container}" \
    psql -X --tuples-only --no-align --set ON_ERROR_STOP=1 \
      --username postgres --dbname "${database}" --command "$1"
}

psql_db "${database}" < "${repo_root}/tests/db2/00_supabase_prelude.sql" >/dev/null

# Шаг 1. Настоящие миграции, но строго ДО корректирующей.
for migration in "${repo_root}"/supabase/migrations/*.sql(N); do
  [[ "${migration:t}" > "20260811060000" ]] && [[ "${migration:t}" != 20260811060000* ]] && continue
  psql_db "${database}" < "${migration}" >/dev/null
done

applied_before=$(psql_query "
  select count(*)::text from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname='remhaos_channel_api' and p.proname='terminate_pending_binding'")
if [[ "${applied_before}" != "0" ]]; then
  print -u2 -r -- "Upgrade fixture already contains the correction migration"
  exit 1
fi

# Шаг 2. Настоящая строка `sending` в СТАРОЙ схеме — без `lease_token`,
# которого в ней ещё нет.
psql_db "${database}" >/dev/null <<'SEED'
begin;
-- Ссылочная целостность на время фикстуры отключается намеренно. Предмет
-- проверки — ФОРМА строки `sending` и порядок шагов миграции, а не цепочка
-- организация → проект → связь. Собирать её целиком значило бы тащить сюда
-- половину db3-фикстуры и проверять заодно то, что проверяется в другом месте.
set local session_replication_role = replica;

insert into auth.users (id, email, email_confirmed_at)
values ('51111111-1111-4111-8111-111111111111', 'upgrade@example.test', statement_timestamp())
on conflict do nothing;

insert into remhaos_channel.project_channel_bindings (
  organization_id, project_id, provider, bot_instance_id,
  external_chat_id, external_chat_type, status, notice_version,
  initiated_by_user_id, activated_at
)
values (
  '52222222-2222-4222-8222-222222222222',
  '53333333-3333-4333-8333-333333333333',
  'telegram', 'upgrade-bot', -100999, 'supergroup', 'active', 'notice-v1',
  '51111111-1111-4111-8111-111111111111', statement_timestamp()
);

insert into remhaos_channel.notification_outbox (
  organization_id, project_id, binding_id, source_kind, source_id,
  template_version, payload, idempotency_key, state, lease_expires_at
)
select b.organization_id, b.project_id, b.binding_id, 'release_distributed',
  'upgrade-1', 'telegram-notice/1', '{"kind":"release_distributed"}'::jsonb,
  'release_distributed:upgrade-1', 'sending', statement_timestamp() + interval '1 minute'
from remhaos_channel.project_channel_bindings b
where b.external_chat_id = -100999;
commit;
SEED

seeded=$(psql_query "
  select count(*)::text from remhaos_channel.notification_outbox where state='sending'")
if [[ "${seeded}" != "1" ]]; then
  print -u2 -r -- "Upgrade fixture did not seed a sending row: ${seeded}"
  exit 1
fi

# Шаг 3. НАСТОЯЩИЙ файл корректирующей миграции. Прежняя редакция падала здесь.
if ! psql_db "${database}" \
    < "${repo_root}/supabase/migrations/20260811070000_remhaos_channel_bridge_correction.sql" \
    >/dev/null 2>"${TMPDIR:-/tmp}/db4-upgrade-error.txt"; then
  print -u2 -r -- "DB4_UPGRADE_MIGRATION_FAILED_ON_POPULATED_DATABASE"
  sed -n '1,40p' "${TMPDIR:-/tmp}/db4-upgrade-error.txt" >&2
  exit 1
fi

# Шаг 4. Осиротевшая строка вернулась в очередь, а ограничение — валидируемое.
state=$(psql_query "
  select state || '|' || coalesce(lease_token::text, 'null')
  from remhaos_channel.notification_outbox
  where idempotency_key = 'release_distributed:upgrade-1'")
if [[ "${state}" != "retry|null" ]]; then
  print -u2 -r -- "Orphaned sending row was not normalised: ${state}"
  exit 1
fi

validated=$(psql_query "
  select con.convalidated::text
  from pg_catalog.pg_constraint con
  where con.conname = 'notification_outbox_lease_shape_check'")
if [[ "${validated}" != "true" ]]; then
  print -u2 -r -- "Lease shape constraint is not validated: ${validated}"
  exit 1
fi

# И оно действительно запрещает `sending` без аренды.
refused=$(docker exec -e PGPASSWORD="${password}" "${container}" \
  psql -X --tuples-only --no-align --username postgres --dbname "${database}" \
  --command "update remhaos_channel.notification_outbox
             set state='sending' where idempotency_key='release_distributed:upgrade-1'" 2>&1 || true)
if ! print -r -- "${refused}" | rg -q 'notification_outbox_lease_shape_check'; then
  print -u2 -r -- "Lease shape constraint does not refuse sending without a lease"
  exit 1
fi

print -r -- "DB4_MIGRATION_UPGRADE_OK"
