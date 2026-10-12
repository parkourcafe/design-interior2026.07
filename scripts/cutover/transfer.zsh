#!/usr/bin/env zsh
# Перенос аккаунтов и проектов из старой рабочей базы (своя линия миграций,
# последняя 20260825035533) в новую базу, поднятую из supabase/migrations.
# Решение владельца 28.09: новая база + перенос аккаунтов и проектов.
#
# Что переносится (порядок важен — внешние ключи):
#   auth.users, auth.identities   — входы; хеши паролей переносятся как есть,
#                                   старые пароли работают. НЕ переносятся
#                                   сессии и refresh-токены (все входят заново),
#                                   а также факторы MFA и одноразовые коды
#                                   (в рабочей базе MFA не включён);
#   designers, projects, answers, risk_cards, proposals, events.
# Ссылки на бриф: intake_expires_at в старой схеме нет; переносимым проектам
# ставится срок 30 дней от переноса (как у новой ссылки), а не «бессрочно»:
# клиентская ссылка должна иметь ограниченный срок (оценка ПДн 01.10.2026).
# Ссылки на КП получают срок 90 дней от даты отправки триггером базы
# (20260928156000) при вставке.
#
# Что НЕ переносится (остаётся в старой базе как архив): таблицы прежнего
# M1-runtime (ai_calls, approval_requests, audit_events, project_facts,
# project_sources, workflow_*), proposal_revisions (в новой схеме такой
# таблицы нет), rate_limits, схема market_harvest. Файлы хранилища —
# отдельным скриптом transfer-files.mjs.
#
# Гарантии:
#   * источник только читается (сессии с default_transaction_read_only);
#   * приёмник должен быть пустым и с применёнными миграциями репозитория —
#     иначе отказ до записи; повторный запуск на заполненной базе невозможен;
#   * вся запись — одна транзакция: либо перенесено всё, либо ничего;
#   * переносятся только столбцы, которые есть в обеих базах (кроме
#     вычисляемых); триггеры приёмника работают как обычно; ревизия
#     паспорта создаётся штатным триггером для каждого проекта с паспортом;
#   * после записи — сверка количества строк по каждой таблице;
#   * выгрузка (персональные данные) — во временной папке с правами 0700,
#     удаляется в конце.
#
# Запуск (строки подключения — роль postgres; секреты не печатаются):
#   SOURCE_DB_URL='postgresql://…старая…' TARGET_DB_URL='postgresql://…новая…' \
#     zsh scripts/cutover/transfer.zsh
# Требуется psql 15+.

set -euo pipefail
: "${SOURCE_DB_URL:?SOURCE_DB_URL не задан}"
: "${TARGET_DB_URL:?TARGET_DB_URL не задан}"

# Token-поля auth.users, которые GoTrue целевой версии (v2.192.0, проверено
# на стенде 11.10.2026: у всех созданных им пользователей — пустая строка, NULL
# нет) читает как string и падает с 500 «converting NULL to string» при NULL.
# В старой базе и при отсутствии столбца в источнике сюда приходит NULL.
# Решение владельца 11.10.2026, п. 4: NULL → '' только для этого списка,
# непустые значения сохраняются, источник не меняется; несовпадение схемы
# приёмника по этим столбцам останавливает перенос.
TOKEN_FIELDS=(
  confirmation_token
  recovery_token
  email_change
  email_change_token_new
  email_change_token_current
  phone_change
  phone_change_token
  reauthentication_token
)

TABLES=(
  auth.users
  auth.identities
  public.designers
  public.projects
  public.answers
  public.risk_cards
  public.proposals
  public.events
)

src() { PGOPTIONS='-c default_transaction_read_only=on' psql "$SOURCE_DB_URL" -X -v ON_ERROR_STOP=1 -qAt "$@"; }
tgt() { psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -qAt "$@"; }

umask 077
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

print -r -- "== Проверка приёмника"
ready=$(tgt -c "select (to_regclass('public.intake_consent_records') is not null
  and to_regclass('project_intelligence.market_routing_receipts') is not null
  and to_regprocedure('public.get_account_retention_status()') is not null)::text")
