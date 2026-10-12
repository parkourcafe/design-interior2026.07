#!/bin/sh
# Ежедневная резервная копия: база (pg_dump, формат custom), роли кластера и
# файлы клиентов. Хранится в ./backups на сервере. Копию за пределы сервера
# (снимки диска или S3 у того же хостера в РФ) настраивает хостинг.
#
# Срок хранения (DEC-047(f): ночные копии 14 дней; ТЗ 08.10, FIX-05):
#   T = BACKUP_RETENTION_DAYS × 86 400 с — ни одна копия не старше T.
#   Возраст считается от времени создания, записанного в имени файла
#   (…-ГГГГММДД-ЧЧММ…, UTC), а не от mtime и не округлёнными сутками find.
#   Уборка идёт раз в Δ = 86 400 с (раз в сутки, после копии) и при каждом
#   запуске контейнера. Чтобы копия не дожила до T к следующей уборке,
#   удаляется всё старше T − Δ. Поэтому при исправном расписании:
#     • максимум возраста копии — T (14 суток);
#     • гарантированно доступны копии за последние T − Δ (13 суток),
#       перед очередной уборкой — до 14 суток.
#   Копии старше T фиксируются как нарушение (RETENTION_OVERDUE в журнале
#   контейнера и в backups/retention.log) и удаляются: исключений из срока нет
#   (решение владельца 11.10.2026, п. 1).
#
# Запуск после простоя (решение владельца 11.10.2026, п. 1):
#   при каждом старте контейнера СНАЧАЛА снимается и проверяется новая копия,
#   ПОТОМ уборка по сроку. Если копия не снялась или не прошла проверку —
#   «резервное копирование не выполнено» (BACKUP_FAILED), повтор не чаще
#   BACKUP_RETRY_SECONDS, а если после уборки не осталось ни одной пригодной
#   копии — BACKUP_CRITICAL: критический операционный сбой, видимый в журнале
#   контейнера и в backups/backup-status.
#
# Проверка копии (без неё копия не считается снятой):
#   roles-*.sql содержит CREATE ROLE; db-*.dump начинается с PGDMP, читается
#   pg_restore целиком (оглавление — только начало архива); storage-*.tar.gz
#   проходит gzip -t и tar -t. Проверенный набор получает маркер
#   verified-<штамп>.ok; «пригодная копия» — полный непросроченный набор с маркером.
#
# Режимы проверки (только тесты и ручные прогоны):
#   BACKUP_MODE=cleanup-once — одна уборка, выход;
#   BACKUP_MODE=backup-once  — одна копия с проверкой и уборкой, код выхода
#                              0 — снята, 70 — не выполнена, 71 — пригодной копии нет;
#   BACKUP_NOW_EPOCH подменяет «сейчас» (синтетические файлы в тестах).
set -eu
# В копиях персональные данные: файлы только для владельца.
umask 077
DIR=${BACKUP_DIR:-/backups}
SRC=${BACKUP_STORAGE_DIR:-/storage}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
RETRY=${BACKUP_RETRY_SECONDS:-900}
INTERVAL=86400
T=$((RETENTION_DAYS * 86400))
THRESHOLD=$((T - INTERVAL))
[ "$THRESHOLD" -gt 0 ] || { echo "BACKUP_RETENTION_DAYS должен быть больше 1" >&2; exit 64; }
[ "$RETRY" -ge 60 ] || { echo "BACKUP_RETRY_SECONDS должен быть не меньше 60" >&2; exit 64; }
STATUS="$DIR/backup-status"
LOG="$DIR/retention.log"

now_epoch() { echo "${BACKUP_NOW_EPOCH:-$(date -u +%s)}"; }
stamp_now() { date -u -d "@$(now_epoch)" +%Y%m%d-%H%M; }
ts() { date -u -d "@$(now_epoch)" +%FT%TZ; }

