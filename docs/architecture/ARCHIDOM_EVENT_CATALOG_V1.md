# Event Catalog V1

Legacy product events remain in `events`. Governed events are append-only
`audit_events`: `brief_workflow_waiting_for_review`, `fact_confirmed`,
`fact_rejected`, `proposal_release_authorized`, `proposal_issued`, and
`standard_drift`. Payloads must not contain secrets, source document bodies,
contact details or signed URLs.

