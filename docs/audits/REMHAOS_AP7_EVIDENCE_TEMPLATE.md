# AP7 evidence — template

Status: **BLOCKED_ON_OWNER**. Wedge: **paid M1→M2 designer cycle** (R22). This template does not establish payments, adoption or pilot success.

| Required evidence | State / owner evidence reference |
|---|---|
| Exact deployed SHA, adoption approval and date | UNKNOWN |
| Two paid scenarios, written scope and success criteria before start | UNKNOWN |
| Payment evidence (redacted reference; no payment details) | UNKNOWN |
| Second project of the same organization | UNKNOWN |
| M1→M2 downstream result and human acceptance | UNKNOWN |
| At least three real briefs and full-pass cost report | UNKNOWN |
| Owner decision on measured wedge / next scope | UNKNOWN |

## Metrics evidence

Attach aggregate JSON from `scripts/ops/launch-metrics.ts` and the cost report template completed with owner evidence. Record snapshot time, UTC window, source class, exact SHA and artifact hash. Real DB execution is owner-only after separate authorization; fixture mode:

```sh
npx tsx scripts/ops/launch-metrics.ts --fixture snapshot.json
```

Fixture shape: `events: [{type, project_id, created_at}]`, `ai_calls: [{module, project_id, status, cost_rub}]`; synthetic IDs only. Output is aggregate, without project IDs or submitted content.

Activation counts unique projects with `intake_link_created` in the supplied window, through `brief_started`, `brief_completed`, `proposal_created`, `proposal_sent`. Each funnel stage requires the previous stage at an earlier or equal timestamp; missing/out-of-order stages stop progression. Repeat events do not add projects. Projects without a link event are excluded and reported. Time-to-passport = first `brief_completed` at or after first `brief_started`; time-to-proposal = first `proposal_sent` at or after first `brief_completed`; report sample count, mean and median. Durations are observed events, not asserted user work time. Missing start/end events and windows cutting across a project lifecycle censor the sample.

Error event counts are recorded attempts, not a rate with an invented denominator. Unknown-token requests are not attributed to another user's project. Telemetry write failures may be absent from `events`; report this coverage limitation. Legacy creation/send success events can coexist with failure events after partial writes; reconcile affected projects before claiming activation success. AI fallback is reported separately from operation failure. Successful fallback is still a completed brief.

## Decisions and limitations

R7 accepted by recommendation; R20 variant (a); R22 paid M1→M2 designer cycle. These inputs do not grant production/DB/flag changes or open later M2/M4 scope. Business acceptance, real pilots, receipt of payments, provider cost and production adoption stay with the owner.
