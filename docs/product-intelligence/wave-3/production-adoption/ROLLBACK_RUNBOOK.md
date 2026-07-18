# ProjectCEO RU — Production Rollback Runbook

Дата подготовки: 17 июля 2026 года

```text
RUNBOOK_STATUS=PREPARED_NOT_EXECUTED
PRODUCTION_APPLIED=false
DESTRUCTIVE_COMMANDS_EXECUTED=false
```

## 1. Назначение

Runbook применяется только после отдельно одобренного production adoption.
Сейчас он является планом реагирования: никакие команды из него не выполнялись.

Приоритет rollback:

1. остановить новые mutations;
2. сохранить evidence и append-only audit;
3. выбрать наименее разрушительный recovery path;
4. проверить database, authorization, Storage и application вместе;
5. открыть traffic только после письменного go.

Связанные документы:

- [Production Adoption Plan](./PRODUCTION_ADOPTION_PLAN.md)
- [Production Gap Register](./PRODUCTION_GAP_REGISTER.md)
- [Adoption Checklist](./ADOPTION_CHECKLIST.md)

## 2. Триггеры

Rollback commander активирует runbook при одном или нескольких событиях:

- unexpected schema или migration-ledger drift;
- migration failure или partial application;
- cross-organization/project/package data exposure;
- human operation выполнена через service role;
- invitation/guest token bypass, replay или leak;
- потеря append-only audit/command history;
- concurrency/idempotency приводит к duplicate или inconsistent state;
- release/version/handoff hash mismatch;
- резкий рост 5xx, DB locks, saturation или worker failures;
- Storage unauthorized access, overwrite или orphan spike;
- secret попал в browser/log либо rotation нарушила активные grants;
- application release несовместим с adopted schema.

Security exposure, cross-tenant read/write и потеря audit имеют severity
**critical** и не ждут подтверждения бизнес-метрик: traffic блокируется сразу
назначенным incident owner.

## 3. Первые 15 минут

### 3.1 Остановить traffic и mutations

- включить заранее проверенный ProjectCEO kill switch/maintenance mode;
- остановить новые deploys и migration operators;
- отключить worker scheduling и retries;
- сохранить текущие deployment IDs, commit SHA и timestamps;
- не удалять rows, objects, logs и failed commands.

### 3.2 Отозвать EXECUTE

Если application kill switch не гарантирует остановку RPC, DB owner применяет
заранее reviewed emergency grant change:

```sql
-- TEMPLATE ONLY — DO NOT EXECUTE WITHOUT INCIDENT APPROVAL.
begin;
revoke execute on all functions in schema projectceo_api
  from anon, authenticated, service_role;
revoke execute on all functions in schema project_intelligence_api
  from anon, authenticated, service_role;
commit;
```

Перед применением должен существовать экспорт точных pre-incident grants и
готовый reviewed re-grant script. Нельзя отзывать/возвращать права «по памяти».
NOLOGIN executor roles не превращаются в login/runtime roles.

### 3.3 Зафиксировать evidence

Сохранить в защищённый incident location:

- UTC incident start и операторов;
- production commit/deployment IDs и environment version;
- remote migration ledger;
- schema/grants/policies/functions/triggers snapshot;
- ProjectCEO audit log и command log;
- affected organization/project/package/version IDs;
- Auth events и AMR без raw tokens;
- Storage object inventory и signed-URL events;
- application, Vercel, Supabase и worker logs;
- DB locks, active transactions и error samples;
- backup/PITR availability и earliest safe recovery point.

Не помещать raw token, service key, original production filename или PII в
общедоступный incident document.

## 4. Выбор recovery path

Rollback commander, DB owner, security owner и product owner выбирают один путь.

### Path A — application-only rollback

Выбрать, если database schema и data корректны, adopted migrations
backward-compatible, а дефект находится только в application release.

1. оставить ProjectCEO mutations закрытыми;
2. redeploy последний совместимый application build;
3. не менять migration history;
4. выполнить read-only schema/ledger/RLS checks;
5. выполнить controlled smoke;
6. открыть ограниченный traffic только после sign-off.

### Path B — additive forward-fix

Выбрать, если причина точно локализована, fix не разрушает данные, не переписывает
timestamped migration и сохраняет immutable/append-only contract.

1. создать новую timestamped additive migration;
2. выполнить security/design review;
3. прогнать clean PG16/PG17 и свежий production clone;
4. доказать idempotency/concurrency и rollback alternative;
5. применить только в новом одобренном change window.

Forward-fix не используется для сокрытия неизвестной corruption или data leak.

