#!/bin/zsh
set -euo pipefail

# Миграционный апгрейд населённой базы.
#
# Основной прогон DB4 применяет всю цепочку миграций к ПУСТОЙ базе, и в ней обе
# ветки нормализации `20260811070000` не исполняются ни разу: нормализовать
# нечего. Ровно там и жил дефект — constraint формы аренды добавлялся раньше,
# чем старые `sending` возвращались в очередь, и на любой базе с живой строкой
# миграция упала бы на собственной проверке. Чистый прогон об этом молчал.
#
# Поэтому здесь отдельный кластер и другой порядок: схема до `060000` → живые
# строки → `070000` → проверка. Отдельный, потому что роли Supabase создаются
# на весь кластер, и второй prelude в том же сервере не выполнится.

repo_root=${0:a:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
database=${PI_DB4_UPGRADE_DATABASE:-pi_db4_upgrade}
password=pi_db4_local_only
container=""

# Граница, до которой применяется цепочка. Всё, что строго меньше, — «прошлое»,
# сама миграция и всё, что после, — «апгрейд».
correction=20260811070000

cleanup() {
  [[ -n "${container}" ]] && docker rm -f "${container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

run_file() {
  local file=$1
  if [[ -n "${container}" ]]; then
    docker exec -e PGPASSWORD="${password}" -i "${container}" \
      psql -X --set ON_ERROR_STOP=1 --username postgres --dbname "${database}" \
      < "${file}"
  else
    psql -X --set ON_ERROR_STOP=1 --dbname "${database}" -f "${file}"
  fi
}

if [[ -n "${PI_DB4_UPGRADE_LOCAL:-}" ]]; then
  # Локальный кластер переиспользуется между прогонами, поэтому и база, и роли
  # Supabase пересоздаются: prelude заводит роли на весь кластер и повторно не
  # выполняется. В CI кластер одноразовый, и этой ветки нет.
  psql -X --set ON_ERROR_STOP=1 --dbname postgres \
    --command "drop database if exists ${database}" >/dev/null
  for role in pi_worker_executor pi_human_executor pi_table_owner \
    supabase_auth_admin service_role authenticated anon; do
    psql -X --dbname postgres --command "drop role if exists ${role}" >/dev/null 2>&1 || true
  done
  psql -X --set ON_ERROR_STOP=1 --dbname postgres \
    --command "create database ${database}" >/dev/null
else
  container="pi-db4-upgrade-${$}-${RANDOM}"
  print -r -- "DB4 upgrade harness image: ${image}"
  docker run --detach --rm \
    --name "${container}" \
    --network none \
    --env POSTGRES_PASSWORD="${password}" \
    --env POSTGRES_DB="${database}" \
    "${image}" >/dev/null

  for attempt in {1..120}; do
    if docker logs "${container}" 2>&1 \
        | rg -q 'PostgreSQL init process complete; ready for start up\.' \
      && docker exec -e PGPASSWORD="${password}" "${container}" \
        psql -X --tuples-only --no-align \
          --username postgres --dbname "${database}" \
          --command 'select 1' 2>/dev/null \
        | rg -qx '1'; then
      break
    fi
    if (( attempt == 120 )); then
      print -u2 -r -- "DB4 upgrade database did not become ready"
      exit 1
    fi
    sleep 0.25
  done
fi

run_file "${repo_root}/tests/db2/00_supabase_prelude.sql" >/dev/null

applied_correction=0
for migration in "${repo_root}"/supabase/migrations/*.sql(N); do
  stamp=${${migration:t}%%_*}
  if [[ "${stamp}" == "${correction}" ]]; then
    # Живые строки заводятся ровно между «до» и «сама миграция».
    print -r -- "Seeding populated state before ${migration:t}"
    run_file "${repo_root}/tests/db4/45_telegram_bridge_upgrade_seed.sql"
    applied_correction=1
  fi
  run_file "${migration}" >/dev/null
done

if (( applied_correction != 1 )); then
  print -u2 -r -- "DB4 upgrade harness never saw migration ${correction}"
  exit 1
fi

run_file "${repo_root}/tests/db4/46_telegram_bridge_upgrade_assert.sql"

print -r -- "DB4_TELEGRAM_UPGRADE_HARNESS_OK image=${image}"
