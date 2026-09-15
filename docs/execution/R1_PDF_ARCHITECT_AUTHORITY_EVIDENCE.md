# PDF/DWG architect authority — private foundation

The owner accepted architect-only pair attestation in this conversation. This
increment implements its authorization primitive; it does not create a pair,
attestation, event, public RPC or browser action.

The private helper requires existing request-bound `review_source` authority and
an active architect membership in the project or exact target package. It derives
the actor from Auth, locks membership and capability rows, and checks again after
lock waits. A project owner who is architect only in the target package receives
package-only authority. No role is assigned automatically.

Migration: `20260915174226_r1_pdf_fallback_architect_authority.sql`.
All runtime roles and PUBLIC lack EXECUTE; the owner is `pi_table_owner`.
Fixture `tests/db4/70_r1_pdf_fallback_architect_authority.sql` is registered in DB4.

Local PostgreSQL 16 loaded every migration and the DB3 enrollment fixture, then
passed the new behavioral fixture: owner-only and forged JWT denial, active
architect acceptance, exact-package scope, inactive/revoked authority and private
ACL checks. Its changes roll back and create no attestation.

A separate local two-connection probe observed a real Lock wait while an actor's
project role was downgraded. After that transaction committed, the waiting helper
denied with `PDF_FALLBACK_ARCHITECT_REQUIRED`. The dedicated socket-only cluster
was stopped and removed. This probe is recorded locally in
`/private/tmp/r1-architect-local-pg16-proof.log`; it is not a CI concurrency proof.

Independent source review found and closed scope inflation in the mixed
project-owner/package-architect case. Review closure verified migration SHA-256
`a913d985dea228b12217491f5535cb5785325c7b89770d8e68fd0416e16b0bd8`.

PostgreSQL 17, full DB4/DB5, restart, authenticated browser behavior and Claude
review remain separate pending checks. Pair persistence, source lineage, human
confirmation, UI and release integration remain unfinished. No production,
Supabase, shared Docker or deployment action was performed.

Local lint passed with 13 existing warnings; typecheck and Webpack build passed.
The full 1,777-test suite is NOT green: two existing native scanner tests time
out even with one worker outside the sandbox (1,775 passed). An earlier parallel
run failed one scanner test, and a sandbox single-worker run failed three.
No timeout, assertion or scanner code was changed to hide these failures.
This increment remains work in progress pending that diagnostic and CI evidence.
