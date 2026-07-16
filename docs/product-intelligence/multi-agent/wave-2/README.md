# Wave 2 — L1 application vertical slice

## Objective

Реализовать и независимо проверить первый application-level vertical slice по
[`architecture-v1.md`](../../architecture-v1.md) и
[`vertical-slice-l1-spec.md`](../../vertical-slice-l1-spec.md), не затрагивая database,
production, UI и frozen domain.

## Tracks

| Track | Роль | Exclusive write scope |
|---|---|---|
| Agent 1 | Architecture guardian & acceptance oracle | `tests/project-intelligence/application/architecture/**`, `docs/product-intelligence/agent-runs/wave-2/agent-1/**` |
| Agent 2 | Workflow application | `lib/project-intelligence/application/workflow/**`, `docs/product-intelligence/agent-runs/wave-2/agent-2/**` |
| Agent 3 | Change-impact & handoff application | `lib/project-intelligence/application/change-handoff/**`, `docs/product-intelligence/agent-runs/wave-2/agent-3/**` |
| Integrator | Freeze, composition, cross-test, final report | common docs, `lib/project-intelligence/application/index.ts`, root public export, `tests/project-intelligence/application/vertical-slice-l1.integration.test.ts`, `docs/product-intelligence/agent-runs/wave-2/INTEGRATION_REPORT.md` |

## Global constraints

- Existing domain, fixture and vertical-slice contract files are read-only.
- No agent edits another track's scope or common export.
- No migrations, DB, production, app routes/components, package/config, deploy or Git
  mutation.
- Only synthetic fixtures may be used.
- Test doubles do not count as durable persistence.
- Any needed shared-contract change is proposed to Integrator; agent does not apply it.

## Execution order

```text
A1 Architecture/spec freeze
  → A2 owned-scope snapshot
  → Agent 1 / Agent 2 / Agent 3 in parallel
  → individual handoff acceptance
  → Agent 1 follow-up implementation audit
  → Integrator composition and E2E L1 test
  → trusted validation
  → Wave 2 integration report
```

Agent 1's first pass builds the independent oracle. После handoff Agent 2/3 Integrator
повторно вызывает Agent 1 для post-implementation audit.

## Done

Wave 2 принимается только при выполнении A1–A5 из Architecture v1. `BASELINE_READY` и
`L2` остаются отдельными состояниями и не меняются автоматически.
