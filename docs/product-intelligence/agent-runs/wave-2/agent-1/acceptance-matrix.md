# Wave 2 L1 acceptance matrix — Pass 1

Baseline: Architecture v1, L1 spec and the 51-file frozen manifest with aggregate
`73bec18122badb492dc989904978e4ff9962ca063359f1e6a4d3483720e67eec`.

This is a preparation-time oracle, not an implementation verdict. `preparable` means the
required executable evidence and its owner are unambiguous. `blocked` means Agent 1 cannot
produce or accept that evidence in Pass 1 for the stated external reason. Missing Agent 2,
Agent 3 or Integrator implementation is **pending**, never an architecture failure.

## L1 Definition of Done

| ID | L1 assertion | Required implementation evidence | Negative/security evidence | State | Exact Pass 1 reason |
|---|---|---|---|---|---|
| DOD-01 | A human actor confirms an AI-origin decision over the exact current revision. | Agent 2 targeted test must call the workflow façade with server-owned human context, assert the exact target review and preserve `origin=ai`; Integrator root scenario must repeat it from the synthetic r1 fixture. | AI/system actor denied; stale target/current revision denied; missing exact evidence denied; rejected commands leave state/audit unchanged. | `preparable` | Frozen domain already exposes `reviewRevision`; application handoff and root scenario are pending. |
| DOD-02 | V1 is an immutable published snapshot. | Agent 2 publication test must deep-snapshot V1 and expose an exact selected-revision set; Integrator must retain and compare V1 after every later step. | Stale latest/state and unconfirmed selected claim reject without version/audit creation; no update/delete operation is exposed. | `preparable` | Required state/port evidence is specified; Agent 2 publication handoff is pending. |
| DOD-03 | Material changes from `natural_stone` to `quartz_composite` in a new revision of the same stable node. | Agent 2 revise-decision test must assert stable node ID, immutable r1, new human-origin r2 and `replacesRevisionId=r1`; Integrator must assert fixture-compatible IDs/payload. | Cross-project node/revision, non-human actor and same-revision changed payload are rejected. | `preparable` | Frozen fixtures and domain identity model agree; workflow result is pending. |
| DOD-04 | The confirmed-decision change requires reason plus exact revision/base expectations. | Agent 2 must test trimmed non-empty reason/reason code, exact `baseVersionId`, `expectedRevisionId` and expected state; Integrator must execute the accepted command. | Empty/blank reason, stale revision, stale base/latest/state and semantic no-op create no revision, ChangeSet or audit. | `preparable` | Command requirements are explicit; workflow evidence is pending. |
| DOD-05 | V2 publishes without changing V1. | Agent 2 must deep-compare stored V1 before/after revise and V2 publication, and show V2 selects r2 while V1 selects r1; Integrator repeats the invariant. | V2 publication with stale state/latest or invalid draft linkage rejects atomically. | `preparable` | Ownership and expected assertions are clear; workflow evidence is pending. |
| DOD-06 | Diff contains only the decision and `/material`. | Agent 3 must call frozen `diffProjectVersions` and match `expected-diff.json`; Integrator must assert the same output from accepted V1/V2. | Same revision ID with changed payload maps original `revision_immutability_violation` to controlled `DOMAIN_CONTRACT_VIOLATION`; project/version mismatch rejects. | `preparable` | Golden input and frozen function exist; change-handoff evidence is pending. |
| DOD-07 | Impact roots are derived from the diff, never accepted from caller input. | Agent 3 public calculate command must accept exact context/snapshots but no roots/impact list/edge override, call `changedNodeIds` internally, and test one derived root; Integrator must not supply roots. | Client-shaped roots/impacts/edges are unaccepted or ignored as authority; context/snapshot mismatch rejects before calculation. | `preparable` | The required public boundary and source inspection check are defined; Agent 3 handoff is pending. |
| DOD-08 | Impacts exactly equal Item distance 1, Budget and Finish Schedule distance 2. | Agent 3 golden test must compare all node/edge paths to `expected-impacts.json`; Integrator repeats exact equality. | Shuffled target nodes/edges and duplicate roots preserve byte-equivalent ordered results; cycles terminate. | `preparable` | Frozen domain and Wave 1 adapter already establish the golden; application wrapper evidence is pending. |
| DOD-09 | Risk reached only by `conflicts_with` does not propagate. | Agent 3 and Integrator tests must assert `risk-natural-stone-lead-time` is absent and retain the frozen relation policy. | Caller cannot inject Risk into a resolved impact list; non-propagating relations remain excluded after shuffling. | `preparable` | Frozen policy is explicit; persisted-shape run evidence is pending. |
| DOD-10 | Human dispositions split resolved and unresolved impacts. | Agent 3 must keep immutable impacts/run, create separate human reviews and deterministically partition `accepted` as unresolved and terminal resolved/dismissed as resolved; Integrator asserts 2 unresolved + 1 resolved for the golden. | AI/system actor, duplicate/stale status, mismatched impact/run and invalid disposition reject without partial review/audit state. | `preparable` | Golden dispositions are present; Agent 3 review lifecycle and Integrator mapping are pending. |
| DOD-11 | Logical handoff matches the accepted contract and has a stable semantic hash. | Agent 3 must build from exact published V2/run/reviews, compute SHA-256 over canonical logical content and match the golden semantics/hash; Integrator repeats it. | Mismatched version/run rejects; shuffled equivalent inputs preserve content/hash; artifact ID/time/status/signed URL do not affect hash. | `preparable` | Frozen handoff/hash contract is readable; implementation evidence is pending. |
| DOD-12 | Same scoped key + same digest replays the previous logical result. | Agent 2 and Agent 3 targeted tests must show the relevant mutation owner returns the same IDs/result with `idempotentReplay=true`; Integrator must replay at least the root workflow path. | Replay emits no second state transition or audit event; server time/request ID are excluded from the digest. | `preparable` | L1 in-process semantics are fully specified; no durable claim is required and test-adapter evidence is pending. |
| DOD-13 | Same scoped key + a different digest returns `IDEMPOTENCY_CONFLICT`. | Both implementation agents must test operation/project-scoped conflicts and unchanged state/audit; Integrator must exercise one cross-scenario conflict. | Different command body under the same key cannot replay, overwrite the record or partially mutate. | `preparable` | Stable failure code and no-partial-state assertion are explicit; implementation evidence is pending. |
| DOD-14 | Stale revision/version/state creates no partial mutation or audit event. | Agent 2 must snapshot state/audit/idempotency around stale workflow commands; Agent 3 must do the same for stale impact review/run token; Integrator must assert root aggregate equality after rejected stale calls. | Exact revision, base/latest version, state revision and impact status are independently exercised; controlled original domain details are retained. | `preparable` | Atomic logical port boundary is specified; implementation and composition evidence are pending. |
| DOD-15 | Targeted tests, typecheck, lint, full tests and build pass in a trusted validation environment. | Integrator must execute the full validation ladder after handoff/composition and record exact environment/base/file set and results. Agent 1 oracle is one input to that ladder. | A dataless/untrusted launcher cannot be reported as passing; test adapters do not prove RLS, database atomicity or restart durability. | `blocked` | Pass 1 local Vitest files are dataless and implementation/composition is incomplete. This is an expected evidence dependency, not a product failure. |

