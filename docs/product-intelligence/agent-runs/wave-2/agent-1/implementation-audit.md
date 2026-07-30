# Wave 2 implementation audit

Audit date: 16 July 2026.
Guardian scope: exact Agent 2, Agent 3 and Integrator handoffs against Architecture v1,
the L1 specification, the Pass 1 acceptance matrix and the 51-file frozen manifest.

## Verdict

```text
PASS_2_VERDICT=accepted_candidate
OPEN_P0=0
OPEN_P1=0
OPEN_P2_CODE_FINDINGS=0
RESOLVED_P0=1
RESOLVED_P1=2
RESOLVED_P2_HARDENING=1
FROZEN_INPUTS=51/51 verified
FROZEN_INPUT_AGGREGATE_SHA256=73bec18122badb492dc989904978e4ff9962ca063359f1e6a4d3483720e67eec
TRUSTED_FULL_TESTS=24 files, 171/171 passed
L2_DURABILITY_OR_PRODUCTION_SECURITY_CLAIM=false
```

The initial Agent 3 handoff had one P0 and two P1 findings. The Integrator returned the
P0 to the owner; the owner added RED regressions, corrected the application boundary and
returned a stable GREEN handoff. A workflow loaded-state hardening item was also corrected
by the Integrator. Independent post-correction probes and the complete validation ladder
below pass. Final Wave 2 acceptance remains an Integrator decision.

## Exact audited handoff

The hashes below are the final canonical-workspace bytes inspected by the guardian.
Relevant implementation/test bytes matched the trusted validation copy byte-for-byte.

### Agent 2 workflow

| File | Final SHA-256 |
|---|---|
| `lib/project-intelligence/application/workflow/canonical.ts` | `e65c44f6497f6e7758b147e4a105c02c7f902bc9a25cdab24dc0678481507daf` |
| `lib/project-intelligence/application/workflow/contracts.ts` | `1e62a06031677e8d5f761acbe0c7b051168bc8420397cf9eda95fb3176b39ff9` |
| `lib/project-intelligence/application/workflow/index.ts` | `78fcbdce5ee75391cfae43074ffd5284c6564e1c10618c3b8c9341d37d3c47aa` |
| `lib/project-intelligence/application/workflow/service.ts` | `fd8747ddf2c94e56724acca1951096ad5090b1e1c4d982b0396b76195cfce143` |
| `lib/project-intelligence/application/workflow/workflow.test.ts` | `7784b2461f1b30878c9c163e3def5c7fa120cd9125caf052c90cef317c1c12cb` |
| `docs/product-intelligence/agent-runs/wave-2/agent-2/STATUS.md` | `d588fd6259652f9bc09a4b2a883946f9759e543443f52dcabb7b59415af69e7f` |
| `docs/product-intelligence/agent-runs/wave-2/agent-2/interface-summary.md` | `f7373bf2018e1dad7d4d72ce97db054d6959cc51b445e1473bca326a180b9879` |
| `docs/product-intelligence/agent-runs/wave-2/agent-2/validation-report.md` | `7c065507513622b20f490f45d16bc41f21d90a76edd95f26ed4d5c49801122e6` |

The first handoff matched Agent 2's reported bytes. The final two workflow hashes differ
because the Integrator subsequently tightened loaded published-ChangeSet validation and
added its regression; that amendment is explicitly audited below.

### Agent 3 change-handoff

