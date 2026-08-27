# RemHaOS Integration Gateway Execution Report

Дата: 2026-08-27 (обновлено)

## Scope

Выполнен автономный кодовый контур OWNER GO для PR3 File Intake, PR4 Telegram staging, PR5 Integrations UI/API и PR6 Google Drive staging. Production rollout, credential registration, deploy и commit/push не выполнялись.

Сводный воспроизводимый набор команд, commit/branch, environment и explicit
negative evidence: [REMHAOS_INTEGRATION_EVIDENCE_MANIFEST_2026-08-26.md](./REMHAOS_INTEGRATION_EVIDENCE_MANIFEST_2026-08-26.md).

## Реализовано

- PR3: private quarantine, checksum/scan/review/publish state machine, request-bound routes with same-origin mutation protection, bounded strict review JSON, bounded multipart request admission before body parsing including chunked overflow cancellation, storage-side checksum verification against uploaded bytes, signed download authorization и replay-safe publish after the internal copy is already committed. Worker-owned quarantine ingest для PR6 вынесен в отдельные worker-only RPC и не использует human actor.
- PR2 compatibility hardening: project-link mutation routes также защищены same-origin проверкой; malformed and chunked-over-limit mutation bodies получают bounded validation responses.
- PR4: private Telegram bindings, durable update/candidate/job tables, chat migration audit, worker-only ingestion RPC, lease fencing, quarantine metadata и manual review. Quarantine object keys теперь канонически привязаны к organization/project/checksum/source-role через worker validation и additive DB trigger guard. HTTP webhook не подтверждает enqueue без worker transport и возвращает retryable `503`.
- PR5: provider/settings с безопасным connection usage/status projection без provider metadata и connect/disconnect controls, project connections с subset capabilities, manual selected-object sync request и bind/unbind controls, team-only read projection для source reviewers, unified project inbox с allowlisted provenance, human-selected target kind и import-candidate review controls, strict JSON mutation schemas без browser authority fields, canonical routes, RU copy и hidden client projections. Additive authenticated-read projection теперь скрывает у client sources/evidence/history/pricing/exact refs/M4 data, у builder оставляет только scoped execution material, а provider catalog/OAuth settings остаются owner-only.
- PR5/PR6 route hardening: organization provider settings, provider catalog и OAuth connect-intent теперь требуют server-derived Organization Owner capability; non-owner regression возвращает `403 forbidden` до provider transport.
- PR6: default-off Google Drive provider, `drive.file` allowlist, explicit selected-object/revision contract, selected PDF import orchestration through worker-owned quarantine/scan/candidate ports, selected-object metadata and downloaded-byte consistency checks, safe allowlisted candidate provenance projection, S256 PKCE/state/token-response protocol tests, bounded streamed token-response parsing with fatal UTF-8 handling, replay-safe OAuth intent RPC, bounded provider webhook stream with empty-body support, private hash-only webhook/channel/notification lifecycle with dedupe, revision supersession for open candidates, worker-only `reauth_required` transition that fences channels/jobs, disconnect stop trigger и Postgres/Storage adapter boundaries. OAuth cancellation now consumes its server-side PKCE verifier immediately after the intent is consumed. Connect-intent additionally rejects unsupported providers and non-allowlisted scopes before the external boundary. Secure credential vault, Picker/provider transport и external staging не подключены.
- PR4 boundary hardening: bounded Telegram webhook stream with fatal UTF-8 decoding and cancellation on overflow; generic provider webhook stream is bounded and does not require JSON, so Drive push notifications cannot trigger an unbounded body read.

Флаги по умолчанию выключены в `.env.example`: `REMHAOS_INTEGRATIONS_ENABLED`, `REMHAOS_TELEGRAM_BRIDGE_ENABLED`, `REMHAOS_TELEGRAM_WORKER_ENABLED`, `REMHAOS_GOOGLE_DRIVE_ENABLED`.

## Локальные quality gates

