# ProjectCEO RU — Production Gap Register

Дата оценки: 18 июля 2026 года
Accepted source commit: `a8c86a81b7305210b71e1d790fcefa11e5920571`
Accepted local pilot evidence: `487e9936c6c9b366bce1542ce9d8d2ccd64106b7`
Local integration state: thin M4 принят в `e74f4b3`; request-bound UI — в
`a8c86a8`; local pilot evidence — в `487e993`. Он не является production release
candidate.

```text
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
```

## 1. Правила статусов

- **BLOCKER** — production adoption или открытие traffic запрещено.
- **CONDITIONAL_RISK** — может быть принято только указанными людьми письменно,
  с compensating controls и сроком закрытия; до подписи остаётся blocker.
- **DEFERRED_OUT_OF_SCOPE** — не входит в текущий Foundation scope и не может
  рекламироваться как готовая функция.
- **CLOSED_LOCAL** — закрыто и проверено локально; production evidence всё равно
  требуется отдельно.

Ни один риск в этом документе пока не принят человеком.

## 2. Blockers

| ID | Gap | Evidence / impact | Условие закрытия | Owner / sign-off |
|---|---|---|---|---|
| PA-B01 | Fresh production drift неизвестен | Последний snapshot от 2026-07-16: PG 17.6, ledger `[]`. Любое последующее изменение делает fingerprint недостаточным | Новый read-only snapshot, normalized hash, diff review; неизвестный drift равен stop | DB owner / Security |
| PA-B02 | Migration history repair не одобрен | Production структурно содержит legacy baseline, но authoritative ledger пуст. Baseline SQL нельзя запускать на существующей production | Отдельно одобрить ledger-only repair `20260716071024`, затем доказать exact ledger | Product / DB / Security |
| PA-B03 | Legacy registration auto-confirms email через admin API | `app/api/auth/register/route.ts` вызывает admin `createUser(... email_confirm: true)`. Это обходит mailbox proof и использует service authority для human onboarding | Удалить/изолировать route от ProjectCEO; magic link/OTP/confirmed signup; negative auth tests | App / Security / QA |
| PA-B04 | Request-bound UI integration не доказана на live Supabase | Commit `a8c86a8` принимает local-fixture/live factory и fail-closed request client, но authenticated PostgREST/browser E2E не выполнен; fixture mode не является authorization | На одном RC доказать live Auth/PostgREST, отсутствие fixture/demo flags в production и browser role matrix | App / Security / QA |
| PA-B05 | Live Foundation route wiring не завершено | DB contracts зелёные локально, но enrollment/invitation/access/upload/read не доказаны end-to-end через production-shaped server routes | Integration tests + authenticated browser QA на disposable environment | App / QA |
| PA-B06 | Package-release binding не принят в production runtime | M2/M3 local DB имеет immutable release, exact distribution/ack и package scope, но live guest route и production artifact не доказаны | Accepted request-bound app RC, revoke/expire + exact package browser tests, production-clone rehearsal | DB / Product / Security |
| PA-B07 | Финальный M2/M3 application flow не доказан end-to-end | Persisted M2/M3 принят в `9874524` и DB4 зелёный локально; route/browser adoption остаётся незакрытым | Request-bound routes + authenticated browser flow на одном final RC | Product / App / QA |
| PA-B08 | M4 принят локально, но не доказан в production-shaped application | Commit `e74f4b3`; fresh PG16/PG17: persistence, ACL, premature-release denial, reviewed release, ChangeRequest, impact, photo, milestone, handover, concurrency и restart replay зелёные; это ещё не production adoption evidence | Request-bound route/browser QA и production-clone rehearsal на final RC | Product / DB / App / QA |
| PA-B09 | Authenticated browser/device QA не пройден | UI report прямо оставляет auth browser/device QA pending | Owner/architect/builder/guest matrix, email flows, upload, revoke, cross-tenant denial в browser | QA / Security |
| PA-B10 | `PROJECTCEO_TOKEN_SECRET` отсутствует в env contract | `.env.example` на source commit не содержит secret; Foundation требует минимум 32 bytes | Secret создан в production store, env contract обновлён в новом RC, rotation rehearsal пройдена | Security / Operations |
| PA-B11 | Request-bound human и service worker adapters не доказаны в runtime | DB разделяет human/worker executor paths, но production-shaped adapter wiring не проверено | Separate clients, no browser service key, human RPC с user JWT, worker allowlist tests | App / Security |
| PA-B12 | Backup/restore и Storage recovery не репетированы | DB backup не включает objects; orphan reconciliation не доказана | Production clone restore rehearsal, object inventory/backup, measured RTO/RPO | DB / Storage / Rollback |
| PA-B13 | Production Storage authorization не перепроверена после Foundation | Bucket private подтверждён read-only, но final policies, signed URL runtime, cleanup и object/DB parity не проверены | Fresh policy snapshot, upload/read/deny/orphan tests в clone | Storage / Security / QA |
| PA-B14 | Email delivery и Auth configuration не проверены | Invitation contract зависит от confirmed email/AMR; SMTP, redirects, templates и bounce path не имеют production-shaped evidence | SMTP/Auth test matrix и logs без token leakage | App / Operations / QA |
| PA-B15 | Monitoring/alerting/kill switch не приняты | Нет подписанного production dashboard, thresholds и incident ownership | Alerts, owner, tested kill switch, rollback drill | Operations / Rollback |
| PA-B16 | Release artifact security не доказана для финального RC | `.vercelignore` исключает Kora/demo paths локально, но финальный deployment artifact ещё не проверен | Artifact inventory подтверждает отсутствие Kora manifest, paths, fixtures, secrets | App / Security |
| PA-B17 | Финальный production release candidate не материализован | Accepted source `a8c86a8` содержит exact 11-row ledger и request-bound layer; local pilot evidence зафиксирован в `487e993`, но production blockers не закрыты | Один reviewed commit/tag после закрытия blockers, clean worktree, exact application/artifact hashes и подтверждённый ledger | Integrator / DB |
| PA-B18 | Custom API schema exposure не доказан | Request-bound adapters вызывают `.schema('projectceo_api'|'projectceo_product_api'|'projectceo_m4_api')`; production Data API settings/schema cache неизвестны | Expose только API schemas, private schemas не expose; exact USAGE/EXECUTE allowlist и positive/negative PostgREST tests | App / DB / Security |
| PA-B19 | HTTP command surface не закрывает полный Kora vertical slice | Принятый request-bound слой поддерживает только часть human mutations; source review, Selection approval, baseline/release/distribution и worker handover остаются unavailable либо не имеют route | Зафиксировать минимальный supported surface, закрыть обязательные Kora команды или явно оставить application pilot NO-GO; positive/negative HTTP replay на request-bound JWT | Product / App / QA |
| PA-B21 | Route handler execution покрыт не полностью | Security review не нашёл P0/P1. Commit `a8c86a8` добавил direct early-`POST` tests для cross-origin, content type, malformed JSON, fixture и redaction; P2 остаётся для unauthenticated/unexpected-backend paths и фактических `GET` handlers/status/cache serialization | Дополнить direct handler tests оставшимися paths и выполнить live request-bound integration | App / Security / QA |

