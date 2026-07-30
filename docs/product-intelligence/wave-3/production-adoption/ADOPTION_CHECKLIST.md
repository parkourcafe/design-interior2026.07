# ProjectCEO RU — Production Adoption Checklist

Дата создания: 17 июля 2026 года
Обновлено: 18 июля 2026 года

```text
ACCEPTED_SOURCE_COMMIT=a8c86a81b7305210b71e1d790fcefa11e5920571
FINAL_RELEASE_CANDIDATE=unset
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
REMOTE_WRITES_AUTHORIZED=false
```

Этот checklist не является командой на применение. Пустой checkbox означает
реально незавершённый gate. Нельзя заполнять его на основании mock UI, fixtures,
устного подтверждения или старого production snapshot.

Связанные документы:

- [Production Adoption Plan](./PRODUCTION_ADOPTION_PLAN.md)
- [Rollback Runbook](./ROLLBACK_RUNBOOK.md)
- [Production Gap Register](./PRODUCTION_GAP_REGISTER.md)

## 1. Scope и release candidate

- [ ] Adoption scope явно выбран:
  - [ ] Foundation schema only, без application traffic; или
  - [ ] ProjectCEO pilot application после закрытия всех M2–M4/app blockers.
- [ ] Release candidate указывает на immutable commit/tag: `________________`.
- [ ] Commit соответствует review source либо plan обновлён под новый commit.
- [ ] Worktree release candidate не содержит untracked migration files.
- [ ] Никакие миграции за пределами exact accepted ledger не включены.
- [ ] `npm run release:check` зелёный на release candidate.
- [ ] Gate 0, Foundation и UI reports перечитаны после последнего commit.
- [ ] [Production Gap Register](./PRODUCTION_GAP_REGISTER.md) не содержит
  незакрытых blockers для выбранного scope.

Ответственный: `________________`
Дата/UTC: `________________`
Evidence link: `________________`

## 2. Source integrity

Accepted migration hashes на `a8c86a8`:

- [ ] baseline:
  `12aa89db579f7608d7cb3df71e9927ae904734cb9d92b97b640766cf0607c016`
- [ ] PI core:
  `9315a5a547b12aac2c624da3ebb97753994dd15d6528ce85cd430d290a0a6aa5`
- [ ] PI operations:
  `a95b9681b8da98f3b99196ec0ab05b0631ab36741efaa1262fc1ea40f8cf6890`
- [ ] Foundation access:
  `aeed70c70e0177c27175e57869336317adb5b1959ad98a05aae3d84364818dff`
- [ ] Foundation ingestion/read:
  `c238da289d2e3028d681f74f51d8142ca089cf22d3de8b099e686367a0259755`
- [ ] Foundation hardening:
  `381895710430f04b4876001ca00bd6cde79093cf31e9bbbe0f20157fa47e4468`
- [ ] M2/M3 persistence:
  `a424fa6c25eb7523b7a7b0c6bf3d7c4b9981704cb47230cf511802d62576435e`
- [ ] M2/M3 operations:
  `8be290cbb13dcd9099157469cd9faa263a6fb9f5dacfaed1e8e405e2fd639869`
- [ ] M2/M3 relational hardening:
  `1ac21fcc9131a9d99cfdb918ec80c27f547153b286b62ef210cdd847442394c3`
- [ ] M4 persistence:
  `78f30156d2ab3558c6f444400e9c559e6ee6de1a4bf0f66c656e54042df2d2f7`
- [ ] M4 operations:
  `67157f76d30304b993881715827daad0f3e295f8b248e819bb15fa0fabc9c7a4`
- [ ] Final RC `.env.example` SHA-256: `________________`
- [ ] Final RC `.vercelignore` SHA-256: `________________`
- [ ] Final RC `next.config.mjs` SHA-256: `________________`
- [ ] Final RC `package.json` SHA-256: `________________`
- [ ] Final RC application artifact SHA-256: `________________`

Проверил: `________________`
Дата/UTC: `________________`
Hash output location: `________________`

## 3. Fresh production snapshot

