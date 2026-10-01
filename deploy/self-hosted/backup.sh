#!/bin/sh
# Ежедневная резервная копия: база (pg_dump, формат custom) и файлы клиентов.
# Хранится BACKUP_RETENTION_DAYS дней в ./backups на сервере. Копию за пределы
# сервера (снимки диска или S3 у того же хостера в РФ) настраивает хостинг.
set -eu
# В копиях персональные данные: файлы только для владельца.
umask 077
while :; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${BACKUP_HOUR_UTC}:00:00" +%s 2>/dev/null || echo "$now")
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  stamp=$(date -u +%Y%m%d-%H%M)
  if pg_dump -Fc -f "/backups/db-$stamp.dump.part" && mv "/backups/db-$stamp.dump.part" "/backups/db-$stamp.dump"; then
    echo "backup db ok $stamp"
  else
    echo "backup db FAILED $stamp" >&2
  fi
  tar -czf "/backups/storage-$stamp.tar.gz.part" -C /storage . && mv "/backups/storage-$stamp.tar.gz.part" "/backups/storage-$stamp.tar.gz" \
    && echo "backup storage ok $stamp" || echo "backup storage FAILED $stamp" >&2
  find /backups -name 'db-*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -delete
  find /backups -name 'storage-*.tar.gz' -mtime +"$BACKUP_RETENTION_DAYS" -delete
done
