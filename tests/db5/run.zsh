#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
image=${PI_DB_IMAGE:-postgres:16-alpine}
container="pi-db5-${$}-${RANDOM}"
database=pi_db5
password=pi_db5_local_only

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

print -r -- "DB5 harness image: ${image}"
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
    print -u2 -r -- "DB5 database did not become ready"
    exit 1
  fi
  sleep 0.25
done

run_file "${repo_root}/tests/db2/00_supabase_prelude.sql"
for migration in "${repo_root}"/supabase/migrations/*.sql(N); do
  print -r -- "Applying ${migration:t}"
  run_file "${migration}"
done
# DEC-040 (4): засев опубликованных передач M2→M3 для позитивных цепочек M3.
run_file "${repo_root}/tests/fixtures/sql/m3_handoff_fixture.sql"

# Порядок здесь — предмет проверки, а не оформление.
#
# Прежняя редакция шла от миграций сразу в позитивную цепочку под
# `authenticated` и падала на первом же вызове, закрытом guardrail'ом M3. Чинить
# это возвратом прав `authenticated` нельзя: инкремент 2 обязан остаться
# закрытым для PostgREST-ролей в любой среде. Поэтому:
#
#   05 — доказать, что закрыто ВСЁ, включая инкремент 1 и публикацию M3;
#   enable-* — открыть ровно то, что скрипты одноразовой среды открывают в
#              DB4 и AP1, и ни строкой больше (инкремент 2 они не трогают);
#   06 — завести отдельную `nologin`-роль для человеческих RPC инкремента 2;
#   10/20 — контракт схемы и позитивная цепочка;
#   26 — benchmark политики обхода: он выбирает `maxDepth` и проверяет, что
#        усечение, лимит и время не остались декларацией; частичный прогон не
#        превращается в complete ничем — двери подтверждения неполноты нет
#        (DEC-034);
#   27 — заявка для гонки расчёта: фиксируется (не откатывается), потому что
#        конкурентные сессии видят только зафиксированные данные;
#   29 — DEC-034: точная граница 5000/5001, приоритет лимита над глубиной на
#        совмещённом срезе, исчезновение из очереди воркера — на управляемых
#        фикстурах, откатывается целиком;
#   31 — DEC-036: bounded retry, dead-letter, операторский редрайв, исчезновение
#        ядовитого элемента из активной очереди — на собственной управляемой
#        заявке, откатывается целиком;
#   32 — DEC-037: recovery заблокированного прогона — blocked текущей политики
#        терминален (очередь пуста, повтор отклоняется), blocked устаревшей
#        возвращается в очередь и вытесняется новым прогоном (активный ровно
#        один), карточки blocked/вытесненного прогона не рассматриваются;
#        откатывается целиком, включая подмену политики;
#   90 — доказать, что после всего этого закрытое так и осталось закрытым.
for sql in \
  "${repo_root}/tests/db5/05_default_deny_before.sql" \
  "${repo_root}/tests/ap1/environment/enable-m3-publication.sql" \
  "${repo_root}/tests/ap1/environment/enable-m4-increment-1.sql" \
  "${repo_root}/tests/ap1/environment/enable-m4-v1-impact.sql" \
  "${repo_root}/tests/db5/06_execution_test_role.sql" \
  "${repo_root}/tests/db3/20_foundation_operations.sql" \
  "${repo_root}/tests/db4/20_product_operations.sql" \
  "${repo_root}/tests/db4/53_m1_passport_versions_contract.sql" \
  "${repo_root}/tests/db4/56_m1_rls_security.sql" \
  "${repo_root}/tests/db4/59_m1_legacy_read_rpc.sql" \
  "${repo_root}/tests/db4/61_market_routing_receipts.sql" \
  "${repo_root}/tests/db5/10_schema_security.sql" \
  "${repo_root}/tests/db5/20_execution_operations.sql" \
  "${repo_root}/tests/db5/26_impact_policy_benchmark.sql" \
  "${repo_root}/tests/db5/27_impact_concurrency_fixture.sql" \
  "${repo_root}/tests/db5/28_v1_production_switch.sql" \
  "${repo_root}/tests/db5/29_impact_coverage_dec034.sql" \
  "${repo_root}/tests/db5/31_impact_worker_reliability.sql" \
  "${repo_root}/tests/db5/32_impact_recovery_dec037.sql"; do
  print -r -- "Running ${sql:t}"
  run_file "${sql}"
done

PI_DB5_CONTAINER="${container}" \
PI_DB5_DATABASE="${database}" \
PI_DB5_PASSWORD="${password}" \
  zsh "${repo_root}/tests/db5/run-concurrency.zsh"

print -r -- "Restarting database for DB5 replay proof"
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
    print -u2 -r -- "DB5 database did not return after restart"
    exit 1
  fi
  sleep 0.25
done
run_file "${repo_root}/tests/db5/30_restart_replay.sql"

# После перезапуска базы и всех сценариев — повторное доказательство запрета.
# Если бы что-то по дороге выдало права молча, здесь это упадёт.
run_file "${repo_root}/tests/db5/90_default_deny_after.sql"

print -r -- "DB5_EXECUTION_HARNESS_OK image=${image}"
