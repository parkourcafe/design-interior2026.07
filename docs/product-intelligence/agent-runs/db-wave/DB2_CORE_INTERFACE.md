# DB2 core persistence interface

Дата фиксации: 16 июля 2026 года.
Contract: `project-intelligence-db2-core/1.0`.

Этот документ фиксирует SQL interface между additive core migration, шестью L1
operations и disposable harness. Он не разрешает production apply.

## Accepted DB1 normalizations

DB1 candidate перечислял три возможные дополнительные relation. В frozen DB2 interface
они намеренно нормализованы без потери доказуемой closure:

- отдельная `version_revisions` не создаётся: exact `revision_id` является обязательной
  частью каждой строки `version_nodes`; один node в version выбирает ровно одну revision;
- отдельная `impact_run_roots` не создаётся: immutable `impact_run_changes` хранит exact
  changed node и `impact_relevant`; roots — строки с `impact_relevant=true`;
- отдельная `draft_edges` не создаётся в L1: `graph_edges` append-only, а exact published
  edge membership фиксируется `version_edges`. Edge branching/edit lifecycle остаётся
  будущим scope и не нужен шести принятым операциям.

Это не JSONB collapse и не потеря provenance: version/revision/root/edge identity
остаётся нормализованной и проверяемой composite FK. Изменение принято Integrator до
DDL и отражено в positive harness assertions: обязательны 31 relation.

## Roles and schemas

```text
schemas:
  project_intelligence      private tables/helpers
  project_intelligence_api  callable functions only; no tables/views

roles:
  pi_table_owner      NOLOGIN, NOINHERIT, NOBYPASSRLS
  pi_human_executor   NOLOGIN, NOINHERIT, NOBYPASSRLS
  pi_worker_executor  NOLOGIN, NOINHERIT, NOBYPASSRLS
```

`anon`, `authenticated` и `service_role` не имеют direct privileges на
`project_intelligence`. Callable functions возвращают только `jsonb` и не раскрывают
private composite types.

## Universal rules

- `organization_id` и `project_id` — UUID.
- Domain IDs — `text`, length `1..160`.
- `state_revision`, `version_no`, `revision_no`, `distance`, `step_no` — non-negative
  `bigint` в JavaScript-safe диапазоне `0..9007199254740991`.
- SHA-256 — `bytea`, exactly 32 bytes.
- Все project-scoped tables несут `(organization_id, project_id)` и direct composite FK
  на `project_workflows`, `ON DELETE RESTRICT`.
- Все child FKs дополнительно composite-scoped; cross-project UUID/text references
  невозможны.
- Every FK has a leading index.
- History uses `ON DELETE RESTRICT`; no cascade.
- Every table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- History, command and audit tables reject `UPDATE` and `DELETE` through an append-only
  trigger even if grants are accidentally broadened.
- Timestamps and actor identity in command/audit rows come from trusted function
  execution, not caller JSON.

## Tenancy and enrollment

### `deployment_cells`

```text
cell_code text PK CHECK IN ('us','ru')
created_at timestamptz
```

One migration-seeded row: `ru`.

### `organizations`

```text
id uuid PK
cell_code text FK deployment_cells
edition text CHECK IN ('studio','renovation')
legacy_designer_id uuid NULL UNIQUE FK public.designers ON DELETE RESTRICT
status text CHECK IN ('active','suspended')
created_at timestamptz
UNIQUE (id, cell_code)
```

### `organization_members`

```text
organization_id uuid
user_id uuid FK auth.users ON DELETE RESTRICT
role text CHECK IN ('owner','member')
status text CHECK IN ('active','inactive')
created_at timestamptz
PK (organization_id, user_id)
FK organization_id -> organizations
```

### `member_capabilities`

```text
organization_id uuid
user_id uuid
capability text CHECK IN (
  'review_claim',
  'publish_version',
  'revise_decision',
  'calculate_change_impact',
  'review_change_impact',
  'build_logical_handoff'
)
granted_at timestamptz
PK (organization_id, user_id, capability)
FK (organization_id, user_id) -> organization_members
```

### `project_workflows`

```text
organization_id uuid
project_id uuid FK public.projects ON DELETE RESTRICT
state_revision bigint DEFAULT 0
latest_version_id text NULL
enrolled_at timestamptz
updated_at timestamptz
PK (organization_id, project_id)
FK organization_id -> organizations
deferred composite FK latest_version_id -> project_versions
```

