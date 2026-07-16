# Workflow application interface summary

Status: `accepted_candidate` for the Wave 2 L1 test-adapter boundary. This module does
not provide database durability, RLS, HTTP delivery or production persistence.

## Public entry point

`lib/project-intelligence/application/workflow/index.ts` exports only production
contracts/helpers and the service factory.

Runtime exports:

- `WORKFLOW_CAPABILITIES`;
- `WORKFLOW_APPLICATION_ERROR_CODES`;
- `WORKFLOW_CHANGE_REASON_CODES`;
- `canonicalizeWorkflowCommand(value)`;
- `workflowJsonEqual(left, right)`;
- `createWorkflowApplicationService(dependencies)`.

Exported types/interfaces:

- context/policy: `ApplicationActorContext`, `WorkflowExecutionContext`,
  `WorkflowCapability`, `WorkflowRecordedActor`;
- errors/results: `WorkflowApplicationErrorCode`, `WorkflowErrorDetailValue`,
  `WorkflowApplicationError`, `WorkflowApplicationResult<T>`;
- state: `WorkflowState`, `PublishedWorkflowVersion`, `WorkflowChangeSet`,
  `PendingWorkflowChangeSet`, `PublishedWorkflowChangeSet`,
  `WorkflowChangeReasonCode`;
- commands/outcomes: `ReviewClaimCommand`, `ReviewClaimOutcome`,
  `PublishVersionCommand`, `PublishVersionOutcome`, `SelectedWorkflowRevision`,
  `ReviseDecisionCommand`, `ReviseDecisionOutcome`;
- identity/server dependencies: `WorkflowOperation`, `WorkflowCommandIdentity`,
  `WorkflowCommandDigester`, `WorkflowIdKind`, `WorkflowIdFactory`;
- atomic port: `WorkflowStatePort`, `WorkflowLoadRequest`, `WorkflowLoadResult`,
  `WorkflowAtomicCommit`, `WorkflowCommitResult`, `WorkflowStoredResult`;
- audit intents: `WorkflowAuditIntent`, `ClaimReviewedAuditIntent`,
  `ProjectVersionPublishedAuditIntent`, `ConfirmedDecisionRevisedAuditIntent`;
- façade: `WorkflowApplicationDependencies`, `WorkflowApplicationService`.

No in-memory adapter, fixture, fake clock or test helper is exported.

## Operation signatures

```ts
interface WorkflowApplicationService {
  reviewClaim(
    context: WorkflowExecutionContext,
    command: ReviewClaimCommand,
  ): Promise<WorkflowApplicationResult<ReviewClaimOutcome>>;

  publishVersion(
    context: WorkflowExecutionContext,
    command: PublishVersionCommand,
  ): Promise<WorkflowApplicationResult<PublishVersionOutcome>>;

  reviseDecision(
    context: WorkflowExecutionContext,
    command: ReviseDecisionCommand,
  ): Promise<WorkflowApplicationResult<ReviseDecisionOutcome>>;
}
```

All commands contain project scope, optimistic fields and an idempotency key. Actor,
organization authority, capabilities, server time and request correlation exist only in
`WorkflowExecutionContext`. IDs come only from `WorkflowIdFactory`. The façade
defensively captures the context, command, nested payload and selection arrays before
the first async boundary, so caller mutation cannot diverge committed content from the
canonical digest.

## State and version semantics

`WorkflowState` contains organization/project closure, monotonic `stateRevision`, the
current draft graph, all immutable published versions and ChangeSets.

- Human review calls the frozen `reviewRevision`, appends its exact review and leaves the
  target revision/evidence unchanged.
- Publication selects current exact revisions (a partial explicit selection may overlay
  the server-owned draft selection), checks required AI decision/requirement
  confirmations, validates frozen graph invariants, allocates `versionNo` inside the CAS
  boundary and deep-clones/freezes the published graph.
- Prior published objects are never rewritten. The mutable draft receives a separate
  clone of the published snapshot.
- Loaded state is rejected if the same revision ID changes immutable content across
  draft/published snapshots, if a stable node ID changes project/kind/stable key, or if
  the published base chain is not exact and monotonic.
- A confirmed decision change creates a human-origin revision with
  `replacesRevisionId`, an exact human confirmation for the new current revision and a
  protected pending ChangeSet. The active draft review projection retains reviews only
  for current revisions; the previous exact review remains unchanged in V1 and atomic
  audit history.
- Publishing V2 replaces a matching pending ChangeSet record with a finalized immutable
  record containing exact `fromVersionId` and `toVersionId`, in the same logical commit
  as V2 publication.
- Port-loaded ChangeSets are checked for unique identity, controlled human metadata,
  direct revision lineage and exact active from/to revisions in their referenced
  snapshots before any mutation.
- Free-text ChangeSet `reason` is protected state content. Audit intents contain only its
  controlled `reasonCode`, IDs and server-owned actor/time/request metadata.

## Atomic port and idempotency semantics

```ts
interface WorkflowStatePort {
  load(request: WorkflowLoadRequest): Promise<WorkflowLoadResult>;
  commit(request: WorkflowAtomicCommit): Promise<WorkflowCommitResult>;
}
```

Identity scope is `(organizationId, projectId, operation, idempotencyKey)`. The service
canonicalizes the business command and delegates hashing to `WorkflowCommandDigester`.
The canonical body excludes actor, server time, request ID and the idempotency key.

The adapter contract is:

1. `load` resolves a prior identity first. Same key/digest returns the stored logical
   result before current-state validation; same key/different digest reports conflict.
2. `commit` must repeat the identity check and compare `expectedStateRevision` inside
   one transaction/critical section.
3. On success, `nextState`, the stored logical result/digest and all audit intents become
   visible atomically.
4. On conflict/stale/not-found, none becomes visible.

The L1 test adapter models this contract in memory. It is not evidence of durable,
multi-process or database atomicity.

## Integrator usage sketch

```ts
import {
  createWorkflowApplicationService,
  type WorkflowExecutionContext,
} from "@/lib/project-intelligence/application/workflow";

const workflow = createWorkflowApplicationService({
  statePort,          // owner-provided atomic test/production adapter
  idFactory,          // server-only IDs
  commandDigester,    // hashes the received canonical string
});

const execution: WorkflowExecutionContext = {
  actor: {
    actorId: "actor-designer-reviewer",
    actorType: "human",
    organizationId: "organization-synthetic-001",
    projectId: "project-kitchen-001",
    capabilities: ["review_claim", "publish_version", "revise_decision"],
  },
  serverTime: "2026-07-16T00:05:00.000Z",
  requestId: "request-synthetic-review-001",
};

const reviewed = await workflow.reviewClaim(execution, {
  projectId: "project-kitchen-001",
  targetRevisionId: "revision-decision-worktop-material-r1",
  expectedRevisionId: "revision-decision-worktop-material-r1",
  expectedStateRevision: 0,
  decision: "confirmed",
  idempotencyKey: "review-decision-r1",
});
```

For change-impact composition, Integrator maps
`PublishedWorkflowVersion.snapshot.nodes + revisions` to the frozen
`ProjectVersionSnapshot` diff projection and passes the exact published graph snapshot
as the target graph. A finalized `PublishedWorkflowChangeSet` supplies the exact version
pair and controlled reason code.
