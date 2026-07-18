# ProjectCEO RU — Production Adoption Plan

Дата подготовки: 17 июля 2026 года
Обновлено: 18 июля 2026 года
Accepted source: `a8c86a81b7305210b71e1d790fcefa11e5920571`
Final release candidate: не материализован

```text
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
REMOTE_WRITES_AUTHORIZED=false
```

## 1. Назначение и граница плана

Этот документ описывает контролируемое принятие в production уже
зафиксированного ProjectCEO RU Gate 0 + Foundation + persisted M2/M3 + thin M4
и request-bound application на коммите `a8c86a8`.
Он не является разрешением на миграцию, деплой, изменение migration history,
ротацию секретов или обработку реальных данных.

Текущий пакет оценивает две разные границы:

1. **Foundation schema adoption** — возможен только после закрытия всех
   инфраструктурных и security-gates ниже и отдельного человеческого решения.
2. **ProjectCEO pilot application adoption** — сейчас заблокирован: persisted
   M2/M3, M4 и fail-closed request-bound layer приняты локально, DB5 проходит
   disposable PG16/PG17, но read-contract/command gaps, exposed custom API
   schemas, real request-bound PostgREST/Auth,
   authenticated browser QA и production-clone rehearsal не завершены.

M4 migrations `20260717102000` и `20260717103000` приняты в `e74f4b3`,
request-bound application — в `a8c86a8`. Pilot evidence находится **за границей
accepted source** до отдельного integrator commit/review. Ни один локальный PASS
не разрешает production apply.

## 2. Источники истины

- [Gate 0 report](../GATE_0_REPORT.md)
- [Foundation implementation report](../agent-1/FOUNDATION_IMPLEMENTATION_REPORT.md)
- [M2/M3 persistence report](../agent-4/PRODUCT_PERSISTENCE_REPORT.md)
- [M4 execution report](../agent-4/EXECUTION_M4_REPORT.md)
- [Agent 3 UI report](../agent-3/AGENT_3_REPORT.md)
- [Kora local pilot report](../pilot/PILOT_READY_REPORT.md)
- [Master execution plan](../MASTER_EXECUTION_PLAN.md)
- [Production schema observation, 2026-07-16](../../production-schema-observation-2026-07-16.md)
- [Baseline gate](../../agent-runs/db-wave/BASELINE_GATE.md)
- [Adoption baseline report](../../agent-runs/db-wave/ADOPTION_BASELINE_REPORT.md)
- [Production gap register](./PRODUCTION_GAP_REGISTER.md)
- [Rollback runbook](./ROLLBACK_RUNBOOK.md)
- [Adoption checklist](./ADOPTION_CHECKLIST.md)

Из последнего разрешённого read-only production snapshot:

| Факт | Значение |
|---|---|
| PostgreSQL | `17.6` |
| Captured at | `2026-07-16T07:10:24.609229+00:00` |
| Remote migration ledger | `[]` |
| Attachment SHA-256 | `a2f9a220399cd718cfb96fe2fb9b4ea6db824dac9e455eb7f24c3442ccd07a70` |
| Normalized JSON SHA-256 | `ef8b0d3aafd319fe8779a70ce2fc6440fd0f2fc23bb58497cb90cd64d61561b0` |
| Private Storage bucket | `client-uploads` |

Пустой ledger доказывает отсутствие зарегистрированной migration history, но
не отсутствие ручных изменений. Snapshot устаревает при любом production
изменении; перед adoption нужен новый read-only снимок и сравнение.

## 3. Обязательные prerequisites

Ни один production-шаг не начинается, пока все условия не отмечены в
[Adoption Checklist](./ADOPTION_CHECKLIST.md):

1. Release candidate указывает ровно на одобренный commit, worktree не содержит
   незарегистрированных миграций, а source hashes совпадают с разделом 5.
2. Получен новый read-only snapshot production schema, grants, policies,
   functions, triggers, roles, extensions и migration ledger.
3. Новый snapshot совпал с ожидаемым legacy fingerprint либо drift разобран и
   отражён в обновлённом плане.
4. Сделан database backup и отдельно сохранён inventory/backup Storage objects.
   Supabase database backup не включает сами Storage objects — только данные и
   metadata базы. См. [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups).
5. В изолированном клоне production выполнена полная репетиция: history repair,
   additive migrations, DB2/DB3/DB4/DB5, smoke tests и rollback exercise.
6. Исправлен legacy admin auto-confirm registration либо маршрут полностью
   изолирован от ProjectCEO.