This row is both the pilot enrollment and the single serialization/CAS root for all six
operations.

## Provenance and current graph

### `sources`

```text
(organization_id, project_id, source_id) PK
kind CHECK IN ('pdf','transcript','audio','image','spreadsheet','email','plain_text','questionnaire')
checksum bytea(32)
storage_object_path text NULL
created_at timestamptz
UNIQUE (organization_id, project_id, checksum)
```

### `source_fragments`

```text
(organization_id, project_id, fragment_id) PK
source_id text
locator_kind CHECK IN ('pdf','transcript','image','spreadsheet','email','plain_text')
locator jsonb
created_at timestamptz
composite FK source_id -> sources
```

### `graph_nodes`

```text
(organization_id, project_id, node_id) PK
kind CHECK IN ('area','source','requirement','assumption','decision','risk','deliverable','item','approval')
stable_key text
current_revision_id text
created_at timestamptz
UNIQUE (organization_id, project_id, kind, stable_key)
deferred composite FK (node_id,current_revision_id) -> graph_node_revisions
```

### `graph_node_revisions`

```text
(organization_id, project_id, revision_id) PK
node_id text
revision_no bigint
title text
payload jsonb
origin CHECK IN ('human','ai','import','system')
claim_status CHECK IN ('extracted','interpreted','unknown')
unknown_reason text NULL
replaces_revision_id text NULL
content_digest bytea(32)
created_by_type CHECK IN ('human','ai','system')
created_by_id text
created_at timestamptz
UNIQUE (organization_id, project_id, node_id, revision_no)
UNIQUE (organization_id, project_id, node_id, revision_id)
composite FK node_id -> graph_nodes
same-node composite FK (node_id,replaces_revision_id) -> graph_node_revisions
CHECK unknown <-> non-empty unknown_reason
```

### `human_reviews`

```text
(organization_id, project_id, review_id) PK
target_revision_id text
decision CHECK IN ('confirmed','rejected')
actor_user_id uuid
reviewed_at timestamptz
composite FK target_revision_id -> graph_node_revisions
composite FK (organization_id,actor_user_id) -> organization_members
```

### `evidence_links`

```text
(organization_id, project_id, evidence_link_id) PK
node_revision_id text
source_fragment_id text
created_at timestamptz
UNIQUE (organization_id, project_id, node_revision_id, source_fragment_id)
composite FKs -> graph_node_revisions, source_fragments
```

### `graph_edges`

```text
(organization_id, project_id, edge_id) PK
from_node_id text
to_node_id text
relation CHECK IN (
  'depends_on','derived_from','specified_by','satisfies',
  'applies_to','contains','conflicts_with','references'
)
created_at timestamptz
UNIQUE (organization_id, project_id, from_node_id, to_node_id, relation)
composite FKs -> graph_nodes
CHECK from_node_id <> to_node_id
reverse-impact index (organization_id, project_id, to_node_id, relation, from_node_id)
```

## Exact published versions

### `project_versions`

```text
(organization_id, project_id, version_id) PK
version_no bigint
base_version_id text NULL
label text NULL
graph_digest bytea(32)
contract_version text
published_by_user_id uuid
published_at timestamptz
UNIQUE (organization_id, project_id, version_no)
same-project FK base_version_id -> project_versions
```

Snapshot membership:

```text
version_nodes(version_id,node_id,revision_id)
version_reviews(version_id,review_id)
version_sources(version_id,source_id)
version_source_fragments(version_id,fragment_id)
version_evidence_links(version_id,evidence_link_id)
version_edges(version_id,edge_id)
```

Every membership table carries `organization_id, project_id`, has a composite PK starting
with `(organization_id, project_id, version_id, ...)`, direct root FK, and scoped FKs to
the exact referenced records. Snapshot membership is append-only. `version_evidence_links`
has a deferred scope check: its evidence link's `node_revision_id` must be selected by
`version_nodes` in the same `(organization_id, project_id, version_id)`, preventing
cross-version evidence leakage while allowing atomic publish assembly.

## ChangeSet

### `change_sets`

```text
(organization_id, project_id, change_set_id) PK
node_id text
from_version_id text
from_revision_id text
to_revision_id text
reason_code CHECK IN (
  'schedule_constraint','budget_constraint','client_preference','scope_change',
  'technical_constraint','regulatory_requirement','correction'
)
actor_user_id uuid
occurred_at timestamptz
composite FKs -> graph_nodes, project_versions, graph_node_revisions
CHECK from_revision_id <> to_revision_id
```

