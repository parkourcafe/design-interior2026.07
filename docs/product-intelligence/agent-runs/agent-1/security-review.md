# Security review — migration and Project Room layer

Scope: verified migrations `0001…0009`, `lib/project-room/**`, public token paths, and task-status routes. This is a read-only review; no finding was fixed in this wave.

## Findings

### S1 — High, blocking: authenticated callers can impersonate a room participant in the task-status RPC

Evidence:

- `supabase/migrations/0009_project_room_workflow.sql:237-305` accepts `p_actor_role` and `p_actor_participant_id` as caller input;
- lines `281-305` treat existence of the supplied participant row as authorization when the caller is not a studio member;
- line `349` grants the generic function directly to `authenticated`;
- `app/api/project-room/task-status/route.ts:16-26` correctly validates a bearer token in application code, but the database function itself receives only the resulting role/participant values, not proof of that token.

Consequence: any authenticated database client that learns or guesses a task UUID and matching participant UUID can call the RPC directly, select a role, mutate task status, and create a misleading actor event. UUID secrecy is not an authorization boundary. `SECURITY DEFINER` bypasses table RLS inside this function.

Mitigation: revoke the generic RPC from `authenticated`; provide a designer RPC that derives studio authority only from `auth.uid()`, and a service-only participant RPC that receives a server-verified, hashed grant identifier. Never accept actor role as trusted authority. Add authorization regression tests for unrelated authenticated users.

### S2 — High, blocking: public grants are plaintext, URL-carried, non-expiring, and non-revocable

Evidence:

- verified local-HEAD `0001_init.sql:27-29` stores `projects.intake_token` plaintext;
- verified local-HEAD `0001_init.sql:68-70` stores `proposals.public_token` plaintext;
- `proposed-migrations/0007_project_rooms.sql:34-43` stores `project_participants.access_token` plaintext and has no expiry/revocation fields;
- `app/room/[access_token]/page.tsx:10-16`, `app/p/[public_token]/page.tsx:13-24`, and `lib/intake.ts:14-21` use raw tokens from URLs for service-role lookups.

Consequence: a token copied from database access, browser history, logs, screenshots, analytics, or referrers provides indefinite access. There is no scoped rotation or immediate revocation state.

Mitigation: store only a keyed hash of a high-entropy token; add `expires_at`, `revoked_at`, scope/resource, `last_used_at`, and rotation lineage; compare hashes server-side; redact URL path parameters in logs/analytics; issue short-lived exchange sessions where practical.

### S3 — High, blocking: task audit rows are mutable and cascade-deletable

Evidence:

- `proposed-migrations/0007_project_rooms.sql:65-75` defines task events with cascades from room/task;
- lines `104-108` grant a studio `FOR ALL` RLS policy over `project_task_events`;
- there is no append-only trigger, update/delete denial policy, immutable before/after envelope, or correlation identifier.

Consequence: a studio session can update or delete task events through Data API privileges if table grants allow it, and deleting a task/room destroys its history. The table cannot serve as tamper-resistant audit evidence.

Mitigation: replace `FOR ALL` with explicit `SELECT` and controlled `INSERT`; deny update/delete to application roles; derive actor server-side; include before/after, actor identity, request/correlation id, and version; choose retention/tombstone behavior instead of cascade for audit records.

### S4 — Medium, blocking for concurrent editing: task updates lack optimistic concurrency

Evidence:

- `supabase/migrations/0009_project_room_workflow.sql:237-243` has no expected-version parameter;
- lines `264-323` lock, increment, and update the current row unconditionally;
- `app/api/project-room/task-status/route.ts:8` and `21-26` do not submit the client-observed version.

Consequence: two stale clients are serialized but the later request silently overwrites the earlier status. The incremented version records order but does not prevent lost intent.

Mitigation: require `p_expected_version`; update with `WHERE id = ... AND version = p_expected_version`; return a typed conflict and current version; make idempotency key unique per actor/action.

### S5 — Medium: two `SECURITY DEFINER` functions retain default execute ACL

Evidence:

- verified `0006_team.sql:28-40` creates `is_studio_member` with fixed `search_path` but no explicit revoke/grant;
- verified local-HEAD `0008_concept_packs.sql:50-66` does the same for `record_concept_pack_created_event`;
- clean bootstrap reported `default_acl` for both functions.