| File | Final SHA-256 |
|---|---|
| `lib/project-intelligence/application/change-handoff/__tests__/support/fixtures.ts` | `1b24847f3404205da680d40c2695593538fd9ef91337569f7d2a7660700f19f3` |
| `lib/project-intelligence/application/change-handoff/canonical.test.ts` | `5fa73413e57be131718fccd2236fb8a57dbcd98e5672fe4f777dbf7d602cb955` |
| `lib/project-intelligence/application/change-handoff/canonical.ts` | `e98a52c28f8c9b683f5054c0a8399de1c476c32e230f1e3d472a61e4aa2ec98e` |
| `lib/project-intelligence/application/change-handoff/impact-run.test.ts` | `63bfab1188a389a8cfd66ccdfa91c81c85418171f2b7bd72b444e47fa8042ce0` |
| `lib/project-intelligence/application/change-handoff/index.ts` | `06b5edad664e4a11e9b644311231a8e7fd56a0271b82c6f48475aad40b6c0584` |
| `lib/project-intelligence/application/change-handoff/logical-handoff.test.ts` | `dad6965824bd350f389ef68361227172c2900780083f60d1d52ec4c52cb49762` |
| `lib/project-intelligence/application/change-handoff/review-impact.test.ts` | `0f2c1e6281e130960bec9da68e766633adac18f45208049ef33a5596c377d900` |
| `lib/project-intelligence/application/change-handoff/service.ts` | `ce535d1977caa6aa3e741eac61fe8650a2de911cf79cdfdce38b3784b2dbd3ea` |
| `lib/project-intelligence/application/change-handoff/types.ts` | `73a502a323a06c0e56ede87d5f4b2e5e0bc6d6c68fccf85c7c9a923c91a6d29f` |
| `docs/product-intelligence/agent-runs/wave-2/agent-3/STATUS.md` | `030eaedf4e0aea3fe7afa943dd9dcf6141e6ba9dfe5457981501cd6166663c43` |
| `docs/product-intelligence/agent-runs/wave-2/agent-3/interface-summary.md` | `f53289fce3099d3f804da2dabeea563250d55b31b6dd31ac7b8563febca53bd8` |
| `docs/product-intelligence/agent-runs/wave-2/agent-3/validation-report.md` | `e535ef4e78ff32ff9d6daef30b1cdb32717faa73fb7eb0cd9d92ce4b05a1abc8` |

### Integrator composition

| File | Final SHA-256 |
|---|---|
| `lib/project-intelligence/application/index.ts` | `7dd86d6f2a906b6e7f976edd53cac28958534489ee9a5489a06bd855b4a1028b` |
| `tests/project-intelligence/application/vertical-slice-l1.integration.test.ts` | `77ed7d4144dbd7ba8696baa2e44446d4422b662006fe5e021aba72bcbfea137b` |

The frozen `lib/project-intelligence/index.ts` was not changed. Composition occurs only
through the new application index, as required by Integrator decision D-001. No public
production index exports the test fixture adapter or a test persistence implementation.

## Findings and resolution ledger

### P0-01 — runtime impact-review vocabulary allowed audit injection — resolved

The initial handoff relied on TypeScript-only `ImpactDisposition` and accepted every
runtime value from `needs_review`. A direct probe persisted and audited
`forged_runtime_value`; the same probe accepted `Client email alice@example.com` as a
reason code and copied it into structured audit metadata. This violated DOD-10, NEG-11
and the controlled-code/redaction contract.

The corrected boundary exports a six-value `IMPACT_REASON_CODES` vocabulary, validates
disposition/status/reason and stored reviews at runtime, and rejects before digest,
mutation or audit. Independent post-fix output:

```json
{
  "forged": {
    "ok": false,
    "code": "DOMAIN_CONTRACT_VIOLATION",
    "reasonCode": "INVALID_IMPACT_DISPOSITION"
  },
  "freeText": {
    "ok": false,
    "code": "DOMAIN_CONTRACT_VIOLATION",
    "reasonCode": "INVALID_IMPACT_REASON_CODE"
  },
  "inputStateUnchanged": true
}
```

### P1-01 — ImpactRun did not bind the exact graph or full ChangeContext — resolved

