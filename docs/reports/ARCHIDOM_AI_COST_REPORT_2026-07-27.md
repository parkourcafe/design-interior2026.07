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
| Total persisted AI calls | 1 |
| Provider/model totals | Yandex / `yandexgpt-lite`: 1 |
| Tokens | 510 in / 0 out |
| Estimated provider cost | 0.000000 |
| Average workflow cost | 0.000000 |
| Cost per approved proposal | 0.000000 |

Scope: one completed disposable-branch workflow, one approved and issued
proposal.

The call outcome is `provider_error`: no Yandex credential/rate was supplied to
the isolated QA runtime, and the deterministic fallback completed successfully.
Therefore `0.000000` means “no provider charge observed in this run”, not a
validated production tariff. A successful credentialed provider run is required
before unit economics can be approved.
