# M1 Gap Audit

Дата аудита: 2026-07-10.

Фокус: текущее состояние реализации против границ Модуля 1. Новые фичи в рамках этого аудита не строились.

## Executive Summary

M1 skeleton в коде уже покрывает главный путь: designer-created project -> public brief -> passport -> risk cards -> Review Board -> proposal -> public proposal link. Сильные места: детерминированный `buildPassport`, hybrid risk pipeline, PII masking перед LLM, printable proposal, базовые events.

Главные gaps не в инфраструктуре, а в продуктовых M1 объектах:

- risk cards нельзя редактировать, хотя целевой workflow требует accept/reject/edit;
- package recommendation отсутствует, `scope.package` почти всегда `null`, а proposal fallback всегда `full`;
- proposal versioning есть в схеме, но фактически всегда используется `version = 1`;
- PassportFact, ServiceItem и PackageRecommendation не выделены как структуры;
- quick brief расширен до длинного quick+deep flow, что требует явного контроля конверсии и границ M1.

Отдельный риск: `CLAUDE.md`, `ARCHITECTURE.md` и фактический код расходятся в нескольких местах, особенно вокруг `zai`, autosave, proposal viewed/respond events и self-serve flow.

## Gap Table

| Area | Current implementation | Gap | Priority | Suggested next task | Notes / relevant files |
|---|---|---|---|---|---|
| public brief link | Designer creates project; system generates `/i/[token]`; dashboard shows copyable link. Public page loads project by `intake_token` through server code. | `brief_sent` status is not meaningfully used; copying/sending the link is not tracked as a distinct event. Self-serve `/api/client/create` also exists and can blur designer-led M1. | P2 | Add explicit `brief_link_copied` or `brief_sent` handling only if needed for validation metrics. Keep self-serve out of M1 expansion. | `app/dashboard/actions.ts`, `components/intake-link.tsx`, `app/i/[token]/page.tsx`, `lib/intake.ts` |
| branching brief | Source of truth is `lib/brief/questions.ts`; `show_if` supports branching; UI splits `quick` and `deep`. | The brief is no longer close to "10 questions"; only a few branches are actual predicates. Tests still say "10 core questions plus optional attachments" while implementation has many deep questions. | P1 | Re-audit quick/deep question tiers and update tests/docs so quick M1 stays short and deep remains optional. | `lib/brief/questions.ts`, `lib/brief/questions.test.ts`, `app/i/[token]/wizard.tsx` |
| autosave | Browser localStorage draft per `brief_${token}` stores answers, comments, step, started and mode; draft is removed after successful submit. | Client-side only; no cross-device/server draft; no telemetry for abandoned drafts. This is acceptable for MVP but should be named clearly. | P2 | Add UX copy/status for restored local draft and maybe a lightweight `brief_started`/block progress event if conversion analysis needs it. | `app/i/[token]/wizard.tsx` |
| brief answer normalization | Raw answers are upserted to `answers`; `buildPassport` normalizes many shapes and guards against `{ value }` choice inversion. | No Zod/schema validation of submitted answer payload before DB write; comments and attachments are mixed into `answers` as special ids; no standalone normalization output for audit. | P1 | Add a small answer normalization module that validates known question ids and preserves unknown `custom_*` answers. | `app/api/intake/submit/route.ts`, `lib/brief/passport.ts`, `lib/brief/questions.ts` |
| passport generation | `runRiskPipeline()` calls deterministic `buildPassport(answers)`; passport is saved to `projects.passport`. | Product language says "AI passport", but code correctly avoids extra AI call. Gap is explainability: no structured facts/evidence per passport field. | P2 | Add derived `PassportFact[]` without DB migration first; use it in Review Board display. | `lib/brief/passport.ts`, `components/passport-view.tsx`, `lib/brief/pipeline.ts` |
| passport facts structure | No separate `PassportFact` type or persistence. Passport is rendered as rows. | Missing core M1 object for "why does the passport say this". This makes Review Board less auditable. | P1 | Create `lib/brief/facts.ts` to derive fact rows from answers + passport and cover with unit tests. | `lib/types.ts`, `components/passport-view.tsx`, `lib/brief/passport.test.ts` |
| risk card generation | Hybrid pipeline: deterministic rules, one LLM pass, Zod validation, repair retry, dedupe, fallback to rule cards. | No durable generation metadata (`llmOk`, error, repaired); re-run replaces cards and can wipe review decisions; degraded banner uses a weak heuristic. | P2 | Store a minimal generation note/event or display rerun result without changing risk schema. | `lib/brief/pipeline.ts`, `lib/risks/rules.ts`, `lib/risks/llm.ts`, `app/dashboard/projects/[id]/actions.ts` |
| Review Board | Shows passport, uploads, comments, custom answers, grouped risk cards, missing fields and first-meeting questions. | Long mixed page; no editable risk fields; no structured PassportFacts; no per-project activity timeline. | P1 | Add inline risk editing first; then add fact/activity sections as separate small tasks. | `app/dashboard/projects/[id]/page.tsx`, `app/dashboard/projects/[id]/review.tsx`, `components/passport-view.tsx` |
| risk accept/reject/edit | Accept/reject exists through `setCardStatus`. | Edit is missing: designer cannot refine evidence, impact, action or proposal implication before proposal generation. | P0 | Implement edit/save for risk card text fields in Review Board. | `app/dashboard/projects/[id]/review.tsx`, `app/dashboard/projects/[id]/actions.ts`, `lib/review.ts` |
| accepted risks -> proposal logic | Proposal generator reads accepted cards and appends `proposal_implication` into "Что входит". | Implications are always folded into included text, even when they are better suited for exclusions, conditions or timeline. Proposal must be manually rebuilt after risk changes. | P1 | Split accepted risk implications into included/excluded/conditions through a minimal deterministic mapper or editable proposal section hints. | `lib/proposal/build.ts`, `app/dashboard/projects/[id]/proposal/actions.ts` |
| service items | Deliverables exist as hardcoded package lists in `PACKAGE_DELIVERABLES`. | No `ServiceItem` type, no per-project selected service items, no connection between package recommendation and proposal deliverables. | P2 | Extract deliverables to typed service items while keeping proposal output unchanged. | `lib/proposal/build.ts`, `lib/types.ts` |
| pricing factors | `calcPrice()` returns transparent factors: base rate, area, complexity, package, urgency. | Project complexity is hardcoded to `mid`; package is fallback `full`; no per-project pricing factor review/override. | P1 | Add a small per-project price preview component showing current factors and what is assumed. | `lib/pricing/calc.ts`, `app/dashboard/projects/[id]/proposal/page.tsx` |
| package recommendation | Schema has `passport.scope.package`; proposal uses `passport.scope.package ?? "full"`. | No recommendation engine or designer selection. M1 requested service/package recommendation is not implemented. | P0 | Add deterministic package recommendation with reasons and designer override before proposal generation. | `lib/brief/passport.ts`, `lib/proposal/build.ts`, `app/dashboard/projects/[id]/proposal/page.tsx` |
| proposal sections | Sections are generated deterministically and editable in dashboard. Public proposal renders sent sections. | No section schema validation on save; no autosave; no structured relation from sections back to ServiceItems/PricingFactors. | P2 | Validate `ProposalSection[]` on save and preserve order/known ids. | `app/dashboard/projects/[id]/proposal/editor.tsx`, `app/dashboard/projects/[id]/proposal/actions.ts`, `lib/proposal/build.ts` |
| proposal versioning | DB has `version`; code always selects/inserts `version = 1`. | Real versioning is absent. Editing a sent proposal is blocked by rebuild, but no version 2 workflow exists. | P1 | Add "Create new draft version" from latest sent proposal. | `supabase/migrations/0001_init.sql`, `app/dashboard/projects/[id]/proposal/page.tsx`, `app/dashboard/projects/[id]/proposal/actions.ts` |
| proposal events/opened status | `proposal_created`, `proposal_sent`, `proposal_viewed` and response events exist. Dashboard proposal page shows viewed/response badges. | `lib/types.ts` `EventType` is stale; `projects.status` has no accepted/declined state; no notification to designer. | P1 | Align event type constants and add a per-project activity log. Do not add CRM automation. | `lib/types.ts`, `lib/proposal/respond.ts`, `app/p/[public_token]/page.tsx`, `app/dashboard/projects/[id]/proposal/page.tsx` |
| PDF/web proposal export | Public proposal page `/p/[public_token]`; print button and browser print are v0.1 PDF path. | No generated PDF file by design; print styling should remain the only MVP export. Need ensure future tasks do not add PDF libraries. | P3 | Keep printable HTML; optionally improve print CSS only if a user-visible defect appears. | `app/p/[public_token]/page.tsx`, `app/p/[public_token]/print-button.tsx`, `app/globals.css` |
| activity log | `events` table stores core events; `/dashboard/analytics` shows a simple funnel. | No project-level timeline; event taxonomy in TypeScript is incomplete; some events have `designer_id = null` in self-serve flow. | P2 | Add compact project activity panel from `events`, read-only. | `app/dashboard/analytics/page.tsx`, `app/dashboard/projects/[id]/page.tsx`, `lib/types.ts` |
| AI provider abstraction | `completeJSON(prompt, schema)` wraps Yandex, GigaChat and `zai`; repair retry and JSON extraction are tested. | Product docs conflict: original guardrail says Yandex/GigaChat only, current repo documents approved `zai` deviation. No automated guard that product code calls LLM only through provider. | P1 | Update documentation consistently or add a test/static check for `completeJSON` usage. Do not change provider in this task. | `lib/llm/provider.ts`, `lib/llm/zai.ts`, `CLAUDE.md`, `README.md`, `ARCHITECTURE.md` |
| privacy masking before LLM call | `buildRiskPrompt()` removes city, district, contact, attachments and masks email/phone/handles/long numbers in free text; tests exist. | URL refs are intentionally preserved and can still contain personal data; names and addresses in arbitrary text are not fully scrubbed. This is a known residual privacy risk. | P1 | Add a privacy test case for refs and document the residual risk in product/legal copy. | `lib/risks/llm.ts`, `lib/risks/llm.test.ts`, `app/legal/privacy/page.tsx` |