## Required negative matrix

| ID | Negative case | Required owner evidence | State | Exact Pass 1 reason |
|---|---|---|---|---|
| NEG-01 | AI/system actor attempts a human review or decision change. | Agent 2 capability/actor tests; Agent 3 human impact-review test; Integrator actor trust-boundary check. | `preparable` | Server-owned actor contract is explicit; implementation pending. |
| NEG-02 | Target/current revision is stale. | Agent 2 exact-revision test with unchanged state/audit. | `preparable` | Stable mapping to `REVISION_STALE` is defined; implementation pending. |
| NEG-03 | A revision, node or edge crosses project scope. | Agent 2 workflow closure tests, Agent 3 context/graph closure tests and root cross-project test. | `preparable` | Frozen invalid fixture exists; application guards pending. |
| NEG-04 | AI revision evidence is absent/unavailable without acknowledgement. | Agent 2 test mapping frozen domain error and application-only `EVIDENCE_ACK_REQUIRED`. | `preparable` | Required mapping is documented; workflow evidence pending. |
| NEG-05 | Reason is empty or reason-only command makes no semantic change. | Agent 2 tests for `CHANGE_REASON_REQUIRED` and controlled `INVALID_TRANSITION/NO_SEMANTIC_CHANGE`. | `preparable` | Command policy is explicit; workflow evidence pending. |
| NEG-06 | Base/latest/state version is stale. | Agent 2 atomic commit tests; Agent 3 state/run token tests when used. | `preparable` | Stable codes are explicit; port evidence pending. |
| NEG-07 | Idempotency key is reused with a different payload. | Both implementation agents plus Integrator root conflict test. | `preparable` | Frozen invalid fixture exists; adapter evidence pending. |
| NEG-08 | Same revision ID carries changed payload. | Agent 3 maps frozen diff error to controlled details without renaming the original code. | `preparable` | Frozen domain case is executable; application mapping pending. |
| NEG-09 | Caller supplies changed roots, graph edges or impacted list. | Agent 3 public signature/source inspection and Integrator compile/runtime boundary test. | `preparable` | The forbidden authority fields are explicit; public module pending. |
| NEG-10 | Nodes, edges, object keys or logical inputs are shuffled. | Agent 3 deterministic impact/canonicalization tests and Integrator equality assertion. | `preparable` | Unicode code-point rule is frozen; wrapper evidence pending. |
| NEG-11 | Impact disposition is duplicate or stale. | Agent 3 atomic review test using exact current status/token and unchanged audit on rejection. | `preparable` | Stable `IMPACT_STALE` precedence is fixed; implementation pending. |
| NEG-12 | Handoff version, graph or impact run does not match. | Agent 3 exact identity-closure test; Integrator pins V2 and exact run. | `preparable` | Required closure fields are explicit; handoff implementation pending. |

