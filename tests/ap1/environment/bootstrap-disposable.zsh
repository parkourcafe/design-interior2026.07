#!/bin/zsh
# AP1 bootstrap-манифест одноразового стенда.
#
# Одна команда поднимает disposable-окружение с нуля до готовности к пилоту —
# и на локальном стеке Supabase CLI, и на hosted-проекте managed Supabase.
#
#   zsh tests/ap1/environment/bootstrap-disposable.zsh --target local
#   zsh tests/ap1/environment/bootstrap-disposable.zsh --target hosted
#
# Зачем файл существует. До него рецепт стенда жил в трёх местах сразу:
# AP1_RUNBOOK.md §2/§2a (текстом, руками), `.github/workflows/ci.yml` (джоба
# `ap5`, только локальный стек) и `run-local.zsh` (только локальный стек, только
# macOS/colima). Hosted-путь не был исполняемым нигде — его каждый раз собирали
# из runbook заново, и три дефекта развёртывания (порядок bootstrap, роли `pi_*`,
# молчаливый auth-блокер) нашлись именно потому, что «собрать заново» и
# «собрать так же» — разные операции. Воспроизводимость стенда — часть
# доказательства пилота, а не удобство.
#
# Что скрипт НЕ делает и делать не должен:
#   * не включает модули (`enable-m3-publication.sql`, `enable-m4-increment-1.sql`,
#     `enable-m4-v1-impact.sql`) — это отдельные осознанные действия среды по
#     DEC-029, у них своя граница и свой аудит;
#   * не выдаёт членства и роли в проекте — human operations через service role
#     запрещены инвариантом AGENTS.md, доступ раздаётся invitation-потоком;
#   * не трогает production ни при каких аргументах (см. `preflight`).

set -euo pipefail

repo_root=${0:a:h:h:h:h}

# Production ref из AP1_RUNBOOK §0. Он на другой архитектурной линии, и любое
# его появление в параметрах — не «осторожно», а немедленный отказ.
readonly PRODUCTION_PROJECT_REF=ztnycrchwxqczqbyegnp
readonly SUPABASE_CLI_VERSION=2.109.1
readonly LEDGER_PATH="${repo_root}/tests/ap1/environment/migration-ledger.sha256"

target=
db_only=0
skip_identities=0
typeset -a original_arguments
original_arguments=("$@")

usage() {
  cat <<'USAGE'
usage: bootstrap-disposable.zsh --target local|hosted [--db-only] [--skip-identities]

  --target local     локальный стек Supabase CLI из supabase/config.toml
  --target hosted    managed-проект; строка подключения и ключи из env
  --db-only          только шаги базы (роли, миграции, постусловия verify-db).
                     Поверхность Auth/PostgREST/Storage не проверяется, итог
                     печатается как ЧАСТИЧНЫЙ. Для стенда пилота недостаточно.
  --skip-identities  не создавать пять ролевых личностей. Печатается в итоге
                     как явный пропуск.

Переменные окружения (target=hosted):
  AP1_DB_URL                      строка подключения к базе стенда
  NEXT_PUBLIC_SUPABASE_URL        URL проекта
  NEXT_PUBLIC_SUPABASE_ANON_KEY   публикуемый ключ (нужен верификатору поверхности)
  SUPABASE_SERVICE_ROLE_KEY       сервисный ключ (нужен provision:ap1)
  AP1_TEST_PASSWORD               пароль ролевых личностей, ≥12 символов
  AP1_EMAIL_DOMAIN                домен адресов, по умолчанию remhaos.test

Переменные окружения (target=local): координаты стека берутся из
supabase/config.toml и `supabase status`; нужен только AP1_TEST_PASSWORD
(≥12 символов) для пяти ролевых личностей — или --skip-identities.
USAGE
}

# --- вывод -------------------------------------------------------------------

step_no=0

step() {
  step_no=$(( step_no + 1 ))
  print -r -- ""
  print -r -- "── ${step_no}. $1"
}

note() {
  print -r -- "   $1"
}

fail() {
  print -u2 -r -- ""
  print -u2 -r -- "$1"
  exit ${2:-70}
}

