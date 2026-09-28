# Ключ воркера file intake — runbook

**Основание:** DEC-045 (b). Фоновые воркеры file intake — загрузчик вложений Telegram
(`npm run bridge:telegram-attachments`) и импорт Google Drive — создают записи о файлах под ролью базы
`pi_worker_executor`. Эта роль не умеет входить в базу. API базы (PostgREST) переключается на неё по JWT,
в котором `role = pi_worker_executor`.

Ключ — это credentials. Выпускает и хранит его владелец. В репозиторий ключ не попадает.
Этот runbook описывает шаги; сам ключ в этой работе не выпускался. **Статус: NOT_VERIFIED на живом проекте.**

## Что уже сделано в коде

- Миграция `20260928130000_file_intake_worker_identity.sql` выдаёт логин-роли API `authenticator` членство
  в `pi_worker_executor`. Без этого переключение по JWT невозможно. Новых прав у самой роли нет.
- `createFileIntakeWorkerClient()` (`lib/integration-gateway/runtime/worker-client.ts`) берёт ключ из
  `REMHAOS_FILE_INTAKE_WORKER_JWT`. Ключ с другой ролью, например service role, отклоняется до первого вызова.
- Скрипт загрузчика проверяет ключ до захвата вложений. Без ключа он останавливается, попытки не тратятся.

## Шаги владельца

1. **Применить миграции** в целевом окружении (staging).
2. **Выпустить JWT**, подписанный ключом, которому доверяет API проекта. Полезная нагрузка:
   ```json
   { "role": "pi_worker_executor", "iss": "supabase", "iat": <сейчас>, "exp": <сейчас + 90 дней> }
   ```
   - Если проект на legacy JWT secret, подписать HS256 этим секретом (Dashboard → Settings → API → JWT Settings).
   - Если проект на новых асимметричных ключах подписи, нужен собственный ключ подписи, импортированный в
     проект. Сверьте с актуальной документацией Supabase «JWT signing keys»: процедура меняется.
   - Срок ставьте конечным. Ключ с ролью шире (`service_role`) не использовать — код его отклонит.
3. **Положить ключ** в окружение воркера: `REMHAOS_FILE_INTAKE_WORKER_JWT=<jwt>`. Нужны также
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (или `NEXT_PUBLIC_SUPABASE_ANON_KEY`) и
   `SUPABASE_SERVICE_ROLE_KEY`. Service role нужен для очереди вложений и загрузки байтов в карантин.
4. **Проверить** без Telegram: `REMHAOS_TELEGRAM_BRIDGE_ENABLED=true REMHAOS_TELEGRAM_ATTACHMENTS_ENABLED=true
   npm run bridge:telegram-attachments`. На пустой очереди ожидается отчёт с `claimed: 0`.
   Ошибка `file_intake_worker_key_*` означает, что ключ не задан или у него неверная роль.
5. **Включить файлы в проекте** — флаг «Файлы» в панели Telegram проекта (владелец проекта).

## Отзыв

- Удалить `REMHAOS_FILE_INTAKE_WORKER_JWT` из окружения. Загрузчик остановится, вложения останутся в очереди.
- Чтобы ключ перестал работать везде, сменить ключ подписи проекта. Это затронет все JWT проекта:
  планировать отдельно.
- Крайняя мера — отозвать членство: `revoke pi_worker_executor from authenticator;`.
