# Legacy Auth/RLS compatibility audit

Дата: 19 июля 2026 года  
Режим: local read-only repository audit; production schema не изменялся.

## Legacy surface

The frozen legacy baseline is
`supabase/migrations/20260716071024_legacy_production_baseline.sql`.
It enables RLS for `designers`, `projects`, `answers`, `risk_cards`, `proposals`,
`events`, `studio_members`, `project_rooms`, `project_participants`,
`project_tasks` and `project_task_events`.

Legacy policies are studio/owner based (`designers_*`, `projects_studio_all`,
`answers_studio_all`, `risk_cards_studio_all`, `proposals_studio_all`, event and
participant/task policies). They remain compatibility infrastructure and are not
replaced by ProjectCEO policies.

## Compatibility mapping

| Legacy surface | Project Intelligence/Core relationship | Decision |
|---|---|---|
| `designers` / `studio_members` | organization/member identity | retain; new Foundation membership is additive |
| `projects` | project metadata and passport | retain same row; ProjectCEO workflow references project UUID |
| `answers` | M1 intake evidence | retain; new `sources`/graph revisions carry provenance for RU workflow |
| `risk_cards` | M1 risk output | retain; new `risks`/review contracts are additive and scoped |
| `proposals` | legacy pre-sale proposal | retain; release/baseline artifacts are separate immutable contracts |
| `events` | legacy analytics/audit-like events | retain; ProjectCEO audit/command records remain separate append-only ledgers |
| `project_rooms` / tasks | legacy participant workspace | retain; M4 handover/photo/milestone model is additive |
| `projectceo_foundation.*` | organization/project/package memberships and capabilities | new request-bound authorization layer; no legacy rename |
| `projectceo_product.*` / `projectceo_m4.*` | versions, releases, change-impact and execution | additive, request-bound RPC only |

## Runtime client boundaries

`lib/supabase/server.ts` is used by request-bound authenticated paths and legacy
server pages. `lib/supabase/browser.ts` is used by browser Auth flows.
`lib/supabase/admin.ts` is restricted to server-only legacy maintenance/public
token routes and is not used by ProjectCEO human command adapters.

The dashboard shell now skips legacy studio-admin lookup only when the
server-role key is absent in the disposable AP1 runtime; production retains the
existing studio membership check.

## Gate result

```text
LEGACY_AUTH_RLS_LOCAL_AUDIT=PASS
PRODUCTION_AUTH_RLS_SNAPSHOT=BLOCKED_UNTIL_MCP_OR_READONLY_DB_ACCESS
PRODUCTION_SCHEMA_CHANGED=false
```

No second incompatible Auth layer was introduced. Existing timestamped
migrations remain immutable; all ProjectCEO changes are additive.
