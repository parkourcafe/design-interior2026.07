#!/bin/zsh
set -euo pipefail

# Миграционный апгрейд населённой `impact_runs` (DEC-034/DEC-037).
#
# Основной прогон DB4/DB5 применяет всю цепочку миграций к ПУСТОЙ базе, и
# backfill `20260813010000` в ней не исполняется ни разу: нормализовать
# нечего. Ровно там жил дефект: `set not null` без backfill падал бы на любой
# базе, применившей `20260812*` раньше и посчитавшей прогоны под семантикой
# PR #94 (truncate-and-keep). Чистый прогон об этом молчал — как молчал он и
# про telegram-мост (`run-telegram-upgrade.zsh`, тот же урок).
#
# Порядок: схема до `20260813010000` → живые строки трёх legacy-форм →
# `20260813010000` и весь хвост ledger → проверка форм контракта DEC-034 и
# применимости recovery-миграции DEC-037 поверх населённой базы.

repo_root=${0:a:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
database=${PI_DB4_IMPACT_UPGRADE_DATABASE:-pi_db4_impact_upgrade}
password=pi_db4_local_only
container=""

# Граница: всё, что строго раньше, — «прошлое»; сама миграция и всё после —
# «апгрейд».
correction=20260813010000

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

if [[ -n "${PI_DB4_IMPACT_UPGRADE_LOCAL:-}" ]]; then
  # Локальный кластер переиспользуется между прогонами: база и роли Supabase
  # пересоздаются, потому что prelude заводит роли на весь кластер и повторно
  # не выполняется. В CI кластер одноразовый, и этой ветки нет.
  psql -X --set ON_ERROR_STOP=1 --dbname postgres \
    --command "drop database if exists ${database}" >/dev/null
  for role in pi_worker_executor pi_human_executor pi_table_owner \
    supabase_auth_admin service_role authenticated anon; do
    psql -X --dbname postgres --command "drop role if exists ${role}" >/dev/null 2>&1 || true
  done
  psql -X --set ON_ERROR_STOP=1 --dbname postgres \
    --command "create database ${database}" >/dev/null
else
  container="pi-db4-impact-upgrade-${$}-${RANDOM}"
  print -r -- "DB4 impact upgrade harness image: ${image}"
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
      print -u2 -r -- "DB4 impact upgrade database did not become ready"
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
    run_file "${repo_root}/tests/db4/47_impact_upgrade_seed.sql"
    applied_correction=1
  fi
  run_file "${migration}" >/dev/null
done

if (( applied_correction != 1 )); then
  print -u2 -r -- "DB4 impact upgrade harness never saw migration ${correction}"
  exit 1
fi

run_file "${repo_root}/tests/db4/48_impact_upgrade_assert.sql"

print -r -- "DB4_IMPACT_UPGRADE_HARNESS_OK image=${image}"