- `npm run lint`: PASS, 0 errors, 9 существующих warnings.
- `npm run typecheck`: PASS.
- `npm run test`: PASS, 94 test files / 502 tests.
- `env NPM_CONFIG_CACHE=/private/tmp/npm-cache-impeccable npx --yes impeccable detect`: PASS.
- `NEXT_DIST_DIR=.next.nosync npm run build`: PASS, including TypeScript, static generation and route optimization.

После явного ограничения `compilerOptions.types` до реально используемых
`node/react/react-dom` текущий checkout повторно прошёл `npm run typecheck` и
полный isolated build; случайное сканирование транзитивных `@types` больше не
задерживает quality gate.

Targeted Google Drive OAuth protocol/flow tests: `12/12`; channel-worker/import-worker/webhook tests: `3/4/4`; registry JSON + Project Links regression run: `2 files / 6 tests` (Project Links `4/4`); PR3 storage boundary tests: `5/5`; PR3 chunked multipart boundary run: `2 files / 5 tests`; direct Integration Gateway handler early-path run: `1 file / 7 tests`; role-safe projection/UI run: `3 files / 19 tests`; full suite includes the provider/scope admission, owner-only provider/OAuth boundary, stream boundary, handler error-redaction, token-response bound and OAuth cancellation/activation cleanup assertions.
Runtime smoke на локальном dev server: provider list и File Intake без валидной project/session boundary возвращают `404`; Telegram и Drive webhook на неправильный GET method возвращают `405`; dashboard Connections/Inbox возвращают ожидаемый auth redirect `307`.

Отдельно выполнен local authenticated browser smoke на production-like `next start`
runtime `http://127.0.0.1:3110` против свежего disposable Supabase-профиля: participant
entry page отрисован, четыре независимых Chrome-профиля прошли password login и
получили ожидаемые actor roles `owner`, `architect`, `builder`, `client`; workspace
API у каждого вернул `200`; owner открыл Settings → Integrations и Project →
Connections, а прямые client-запросы к command, connections и import candidates
вернули `403 forbidden`. Это подтверждает локальный auth/UI/scoped-command slice и
не заменяет требуемый внешний authenticated five-role staging gate.

Acceptance harness дополнен пятым независимым profile для M2 Designer. По ADR-0004
он остаётся отдельной публичной workspace-сессией, но server-derived actor в текущем
legacy compatibility contract ожидаемо имеет роль `architect`; отдельная DB-role
`designer` не добавлялась. После подключения matching local disposable Supabase
client configuration расширенный запуск получил PASS: пять независимых Chrome
профилей для Owner, M1 Client, M2 Designer, M3 Architect и M4 Builder; workspace API
`200` для каждого; owner Integrations/Project Connections UI; reviewer candidate
reads `200`; client command, connections и import-candidate requests `403 forbidden`.
Evidence summary и screenshots: `/private/tmp/remhaos-gateway-browser-evidence-five-debug3`.
Это local acceptance evidence и не заменяет внешний authenticated staging gate.

Повторная попытка на текущем runtime `http://127.0.0.1:3110` 2026-08-27 не дошла
до login: runtime был подключён к другой local Supabase configuration. Это не
заменяет matching disposable five-role PASS, зафиксированный выше, и не изменяет
его evidence.

## DB gate

