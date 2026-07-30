# Production read-only observation — Agent 1

Observed on 2026-07-16 through PostgREST OpenAPI metadata. The request used an existing server credential without printing its value or endpoint. No table rows, project records, contacts, documents, or other PII were requested. Production received no writes.

## Probe results

- public OpenAPI metadata: HTTP `200`;
- `supabase_migrations` profile metadata: HTTP `406`;
- authoritative migration ledger: **not obtained**;
- schema-only direct PostgreSQL dump: **not available**.

The OpenAPI result proves only what the production Data API exposes to the credential. Absence from OpenAPI can mean absent object, unexposed schema, missing grant, or stale schema cache.

## Schema evidence

| Migration | Schema-only observation | Evidence level | Strict classification |
|---|---|---|---|
| `0001` | `designers`, `projects`, `answers`, `risk_cards`, `proposals`, `events` and their basic columns are exposed | `confirmed_by_schema` for listed objects | `unknown` because ledger is unavailable |
| `0002` | `projects.designer_id` is not in the OpenAPI required list, consistent with nullable ownership | `confirmed_by_schema` | `unknown` because ledger is unavailable |
| `0003` | `projects.custom_questions` is exposed and required | `confirmed_by_schema` | `unknown` because ledger is unavailable |
| `0004` | `designers.profile` is exposed and required | `confirmed_by_schema` | `unknown` because ledger is unavailable |
| `0005` | `rate_limits` is not exposed | `unknown` | `unknown` |
| `0006` | `studio_members` and its expected columns are exposed; function/policy bodies are not visible in OpenAPI | `confirmed_by_schema` for the table; remaining parts `unknown` | `unknown` because ledger is unavailable |
| `0007` | all four basic tables and expected pre-`0009` columns are exposed | `confirmed_by_schema` for table/column shape | `unknown` whether exact migration or an equivalent/manual change produced it |
| `0008` | `concept_packs` is not exposed | `unknown` | `unknown` |
| `0009` | every exposed `0007` table lacks the columns added by `0009` | `confirmed_by_schema` that the expected hardening shape is absent | `unknown` under the required ledger+schema rule; operationally treat `0009` as not applied until ledger reconciliation |

### Exposed `0007` shapes

- `project_rooms`: `id`, `project_id`, `proposal_id`, `status`, `scope_package`, `pricing_snapshot`, `created_at`;
- `project_participants`: `id`, `room_id`, `role`, `display_name`, `auth_user_id`, `access_token`, `created_at`;
- `project_tasks`: basic task fields including `updated_at`, but no `version` or `workflow_state`;
- `project_task_events`: basic event fields, but no `event_version` or `idempotency_key`.

### Expected `0009` fields confirmed absent

- `project_rooms.version`, `workflow_state`, `source_proposal_version`, `idempotency_key`, `updated_at`;
- `project_tasks.version`, `workflow_state`;
- `project_task_events.event_version`, `idempotency_key`.

## Ledger decision

`ledger_obtained=false`. The Data API cannot authoritatively classify applied migration versions, and Agent 1 had neither read-only Management API access nor a direct read-only PostgreSQL connection. No RPC, grant, function, or other production workaround was created.

Consequently `ledger_schema_consistent` cannot be established. In the binary handoff it is `false` to keep persistence blocked; this does **not** assert a proven mismatch.