- [ ] Получен новый read-only snapshot.
- [ ] UTC capture time: `________________`.
- [ ] PostgreSQL version/extensions сохранены.
- [ ] Relations/columns/constraints/indexes/functions/triggers/enums сохранены.
- [ ] Policies/table grants/schema grants/roles сохранены.
- [ ] `supabase_migrations.schema_migrations` сохранён.
- [ ] Storage buckets/object metadata сохранены.
- [ ] Source attachment SHA-256: `________________`.
- [ ] Normalized JSON SHA-256: `________________`.
- [ ] Snapshot сравнен с observation от 2026-07-16.
- [ ] Неизвестный drift отсутствует либо plan/ledger обновлены и заново одобрены.

DB reviewer: `________________`
Security reviewer: `________________`
Evidence link: `________________`

## 4. Backup и recovery readiness

- [ ] Platform backup/PITR доступен и timestamp записан.
- [ ] Logical roles dump создан и checksum сохранён.
- [ ] Logical schema dump создан и checksum сохранён.
- [ ] Logical data dump создан и checksum сохранён.
- [ ] Storage object inventory создан отдельно от database backup.
- [ ] Storage objects сохранены/реплицированы по утверждённому contract.
- [ ] RPO: `________________`.
- [ ] RTO: `________________`.
- [ ] Ожидаемый downtime: `________________`.
- [ ] Restore rehearsal выполнен в isolated environment.
- [ ] Restored DB и objects прошли reconciliation.
- [ ] Rollback commander имеет проверенный доступ и контакты.

DB owner: `________________`
Storage owner: `________________`
Rollback commander: `________________`
Evidence link: `________________`

## 5. Migration rehearsal

### 5.1 Clean bootstrap

- [ ] Полный ledger прошёл на clean PG16.
- [ ] Полный ledger прошёл на clean PG17/production-equivalent patch.
- [ ] RLS зелёный.
- [ ] Concurrency зелёный.
- [ ] Idempotency зелёный.
- [ ] Rollback tests зелёные.
- [ ] Normalized projection hash:
  `ac64fa6599ed4d4e9ff1ceb53aedfb2639a969faaf430b8cc20c149312da93c1`.

### 5.2 Fresh production clone

- [ ] Fresh production backup восстановлен в isolated clone.
- [ ] Initial clone fingerprint совпал с fresh snapshot.
- [ ] Initial remote ledger доказан.
- [ ] **Baseline SQL не выполнялся.**
- [ ] Baseline timestamp `20260716071024` отмечен applied только history repair.
- [ ] После repair ledger содержит ровно один expected timestamp.
- [ ] Additive migrations 072 → 073 → 090 → 091 → 092 → 100 → 101 → 1015 → 102 → 103 применены по порядку.
- [ ] Final ledger содержит ровно одиннадцать expected timestamps для M4 RC.
- [ ] DB2/DB3/DB4/DB5 зелёные.
- [ ] RLS/concurrency/idempotency/rollback зелёные.
- [ ] Schema/grants/policies/audit diff reviewed.

Migration operator rehearsal: `________________`
DB reviewer: `________________`
Evidence link: `________________`

## 6. Identity и email

- [ ] Legacy admin auto-confirm registration удалён или изолирован от ProjectCEO.
- [ ] Human enrollment не выполняется через service role.
- [ ] Magic link ownership proof зелёный.
- [ ] OTP ownership proof зелёный.
- [ ] Confirmed email signup flow зелёный, если включён.
- [ ] Password-only session не принимает invitation.
- [ ] Wrong-email invitation отклоняется.
- [ ] Expired/revoked/replayed invitation отклоняется.
- [ ] Redirect allowlist проверен.
- [ ] SMTP sender/domain/templates проверены.
- [ ] Custom SMTP включён; built-in demo SMTP не используется для pilot traffic.
- [ ] SPF/DKIM/DMARC и From domain проверены.
- [ ] Link tracking не изменяет magic-link/OTP URLs.
- [ ] Auth email rate limits соответствуют pilot нагрузке.
- [ ] Bounce, delayed mail и resend обработаны безопасно.
- [ ] Auth/application logs не содержат raw tokens.
- [ ] WhatsApp не используется как identity proof.

Application owner: `________________`
Security owner: `________________`
QA owner: `________________`
Evidence link: `________________`

## 7. Secrets и environment