`npm run test:db-integration-gateway` повторно пройден после миграции role projection на PostgreSQL 16 и 17 через native Docker socket внутри disposable Colima VM (host-side Docker socket forwarding остаётся зависающим).
Подтверждены маркеры `DBIG_SCHEMA_SECURITY_OK`, `DBIG_REGISTRY_OPERATIONS_OK`, `DBIG_PROJECT_LINKS_OK`, `DBIG_FILE_INTAKE_OK`, `DBIG_TELEGRAM_STAGING_OK`, `DBIG_GOOGLE_DRIVE_STAGING_OK`, `DBIG_CONCURRENCY_OK`, `DBIG_RESTART_REPLAY_OK` и `DBIG_INTEGRATION_GATEWAY_HARNESS_OK`. В ходе recovery были исправлены только acceptance fixtures: private-table assertion под запрещённой ролью, private helper под `authenticated`, нестабильный replay timestamp и межфайловая переменная connection ID. Production schema/ACL не ослаблялись.
В `DBIG_REGISTRY_OPERATIONS_OK` также входит human manual-sync request с `manual_selected_object_sync`, worker completion и idempotent replay; `DBIG_FILE_INTAKE_OK` дополнительно проверяет повтор publish после статуса `published_internal_copy` и worker-only create/upload/scan path; `DBIG_TELEGRAM_STAGING_OK` включает прямой-RPC negative для неканонического quarantine key и валидный content-addressed attachment; полный аккаунт не сканируется. Этот повтор покрывает текущую chain, включая role-projection migration.

Дополнительно поднят отдельный disposable Supabase-профиль `remhaos-integration-gate` на
PostgreSQL 17.6 с текущей миграционной цепочкой, без reset существующего AP1-профиля.
На нём read-only runtime/DB checks дали `AP1_RUNTIME_OK`, `AP1_DB_OK` и
`AP1_MIGRATION_LEDGER_OK count=31`; разрешены пять API-схем, пять private-схем
закрыты через Data API, Auth/Storage health положительный, private bucket и executor
role guards положительные. В том же свежем профиле прямой DBIG fixture run повторно
дал registry, Project Links, File Intake, Telegram, Google Drive, concurrency и
restart/replay markers. Это усиливает local PG17 evidence, но не заменяет
authenticated browser, внешний provider или production gate.

Отдельный upgrade gate `npm run test:db-integration-gateway-upgrade` также пройден на PostgreSQL 16 и 17: в disposable базе сначала применялась только pre-PR migration chain и заполнялись существующие project/workflow rows, затем применялись все Integration Gateway migrations. Проверены маркеры `DBIG_UPGRADE_PRE_PR_STATE_OK`, `DBIG_UPGRADE_POST_PR_STATE_OK` и полный набор DBIG security/operations/concurrency/restart markers. Это закрывает upgrade proof для populated pre-PR state; production database не использовалась.

### Additive role-projection delta

Новая migration `20260826059000_projectceo_published_role_projection.sql` не переписывает старый timestamped read contract: историческая функция переименована во внутренний `get_project_workspace_read_unfiltered`, а authenticated wrapper server-side выводит роль из membership и применяет published projection. Client получает только собственные distributed package versions, approved decisions/selections без evidence/history/price/source/exact refs и без M4 execution; builder получает только package-scoped published version/artifact и M4 execution material. Owner/architect сохраняют полный рабочий read projection.

Для client decision/selection projection exact revisions читаются напрямую из immutable `claim_revision_descriptors` и `graph_node_revisions`, поэтому опубликованный DB4 decision не теряется после появления более новой текущей DB5 revision. Поля остаются allowlisted; private evidence, history, pricing, sources и exact refs не возвращаются.

Добавлены AP1 SQL assertions для client read и static/UI regression tests. Migration и helper были применены внутри транзакции на локальном Supabase PostgreSQL 17.6; runtime helper smoke завершился `DO` + `ROLLBACK`, проверив нулевые sources, M4, source stats, price observation и exact refs. Затем полный AP1 wrapper/read harness прошёл на PostgreSQL 16 и 17, включая client package read, immutable published decision, restart/replay и concurrency assertions.

Rollback strategy зафиксирована в [REMHAOS_INTEGRATION_ROLLBACK_RUNBOOK.md](./REMHAOS_INTEGRATION_ROLLBACK_RUNBOOK.md): flag-off и остановка конкретного worker, без destructive down-migration или удаления candidates/jobs, затем additive forward-fix. Flag-off runtime smoke и forward-fix DB replay проверены в disposable окружении; production rollback не выполнялся.

