#!/usr/bin/env bash
# Приёмка restore.sh (ТЗ 08.10, FIX-01) на настоящих контейнерах комплекта
# deploy/self-hosted, только синтетические данные, два изолированных стека:
#   A — источник: миграции репозитория, синтетические строки и файл, копия
#       теми же командами, что в backup.sh;
#   B — приёмник: восстановление полным restore.sh, сверка содержимого и
#       ограничений с A, затем инъекции отказов.
# Ни один стек не публикует сайт и шлюз (профиль off в compose.test.yml).
#
#   bash tests/self-hosted/restore-acceptance.sh <рабочий каталог> [проверяемый restore.sh]
#
# Каждый сценарий печатает строку SCENARIO <имя> PASS|FAIL <подробности>.
# Код выхода 0 — все ожидания выполнены.
set -uo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
W=${1:?укажите рабочий каталог}
RESTORE=${2:-$REPO/deploy/self-hosted/restore.sh}
mkdir -p "$W"; W=$(cd "$W" && pwd)
OUT=$W/out; mkdir -p "$OUT"
failures=0
result() { echo "SCENARIO $1 $2 ${3:-}" | tee -a "$OUT/results.txt"; [ "$2" = PASS ] || failures=$((failures + 1)); }

kit() { echo "$W/$1/deploy/self-hosted"; }
dc() { local name=$1; shift; (cd "$(kit "$name")" && COMPOSE_PROJECT_NAME="rt-$(printf %s "$name" | tr A-Z a-z)" COMPOSE_FILE=docker-compose.yml:compose.test.yml docker compose "$@"); }
psql_in() { local name=$1; shift; local pw; pw=$(sed -n "s/^POSTGRES_PASSWORD=//p" "$(kit "$name")/.env");
  dc "$name" exec -T -e PGPASSWORD="$pw" db psql -h localhost -U postgres -d postgres -X -v ON_ERROR_STOP=1 -At "$@"; }

make_kit() {
  local name=$1 d; d=$(kit "$name")
  rm -rf "$W/$name"; mkdir -p "$d"
  (cd "$REPO/deploy/self-hosted" && tar -c --exclude=./volumes/db/data --exclude=./volumes/storage --exclude=./volumes/caddy \
     --exclude=./backups --exclude=./.env --exclude='./restore-*' --exclude='./volumes/*.before-restore-*' .) | (cd "$d" && tar -x)
  ln -sfn "$REPO/supabase" "$W/$name/supabase"
  cp "$RESTORE" "$d/restore.sh"
  mkdir -p "$d/volumes/storage" "$d/backups"
  (cd "$d" && sh generate-env.sh "api.rt-$name.test" "https://www.rt-$name.test" >/dev/null)
  cat > "$d/compose.test.yml" <<'YML'
services:
  db:
    ports: !reset []
  web: { profiles: ["off"] }
  gateway: { profiles: ["off"] }
  backup: { profiles: ["off"] }
YML
}

running() { dc "$1" ps --status running --services 2>/dev/null | sort | tr '\n' ' '; }

digest() {
  psql_in "$1" <<'SQL'
create or replace function pg_temp.d(s text, t text) returns text language plpgsql as $$
declare r text; begin
  execute format('select count(*)||'':''||md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from %I.%I x', '|', '', s, t) into r;
  return r; end $$;
select s||'.'||t||' '||pg_temp.d(s, t) from (values ('auth','users'),('auth','identities'),('storage','buckets'),
  ('storage','objects'),('supabase_migrations','schema_migrations')) v(s, t)
union all
select table_schema||'.'||table_name||' '||pg_temp.d(table_schema, table_name)
from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'constraints '||count(*)||':'||md5(string_agg(conrelid::regclass::text||' '||conname||' '||contype::text||' '||convalidated::text||' '||pg_get_constraintdef(oid), E'\n' order by conrelid::regclass::text, conname))
from pg_constraint where connamespace in ('public'::regnamespace, 'storage'::regnamespace, 'auth'::regnamespace)
union all
select 'policies '||count(*)||':'||md5(string_agg(schemaname||'.'||tablename||'.'||policyname||' '||coalesce(qual,'')||' '||coalesce(with_check,''), E'\n' order by schemaname, tablename, policyname))
from pg_policies where schemaname in ('public', 'storage')
union all
select 'triggers '||count(*)||':'||md5(string_agg(tgrelid::regclass::text||'.'||tgname, E'\n' order by tgrelid::regclass::text, tgname))
from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%'
union all
select 'roles '||md5(string_agg(rolname, ',' order by rolname)) from pg_roles where rolname not like 'pg\_%'
order by 1;
SQL
}
files_digest() { (cd "$(kit "$1")/volumes/storage" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) | sha256sum | cut -d' ' -f1; }