The initial `ImpactRun` retained only `targetGraphVersionId`. A same-version probe changed
`evidence-item-plan-r1.sourceFragmentId` from the plan fragment to the questionnaire
fragment. Both builds succeeded and the semantic hash changed from the accepted
`9c7d1e...` hash to `651e07...`. A second source review found that build could also
substitute a different ChangeContext reason while keeping the same run IDs.

The corrected run stores an immutable normalized `changeContext` and
`targetGraphDigest`; its result digest also includes the graph digest. Build compares the
full context and recomputed normalized graph digest before logical-content construction.
Independent post-fix output:

```json
{
  "graphSubstitution": {
    "ok": false,
    "code": "INVALID_TRANSITION",
    "reasonCode": "HANDOFF_TARGET_GRAPH_DIGEST_MISMATCH"
  },
  "contextSubstitution": {
    "ok": false,
    "code": "INVALID_TRANSITION",
    "reasonCode": "HANDOFF_CHANGE_CONTEXT_MISMATCH"
  }
}
```

The accepted fixture remains computed rather than hardcoded:

```text
targetGraphDigest = sha256:b962aeb9298e6204f8ea63d0fdd8276ccccc302cc504c76aa469d999be554ae0
resultDigest      = sha256:9b8d15a43c282f677d668b3dcad87072f5058773d73b24b2ea435c44d19e5ced
handoffHash       = sha256:9c7d1eddd1278bda3308fc8c41b20908ee3f600e08848b49a910484fb3e8484b
```

### P1-02 — canonical sparse-array shape collision — resolved

The initial change-handoff canonicalizer produced `[]` for both `Array(1)` and `[]`, so
distinct runtime shapes could collide in a request or semantic digest. The corrected
canonicalizer accepts only dense enumerable data-property elements and rejects augmented,
accessor and symbol-bearing arrays. Independent post-fix output:

```text
sparse    → TypeError: Canonical JSON requires dense arrays without named properties.
augmented → TypeError: Canonical JSON requires dense arrays without named properties.
accessor  → TypeError: Canonical JSON requires dense data-property array elements.
```

### P2-01 — loaded published ChangeSet allowed a non-immediate version pair — resolved

Normal workflow commands could not create this state, but the loaded-state validator
initially accepted a published ChangeSet when `toVersion.versionNo` was merely greater
than `fromVersion.versionNo`. The final validator also requires
`toVersion.baseVersionId === fromVersion.id` and
`toVersion.versionNo === fromVersion.versionNo + 1`. The regression mutates a valid V1→V2
ChangeSet to V1→V3 and receives controlled `CHANGE_SET_TO_SNAPSHOT_MISMATCH` without a new
audit event.

## Architecture and acceptance review

| Area | Final evidence and conclusion |
|---|---|
| Actor/time trust | Commands keep execution context separate from business payload. Workflow captures and freezes context/command before awaits; all human actions require runtime `actorType=human`. Change-handoff validates actor/capability enums and uses context time/actor in records and audit. |
| Organization/project closure | Workflow checks actor, state, draft, versions, ChangeSets, nodes and revisions. Change-handoff checks context, version, graph, run, impacts and reviews before mutation. Cross-project negative tests pass. |
| Immutable revisions/versions | Workflow validates same-ID revision content and stable node identity across draft/published snapshots, exact base chain and immediate ChangeSet pair; published V1 remains byte/deep equal through V2. |
| Command capture and TOCTOU | Workflow snapshots mutable caller inputs before async digest/ID/port calls, rechecks state through a conditional atomic commit and handles the same-key commit race as replay/conflict. Change-handoff is a synchronous pure transition returning immutable next state and audit intents for an owning atomic port. |
| Idempotency/no partial state | Keys are scoped by organization/project/operation. Same digest replays the stored logical result with no second audit; different digest conflicts. Workflow port tests inject CAS failure/race; all stale/conflict probes preserve state/audit/idempotency. L1 makes no restart-durability claim. |
| Diff roots and impact paths | Agent 3 calls only frozen `diffProjectVersions`, `changedNodeIds` and `calculateChangeImpact`; the caller cannot supply roots/impacts/edges. Golden output is exactly one `/material` change and the three accepted paths; `conflicts_with` Risk is absent. |
| Review lifecycle | Runs/impacts remain immutable, reviews are separate immutable records, runtime disposition/status/reason vocabularies are enforced, and accepted vs resolved/dismissed partitioning is deterministic. |
| Exact handoff and hash | Build requires exact published V2, full stored run, exact review snapshot, exact full ChangeContext and exact normalized graph digest. Canonical keys use code-point order; contract arrays are normalized; volatile artifact fields remain outside the semantic hash. |
| Audit redaction | Workflow protected free-text decision reason is absent from audit. Impact review audit accepts only controlled IDs/status/disposition/reason values. Source payload, excerpts, filename, signed URL and provider response are not projected into structured audit. |
| Ownership/freeze | Oracle import/export checks pass. The complete 51-file frozen set hashes exactly; no migration, package/config, root domain index, app/API/UI or production adapter was changed by Agent 1. |
| Root vertical slice | The Integrator scenario executes human review → immutable V1 → human r2 + ChangeSet → exact V2 → diff/impacts/reviews → logical handoff, plus replay/conflict/no-partial-state assertions. It passes with the accepted logical content/hash. |

