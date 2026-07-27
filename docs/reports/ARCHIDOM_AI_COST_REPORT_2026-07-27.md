# ArchiDom AI Cost Report — 27.07.2026

## Instrumentation

Every actual call through `completeJSON` now measures provider, model, estimated
input/output tokens, duration, outcome and attempts. The M1 risk action writes
that measurement to `ai_calls` with workflow/run/step linkage.

Cost estimate is:

`(tokens_in + tokens_out) / 1000 × LLM_ESTIMATED_RUB_PER_1K_TOKENS`

and is marked `static_table`. Configure the approved provider rate before pilot.

## Current measured totals

| Metric | Value |
|---|---:|
| Total persisted AI calls | UNKNOWN |
| Provider/model totals | UNKNOWN |
| Tokens | UNKNOWN |
| Estimated provider cost | UNKNOWN |
| Average workflow cost | UNKNOWN |
| Cost per approved proposal | UNKNOWN |

No database migration or real provider workflow was executed in this checkout,
so reporting zeros would be false evidence. After the pilot, calculate totals
from `ai_calls` joined to approved `approval_requests` and completed
`workflow_runs`.

