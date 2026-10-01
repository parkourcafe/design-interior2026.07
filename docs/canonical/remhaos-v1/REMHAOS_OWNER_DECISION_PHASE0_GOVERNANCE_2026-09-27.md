# OWNER DECISION — Phase 0 governance and Telegram TG2 order

Status: **LOCKED OWNER DECISION**
Date: 27.09.2026
Basis: owner statement in the current session: «Утверждаю рекомендации по всем
шести вопросам и порядок TG2».

## 1. CI as a merge gate

For pull requests targeting the protected integration branch, lint, typecheck,
tests and build are required merge checks.

The check suite must first be verified on the exact candidate SHA. Enabling or
changing GitHub branch protection is a separate operational action; this
decision does not enable CI, merge a pull request, or change hosted settings.

## 2. Account deletion and retention

Deletion of a designer account enters a 90-day read-only and full-export
retention period. After the period, proposal, passport and historical passport
versions containing customer PII are deleted. A separately paid archive or a
legal hold is the only exception.

This applies DEC-040's 90-day rule to the account-deletion workflow. It does
not authorize a production purge worker, deletion of hosted data, or a
retroactive deletion of historical records. The implementation must define
server-led scope, audit, idempotency, cancellation and legal-hold behavior
before any destructive operation.

## 3. Passport approval authority

The server derives the approver from authenticated server-side scope; the
request author never supplies an approval role.

The project owner may approve a passport. An architect may approve only when
the owner has granted a dedicated, scoped capability. Self-approval remains
allowed only where the project owner is the sole active approver and must be
marked as self-approval in the immutable audit history. A passport revision
invalidates an approval of an earlier revision.

## 4. M2 to M3 freshness and baseline identity

Each applicable room requires its latest approved M2→M3 handoff before it can
enter a baseline. A newer draft does not invalidate an approved handoff; a
newer approved handoff does.

Baseline and release eligibility bind exact immutable revision identifiers for
the room decision, selected materials, specifications and linked selections.
Any newer approved revision in that set requires review and a new exact
handoff; a client must not receive an unseen material or selection through an
otherwise unchanged room decision.

## 5. Telegram TG2

Telegram remains the single Integration Gateway → Messaging adapter defined by
DEC-031 and Addendum A7. It does not create a parallel project model or convey
RemHaOS authority.

1. Bind a chat to Organization/Project/Package through a stable Telegram chat
   ID, never a title, phone number or group display name. A changed chat ID
   needs an explicit, auditable migration.
2. Fix identity and scope authorization before accepting project actions.
3. Send attachments through the existing quarantine → server checksum → scan
   → review path. Telegram input creates candidates only.
4. Keep bridge flags default-off and scope any enabling to the organization and
   project. Telegram test chats and data stay disposable.
5. Then prove sender/projector delivery, replay and audit boundaries.

The TG2 implementation order is: identity and authority → scoped chat binding
and migration → attachment intake → HTTP transport, sender/projector and
replay/audit proof. This does not authorize a Telegram production bot,
credentials, external data-plane processing, or production enablement.

## 6. Evidence requirements

Every implementation slice must use additive migrations where required,
request-bound server authorization, exact revisions, append-only audit and
idempotency/restart checks. Local/disposable evidence is not production proof.

This decision does not alter the WP-32 runtime gate or the Aldo ALDO-1 through
ALDO-6 acceptance sequence.
