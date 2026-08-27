# RemHaOS Integration Gateway — rollback runbook

Дата: 2026-08-26

## Принцип

Integration Gateway не использует destructive down-migrations для rollback. Старые
timestamped migrations остаются неизменными. Откат запускается через отключение
конкретного rollout flag и остановку соответствующего worker, после чего исправление
выпускается только additive migration/code forward-fix.

## Flag-off procedure

1. Отключить affected provider flag:
   `REMHAOS_GOOGLE_DRIVE_ENABLED`, `REMHAOS_TELEGRAM_BRIDGE_ENABLED`,
   `REMHAOS_TELEGRAM_WORKER_ENABLED`, `REMHAOS_FILE_INTAKE_ENABLED` или
   `REMHAOS_PROJECT_LINKS_ENABLED`.
2. Если отключается весь контур, отключить также `REMHAOS_INTEGRATIONS_ENABLED`.
3. Остановить только соответствующий worker и запретить новые redrive/claim
   операции. Уже сохранённые candidates/jobs не удалять и не переписывать.
4. Перезапустить application/worker processes с тем же private database и storage.
   При выключенном flag HTTP surface остаётся закрытой (`404`); provider webhook
   не должен подтверждать enqueue без активного worker transport.
5. Сохранить audit/операционные логи без provider body, токенов, raw filenames и
   signed URLs. Credential revoke выполняется только отдельной provider-операцией,
   не как побочный эффект flag-off.

## Forward-fix procedure

1. Зафиксировать failure mode и affected operation, не изменяя старую migration.
2. Добавить новую timestamped migration только для additive constraint/function/index
   или безопасного состояния; сохранить SHA-256 в migration ledger.
3. Исправить request/worker code с сохранением idempotency, lease fencing,
   server-derived scope и default-off flags.
4. Прогнать quality gates и DB harness на PG16/PG17:

   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   npm run test:db-integration-gateway
   npm run test:db-integration-gateway-upgrade
   PI_DB_IMAGE=postgres:17-alpine npm run test:db-integration-gateway
   PI_DB_IMAGE=postgres:17-alpine npm run test:db-integration-gateway-upgrade
   ```

5. Повторно включать staging flag можно только после review evidence; production
   включение требует отдельного `OWNER PRODUCTION GO`.

## Current rehearsal evidence

В текущем worktree проверены clean bootstrap, populated pre-PR upgrade, migration
replay, concurrency и restart replay на PostgreSQL 16/17. Локальный flag-off smoke
подтвердил `health=200`, provider/file-intake closed surfaces `404` и auth redirect
`307`; production database, credentials и provider revoke не затрагивались.