### Path C — reviewed down-migration

Допускается только когда:

- существует заранее проверенная обратная операция;
- все затрагиваемые rows/audit/object references экспортированы;
- irreversible data loss исключена или явно одобрена владельцем данных;
- downgrade не нарушает source provenance, immutable versions и append-only audit;
- предыдущая application version совместима с результатом.

Спонтанный `DROP`, `TRUNCATE`, массовый `DELETE` или переписывание migration files
запрещены.

### Path D — backup/PITR restore

Выбрать при corruption, неизвестной partial state, множественных
несогласованных таблицах либо невозможности доказать безопасный forward/down path.

1. определить safe recovery point до первого опасного write;
2. зафиксировать ожидаемый data-loss window относительно RPO;
3. остановить весь затрагиваемый traffic;
4. восстановить сначала в isolated validation project, если incident позволяет;
5. проверить schema, ledger, auth, audit и business invariants;
6. отдельно восстановить/сверить Storage objects;
7. переключать production только по explicit restore approval.

Database restore вызывает downtime. Database backup не содержит сами Storage
objects, поэтому DB restore без object reconciliation не является полным
rollback. См. [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups).

## 5. Особый случай: неверный history repair

Если baseline timestamp был ошибочно отмечен applied, но baseline SQL не
выполнялся:

1. остановить дальнейший migration push;
2. сохранить ledger и schema fingerprint;
3. доказать, какие DDL реально присутствуют;
4. не запускать baseline SQL «для выравнивания»;
5. выбрать history-repair reversal только после DB/security review;
6. повторно получить fingerprint и migration plan.

History repair изменяет ledger, а не schema. Его reversal также является
production write и требует отдельного human approval.

Если baseline SQL был ошибочно запущен на legacy production, incident сразу
переходит в critical; дальнейшие действия определяются по фактической partial
state и backup/PITR, а не предполагаемой идемпотентности.

## 6. Audit export

До destructive recovery необходимо экспортировать:

- `supabase_migrations.schema_migrations`;
- Foundation audit/command records;
- Project Intelligence audit/command records;
- invitation and guest-grant lifecycle без raw token;
- version/release/handoff hashes и exact revision links;
- affected object metadata;
- immutable source references;
- actor/organization/project/package scope.

Экспорт получает checksum, UTC timestamp, responsible operator и restricted
retention policy. Audit export не редактируется для «исправления» incident
history.

## 7. Storage orphan reconciliation

DB и Storage восстанавливаются как две связанные, но разные системы.

### 7.1 Снять два inventory

- DB-side file/object metadata;
- bucket-side object listing с object key, size, checksum/etag и timestamp.

### 7.2 Классифицировать

1. **Object + DB record:** проверить checksum и scope.
2. **Object without DB record:** orphan object; закрыть выдачу URL, поместить в
   quarantine list.
3. **DB record without object:** missing object; восстановить из object backup
   либо пометить недоступным без удаления audit.
4. **Mismatch:** object key/checksum/size расходятся; считать security/data
   integrity incident до объяснения.

### 7.3 Действия

- не удалять orphan автоматически;
- не создавать фиктивный DB record без provenance;
- deletion допускается только после retention window и owner approval;
- восстановленный object получает прежний immutable reference либо новую
  revision с явной связью, но не молчаливую подмену;
- после reconciliation повторить signed URL и access-scope tests.

## 8. Verification после recovery

Все проверки должны быть зелёными:

- server version, extensions и expected schema fingerprint;
- exact migration ledger и file hashes;
- constraints, composite FK, triggers, indexes, grants и policies;
- RLS owner/architect/builder/guest и cross-tenant denial;
- NOLOGIN executor roles и runtime grants;
- authenticated human vs service worker separation;
- invitation confirmed-email/AMR/replay/expiration/revocation;
- immutable versions, exact evidence/revisions и append-only audit;
- concurrency/idempotency/command replay;
- Storage private bucket, no-overwrite, URL TTL и orphan delta zero/explained;
- application build совместим с recovered DB;
- monitoring и kill switch работоспособны;
- controlled smoke прошёл без реальных клиентских данных.

## 9. Re-open criteria

Traffic нельзя открыть, пока:

- root cause не записана;
- affected scope и data exposure определены;
- recovery evidence и checksums сохранены;
- все critical/high findings закрыты либо risk acceptance подписан;
- rollback commander подтвердил повторную остановку;
- DB, security, application, QA и product owners подписали reopen;
- monitoring observation window назначен.

Итоговый status до реального одобренного выполнения остаётся:

```text
PRODUCTION_APPLIED=false
```
