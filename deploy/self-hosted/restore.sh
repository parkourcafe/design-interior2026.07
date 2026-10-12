#!/bin/sh
# Восстановление из ночной копии на ЧИСТУЮ базу этого сервера (или нового).
#   RESTORE_CONFIRM=yes sh restore.sh backups/db-<дата>.dump backups/roles-<дата>.sql backups/storage-<дата>.tar.gz
#
# Порядок (проверен на стенде 01.10.2026; классификация ошибок — ТЗ 08.10, FIX-01):
#   0. проверка копии ДО остановки сервера: архив файлов и дамп читаются
#      целиком; при отказе текущие данные не тронуты;
#   1. текущие данные НЕ удаляются, а откладываются в volumes/*.before-restore-<время>;
#   2. поднимается чистая база, Auth и Storage создают свои таблицы;
#   3. восстанавливаются роли, затем вся база из дампа, затем служебные пароли;
#   4. возвращаются файлы;
#   5. проверка: каждая ошибка каждой фазы либо ожидаемая (список ниже), либо
#      восстановление считается неуспешным; базовые таблицы читаются;
#   6. только после успешной проверки запускаются все сервисы — RESTORE_OK.
#
# Почему раньше ошибки подавлялись (|| true): pg_restore поверх чистой базы
# Supabase всегда встречает объекты, которые образ, Auth и Storage уже создали
# («already exists»), и поэтому завершается с кодом 1. Теперь код выхода
# принимается только вместе с разбором журнала: ожидаемые ошибки перечислены
# явно, любая другая (обрыв дампа, отказ подключения, нарушение ключа) — отказ.
#
# При отказе сервисы остаются остановленными (сайт не работает на непроверенных
# данных), а скрипт печатает RESTORE_FAILED и команды возврата к отложенным данным.
set -eu
cd "$(dirname "$0")"
DUMP=${1:?укажите дамп базы backups/db-*.dump}
ROLES=${2:?укажите роли backups/roles-*.sql}
FILES=${3:?укажите архив файлов backups/storage-*.tar.gz}
[ "${RESTORE_CONFIRM:-}" = "yes" ] || { echo "ОТКАЗ: запустите с RESTORE_CONFIRM=yes — текущая база будет заменена (и отложена в сторону)"; exit 64; }
for f in "$DUMP" "$ROLES" "$FILES"; do [ -s "$f" ] || { echo "ОТКАЗ: нет файла $f"; exit 66; }; done

POSTGRES_PASSWORD=$(sed -n "s/^POSTGRES_PASSWORD=//p" .env | sed "s/^'\(.*\)'$/\1/" | head -1)
[ -n "$POSTGRES_PASSWORD" ] || { echo "ОТКАЗ: в .env нет POSTGRES_PASSWORD"; exit 1; }
admin() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db "$@"; }
stamp=$(date -u +%Y%m%d-%H%M%S)
LOGDIR=restore-$stamp
mkdir -p "$LOGDIR"

# Ожидаемые ошибки — только серверные (ERROR:) и только эти тексты: объекты,
# которые уже создали образ Supabase, Auth и Storage, и строки их журналов
# миграций (auth.schema_migrations, storage.migrations): pg_restore печатает их
# как «COPY failed for table …: ERROR: duplicate key … "<имя ключа>"», поэтому
# допускается только нарушение именно этих ключей.
EXPECTED_DB='ERROR: .*(already exists|multiple primary keys for table|duplicate key value violates unique constraint "(schema_migrations_pkey|migrations_pkey|migrations_name_key)")'
# В копии ролей: роли, которые уже создал образ Supabase.
EXPECTED_ROLES='ERROR: +role "[^"]+" already exists'