## Architecture and security checks

| Check | Pass 1 oracle/evidence | State | Boundary of the claim |
|---|---|---|---|
| Frozen domain/contracts/fixtures remain unchanged. | `architecture-v1.contract.test.ts` recalculates every file hash and the aggregate from the frozen manifest without Git. | `preparable` | Detects byte changes to the 51 frozen inputs only. |
| Application remains delivery/vendor/storage independent. | Oracle scans only production TypeScript under the two application tracks and rejects Next.js, Supabase, app/delivery, storage, private-domain and external SDK imports. | `preparable` | Static import inspection does not prove runtime authorization or deployment isolation. |
| Test persistence is not a production export. | Oracle inspects production application `index.ts` files for test-support paths and test-adapter symbol names. | `preparable` | Naming/path inspection complements, but does not replace, review of exact handoff files in Pass 2. |
| Actor/time/organization/project authority is server-owned. | Agent 2/3 targeted negative tests plus Agent 1 Pass 2 source review of command types and context construction. | `preparable` | L1 proves application policy only, not authentication/RLS. |
| State, idempotency record and audit intent are logically atomic. | Owning port tests must inject conflict/failure and show no partial mutation. | `preparable` | An in-memory adapter does not prove database or cross-process atomicity. |
| Structured audit excludes raw payload/excerpt/free-text reason/filename/URL/provider response. | Agent 2/3 audit intent assertions and Pass 2 field inspection. | `preparable` | Does not prove production log scrubbing; production is outside Wave 2. |
| Durable transactions, RLS, regional cell isolation and restart-safe idempotency. | Requires DB1/DB2, production adapters and disposable database tests. | `blocked` | Explicitly L2 and forbidden by the current baseline; not required for A1–A5. |

## Integrator decisions and compatibility mappings

The Integrator resolved the only conditional frozen-manifest conflict: Wave 2 keeps
`lib/project-intelligence/index.ts` unchanged and composes through the new
`lib/project-intelligence/application/index.ts`. The root public re-export is deferred,
so the manifest remains unconditional.

Architecture v1/L1 vocabulary has Wave 2 precedence. A later transport adapter must make
the older vertical proposal compatibility explicit:

- application `IMPACT_STALE` → older transport `INVALID_TRANSITION` representation;
- application `dismissed` → older `not_applicable` representation;
- audit `impact_run_created` → older `impact_set_calculated` representation;
- audit `logical_handoff_built` → older `handoff_generated` representation.

These mappings must not rename frozen domain error codes or alter frozen fixture content.