wait_db() { local i=0; until psql_in "$1" -c "select 1" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 90 ] && return 1; sleep 2; done; }

run_restore() { # name label dump roles files → rc в $W/<label>.rc, вывод в $OUT/<label>.out
  local name=$1 label=$2; shift 2
  (cd "$(kit "$name")" && COMPOSE_PROJECT_NAME="rt-$(printf %s "$name" | tr A-Z a-z)" COMPOSE_FILE=docker-compose.yml:compose.test.yml RESTORE_CONFIRM=yes \
     sh restore.sh "$@") > "$OUT/$label.out" 2>&1
  echo $? > "$OUT/$label.rc"
}

rollback_from_output() { # выполняет команды возврата, напечатанные restore.sh
  local name=$1 label=$2
  sed -n '/^Вернуть прежнее состояние:/,$p' "$OUT/$label.out" | sed -n 's/^  //p' > "$OUT/$label.rollback.sh"
  [ -s "$OUT/$label.rollback.sh" ] || return 1
  (cd "$(kit "$name")" && COMPOSE_PROJECT_NAME="rt-$(printf %s "$name" | tr A-Z a-z)" COMPOSE_FILE=docker-compose.yml:compose.test.yml sh -e "$OUT/$label.rollback.sh") >> "$OUT/$label.out" 2>&1
}

echo "== стек A: миграции, синтетические данные, копия"
make_kit A
dc A up -d db rest auth storage > "$OUT/A-up.log" 2>&1
wait_db A || { echo "A: база не поднялась"; exit 2; }
(cd "$(kit A)" && COMPOSE_PROJECT_NAME=rt-a COMPOSE_FILE=docker-compose.yml:compose.test.yml sh apply-migrations.sh) > "$OUT/A-migrations.log" 2>&1 \
  || { echo "A: миграции не применились (см. $OUT/A-migrations.log)"; exit 2; }
psql_in A <<'SQL' > "$OUT/A-seed.log" 2>&1 || { echo "A: синтетические данные не записались"; exit 2; }
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('11111111-aaaa-4aaa-8aaa-000000000001', 'authenticated', 'authenticated', 'designer@restore.test', '', now(), now(), now());
insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
values (gen_random_uuid(), '11111111-aaaa-4aaa-8aaa-000000000001', '11111111-aaaa-4aaa-8aaa-000000000001',
        '{"sub":"11111111-aaaa-4aaa-8aaa-000000000001","email":"designer@restore.test"}', 'email', now(), now());
insert into public.designers (id, name, studio_name) values ('11111111-aaaa-4aaa-8aaa-000000000001', 'Синтетический дизайнер', 'Студия RT');
insert into public.projects (id, designer_id, client_name, intake_token)
values ('22222222-bbbb-4bbb-8bbb-000000000001', '11111111-aaaa-4aaa-8aaa-000000000001', 'Синтетический клиент', 'rt-intake-token-0001');
insert into storage.objects (bucket_id, name, metadata)
values ('client-uploads', '22222222-bbbb-4bbb-8bbb-000000000001/plan.pdf', '{"size": 64, "mimetype": "application/pdf"}');
SQL
mkdir -p "$(kit A)/volumes/storage/stub/stub/client-uploads/22222222-bbbb-4bbb-8bbb-000000000001/plan.pdf"
printf 'SYNTHETIC restore acceptance file %064d' 1 > "$(kit A)/volumes/storage/stub/stub/client-uploads/22222222-bbbb-4bbb-8bbb-000000000001/plan.pdf/v1"
digest A > "$OUT/A.digest" || { echo "A: сверка не снята"; exit 2; }
FA=$(files_digest A)
T=rt
dc A run --rm -T --no-deps --entrypoint sh backup -c \
  "pg_dumpall --roles-only --no-role-passwords -f /backups/roles-$T.sql && pg_dump -Fc -f /backups/db-$T.dump && tar -czf /backups/storage-$T.tar.gz -C /storage ." \
  > "$OUT/A-backup.log" 2>&1 || { echo "A: копия не снята (см. $OUT/A-backup.log)"; exit 2; }
mkdir -p "$W/copy"; cp "$(kit A)/backups/"*"-$T".* "$W/copy/"
dc A down >/dev/null 2>&1
rm -rf "$(kit A)/volumes/db/data"   # освобождаем место: сверка A уже снята
ls -l "$W/copy" > "$OUT/copy.ls"