moved=0
done_ok=0
on_exit() {
  rc=$1
  [ "$done_ok" = 1 ] && return
  [ "$rc" = 0 ] && rc=1
  echo
  echo "RESTORE_FAILED (код $rc). Журналы: $(pwd)/$LOGDIR"
  if [ "$moved" = 1 ]; then
    docker compose stop >/dev/null 2>&1 || true
    echo "Сервисы остановлены: сайт не запущен на непроверенных данных."
    echo "Данные до восстановления отложены и не изменены:"
    [ -d "volumes/db/data.before-restore-$stamp" ] && echo "  volumes/db/data.before-restore-$stamp"
    [ -d "volumes/storage.before-restore-$stamp" ] && echo "  volumes/storage.before-restore-$stamp"
    # Команды переноса — только для того, что действительно отложено: иначе
    # оператор унёс бы на место «неудачной» копии нетронутые данные.
    echo "Вернуть прежнее состояние:"
    echo "  docker compose down"
    if [ -d "volumes/db/data.before-restore-$stamp" ]; then
      echo "  mv volumes/db/data volumes/db/data.failed-restore-$stamp"
      echo "  mv volumes/db/data.before-restore-$stamp volumes/db/data"
    fi
    if [ -d "volumes/storage.before-restore-$stamp" ]; then
      echo "  mv volumes/storage volumes/storage.failed-restore-$stamp"
      echo "  mv volumes/storage.before-restore-$stamp volumes/storage"
    fi
    echo "  docker compose up -d"
  else
    echo "Текущие данные и сервисы не тронуты."
  fi
  exit "$rc"
}
trap 'on_exit $?' EXIT

# Строки отказов в журнале фазы: ошибки сервера и клиента, FATAL, обрывы.
problems() { grep -E 'ERROR:|FATAL:|PANIC:|pg_restore: error:|psql:.*error|could not|unexpected end|did not find magic' "$1" || true; }
# Неожиданные: всё, что не объяснено списком ожидаемых.
unexpected() { problems "$1" | grep -Ev "$2" || true; }

echo "== 0. проверка копии до остановки сервера"
gzip -t "$FILES" 2>"$LOGDIR/0-files.log" || { echo "ОТКАЗ: архив файлов повреждён ($FILES)"; exit 65; }
tar -tzf "$FILES" >/dev/null 2>>"$LOGDIR/0-files.log" || { echo "ОТКАЗ: архив файлов не читается ($FILES)"; exit 65; }
[ "$(head -c 5 "$DUMP")" = "PGDMP" ] || { echo "ОТКАЗ: $DUMP — не дамп pg_dump -Fc"; exit 65; }
docker compose run --rm --no-deps -T --entrypoint pg_restore db --list < "$DUMP" > "$LOGDIR/0-dump-toc.log" 2>&1 \
  || { echo "ОТКАЗ: оглавление дампа не читается ($DUMP), см. $LOGDIR/0-dump-toc.log"; exit 65; }
# Оглавление — в начале архива; обрыв в конце виден только при чтении целиком.
docker compose run --rm --no-deps -T --entrypoint pg_restore db -f /dev/null < "$DUMP" > "$LOGDIR/0-dump-read.log" 2>&1 \
  || { echo "ОТКАЗ: дамп не читается целиком ($DUMP), см. $LOGDIR/0-dump-read.log"; exit 65; }
grep -q "CREATE ROLE" "$ROLES" || { echo "ОТКАЗ: $ROLES — не копия ролей pg_dumpall --roles-only"; exit 65; }

echo "== 1. остановка и перенос текущих данных в сторону"
docker compose down
moved=1
[ -d volumes/db/data ] && mv volumes/db/data "volumes/db/data.before-restore-$stamp"
[ -d volumes/storage ] && mv volumes/storage "volumes/storage.before-restore-$stamp"
mkdir -p volumes/storage

echo "== 2. чистая база, Auth и Storage создают свои таблицы"
docker compose up -d db rest auth storage
i=0
until [ "$(admin psql -h localhost -U postgres -d postgres -Atc "select (to_regclass('auth.users') is not null and to_regclass('storage.buckets') is not null)::text" 2>/dev/null)" = "true" ]; do
  i=$((i + 1)); [ "$i" -gt 120 ] && { echo "ОТКАЗ: Auth/Storage не поднялись"; exit 1; }
  sleep 2
done
docker compose stop auth storage rest

