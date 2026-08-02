# Production compatibility matrix — 2026-08-02

Source: read-only production REST/OpenAPI snapshot for
`ztnycrchwxqczqbyegnp`, captured during the approved gate, reconciled against
the checked-in migration files. This is a contract classification, not
permission to alter production.

| Expected contract | Production observation | Repository/production classification | Safe next action |
|---|---|---|---|
| Project Sources | `public.project_sources` is exposed with source metadata and project scope | **Production-only runtime relation; no matching repository migration definition** | Verify authenticated read/command semantics on a clone; add only a server-side adapter if needed |
| Project Facts | `public.project_facts` is exposed with confidence, status, version, `source_id` and `evidence_locator`; the canonical `provenance` column is absent from the observed shape | **Production-only relation and not shape-compatible with the requested contract** | Define an additive provenance bridge or a server-side projection on a clone; preserve existing rows and do not copy them automatically |
| Workflow Definitions | `public.workflow_definitions` is exposed | **Production-only runtime relation; no matching repository migration definition** | Map the existing runtime contract before any bridge |
| Workflow Runs / Step Runs | Both tables are exposed with retry/status fields | **Production-only runtime relations; no matching repository migration definition** | Run clone-only workflow/resume/retry tests |
| Approval Requests | Table is exposed with `self_approved`, reviewer and issuance fields | **Production-only runtime relation; no matching repository migration definition** | Test approve/issue separation and self-approval labeling |
| Audit Events | Table is exposed with actor, project and workflow references | **Production-only runtime relation; no matching repository migration definition** | Verify insert path and forbidden update/delete on clone |
| AI Calls | Table is exposed with provider, model, token and cost fields | **Production-only runtime relation; no matching repository migration definition** | Run one real provider call on clone and reconcile the record |
| Studio Resolver | `project_overrides` and `studio_standards` are exposed; current row counts are zero | Contract surface present, no populated decision data | Define bridge only after precedence/version tests |
| Legacy M1 | `projects`, `answers`, `risk_cards`, `proposals` are live; proposals include `issued_revision_id` | Existing deployed M1 must remain source of truth | Preserve links and routes; do not backfill into canonical private schemas automatically |
| Canonical private schemas/RPCs | `projectceo_*` and `project_intelligence*` are not present in the production REST surface | Missing contract, not proven missing data | Compatibility bridge or separate adoption plan required |

## Result

Production has a deployed governed-M1 relational surface that is ahead of and
different from the checked-in migration chain. It has enough shape to justify a
compatibility investigation, but not enough evidence to claim canonical API
compatibility. The correct next implementation is a clone-only bridge proof,
not a production schema rewrite.

No production table, row, migration ledger or route was changed by this matrix.
