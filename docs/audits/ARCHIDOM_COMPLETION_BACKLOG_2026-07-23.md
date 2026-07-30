# ArchiDom — completion backlog по результатам аудита

Это предложение. Документ не разрешает реализацию, миграции или production changes.

## P0 — блокирует реальное использование существующих M1–M3

### P0.1 Воспроизводимый authoritative database baseline — XL

- Проблема: current legacy chain не создаёт `concept_packs`/`rate_limits`, production ledger/drift не принят.
- Сценарий: M1 Concept Pack, rate limiting, любой hosted adoption.
- Доказательство: comment в `20260716071024_legacy_production_baseline.sql`; local adoption decision `NO-GO`.
- Результат: approved additive ledger/bridge без переписывания migrations.
- Зависимости: production snapshot, rollback, security sign-off.
- Acceptance: clean disposable replay PG16/17 + Supabase; schema diff expected; rollback; no production write.

### P0.2 Fresh M1 authenticated E2E — L

- Проблема: текущим аудитом полный M1 не воспроизведён; quality commands зависают.
- Сценарий: project→brief→file→passport→risk→price→proposal→accept→reopen.
- Доказательство: code paths есть; current run `NOT_VERIFIABLE`.
- Результат: evidence-backed supported M1 slice.
- Зависимости: P0.1, disposable Auth/Storage/SMTP/provider env.
- Acceptance: separate designer/client sessions, persistence after relogin, negative token/RLS tests, recorded command results.

### P0.3 Завершить M3 source→review→baseline→release commands — XL

- Проблема: обязательные commands explicitly unavailable.
- Сценарий: architect uploads revision, reviews, publishes package, recipient opens exact release.
- Доказательство: `command-service.ts:UNAVAILABLE`.
- Результат: user-created, non-seeded M3 vertical slice.
- Зависимости: P0.1, Storage authorization, exact revision policy.
- Acceptance: UI→HTTP→RPC→DB→reopen; idempotency/concurrency; stale revision rejected; package isolation.

### P0.4 Единый immutable M1→M2→M3 handoff — XL

- Проблема: legacy passport/Concept Pack и Product Brain revisions are disconnected.
- Сценарий: contracted passport→approved design intent/selection→released package.
- Доказательство: no handler/materializer found.
- Результат: one project identity and explicit version references.
- Зависимости: ADR-compatible bridge, P0.1/P0.3.
- Acceptance: no copy without provenance; source revision changes invalidate/recheck dependent artifacts.

### P0.5 Hosted security/adoption gate — XL

- Проблема: `is_studio_member`, Auth leaked-password/SMTP/redirects, Storage recovery and production API allow-list open.
- Сценарий: all public/authenticated modules.
- Доказательство: `LOCAL_CLONE_ADOPTION_DECISION_2026-07-20.md`.
- Результат: explicit GO/NO-GO evidence.
- Зависимости: provider backup/restore and human sign-offs.
- Acceptance: five roles, tenant/package negatives, revoke/expire, backup/restore, monitoring/kill switch.

## P1 — завершает начатые вертикальные срезы

### P1.1 M2 one-room/three-variant slice — XL

- Проблема: no room/variant/history/selected-version product flow.
- Сценарий: room→3 variants→client comments→approve one.
- Доказательство: routes/entities absent; only text Concept Pack and Product Brain foundation.
- Результат: Approved Design Intent with immutable revision.
- Зависимости: P0.4, wedge decision.
- Acceptance: persist/reopen/history/role permission/approval; no AI auto-approval.

### P1.2 M2 selections/material budget slice — L

- Проблема: selections/price observations are backend/read foundation without complete UI/write flow.
- Сценарий: material/item→price→room budget→approval.
- Доказательство: persistence/read contracts; `review_selection` unavailable.
- Результат: Approved Selections linked to room and budget.
- Зависимости: P1.1.
- Acceptance: RUB safe integers, source provenance, superseded revision visible, approved selection handed to M3.

### P1.3 Proposal and passport version lifecycle — L

- Проблема: proposal UI is fixed to version 1; no immutable contracted passport.
- Сценарий: revise after client changes without overwriting accepted state.
- Доказательство: proposal queries `.eq("version", 1)`.
- Результат: immutable sent/accepted versions and explicit supersession.
- Зависимости: P0.4.
- Acceptance: prior public version remains auditable; new approval required for material changes.

### P1.4 Contract upload/status — M

- Проблема: contract entity/route absent.
- Сценарий: proposal accepted→external contract uploaded→status/party/date→passport contracted.
- Доказательство: NOT_IMPLEMENTED in route/entity map.
- Результат: external-document tracking, not proprietary e-sign.
- Зависимости: legal/storage review.
- Acceptance: private file, exact revision, role access, no claim of legal signature.

## P2 — усиливает сквозное ядро

### P2.1 Project Check service and UI — XL

- Проблема: no unified READY/CONDITIONAL/BLOCKED with hard/soft reasons.
- Сценарий: pre-approval/pre-release readiness.
- Доказательство: no route/entity/function found.
- Результат: explainable checks over existing M1–M3, not fifth module.
- Зависимости: P0.4 and domain acceptance rules.
- Acceptance: deterministic reasons, responsible role, evidence refs, human override with audit.

### P2.2 Source invalidation propagation — L

- Проблема: exact revisions exist but downstream invalidation is not proven end-to-end.
- Сценарий: replace source after approval/release.
- Доказательство: contracts exist; full UI result not verified.
- Результат: stale dependents and recheck requirements.
- Dependencies: Project Check.
- Acceptance: replacing revision never silently preserves READY/current downstream state.

### P2.3 Unified role navigation and error states — M

- Проблема: legacy dashboard and ProjectCEO workspace remain separate product surfaces.
- Сценарий: one user changes among M1–M4 roles for same project.
- Доказательство: separate route trees and data DTOs.
- Результат: four role views over one project without client-side authority.
- Зависимости: P0.4.
- Acceptance: server-derived capabilities, loading/empty/error/stale states, direct-route negatives.

## FUTURE — не требуется для первого запуска

- Wide AI image/variant generation with provider benchmark/privacy/cost ledger — XL.
- CAD/BIM/native drawing authoring — excluded; integrate external files only.
- Expanded M4 WBS/schedule/estimate/procurement/warranty — XL after paid wedge.
- ERP/accounting/warehouse/marketplace — out of scope.
- Own legally significant e-sign — future provider/legal gate.