echo "== стек B: восстановление полным restore.sh"
make_kit B
cp "$W/copy/"* "$(kit B)/backups/"
cd "$(kit B)"
DUMP=backups/db-$T.dump ROLES=backups/roles-$T.sql FILES=backups/storage-$T.tar.gz
run_restore B ok-1 "$DUMP" "$ROLES" "$FILES"
wait_db B >/dev/null 2>&1 || true
digest B > "$OUT/B.digest" 2>/dev/null || true
FB=$(files_digest B)
rc=$(cat "$OUT/ok-1.rc")
if [ "$rc" = 0 ] && grep -q RESTORE_OK "$OUT/ok-1.out" && cmp -s "$OUT/A.digest" "$OUT/B.digest" && [ "$FA" = "$FB" ] \
   && [ "$(running B)" = "auth db rest storage " ]; then
  result restore_ok PASS "rc=0, содержимое/ограничения/политики/роли и файлы совпали с A, сервисы: $(running B)"
else
  result restore_ok FAIL "rc=$rc running=[$(running B)] files_equal=$([ "$FA" = "$FB" ] && echo yes || echo no) diff=$(diff "$OUT/A.digest" "$OUT/B.digest" | head -5 | tr '\n' ';')"
fi

injected() { # label dump roles files: ожидается отказ, остановленные сервисы, сохранённые данные и рабочий возврат
  local label=$1; shift
  local before; before=$(ls -d volumes/db/data.before-restore-* 2>/dev/null | wc -l)
  digest B > "$OUT/$label.pre.digest"; local fpre; fpre=$(files_digest B)
  run_restore B "$label" "$@"
  local rc; rc=$(cat "$OUT/$label.rc")
  local up; up=$(running B)
  local after; after=$(ls -d volumes/db/data.before-restore-* 2>/dev/null | wc -l)
  if [ "$rc" = 0 ] || grep -q RESTORE_OK "$OUT/$label.out"; then
    result "$label" FAIL "отказ не обнаружен: rc=$rc, сервисы [$up]"
  elif ! grep -q RESTORE_FAILED "$OUT/$label.out"; then
    result "$label" FAIL "rc=$rc без RESTORE_FAILED"
  elif [ "$after" -gt "$before" ]; then
    # данные отложены: сервисы должны быть остановлены, возврат — восстановить прежнее содержимое
    case " $up " in *" rest "*|*" auth "*|*" storage "*) result "$label" FAIL "rc=$rc, но сервисы запущены [$up]"; return ;; esac
    if rollback_from_output B "$label" && wait_db B && digest B > "$OUT/$label.after-rollback.digest" \
       && cmp -s "$OUT/$label.pre.digest" "$OUT/$label.after-rollback.digest" && [ "$(files_digest B)" = "$fpre" ]; then
      rm -rf volumes/db/data.failed-restore-* volumes/storage.failed-restore-*
      result "$label" PASS "rc=$rc, сервисы остановлены, после возврата по напечатанным командам данные совпали с состоянием до попытки"
    else
      result "$label" FAIL "rc=$rc, возврат по напечатанным командам не вернул данные"
    fi
  else
    # отказ до остановки: данные и сервисы не тронуты
    if [ "$up" = "auth db rest storage " ] && digest B > "$OUT/$label.after.digest" && cmp -s "$OUT/$label.pre.digest" "$OUT/$label.after.digest"; then
      result "$label" PASS "rc=$rc, отказ до остановки сервера, данные и сервисы не тронуты"
    else
      result "$label" FAIL "rc=$rc, отказ до остановки, но состояние изменилось [$up]"
    fi
  fi
}

echo "== инъекции отказов"
size=$(stat -c %s "$DUMP")
head -c $((size * 6 / 10)) "$DUMP" > "$W/copy/db-truncated.dump"; cp "$W/copy/db-truncated.dump" backups/
injected truncated_dump backups/db-truncated.dump "$ROLES" "$FILES"
{ cat "$ROLES"; echo "select 1/0;"; } > backups/roles-broken.sql
injected roles_unexpected_error "$DUMP" backups/roles-broken.sql "$FILES"
head -c 4096 /dev/urandom | gzip -c | head -c 2000 > backups/storage-corrupt.tar.gz
injected corrupt_files_archive "$DUMP" "$ROLES" backups/storage-corrupt.tar.gz
# Отказ на последней фазе: копия, где проект ссылается на удалённого дизайнера
# (строка удалена при отключённых триггерах) — нарушение ключа при post-data.
PW=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env)
dc B exec -T -e PGPASSWORD="$PW" db psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "alter table public.designers disable trigger all" -c "delete from public.designers" -c "alter table public.designers enable trigger all" \
  > "$OUT/fk-prepare.log" 2>&1
dc B exec -T -e PGPASSWORD="$PW" db pg_dump -h localhost -U supabase_admin -d postgres -Fc > backups/db-fk-broken.dump 2>>"$OUT/fk-prepare.log"
injected post_data_fk_violation backups/db-fk-broken.dump "$ROLES" "$FILES"

echo "== итог"
cat "$OUT/results.txt"
dc B down >/dev/null 2>&1
echo "FAILURES=$failures"
[ "$failures" = 0 ]