# Ключи, пароли и токены не попадают ни в лог прогона, ни в отчёт (ТЗ §6).
# Фильтр стоит на выводе КАЖДОЙ внешней команды, а не на отдельных местах, где
# про секрет вспомнили: `supabase start` печатает полный набор ключей стека, и
# однажды забытый фильтр — это ключ в артефактах CI навсегда.
#
# Первая версия фильтра гасила ЛЮБУЮ строку, где встречалось слово key/secret/
# token/password/jwt/dsn/conn где угодно — а psql_run_quiet существует именно
# для того, чтобы печатать реальный текст ошибки при падении. Настоящие
# диагностики Postgres называют "key" сплошь и рядом безо всякого секрета:
# `duplicate key value violates unique constraint`, `violates foreign key
# constraint`, `... primary key, ...` в эхе DDL. Старый фильтр стирал их все,
# оставляя бесполезное "[credential line redacted]" ровно там, где сообщение
# об отказе и было нужно.
#
# Форма, в которой секреты реально приходят от `supabase status`/`start`, —
# «label: value» или «LABEL=value» (```anon key: eyJ...```, ```ANON_KEY="eyJ..."```).
# Отличие от диагностик Postgres — двоеточие/равно идёт СРАЗУ после слова, без
# промежуточного текста: "key value violates" не совпадает, "key: eyJ..."
# совпадает. Значения JWT и ключей Supabase дополнительно вырезаются точечно,
# независимо от подписи рядом — они могут оказаться в строке и без метки.
redact() {
  perl -pe '
    s{postgres(?:ql)?://[^:@/\s]+:[^@\s]+@}{postgresql://[redacted]@}g;
    s{eyJ[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}}{[jwt-redacted]}g;
    s{sb(?:p|_secret|_publishable)_[A-Za-z0-9]{10,}}{[supabase-key-redacted]}g;
    if (/(?:key|secret|token|password|jwt|dsn)\s*[:=]\s*\S/i) {
      $_ = "[credential line redacted]
";
    }
  '
}

# --- psql --------------------------------------------------------------------

# Строка подключения не уходит ни в stdout, ни в сообщения об ошибках psql:
# у hosted-стенда в ней пароль базы.
psql_run() {
  local file=$1
  if [[ ${target} == local ]]; then
    PGPASSWORD="${AP1_LOCAL_DB_PASSWORD}" psql \
      --host="${AP1_LOCAL_DB_HOST}" --port="${AP1_LOCAL_DB_PORT}" \
      --username="${AP1_LOCAL_DB_USER}" --dbname="${AP1_LOCAL_DB_NAME}" \
      -X --set ON_ERROR_STOP=1 --file "${file}" 2>&1 | redact
  else
    psql "${AP1_DB_URL}" -X --set ON_ERROR_STOP=1 --file "${file}" 2>&1 | redact
  fi
  return ${pipestatus[1]}
}

# Тихо на успехе, но на падении печатает ВЕСЬ вывод psql. Молчаливый
# `>/dev/null` здесь стоил бы ровно того же, что стоил молчаливый WARNING в
# §2b: падение видно, причина — нет. Guard baseline'а («application relations
# already exist») читается только из этого вывода.
psql_run_quiet() {
  local file=$1
  local output rc
  output=$(psql_run "${file}" 2>&1) && rc=0 || rc=$?
  if (( rc != 0 )); then
    print -u2 -r -- "${output}"
  fi
  return ${rc}
}

psql_value() {
  local statement=$1
  local value
  if [[ ${target} == local ]]; then
    value=$(PGPASSWORD="${AP1_LOCAL_DB_PASSWORD}" psql \
      --host="${AP1_LOCAL_DB_HOST}" --port="${AP1_LOCAL_DB_PORT}" \
      --username="${AP1_LOCAL_DB_USER}" --dbname="${AP1_LOCAL_DB_NAME}" \
      -X --set ON_ERROR_STOP=1 --tuples-only --no-align --command "${statement}")
  else
    value=$(psql "${AP1_DB_URL}" \
      -X --set ON_ERROR_STOP=1 --tuples-only --no-align --command "${statement}")
  fi
  print -r -- "${value}"
}

supabase_cli() {
  npm exec --yes --package="supabase@${SUPABASE_CLI_VERSION}" -- supabase "$@"
}

# --- 0. аргументы -------------------------------------------------------------

# Разбор аргументов сознательно НЕ живёт на верхнем уровне файла (как было
# раньше). Верхний уровень исполняется до объявления любой функции — `redact`,
# `fail`, `usage` в тот момент ещё не определены, и ветка «неизвестный
# аргумент» печатала значение сырым текстом. Если по ошибке позиционным
# аргументом прилетит не флаг, а строка подключения (спутали `AP1_DB_URL=...`
# с позиционным параметром) — пароль базы уходит в лог CI нередактированным.
# Разбор теперь читает `original_arguments` — снимок настоящих `$@`,
# сделанный на верхнем уровне до объявления функций, — и запускается из
# `main()`, когда весь словарь функций уже на месте.
parse_arguments() {
  local -a args
  args=("${original_arguments[@]}")
  local i=1
  while (( i <= ${#args} )); do
    case ${args[i]} in
      --target)
        (( i + 1 <= ${#args} )) || fail "AP1_BOOTSTRAP_MISSING_TARGET_VALUE" 64
        target=${args[i + 1]}
        (( i += 2 ))
        ;;
      --target=*)
        target=${args[i]#--target=}
        (( i += 1 ))
        ;;
      --db-only)
        db_only=1
        (( i += 1 ))
        ;;
      --skip-identities)
        skip_identities=1
        (( i += 1 ))
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        print -u2 -r -- "AP1_BOOTSTRAP_UNKNOWN_ARGUMENT $(print -r -- "${args[i]}" | redact)"
        usage >&2
        exit 64
        ;;
    esac
  done
}

# --- 1. предусловия ----------------------------------------------------------

# Прод не участвует ни одним запросом. Проверяются ВСЕ переменные окружения и
# все аргументы, а не только те, что скрипт читает: ref может приехать в PGHOST,
# в SUPABASE_DB_URL из чужого шага CI или в переменной, про которую здесь никто
# не знает. Дешевле отказаться, чем объяснять запрос к продовой базе.
reject_production() {
  # Сравнение без учёта регистра: DNS регистронезависим (RFC 4343), то есть
  # DB.ZTNYCRCHWXQCZQBYEGNP.SUPABASE.CO резолвится в тот же прод, а libpq имя
  # не нормализует. Guard, который ловит только нижний регистр, отвечал бы
  # утвердительным «не найден» на строку, ведущую ровно туда же.
  local -a offending
  offending=("${(@f)$(env | grep -iF "${PRODUCTION_PROJECT_REF}" | cut -d= -f1 || true)}")
  offending=(${offending:#})
  if (( ${#offending} > 0 )); then
    fail "AP1_PRODUCTION_REF_REJECTED variables=${(j:,:)offending}" 65
  fi
  local argument
  for argument in ${original_arguments}; do
    [[ ${(L)argument} == *${PRODUCTION_PROJECT_REF}* ]] \
      && fail "AP1_PRODUCTION_REF_REJECTED argument" 65
  done
  note "production ref ${PRODUCTION_PROJECT_REF} не найден ни в окружении, ни в аргументах"
}

preflight() {
  step "Предусловия"

  # Отказ от прода стоит ПЕРВЫМ — раньше разбора аргументов по существу. Иначе
  # `--target=<prod-ref>` получил бы ответ «неизвестный target», то есть ответ
  # про синтаксис там, где вопрос был про безопасность.
  reject_production

  case ${target} in
    local|hosted) ;;
    "") fail "AP1_BOOTSTRAP_TARGET_REQUIRED (--target local|hosted)" 64 ;;
    *)  fail "AP1_BOOTSTRAP_TARGET_INVALID ${target}" 64 ;;
  esac

  local tool
  for tool in psql node npm; do
    whence -p "${tool}" >/dev/null \
      || fail "AP1_BOOTSTRAP_TOOL_MISSING ${tool}" 69
  done

  if [[ ${target} == local ]]; then
    whence -p docker >/dev/null || fail "AP1_BOOTSTRAP_TOOL_MISSING docker" 69
    docker info >/dev/null 2>&1 || fail "AP1_BOOTSTRAP_DOCKER_UNAVAILABLE" 69
    # Линковка превращает локальный стенд в пульт от удалённого проекта:
    # `supabase db reset` и `db push` начинают целиться туда. Тот же отказ,
    # что и в run-local.zsh.
    [[ -f "${repo_root}/supabase/.temp/project-ref" ]] \
      && fail "AP1_LINKED_PROJECT_REJECTED" 65
    note "docker доступен, проект не залинкован"
    # `AP1_TEST_PASSWORD` нужен и локальному пути — provision_identities()
    # зовёт `npm run provision:ap1`, который требует её сам (scripts/
    # provision-ap1-users.ts) и падает своим текстом ошибки. Без проверки
    # здесь это падение приходит ПОСЛЕ старта всего стека и применения 54
    # миграций — минуты работы ради причины, которую можно было назвать сразу.
    if (( db_only == 0 && skip_identities == 0 )) && [[ -z ${AP1_TEST_PASSWORD-} ]]; then
      fail "AP1_BOOTSTRAP_ENV_MISSING AP1_TEST_PASSWORD" 64
    fi
  else
    local required=(AP1_DB_URL)
    if (( db_only == 0 )); then
      required+=(NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY)
    fi
    if (( db_only == 0 && skip_identities == 0 )); then
      required+=(SUPABASE_SERVICE_ROLE_KEY AP1_TEST_PASSWORD)
    fi
    local -a missing
    missing=()
    local name value
    for name in ${required}; do
      value=${(P)name-}
      [[ -n ${value} ]] || missing+=("${name}")
    done
    if (( ${#missing} > 0 )); then
      fail "AP1_BOOTSTRAP_ENV_MISSING ${(j:,:)missing}" 64
    fi
    note "переменные стенда заданы (${#required} шт., значения не печатаются)"
  fi

  verify_ledger_digests
}

# Реестр — не список имён, а список хешей. Порядок применения берётся отсюда же:
# «применить всё из папки» и «применить цепочку реестра» совпадают только пока
# в папке ничего лишнего, а проверять это надо до применения, а не после.
verify_ledger_digests() {
  [[ -f ${LEDGER_PATH} ]] || fail "AP1_LEDGER_MISSING ${LEDGER_PATH}" 66

  local -a ledger_paths
  ledger_paths=("${(@f)$(awk '{ print $2 }' "${LEDGER_PATH}")}")

  local -a folder_paths
  folder_paths=()
  local file
  for file in "${repo_root}"/supabase/migrations/*.sql(N); do
    folder_paths+=("supabase/migrations/${file:t}")
  done

  if [[ "${(j:,:)ledger_paths}" != "${(j:,:)folder_paths}" ]]; then
    fail "AP1_LEDGER_FOLDER_MISMATCH ledger=${#ledger_paths} folder=${#folder_paths}" 66
  fi

  # `sha256sum` — не на каждой машине: на "голом" macOS его нет, есть только
  # `shasum -a 256` (Perl, тот же формат вывода — сюда же ведёт §7.1 runbook,
  # операторская машина документирована как macOS/colima). Без разбора этого
  # случая отсутствие утилиты (код возврата 127) неотличимо от настоящего
  # расхождения хешей: обе ветки раньше вели в один и тот же
  # AP1_LEDGER_DIGEST_MISMATCH — то есть отсутствие coreutils на чужой машине
  # читалось как «кто-то подменил применяемые миграции».
  local -a sha_tool
  if whence -p sha256sum >/dev/null; then
    sha_tool=(sha256sum --check --quiet)
  elif whence -p shasum >/dev/null; then
    sha_tool=(shasum -a 256 --check --quiet)
  else
    fail "AP1_BOOTSTRAP_TOOL_MISSING sha256sum-or-shasum" 69
  fi
  ( cd "${repo_root}" && "${sha_tool[@]}" "${LEDGER_PATH}" ) \
    || fail "AP1_LEDGER_DIGEST_MISMATCH" 66

  note "реестр миграций сходится: ${#ledger_paths}/${#folder_paths} файлов, хеши совпадают"
}

# --- 2. роли -----------------------------------------------------------------

# Runbook §2a. На managed Supabase `postgres` — не superuser: в PostgreSQL 16+
# роль с CREATEROLE получает admin_option, но не set_option и не inherit_option.
# Без явного членства миграции слоя падают на `create schema … authorization`
# и на `alter default privileges`. Блок идемпотентен: guard внутри самих
# миграций проверяет атрибуты ролей и пересоздавать их не даёт.
prepare_roles() {
  step "Роли pi_* и членства postgres (runbook §2a)"

  # mktemp: непредсказуемое имя и права 600 с момента создания. Файл по
  # PID-имени в общем /tmp можно и угадать, и подсунуть между записью и
  # исполнением; для файла, который скрипт потом скармливает psql, это
  # эквивалент исполнения чужого SQL.
  local sql_file
  sql_file=$(mktemp "${TMPDIR:-/tmp}/ap1-bootstrap-roles.XXXXXX") \
    || fail "AP1_BOOTSTRAP_TMPFILE_FAILED" 70
  cat > "${sql_file}" <<'SQL'
\set ON_ERROR_STOP on

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_table_owner') then
    create role pi_table_owner nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_human_executor') then
    create role pi_human_executor nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'pi_worker_executor') then
    create role pi_worker_executor nologin noinherit nobypassrls;
  end if;
end
$roles$;

grant pi_table_owner     to current_user with inherit true, set true;
grant pi_human_executor  to current_user with inherit true, set true;
grant pi_worker_executor to current_user with inherit true, set true;

do $verify$
declare
  v_defects text[];
begin
  select array_agg(r.rolname || ':' ||
    case
      when not pg_has_role(current_user, r.oid, 'SET')   then 'NO_SET'
      when not pg_has_role(current_user, r.oid, 'USAGE') then 'NO_USAGE'
    end order by r.rolname)
  into v_defects
  from pg_catalog.pg_roles r
  where r.rolname in ('pi_table_owner', 'pi_human_executor', 'pi_worker_executor')
    and not (pg_has_role(current_user, r.oid, 'SET')
             and pg_has_role(current_user, r.oid, 'USAGE'));
  if v_defects is not null then
    raise exception 'AP1_BOOTSTRAP_ROLE_MEMBERSHIP_INVALID %', v_defects;
  end if;
  if (select count(*) from pg_catalog.pg_roles
      where rolname in ('pi_table_owner', 'pi_human_executor', 'pi_worker_executor')) <> 3 then
    raise exception 'AP1_BOOTSTRAP_ROLE_COUNT_INVALID';
  end if;
end
$verify$;

select 'AP1_BOOTSTRAP_ROLES_OK' as result;
SQL

  psql_run_quiet "${sql_file}" || { rm -f "${sql_file}"; fail "AP1_BOOTSTRAP_ROLES_FAILED" 70 }
  rm -f "${sql_file}"
  note "pi_table_owner / pi_human_executor / pi_worker_executor: SET и USAGE у исполнителя миграций есть"
}

# --- 3. миграции -------------------------------------------------------------

# Чистый bootstrap-путь: baseline `20260716071024_legacy_production_baseline.sql`
# плюс вся additive-цепочка в порядке реестра. Историческая нумерация 0001–0007
# сюда не входит и в `supabase/migrations/` больше не лежит: она сохранена как
# доказательство в docs/product-intelligence/agent-runs/db-wave/legacy-migrations/
# (см. supabase/migrations/README.md).
apply_migrations_hosted() {
  step "Миграции: чистый bootstrap-путь по реестру"

  local -a ledger_paths
  ledger_paths=("${(@f)$(awk '{ print $2 }' "${LEDGER_PATH}")}")

  local ledger_sql
  ledger_sql=$(mktemp "${TMPDIR:-/tmp}/ap1-bootstrap-ledger.XXXXXX") \
    || fail "AP1_BOOTSTRAP_TMPFILE_FAILED" 70
  cat > "${ledger_sql}" <<'SQL'
\set ON_ERROR_STOP on
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL
  psql_run_quiet "${ledger_sql}" \
    || { rm -f "${ledger_sql}"; fail "AP1_BOOTSTRAP_LEDGER_TABLE_FAILED" 70 }
  rm -f "${ledger_sql}"

  local applied
  applied=$(psql_value "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations")

  local relative version name applied_count=0 skipped_count=0
  for relative in ${ledger_paths}; do
    name=${relative:t:r}
    version=${name%%_*}
    # Версия и имя уходят в SQL литералами. Реестр — файл репозитория, но
    # проверка стоит здесь, а не в предположении «оттуда плохого не придёт».
    [[ ${name} =~ '^[0-9]+_[A-Za-z0-9_]+$' ]] \
      || fail "AP1_BOOTSTRAP_MIGRATION_NAME_INVALID ${name}" 66
    if [[ ",${applied}," == *",${version},"* ]]; then
      skipped_count=$(( skipped_count + 1 ))
      continue
    fi
    print -r -- "   применяю ${name}"
    psql_run_quiet "${repo_root}/${relative}" \
      || fail "AP1_BOOTSTRAP_MIGRATION_FAILED ${name}" 70
    psql_value "insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name#*_}') on conflict (version) do nothing" >/dev/null
    applied_count=$(( applied_count + 1 ))
  done

  note "применено ${applied_count}, уже было ${skipped_count}, всего в реестре ${#ledger_paths}"
}

apply_migrations_local() {
  step "Локальный стек: старт и применение миграций CLI"

  # imgproxy и почтовый UI вне ворот AP1: гейт проверяет Auth/PostgREST/Storage,
  # а не производные изображений. Тот же набор исключений, что и в run-local.zsh.
  supabase_cli start --exclude imgproxy,mailpit 2>&1 | redact || true

  # Файл несёт service role key стека. Он живёт секунды и удаляется, но эти
  # секунды он лежит в общем /tmp — mktemp даёт права 600 и непредсказуемое
  # имя с момента создания, до первой записи.
  local status_env
  status_env=$(mktemp "${TMPDIR:-/tmp}/ap1-bootstrap-status.XXXXXX") \
    || fail "AP1_BOOTSTRAP_TMPFILE_FAILED" 70
  supabase_cli status -o env > "${status_env}" 2>/dev/null \
    || { rm -f "${status_env}"; fail "AP1_BOOTSTRAP_STACK_STATUS_FAILED" 70 }
  set -a
  source "${status_env}"
  set +a
  rm -f "${status_env}"

  # CLI переименовал ключи публикации между версиями; берём то из двух, что
  # реально пришло, а не падаем на пустой переменной.
  AP1_API_URL=${API_URL:-}
  AP1_ANON_KEY=${ANON_KEY:-${PUBLISHABLE_KEY:-}}
  export NEXT_PUBLIC_SUPABASE_URL=${AP1_API_URL}
  export NEXT_PUBLIC_SUPABASE_ANON_KEY=${AP1_ANON_KEY}
  export SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY:-${SECRET_KEY:-}}

  [[ -n ${AP1_API_URL} ]] || fail "AP1_BOOTSTRAP_STACK_API_URL_MISSING" 70

  # DB_URL из статуса — единственный источник координат локальной базы.
  local db_url=${DB_URL:-}
  [[ -n ${db_url} ]] || fail "AP1_BOOTSTRAP_STACK_DB_URL_MISSING" 70
  local without_scheme=${db_url#*://}
  local credentials=${without_scheme%%@*}
  local location=${without_scheme#*@}
  AP1_LOCAL_DB_USER=${credentials%%:*}
  AP1_LOCAL_DB_PASSWORD=${credentials#*:}
  AP1_LOCAL_DB_HOST=${${location%%/*}%%:*}
  AP1_LOCAL_DB_PORT=${${location%%/*}##*:}
  AP1_LOCAL_DB_NAME=${location#*/}

  note "стек поднят, координаты базы получены из supabase status"
}

verify_migration_ledger_state() {
  step "Журнал миграций в базе совпадает с реестром репозитория"

  local expected actual
  expected=$(awk '{ name = $2; sub(/.*\//, "", name); sub(/_.*/, "", name); print name }' \
    "${LEDGER_PATH}" | sort | paste -sd, -)
  actual=$(psql_value "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations")

  if [[ "${actual}" != "${expected}" ]]; then
    fail "AP1_MIGRATION_LEDGER_MISMATCH" 70
  fi
  AP1_MIGRATION_COUNT=$(print -r -- "${actual}" | tr ',' '\n' | grep -c . || true)
  note "AP1_MIGRATION_LEDGER_OK count=${AP1_MIGRATION_COUNT}"
}

# --- 4. постусловия базы -----------------------------------------------------

# Три исторических `grant usage on schema auth to pi_*` внутри миграций ведут
# себя по-разному в зависимости от того, кто владеет схемой `auth`:
#
#   * managed Supabase — владелец `supabase_admin`, у `postgres` нет права
#     передачи. PostgreSQL отвечает WARNING «no privileges were granted», а не
#     ошибкой: миграция «успешна», грант не применился. Отзывать нечего.
#   * локальный стек CLI и любой Postgres, где `auth` создал сам `postgres` —
#     гранты применяются по-настоящему, и среда перестаёт быть похожей на
#     боевую ровно в том месте, где прятался блокер §2b.
#
# Поэтому шаг спрашивает БАЗУ, а не свой аргумент `--target`: признак «эта среда
# отличается от managed» измеряется, а не предполагается. Иначе среда, ведущая
# себя не по ярлыку, тихо проехала бы мимо постусловий.
model_hosted_auth_acls() {
  step "ACL схемы auth: сверка с поведением managed Supabase"

  local inherited
  inherited=$(psql_value "
    select case when exists (
      select 1
      from unnest(array['pi_table_owner','pi_human_executor','pi_worker_executor']) role(name)
      where has_schema_privilege(role.name, 'auth', 'USAGE')
    ) or exists (
      select 1 from information_schema.table_privileges
      where grantee = 'pi_table_owner' and table_schema = 'auth'
    ) or exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'auth' and tablename = 'users'
    ) then 'yes' else 'no' end")

  if [[ ${inherited} != yes ]]; then
    note "инертные гранты не применились — среда уже ведёт себя как managed, отзывать нечего"
    return 0
  fi

  psql_run_quiet "${repo_root}/tests/ap1/environment/apply-local-auth-compat.sql" \
    || fail "AP1_BOOTSTRAP_AUTH_COMPAT_FAILED" 70
  note "гранты применились (auth принадлежит исполнителю) — отозваны, ACL и policy на auth.users сняты"
}

verify_database() {
  step "Постусловия базы (verify-db.sql)"
  local output
  output=$(psql_run "${repo_root}/tests/ap1/environment/verify-db.sql") \
    || { print -r -- "${output}"; fail "AP1_BOOTSTRAP_VERIFY_DB_FAILED" 70 }
  # Нулевой код psql — необходимое условие, но не достаточное: доказательством
  # служит сама строка AP1_DB_OK из финального select. Нет строки — нет успеха,
  # даже если psql промолчал нулём.
  if ! print -r -- "${output}" | grep -E 'AP1_DB_OK' ; then
    print -r -- "${output}"
    fail "AP1_BOOTSTRAP_VERIFY_DB_NO_MARKER" 70
  fi
}

# --- 5. поверхность ----------------------------------------------------------

verify_exposure() {
  step "Схемы Data API, Auth и Storage"

  local api_url anon_key
  if [[ ${target} == local ]]; then
    api_url=${AP1_API_URL}
    anon_key=${AP1_ANON_KEY}
  else
    api_url=${NEXT_PUBLIC_SUPABASE_URL}
    anon_key=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
  fi

  # Верификатор поверхности читает форму `supabase status --output json` со
  # stdin. Для hosted той же формы нет — собираем её из env, чтобы обе среды
  # проверялись ОДНИМ верификатором, а не двумя похожими.
  API_URL="${api_url}" ANON_KEY="${anon_key}" node --input-type=module -e '
    process.stdout.write(JSON.stringify({
      API_URL: process.env.API_URL,
      ANON_KEY: process.env.ANON_KEY,
    }));
  ' | node "${repo_root}/tests/ap1/environment/verify-runtime.mjs" \
    || fail "AP1_BOOTSTRAP_VERIFY_RUNTIME_FAILED" 70

  # Бакет проверен по состоянию в базе (verify-db.sql, приватность), здесь —
  # что он вообще существует под тем именем, которое зашито в read-контракты
  # ingestion (`20260717091000`, 'bucket', 'client-uploads').
  local buckets
  buckets=$(psql_value "select coalesce(string_agg(id || '=' || case when public then 'public' else 'private' end, ' '), 'NONE') from storage.buckets")
  note "storage buckets: ${buckets}"
  [[ ${buckets} == *"client-uploads=private"* ]] \
    || fail "AP1_BOOTSTRAP_CLIENT_UPLOADS_BUCKET_INVALID ${buckets}" 70
}

# --- 6. пять личностей -------------------------------------------------------

provision_identities() {
  step "Пять ролевых личностей"

  if (( skip_identities )); then
    note "ПРОПУЩЕНО по --skip-identities"
    AP1_IDENTITIES="пропущено (--skip-identities)"
    return 0
  fi

  local output
  output=$(cd "${repo_root}" && AP1_CONFIRM_DISPOSABLE=yes npm run --silent provision:ap1 2>&1) \
    || { print -r -- "${output}" | redact; fail "AP1_BOOTSTRAP_PROVISION_FAILED" 70 }

  # user_id — не секрет и нужен оператору: по нему заводятся членства и
  # подменяется контекст в SQL-редакторе (runbook §4.1a).
  # [[:space:]] вместо \s: BSD grep на macOS GNU-класс \s не понимает, и
  # счёт личностей молча падал бы в ноль при успешном создании всех пяти.
  print -r -- "${output}" | grep -E '^[[:space:]]{2}(owner|designer|builder|client|guest)[[:space:]]' || true
  AP1_IDENTITIES=$(print -r -- "${output}" | grep -cE '^[[:space:]]{2}(owner|designer|builder|client|guest)[[:space:]]' || true)
}

# --- 7. сводка ---------------------------------------------------------------

print_summary() {
  step "Итог"

  local schemas
  schemas=$(psql_value "select string_agg(nspname, ' ' order by nspname) from pg_namespace where nspname like 'projectceo%' or nspname like 'project_intelligence%' or nspname = 'remhaos_channel_api'")

  local url_line
  if [[ ${target} == local ]]; then
    url_line=${AP1_API_URL:-—}
  elif (( db_only )); then
    url_line="—"
  else
    url_line=${NEXT_PUBLIC_SUPABASE_URL}
  fi

  print -r -- ""
  print -r -- "  target ............. ${target}"
  print -r -- "  url ................ ${url_line}"
  print -r -- "  migrations ......... ${AP1_MIGRATION_COUNT:-?}"
  print -r -- "  schemas ............ ${schemas}"
  print -r -- "  identities ......... ${AP1_IDENTITIES:-0}"
  print -r -- ""

  if (( db_only )); then
    print -r -- "AP1_BOOTSTRAP_DB_ONLY target=${target} migrations=${AP1_MIGRATION_COUNT:-?}"
    print -r -- "ЧАСТИЧНЫЙ прогон: Auth/PostgREST/Storage не проверялись, личности не создавались."
    print -r -- "Стендом пилота такой прогон не является."
    return 0
  fi

  print -r -- "AP1_BOOTSTRAP_OK target=${target} migrations=${AP1_MIGRATION_COUNT:-?} identities=${AP1_IDENTITIES:-0}"
}

# --- прогон ------------------------------------------------------------------

main() {
  parse_arguments

  print -r -- "AP1 bootstrap-манифест одноразового стенда (target=${target:-—})"

  preflight

  if [[ ${target} == local ]]; then
    # На локальном стеке роли заводит supabase/roles.sql до миграций, поэтому
    # стек стартует первым, а членства с inherit/set довыдаются сразу после —
    # чтобы обе среды приходили к одному состоянию ролей.
    apply_migrations_local
    prepare_roles
    verify_migration_ledger_state
  else
    prepare_roles
    apply_migrations_hosted
    verify_migration_ledger_state
  fi

  model_hosted_auth_acls
  verify_database

  if (( db_only )); then
    print_summary
    return 0
  fi

  verify_exposure
  provision_identities
  print_summary
}

main
