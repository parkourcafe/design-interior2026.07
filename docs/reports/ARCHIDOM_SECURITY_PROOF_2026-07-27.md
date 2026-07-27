# ArchiDom Security Proof — 27.07.2026

## Implemented/static proof

- RLS enabled for every new project/studio table.
- Project policies reuse server-derived studio membership.
- No anonymous policies exist on facts, workflows, approvals or AI calls.
- `audit_events` and `ai_calls` update/delete grants revoked from authenticated.
- AI-created `human_confirmed` is prohibited by DB check and application tests.
- Public intake still uses token-bound server route and service role.
- Proposal issue checks a human `RELEASE_AUTHORIZED` approval.
- PII scrubbing in the existing risk prompt remains unchanged.
- No secrets were added; cost configuration uses `.env.example`.

## Evidence

`migration-contract.test.ts` statically verifies additive DDL, RLS coverage,
absence of anon policies, AI confirmation prohibition and append-only grants.

## BLOCKED

Live RLS negative tests (other studio, anon token, role mismatch, forged audit)
require a disposable Supabase with role sessions. Therefore this report is not
production RLS proof and cannot support a READY verdict by itself.