[[ "$ready" == "true" ]] || { print -r -- "ОТКАЗ: в приёмнике не применены миграции репозитория"; exit 1; }
filled=$(tgt -c "select (select count(*) from auth.users) + (select count(*) from public.designers)
  + (select count(*) from public.projects)")
[[ "$filled" == "0" ]] || { print -r -- "ОТКАЗ: приёмник не пуст ($filled строк) — перенос только в пустую базу"; exit 1; }

print -r -- "== Проверка схемы приёмника: token-поля auth.users"
# Каждое поле списка должно существовать в приёмнике как символьный столбец,
# допускающий NULL (иначе смысл нормализации другой). Любое отклонение —
# неизвестное несовпадение схемы: перенос останавливается до выгрузки.
for field in $TOKEN_FIELDS; do
  shape=$(tgt -c "select data_type || '/' || is_nullable from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = '$field'")
  case "$shape" in
    "character varying/YES"|"text/YES") ;;
    "") print -r -- "ОТКАЗ: в auth.users приёмника нет столбца $field — схема GoTrue не совпадает с ожидаемой"; exit 1 ;;
    *)  print -r -- "ОТКАЗ: столбец auth.users.$field приёмника имеет вид $shape, ожидалось character/YES"; exit 1 ;;
  esac
done
print -r -- "  token-поля приёмника: ${#TOKEN_FIELDS} столбцов, схема совпадает"

print -r -- "== Предварительная проверка: ограничения приёмника на данных источника"
# Одна плохая строка сорвала бы всю транзакцию записи уже после выгрузки.
# Поэтому каждое ограничение приёмника (CHECK, внешний ключ, уникальность)
# на переносимых таблицах заранее проверяется на источнике. Ограничение,
# ссылающееся на столбец, которого в источнике нет, пропускается: такой
# столбец придёт значением по умолчанию.
pre_fail=0
for table in $TABLES; do
  schema=${table%%.*}; name=${table#*.}
  tgt -c "select c.contype::text || E'\t' || c.conname || E'\t' || pg_catalog.pg_get_constraintdef(c.oid)
    from pg_catalog.pg_constraint c
    where c.conrelid = '$table'::regclass and c.contype in ('c', 'f', 'u')
    order by c.conname" | while IFS=$'\t' read -r ctype cname cdef; do
    [[ -n "$ctype" ]] || continue
    case $ctype in
      c) query="select count(*) from $table where not (${cdef#CHECK })" ;;
      f) cols=$(print -r -- "$cdef" | sed -E 's/^FOREIGN KEY \(([^)]*)\) REFERENCES ([^(]*)\(([^)]*)\).*/\1/')
         ref=$(print -r -- "$cdef" | sed -E 's/^FOREIGN KEY \(([^)]*)\) REFERENCES ([^(]*)\(([^)]*)\).*/\2/')
         refcols=$(print -r -- "$cdef" | sed -E 's/^FOREIGN KEY \(([^)]*)\) REFERENCES ([^(]*)\(([^)]*)\).*/\3/')
         [[ "$ref" == *.* ]] || ref="$schema.$ref"
         query="select count(*) from $table where ($cols) is not null and ($cols) not in (select $refcols from $ref)" ;;
      u) cols=$(print -r -- "$cdef" | sed -E 's/^UNIQUE \(([^)]*)\).*/\1/')
         # Как и сама база: строки с NULL в уникальных столбцах не считаются дублями.
         notnull=$(print -r -- "$cols" | sed -E 's/ *, */ is not null and /g')
         query="select count(*) from (select 1 from $table where $notnull is not null group by $cols having count(*) > 1) d" ;;
    esac
    bad=$(src -c "$query" 2>/dev/null) || { print -r -- "  пропущено $table $cname (столбца нет в источнике)"; continue; }
    if [[ "$bad" != "0" ]]; then
      print -r -- "  FAIL $table $cname: $bad строк нарушают ограничение приёмника"; pre_fail=1
    fi
  done
done 2>&1 | tee "$WORK/preflight.log"
if grep -q "FAIL" "$WORK/preflight.log"; then
  print -r -- "ОТКАЗ: исправьте перечисленные строки в источнике (или исключите их) и повторите"; exit 1
fi
print -r -- "  ограничения приёмника: нарушений нет"
files_expected=$(src -c "select count(*) from storage.objects where bucket_id = 'client-uploads' and name not like '%/'")
print -r -- "  файлов client-uploads в источнике: $files_expected (передайте в transfer-files.mjs как EXPECTED_FILE_COUNT)"

