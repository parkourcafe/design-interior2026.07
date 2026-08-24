#!/bin/zsh
set -euo pipefail

# AP1 — воспроизведение disposable-стенда одним проходом.
#
# Зачем этот файл существует. До него порядок из AP1_RUNBOOK.md §2 → §2a → §3
# выполнялся руками, и это стоило пилоту трёх дефектов развёртывания, каждый из
# которых был виден только на живой базе (§6): папка миграций не bootstrap-ится
# подряд, слой не встаёт без ручной подготовки ролей, авторизация падала молча.
# Скрипт делает ровно тот же порядок машинно и отказывается работать, если
# предпосылка не выполнена, — чтобы «стенд поднялся» и «стенд поднялся
# правильно» перестали быть разными утверждениями.
#
# Что он НЕ делает и не должен: не трогает production, не создаёт hosted-проект,
# не настраивает Auth redirect allowlist / SMTP / Storage-бакеты в дашборде
# (это владелец/оператор, план запуска §Фаза 1 п. 1.1) и не выдаёт членства
# ролевым пользователям — членства раздаются штатным invitation-потоком (§3).
#
# Использование:
#   AP1_DB_URL=postgres://... AP1_CONFIRM_DISPOSABLE=yes \
#     tests/ap1/environment/bootstrap-disposable.zsh bootstrap
#   AP1_DB_URL=postgres://... tests/ap1/environment/bootstrap-disposable.zsh verify
#
# Переменные:
#   AP1_DB_URL                 libpq-URL целевой базы. Обязательна. Не печатается.
#   AP1_TARGET                 hosted (по умолчанию) | local
#   AP1_CONFIRM_DISPOSABLE     обязано быть `yes` для hosted
#   AP1_EXPECTED_POSTGRES_MAJOR  по умолчанию 17 (hosted), 16 допустим локально

repo_root=${0:a:h:h:h:h}
target=${AP1_TARGET:-hosted}
expected_major=${AP1_EXPECTED_POSTGRES_MAJOR:-17}

# Ref производственного проекта. Единственная причина, по которой он записан
# здесь буквально: скрипт обязан узнать его в строке подключения и отказаться,
# даже если человек передал URL по ошибке. Читать/писать прод запрещено
# (AGENTS.md, ТЗ Фазы 2 §1).
production_ref=ztnycrchwxqczqbyegnp

die() {
  print -u2 -r -- "$1"
  exit ${2:-65}
}

if [[ -z ${AP1_DB_URL:-} ]]; then
  die "AP1_DB_URL_REQUIRED" 64
fi
if [[ ${AP1_DB_URL} == *${production_ref}* ]]; then
  die "AP1_PRODUCTION_TARGET_REJECTED"
fi
if [[ -f "${repo_root}/supabase/.temp/project-ref" ]]; then
  linked=$(<"${repo_root}/supabase/.temp/project-ref")
  if [[ ${linked} == *${production_ref}* ]]; then
    die "AP1_PRODUCTION_LINK_REJECTED"
  fi
fi
case ${target} in
  hosted)
    if [[ ${AP1_CONFIRM_DISPOSABLE:-no} != yes ]]; then
      die "AP1_CONFIRM_DISPOSABLE_REQUIRED"
    fi
    ;;
  local) ;;
  *) die "AP1_TARGET_INVALID target=${target}" 64 ;;
esac

# Ни одна функция ниже не печатает AP1_DB_URL: строка подключения несёт пароль,
# а он не должен попасть ни в лог прогона, ни в отчёт (AGENTS.md — секреты не в
# логах).
psql_run() {
  psql "${AP1_DB_URL}" -X -q --set ON_ERROR_STOP=1 "$@"
}

psql_value() {
  psql "${AP1_DB_URL}" -X -q --tuples-only --no-align --set ON_ERROR_STOP=1 --command "$1"
}

