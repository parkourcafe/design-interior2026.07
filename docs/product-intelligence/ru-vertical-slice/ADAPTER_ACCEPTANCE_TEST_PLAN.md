# RU DB2 / Storage adapter acceptance test plan

Дата: 16 июля 2026 года.
Статус: test contract; blocked tests identify missing interface, not permission to
implement it.

## Acceptance rule

Adapter gate becomes green only when every `P0` test is executable and passes on both
PostgreSQL 16 and 17. `BLOCKED` is not equivalent to `PASS`.

```text
TARGET:
  STATIC_CONTRACT=true
  DOMAIN_MAPPING=true
  STORAGE=true
  AUTH_RLS=true
  PG16=true
  PG17=true
  CONCURRENCY=true
  RESTART_REPLAY=true
  PRODUCTION_CHANGED=false
```

## A. Static boundary tests

| Test ID | Assertion | Current |
|---|---|---|
| RU-A001 | Application code contains no direct `.schema("project_intelligence").from(...)` access | Test to add when adapter exists |
| RU-A002 | Human routes use request-bound client, never admin client, for four human RPC | Test to add |
| RU-A003 | Worker routes expose only `calculate_impact` and `build_handoff` through server-only code | Test to add |
| RU-A004 | Browser bundle cannot import `lib/supabase/admin.ts` or service-role env | Existing architectural rule; adapter-specific test pending |
| RU-A005 | RPC names and argument identities equal the six frozen DB2 signatures | Covered in DB2 harness; adapter contract test pending |
| RU-A006 | No route returns raw Postgres errors/private relation names | Test to add |
| RU-A007 | No new RU execution module is added while current `AGENTS.md` guardrail remains unchanged | Required governance check |

## B. Input and graph mapping tests

| Test ID | Assertion | Current |
|---|---|---|
| RU-B001 | Project and organization IDs are UUIDs before any DB call | Current RU fixture fails |
| RU-B002 | SHA-256 input is exactly 64 hex chars and is converted to 32 raw bytes | Pure import validator covers hex; DB adapter missing |
| RU-B003 | PDF/XLSX/image/email/plain-text map to exact DB source + locator kinds | Specified; adapter missing |
| RU-B004 | Raw DWG and RAR are rejected as direct DB2 evidence sources | Missing |
| RU-B005 | A DWG-generated PDF/PNG preview is accepted with the preview's own checksum | Missing |
| RU-B006 | Every AI extracted/interpreted revision has an evidence link | Covered at DB2 closure level |
| RU-B007 | Every published source/fragment/evidence row is version-scoped | Covered at DB2 closure level |
| RU-B008 | Room, work, material, estimate and deliverable IDs/stable keys are deterministic and unique | Missing DB-ready RU golden |
| RU-B009 | WBS dependencies never cross room/trade unless explicitly declared | Current `buildRuWbs()` fails for general multi-room input |
| RU-B010 | RUB amounts and signed deltas are safe integers; overflow/fractions fail | Current domain validation is incomplete |
| RU-B011 | Change order refers to an existing published baseline and valid current decision | Missing adapter command |

Required DB-ready golden fixture:

```text
organization/project UUID
real 64-hex source hashes
at least 2 rooms
at least 2 trades
explicit WBS dependencies
work + rough material + finish material + equipment
one design-decision revision
one photo source per accepted room
one no-change path and one changed-version path
```

## C. Storage tests

| Test ID | Assertion | Current |
|---|---|---|
| RU-C001 | Bucket is `client-uploads` and remains private | Covered by baseline harness |
| RU-C002 | Object key equals the deterministic RU/org/project/hash pattern and contains no original filename | Missing |
| RU-C003 | Upload uses `upsert:false` | Existing legacy routes do; RU adapter missing |
| RU-C004 | MIME and file-size rejection happens before upload | Missing RU limits |
| RU-C005 | Retry of the same content produces one logical Source and no duplicate object | Blocked by missing ingestion RPC |
| RU-C006 | Same filename with different bytes produces different object/source identities | Blocked |
| RU-C007 | DB registration failure leaves no durable untracked object, or cleanup runbook finds/removes it | Blocked |
| RU-C008 | Outsider cannot upload, list, sign or delete project objects | Blocked by missing DB2 authorization probe |
| RU-C009 | Signed URL TTL ≤ 15 minutes and URL is absent from graph/audit/handoff | Missing adapter |
| RU-C010 | Raw archive is expanded before registration; supported leaves retain individual hashes | Missing ingestion pipeline |

