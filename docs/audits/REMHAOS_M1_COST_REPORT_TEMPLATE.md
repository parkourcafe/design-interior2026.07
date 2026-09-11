# M1 cost report — template

Status: **BLOCKED_ON_OWNER** until adoption and owner-run measurements. This file is not a completed cost report.

- Owner / measurement date / exact deployed SHA: UNKNOWN
- Adoption approval and hosted verification evidence: UNKNOWN
- Window (inclusive FROM, exclusive TO, UTC): UNKNOWN
- Read-only snapshot / report artifact / hash: UNKNOWN
- At least three complete real briefs (opaque evidence aliases; no names, contacts, raw tokens, filenames or answers): UNKNOWN
- Recording coverage of every provider attempt, including retries and failures: UNKNOWN
- Provider invoice / approved tariff reconciliation: UNKNOWN

Owner command (requires `psql`, a separately approved read-only DB URL in `LAUNCH_METRICS_DATABASE_URL`; never paste the URL into a command or report):

```sh
npx tsx scripts/ops/launch-metrics.ts --database 2026-09-01T00:00:00Z 2026-09-02T00:00:00Z > launch-metrics.json
```

Replace the example window with the approved measurement interval. No migration, grant, activation or provider call is performed. The script reads only `events` and M1 rows from `projectceo_platform.ai_calls` in a read-only repeatable-read transaction. Missing read privileges are a blocker, not permission to grant access or use a privileged runtime account.

| Brief alias | Scope / completed evidence | Provider attempts | Known cost RUB | Missing cost / attribution | Full pass cost RUB |
|---|---|---:|---:|---|---:|
| A | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| B | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| C | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

Null `cost_rub` is unknown, not zero. Calls without `project_id` cannot establish per-brief cost. The current recording contract may omit price and project attribution; populating these fields, provider tariffs and billing reconciliation are outside WP-28. Aggregate known cost covers measured rows only; missing telemetry is not detectable merely by summing those rows. Do not divide a global total by completed briefs to claim full-pass cost.

Record failure/retry coverage, sample selection, time-window censoring, operator corrections and evidence provenance. Keep status BLOCKED_ON_OWNER/INCOMPLETE until all gaps are closed. Engineering/fixture PASS is not production, legal or business acceptance.
