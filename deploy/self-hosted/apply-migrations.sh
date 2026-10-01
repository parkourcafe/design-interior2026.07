#!/bin/sh
# Применяет supabase/roles.sql и миграции репозитория к базе этого сервера —
# по порядку, каждую один раз (учёт в supabase_migrations.schema_migrations,
# как у Supabase CLI). Запускать из deploy/self-hosted после `docker compose up -d`.
set -eu
cd "$(dirname "$0")"
. ./.env
REPO=../..
psql_db() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db psql -h localhost -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q "$@"; }

echo "== ожидание Auth и Storage (они создают свои схемы при первом запуске)"
i=0
until [ "$(psql_db -Atc "select (to_regclass('auth.users') is not null and to_regclass('storage.buckets') is not null)::text" 2>/dev/null)" = "true" ]; do
  i=$((i + 1)); [ "$i" -gt 120 ] && { echo "ОТКАЗ: Auth/Storage не поднялись — docker compose logs auth storage"; exit 1; }
  sleep 2
done

psql_db -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)"
psql_db < "$REPO/supabase/roles.sql"

applied=0
for f in "$REPO"/supabase/migrations/*.sql; do
  name=$(basename "$f" .sql); version=${name%%_*}
  done_already=$(psql_db -Atc "select count(*) from supabase_migrations.schema_migrations where version = '$version'")
  [ "$done_already" = "1" ] && continue
  if ! psql_db < "$f"; then
    echo "ОТКАЗ: миграция $name не применилась — дальше не иду"; exit 1
  fi
  psql_db -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '${name#*_}')"
  applied=$((applied + 1))
done
total=$(psql_db -Atc "select count(*) from supabase_migrations.schema_migrations")
echo "MIGRATIONS_OK применено сейчас: $applied, всего: $total"