print -r -- "== Выгрузка из источника (только чтение)"
load_sql="$WORK/load.sql"
: > "$load_sql"
for table in $TABLES; do
  schema=${table%%.*}; name=${table#*.}
  # Общие столбцы: есть в обеих базах, в приёмнике не вычисляемые.
  src_cols=$(src -c "select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema = '$schema' and table_name = '$name'")
  tgt_cols=$(tgt -c "select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema = '$schema' and table_name = '$name' and is_generated = 'NEVER'")
  cols=$(print -r -- "$src_cols" | tr ',' '\n' | grep -Fxf <(print -r -- "$tgt_cols" | tr ',' '\n') | sed 's/.*/"&"/' | paste -sd, - || true)
  [[ -n "$cols" ]] || { print -r -- "ОТКАЗ: нет общих столбцов для $table"; exit 1; }
  # Выгрузка и подсчёт — в одной транзакции REPEATABLE READ: даже если старый
  # сайт ещё пишет, сверка идёт по тому же снимку, что и выгрузка.
  src <<SQL
begin isolation level repeatable read read only;
\\copy (select $cols from $table) to '$WORK/$name.csv' with (format csv, header true)
\\copy (select count(*) from $table) to '$WORK/$name.count'
commit;
SQL
  rows=$(< "$WORK/$name.count")
  print -r -- "  $table: $rows строк"
  print -r -- "\\copy $table ($cols) from '$WORK/$name.csv' with (format csv, header true)" >> "$load_sql"
done

# Ревизия паспорта создаётся штатным триггером базы только при изменении
# паспорта (projects_append_passport_revision, before update), не при вставке.
# Без ревизии дизайнер не сможет подтвердить паспорт перенесённого проекта.
# llm_ok: старая база его не хранит; признак — есть ли у проекта карточка
# риска от AI (source = 'llm').
cat >> "$load_sql" <<'SQL'
update public.projects
set intake_expires_at = pg_catalog.statement_timestamp() + interval '30 days'
where intake_expires_at is null;
update public.projects p
set passport_revision_llm_ok = exists (
  select 1 from public.risk_cards r where r.project_id = p.id and r.source = 'llm'
)
where p.passport is not null;
SQL

# Нормализация token-полей — в той же транзакции, что и запись: только NULL → '',
# по явному списку, с подсчётом по каждому полю (RAISE NOTICE → журнал переноса).
token_list=$(print -r -- "${(j:,:)TOKEN_FIELDS}" | sed "s/[^,]*/'&'/g")
cat >> "$load_sql" <<SQL
do \$normalize\$
declare
  f text;
  n bigint;
begin
  foreach f in array array[$token_list] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'auth' and table_name = 'users' and column_name = f) then
      raise exception 'TOKEN_FIELD_MISSING %', f;
    end if;
    execute format('update auth.users set %I = '''' where %I is null', f, f);
    get diagnostics n = row_count;
    raise notice 'TOKEN_NORMALIZED field=% rows=%', f, n;
  end loop;
end
\$normalize\$;
SQL

print -r -- "== Запись в приёмник (одна транзакция)"
psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -q --single-transaction -f "$load_sql" 2>&1 | tee "$WORK/load.log"
[[ ${pipestatus[1]} -eq 0 ]] || { print -r -- "ОТКАЗ: запись не выполнена, транзакция откачена"; exit 1; }
print -r -- "  нормализация token-полей (NULL → пустая строка, непустые значения не тронуты):"
grep -o 'TOKEN_NORMALIZED field=[a-z_]* rows=[0-9]*' "$WORK/load.log" | sed 's/TOKEN_NORMALIZED /    /'

print -r -- "== Сверка"
fail=0
for table in $TABLES; do
  name=${table#*.}
  expected=$(< "$WORK/$name.count")
  actual=$(tgt -c "select count(*) from $table")
  if [[ "$expected" == "$actual" ]]; then
    print -r -- "  OK   $table: $actual"
  else
    print -r -- "  FAIL $table: ожидалось $expected, в приёмнике $actual"; fail=1
  fi
done
with_passport=$(tgt -c "select count(*) from public.projects where passport is not null")
revisions=$(tgt -c "select count(distinct project_id) from public.project_passport_revisions")
if [[ "$with_passport" == "$revisions" ]]; then
  print -r -- "  OK   ревизии паспорта: $revisions из $with_passport проектов с паспортом"
else
  print -r -- "  FAIL ревизии паспорта: $revisions из $with_passport"; fail=1
fi
# Ни одного NULL в token-полях после переноса — иначе вход в GoTrue падает с 500.
for field in $TOKEN_FIELDS; do
  nulls=$(tgt -c "select count(*) from auth.users where $field is null")
  if [[ "$nulls" != "0" ]]; then print -r -- "  FAIL auth.users.$field: $nulls NULL после нормализации"; fail=1; fi
done
(( fail == 0 )) && print -r -- "  OK   token-поля: NULL нет"
(( fail == 0 )) || { print -r -- "СВЕРКА НЕ ПРОШЛА"; exit 1; }
print -r -- "TRANSFER_OK"
