# RemhaOS AI Cost Report

Date: 2026-07-28
Status: `PARTIAL`

## Implemented Measurement

The `ai_calls` ledger records:

- project/workflow/step binding;
- action key;
- provider and model;
- input and output tokens;
- duration;
- provider cost estimate and estimate source;
- retry lineage;
- outcome;
- cost class.

Supported cost classes:

- `free_deterministic`
- `metered_ai`
- `external_paid`

Billing is not implemented in Sprint 1. Measurement is implemented.

## Verification

- AI accounting contract tests passed.
- Risk AI reservation/finalization contracts passed.
- Initial brief metering and terminalization contracts passed.
- SQL proof confirmed terminal AI RPC ACLs are `service_role` only.

## Totals

No production AI-cost totals are reported from this local verification pass because production was not touched and final browser QA on a fresh local reset remains pending.

### 2026-07-30 production-connected preview attempt

The initial-brief command was deliberately exercised after Auth and the
profile gate passed. It terminated at workflow reservation because the live
database lacks `reserve_initial_brief_ai_call`. No provider request was sent;
therefore the truthful totals for this attempt are zero metered AI calls and
zero provider cost.

Required production/pilot report fields after approved run:

- total AI calls;
- provider;
- model;
- tokens in/out;
- estimated provider cost;
- average workflow cost;
- cost per approved proposal.

### 2026-07-30 production ledger evidence

- `total AI calls = 3`; all are `yandex` / `yandexgpt-lite` and
  `metered_ai`.
- `tokens_in = 537` per observed initial-brief attempt; `tokens_out = 0`.
- Estimated provider cost is zero for the failed attempts, as recorded by the
  static estimate table.
- All three calls terminalized as `provider_error`; the live provider returned
  HTTP 403 (permission denied). The ledger and workflow fallback are working,
  but cost per approved proposal cannot yet be calculated from a successful
  Yandex output.

## Verdict

`AI_COST_MEASUREMENT: IMPLEMENTED; LIVE_PROVIDER_QA: BLOCKED`

## Required Yandex Cloud remediation

The observed `403 Permission denied` is an IAM authorization failure, not an
application or Supabase failure. In the Yandex Cloud folder identified by
`YC_FOLDER_ID`, assign the service account the `ai.languageModels.user` role
and create a replacement API key with the `yc.ai.languageModels.execute`
scope. Replace the Vercel `YC_API_KEY` value with that one-line key, redeploy,
and revoke the old key because it was entered in malformed form. Do not paste
the key into repository files or application logs.

## 2026-07-30 remediation verification

- Created a dedicated `remhaos-yandexgpt-runtime` service account in the
  `remhaos` folder with only `ai.languageModels.user` and an API key scoped to
  `yc.ai.languageModels.execute`.
- Replaced encrypted `YC_FOLDER_ID` and `YC_API_KEY` in Vercel Preview and
  Production. A new Preview build reports `llm_configured=true`.
- Direct YandexGPT verification returned HTTP 200.
- A new governed M1 brief reached `waiting_for_human / human_review` with a
  successful `yandexgpt-lite` ledger entry: 506 input tokens, 354 output
  tokens, `outcome=success`, `cost_class=metered_ai`.
