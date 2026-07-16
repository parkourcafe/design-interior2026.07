# DB2 — local harness readiness

Дата: 16 июля 2026 года.

```text
LOCAL_DB_INFRASTRUCTURE_READY=true
SUPABASE_CLI_AVAILABLE=false
HOST_PSQL_AVAILABLE=false
CACHED_POSTGRES_16_IMAGE=true
DB2_EXECUTION_ALLOWED=false
```

Colima и Docker работают. В локальном cache есть `postgres:16-alpine`; внутри доступны
PostgreSQL 16.14 `psql`, `pgbench`, `pg_isready` и `timeout`. Поэтому DB-level
concurrency/RLS harness можно выполнить полностью локально, с `--pull=never`,
`--network none` и без опубликованных портов.

Supabase CLI не обязателен для DB-level доказательств, но test prelude должен корректно
моделировать `auth.uid()` через JWT/session GUC и выполнять проверки с
`SET LOCAL ROLE authenticated`.

## Planned structure

```text
tests/db2/
  run.zsh
  00_supabase_prelude.sql
  10_seed.sql
  20_schema_assertions.sql
  concurrency/
    same-key-replay.sql
    conflicting-digest.sql
    cas-race.sql
    publish-uniqueness.sql
    impact-review-race.sql
  security/
    cross-tenant-rls.sql
    append-only.sql
  atomicity/
    install-fault-trigger.sql
    assert-rollback.sql
  restart/
    assert-replay-before.sql
    assert-replay-after.sql
```

Harness не создаётся до `DB1_ACCEPTED=true`, чтобы не закреплять неверный migration root,
table names или RPC contract.