Существующие AP1 read acceptance checks также пройдены на PostgreSQL 16 и 17 через disposable Docker socket: `AP1_READ_SCHEMA_SECURITY_OK`, `AP1_INVENTORY_DUPLICATE_GROUPS_OK`, `AP1_AUTHENTICATED_READ_OK`, `AP1_M4_REQUEST_BOUND_REPLAY_OK`, `AP1_READ_CONCURRENCY_OK`, `AP1_RESTART_READ_OK` и `AP1_AUTHENTICATED_READ_HARNESS_OK`. В этот прогон входит новая client role projection migration; SQL harness повторён без ослабления acceptance assertions.

Существующие DB4 и DB5 compatibility/restart/concurrency harnesses пройдены на PostgreSQL 16 и 17. В acceptance fixtures добавлены только пять AP1 существующих RPC-сигнатур DB5 и две DB4, которые были добавлены предыдущим AP1 scope и отсутствовали в устаревших expected counts; Integration Gateway ACL не ослаблялись.

Полный DB2 baseline/security/rollback/concurrency/restart harness также пройден на PostgreSQL 16 и 17: `LEGACY_BASELINE_ASSERTIONS_OK`, `LEGACY_BASELINE_REAPPLY_GUARD_OK`, `DB2_SCHEMA_ASSERTIONS_OK`, `DB2_CANONICAL_JSON_ASSERTIONS_OK`, `DB2_SEED_AND_SEQUENTIAL_OPERATIONS_OK`, `DB2_SECURITY_ROLLBACK_AND_ISOLATION_OK`, `DB2_SNAPSHOT_EVIDENCE_HANDOFF_IMMUTABILITY_OK`, `DB2_P1_SECURITY_REGION_GOLDEN_OK`, `DB2_CONCURRENCY_AND_RESTART_OK` и `DB2_HARNESS_OK`.

## External staging gates

- Telegram: `BLOCKED_EXTERNAL_CREDENTIALS` и отсутствует подключённый worker transport для реального webhook-to-queue proof.
- Google Drive: `BLOCKED_EXTERNAL_CREDENTIALS`; отсутствуют staging OAuth client/test account/public callback, согласованный secret store (Vault extension отсутствует в disposable profile), Picker/provider transport и external evidence. T6.3–T6.6 имеют policy/orchestration/adapter boundary, но реальный OAuth exchange, Picker/download, selected-object import, webhook reorder/dedupe и reauth не выдаются за пройденные; T6.7 staging E2E не запускался.
- Authenticated five-role browser QA на рабочем authenticated staging и production adoption gate требуют отдельного controlled staging run.

На 2026-08-27 local route regression дополнительно подтвердил, что provider catalog
и OAuth connect-intent недоступны authenticated non-owner (`403 forbidden`).

## Acceptance status

- Local PR3 File Intake, PR4 Telegram staging data plane, PR5 UI/API projection и PR6 Google Drive policy/orchestration contour: `PASS` по коду, unit/static tests, текущим AP1/DBIG assertions и default-off runtime boundaries.
- PG16/PG17 clean bootstrap, populated pre-PR upgrade, migration replay, concurrency и restart replay: `PASS` на disposable harness, включая новую role-projection migration; это не evidence миграции на реальной production базе.
- Реальный Telegram webhook-to-queue и Google Drive OAuth/Picker/download/webhook staging: `BLOCKED_EXTERNAL_CREDENTIALS` до появления непроизводственных credentials, callback/worker transport и тестового аккаунта.
- Local authenticated browser smoke: `PASS` для participant entry, owner Settings/Connections UI, пяти независимых sessions (Owner, M1 Client, M2 Designer, M3 Architect, M4 Builder) и client API denials на matching disposable Supabase; M2 Designer и M3 Architect server-derived actor остаются `architect` по ADR-0004. Внешний staging evidence не подменяется этим результатом.
- Пять отдельных authenticated browser sessions и реальный Drive PDF E2E до human review/internal publication: `BLOCKED_EXTERNAL_STAGING`; local role fixtures не считаются заменой этого gate.
- Production adoption: `NOT_RUN` и должен оставаться отдельным контролируемым gate.