## 3. Conditional risks awaiting acceptance

| ID | Risk | Почему не blocker только для узкого Foundation schema adoption | Compensating controls | Acceptance |
|---|---|---|---|---|
| PA-R01 | Legacy `public` schema security debt | Новые Project Intelligence schemas не должны расширять debt, но existing app продолжает опираться на broad grants + RLS, не везде FORCE RLS, permissive studio policies, public-executable function и mutable legacy history | Ограниченный pilot, unchanged legacy surface, targeted security monitoring, remediation deadline | **Pending:** Security + Product |
| PA-R02 | Production PG17.6, локальная матрица PG16/PG17 | Две основные версии проверены локально, но exact hosted patch/runtime отличается | Fresh clone on production-equivalent PG17, extension/version diff, smoke | **Pending:** DB |
| PA-R03 | Root-package-only guest grant | Допустимо только если первый Foundation rollout прямо запрещает work-package distribution и guest получает один exact root artifact | Product copy/feature flags, exact token scope, revoke/expire, no listing | **Pending:** Product + Security |
| PA-R04 | Schema-first adoption без application traffic | Foundation DDL может быть принят отдельно, если никакой ProjectCEO UI/API traffic не открывается и rollback path доказан | EXECUTE closed until app gate; no human/worker routes; monitoring ledger only | **Pending:** DB + Security + Product |