migration_files() {
  print -rl -- "${repo_root}"/supabase/migrations/*.sql(N)
}

expected_versions() {
  local file name
  for file in $(migration_files); do
    name=${file:t:r}
    print -r -- "${name%%_*}"
  done | paste -sd, -
}

assert_clean_bootstrap() {
  # §2/§2d: `20260716071024_legacy_production_baseline.sql` — ЗАМЕНА миграциям
  # 0001–0007, а не их продолжение. Поверх существующих legacy-таблиц он
  # намеренно падает P0001. Ловим это ДО первой миграции и говорим прямо, а не
  # оставляем человека разбирать `application relations already exist`.
  local existing
  existing=$(psql_value "
    select coalesce(string_agg(c.relname, ',' order by c.relname), '')
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in ('designers', 'projects', 'answers', 'risk_cards', 'proposals')
  ")
  if [[ -n ${existing} ]]; then
    die "AP1_NOT_CLEAN_BOOTSTRAP relations=${existing}"
  fi
}

apply_local_supabase_prelude() {
  # Только для target=local: на hosted эти роли и схемы управляются Supabase,
  # и повторное их создание — не эмуляция, а порча стенда.
  print -r -- "Applying local Supabase prelude"
  psql_run --file "${repo_root}/tests/db2/00_supabase_prelude.sql" >/dev/null
}

apply_local_auth_compat() {
  # Только для target=local. На локальном стеке три исторических
  # `grant usage on schema auth` (§2b) реально СРАБАТЫВАЮТ, потому что postgres
  # здесь superuser, — и стенд начинает доказывать поведение, которого на
  # hosted нет. Отзываем их, чтобы локальный прогон моделировал managed
  # Supabase, где те же гранты молча не применяются.
  print -r -- "Applying local auth compat (models hosted managed auth)"
  psql_run --file "${repo_root}/tests/ap1/environment/apply-local-auth-compat.sql" >/dev/null
}

apply_role_precondition() {
  print -r -- "Applying hosted role precondition (AP1 §2a)"
  psql_run --file "${repo_root}/tests/ap1/environment/apply-hosted-role-precondition.sql"
}

ensure_ledger_table() {
  # Журнал ведёт Supabase CLI; при psql-пути его надо завести самим, иначе
  # verify-db.sql не сможет посчитать применённые версии. На hosted таблица уже
  # есть — `if not exists` делает шаг безопасным в обоих случаях.
  psql_run --command "
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  " >/dev/null
}

apply_migrations() {
  local file version name applied=0
  for file in $(migration_files); do
    name=${file:t:r}
    version=${name%%_*}
    print -r -- "Applying ${file:t}"
    psql_run --file "${file}" >/dev/null
    # Форма журнала на hosted создана Supabase CLI и может отличаться от той,
    # что заводит `ensure_ledger_table` (колонки `name`/`statements`
    # добавлялись отдельными alter'ами в разных версиях CLI). Пишем version
    # всегда, name — только если колонка есть: иначе прогон падал бы на
    # hosted и ровно там, где проверить это заранее нельзя.
    psql_run --command "
      do \$ledger\$
      begin
        insert into supabase_migrations.schema_migrations (version)
        values ('${version}')
        on conflict (version) do nothing;
        if exists (
          select 1 from information_schema.columns
          where table_schema = 'supabase_migrations'
            and table_name = 'schema_migrations'
            and column_name = 'name'
        ) then
          execute format(
            'update supabase_migrations.schema_migrations set name = %L where version = %L and name is null',
            '${name#*_}', '${version}'
          );
        end if;
      end
      \$ledger\$;
    " >/dev/null
    (( applied += 1 ))
  done
  print -r -- "AP1_MIGRATIONS_APPLIED count=${applied}"
}

verify_ledger_file() {
  # «Ledger обновлён» — проверяемое утверждение, а не обещание: хеш каждого
  # файла миграции обязан совпасть с записанным. Любая новая миграция без
  # обновления ledger роняет стенд здесь, до прогона AP5.
  local ledger="${repo_root}/tests/ap1/environment/migration-ledger.sha256"
  if [[ ! -f ${ledger} ]]; then
    die "AP1_MIGRATION_LEDGER_FILE_MISSING"
  fi
  ( cd "${repo_root}" && sha256sum --check --quiet "${ledger}" ) \
    || die "AP1_MIGRATION_LEDGER_DIGEST_MISMATCH"
  local ledger_paths repo_paths
  ledger_paths=$(awk '{print $2}' "${ledger}" | sort)
  repo_paths=$(cd "${repo_root}" && print -rl -- supabase/migrations/*.sql(N) | sort)
  if [[ ${ledger_paths} != ${repo_paths} ]]; then
    die "AP1_MIGRATION_LEDGER_SET_MISMATCH"
  fi
  print -r -- "AP1_MIGRATION_LEDGER_FILE_OK count=$(print -r -- "${ledger_paths}" | wc -l | tr -d ' ')"
}

verify_ledger_db() {
  local expected actual
  expected=$(expected_versions)
  actual=$(psql_value "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations")
  if [[ ${actual} != ${expected} ]]; then
    die "AP1_MIGRATION_LEDGER_MISMATCH"
  fi
  print -r -- "AP1_MIGRATION_LEDGER_DB_OK count=$(print -r -- "${actual}" | tr ',' '\n' | wc -l | tr -d ' ')"
}

verify_no_auth_workaround() {
  # §2b. Исторический обход `grant authenticated to pi_table_owner` доказывал
  # причину сбоя и после PR #60 не нужен. Если он есть на стенде, зелёный AP5
  # доказывает заплатку, а не фикс, — поэтому это отказ, а не предупреждение.
  local present
  present=$(psql_value "select pg_has_role('pi_table_owner', 'authenticated', 'USAGE')")
  if [[ ${present} != f ]]; then
    die "AP1_AUTH_WORKAROUND_GRANT_PRESENT"
  fi
  print -r -- "AP1_AUTH_WORKAROUND_GRANT_ABSENT"
}

verify_database() {
  # Ожидаемый мажор передаётся в той же сессии, что и сам верификатор:
  # verify-db.sql читает `ap1.expected_postgres_major` и по умолчанию требует 17.
  {
    print -r -- "set ap1.expected_postgres_major = '${expected_major}';"
    cat "${repo_root}/tests/ap1/environment/verify-db.sql"
  } | psql "${AP1_DB_URL}" -X -q --tuples-only --no-align --set ON_ERROR_STOP=1
}

print_receipt() {
  # Строки отсюда вставляются в отчёт прогона как есть. Ни одна из них не
  # содержит ни строки подключения, ни ключей, ни писем ролевых пользователей.
  psql_value "
    select format(
      'AP1_STAND_SHAPE postgres=%s schemas=%s tables=%s routines=%s migrations=%s',
      current_setting('server_version'),
      (select count(*) from pg_catalog.pg_namespace
        where nspname like 'projectceo%' or nspname like 'project_intelligence%'),
      (select count(*) from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r'
          and (n.nspname like 'projectceo%' or n.nspname like 'project_intelligence%')),
      (select count(*) from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname like 'projectceo%_api' or n.nspname like 'project_intelligence%_api'),
      (select count(*) from supabase_migrations.schema_migrations)
    )
  "
}

case ${1:-verify} in
  bootstrap)
    print -r -- "AP1_BOOTSTRAP_START target=${target} expected_postgres_major=${expected_major}"
    verify_ledger_file
    assert_clean_bootstrap
    if [[ ${target} == local ]]; then
      apply_local_supabase_prelude
    fi
    apply_role_precondition
    ensure_ledger_table
    apply_migrations
    if [[ ${target} == local ]]; then
      apply_local_auth_compat
    fi
    verify_ledger_db
    verify_no_auth_workaround
    verify_database
    print_receipt
    print -r -- "AP1_BOOTSTRAP_OK target=${target}"
    ;;
  verify)
    verify_ledger_file
    verify_ledger_db
    verify_no_auth_workaround
    verify_database
    print_receipt
    print -r -- "AP1_VERIFY_OK target=${target}"
    ;;
  receipt)
    print_receipt
    ;;
  *)
    print -u2 -r -- "usage: $0 {bootstrap|verify|receipt}"
    exit 64
    ;;
esac