All DOD-01 through DOD-14 and NEG-01 through NEG-12 have executable application or root
evidence. DOD-15 is satisfied for the trusted materialized validation copy. This does not
change Architecture v1's DB1/DB2 prerequisites or authorize L2.

## Independent validation

Trusted working directory:

```text
/private/tmp/pi-agent2-domain-validation
```

| Command/evidence | Result |
|---|---|
| Manual forged-disposition/free-text-reason probe | Both rejected with controlled codes; input state unchanged |
| Manual graph/ChangeContext substitution probe | Both rejected with controlled exact-binding codes |
| Manual sparse/augmented/accessor-array probe | All three rejected with `TypeError` |
| Filtered adversarial Vitest probes | 6 focused cases passed across canonical, workflow, review and handoff tests |
| `node fixtures/project-intelligence/kitchen-worktop/validate.mjs` | exit 0; 17 JSON, 3 sources, 3 fragments, 3 impacts; privacy scan passed |
| Architecture oracle | 1 file, 6/6 passed |
| Workflow targeted | 1 file, 18/18 passed |
| Change-handoff targeted | 4 files, 33/33 passed |
| Root L1 integration | 1 file, 1/1 passed |
| `npm test -- --reporter=dot` | 24 files, 171/171 passed |
| `npm run typecheck` | exit 0 |
| scoped ESLint over application + application tests | exit 0, no findings |
| direct manifest recalculation | 51/51; aggregate equals `73bec181...`; mismatches `[]` |

The architecture oracle specifically passed byte verification without Git, both
production-boundary import checks and the no-test-support-export check. Relevant final
workflow, change-handoff, application-index and root-integration bytes were identical in
the canonical workspace and trusted copy before the final commands ran.

## Remaining scope boundary

No open L1 P0, P1 or P2 code finding remains from this audit. The following are explicit
L2 prerequisites, not evidence gaps silently treated as passing:

- production atomic persistence adapter and disposable database concurrency tests;
- restart-safe/cross-process idempotency;
- RLS, regional cell isolation and production authorization;
- append-only audit storage and production log-scrubbing verification;
- real storage, signed-URL, renderer and delivery adapters.

## Explicit change statements

```text
Agent 1 business implementation changed: NO
Production data/PII read: NO
Database/schema/RLS changed: NO
Migrations changed/applied: NO
Frozen domain/contracts/fixtures changed: NO
Package/config/lock files changed: NO
Root frozen domain index changed: NO
App/API/UI changed: NO
Deployment performed: NO
Git add/commit/push/restore/reset performed: NO
```
