# Agent 3 ТЗ — Change Impact & Logical Handoff

## Mission

Реализовать L1 orchestration published V1/V2 → semantic diff → deterministic ImpactRun →
human impact reviews → logical handoff and stable semantic hash. Не реализовывать workflow
review/version mutation, DB, API, storage или real document renderer.

## Read first

1. `docs/product-intelligence/architecture-v1.md`
2. `docs/product-intelligence/vertical-slice-l1-spec.md`
3. `docs/product-intelligence/domain/contract-v0.1.md`
4. all `docs/product-intelligence/vertical-slice/**`
5. frozen domain API and kitchen-worktop fixtures
6. Wave 1 integration adapter decisions

## Exclusive write scope

- `lib/project-intelligence/application/change-handoff/**`
- `docs/product-intelligence/agent-runs/wave-2/agent-3/**`

Do not edit common exports, Agent 2 scope, fixtures or frozen domain.

## Public module boundary

Create `lib/project-intelligence/application/change-handoff/index.ts`. It must expose:

- server-owned actor/execution context contract or a structurally compatible local type;
- stable application result/error contract;
- `ChangeContext` referencing exact project/from/to versions and ChangeSet ID;
- immutable `ImpactRun` and separate `ImpactReview`;
- logical handoff content/artifact descriptor types;
- `ChangeHandoffApplicationService` or clearly named façade for calculate, review and
  build handoff;
- canonicalization/hash functions needed by Integrator, without exporting test adapter.

The module must accept public domain `ProjectVersionSnapshot` and
`ProjectGraphSnapshot`; it must not import Agent 2 private files.

## Calculate impact run

Input: exact `ChangeContext`, from/to version snapshots and exact target graph snapshot.
Caller may not pass changed roots, impacted node list or graph edges separately.

Must:

1. verify project and version IDs match context;
2. call frozen `diffProjectVersions`;
3. call frozen `changedNodeIds`;
4. call frozen `calculateChangeImpact` on target graph;
5. create deterministic persisted-shape impacts with server-generated IDs and initial
   `needs_review`;
6. keep immutable algorithm/version inputs;
7. emit controlled audit intent or result metadata suitable for atomic owner commit;
8. preserve stable Unicode code-point ordering.

If there is no impact-relevant change, return controlled invalid transition and do not
invent impacts.

## Review impact

Input: exact run/impact, expected current status, disposition, controlled reason code,
expected state/token if used and idempotency identity. Actor/time server-owned.

Allowed L1 dispositions:

- `accepted` — unresolved downstream work acknowledged;
- `resolved` — downstream work completed/updated;
- `dismissed` — explicitly not applicable, reason required.

Review is a separate immutable record. Original impact and run stay unchanged. AI/system
actor cannot create human disposition. Stale/duplicate conflict does not partially mutate.

## Logical handoff

Build from exact published target version, exact graph, exact ImpactRun and reviews. The
output must be compatible with `expected-handoff.json` semantics:

- project/version/base/label;
- canonical/display metadata supplied as trusted policy input;
- areas, requirements, decisions, items, deliverables;
- source references and decision provenance;
- impacts split into unresolved/resolved;
- stable logical schema version;
- artifact descriptor with semantic SHA-256.

Canonicalization:

- recursive object keys sorted by Unicode code point;
- contract arrays explicitly sorted or deliberately preserve documented order;
- UTF-8 JSON without volatile fields;
- artifact ID, generatedAt, jobStatus and signed URL excluded;
- shuffled equivalent inputs produce identical logical content/hash.

Do not hardcode the golden hash as output. Compute it from logical content. The fixture's
hash may reveal a contract/fixture canonicalization mismatch; report this rather than
silently changing frozen input.

## Idempotency boundary

The module may express mutation persistence through a port or as transition results for an
owning atomic port. It must still test:

- same scoped key/digest → same logical result + replay flag;
- same key/different digest → `IDEMPOTENCY_CONFLICT`;
- no state/audit change on conflict.

Do not claim cross-process durability.

## Stable failures

At minimum: `ACCESS_DENIED`, `PROJECT_SCOPE_VIOLATION`, `VERSION_STALE`, `STATE_STALE`,
`IMPACT_STALE`, `IDEMPOTENCY_CONFLICT`, `INVALID_TRANSITION`,
`DOMAIN_CONTRACT_VIOLATION`.

## Required tests

1. golden diff exactly one decision `/material`;
2. roots derived internally;
3. exact three golden impact paths;
4. Risk on `conflicts_with` excluded;
5. shuffled graph/version input preserves output;
6. cycles terminate and remain deterministic;
7. cross-project/version mismatch rejected;
8. revision immutability violation maps to stable error;
9. human review statuses split unresolved/resolved correctly;
10. AI/system actor review denied;
11. stale/duplicate impact review rejected without partial state;
12. idempotent replay/conflict semantics;
13. semantic hash repeatable and volatile metadata excluded;
14. shuffled logical inputs preserve hash;
15. mismatched handoff version/run rejected.

## Handoff

Create:

- `docs/product-intelligence/agent-runs/wave-2/agent-3/STATUS.md`;
- `interface-summary.md` with exported symbols and Integrator example;
- `validation-report.md` with exact commands/results.

List every changed file and explicitly state production, migrations, frozen domain,
fixtures, package/config and Git were not changed.

## Stop conditions

Stop and report if frozen inputs are unreadable, accepted golden semantics require a
domain change, canonical hash cannot be reproduced without changing contract, or a write
outside ownership is required.
