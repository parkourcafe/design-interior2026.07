# Workflow Contract V1

`client_intake_to_issued_proposal` version 1 is seeded by migration `0007`.
Runs use the canonical lifecycle and immutable step attempts. Brief submission
creates or resumes a run, persists facts and provenance, records the actual risk
LLM call, and waits for human review. Failed runs can enter `retrying`.
Proposal issue is denied until `RELEASE_AUTHORIZED` is approved.