## D. Enrollment, read model and RLS tests

| Test ID | Assertion | Current |
|---|---|---|
| RU-D001 | Enrollment creates organization/member/capabilities/workflow atomically and idempotently | BLOCKED: no RPC |
| RU-D002 | Duplicate enrollment replay returns the same logical result | BLOCKED |
| RU-D003 | Outsider cannot enroll into or read another organization | BLOCKED |
| RU-D004 | Suspended organization/inactive member cannot read, upload or mutate | BLOCKED |
| RU-D005 | Read projection returns only exact project graph/version/handoff data | BLOCKED: no query interface |
| RU-D006 | Legacy project access without matching DB2 membership is denied | BLOCKED |
| RU-D007 | DB2 membership without a valid enrolled project root cannot access Storage | BLOCKED |
| RU-D008 | `service_role` is not accepted by human RPC and `authenticated` is not accepted by worker RPC | Covered by DB2 ACL harness |

## E. Six accepted mutation tests

| Test ID | Assertion | Current |
|---|---|---|
| RU-E001 | Claim review maps exact IDs/state/decision/idempotency key | DB2 covered; HTTP adapter missing |
| RU-E002 | Baseline publication freezes exact nodes, sources, fragments, evidence, reviews and edges | DB2 covered after graph exists |
| RU-E003 | Design revision creates one new revision, review and ChangeSet, with protected reason absent from audit | DB2 covered |
| RU-E004 | Version 2 publishes pending ChangeSet exactly once | DB2 covered |
| RU-E005 | Impact calculation uses the frozen version pair and depth cap | DB2 covered |
| RU-E006 | Impact review CAS rejects stale/concurrent status | DB2 covered |
| RU-E007 | Handoff refuses incomplete impact review chains | DB2 covered |
| RU-E008 | Same key/same request replays; same key/different request conflicts | DB2 covered |
| RU-E009 | Each successful command increments root state exactly once | DB2 covered |
| RU-E010 | HTTP adapter maps P100x errors to stable status/body without leaking SQL | Missing |

## F. Procurement, photo and construction handover tests

These are mandatory for the requested RU execution workflow but cannot be backed by
the current DB2 contract.

| Test ID | Assertion | Current |
|---|---|---|
| RU-F001 | Procurement accepts only `planned → requested → ordered → paid → delivered → accepted` | Pure function only |
| RU-F002 | Concurrent procurement transition has one winner and one stale result | BLOCKED |
| RU-F003 | Transition persists actor, server time, command record and controlled audit | BLOCKED |
| RU-F004 | Photo report binds image checksum/object, room, milestone and human acceptance | BLOCKED |
| RU-F005 | Accepted room requires at least one accepted photo from the same project/version | `canHandover()` pure only; DB blocked |
| RU-F006 | Cross-project photo/evidence binding fails composite FK/command validation | BLOCKED |
| RU-F007 | Construction handover freezes accepted rooms, photo evidence, acts and warranty archive paths | BLOCKED |
| RU-F008 | A project with no ChangeSet can complete an explicitly approved no-change handover path | BLOCKED |

## G. Handoff canonicalization tests

| Test ID | Assertion | Current |
|---|---|---|
| RU-G001 | Independently canonicalized DB2 `logicalContent` matches returned `semanticContentHash` | DB2 canonical oracle exists; adapter check missing |
| RU-G002 | Object-key order does not change hash; array order does | Covered by DB2 harness |
| RU-G003 | `artifactId`, `generatedAt`, `jobStatus`, `signedUrl` never enter hashed logical content | Covered by DB2 + adapter check pending |
| RU-G004 | RU fixture hash is never used as the DB2 persisted handoff digest | Missing explicit adapter test |
| RU-G005 | Replay returns the same logical handoff; a new key with the same semantic tuple does not create a duplicate | Covered by DB2 uniqueness/idempotency harness |

## H. Full disposable gate

After the missing contracts are designed and separately authorized:

```text
1. clean bootstrap legacy baseline
2. DB2 core + operations
3. future additive adapter-prerequisite migration(s)
4. Storage prelude/private bucket assertion
5. DB-ready RU/Kora-derived sanitized golden ingestion
6. HTTP adapter tests
7. RLS/negative tenancy tests
8. rollback injection
9. real multi-session races
10. database restart + idempotent replay
11. repeat on postgres:16-alpine
12. repeat on postgres:17-alpine
```

Production remains closed until this gate is green and a separate adoption plan is
approved.
