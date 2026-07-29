# RemHaOS AI Cost Report

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

Required production/pilot report fields after approved run:

- total AI calls;
- provider;
- model;
- tokens in/out;
- estimated provider cost;
- average workflow cost;
- cost per approved proposal.

## Verdict

`AI_COST_MEASUREMENT: IMPLEMENTED`
