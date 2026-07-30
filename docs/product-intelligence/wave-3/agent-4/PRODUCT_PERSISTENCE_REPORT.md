# Wave 3 Agent 4 — Product Persistence M2/M3

Дата: 17 июля 2026 года.
Статус: локальный additive candidate; production не изменялся.

```text
PRODUCT_PERSISTENCE_M2=true
PRODUCT_PERSISTENCE_M3=true
THIN_M4_RELEASE_ACK=true
DB4_PG16=true
DB4_PG17=true
DB2_REGRESSION_PG16=true
DB2_REGRESSION_PG17=true
PRODUCTION_CHANGED=false
```

## Результат

Материализован DB-backed persistence-контур для уже принятых pure/application
контрактов ProjectCEO:

- immutable DecisionRevision и SelectionRevision с CAS, exact supersession,
  idempotency и append-only audit;
- version-scoped Evidence для sourced revisions;
- non-negative safe-integer PriceObservation в RUB с server time;
- ApprovalPackage с human-only terminal review;
- immutable ProjectBaseline;
- immutable root/work ProductionPackageVersion;
- deterministic logical-json ReleaseArtifact;
- exact distribution и acknowledgement одного recipient/version/hash;
- explicit human-approved no-change terminal;
- additive delivery projection без direct application access к private tables.

Selection добавлен как отдельный `project_intelligence.graph_nodes.kind`. Он не
маскируется под Room, Item или Task.

## Изменённые файлы

```text
supabase/migrations/20260717100000_projectceo_product_brain_persistence.sql
supabase/migrations/20260717101000_projectceo_product_brain_operations.sql
supabase/migrations/20260717101500_projectceo_product_brain_relational_hardening.sql
lib/project-intelligence/adapters/postgres/project-brain.ts
tests/db4/10_schema_security.sql
tests/db4/20_product_operations.sql
tests/db4/30_restart_replay.sql
tests/db4/adapter-contract.test.ts
tests/db4/static-boundary.test.ts
tests/db4/run-concurrency.zsh
tests/db4/run.zsh
docs/product-intelligence/wave-3/agent-4/PRODUCT_PERSISTENCE_REPORT.md
```

Existing timestamped migrations не переписывались. Новые migrations additive и
расположены после Foundation migrations Wave 3.

## Persistence surface

Private owner-only schema `projectceo_product` содержит 18 forced-RLS relations:

1. `claim_revision_descriptors`;
2. `revision_evidence_refs`;
3. `price_observations`;
4. `approval_packages`;
5. `approval_package_items`;
6. `approval_package_events`;
7. `project_baselines`;
8. `project_baseline_packages`;
9. `project_baseline_refs`;
10. `project_baseline_approvals`;
11. `production_package_versions`;
12. `production_package_version_refs`;
13. `release_artifacts`;
14. `release_distributions`;
15. `release_acknowledgements`;
16. `no_change_terminals`;
17. `command_records`;
18. `audit_events`.

Все immutable domain, command и audit relations защищены append-only triggers.
Composite foreign keys имеют supporting indexes. Exact version membership
дополнительно закреплён составным unique constraint в
`project_intelligence.version_nodes`.

Интегратор добавил отдельную additive relational-hardening migration. Она
структурно связывает exact node lineage, package ↔ baseline ↔ version,
artifact ↔ version ↔ semantic hash, distribution ↔ recipient и
acknowledgement ↔ exact distribution. Эти связи больше не зависят только от
проверок command layer.

## RPC surface

В `projectceo_product_api` опубликованы ровно 14 fixed-definer RPC:

### Human

- `append_decision_revision`;
- `append_selection_revision`;
- `append_price_observation`;
- `create_approval_package`;
- `submit_approval_package`;
- `review_approval_package`;
- `publish_project_baseline`;
- `publish_production_package_version`;
- `distribute_release`;
- `acknowledge_release`;
- `approve_no_change`.

### Worker

- `append_system_decision_revision`;
- `append_system_selection_revision`;
- `build_release_artifact`.

Human RPC доступны только `authenticated → pi_human_executor`. Worker RPC доступны
только `service_role → pi_worker_executor`. Human operations не выполняются через
service role, а worker не может выполнять terminal human approval.

## Security boundary

- application runtime не имеет grants на `projectceo_product` tables;
- все RPC имеют fixed empty `search_path` и owner `pi_table_owner`;
- Organization, actor, user, package membership/capability и server timestamp
  выводятся server-side;
- caller не передаёт `organization_id`, actor identity или timestamps;
- cross-tenant и cross-package attempts отклоняются;
- `human_origin` принимается только от human actor;
- system actor обязан использовать sourced
  `extracted | interpreted | unknown`;
- AI/system не утверждает approval автоматически;
- semantic release hash не зависит от artifact ID, timestamp, job state или URL;
- release format в текущем DB-контракте ограничен `logical_json`;
- private core evidence closure остаётся `SECURITY INVOKER` по DB2 contract и
  принудительно flush-ится внутри fixed-definer command boundary.

## Contract invariants

### Decision / Selection

- immutable revision identity;
- exact `expected_revision_id`;
- exact `replaces_revision_id`;
- reason обязателен для supersession;
- one current graph revision через CAS;
- duplicate same key/digest возвращает replay;
- same key/different digest возвращает controlled idempotency conflict;
- exact Evidence должен входить в указанную immutable evidence version.

### Price

- валюта зафиксирована как RUB;
- amount целый, неотрицательный и не превышает JavaScript safe integer;
- observation time назначается PostgreSQL;
- Evidence связан с exact SelectionRevision и version-scoped source revision.

### Approval

