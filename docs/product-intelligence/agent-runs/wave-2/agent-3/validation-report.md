# Wave 2 Agent 3 validation report

Validation date: 16 July 2026.

## Environment integrity

Canonical workspace `node_modules/.bin/vitest` points to an iCloud dataless file and exits
`0` without collecting tests. That output was explicitly rejected as evidence.

Trusted execution used the already materialized Wave 1 validation copy:

```text
/private/tmp/pi-agent2-domain-validation
```

Only the owned directory was copied into it:

```text
rsync -a lib/project-intelligence/application/change-handoff/ \
  /private/tmp/pi-agent2-domain-validation/lib/project-intelligence/application/change-handoff/
```

No mutating Git command, package install, package/config change or frozen-file write was
performed.

## Pass-2 RED evidence

Before implementation, the trusted clone ran the 33-test targeted suite and produced the
expected RED result: 4 files, 24 passed, 9 failed. The failures independently demonstrated:

```text
canonicalJson(Array(1)) did not throw
ImpactRun.targetGraphDigest was absent
forged actorType was persisted/audited
forged disposition was persisted/audited
free-form reasonCode was persisted/audited
forged expected status was treated as stale instead of invalid input
evidence sourceFragmentId mutation built a handoff
ChangeContext reason substitution built a different handoff
controlled reason vocabulary export was absent
```

## Exact commands and results

| Command | Working directory | Result |
|---|---|---|
| `./node_modules/.bin/vitest run lib/project-intelligence/application/change-handoff --reporter=verbose` | trusted temp | exit 0; 4 files, 33/33 tests passed |
| `npm run typecheck` | trusted temp | exit 0 |
| `./node_modules/.bin/eslint lib/project-intelligence/application/change-handoff --ext .ts` | trusted temp | exit 0 |
| `node fixtures/project-intelligence/kitchen-worktop/validate.mjs` | trusted temp | exit 0; 17 JSON, 3 sources, 3 fragments, 3 impacts; privacy scan passed |
| `npm test` | trusted temp | exit 0; 24 files, 171/171 tests passed |
| `npm run lint` | trusted temp | exit 0 |
| `npm run build` | trusted temp | exit 0; Next.js 16.2.10 compiled, typechecked and generated 16/16 static pages |

Targeted test distribution:

```text
canonical.test.ts         4 passed
impact-run.test.ts       10 passed
review-impact.test.ts    11 passed
logical-handoff.test.ts   8 passed
total                    33 passed
```

## Required acceptance coverage

| Requirement | Evidence |
|---|---|
| one decision `/material` diff | `impact-run.test.ts` golden calculation |
| roots derived internally | malicious extra root field ignored; output root is decision only |
| exact three impact paths | persisted-shape output equals `expected-impacts.json` pure paths/IDs/status |
| `conflicts_with` Risk excluded | explicit negative assertion |
| shuffled graph/version stable | run, result digest and request digest equal |
| cycles terminate/deterministic | cycle fixture returns Item then Deliverable once; root excluded |
| cross-project/version rejected | `PROJECT_SCOPE_VIOLATION`, `VERSION_STALE` |
| revision immutability mapping | domain `revision_immutability_violation` retained under `DOMAIN_CONTRACT_VIOLATION` |
| review split | accepted unresolved; resolved/dismissed resolved |
| AI/system review denied | `ACCESS_DENIED/HUMAN_ACTOR_REQUIRED`, state unchanged |
| stale/duplicate review atomic | `IMPACT_STALE`, input state byte-canonical unchanged |
| runtime enum enforcement | forged actor/capability/status/disposition rejected before persistence/audit |
| controlled review reasons | exported six-value vocabulary; free-form/PII reason rejected before audit |
| idempotent replay/conflict | all three operations test replay, empty replay audit, conflict without mutation |
| exact graph binding | calculation persists normalized graph digest; changed evidence→fragment binding rejected |
| exact ChangeContext binding | full normalized calculation context persisted; changed handoff reason rejected |
| exact review run binding | review digest includes full run; changed run context conflicts instead of replay |
| repeatable hash/volatile excluded | repeated computed hash; artifact metadata absent from logical content |
| shuffled logical inputs stable | target version/graph/reviews/policy permutations preserve digest/content/hash |
| mismatched handoff version/run | controlled `INVALID_TRANSITION` |
| canonical array shape | sparse, augmented and accessor-shaped arrays cannot collide with dense JSON arrays |