Если M2–M4 или live pilot входят в change scope, PA-R03/PA-R04 перестают быть
приемлемыми и соответствующие blockers должны быть закрыты.

## 4. Deferred out of scope

| ID | Функция | Решение |
|---|---|---|
| PA-D01 | US/multi-region runtime | Не разрабатывать и не включать в adoption |
| PA-D02 | CAD/3D | Не включать в текущий ProjectCEO RU scope |
| PA-D03 | ERP, бухгалтерия, склад, marketplace | Не включать |
| PA-D04 | WhatsApp как authentication channel | Не использовать; только коммуникация/ссылка после отдельного review |
| PA-D05 | Расширение M4 до ERP/склада/бухгалтерии | Тонкий M4 сохраняется; расширение не включать |

## 5. Closed locally, not production evidence

| ID | Локальный результат | Ограничение |
|---|---|---|
| PA-L01 | Gate 0 materialized, release checks зелёные | Не разрешает production writes |
| PA-L02 | Foundation access/ingestion/hardening migrations прошли PG16/PG17 DB2/DB3 | Нужна свежая production-clone rehearsal |
| PA-L03 | Human/worker NOLOGIN executor model и RPC grants проверены локально | Runtime adapters ещё не доказаны |
| PA-L04 | Invitation AMR/confirmed-email negative tests зелёные локально | Legacy admin auto-confirm route остаётся |
| PA-L05 | `.vercelignore` исключает Kora demo/docs/fixtures/tests | Нужна проверка реального RC artifact |
| PA-L06 | Persisted M2/M3 принят в commit `9874524`; DB4 PG16/PG17, RLS, concurrency, rollback/replay зелёные | Нужны request-bound application и production-clone evidence |
| PA-L07 | Thin M4 принят в `e74f4b3`; fresh DB5 PG16/PG17 PASS: release gate, ChangeRequest, impact review, photo/milestone, handover, concurrency и replay | Нужны request-bound application и production-clone evidence |
| PA-L08 | Deterministic Kora pilot harness: 1 800 м², 209 sources, 5 packages, V1→V2, distribution/ack, change, no-change и closure | Это sanitized local evidence, не authenticated browser и не production data |
| PA-L09 | Commit `1c803b0` удалил legacy Kora manifest/data/scripts/styles из `public/**`; безопасный index ведёт в authenticated `/dashboard/projectceo`; targeted public scan чист | Финальный deployment artifact всё равно проверяется повторно на final RC |
| PA-L10 | Request-bound application принят в `a8c86a8`; scoped integration/UI tests и sanitized five-role browser QA зелёные | Это не authenticated hosted PostgREST/RLS browser evidence; command/read-contract gaps остаются |

## 6. Adoption verdict

**Full ProjectCEO RU pilot adoption: NO-GO.**

Причина: Foundation, persisted M2/M3, thin M4 и fail-closed request-bound UI
локально приняты. Production-ready identity onboarding, live PostgREST,
полный command surface, fresh production clone, authenticated browser matrix,
backup/restore, monitoring и human sign-offs отсутствуют.

**Foundation schema-only adoption: NO-GO до закрытия PA-B01–PA-B03,
PA-B10–PA-B17 и подписания PA-R01/PA-R02/PA-R04.**

Этот verdict может изменить только обновлённый evidence package и заполненный
[Adoption Checklist](./ADOPTION_CHECKLIST.md), а не устное разрешение или
успешный локальный demo.