7. Frozen mock adapter заменён production adapter; human mutations используют
   request-bound authenticated identity.
8. Authenticated browser QA пройден для owner, architect, builder, guest и
   запрещённых cross-organization/cross-project сценариев.
9. `PROJECTCEO_TOKEN_SECRET` создан, размещён в production secret store и имеет
   задокументированную схему ротации.
10. Настроены monitoring, alerting, incident owner и rollback commander.
11. Backup restore rehearsal доказал приемлемый RTO/RPO.
12. Product, DB, security, application, QA, storage и rollback owners подписали
    один и тот же release candidate.
13. В Supabase Data API settings явно проверены custom schemas
    `projectceo_api`, `projectceo_product_api`, `projectceo_m4_api`; private
    schemas не exposed. PostgREST schema cache обновлён, а exact EXECUTE/USAGE
    grants перепроверены.
14. Custom SMTP, redirect allowlist, email confirmations, OTP/magic-link expiry,
    templates, rate limits и bounce path прошли production-shaped rehearsal.
15. HTTP command surface либо закрывает обязательный Kora vertical slice, либо
    application adoption остаётся NO-GO. Fixture/read-only browser walkthrough
    и unit-tested orchestration не заменяют request-bound Auth/PostgREST E2E.

## 4. Snapshot, backup и dry-run

### 4.1 Новый snapshot-gate

Read-only оператор должен сохранить:

- server version и extensions;
- relations, columns, constraints, indexes, policies;
- functions, triggers, enums;
- table/schema grants и roles;
- `supabase_migrations.schema_migrations`;
- Storage buckets и object metadata;
- контрольный normalized JSON и SHA-256 исходного attachment.

Stop condition: ledger не пуст, fingerprint отличается, обнаружены неизвестные
DDL/grants/policies либо snapshot невозможно воспроизвести.

### 4.2 Backup-gate

До окна изменений должны существовать:

- platform/PITR backup в соответствии с тарифом проекта;
- независимый logical dump roles/schema/data;
- отдельный inventory Storage objects с bucket, object key, size, checksum,
  created time и metadata record;
- подтверждённый доступ rollback commander к restore-процедуре;
- зафиксированные RPO, RTO и ожидаемый downtime.