## Read-only provider protocol verification

- Google OAuth web-server contract, exact redirect URI and token exchange: [Google for Developers OAuth 2.0 web-server documentation](https://developers.google.com/identity/protocols/oauth2/web-server).
- Drive change notifications and `files.watch` scope support: [Google Drive push notifications documentation](https://developers.google.com/workspace/drive/api/guides/push) and [Drive `files.watch` reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/watch).
- Telegram webhook `secret_token` header contract: [Telegram Bot API](https://core.telegram.org/bots/api).

Проверка была read-only; provider credentials, callback exchange и external API requests не выполнялись.

## Migration ledger

- `20260826023906_remhaos_file_intake_hardening.sql`: `54d1dbe3e8211d3424e18180799a06d79b51dd078113405b3bf2c75aa9b49702`
- `20260826030233_remhaos_telegram_staging.sql`: `155029ac09f06526d88ddf14a38a860613316afcc7e9c930aaa0e75b7667ab34`
- `20260826034120_remhaos_google_drive_staging.sql`: `b275c1f13f3b31c2994ba1f151cb2aa809cc1cf72ed3b4f14f18ec6ed52ce736`
- `20260826042000_remhaos_google_drive_webhook_operations.sql`: `fcddbd809097f046f7849769bc555e79fed2222ba52633f4d25895d1ca7716a3`
- `20260826043000_remhaos_external_revision_supersession.sql`: `2300a9b5c869e0d9e2cb12a5a672db1a4516c78bf350f0b8fae776be79a25172`
- `20260826044000_remhaos_google_drive_reauth_transition.sql`: `16ef141460c96364431b9dffa32670ed2a2ba2d62d1eb60b69a97ee804dee759`
- `20260826050000_remhaos_integration_ui_read_projections.sql`: `16ff70d41788d1eff8bb8f6d5d646b8eb800a021bc3dfb9d107aa780052487b8`
- `20260826051000_remhaos_manual_sync_request.sql`: `71736ad4542db88cfcd53ca8279243eeda6862b4052e2c543d699824af218a38`
- `20260826053000_remhaos_safe_import_candidate_projection.sql`: `2469ad38b63f69cd6daccedd4f72b11a890c252fddb81f38e0d36efcb55694f6`
- `20260826054000_remhaos_safe_connection_projection.sql`: `d5fca20fb215d04d57e9e57275538eab6bb30371cbe5597af9d67d1e7ea782ea`
- `20260826055000_remhaos_import_candidate_target_review.sql`: `94a885d922227d777c4424d5de47d5fb60a6c7761096ea4560be3c9bc162c0a9`
- `20260826056000_remhaos_file_intake_publish_replay.sql`: `9fd5c20cf11bc308deb2270ea03232c12a73eb886f49a27c0d418efc5c832565`
- `20260826057000_remhaos_telegram_quarantine_key_guard.sql`: `d5f7ef6bc81712b0e3d5e53e5a72101d3db28f22fdcdc0a79f8bc2e551b9ef3b`
- `20260826058000_remhaos_file_intake_worker_ingest.sql`: `f8dc92854da3744fa043eb7b2f8144ea1523b54506765dbc9b9f3dd550e8a095`
- `20260826059000_projectceo_published_role_projection.sql`: `44c4fd5ed728f778056f2e7d6df8cdc8170a29f76ed857c7c1e0cb62d18fd690`

## Next controlled gate

Provide non-production Telegram and Google Drive staging credentials/callbacks, worker transport and test account, then run the authenticated external browser/provider scenarios. Keep all rollout flags off until external evidence artifacts exist; production adoption remains a separate controlled gate.
