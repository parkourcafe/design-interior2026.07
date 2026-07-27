# AI Action Contract V1

Actual provider calls must pass Zod validation, one repair attempt, PII scrubbing,
and write one `ai_calls` record with project/run/step/action, provider/model,
estimated tokens, duration, cost estimate source, outcome and retry relation.
AI may create only extracted/interpreted/unknown facts and cannot approve or issue.
`LLM_ESTIMATED_RUB_PER_1K_TOKENS` supplies the static accounting rate when the
provider response has no normalized cost.

