# RU DB2 revalidation

Date: 16 July 2026

Scope: local RU-only Project Intelligence chain after P1 hardening. No production
database, Supabase migration ledger, remote branch or deployment was changed.

## Frozen bytes used by this run

```text
12aa89db579f7608d7cb3df71e9927ae904734cb9d92b97b640766cf0607c016  20260716071024_legacy_production_baseline.sql
9315a5a547b12aac2c624da3ebb97753994dd15d6528ce85cd430d290a0a6aa5  20260716072000_project_intelligence_core.sql
a95b9681b8da98f3b99196ec0ab05b0631ab36741efaa1262fc1ea40f8cf6890  20260716073000_project_intelligence_operations.sql
```

The core hash differs from the earlier independent DB2 report because the accepted
local P1 hardening added version-evidence closure and impact depth constraints.

## Results

Both full disposable harness runs passed:

```text
DB2_HARNESS_OK image=postgres:16-alpine
DB2_HARNESS_OK image=postgres:17-alpine
```

The runs covered:

- exact legacy baseline fingerprint and reapply guard;
- DB2 schema, roles, ACL and forced-RLS assertions;
- canonical JSON cross-runtime vectors;
- sequential review/version/change/impact/handoff operations;
- rollback, tenant isolation and append-only behavior;
- snapshot/evidence/handoff immutability checks;
- RU security/region golden assertions;
- real multi-session concurrency and restart-safe replay.

## Boundary

This is a local technical acceptance result, not production authorization. The next
build layer is the RU source-ingestion and application adapter boundary. Production
adoption remains a separate controlled step.