# Время создания из имени: db-20261008-1300.dump → эпоха UTC; пусто — имя не наше.
stamp_epoch() {
  s=$(echo "$1" | sed -nE 's/^(db|storage|roles|verified)-([0-9]{8})-([0-9]{4})\..*$/\2 \3/p')
  [ -n "$s" ] || return 0
  d=${s% *}; t=${s#* }
  date -u -d "$(echo "$d" | cut -c1-4)-$(echo "$d" | cut -c5-6)-$(echo "$d" | cut -c7-8) $(echo "$t" | cut -c1-2):$(echo "$t" | cut -c3-4):00" +%s 2>/dev/null || true
}

# Состояние для оператора и мониторинга: одна строка, перезаписывается.
set_status() { printf '%s %s %s\n' "$(ts)" "$1" "$2" > "$STATUS"; }

# --- Проверка снятой копии --------------------------------------------------
verify_set() { # штамп → 0 если полный набор исправен
  st=$1
  [ -s "$DIR/roles-$st.sql" ] && grep -q "CREATE ROLE" "$DIR/roles-$st.sql" || { echo "проверка $st: роли не копия pg_dumpall --roles-only" >&2; return 1; }
  [ -s "$DIR/db-$st.dump" ] && [ "$(head -c 5 "$DIR/db-$st.dump")" = "PGDMP" ] || { echo "проверка $st: дамп не формат pg_dump -Fc" >&2; return 1; }
  pg_restore --list "$DIR/db-$st.dump" >/dev/null 2>&1 || { echo "проверка $st: оглавление дампа не читается" >&2; return 1; }
  pg_restore -f /dev/null "$DIR/db-$st.dump" >/dev/null 2>&1 || { echo "проверка $st: дамп не читается целиком" >&2; return 1; }
  [ -s "$DIR/storage-$st.tar.gz" ] && gzip -t "$DIR/storage-$st.tar.gz" 2>/dev/null && tar -tzf "$DIR/storage-$st.tar.gz" >/dev/null 2>&1 \
    || { echo "проверка $st: архив файлов повреждён" >&2; return 1; }
  : > "$DIR/verified-$st.ok"
  return 0
}

# Есть ли пригодная копия: полный набор с маркером проверки не старше порога.
# Набор без маркера (снят прежней версией скрипта) проверяется здесь один раз.
usable_copy() {
  now=$(now_epoch)
  for f in $(ls -1 "$DIR"/db-*.dump 2>/dev/null | sort -r); do
    st=$(basename "$f" .dump); st=${st#db-}
    created=$(stamp_epoch "db-$st.dump"); [ -n "$created" ] || continue
    [ $((now - created)) -le "$THRESHOLD" ] || continue
    [ -e "$DIR/verified-$st.ok" ] && { echo "$st"; return 0; }
    verify_set "$st" 2>/dev/null && { echo "$st"; return 0; }
  done
  return 1
}

# --- Копия ------------------------------------------------------------------
backup_now() { # 0 — снята и проверена; 1 — не выполнена (частичные файлы удалены)
  stamp=$(stamp_now)
  ok=1
  # Роли кластера (pg_dump их не содержит, а миграции создают свои роли);
  # пароли не сохраняются — служебные пароли задаёт roles.sql из .env.
  pg_dumpall --roles-only --no-role-passwords -f "$DIR/roles-$stamp.sql.part" && mv "$DIR/roles-$stamp.sql.part" "$DIR/roles-$stamp.sql" || ok=0
  [ "$ok" = 1 ] && { pg_dump -Fc -f "$DIR/db-$stamp.dump.part" && mv "$DIR/db-$stamp.dump.part" "$DIR/db-$stamp.dump" || ok=0; }
  [ "$ok" = 1 ] && { tar -czf "$DIR/storage-$stamp.tar.gz.part" -C "$SRC" . && mv "$DIR/storage-$stamp.tar.gz.part" "$DIR/storage-$stamp.tar.gz" || ok=0; }
  [ "$ok" = 1 ] && verify_set "$stamp" || ok=0
  if [ "$ok" = 1 ]; then
    echo "backup ok $stamp (роли, база, файлы проверены)"
    echo "$(ts) BACKUP_OK $stamp" >> "$LOG"
    set_status BACKUP_OK "$stamp"
    return 0
  fi
  # Неполный или непроверенный набор пригодной копией не является.
  rm -f "$DIR/roles-$stamp.sql.part" "$DIR/db-$stamp.dump.part" "$DIR/storage-$stamp.tar.gz.part" \
        "$DIR/roles-$stamp.sql" "$DIR/db-$stamp.dump" "$DIR/storage-$stamp.tar.gz" "$DIR/verified-$stamp.ok"
  echo "BACKUP_FAILED $stamp: резервное копирование не выполнено" >&2
  echo "$(ts) BACKUP_FAILED $stamp" >> "$LOG"
  set_status BACKUP_FAILED "$stamp"
  return 1
}

# --- Уборка по сроку --------------------------------------------------------
cleanup() {
  now=$(now_epoch)
  removed=0; overdue=0; kept=0
  for f in "$DIR"/db-*.dump "$DIR"/storage-*.tar.gz "$DIR"/roles-*.sql "$DIR"/verified-*.ok; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    created=$(stamp_epoch "$name")
    if [ -z "$created" ]; then echo "retention: пропущен файл с непонятным именем $name" >&2; continue; fi
    age=$((now - created))
    if [ "$age" -gt "$T" ]; then
      overdue=$((overdue + 1))
      echo "RETENTION_OVERDUE $name age=${age}s limit=${T}s" >&2
      echo "$(ts) RETENTION_OVERDUE $name age=${age}s limit=${T}s" >> "$LOG"
    fi
    if [ "$age" -gt "$THRESHOLD" ]; then rm -f "$f"; removed=$((removed + 1)); else kept=$((kept + 1)); fi
  done
  # Незавершённые копии (.part) старше часа — обрывки, не копии.
  find "$DIR" -name '*.part' -mmin +60 -delete
  echo "$(ts) cleanup removed=$removed kept=$kept overdue=$overdue threshold=${THRESHOLD}s limit=${T}s" >> "$LOG"
  echo "retention: удалено $removed, осталось $kept, просрочено $overdue"
}

# После уборки: если пригодной копии нет — критический сбой, не предупреждение.
check_usable() {
  if st=$(usable_copy); then
    echo "пригодная копия: $st"
    return 0
  fi
  echo "BACKUP_CRITICAL: нет ни одной пригодной резервной копии в пределах срока хранения" >&2
  echo "$(ts) BACKUP_CRITICAL no_usable_copy" >> "$LOG"
  set_status BACKUP_CRITICAL no_usable_copy
  return 1
}

# Один цикл «копия → уборка → есть ли пригодная копия».
cycle() { # код: 0 ок; 70 копия не выполнена, пригодная есть; 71 пригодной копии нет
  rc=0
  backup_now || rc=70
  cleanup
  check_usable || rc=71
  return $rc
}

case "${BACKUP_MODE:-}" in
  cleanup-once) cleanup; check_usable || exit 71; exit 0 ;;
  backup-once)  cycle; exit $? ;;
esac

# При каждом запуске контейнера — сначала копия с проверкой, потом уборка.
# Отказ повторяется не чаще RETRY секунд, пока копия не снимется; просроченные
# копии при этом всё равно удаляются (срок хранения исключений не имеет).
until cycle; do
  echo "повтор через ${RETRY} с" >&2
  sleep "$RETRY"
done

while :; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${BACKUP_HOUR_UTC:-0}:00:00" +%s 2>/dev/null || echo "$now")
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  until cycle; do
    echo "повтор через ${RETRY} с" >&2
    sleep "$RETRY"
  done
done