## TOP 5 Next Engineering Tasks

### 1. Editable Risk Cards On Review Board

**Why it matters:** M1 workflow says designer accepts, rejects and edits AI/rule conclusions. Today edit is missing, so proposal text inherits raw `proposal_implication`.

**Files likely involved:** `app/dashboard/projects/[id]/review.tsx`, `app/dashboard/projects/[id]/actions.ts`, `lib/review.ts`, `lib/i18n/ru.ts`.

**Acceptance criteria:**

- Designer can edit `evidence`, `impact`, `designer_action` and `proposal_implication`.
- Saved edits persist in `risk_cards`.
- Accepted/rejected status is preserved while editing.
- Proposal rebuild uses the edited `proposal_implication`.
- RLS/studio access rules remain unchanged.

**What not to do:** do not add new LLM calls, new risk types, marketplace logic or a large Review Board redesign.

### 2. Deterministic Package Recommendation

**Why it matters:** M1 includes service/package recommendation, but current proposal generation defaults to `full` because `passport.scope.package` is normally `null`.

**Files likely involved:** `lib/types.ts`, new `lib/proposal/package.ts` or `lib/pricing/package.ts`, `app/dashboard/projects/[id]/proposal/page.tsx`, `lib/proposal/build.ts`, tests under `lib/proposal`.

