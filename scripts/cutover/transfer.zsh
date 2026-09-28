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
# Ссылки на бриф: intake_expires_at в старой схеме нет, в новой NULL = «без
# срока», поэтому все старые ссылки /i/… остаются рабочими — осознанно, чтобы
# клиенты, заполняющие бриф, не потеряли доступ.
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
update public.projects p
set passport_revision_llm_ok = exists (
  select 1 from public.risk_cards r where r.project_id = p.id and r.source = 'llm'
)
where p.passport is not null;
SQL

print -r -- "== Запись в приёмник (одна транзакция)"
psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -q --single-transaction -f "$load_sql"

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
(( fail == 0 )) || { print -r -- "СВЕРКА НЕ ПРОШЛА"; exit 1; }
print -r -- "TRANSFER_OK"