- [ ] Production Supabase URL/anon key относятся к правильному project.
- [ ] Service role key доступен только server maintenance/worker adapters.
- [ ] Service role key отсутствует в browser bundle/logs.
- [ ] `PROJECTCEO_TOKEN_SECRET` создан, минимум 32 bytes.
- [ ] Token secret хранится как sensitive production env.
- [ ] Rotation contract выбран и rehearsal выполнен.
- [ ] Active invitations/guest grants учтены в rotation.
- [ ] `PROJECTCEO_DEMO_ROLE`, `PROJECTCEO_LOCAL_FIXTURE_MODE` и
  `PROJECTCEO_LOCAL_FIXTURE_ROLE` отсутствуют в production.
- [ ] `NEXT_PUBLIC_APP_URL` и Auth redirects совпадают.
- [ ] Env change включён в новый deployment, а не старый build.
- [ ] LLM/provider secrets не изменены случайно.
- [ ] Secret scanner/artifact inspection зелёные.

Security owner: `________________`
Operations owner: `________________`
Evidence link: `________________`

## 8. Runtime roles и access

- [ ] Human RPC использует request-bound authenticated JWT.
- [ ] Actor/organization/project/package/role выводятся server-side.
- [ ] Human operations через service role отрицательно протестированы.
- [ ] Worker adapter отделён и имеет точный allowlist.
- [ ] Maintenance adapter отделён от worker/human adapters.
- [ ] NOLOGIN executor roles не имеют login credentials.
- [ ] `anon` может вызвать только разрешённый exact guest-read path.
- [ ] Owner/architect/builder/guest positive matrix зелёный.
- [ ] Cross-organization/project/package negative matrix зелёный.
- [ ] Guest grants hashed, scoped, expiring и revocable.
- [ ] Package-release binding соответствует фактически открытому scope.
- [ ] Data API exposed schemas содержат только intended ProjectCEO API schemas.
- [ ] Private Project Intelligence schemas не exposed.
- [ ] PostgREST schema cache видит exact allowed RPC.
- [ ] Широкие `GRANT ALL` не применялись; exact USAGE/EXECUTE diff reviewed.
- [ ] HTTP command surface закрывает обязательные source → approval → baseline →
  release/distribution → change/impact → evidence/handover операции либо
  application adoption явно остановлен как NO-GO.
- [ ] Exact HTTP retry replay и same-key/different-digest conflict проверены на
  request-bound JWT, а не только в unit fake client.

DB owner: `________________`
Application owner: `________________`
Security owner: `________________`
Evidence link: `________________`

## 9. Storage

- [ ] `client-uploads` private.
- [ ] Upload authorization проверяет organization/project/package scope.
- [ ] `upsert:false`.
- [ ] Object key не содержит original filename.
- [ ] Audit не содержит original filename/absolute local path.
- [ ] MIME/size constraints проверены.
- [ ] Signed URL TTL не более 900 секунд.
- [ ] Unauthorized listing/read/write отклоняются.
- [ ] Failed-upload cleanup проверен.
- [ ] DB metadata и object inventory согласованы.
- [ ] Orphan reconciliation runbook пройден.
- [ ] Guest видит только exact released artifact.

Storage owner: `________________`
Security owner: `________________`
QA owner: `________________`
Evidence link: `________________`

## 10. Application integration и browser QA

- [ ] Frozen mock adapter заменён production adapter.
- [ ] Mutation buttons выполняют реальные server routes, не local preview.
- [ ] UI role не берётся из demo env.
- [ ] Foundation enrollment/invitation/access/upload/read пройдены end-to-end.
- [ ] Если scope включает M2: Decisions/Selections/Approvals persisted end-to-end.
- [ ] Если scope включает M3: immutable baseline/package version end-to-end.
- [ ] Если scope включает M4: distribution/ack/change/impact/photo/handover end-to-end.
- [ ] Desktop browser QA зелёный.
- [ ] Mobile browser QA зелёный.
- [ ] Email link/device-switch QA зелёный.
- [ ] Session expiry/relogin QA зелёный.
- [ ] Accessibility critical path зелёный.
- [ ] Нет production filenames, Kora manifest или absolute paths.

Application owner: `________________`
Product owner: `________________`
QA owner: `________________`
Evidence link: `________________`