Protected reason and publication are separate append-only records:

```text
change_set_reasons(change_set_id PK/FK, protected_reason text non-blank)
change_set_publications(change_set_id PK/FK, to_version_id UNIQUE/FK, published_at)
```

## Impact

### `impact_runs`

```text
(organization_id, project_id, impact_run_id) PK
change_set_id text
from_version_id text
to_version_id text
target_graph_digest bytea(32)
algorithm jsonb
result_digest bytea(32)
created_by_type CHECK IN ('human','ai','system')
created_by_id text
created_at timestamptz
UNIQUE (organization_id, project_id, change_set_id, to_version_id)
```

### `impact_run_changes`

```text
(organization_id, project_id, impact_run_id, node_id) PK
change_type CHECK IN ('added','removed','changed','revision_transition')
from_revision_id text NULL
to_revision_id text NULL
changed_paths text[]
impact_relevant boolean
```

### `impacts`

```text
(organization_id, project_id, impact_id) PK
impact_run_id text
changed_node_id text
impacted_node_id text
distance bigint CHECK > 0
node_path text[]
initial_status constant 'needs_review'
UNIQUE (organization_id, project_id, impact_run_id, changed_node_id, impacted_node_id)
```

### `impact_path_steps`

```text
(organization_id, project_id, impact_id, step_no) PK
impact_run_id text
edge_id text
relation text
from_node_id text
to_node_id text
composite FKs -> impacts, impact_runs, graph_edges
```

### `impact_reviews`

```text
(organization_id, project_id, impact_review_id) PK
impact_run_id text
impact_id text
previous_status CHECK IN ('needs_review','accepted','resolved','dismissed')
disposition CHECK IN ('accepted','resolved','dismissed')
reason_code controlled by L1 allowlist
actor_user_id uuid
reviewed_at timestamptz
composite FKs -> impact_runs, impacts, organization_members
```

Current impact status is derived from the append-only review chain; `impacts` is never
updated.

## Logical handoff

### `logical_handoffs`

```text
(organization_id, project_id, handoff_id) PK
version_id text
impact_run_id text
logical_content jsonb
semantic_content_digest bytea(32)
contract_version text
hash_contract_version text
artifact_descriptor jsonb
created_by_type CHECK IN ('human','ai','system')
created_by_id text
created_at timestamptz
UNIQUE (organization_id, project_id, version_id, impact_run_id, semantic_content_digest)
```

Handoffs are immutable append-only artifacts. A retry reuses the original idempotency
key and replays its command record; a new key with the same version/run/semantic digest
is rejected by the uniqueness constraint. DB2 fixes `hash_contract_version` to
`recursive-sorted-object-keys-arrays-preserve-contract-order/1`.

`handoff_impact_reviews` freezes exact review membership:

```text
(organization_id, project_id, handoff_id, impact_review_id) PK
composite FKs -> logical_handoffs, impact_reviews
```

## Durable command and audit

### `command_records`

```text
command_id uuid PK
organization_id uuid
project_id uuid
operation CHECK IN (
  'review_claim','publish_version','revise_decision',
  'calculate_impact','review_impact','build_handoff'
)
key_digest bytea(32)
request_digest bytea(32)
digest_version text
actor_type CHECK IN ('human','ai','system')
actor_id text
actor_user_id uuid NULL
logical_result jsonb
resulting_state_revision bigint
completed_at timestamptz
UNIQUE (organization_id, project_id, operation, key_digest)
direct root FK
```

### `audit_events`

```text
audit_event_id uuid PK
organization_id uuid
project_id uuid
command_id uuid
event_type controlled by six-operation allowlist
actor_type CHECK IN ('human','ai','system')
actor_id text
request_id text
controlled_metadata jsonb
occurred_at timestamptz
direct root FK
FK command_id -> command_records ON DELETE RESTRICT
index (organization_id, project_id, occurred_at DESC)
```

Free-text reasons, source excerpts, filenames, signed URLs, raw payloads and provider
responses are forbidden in `controlled_metadata`.

## Operations-facing rule

All six functions must use these exact table/column names. Their shared algorithm is:

```text
reauthorize caller
→ lock project_workflows FOR UPDATE
→ replay/conflict lookup
→ expected state CAS
→ sorted entity locks and normalized inserts
→ command_records
→ audit_events
→ state_revision + 1 exactly once
→ commit
```

No external call or object-storage access occurs inside the transaction.
