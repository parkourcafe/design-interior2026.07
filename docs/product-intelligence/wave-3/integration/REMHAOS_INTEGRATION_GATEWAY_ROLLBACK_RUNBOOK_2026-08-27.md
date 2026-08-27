# RemHaOS Integration Gateway Rollback Runbook

This runbook applies only to the Integration Gateway branch and staging. It does not authorize production changes, AP6, Tashkent, M4 V2/V3, or Cycle 7 operations.

## Default immediate stop

1. Keep `REMHAOS_INTEGRATIONS_ENABLED=false`, `REMHAOS_PROJECT_LINKS_ENABLED=false`, `REMHAOS_FILE_INTAKE_ENABLED=false`, `REMHAOS_TELEGRAM_BRIDGE_ENABLED=false`, `REMHAOS_TELEGRAM_WORKER_ENABLED=false`, and `REMHAOS_GOOGLE_DRIVE_ENABLED=false`.
2. Keep `REMHAOS_WORKER_TRANSPORT=disabled`, `REMHAOS_SECRET_STORE_ADAPTER=fail_closed`, and `REMHAOS_FILE_SCANNER_ADAPTER=fail_closed` unless a separately approved staging gate changes them.
3. Stop the staging worker process. Do not use a human/browser route with a service-role credential.
4. Do not delete database rows as a rollback. The transport migration is additive and has no destructive down migration.

## Provider cleanup

### Google Drive

1. Stop accepting new OAuth intents and selected-object imports by leaving gateway flags off.
2. In the server-only worker, list active channels through the worker-only RPC `list_google_drive_webhook_channels`.
3. For each channel, read the opaque channel reference from the selected SecretStore and call Google `channels.stop` with the raw provider channel/resource values. Never put those values in logs or ordinary tables.
4. Mark the logical channel stopped with the idempotent worker command and delete the opaque SecretStore entry after provider stop succeeds.
5. Revoke the Google credential only through the server-side revoke path. If provider revoke fails, retain `reauth_required`/`not_revoked` evidence and retry from the worker; do not silently claim revocation.

### Telegram

1. Remove the Telegram webhook from the staging bot configuration.
2. Stop the worker after queued jobs are drained or explicitly cancelled.
3. Keep quarantined files and candidates subject to the selected staging retention policy; do not publish a candidate automatically.

## Database and code rollback

1. Capture the current branch, commit, migration ledger, and staging job/channel status.
2. Disable transports and stop workers first.
3. If the code must be reverted before merge, switch the staging checkout to the last approved checkpoint `e70695395b7c40099f5e3223b823ebdabac167c9` or an explicitly selected successor. Do not reset the shared dirty worktree.
4. Keep `20260827010000_remhaos_integration_gateway_transport.sql` applied. Its objects are additive; removing them would break compatibility with already-applied gateway migrations and audit history.
5. Apply a forward corrective migration only after owner/database review. Re-run DBIG clean bootstrap, populated upgrade, concurrency, restart/replay, and compatibility gates before re-enabling any staging flag.

## SecretStore and credential handling

- Never copy provider tokens into Git, fixtures, browser local storage, SQL business tables, or command output.
- If a staging SecretStore is unavailable, fail closed and leave the worker disabled.
- Rotate staging credentials after a failed or interrupted external run according to the selected SecretStore policy.
- The local memory adapter is disposable and non-durable; it is not a rollback target for staging.

## Recovery checks

Before any staging re-enable, confirm:

- provider channels are stopped or their expiration is bounded;
- disconnected connections have no queued, leased, or retryable jobs;
- no raw provider identifiers or tokens appear in logs or DB projections;
- checksum, quarantine, scan, candidate, and human-review transitions remain intact;
- DBIG PG16/PG17 and populated upgrade gates pass;
- five independent authenticated browser sessions pass on an approved browser runner;
- owner has supplied external provider evidence and has not treated local mocks as full acceptance.