Consequence: PostgreSQL functions are executable by `PUBLIC` by default unless deployment defaults override this. The membership helper exposes a definer-context membership oracle; retaining unnecessary execute privileges expands attack surface. Trigger functions are not normally callable as ordinary functions, but their ACL should still be explicit.

Mitigation: `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; grant only the minimum role or keep trigger-only execution. Retain fixed `search_path` and schema-qualify referenced objects.

### S6 — Medium, blocking for reproducible deployment: Data API grants are not migration-owned

Evidence:

- no `GRANT`/`REVOKE` for public tables, sequences, or schema usage exists in `0001…0008`;
- `0009` controls only function execute ACL;
- production OpenAPI exposes some tables while `rate_limits` and `concept_packs` are absent, but OpenAPI cannot distinguish missing object from missing exposure/grant.

Consequence: a fresh deployment can behave differently depending on Supabase project defaults. RLS policies alone do not grant table access; conversely broad platform defaults may expose more than intended.

Mitigation: add explicit, reviewed schema/table/sequence grants in an additive migration and test `has_table_privilege`/`has_function_privilege` for `anon`, `authenticated`, and `service_role` in a Supabase-equivalent environment.

### S7 — Medium: public rate limiting silently fails open and its production table is unconfirmed

Evidence:

- `lib/rate-limit.ts:13-15`, `27-39` returns allow on query, insert, or runtime failure;
- production OpenAPI does not expose `rate_limits`; migration ledger is unavailable;
- public task updates use this limiter at `app/api/project-room/task-status/route.ts:10-12`.

Consequence: table absence, grant drift, or operational failure disables abuse protection without alerting. Attackers can repeatedly test long-lived bearer tokens or mutate accessible tasks.

Mitigation: emit a privacy-safe metric/error on fail-open; health-check the limiter table; fail closed or degrade more conservatively for sensitive mutation endpoints; confirm `0005` via ledger/direct schema.

### S8 — Medium, rollout blocker until backed up: `0009` permanently deletes duplicate audit-like events

Evidence: `supabase/migrations/0009_project_room_workflow.sql:35-46` deletes duplicate `project_room_created` events before creating the unique index.

Consequence: rollback cannot reconstruct deleted events, and the chosen surviving row may not be the semantically authoritative one.

Mitigation: run a read-only duplicate preflight, export affected IDs/rows to an approved secure artifact, define survivor rules, then deduplicate in an explicitly reviewed data migration separate from structural hardening.

### S9 — Medium, defense in depth: public pages use a full service-role client and filter after broad reads

Evidence:

- `lib/supabase/admin.ts:3-13` constructs a client that bypasses RLS;
- `app/room/[access_token]/page.tsx:13-17` validates a token, loads all task rows for the room with service role, then filters in application memory;
- `app/p/[public_token]/page.tsx:19-55` also performs public-token reads and event writes through service role.

Consequence: any future filter regression, token-resource mismatch, or overly broad select can disclose cross-role room data despite correct RLS elsewhere.

Mitigation: expose a narrow, server-only RPC/view that validates a hashed grant and returns only the permitted projection; select only needed fields; add client/executor negative tests; keep the service-role module server-only.

### S10 — Medium: deletion semantics erase product and audit history

Evidence:

- verified `0001_init.sql` cascades projects into answers, risks, proposals, and events;
- proposed `0007` cascades rooms into participants/tasks/events and tasks into task events;
- no separate append-only audit retention store is present.

Consequence: account/project cleanup can remove the history needed to explain approvals, changes, disputes, or security actions.

Mitigation: define retention and legal deletion requirements per region; separate business deletion from audit tombstoning; encrypt or pseudonymize retained actor/contact data; log authorized deletion as an append-only event outside the cascade boundary.

## Positive controls observed

- RLS is enabled on every application table in the clean bootstrap.
- `0009.update_project_task_status` fixes `search_path` and explicitly revokes/grants function execute.
- `0009.create_project_room_from_accepted_proposal` explicitly revokes public execute and grants only `authenticated`; it runs as invoker.
- public routes validate tokens server-side before business reads/writes, and the service-role constructor disables session persistence.
- `0009` uses an advisory transaction lock and uniqueness/idempotency indexes for room creation.

These controls do not remove the blocking findings above.
