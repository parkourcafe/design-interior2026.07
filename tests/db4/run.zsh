#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
container="pi-db4-${$}-${RANDOM}"
database=pi_db4
password=pi_db4_local_only

cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

run_file() {
  local file=$1
  docker exec -e PGPASSWORD="${password}" -i "${container}" \
    psql -X --set ON_ERROR_STOP=1 --username postgres --dbname "${database}" \
    < "${file}"
}

print -r -- "DB4 harness image: ${image}"
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
    print -u2 -r -- "DB4 database did not become ready"
    exit 1
  fi
  sleep 0.25
done

run_file "${repo_root}/tests/db2/00_supabase_prelude.sql"
for migration in "${repo_root}"/supabase/migrations/*.sql(N); do
  print -r -- "Applying ${migration:t}"
  run_file "${migration}"
done

for sql in \
  "${repo_root}/tests/db3/20_foundation_operations.sql" \
  "${repo_root}/tests/db4/05_m3_publication_guardrail.sql" \
  "${repo_root}/tests/db4/06_m3_surface_classification.sql" \
  "${repo_root}/tests/db4/07_m4_execution_boundary.sql" \
  "${repo_root}/tests/db4/08_m4_surface_classification.sql" \
  "${repo_root}/tests/ap1/environment/enable-m3-publication.sql" \
  "${repo_root}/tests/ap1/environment/enable-m4-increment-1.sql" \
  "${repo_root}/tests/ap1/environment/enable-m4-v1-impact.sql" \
  "${repo_root}/tests/db4/10_schema_security.sql" \
  "${repo_root}/tests/db4/20_product_operations.sql" \
  "${repo_root}/tests/db4/30_m2_expansion_operations.sql" \
  "${repo_root}/tests/db4/31_m2_approved_commit_operations.sql" \
  "${repo_root}/tests/db4/32_m2_layout_version_operations.sql" \
  "${repo_root}/tests/db4/33_m2_client_review_m3_handoff_operations.sql" \
  "${repo_root}/tests/db4/34_m3_documentation_sheet_operations.sql" \
  "${repo_root}/tests/db4/35_m3_documentation_read_operations.sql" \
  "${repo_root}/tests/db4/36_m2_layout_document_v02_validation.sql" \
  "${repo_root}/tests/db4/37_source_review_door.sql" \
  "${repo_root}/tests/db4/38_m4_execution_guardrail.sql" \
  "${repo_root}/tests/db4/39_publish_version_door.sql" \
  "${repo_root}/tests/db4/40_baseline_refs_read.sql" \
  "${repo_root}/tests/db4/41_release_artifact_backlog.sql" \
  "${repo_root}/tests/db4/42_telegram_bridge_boundary.sql" \
  "${repo_root}/tests/db4/43_telegram_inbox_vertical.sql" \
  "${repo_root}/tests/db4/44_telegram_bridge_correction.sql" \
  "${repo_root}/tests/db4/47_telegram_pending_ambiguity.sql"; do
  print -r -- "Running ${sql:t}"
  run_file "${sql}"
done

# Апгрейд населённой базы живёт в `run-telegram-upgrade.zsh` — там же, где
# сценарии 45/46. Второй харнесс поднимал ради того же доказательства ещё
# один контейнер и проверял строго меньше: нормализацию связей (уведомлённая
# сохраняет приём, «молчаливая» его теряет) и живость цепочки после апгрейда
# он не смотрел вовсе.

PI_DB4_CONTAINER="${container}" \
PI_DB4_DATABASE="${database}" \
PI_DB4_PASSWORD="${password}" \
  "${repo_root}/tests/db4/run-concurrency.zsh"

# Остальные гонки моста: отзыв права во время открытой транзакции активации,
# одновременное понижение обеих сторон вместе с попыткой приёма, аренда
# очереди. Отдельным файлом, потому что каждая из них требует ДВУХ сессий
# сразу, а один psql-скрипт умеет только последовательные вызовы.
PI_DB4_CONTAINER="${container}" \
PI_DB4_DATABASE="${database}" \
PI_DB4_PASSWORD="${password}" \
  "${repo_root}/tests/db4/run-telegram-concurrency.zsh"

# Апгрейд населённой базы — в собственном кластере: prelude заводит роли
# Supabase на весь сервер, поэтому второй базы рядом с основной не хватит. Без
# этого прогона обе ветки нормализации `20260811070000` не исполняются ни разу:
# здесь база пустая, нормализовать в ней нечего, и ошибка в порядке шагов
# миграции осталась бы невидимой до первой настоящей установки.
PI_DB_IMAGE="${image}" "${repo_root}/tests/db4/run-telegram-upgrade.zsh"

# Тот же урок для V1 Impact: backfill `20260813010000` (DEC-034) и
# recovery-миграция `20260817010000` (DEC-037) на пустой базе не исполняются
# ни одной веткой нормализации. Собственный кластер по той же причине —
# prelude заводит роли на весь сервер.
PI_DB_IMAGE="${image}" "${repo_root}/tests/db4/run-impact-upgrade.zsh"

print -r -- "Restarting database for DB4 replay proof"
docker restart "${container}" >/dev/null
for attempt in {1..120}; do
  if docker exec -e PGPASSWORD="${password}" "${container}" \
      psql -X --tuples-only --no-align \
        --username postgres --dbname "${database}" \
        --command 'select 1' 2>/dev/null \
      | rg -qx '1'; then
    break
  fi
  if (( attempt == 120 )); then
    print -u2 -r -- "DB4 database did not return after restart"
    exit 1
  fi
  sleep 0.25
done
run_file "${repo_root}/tests/db4/30_restart_replay.sql"

print -r -- "DB4_PRODUCT_BRAIN_HARNESS_OK image=${image}"
