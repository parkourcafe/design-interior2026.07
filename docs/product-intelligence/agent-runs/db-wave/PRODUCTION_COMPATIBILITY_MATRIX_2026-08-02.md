# Production compatibility matrix — 2026-08-02

Source: read-only production REST/OpenAPI snapshot for
`ztnycrchwxqczqbyegnp`, captured during the approved gate. This is a contract
classification, not permission to alter production.

| Canonical contract | Production observation | Classification | Safe next action |
|---|---|---|---|
| Project Sources | `public.project_sources` is exposed with source metadata and project scope | Data shape present; API/RLS contract not proven equivalent | Verify authenticated read/command semantics on a clone; add only a server-side adapter if needed |
| Project Facts | `public.project_facts` is exposed with confidence, status, version, `source_id` and `evidence_locator`; the canonical `provenance` column is absent from the observed shape | **Not shape-compatible**; provenance must be resolved before claiming canonical facts | Define an additive provenance bridge or a server-side projection on a clone; preserve existing rows and do not copy them automatically |
| Workflow Definitions | `public.workflow_definitions` is exposed | Data shape present; canonical API/RPC absent from the observed production surface | Map the existing runtime contract before any bridge |
| Workflow Runs / Step Runs | Both tables are exposed with retry/status fields | Data shape present; resume/idempotency semantics unproven against canonical functions | Run clone-only workflow/resume/retry tests |
| Approval Requests | Table is exposed with `self_approved`, reviewer and issuance fields | Data shape present; approval authorization must be proven server-side | Test approve/issue separation and self-approval labeling |
| Audit Events | Table is exposed with actor, project and workflow references | Data shape present; append-only/RLS semantics unproven | Verify insert path and forbidden update/delete on clone |
| AI Calls | Table is exposed with provider, model, token and cost fields | Data shape present; metered-call coverage requires live flow evidence | Run one real provider call on clone and reconcile the record |
| Studio Resolver | `project_overrides` and `studio_standards` are exposed; current row counts are zero | Contract surface present, no populated decision data | Define bridge only after precedence/version tests |
| Legacy M1 | `projects`, `answers`, `risk_cards`, `proposals` are live; proposals include `issued_revision_id` | Existing deployed M1 must remain source of truth | Preserve links and routes; do not backfill into canonical private schemas automatically |
| Canonical private schemas/RPCs | `projectceo_*` and `project_intelligence*` are not present in the production REST surface | Missing contract, not proven missing data | Compatibility bridge or separate adoption plan required |

## Result

Production has enough relational shape to justify a compatibility investigation,
but not enough evidence to claim canonical API compatibility. The correct next
implementation is a clone-only bridge proof, not a production schema rewrite.

No production table, row, migration ledger or route was changed by this matrix.
