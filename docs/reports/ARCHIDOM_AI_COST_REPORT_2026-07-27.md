# ArchiDom AI Cost Report — 27.07.2026

## Instrumentation

Every actual call through `completeJSON` now measures provider, model, estimated
input/output tokens, duration, outcome and attempts. The M1 risk action writes
that measurement to `ai_calls` with workflow/run/step linkage.

PR #51 additionally creates the linked `ai_calls` reservation before either
metered rerun path may invoke the provider. Successful completion idempotently
updates that same row with actual usage before a separate transaction commits
the derived business state. A later business validation/commit failure therefore
cannot roll back measured spend. Reservation failure is non-billable because provider execution is
skipped; an interrupted process retains a durable `reserved` ledger row rather
than losing evidence of the attempted call. An exception before usage is
returned closes it as `abandoned`; a failure after provider completion persists
the measured usage and terminal outcome even when business-state finalization
cannot commit.

Cost estimate is:

`(tokens_in + tokens_out) / 1000 × LLM_ESTIMATED_RUB_PER_1K_TOKENS`

and is marked `static_table`. Configure the approved provider rate before pilot.

## Current measured totals

| Metric | Value |
|---|---:|
| Total persisted AI calls | 3 |
| Provider/model totals | Yandex / `yandexgpt-lite`: 3 |
| Tokens | 1,120 in / 0 out |
| Estimated provider cost | 0.000000 |
| Average workflow cost | 0.000000 |
| Cost per approved proposal | 0.000000 |

Scope: one completed disposable-branch proposal workflow plus one controlled
failed/retried workflow for the same project. One call is explicitly linked as a
retry through `retry_of_id`.

All call outcomes are `provider_error`: no Yandex credential/rate was supplied to
the isolated QA runtime, and the deterministic fallback completed successfully.
Therefore `0.000000` means “no provider charge observed in this run”, not a
validated production tariff. A successful credentialed provider run is required
before unit economics can be approved.
