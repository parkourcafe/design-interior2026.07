#!/bin/sh
# Восстановление из ночной копии на ЧИСТУЮ базу этого сервера (или нового).
#   RESTORE_CONFIRM=yes sh restore.sh backups/db-<дата>.dump backups/roles-<дата>.sql backups/storage-<дата>.tar.gz
#
# Порядок (проверен на стенде 01.10.2026):
#   1. текущие данные НЕ удаляются, а откладываются в volumes/*.before-restore-<время>;
#   2. поднимается чистая база, Auth и Storage создают свои таблицы;
#   3. восстанавливаются роли, затем вся база из дампа;
#   4. возвращаются файлы, запускаются все сервисы, печатается сводка.
# Ошибки вида «already exists» ожидаемы: это объекты, которые образ Supabase,
# Auth и Storage создают сами. Скрипт показывает все остальные ошибки отдельно.
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
LOG=restore-$(date -u +%Y%m%d-%H%M%S).log

echo "== 1. остановка и перенос текущих данных в сторону"
docker compose down
stamp=$(date -u +%Y%m%d-%H%M%S)
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

echo "== 3. роли и база из копии (журнал: $LOG)"
admin psql -h localhost -U supabase_admin -d postgres -X -q < "$ROLES" > "$LOG" 2>&1 || true
# Три фазы: структура → данные с отключёнными триггерами и проверками ключей
# (иначе, например, auth.identities грузится раньше auth.users и отвергается) →
# индексы, ключи, триггеры. supabase_admin — суперпользователь, ему это можно.
admin pg_restore -h localhost -U supabase_admin -d postgres --section=pre-data < "$DUMP" >> "$LOG" 2>&1 || true
admin pg_restore -h localhost -U supabase_admin -d postgres --data-only --disable-triggers < "$DUMP" >> "$LOG" 2>&1 || true
admin pg_restore -h localhost -U supabase_admin -d postgres --section=post-data < "$DUMP" >> "$LOG" 2>&1 || true
# Служебные пароли — снова из .env (в копии ролей паролей нет).
admin psql -h localhost -U supabase_admin -d postgres -X -q \
  -c "alter user authenticator with password '$POSTGRES_PASSWORD'" \
  -c "alter user supabase_auth_admin with password '$POSTGRES_PASSWORD'" \
  -c "alter user supabase_storage_admin with password '$POSTGRES_PASSWORD'" >> "$LOG" 2>&1

echo "== 4. файлы и запуск"
tar -xzf "$FILES" -C volumes/storage
docker compose up -d

echo "== сводка"
# Ожидаемые: объекты, которые уже создали образ Supabase, Auth и Storage
# («already exists», повторные первичные ключи), и их журналы миграций
# (auth.schema_migrations, storage.migrations — те же строки).
EXPECTED='already exists|multiple primary keys|table "schema_migrations"|table "migrations"'
total=$(grep -c "ERROR" "$LOG" || true)
other=$(grep "ERROR" "$LOG" | grep -Evc "$EXPECTED" || true)
echo "ошибок в журнале: $total, из них неожиданных: $other"
[ "$other" = "0" ] || { echo "Посмотрите их:"; grep "ERROR" "$LOG" | grep -Ev "$EXPECTED" | head -20; }
admin psql -h localhost -U postgres -d postgres -Atc "select 'аккаунтов '||(select count(*) from auth.users)||', входов '||(select count(*) from auth.identities)||', дизайнеров '||(select count(*) from public.designers)||', проектов '||(select count(*) from public.projects)||', КП '||(select count(*) from public.proposals)||', миграций '||(select count(*) from supabase_migrations.schema_migrations)"
echo "Старые данные отложены: volumes/db/data.before-restore-$stamp, volumes/storage.before-restore-$stamp"
