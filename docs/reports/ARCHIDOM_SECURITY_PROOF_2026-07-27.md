# ArchiDom Security Proof — 27.07.2026

## Implemented proof

- RLS enabled for every new project/studio table.
- Project policies reuse server-derived studio membership.
- No anonymous policies exist on facts, workflows, approvals or AI calls.
- `anon` has no privileges on the ten Sprint 1 tables.
- `authenticated` has explicit least-privilege grants; it cannot insert audit or
  AI cost rows. Those writes occur only after authenticated/RLS checks through
  the server-side service client.
- The membership helper is in the non-exposed `private` schema; execute access
  to the legacy public SECURITY DEFINER helper is revoked.
- AI-created `human_confirmed` is prohibited by DB check and application tests.
- Approval identity fields are immutable and workflow transitions are enforced
  by database triggers.
- Public intake still uses token-bound server route and service role.
- Proposal issue checks a human `RELEASE_AUTHORIZED` approval.
- PII scrubbing in the existing risk prompt remains unchanged.
- No secrets were added; cost configuration uses `.env.example`.

## Evidence

Disposable Supabase branch `archidom-sprint1-pilot`
(`udtjczcnemndubsyuqxc`) has migrations `0007` and `0008` applied.

Live role-session results:

- studio A sees 1 own fact and 0 studio B facts;
- authenticated insert into `ai_calls`: blocked;
- AI attempt to create `human_confirmed`: blocked;
- invalid `queued → completed` workflow transition: blocked;
- approval identity mutation: blocked;
- anon fact select privilege: false;
- public membership helper execute privilege: false.

Supabase Security Advisor after migration reports no Sprint 1 warning/error.
The only remaining notice is INFO for the intentionally service-only legacy
`rate_limits` table ([advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).

`migration-contract.test.ts` also verifies additive DDL, RLS coverage, private
helper configuration, AI confirmation prohibition and governed mutations.

## Remaining production gate

These proofs are from an isolated branch, not production. Production merge and
production-authenticated browser QA remain separately controlled gates.