Additional coverage includes server capability denial, stale state token, no-impact diff,
exact run tampering, accepted→resolved transition, controlled dismissed reason, immutable
outputs, stored review runtime validation and audit actor/time derivation.

## Golden semantic hash evidence

Implementation output logical content equals the accepted fixture's `logicalContent`.
`semanticSha256(logicalContent)` computed:

```text
sha256:9c7d1eddd1278bda3308fc8c41b20908ee3f600e08848b49a910484fb3e8484b
```

No implementation constant contains this digest. The only literal appears in the test as
the accepted oracle and in this validation report as evidence.

## Calculation binding hashes

The calculation probe used the frozen kitchen-worktop V2 graph and normalized array order.
The implementation computed:

```json
{
  "targetGraphDigest": "sha256:b962aeb9298e6204f8ea63d0fdd8276ccccc302cc504c76aa469d999be554ae0",
  "resultDigest": "sha256:9b8d15a43c282f677d668b3dcad87072f5058773d73b24b2ea435c44d19e5ced",
  "changeContext": {
    "projectId": "project-kitchen-001",
    "fromVersionId": "version-kitchen-001-v1",
    "toVersionId": "version-kitchen-001-v2",
    "changeSetId": "change-set-kitchen-v1-v2",
    "reasonCode": "schedule_constraint"
  }
}
```

Both digest literals are test/report oracles only. Production code always computes them.

## Owned code/test SHA-256 ledger

```text
1b24847f3404205da680d40c2695593538fd9ef91337569f7d2a7660700f19f3  __tests__/support/fixtures.ts
5fa73413e57be131718fccd2236fb8a57dbcd98e5672fe4f777dbf7d602cb955  canonical.test.ts
e98a52c28f8c9b683f5054c0a8399de1c476c32e230f1e3d472a61e4aa2ec98e  canonical.ts
63bfab1188a389a8cfd66ccdfa91c81c85418171f2b7bd72b444e47fa8042ce0  impact-run.test.ts
06b5edad664e4a11e9b644311231a8e7fd56a0271b82c6f48475aad40b6c0584  index.ts
dad6965824bd350f389ef68361227172c2900780083f60d1d52ec4c52cb49762  logical-handoff.test.ts
0f2c1e6281e130960bec9da68e766633adac18f45208049ef33a5596c377d900  review-impact.test.ts
ce535d1977caa6aa3e741eac61fe8650a2de911cf79cdfdce38b3784b2dbd3ea  service.ts
73a502a323a06c0e56ede87d5f4b2e5e0bc6d6c68fccf85c7c9a923c91a6d29f  types.ts
```

Paths are relative to `lib/project-intelligence/application/change-handoff/`. The fixture
adapter and `index.ts` are unchanged by Pass 2 but remain in the complete Agent 3 owned
deliverable ledger.

## Frozen aggregate recheck

The Agent 1 manifest was recalculated in the canonical workspace with SHA-256 over all 51
declared frozen files and the canonical manifest lines.

```json
{
  "fileCount": 51,
  "declared": 51,
  "aggregate": "73bec18122badb492dc989904978e4ff9962ca063359f1e6a4d3483720e67eec",
  "expected": "73bec18122badb492dc989904978e4ff9962ca063359f1e6a4d3483720e67eec",
  "mismatches": []
}
```

## Final validation decision

```text
AGENT_3_A4_CANDIDATE=passed
PASS2_RUNTIME_AND_BINDING_HARDENING=passed
BLOCKERS=none
INDEPENDENT_INTEGRATOR_RERUN_REQUIRED=true
L2_DURABILITY_OR_PRODUCTION_READINESS_CLAIM=false
```