- package item хранит exact revision;
- `draft → submitted → approved | rejected | change_requested`;
- terminal review выполняется человеком;
- baseline publication требует exact approved revision coverage.

### Baseline / package version

- publication immutable и append-only;
- root package может публиковать full baseline;
- work package обязан передать explicit non-empty validated subset;
- каждый package-version ref входит в exact baseline;
- V2 не обновляет и не переиспользует mutable state V1.

### Release / acknowledgement

- semantic tuple уникален и повторная сборка с другим idempotency key возвращает
  controlled existing artifact;
- distribution относится к exact artifact, package version и recipient;
- acknowledgement может выполнить только exact recipient;
- acknowledgement проверяет exact semantic hash;
- один recipient подтверждает одну exact version не более одного раза;
- no-change хранится отдельной human-approved terminal записью без фиктивного
  ChangeSet.

## Application adapter

`project-brain.ts` разделяет:

- `ProjectBrainHumanPostgresAdapter`;
- `ProjectBrainWorkerPostgresAdapter`.

Adapter использует только public RPC schemas:

- `projectceo_product_api` для mutations;
- `projectceo_api.get_project_delivery` для authorized projection.

Private relations не читаются, `.from(...)` не используется. Экспорт adapter из
общего `index.ts` оставлен интегратору, чтобы не пересекать file ownership и
синхронизировать wiring с UI/Foundation.

## DB4 acceptance

DB4 применяет Supabase prelude и все migrations в чистом isolated PostgreSQL
container, затем выполняет Foundation seed и Product Brain assertions.

Покрыто:

- schema/ACL/RLS/owner/search-path checks;
- отсутствие direct private-table grants;
- exact human/worker executor matrix;
- cross-tenant и cross-package isolation;
- wrong/no evidence;
- wrong evidence version;
- forbidden system `human_origin`;
- price evidence, bounds и server time;
- baseline before approval rejection;
- exact root/work package subsets;
- immutable V1 после V2;
- semantic release replay/existing tuple;
- wrong acknowledgement recipient/hash;
- explicit no-change;
- rollback injection;
- idempotency conflict;
- concurrent same revision write;
- restart replay;
- additive `get_project_delivery`.

Concurrency proof требует:

```text
один physical revision row
один command row
один evidence ref
один state increment
один replay=false
один replay=true
```

## Verification

```text
npm run lint                                      PASS
npm run typecheck                                 PASS
npm run test                                      PASS — 48 files / 287 tests
npm run build                                     PASS

DB2 PostgreSQL 16                                 PASS
DB2 PostgreSQL 17                                 PASS
DB4 PostgreSQL 16                                 PASS
DB4 PostgreSQL 17                                 PASS
DB4 adapter/static contracts                      PASS — 9 tests
DB4 concurrency                                   PASS
DB4 rollback                                      PASS
DB4 restart replay                                PASS
```

Единственное предупреждение test runner — существующий Vite CJS Node API
deprecation warning; на результат тестов не влияет.

## SHA-256

```text
a424fa6c25eb7523b7a7b0c6bf3d7c4b9981704cb47230cf511802d62576435e  20260717100000_projectceo_product_brain_persistence.sql
8be290cbb13dcd9099157469cd9faa263a6fb9f5dacfaed1e8e405e2fd639869  20260717101000_projectceo_product_brain_operations.sql
1ac21fcc9131a9d99cfdb918ec80c27f547153b286b62ef210cdd847442394c3  20260717101500_projectceo_product_brain_relational_hardening.sql
90e96c5d5b9bf46e6eec01004a5b6a617f03014d84a366c7348a79b89c585c7b  project-brain.ts
2953427720d12303dc7eccdc461ef63147d2023b644450d0b160f342a4752e3b  db4/10_schema_security.sql
3d9a946d4c923f99b7a72c04a8255e43f6be69e14de001a7794052fbe262111c  db4/20_product_operations.sql
d1030b7bf0597fdb378cd9ea38252dc16968225969cbd1510b34f1544681e9b1  db4/30_restart_replay.sql
9e98104cd419c54898e040eb3a6314689b7b8cf2d5f5a8bcaa14d22112fc0de0  db4/adapter-contract.test.ts
731c0562a0ddfd95f71d6fb8c93b4fcc2cc71c917932f1d828de0d61fdc9d3f1  db4/static-boundary.test.ts
5a07f16515e39d1ee7a2dbe92f3cb719fc58886bf7fea920dcd3cb235a831864  db4/run-concurrency.zsh
c00eae7632ec49f696ce338ce1a4d39dcf7c3dac7780de55d270116b5f27ac34  db4/run.zsh
```

## Integration notes

1. Сначала принять Foundation migrations и adapters.
2. Затем применить обе Product Brain migrations в timestamp order.
3. Экспортировать human/worker adapters из принятого application composition
   root.
4. Заменить UI mock DTO на `get_project_delivery` и mutation RPC постепенно,
   сохраняя role separation.
5. Выполнить authenticated browser QA owner/architect/builder/client.
6. Production adoption остаётся отдельным решением с backup, rehearsal,
   observability и rollback plan.

## Known limitations

- production Supabase не изменялся;
- live Kora bytes/import не выполнялись этим контуром;
- browser/UI wiring не входит в этот file ownership;
- guest-link acknowledgement не добавлялся: текущий acknowledgement требует
  authenticated exact recipient;
- PDF/XLSX rendering не входит в DB artifact: сейчас materialized только
  deterministic `logical_json`;
- полноценный M4 ChangeRequest/photo/handover workflow остаётся отдельным следующим
  integration slice;
- accepted commit, deploy и production backfill выполняет только интегратор после
  общего gate.