echo "== 3. роли и база из копии (журналы: $LOGDIR)"
# psql без ON_ERROR_STOP: «role already exists» ожидаемы; код ≠ 0 — отказ подключения/чтения.
rc=0; admin psql -h localhost -U supabase_admin -d postgres -X -q < "$ROLES" > "$LOGDIR/1-roles.log" 2>&1 || rc=$?
[ "$rc" = 0 ] || { echo "ОТКАЗ: роли не загрузились (код $rc), см. $LOGDIR/1-roles.log"; exit 1; }
# Три фазы: структура → данные с отключёнными триггерами и проверками ключей
# (иначе, например, auth.identities грузится раньше auth.users и отвергается) →
# индексы, ключи, триггеры. supabase_admin — суперпользователь, ему это можно.
# pg_restore: 0 — без ошибок; 1 — были ошибки (разбираются ниже); иное — отказ.
restore_phase() {
  log="$LOGDIR/$1.log"; shift
  rc=0; admin pg_restore -h localhost -U supabase_admin -d postgres "$@" < "$DUMP" > "$log" 2>&1 || rc=$?
  case $rc in
    0) ;;
    1) [ -n "$(problems "$log")" ] || { echo "ОТКАЗ: pg_restore завершился с кодом 1 без ошибок в журнале ($log)"; exit 1; } ;;
    *) echo "ОТКАЗ: pg_restore завершился с кодом $rc ($log)"; exit 1 ;;
  esac
}
restore_phase 2-pre-data --section=pre-data
restore_phase 3-data --data-only --disable-triggers
restore_phase 4-post-data --section=post-data
# Служебные пароли — снова из .env (в копии ролей паролей нет).
admin psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "alter user authenticator with password '$POSTGRES_PASSWORD'" \
  -c "alter user supabase_auth_admin with password '$POSTGRES_PASSWORD'" \
  -c "alter user supabase_storage_admin with password '$POSTGRES_PASSWORD'" > "$LOGDIR/5-passwords.log" 2>&1 \
  || { echo "ОТКАЗ: служебные пароли не установлены, см. $LOGDIR/5-passwords.log"; exit 1; }

echo "== 4. файлы"
tar -xzf "$FILES" -C volumes/storage 2>"$LOGDIR/6-files.log" || { echo "ОТКАЗ: файлы не распакованы, см. $LOGDIR/6-files.log"; exit 1; }

echo "== 5. проверка восстановления"
bad=0
for phase in 1-roles 2-pre-data 3-data 4-post-data; do
  case $phase in 1-roles) expected=$EXPECTED_ROLES ;; *) expected=$EXPECTED_DB ;; esac
  all=$(problems "$LOGDIR/$phase.log" | wc -l | tr -d ' ')
  odd=$(unexpected "$LOGDIR/$phase.log" "$expected")
  n=$(printf '%s' "$odd" | grep -c . || true)
  echo "  $phase: ошибок $all, из них неожиданных $n"
  if [ "$n" != 0 ]; then bad=1; printf '%s\n' "$odd" | head -10 | sed 's/^/    /'; fi
done
[ "$bad" = 0 ] || { echo "ОТКАЗ: в журнале восстановления есть неожиданные ошибки"; exit 1; }
summary=$(admin psql -h localhost -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc "select 'аккаунтов '||(select count(*) from auth.users)||', входов '||(select count(*) from auth.identities)||', дизайнеров '||(select count(*) from public.designers)||', проектов '||(select count(*) from public.projects)||', КП '||(select count(*) from public.proposals)||', миграций '||(select count(*) from supabase_migrations.schema_migrations)" 2>"$LOGDIR/7-check.log") \
  || { echo "ОТКАЗ: базовые таблицы не читаются после восстановления, см. $LOGDIR/7-check.log"; exit 1; }
case $summary in *"миграций 0") echo "ОТКАЗ: журнал миграций пуст — копия неполная"; exit 1 ;; esac

echo "== 6. запуск"
docker compose up -d
done_ok=1
echo "$summary"
echo "Старые данные отложены: volumes/db/data.before-restore-$stamp, volumes/storage.before-restore-$stamp"
echo "RESTORE_OK"