**Acceptance criteria:**

- Function returns `concept`, `full`, or `full_plus_supervision` plus 2-4 human-readable reasons.
- Recommendation is deterministic from passport and accepted risks.
- Designer can see the recommendation before proposal generation.
- Existing pricing calculation receives the selected/recommended package.

**What not to do:** do not build ML-pricing, pricing master, package marketplace or historical project analysis.

### 3. Real Proposal Versioning For Revisions

**Why it matters:** Schema has `proposals.version`, but code hardcodes version 1. A sent proposal should remain stable while a new draft can be prepared.

**Files likely involved:** `app/dashboard/projects/[id]/proposal/page.tsx`, `app/dashboard/projects/[id]/proposal/actions.ts`, `lib/proposal/build.ts`, maybe a small migration for uniqueness if needed.

**Acceptance criteria:**

- Latest draft/sent version is selected consistently.
- From a sent proposal, designer can create a new draft version.
- Old sent public link remains unchanged.
- New version gets its own `public_token`.
- `proposal_created` or a new version event is written.

**What not to do:** do not add contract signing, invoice status, payment status or a CRM deal pipeline.

### 4. PassportFact Derivation

**Why it matters:** Review Board needs explainability: which answer produced which passport fact. This supports designer trust without adding more AI.

**Files likely involved:** new `lib/brief/facts.ts`, `lib/types.ts`, `components/passport-view.tsx` or Review Board section, `lib/brief/passport.test.ts`.

**Acceptance criteria:**

- `derivePassportFacts(answers, passport)` returns stable facts with label, passport path, display value and source question id.
- Core facts cover object, household, lifestyle, budget, timeline, style and pain points.
- Unit tests cover missing/undisclosed values.
- UI can render facts without changing `projects.passport`.

**What not to do:** do not introduce a new LLM passport call or a large DB migration before the derived structure proves useful.

### 5. Project Activity Log And Event Type Alignment

**Why it matters:** Basic activity log is in M1, and proposal viewed/respond events are already being written, but domain types and UI are incomplete.

**Files likely involved:** `lib/types.ts`, `lib/proposal/respond.ts`, `app/dashboard/projects/[id]/page.tsx`, `app/dashboard/projects/[id]/proposal/page.tsx`, `lib/i18n/ru.ts`.

**Acceptance criteria:**

- `EventType` includes currently used proposal viewed/respond events.
- Project page shows a compact read-only event timeline.
- Proposal page badges continue to work.
- Self-serve/null-designer events are handled without crashing.

**What not to do:** do not add notifications, reminders, CRM tasks or external integrations.

## Cross-Document Risks And Inconsistencies

- `AGENTS.md` says product runtime must not use Chinese LLM APIs; repo `CLAUDE.md` documents an approved `zai` deviation. This is a product/legal decision, not a code change for this audit.
- `CLAUDE.md` still says S3/S4 are not built, but code has proposal response CTA, `proposal_viewed`, response events and dashboard badges.
- `ARCHITECTURE.md` says there is no autosave, no client contact in brief and no analytics dashboard; code has localStorage autosave, `contact` question and `/dashboard/analytics`.
- `BACKLOG.md` previously mixed future OS, marketplace and generic deferred items without explicit Module 2/3 labels.
- Current brief has many deep questions. That may be valid, but M1 guardrail still needs a short quick path for conversion.
