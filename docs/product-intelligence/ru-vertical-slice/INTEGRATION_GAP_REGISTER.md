# RU DB2 integration gap register

Дата: 16 июля 2026 года.
Review scope: current RU pure-domain seams, 31 DB2 relations, six DB2 RPC,
`client-uploads` Storage.

```text
INTEGRATION_READY=false
PRODUCTION_READY=false
P0_OPEN=true
MIGRATIONS_CHANGED=false
APPLICATION_CHANGED=false
PRODUCTION_CHANGED=false
```

## P0 — blocks a safe adapter

| ID | Gap | Evidence | Required closure |
|---|---|---|---|
| RU-G01 | Repository scope conflict | `AGENTS.md` explicitly excludes specifications, procurement and deep production workflow from v0.1 | Product owner must first amend/fork the repository contract; this review cannot authorize the expansion |
| RU-G02 | No organization/project enrollment command | `organizations`, members, capabilities and `project_workflows` are private; none of six RPC creates them | Narrow idempotent bootstrap/enrollment command with exact actor and audit rules |
| RU-G03 | No initial ingestion command | No RPC inserts `sources`, fragments, nodes, revisions, evidence or edges | One atomic, validated graph-ingestion command; no runtime direct table grants |
| RU-G04 | No read model | Runtime roles have no private schema/table access and the API schema exposes mutation functions only | RLS-scoped query RPC/view projection for workflow state, versions, graph and handoffs |
| RU-G05 | Storage authorization cannot be proven from DB2 | Upload needs server admin client, but there is no callable DB2 membership/project probe | Exact authorization RPC or an upload command contract binding `auth.uid()` to `(organization, project)` |
| RU-G06 | Source metadata is incomplete | `sources` has kind/checksum/path only; RU needs file name, MIME, size, revision and document status | Protected metadata projection with validation and immutable revision semantics |
| RU-G07 | Raw DWG and archives have no source kind/locator | DB2 has no CAD/archive source or locator | P0 must accept generated PDF/PNG preview only, or a later schema contract must add explicit binary/CAD semantics |
| RU-G08 | WBS/item revision command is absent | Only an existing node of kind `decision` can be revised | Generic typed item/deliverable revision command or a consciously narrower RU workflow |
| RU-G09 | Procurement transition is absent | `canAdvanceProcurement()` is pure and DB2 has no procurement relation/command/audit event | Dedicated state-transition command with CAS, actor, time, idempotency and transition constraint |
| RU-G10 | Estimate persistence/invariants are absent | RUB data would live only inside unconstrained JSON payload | Typed payload validation on both route and DB command; safe-integer and amount consistency checks |
| RU-G11 | Photo acceptance is not an admission rule | Image Source can be stored, but there is no photo-report/approval command and `build_handoff` does not check rooms/photos | Dedicated acceptance record/command frozen into the construction handover |
| RU-G12 | Logical handoff is not construction handover | Current handoff freezes selected graph/impact reviews, not accepted rooms, acts or warranty paths | Separate approved contract or explicit extension; do not relabel current logical handoff |
| RU-G13 | `build_handoff` requires an impact run | A project with no published ChangeSet has no valid `impact_run_id` | Define a no-change terminal handoff path or keep logical handoff limited to changed versions |
| RU-G14 | RU and DB2 hash shapes differ | RU fixture hashes its top-level fixture; DB2 hashes generated `logicalContent` | Adapter accepts DB2 returned semantic hash and verifies the exact DB2 canonical contract |
| RU-G15 | RU fixture is not DB-ready | `organizationId`/`projectId` are non-UUID strings and source checksum is `sha256:fixture-source` | Add a DB adapter fixture with UUIDs and real 64-hex SHA-256; keep current fixture only as domain demo |

## P1 — must close before a real pilot

| ID | Gap | Consequence | Required closure |
|---|---|---|---|
| RU-G16 | `buildRuWbs()` chains the entire input array | It creates false dependencies across rooms/trades | Explicit dependency input or deterministic room/trade ordering with a golden Kora case |
| RU-G17 | `estimateRuRub()` accepts fractions/overflow | Money can violate integer-RUB rule despite TypeScript types | Runtime safe-integer validation for qty, rate and total; overflow rejection |
| RU-G18 | `validateRuChangeOrder()` validates only identity/reason/integer deltas | Runtime JSON can contain invalid enum/status and a nonexistent baseline | Strict schema, baseline binding, actor semantics and allowed status transitions |
| RU-G19 | `canHandover()` accepts any non-empty semantic hash | It does not verify DB2 hash format/content and does not require warranty archive | Require `sha256:` + 64 hex, exact version/run binding and explicit warranty policy |
| RU-G20 | Message normalization is ambiguous | The same chat can be mapped to email, transcript or plain text differently | Deterministic media-type/parser rule and locator golden tests |
| RU-G21 | Storage write + DB registration are not atomic | Failed registration may leave an orphan object | Deterministic object key, idempotent register command, retry oracle and cleanup job/runbook |
| RU-G22 | No import/procurement/photo audit events | Current audit allowlist covers only the six L1 operations | Add only controlled, non-PII event metadata with exact allowlists |
| RU-G23 | Project membership has two models | Legacy `public.projects` ownership and DB2 organization membership can disagree | One explicit enrollment invariant and negative mismatch test |
| RU-G24 | No file-size/MIME limits in bucket | Server can accept unintended or oversized content | Route allowlist and limits; bucket-level settings if supported by adopted environment |
| RU-G25 | Original filename has privacy/audit risk | It can contain client/person/project names | Keep it out of object keys and audit; expose only through authorized protected metadata |

## Current safe conclusion

The existing six RPC can be adapted only after a graph already exists and the caller
has already been enrolled. Implementing a complete RU project screen today would
require one of two unsafe shortcuts:

1. direct private-table access from application runtime; or
2. broad `service_role` writes with authorization reconstructed in TypeScript.

Both are rejected. The next architecture work is a narrow prerequisites contract,
not UI expansion and not production adoption.
