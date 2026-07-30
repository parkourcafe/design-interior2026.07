# Project Intelligence DB2 disposable harness

This harness validates the materialized adoption baseline and additive Project
Intelligence migrations without connecting to Supabase or any existing database.

```text
production credentials required: no
network required by running database: no
published host ports: none
production migration ledger changed: no
```

Run from the repository root:

```bash
tests/db2/run.zsh
```

The default image is `postgres:16-alpine`, which is already available locally. For the
production-major verification use:

```bash
PI_DB_IMAGE=postgres:17-alpine tests/db2/run.zsh
```

The runner:

1. creates an isolated throwaway database container with `--network none`;
2. installs only the minimal Supabase-compatible roles, `auth.uid()` and Storage bucket
   catalog required by the migrations;
3. applies every active timestamped migration in lexical order and proves that the
   production-adoption baseline cannot be executed twice;
4. compares the legacy catalog with the exact captured relation, column, constraint,
   index, policy, function, trigger, enum, role/grant and Storage-bucket contract;
5. checks the exact 31-table Project Intelligence surface, FORCE RLS, composite tenant
   FKs, FK indexes, append-only and closure triggers, API/private-function ACLs, and the
   exact human/worker executor table privileges;
6. checks canonical JSON against external Unicode, SHA-256, ECMAScript-number boundary
   and IEEE-754 rounding vectors;
7. executes the full six-operation path plus rollback, idempotency-conflict,
   append-only, RLS and composite-FK negative tests;
8. runs real blocked multi-session replay, stale-CAS, publication and impact-review
   races, then restarts PostgreSQL and verifies durable replay;
9. destroys the container on exit.

Numeric legacy migrations must not remain under `supabase/migrations`. They are evidence,
not an executable chain.