## 11. Deploy artifact и configuration

- [ ] Final RC artifact inventory сохранён.
- [ ] `public/kora-project-intelligence/**` отсутствует.
- [ ] `qa-artifacts/**`, `docs/**`, `fixtures/**`, `tests/**`, `ios/**` отсутствуют.
- [ ] `.env*`, service keys и token secrets отсутствуют.
- [ ] Source maps не раскрывают secrets/production paths.
- [ ] Deployment project/team/domain проверены.
- [ ] Preview/canary использует production-shaped, но безопасный environment.
- [ ] Previous compatible deployment ID зафиксирован для app rollback.
- [ ] DB compatibility с previous deployment доказана.

Application owner: `________________`
Security reviewer: `________________`
Evidence link: `________________`

## 12. Monitoring и incident readiness

- [ ] Auth delivery/AMR/invitation alerts настроены.
- [ ] 401/403/409/5xx alerts настроены.
- [ ] DB locks/CPU/connections/long transactions alerts настроены.
- [ ] RLS anomaly/cross-scope probes настроены.
- [ ] Worker failure/retry alerts настроены, если worker включён.
- [ ] Storage failure/orphan delta alerts настроены.
- [ ] Audit/command continuity alerts настроены.
- [ ] Migration ledger drift monitor настроен.
- [ ] Log redaction проверен.
- [ ] Kill switch испытан.
- [ ] Emergency EXECUTE revoke/re-grant scripts reviewed.
- [ ] Incident channel, contacts и escalation tree проверены.
- [ ] Rollback drill завершён.

Operations owner: `________________`
Rollback commander: `________________`
Security owner: `________________`
Evidence link: `________________`

## 13. Final human sign-offs

Подпись означает review одного exact RC, snapshot, backup и evidence package.

| Роль | Имя | Решение GO/NO-GO | Дата/UTC | Подпись/evidence |
|---|---|---|---|---|
| Product owner |  |  |  |  |
| Database owner |  |  |  |  |
| Security owner |  |  |  |  |
| Application owner |  |  |  |  |
| QA owner |  |  |  |  |
| Storage owner |  |  |  |  |
| Operations/Incident owner |  |  |  |  |
| Rollback commander |  |  |  |  |

### Approval A — history repair

- [ ] Product owner GO
- [ ] Database owner GO
- [ ] Security owner GO

Approval record: `________________`

### Approval B — additive migrations

- [ ] Database owner GO
- [ ] Security owner GO
- [ ] Rollback commander GO

Approval record: `________________`

### Approval C — application deploy

- [ ] Product owner GO
- [ ] Application owner GO
- [ ] QA owner GO

Approval record: `________________`

### Approval D — traffic opening

- [ ] Product owner GO
- [ ] Operations/Incident owner GO

Approval record: `________________`

## 14. Execution record — intentionally empty

Заполняется только назначенным change owner после отдельных approvals.

| Событие | UTC | Оператор | Evidence/result |
|---|---|---|---|
| Traffic/write stop |  |  |  |
| Fresh backup confirmed |  |  |  |
| Baseline history repair |  |  |  |
| Ledger after repair |  |  |  |
| Additive migration 072 |  |  |  |
| Additive migration 073 |  |  |  |
| Additive migration 090 |  |  |  |
| Additive migration 091 |  |  |  |
| Additive migration 092 |  |  |  |
| Additive migration 100 |  |  |  |
| Additive migration 101 |  |  |  |
| Additive migration 1015 |  |  |  |
| Additive migration 102 |  |  |  |
| Additive migration 103 |  |  |  |
| Custom API schema exposure/cache |  |  |  |
| Custom SMTP/Auth rehearsal |  |  |  |
| Final ledger/fingerprint |  |  |  |
| Environment version |  |  |  |
| Application deployment ID |  |  |  |
| Controlled smoke |  |  |  |
| Limited traffic opened |  |  |  |
| Observation window closed |  |  |  |

Непреложное правило:

> `20260716071024_legacy_production_baseline.sql` нельзя выполнять на
> существующей production. Допускается только отдельно одобренный
> migration-history repair после свежего fingerprint check.

Текущий итог:

```text
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
REMOTE_WRITES_AUTHORIZED=false
```