Официальный Supabase backup/restore flow разделяет roles, schema и data; custom
изменения auth/storage необходимо проверить отдельно. См.
[Supabase backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### 4.3 Две обязательные репетиции

**A. Clean bootstrap**

- чистый disposable PostgreSQL 17.6-совместимый кластер;
- полный ledger из раздела 5;
- DB2/DB3/DB4/DB5, RLS, concurrency, idempotency и rollback tests;
- normalized contract projection должен совпасть с ожидаемым hash
  `ac64fa6599ed4d4e9ff1ceb53aedfb2639a969faaf430b8cc20c149312da93c1`.

**B. Production clone**

- восстановить свежий production schema/data в изолированный disposable clone;
- доказать исходный fingerprint и ledger;
- baseline SQL **не выполнять**;
- сделать только history repair baseline timestamp;
- применить все accepted additive migrations в точном timestamp order;
- выполнить DB2/DB3/DB4/DB5, RLS, concurrency, idempotency, smoke и rollback
  exercise;
- сравнить post-migration schema, grants, ledger и audit behavior;
- удалить clone только по утверждённой retention-процедуре.

## 5. Точный migration ledger

Accepted ledger относится к source commit `a8c86a8` и содержит thin M4,
зафиксированный в `e74f4b3`. Production apply всё равно требует отдельного
решения и полного checklist.

| Порядок | Timestamp / файл | SHA-256 | Production action |
|---:|---|---|---|
| 1 | `20260716071024_legacy_production_baseline.sql` | `12aa89db579f7608d7cb3df71e9927ae904734cb9d92b97b640766cf0607c016` | **History repair only. SQL на существующей production запрещён.** |
| 2 | `20260716072000_project_intelligence_core.sql` | `9315a5a547b12aac2c624da3ebb97753994dd15d6528ce85cd430d290a0a6aa5` | Execute additive migration after approved repair |
| 3 | `20260716073000_project_intelligence_operations.sql` | `a95b9681b8da98f3b99196ec0ab05b0631ab36741efaa1262fc1ea40f8cf6890` | Execute additive migration |
| 4 | `20260717090000_projectceo_foundation_access.sql` | `aeed70c70e0177c27175e57869336317adb5b1959ad98a05aae3d84364818dff` | Execute additive migration |
| 5 | `20260717091000_projectceo_foundation_ingestion_read.sql` | `c238da289d2e3028d681f74f51d8142ca089cf22d3de8b099e686367a0259755` | Execute additive migration |
| 6 | `20260717092000_projectceo_foundation_integration_hardening.sql` | `381895710430f04b4876001ca00bd6cde79093cf31e9bbbe0f20157fa47e4468` | Execute additive migration |
| 7 | `20260717100000_projectceo_product_brain_persistence.sql` | `a424fa6c25eb7523b7a7b0c6bf3d7c4b9981704cb47230cf511802d62576435e` | Accepted M2/M3 additive migration |
| 8 | `20260717101000_projectceo_product_brain_operations.sql` | `8be290cbb13dcd9099157469cd9faa263a6fb9f5dacfaed1e8e405e2fd639869` | Accepted M2/M3 additive migration |
| 9 | `20260717101500_projectceo_product_brain_relational_hardening.sql` | `1ac21fcc9131a9d99cfdb918ec80c27f547153b286b62ef210cdd847442394c3` | Accepted relational hardening |
| 10 | `20260717102000_projectceo_m4_execution_persistence.sql` | `78f30156d2ab3558c6f444400e9c559e6ee6de1a4bf0f66c656e54042df2d2f7` | Accepted M4 additive migration |
| 11 | `20260717103000_projectceo_m4_execution_operations.sql` | `67157f76d30304b993881715827daad0f3e295f8b248e819bb15fa0fabc9c7a4` | Accepted M4 additive migration |

Ожидаемый post-adoption ledger вычисляется заново после final RC. Accepted M4
scope содержит одиннадцать timestamps с hashes выше. Старые numeric migrations
нельзя помечать individually applied.

## 5.1 Custom Data API schema gate

Supabase по умолчанию exposing `public`; custom schemas должны быть отдельно
добавлены в Data API `Exposed schemas`. Для ProjectCEO разрешено exposing только:

```text
projectceo_api
projectceo_product_api
projectceo_m4_api
```

Private owner schemas `project_intelligence`, `projectceo_foundation`,
`projectceo_product`, `projectceo_m4` не exposed. Нельзя копировать широкий
пример `GRANT ALL`: применяются только уже reviewed `USAGE` и exact `EXECUTE` на
allowlisted RPC. После настройки нужно проверить PostgREST schema cache и вызвать
каждый human RPC request-bound JWT, каждый worker RPC отдельным worker client, а
запрещённые RPC — отрицательно. Официальная настройка custom schemas описана в
[Supabase Data API guide](https://supabase.com/docs/guides/api/using-custom-schemas).

`migration repair --status applied 20260716071024` обновляет migration history и
не выполняет baseline SQL. Любая такая операция требует отдельного одобрения.
Supabase хранит remote migration history в
`supabase_migrations.schema_migrations`; миграции применяются по timestamp, и
push должен выполнять один оператор. См.
[Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations).

## 6. Deployment configuration и integrity

| Файл | SHA-256 на accepted source `a8c86a8` | Проверка |
|---|---|---|
| `.env.example` | `724f5c4f19d77a719117c11076d32b55266e3d4da50462f6cd7c107eb1b31c3a` | Не содержит `PROJECTCEO_TOKEN_SECRET`; gap должен быть закрыт до RC |
| `.vercelignore` | `b833aeddc44da3753dcd81ec6380d7992d2f243b8358ae21d7a7c94acb6e15b4` | Исключает Kora demo assets, docs, fixtures, tests и QA artifacts |
| `next.config.mjs` | `4e53c32921a5fbde61753da6e36b07ed318e17f626f12ead23cb30a2a902b5b5` | Изменения после RC требуют повторного review |
| `package.json` | `350c6a6e045e0f57c0829a707d97cf532a6b54f2ef1d4ffb7b2e52ac5128161c` | `deploy:prod` существует, но этим планом не разрешён |

Production deploy artifact дополнительно проверяется на отсутствие:

- `public/kora-project-intelligence/**`;
- production filenames и абсолютных локальных путей;
- Kora manifest, fixtures, tests, docs и QA artifacts;
- `.env*`, service keys, token secrets и source maps с секретами.

## 7. Environment и secrets

| Переменная/настройка | Контур | Требование |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server | Точный production project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Только public anon key; RLS остаётся обязательным |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Только maintenance/worker adapter; никогда browser и никогда human operation |
| `PROJECTCEO_TOKEN_SECRET` | Server only, sensitive | Новый случайный secret, минимум 32 bytes; hashing приглашений/guest grants; запрет логирования |
| `PROJECTCEO_DEMO_ROLE` | Production | **Не задавать.** Не является authorization mechanism |
| `NEXT_PUBLIC_APP_URL` | Browser/server | Точный production origin для redirects и email links |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Browser | Проверенный support mailbox |
| SMTP/Auth templates | Supabase Auth | Доставка magic link/OTP/invite, expiration, redirect allowlist и anti-phishing copy проверены |
| LLM provider keys | Server only | Не изменять в рамках schema adoption; отсутствие утечек проверить отдельно |

Изменения environment variables на Vercel применяются только к новым
deployments, поэтому secret/configuration change требует нового deployment. См.
[Vercel environment variables](https://examples.vercel.com/docs/environment-variables/managing-environment-variables).

### 7.1 Ротация `PROJECTCEO_TOKEN_SECRET`

До запуска должен быть выбран один безопасный контракт:

- versioned key ring (`current` + ограниченный `previous`) с reissue токенов; или
- controlled cutover с отзывом всех активных invitation/guest tokens.

Нельзя просто заменить secret: существующие hashed tokens станут
непроверяемыми. Rotation owner фиксирует дату, affected grants, reissue,
revocation и post-rotation audit.

## 8. Runtime roles и authorization boundary

| Операция | Identity/role | Запрет |
|---|---|---|
| Foundation и human DB2 RPC | Request-bound authenticated JWT пользователя | Нельзя выполнять через service role |
| `review_claim`, `publish_version`, `revise_decision`, `review_impact` | Human adapter, request identity | Нельзя подменять actor/org/project/package из body |
| `calculate_impact`, `build_handoff` | Отдельный worker adapter с service role | Не вызывать из browser; входные scope проверяются server-side |
| `expire_invitation` | Maintenance adapter с service role | Не использовать для human workflow |
| `read_guest_release` | Anon + exact hashed, scoped, expiring, revocable grant | Не расширять до organization/project-wide доступа |
| Internal function execution | NOLOGIN `pi_human_executor`, `pi_worker_executor` | Эти роли не являются application login roles |

Actor, organization, project, package и effective role выводятся server-side.
Client-supplied identifiers используются только как requested target и всегда
сверяются с access graph.

## 9. Storage adoption

Bucket `client-uploads` остаётся private.

Обязательный runtime contract:

- server-authorized upload intent;
- `upsert:false`;
- object key не содержит original filename;
- audit не содержит original filename и absolute local path;
- signed read URL живёт не более 900 секунд;
- access проверяется по organization/project/package scope;
- orphan reconciliation запускается по документированной процедуре;
- guest получает только exact released artifact, а не bucket listing.

До adoption проверяются bucket policies, grants, MIME/size limits, malware
handling, failed-upload cleanup и соответствие DB metadata фактическим objects.

## 10. Email verification и invitation

ProjectCEO invitation принимается только при подтверждённом email и допустимом
AMR: `magiclink`, `otp`, `invite` или `email/signup`.

До production необходимо:

1. удалить или изолировать legacy registration route, создающий пользователя
   через admin API с `email_confirm: true`;
2. доказать реальное владение mailbox через magic link/OTP/confirmed signup;
3. проверить redirect allowlist, token expiration, replay и revoked invitation;
4. проверить, что password-only session не принимает invitation;
5. проверить bounced/blocked email и безопасный resend.

WhatsApp может передавать только обычную коммуникацию или ссылку, но не заменяет
identity proof и не получает service credentials.

Built-in Supabase SMTP не является production delivery channel: он предназначен
для demos, ограничивает адресатов/rate и не даёт SLA. До pilot traffic нужен
custom SMTP, подтверждённый sender/domain, SPF/DKIM/DMARC, отключённый link
tracking для Auth links, bounce/delay observability и rehearsal на небоевых
аккаунтах. См. [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
и [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

## 11. Последовательность adoption

Каждая фаза имеет отдельный go/no-go. Выполняет один migration operator.

1. **Change freeze:** зафиксировать commit, hashes, окно, owners и stop rules.
2. **Fresh snapshot:** получить read-only snapshot и сравнить с fingerprint.
3. **Backup:** подтвердить DB restore path и отдельную Storage preservation.
4. **Clone rehearsal:** успешно пройти раздел 4.3 без исключений.
5. **Traffic/write stop:** не допускать ProjectCEO mutations во время DB window.
6. **Human approval boundary A:** разрешить только history repair baseline.
7. **History repair:** зарегистрировать timestamp `20260716071024`, не выполняя
   baseline SQL.
8. **Verify ledger:** остановиться, если ledger не равен ожидаемому single entry.
9. **Human approval boundary B:** разрешить exact additive ledger 072–092.
10. **Apply additive migrations:** строго последовательно, без параллельных
    operators и без незарегистрированных файлов.
11. **DB verification:** schema fingerprint, grants, RLS, DB2/DB3/DB4/DB5,
    idempotency/concurrency и audit.
12. **Data API schemas:** добавить exact custom API schemas, обновить schema cache,
    доказать allowlist и denial private schemas/functions.
13. **Auth/SMTP:** установить custom SMTP/Auth config и пройти delivery matrix.
14. **Environment:** установить одобренные secrets/config; не задавать fixture role.
15. **Application deploy:** только отдельный одобренный RC с production adapter.
16. **Controlled smoke:** отдельная test organization, минимум прав, полный audit.
17. **Limited traffic:** короткое pilot window с усиленным monitoring.
18. **Final observation:** ledger, errors, audit, Storage orphan delta и auth.
19. **Close or rollback:** итоговое решение записывает human change owner.

## 12. Controlled production smoke

Smoke выполняется только после approval и только в специально созданной test
organization без Kora production filenames и без реальных клиентских данных.

- magic link/OTP login и logout;
- owner enrollment и повторный idempotent enrollment;
- invitation accept с confirmed email;
- rejection password-only, expired, revoked и wrong-email invitation;
- architect/builder/guest role matrix;
- cross-organization и cross-project reads/mutations возвращают отказ;
- sanitized small PDF upload, read, no-overwrite и controlled cleanup;
- server-side derivation actor/org/project/package;
- human RPC не работает через worker path и наоборот;
- custom API schemas доступны PostgREST только с exact intended grants;
- private schemas/table reads недоступны через Data API;
- duplicate command id возвращает idempotent result, conflict не теряет audit;
- guest exact root-package release, expiration и revocation;
- audit/event records созданы без raw token/original filename;
- production artifact не содержит исключённые Kora/demo files;
- controlled rollback/disable switch доступен rollback commander.

M2–M4 smoke нельзя считать пройденным на mock UI или fixtures.

## 13. Monitoring

Минимальный dashboard/alerts до limited traffic:

- auth delivery, invalid AMR, expired/revoked invitation rate;
- 401/403/409/5xx по ProjectCEO routes;
- RPC error codes и idempotency conflict rate;
- DB locks, long transactions, CPU, connection saturation;
- RLS denial anomalies и cross-scope access probes;
- worker queue failures/retries, если worker включён;
- Storage upload failures и orphan delta;
- signed URL issuance, TTL violations и unexpected bucket listing;
- audit/command-log continuity;
- Vercel/Supabase logs на отсутствие secrets, raw tokens и filenames;
- post-deploy migration ledger drift.

Alert должен иметь owner, threshold, response time и ссылку на
[Rollback Runbook](./ROLLBACK_RUNBOOK.md).

## 14. Stop conditions

Adoption немедленно останавливается при любом условии:

- production fingerprint или migration ledger не совпал;
- backup/restore не подтверждён;
- baseline SQL выбран для существующей production;
- появился неизвестный migration file/hash;
- больше одного migration operator;
- service role используется для human operation;
- invitation можно принять без доказанного mailbox ownership;
- RLS/cross-tenant test не зелёный;
- DB2/DB3/DB4/DB5, concurrency или idempotency test не зелёный;
- custom API schema не exposed, schema cache stale либо private schema exposed;
- custom SMTP/Auth delivery/redirect/email-confirmation matrix не зелёный;
- object inventory расходится без объяснения;
- secret отсутствует, попал в log/browser или не имеет rotation plan;
- mock adapter/demo role присутствует в production authorization path;
- audit continuity нарушена;
- rollback commander недоступен;
- любой обязательный sign-off пуст.

## 15. Human approval boundary

Автоматизация и агенты могут подготовить evidence, hashes, dry-run reports и
команды для review. Они не могут самостоятельно:

- обновить remote migration history;
- применить production migrations;
- изменить production secrets/Auth/Storage policies;
- выполнить production deploy;
- открыть traffic;
- удалить data/objects;
- выбрать restore/down-migration;
- принять legacy security debt.

Для реального запуска нужны отдельные письменные решения:

1. **A — history repair:** Product owner + DB owner + Security owner.
2. **B — additive migrations:** DB owner + Security owner + Rollback commander.
3. **C — application deploy:** Product owner + Application owner + QA owner.
4. **D — traffic opening:** Product owner + Operations/Incident owner.

До заполнения всех подписей:

```text
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
```
