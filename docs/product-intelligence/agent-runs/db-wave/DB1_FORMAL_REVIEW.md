# DB1 — formal design review

Дата: 16 июля 2026 года.

```text
VERDICT=ACCEPT
LOCAL_SNAPSHOT_GATE_PASSED=true
AUTHORITATIVE_PRODUCTION_SNAPSHOT_RECEIVED=true
DB1_ACCEPTED=true
DB2_LOCAL_ALLOWED=true
DB2_PRODUCTION_ALLOWED=false
FILES_CHANGED_OUTSIDE_DOCS=false
DATABASE_CHANGED=false
```

## Authoritative production reconciliation

Получен schema-only snapshot по контракту
`project-intelligence-production-schema/1.0`, captured at
`2026-07-16T07:10:24.609229+00:00`, PostgreSQL `17.6`.

```text
Attachment SHA-256:
a2f9a220399cd718cfb96fe2fb9b4ea6db824dac9e455eb7f24c3442ccd07a70

Normalized JSON SHA-256:
ef8b0d3aafd319fe8779a70ce2fc6440fd0f2fc23bb58497cb90cd64d61561b0

Authoritative migration ledger: []
```

Пустой ledger означает, что наличие объектов доказывает текущее состояние schema, но
не историю исполнения конкретных файлов.

Структурная классификация:

| Migration | Production |
|---|---|
| `0001_init` | present, включая проверенный private Storage bucket `client-uploads` |
| `0002_client_briefs` | present |
| `0003_custom_questions` | present |
| `0004_designer_profile` | present |
| `0005_rate_limits` | absent |
| `0006_team` | present |
| exact HEAD `0007_project_rooms` | schema-equivalent present |
| `0008_concept_packs` | absent |
| worktree-only `0009_project_room_workflow` | absent and rejected as executable |

Production содержит 11 `public` tables, 16 policies, 52 constraints, 31 indexes и одну
function `public.is_studio_member`. Schema `project_intelligence` отсутствует.

## Accepted direction

Архитектурное направление принято без нового ADR:

- отдельная private schema `project_intelligence`;
- opt-in enrollment через `project_workflows`;
- normalized provenance, exact revisions, immutable versions, ChangeSet, impact и
  logical handoff;
- один project-level CAS/state revision;
- append-only command/audit history;
- physical regional cells вместо runtime-переключателя региона.

## Closed decisions for DB2

1. Migration root — новый timestamped production-adoption baseline, воспроизводящий
   только доказанное production state. Он исключает отсутствующие `0005`, `0008` и
   rejected `0009`.
2. Exact `0007` не применяется и не регистрируется отдельно: его schema-equivalent
   объекты входят в adoption baseline, а исходные байты сохраняются как evidence.
3. Не применять текущий `0009`. Он содержит irreversible duplicate `DELETE`,
   client-supplied actor authority, недостаточный CAS/idempotency contract,
   `SECURITY DEFINER` с `search_path=public`, широкие grants и mutable/cascade history.
4. `0005` и `0008` не включаются в baseline и не применяются автоматически. Их
   функциональность может вернуться только отдельным будущим scope.
5. Объединить workflow и change-handoff state в один persistence coordinator:
   все шесть L1 operations блокируют одну `project_workflows` row и увеличивают один
   `state_revision`.
6. Tenant root: project-scoped tables несут
   `(organization_id, project_id)` и composite FK на `project_workflows`; global/cell
   tables не обязаны иметь `project_id`.
7. DDL invariants: project-scoped source checksum uniqueness,
   stable-node/revision uniqueness, same-node replacement lineage, evidence/unknown
   requirements, exact-review policy, immutable published snapshots, bounded IDs,
   indexed FKs, 32-byte digests и `RESTRICT` history.
8. Privilege/RLS matrix: private schema вне Data API, dedicated `NOLOGIN`
   owners without `BYPASSRLS`, `ENABLE/FORCE RLS`, no direct table access for public
   runtime roles, narrow human/worker RPCs, server-derived actor/capabilities,
   `search_path=''` и append-only enforcement.
9. Durable idempotency хранит key digest, operation, canonical request digest/version,
   actor scope, stored logical result и resulting state revision. Replay повторно
   авторизуется и не создаёт новую mutation/audit.
10. Logical deployment classification для текущей legacy базы: `cell=ru`,
    `edition=studio`. Это не доказывает физический hosting region; residency проверяется
    отдельно до production rollout.

### Accepted implementation normalization

Перед DDL Integrator принял три несемантических consolidation:

- exact revision selection хранится непосредственно в `version_nodes.revision_id`,
  поэтому отдельная `version_revisions` была бы дублирующей;
- impact roots выводятся из immutable `impact_run_changes.impact_relevant`, поэтому
  отдельная `impact_run_roots` была бы дублирующей;
- L1 использует append-only `graph_edges` + exact `version_edges`; отдельный
  `draft_edges` откладывается до появления edge branching/edit lifecycle.

Все три closure остаются normalized и composite-FK scoped. Frozen DB2 contract содержит
31 обязательную relation.

## Migration adoption rule

Adoption baseline локально проверяется на чистой PostgreSQL/Supabase-compatible БД.
Поверх существующей production базы его SQL не исполняется.

После отдельного production approval регистрируется только один timestamp baseline через
поддерживаемый Supabase migration-history workflow. До этого production ledger,
schema, data, policies и grants не меняются.

## DB2 acceptance matrix

DB2 обязан доказать:

- clean bootstrap и legacy upgrade без потери строк;
- parallel same-key/same-digest replay;
- same-key/different-digest conflict;
- one-success/one-stale CAS;
- unique concurrent publication;
- impact-review race safety;
- full rollback on injected failure;
- cross-organization RLS и composite-FK isolation;
- запрет AI/system actor на human review;
- append-only enforcement;
- restart-safe idempotency;
- exact function/table privileges.

## Verdict

DB1 принят. Разрешены materialized adoption baseline, additive private-schema DB2 SQL и
локальные disposable tests. Production apply, migration-history repair, API/UI wiring и
feature rollout остаются закрыты.
