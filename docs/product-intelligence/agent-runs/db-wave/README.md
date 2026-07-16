# Project Intelligence database wave

Текущий статус:

```text
MATERIALIZED_GIT_BASELINE=true
LOCAL_SNAPSHOT_GATE_PASSED=true
AUTHORITATIVE_PRODUCTION_SNAPSHOT_RECEIVED=true
DB1_ACCEPTED=true
DB2_LOCAL_ALLOWED=true
DB2_PRODUCTION_ALLOWED=false
PRODUCTION_APPLY_ALLOWED=false
```

Артефакты:

1. [`BASELINE_GATE.md`](./BASELINE_GATE.md) — authoritative materialization decision и
   точные условия продолжения.
2. [`baseline-manifest.json`](./baseline-manifest.json) — 130-file reproducible
   reconstruction candidate, aggregate
   `6e8ba52d53bd5f797218eb96794ed0e944cb71eb1f5900e34a60a91db092ec0f`.
3. [`recovered-evidence/0008_concept_packs.sql.txt`](./recovered-evidence/0008_concept_packs.sql.txt)
   — non-executable exact local-HEAD evidence, SHA-256
   `530a166c4ae5f05b3e43aecba52c1dae4b59f8b1c46a9a771de4d48a84ad1433`.
4. [`DB1_DESIGN_CANDIDATE.md`](./DB1_DESIGN_CANDIDATE.md) — read-only schema/RLS/
   concurrency candidate; формально не принят, migrations не нумерует.
5. [`DB1_FORMAL_REVIEW.md`](./DB1_FORMAL_REVIEW.md) — conditional review, mandatory
   conditions и DB2 acceptance matrix.
6. [`DB2_HARNESS_READINESS.md`](./DB2_HARNESS_READINESS.md) — проверенная локальная
   инфраструктура и будущая структура concurrency/RLS harness.
7. [`PRODUCTION_READONLY_AUDIT.sql`](./PRODUCTION_READONLY_AUDIT.sql) — один read-only
   SQL-запрос для authoritative production ledger/schema snapshot без чтения
   application rows.

Локальный snapshot gate и DB1 пройдены. Разрешены materialized adoption baseline,
additive private-schema migrations и disposable DB2 harness. Production changes,
migration-history repair и rollout не разрешены.
