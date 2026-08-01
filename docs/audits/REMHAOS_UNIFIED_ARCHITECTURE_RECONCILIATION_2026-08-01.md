# RemHaOS — reconciliation repository / production / unified architecture

Дата: 2026-08-01  
Статус: read-only reconciliation; production не изменялся.

## Итог

Сейчас существуют два технических контура:

1. **Production `design2026`** (`ztnycrchwxqczqbyegnp`) — действующий governed M1
   runtime с живыми legacy-клиентами и отдельными workflow/facts/approval таблицами.
2. **`origin/main`** (`01c5b9a`, PR #55/#56/#57 уже влиты) — канонический
   RemHaOS/ArchiDom Project Intelligence Core с `projectceo_*` compatibility
   schemas, AP1 request-bound API и foundation для M1–M4.

Это не единый deployment и не одна migration history. Поэтому утверждение
«Project Intelligence уже работает в production» сейчас недоказуемо и должно
считаться неверным. Код в `main` может быть принят локально, но не является
production evidence.

Production-факты ниже взяты из предоставленного Cloud Code read-only отчёта.
Они не являются разрешением на запись; свежий snapshot и reviewer sign-off всё
ещё нужны перед любым adoption решением.

## Поэтапный статус

| Этап | Репозиторий / код | Production | Статус |
|---|---|---|---|
| Phase 0 — reality | `origin/main` и GitHub reconciled; PR #55, #56, #57 merged. Локальные lint/typecheck/test/build для PR #57 проходили; Supabase Preview skipped | Cloud Code нашёл отдельную migration history и отдельные таблицы | **RECONCILED AS SPLIT / NOT UNIFIED** |
| Phase 1 — architecture lock | Charter v0.4, ADR-0004/0005, Architecture v1 и Master Plan приняты; `ProjectCEO` оставлен internal compatibility namespace | Эти schemas/RPC в production отсутствуют | **IMPLEMENTED IN REPO ONLY** |
| Foundation / AP1 | Foundation, provenance, exact revisions, approvals, baseline/release, request-bound reads, RLS/ACL и thin M4 реализованы; local AP1 evidence PASS на PG16/PG17 и five-role disposable run | Не применено; production не имеет `projectceo_*`/`project_intelligence` | **LOCAL PASS / PROD NOT ADOPTED** |
| M1 legacy workflow | В коде есть brief → passport → risks → pricing → proposal/public response, но legacy baseline и hosted E2E требуют отдельной проверки | В production работает собственный governed M1: `workflow_runs`, `workflow_step_runs`, `project_facts`, `project_sources`, `approval_requests`, `audit_events`, `ai_calls`, `proposal_revisions` и M1 RPC | **LIVE, BUT SEPARATE MODEL** |
| M2 | Product Brain decisions/selections/approvals и read/foundation слой есть; room/variants/material-budget vertical slice отсутствует. PR #55/#56 закрыли decision/selection command semantics | `concept_packs` в production нет | **FOUNDATION/PARTIAL; NOT USER-READY** |
| M3 | Source/revision/baseline/release contracts и `publish_baseline` server command есть после PR #57; UI/read contract по-прежнему помечает baseline unavailable, а source/review/release/handover commands не закрыты | ProjectCEO M3 schemas/RPC отсутствуют | **BACKEND FOUNDATION; NOT USER-READY** |
| M4 | Thin change/impact/photo/milestone/handover persistence и local tests есть; расширенный ERP/WBS scope запрещён | ProjectCEO M4 contour в production не доказан | **LOCAL THIN FOUNDATION ONLY** |
| Production adoption | Checklist, clone/backup/restore, hosted Auth/Storage/SMTP, monitoring и human GO не закрыты | Нет доказанного additive adoption path | **NO-GO** |

## Точные расхождения

### Migration history

- В production Cloud Code увидел 13 migration entries; ни одна не совпадает с
  repository ProjectCEO migration chain.
- Это также расходится с repository snapshot от 19 июля, где ledger был записан
  как пустой. Следовательно, сначала нужно установить временную границу и
  получить новый snapshot; старый snapshot нельзя использовать как текущую
  production truth.
- В репозитории есть legacy `0001–0007`, затем timestamped Project Intelligence /
  ProjectCEO migrations, включая foundation, Product Brain, M4 и AP1.
- Production не содержит ни одну из repository `projectceo_*` migrations.
- Поэтому baseline SQL, history repair или additive migration нельзя выполнять
  на production на основании только repository ledger.

### Schema and data model

| Production | Repository `origin/main` |
|---|---|
| Standard `public`/`auth`/`storage`/`private` и governed M1 tables | `projectceo_*` API/private schemas и Project Intelligence persistence |
| `workflow_runs` / `workflow_step_runs` | workflow/application contracts, но другой persistence mapping |
| `project_facts` / `project_sources` | source registry, revisions, provenance и foundation adapters |
| `approval_requests` / `proposal_revisions` | ApprovalPackages, immutable baselines/package versions |
| `ai_calls` и M1 RPC (`issue_proposal_revision`, `complete_m1_human_review`, `review_project_fact`, `adopt_legacy_m1_workflow`) | ProjectCEO RPC/command surface (`create_decision`, `create_selection`, `publish_baseline` и др.) |
| `proposals.issued_revision_id` | такого production-compatible column не доказано в repository schema |

Cloud Code указал живые production counts: 8 designers, 27 projects, 86 answers,
53 events; 4 workflow runs, 26 step runs, 6 approvals, 39 audit events, 51 facts,
6 sources, 4 AI calls и 2 proposal revisions. Эти данные нельзя переносить в
новую схему без отдельного mapping, provenance и rollback плана.

### Security and operations

- Read-only security lint production выдал 11 `SECURITY DEFINER` warnings, но в
  проверенных функциях присутствовали `auth.uid()` и project membership checks;
  очевидного bypass по предоставленному отчёту не найдено.
- `rate_limits` имеет RLS без policies; это требует owner/security решения, а не
  автоматического удаления или открытия доступа.
- Supabase Auth leaked-password protection отключена; перед public launch это
  отдельный hosted Auth gate.
- В репозитории ProjectCEO security model строже: request-bound JWT,
  server-derived actor/scope, private schemas и no service-role human path.
  Это свойство кода не переносится в production автоматически.

## Что уже действительно сделано

- Каноническая архитектура и compatibility policy зафиксированы в документах.
- Project Intelligence foundation и thin M4 реализованы в репозитории.
- Local AP1 доказал disposable PG16/PG17, RLS/ACL, idempotency, concurrency,
  rollback/restart replay и пять отдельных role sessions.
- PR #55 и #56 merged; PR #57 (`publish_baseline`) также merged в `main` как
  merge commit `01c5b9a`.
- Для PR #57 Vercel checks зелёные; Supabase Preview был skipped, поскольку
  Database Branching в проекте недоступен.
- Production не мигрировался и не получил эти ProjectCEO schemas.

## Что не сделано

- Не доказано, что repository Project Intelligence развернут в production.
- Не reconciled production 13-entry ledger с repository migration ledger.
- Live Supabase Preview для PR #60 подтвердил отдельный migration-order blocker:
  после `0001`–`0007` clean-only baseline намеренно падает, поэтому до auth-fix
  нельзя получить полный disposable replay.
- Не закрыт новый AP1 blocker `92060e3`: `SECURITY DEFINER` ProjectCEO
  functions call `auth.uid()`/`auth.jwt()` as `pi_table_owner`, но стандартный
  Supabase не даёт этой NOLOGIN role lookup access к managed `auth` schema.
  Migration warning не превращается в failure, поэтому прежние green migration
  checks не доказывают рабочую authenticated authorization.
- Не создано утверждённого compatibility bridge между production governed M1 и
  Project Intelligence Core.
- Не пройден user-created полный AP1/M3 flow через production-shaped HTTP/UI;
  local seeded/disposable evidence не заменяет adoption.
- Не закрыты hosted Auth/Storage/SMTP, backup/restore, monitoring, rollback и
  human GO gates.
- M2 room/variant/selection vertical slice и M3 source→review→baseline→release
  самостоятельный пользовательский flow не готовы.

## Рекомендуемый следующий порядок

1. **Заморозить production:** никаких миграций, baseline repair, PR rollback или
   Auth changes до отдельного решения; сохранить fresh read-only schema/data/
   migration snapshot.
2. **Не создавать платную Supabase branch:** использовать уже доказанный local
   disposable AP1 (Colima) либо отдельный временный Supabase только после явного
   бюджетного решения. Branching не является обязательным условием.
   Перед replay выбрать один путь: clean-bootstrap baseline или historical
   incremental chain. Guard baseline нельзя снимать, а timestamped migrations
   нельзя переписывать.
3. **Закрыть AP2/AP3 локально:** request-bound reads и user-created commands для
   source register/review, baseline, release/distribution и handover. Для
   `publish_baseline` серверный command уже есть, но UI/read capability намеренно
   остаётся unavailable до завершения read contract.
   Сначала закрыть AP1 auth blocker: удалить ложные `GRANT ... auth` ожидания,
   выбрать role-neutral actor resolution (предпочтительно из signed request
   claims на entrypoint/helper), добавить fail-fast ACL/privilege checks и
   повторить реальный RPC-вызов. `GRANT authenticated TO pi_table_owner` можно
   использовать только временно в disposable, не как production fix.
4. **Повторить authenticated browser matrix** на disposable contour: owner,
   architect, builder, client, guest; без ручной записи в private tables.
5. **Сделать только проектный mapping-дизайн** production M1 → canonical Project
   Intelligence (IDs, facts, provenance, proposal revisions, approvals). Не
   переносить живые 27 проектов и не писать bridge в production до review.
6. После evidence package принять одно из решений:
   - **A — production canonical:** восстановить production migration lineage в
     repo и отдельно решить судьбу ProjectCEO;
   - **B — repo canonical:** подготовить staged data migration 27 проектов с
     rollback и dual-read периодом;
   - **C — split (безопасный default):** production остаётся текущим M1, а
     Project Intelligence проходит pilot отдельно; convergence откладывается до
     подтверждённого платного wedge.
7. Только после A/B/C и заполнения adoption checklist принимать решение о новом
   production release. `READY_FOR_MODULE_2` сейчас **NO** для production.

## Вердикт

```text
REPOSITORY_REALITY=RECONCILED_AS_SPLIT
PLATFORM_FOUNDATION=BLOCKED_BY_AP1_AUTHORIZATION__NOT_PRODUCTION_ADOPTED
M1_VERTICAL_WORKFLOW=LIVE_IN_PRODUCTION_AS_SEPARATE_GOVERNED_M1__REPO_AP1_BLOCKED
M2_M3_M4=PARTIAL_FOUNDATION__NOT_USER_READY
PRODUCTION_ADOPTION=NO-GO
READY_FOR_MODULE_2=NO
```
