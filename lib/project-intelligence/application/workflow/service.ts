import {
  compareCodePoints,
  reviewRevision,
  validateProjectGraphSnapshot,
  type DomainIssue,
  type GraphNodeRevision,
  type HumanReview,
  type JsonValue,
  type ProjectGraphNode,
  type ProjectGraphSnapshot,
  type SourceLocator,
} from "../../index";
import { canonicalizeWorkflowCommand, workflowJsonEqual } from "./canonical";
import {
  WORKFLOW_CHANGE_REASON_CODES,
  type ApplicationActorContext,
  type PublishVersionCommand,
  type PublishVersionOutcome,
  type PublishedWorkflowChangeSet,
  type PublishedWorkflowVersion,
  type ReviseDecisionCommand,
  type ReviseDecisionOutcome,
  type ReviewClaimCommand,
  type ReviewClaimOutcome,
  type WorkflowApplicationError,
  type WorkflowApplicationErrorCode,
  type WorkflowApplicationResult,
  type WorkflowApplicationService,
  type WorkflowAtomicCommit,
  type WorkflowAuditIntent,
  type WorkflowCapability,
  type WorkflowChangeSet,
  type WorkflowCommandDigester,
  type WorkflowCommandIdentity,
  type WorkflowCommitResult,
  type WorkflowErrorDetailValue,
  type WorkflowExecutionContext,
  type WorkflowIdFactory,
  type WorkflowOperation,
  type WorkflowState,
  type WorkflowStatePort,
  type WorkflowStoredResult,
} from "./contracts";

export interface WorkflowApplicationDependencies {
  readonly statePort: WorkflowStatePort;
  readonly idFactory: WorkflowIdFactory;
  readonly commandDigester: WorkflowCommandDigester;
}

function success<T>(
  value: T,
  idempotentReplay = false,
): WorkflowApplicationResult<T> {
  return { ok: true, value, idempotentReplay };
}

function error(
  context: WorkflowExecutionContext,
  code: WorkflowApplicationErrorCode,
  details?: Readonly<Record<string, WorkflowErrorDetailValue>>,
): WorkflowApplicationError {
  return {
    code,
    requestId: context.requestId,
    retryable: false,
    ...(details ? { details } : {}),
  };
}

function failure<T>(
  context: WorkflowExecutionContext,
  code: WorkflowApplicationErrorCode,
  details?: Readonly<Record<string, WorkflowErrorDetailValue>>,
): WorkflowApplicationResult<T> {
  return { ok: false, error: error(context, code, details) };
}

function validIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
  );
}

function cloneLocator(locator: SourceLocator): SourceLocator {
  switch (locator.kind) {
    case "pdf":
      return {
        ...locator,
        ...(locator.bbox ? { bbox: [...locator.bbox] as [number, number, number, number] } : {}),
      };
    case "image":
      return { ...locator, bbox: [...locator.bbox] as [number, number, number, number] };
    default:
      return { ...locator };
  }
}

function cloneSnapshot(snapshot: ProjectGraphSnapshot): ProjectGraphSnapshot {
  return {
    projectId: snapshot.projectId,
    versionId: snapshot.versionId,
    sources: snapshot.sources.map((source) => ({ ...source })),
    sourceFragments: snapshot.sourceFragments.map((fragment) => ({
      ...fragment,
      locator: cloneLocator(fragment.locator),
    })),
    nodes: snapshot.nodes.map((node) => ({ ...node })),
    revisions: snapshot.revisions.map((revision) => ({
      ...revision,
      payload: cloneJson(revision.payload),
    })),
    reviews: snapshot.reviews.map((review) => ({
      ...review,
      actor: { ...review.actor },
    })),
    evidenceLinks: snapshot.evidenceLinks.map((link) => ({ ...link })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function captureExecutionContext(
  context: WorkflowExecutionContext,
): WorkflowExecutionContext {
  return deepFreeze({
    actor: {
      actorId: context.actor.actorId,
      actorType: context.actor.actorType,
      organizationId: context.actor.organizationId,
      projectId: context.actor.projectId,
      capabilities: [...context.actor.capabilities],
    },
    serverTime: context.serverTime,
    requestId: context.requestId,
  });
}

function captureReviewCommand(command: ReviewClaimCommand): ReviewClaimCommand {
  return deepFreeze({
    projectId: command.projectId,
    targetRevisionId: command.targetRevisionId,
    expectedRevisionId: command.expectedRevisionId,
    expectedStateRevision: command.expectedStateRevision,
    decision: command.decision,
    idempotencyKey: command.idempotencyKey,
  });
}

function capturePublishCommand(command: PublishVersionCommand): PublishVersionCommand {
  return deepFreeze({
    projectId: command.projectId,
    expectedLatestVersionId: command.expectedLatestVersionId,
    expectedStateRevision: command.expectedStateRevision,
    label: command.label ?? null,
    selectedRevisions: command.selectedRevisions?.map(({ nodeId, revisionId }) => ({
      nodeId,
      revisionId,
    })),
    idempotencyKey: command.idempotencyKey,
  });
}

function captureReviseCommand(command: ReviseDecisionCommand): ReviseDecisionCommand {
  return deepFreeze({
    projectId: command.projectId,
    nodeId: command.nodeId,
    baseVersionId: command.baseVersionId,
    expectedRevisionId: command.expectedRevisionId,
    expectedStateRevision: command.expectedStateRevision,
    title: command.title,
    payload: cloneJson(command.payload),
    reasonCode: command.reasonCode,
    reason: command.reason,
    idempotencyKey: command.idempotencyKey,
  });
}

function revisionSignature(revision: GraphNodeRevision): string {
  return canonicalizeWorkflowCommand({
    id: revision.id,
    nodeId: revision.nodeId,
    projectId: revision.projectId,
    title: revision.title,
    payload: revision.payload,
    origin: revision.origin,
    claimStatus: revision.claimStatus,
    unknownReason: revision.unknownReason ?? null,
    replacesRevisionId: revision.replacesRevisionId ?? null,
  });
}

function stableNodeSignature(node: ProjectGraphNode): string {
  return canonicalizeWorkflowCommand({
    id: node.id,
    projectId: node.projectId,
    kind: node.kind,
    stableKey: node.stableKey,
  });
}

function stableNodeIdentityViolation(state: WorkflowState): string | null {
  const signatures = new Map<string, string>();
  const snapshots = [
    ...state.publishedVersions.map(({ snapshot }) => snapshot),
    state.draft,
  ];
  for (const snapshot of snapshots) {
    for (const node of snapshot.nodes) {
      const signature = stableNodeSignature(node);
      const previous = signatures.get(node.id);
      if (previous !== undefined && previous !== signature) return node.id;
      if (previous === undefined) signatures.set(node.id, signature);
    }
  }
  return null;
}

function revisionImmutabilityIssues(state: WorkflowState): DomainIssue[] {
  const signatures = new Map<string, string>();
  const issues: DomainIssue[] = [];
  const snapshots = [
    ...state.publishedVersions.map(({ snapshot }) => snapshot),
    state.draft,
  ];

  for (const snapshot of snapshots) {
    for (const revision of snapshot.revisions) {
      const signature = revisionSignature(revision);
      const previous = signatures.get(revision.id);
      if (previous !== undefined && previous !== signature) {
        issues.push({
          code: "revision_immutability_violation",
          entityId: revision.id,
          path: `/revisions/${revision.id}`,
          message: "The same immutable revision ID has different content across workflow snapshots.",
        });
      } else if (previous === undefined) {
        signatures.set(revision.id, signature);
      }
    }
  }
  return issues;
}

function domainDetails(issues: readonly DomainIssue[]): Readonly<Record<string, WorkflowErrorDetailValue>> {
  const first = issues[0];
  return {
    originalDomainCode: first?.code ?? "unknown_domain_issue",
    originalDomainCodes: [...new Set(issues.map(({ code }) => code))].sort(compareCodePoints),
    entityId: first?.entityId ?? null,
    path: first?.path ?? null,
  };
}

function isProjectClosureIssue(issue: DomainIssue): boolean {
  return issue.code === "project_mismatch"
    || issue.code === "source_project_mismatch"
    || issue.code === "revision_node_mismatch";
}

function mapDomainFailure<T>(
  context: WorkflowExecutionContext,
  issues: readonly DomainIssue[],
): WorkflowApplicationResult<T> {
  const code = issues[0]?.code;
  if (issues.some(isProjectClosureIssue)) {
    return failure(context, "PROJECT_SCOPE_VIOLATION", domainDetails(issues));
  }
  if (code === "review_target_mismatch" || code === "review_target_stale") {
    return failure(context, "REVISION_STALE", domainDetails(issues));
  }
  if (code === "review_actor_not_human") {
    return failure(context, "ACCESS_DENIED", domainDetails(issues));
  }
  if (code === "ai_claim_missing_evidence") {
    return failure(context, "EVIDENCE_ACK_REQUIRED", domainDetails(issues));
  }
  if (code === "duplicate_review_target" || code === "invalid_review_decision") {
    return failure(context, "INVALID_TRANSITION", domainDetails(issues));
  }
  return failure(context, "DOMAIN_CONTRACT_VIOLATION", domainDetails(issues));
}

function actorRecord(actor: ApplicationActorContext): {
  readonly actorId: string;
  readonly actorType: "human" | "ai" | "system";
} {
  return { actorId: actor.actorId, actorType: actor.actorType };
}

function contextFailure<T>(
  context: WorkflowExecutionContext,
  projectId: string,
  capability: WorkflowCapability,
  requireHuman: boolean,
): WorkflowApplicationResult<T> | null {
  const actor = context.actor;
  if (actor.projectId !== projectId) {
    return failure(context, "PROJECT_SCOPE_VIOLATION", {
      detailCode: "ACTOR_PROJECT_MISMATCH",
    });
  }
  if (
    !actor.actorId.trim()
    || !actor.organizationId.trim()
    || !actor.projectId.trim()
    || !context.requestId.trim()
    || !validIsoTimestamp(context.serverTime)
  ) {
    return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
      detailCode: "INVALID_SERVER_CONTEXT",
    });
  }
  if (
    (requireHuman && actor.actorType !== "human")
    || !actor.capabilities.includes(capability)
  ) {
    return failure(context, "ACCESS_DENIED", {
      requiredCapability: capability,
    });
  }
  return null;
}

function latestVersion(state: WorkflowState): PublishedWorkflowVersion | null {
  let latest: PublishedWorkflowVersion | null = null;
  for (const version of state.publishedVersions) {
    if (!latest || version.versionNo > latest.versionNo) latest = version;
  }
  return latest;
}

function stateFailure<T>(
  context: WorkflowExecutionContext,
  state: WorkflowState,
): WorkflowApplicationResult<T> | null {
  if (
    state.projectId !== context.actor.projectId
    || state.organizationId !== context.actor.organizationId
    || state.draft.projectId !== state.projectId
  ) {
    return failure(context, "PROJECT_SCOPE_VIOLATION", {
      detailCode: "WORKFLOW_STATE_SCOPE_MISMATCH",
    });
  }
  if (
    !Number.isSafeInteger(state.stateRevision)
    || state.stateRevision < 0
    || state.stateRevision >= Number.MAX_SAFE_INTEGER
  ) {
    return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
      detailCode: "INVALID_STATE_REVISION",
    });
  }

  const versionIds = new Set<string>();
  const versionNumbers = new Set<number>();
  for (const version of state.publishedVersions) {
    if (
      version.projectId !== state.projectId
      || version.snapshot.projectId !== state.projectId
      || version.snapshot.versionId !== version.id
    ) {
      return failure(context, "PROJECT_SCOPE_VIOLATION", {
        detailCode: "PUBLISHED_VERSION_SCOPE_MISMATCH",
      });
    }
    if (
      versionIds.has(version.id)
      || versionNumbers.has(version.versionNo)
      || !Number.isSafeInteger(version.versionNo)
      || version.versionNo < 1
    ) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "INVALID_VERSION_SEQUENCE",
      });
    }
    if (
      !version.id.trim()
      || !validIsoTimestamp(version.publishedAt)
      || !version.publishedBy.actorId.trim()
      || version.publishedBy.actorType !== "human"
    ) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "INVALID_PUBLISHED_VERSION_METADATA",
        versionId: version.id,
      });
    }
    versionIds.add(version.id);
    versionNumbers.add(version.versionNo);
    const publishedIssues = validateProjectGraphSnapshot(version.snapshot);
    if (publishedIssues.length) return mapDomainFailure(context, publishedIssues);
  }

  const orderedVersions = [...state.publishedVersions]
    .sort((left, right) => left.versionNo - right.versionNo);
  for (const [index, version] of orderedVersions.entries()) {
    const previous = orderedVersions[index - 1];
    if (
      version.versionNo !== index + 1
      || (previous ? version.baseVersionId !== previous.id : version.baseVersionId !== null)
    ) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "INVALID_VERSION_BASE_CHAIN",
        versionId: version.id,
      });
    }
  }

  const graphIssues = validateProjectGraphSnapshot(state.draft);
  if (graphIssues.length) return mapDomainFailure(context, graphIssues);
  let immutabilityIssues: DomainIssue[];
  try {
    immutabilityIssues = revisionImmutabilityIssues(state);
  } catch {
    return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
      detailCode: "INVALID_REVISION_CONTENT",
    });
  }
  if (immutabilityIssues.length) return mapDomainFailure(context, immutabilityIssues);
  const changedStableNodeId = stableNodeIdentityViolation(state);
  if (changedStableNodeId) {
    return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
      detailCode: "STABLE_NODE_IDENTITY_VIOLATION",
      nodeId: changedStableNodeId,
    });
  }

  const nodes = new Map(state.draft.nodes.map((node) => [node.id, node]));
  const revisions = new Map(state.draft.revisions.map((revision) => [revision.id, revision]));
  const versions = new Map(state.publishedVersions.map((version) => [version.id, version]));
  const changeSetIds = new Set<string>();
  for (const changeSet of state.changeSets) {
    if (changeSetIds.has(changeSet.id) || !changeSet.id.trim()) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "DUPLICATE_OR_EMPTY_CHANGE_SET_ID",
        changeSetId: changeSet.id,
      });
    }
    changeSetIds.add(changeSet.id);
    if (
      changeSet.projectId !== state.projectId
      || !versionIds.has(changeSet.fromVersionId)
      || (changeSet.status === "published" && !versionIds.has(changeSet.toVersionId))
    ) {
      return failure(context, "PROJECT_SCOPE_VIOLATION", {
        detailCode: "CHANGE_SET_VERSION_SCOPE_MISMATCH",
      });
    }
    if (
      !changeSet.reason.trim()
      || !(WORKFLOW_CHANGE_REASON_CODES as readonly string[]).includes(changeSet.reasonCode)
      || changeSet.actor.actorType !== "human"
      || !changeSet.actor.actorId.trim()
      || !validIsoTimestamp(changeSet.occurredAt)
    ) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "INVALID_CHANGE_SET_METADATA",
        changeSetId: changeSet.id,
      });
    }
    const node = nodes.get(changeSet.nodeId);
    const fromRevision = revisions.get(changeSet.fromRevisionId);
    const toRevision = revisions.get(changeSet.toRevisionId);
    if (!node || !fromRevision || !toRevision) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "CHANGE_SET_LINEAGE_MISSING",
        changeSetId: changeSet.id,
      });
    }
    if (
      node.projectId !== state.projectId
      || fromRevision.projectId !== state.projectId
      || toRevision.projectId !== state.projectId
      || fromRevision.nodeId !== node.id
      || toRevision.nodeId !== node.id
    ) {
      return failure(context, "PROJECT_SCOPE_VIOLATION", {
        detailCode: "CHANGE_SET_LINEAGE_SCOPE_MISMATCH",
        changeSetId: changeSet.id,
      });
    }
    if (
      node.kind !== "decision"
      || toRevision.replacesRevisionId !== fromRevision.id
    ) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "INVALID_CHANGE_SET_LINEAGE",
        changeSetId: changeSet.id,
      });
    }

    const fromVersion = versions.get(changeSet.fromVersionId)!;
    const fromVersionNode = fromVersion.snapshot.nodes.find(({ id }) => id === node.id);
    if (fromVersionNode?.currentRevisionId !== fromRevision.id) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "CHANGE_SET_FROM_SNAPSHOT_MISMATCH",
        changeSetId: changeSet.id,
      });
    }
    if (changeSet.status === "pending_publication") {
      if (changeSet.fromVersionId !== latestVersion(state)?.id) {
        return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
          detailCode: "PENDING_CHANGE_SET_BASE_STALE",
          changeSetId: changeSet.id,
        });
      }
      if (node.currentRevisionId !== toRevision.id) {
        return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
          detailCode: "PENDING_CHANGE_SET_DRAFT_MISMATCH",
          changeSetId: changeSet.id,
        });
      }
    } else {
      const toVersion = versions.get(changeSet.toVersionId)!;
      const toVersionNode = toVersion.snapshot.nodes.find(({ id }) => id === node.id);
      if (
        toVersionNode?.currentRevisionId !== toRevision.id
        || toVersion.baseVersionId !== fromVersion.id
        || toVersion.versionNo !== fromVersion.versionNo + 1
        || toVersion.versionNo <= fromVersion.versionNo
      ) {
        return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
          detailCode: "CHANGE_SET_TO_SNAPSHOT_MISMATCH",
          changeSetId: changeSet.id,
        });
      }
    }
  }

  return null;
}

function replayResult<T>(
  context: WorkflowExecutionContext,
  operation: WorkflowOperation,
  stored: WorkflowStoredResult,
): WorkflowApplicationResult<T> {
  if (stored.operation !== operation) {
    return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
      detailCode: "PORT_RESULT_OPERATION_MISMATCH",
      expectedOperation: operation,
      actualOperation: stored.operation,
    });
  }
  return success(stored.value as T, true);
}

function portLoadFailure<T>(
  context: WorkflowExecutionContext,
  kind: "idempotency_conflict" | "not_found",
): WorkflowApplicationResult<T> {
  return kind === "idempotency_conflict"
    ? failure(context, "IDEMPOTENCY_CONFLICT")
    : failure(context, "PROJECT_NOT_FOUND");
}

function portCommitResult<T>(
  context: WorkflowExecutionContext,
  operation: WorkflowOperation,
  localValue: T,
  result: WorkflowCommitResult,
): WorkflowApplicationResult<T> {
  switch (result.kind) {
    case "committed":
      return success(localValue);
    case "replay":
      return replayResult(context, operation, result.result);
    case "idempotency_conflict":
      return failure(context, "IDEMPOTENCY_CONFLICT");
    case "state_stale":
      return failure(context, "STATE_STALE", {
        currentStateRevision: result.currentStateRevision,
      });
    case "not_found":
      return failure(context, "PROJECT_NOT_FOUND");
  }
}

class DefaultWorkflowApplicationService implements WorkflowApplicationService {
  private readonly statePort: WorkflowStatePort;
  private readonly idFactory: WorkflowIdFactory;
  private readonly commandDigester: WorkflowCommandDigester;

  constructor(dependencies: WorkflowApplicationDependencies) {
    this.statePort = dependencies.statePort;
    this.idFactory = dependencies.idFactory;
    this.commandDigester = dependencies.commandDigester;
  }

  private async identity(
    context: WorkflowExecutionContext,
    operation: WorkflowOperation,
    projectId: string,
    idempotencyKey: string,
    canonicalBody: JsonValue,
  ): Promise<WorkflowApplicationResult<WorkflowCommandIdentity>> {
    if (!idempotencyKey.trim()) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
    let digest: string;
    try {
      digest = await this.commandDigester.digestCanonicalCommand(
        canonicalizeWorkflowCommand(canonicalBody),
      );
    } catch {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "COMMAND_DIGEST_FAILED",
      });
    }
    if (!digest.trim()) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "COMMAND_DIGEST_EMPTY",
      });
    }
    return success(deepFreeze({
      organizationId: context.actor.organizationId,
      projectId,
      operation,
      idempotencyKey,
      digest,
    }));
  }

  private async id(
    context: WorkflowExecutionContext,
    kind: "review" | "version" | "revision" | "change_set",
    projectId: string,
  ): Promise<WorkflowApplicationResult<string>> {
    const id = await this.idFactory.nextId({ kind, projectId });
    return id.trim()
      ? success(id)
      : failure(context, "DOMAIN_CONTRACT_VIOLATION", {
          detailCode: "SERVER_ID_EMPTY",
          idKind: kind,
        });
  }

  reviewClaim(
    context: WorkflowExecutionContext,
    command: ReviewClaimCommand,
  ): Promise<WorkflowApplicationResult<ReviewClaimOutcome>> {
    return this.executeReviewClaim(
      captureExecutionContext(context),
      captureReviewCommand(command),
    );
  }

  private async executeReviewClaim(
    context: WorkflowExecutionContext,
    command: ReviewClaimCommand,
  ): Promise<WorkflowApplicationResult<ReviewClaimOutcome>> {
    const contextProblem = contextFailure<ReviewClaimOutcome>(
      context,
      command.projectId,
      "review_claim",
      true,
    );
    if (contextProblem) return contextProblem;

    const identityResult = await this.identity(
      context,
      "review_claim",
      command.projectId,
      command.idempotencyKey,
      {
        operation: "review_claim",
        projectId: command.projectId,
        targetRevisionId: command.targetRevisionId,
        expectedRevisionId: command.expectedRevisionId,
        expectedStateRevision: command.expectedStateRevision,
        decision: command.decision,
      },
    );
    if (!identityResult.ok) return identityResult;

    const loaded = await this.statePort.load({
      projectId: command.projectId,
      organizationId: context.actor.organizationId,
      commandIdentity: identityResult.value,
    });
    if (loaded.kind === "replay") {
      return replayResult(context, "review_claim", loaded.result);
    }
    if (loaded.kind !== "loaded") return portLoadFailure(context, loaded.kind);
    const state = loaded.state;
    const invalidState = stateFailure<ReviewClaimOutcome>(context, state);
    if (invalidState) return invalidState;
    if (state.stateRevision !== command.expectedStateRevision) {
      return failure(context, "STATE_STALE", {
        currentStateRevision: state.stateRevision,
      });
    }
    if (command.targetRevisionId !== command.expectedRevisionId) {
      return failure(context, "REVISION_STALE", {
        currentRevisionId: command.targetRevisionId,
      });
    }

    const target = state.draft.revisions.find(({ id }) => id === command.targetRevisionId);
    const node = target
      ? state.draft.nodes.find(({ id }) => id === target.nodeId)
      : undefined;
    if (!target || !node || node.currentRevisionId !== command.expectedRevisionId) {
      return failure(context, "REVISION_STALE", {
        currentRevisionId: node?.currentRevisionId ?? null,
      });
    }
    if (target.projectId !== state.projectId || node.projectId !== state.projectId) {
      return failure(context, "PROJECT_SCOPE_VIOLATION", {
        detailCode: "REVIEW_TARGET_SCOPE_MISMATCH",
      });
    }

    const reviewIdResult = await this.id(context, "review", state.projectId);
    if (!reviewIdResult.ok) return reviewIdResult;
    if (state.draft.reviews.some(({ id }) => id === reviewIdResult.value)) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "SERVER_ID_COLLISION",
        idKind: "review",
      });
    }

    const transition = reviewRevision({
      snapshot: state.draft,
      reviewId: reviewIdResult.value,
      targetRevisionId: command.targetRevisionId,
      expectedRevisionId: command.expectedRevisionId,
      decision: command.decision,
      initiator: {
        kind: "human_action",
        actor: { actorId: context.actor.actorId, actorType: context.actor.actorType },
      },
      reviewedAt: context.serverTime,
    });
    if (!transition.ok) return mapDomainFailure(context, transition.issues);

    const nextDraft = cloneSnapshot(state.draft);
    nextDraft.versionId = `draft:${state.projectId}:state:${state.stateRevision + 1}`;
    nextDraft.reviews.push({
      ...transition.value.review,
      actor: { ...transition.value.review.actor },
    });
    const nextIssues = validateProjectGraphSnapshot(nextDraft);
    if (nextIssues.length) return mapDomainFailure(context, nextIssues);

    const outcome = deepFreeze<ReviewClaimOutcome>({
      stateRevision: state.stateRevision + 1,
      review: {
        ...transition.value.review,
        actor: { ...transition.value.review.actor },
      },
      effectiveClaimStatus: transition.value.effectiveClaimStatus,
    });
    const nextState = deepFreeze<WorkflowState>({
      ...state,
      stateRevision: outcome.stateRevision,
      draft: nextDraft,
      publishedVersions: [...state.publishedVersions],
      changeSets: [...state.changeSets],
    });
    const invalidNextState = stateFailure<ReviewClaimOutcome>(context, nextState);
    if (invalidNextState) return invalidNextState;
    const audit: WorkflowAuditIntent = deepFreeze({
      eventType: command.decision === "confirmed"
        ? "claim_review_confirmed"
        : "claim_review_rejected",
      organizationId: state.organizationId,
      projectId: state.projectId,
      actor: actorRecord(context.actor),
      occurredAt: context.serverTime,
      requestId: context.requestId,
      reviewId: outcome.review.id,
      targetRevisionId: outcome.review.targetRevisionId,
    });
    const stored: WorkflowStoredResult = deepFreeze({
      operation: "review_claim",
      value: outcome,
    });
    const committed = await this.statePort.commit({
      projectId: state.projectId,
      organizationId: state.organizationId,
      expectedStateRevision: state.stateRevision,
      commandIdentity: identityResult.value,
      nextState,
      auditIntents: [audit],
      result: stored,
    });
    return portCommitResult(context, "review_claim", outcome, committed);
  }

  publishVersion(
    context: WorkflowExecutionContext,
    command: PublishVersionCommand,
  ): Promise<WorkflowApplicationResult<PublishVersionOutcome>> {
    return this.executePublishVersion(
      captureExecutionContext(context),
      capturePublishCommand(command),
    );
  }

  private async executePublishVersion(
    context: WorkflowExecutionContext,
    command: PublishVersionCommand,
  ): Promise<WorkflowApplicationResult<PublishVersionOutcome>> {
    const contextProblem = contextFailure<PublishVersionOutcome>(
      context,
      command.projectId,
      "publish_version",
      true,
    );
    if (contextProblem) return contextProblem;

    const selectedForDigest = [...(command.selectedRevisions ?? [])]
      .map(({ nodeId, revisionId }) => ({ nodeId, revisionId }))
      .sort((left, right) => compareCodePoints(left.nodeId, right.nodeId)
        || compareCodePoints(left.revisionId, right.revisionId));
    const identityResult = await this.identity(
      context,
      "publish_version",
      command.projectId,
      command.idempotencyKey,
      {
        operation: "publish_version",
        projectId: command.projectId,
        expectedLatestVersionId: command.expectedLatestVersionId,
        expectedStateRevision: command.expectedStateRevision,
        label: command.label ?? null,
        selectedRevisions: selectedForDigest,
      },
    );
    if (!identityResult.ok) return identityResult;

    const loaded = await this.statePort.load({
      projectId: command.projectId,
      organizationId: context.actor.organizationId,
      commandIdentity: identityResult.value,
    });
    if (loaded.kind === "replay") {
      return replayResult(context, "publish_version", loaded.result);
    }
    if (loaded.kind !== "loaded") return portLoadFailure(context, loaded.kind);
    const state = loaded.state;
    const invalidState = stateFailure<PublishVersionOutcome>(context, state);
    if (invalidState) return invalidState;
    if (state.stateRevision !== command.expectedStateRevision) {
      return failure(context, "STATE_STALE", {
        currentStateRevision: state.stateRevision,
      });
    }

    const latest = latestVersion(state);
    if ((latest?.id ?? null) !== command.expectedLatestVersionId) {
      return failure(context, "VERSION_STALE", {
        currentVersionId: latest?.id ?? null,
      });
    }

    const nodes = new Map(state.draft.nodes.map((node) => [node.id, node]));
    const revisions = new Map(state.draft.revisions.map((revision) => [revision.id, revision]));
    const selections = new Map(
      state.draft.nodes.map((node) => [node.id, node.currentRevisionId]),
    );
    const explicitNodes = new Set<string>();
    for (const selection of command.selectedRevisions ?? []) {
      if (explicitNodes.has(selection.nodeId)) {
        return failure(context, "INVALID_TRANSITION", {
          detailCode: "DUPLICATE_NODE_SELECTION",
          nodeId: selection.nodeId,
        });
      }
      explicitNodes.add(selection.nodeId);
      const node = nodes.get(selection.nodeId);
      const revision = revisions.get(selection.revisionId);
      if (!node || !revision) {
        return failure(context, "REVISION_STALE", {
          currentRevisionId: node?.currentRevisionId ?? null,
        });
      }
      if (
        node.projectId !== state.projectId
        || revision.projectId !== state.projectId
        || revision.nodeId !== node.id
      ) {
        return failure(context, "PROJECT_SCOPE_VIOLATION", {
          detailCode: "VERSION_SELECTION_SCOPE_MISMATCH",
        });
      }
      if (node.currentRevisionId !== selection.revisionId) {
        return failure(context, "REVISION_STALE", {
          currentRevisionId: node.currentRevisionId,
        });
      }
      selections.set(node.id, selection.revisionId);
    }

    for (const [nodeId, revisionId] of selections) {
      const node = nodes.get(nodeId)!;
      const revision = revisions.get(revisionId)!;
      const confirmationRequired = revision.origin === "ai"
        && (node.kind === "decision" || node.kind === "requirement");
      const confirmed = state.draft.reviews.some(
        (review) => review.targetRevisionId === revisionId && review.decision === "confirmed",
      );
      if (confirmationRequired && !confirmed) {
        return failure(context, "INVALID_TRANSITION", {
          detailCode: "UNCONFIRMED_REQUIRED_CLAIM",
          nodeId,
          revisionId,
        });
      }
    }

    const versionIdResult = await this.id(context, "version", state.projectId);
    if (!versionIdResult.ok) return versionIdResult;
    if (state.publishedVersions.some(({ id }) => id === versionIdResult.value)) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "SERVER_ID_COLLISION",
        idKind: "version",
      });
    }

    const versionNo = (latest?.versionNo ?? 0) + 1;
    const activeRevisionIds = new Set(selections.values());
    const snapshot = cloneSnapshot(state.draft);
    snapshot.versionId = versionIdResult.value;
    snapshot.nodes = snapshot.nodes.map((node) => ({
      ...node,
      currentRevisionId: selections.get(node.id)!,
    }));
    snapshot.reviews = snapshot.reviews.filter(
      ({ targetRevisionId }) => activeRevisionIds.has(targetRevisionId),
    );
    const snapshotIssues = validateProjectGraphSnapshot(snapshot);
    if (snapshotIssues.length) return mapDomainFailure(context, snapshotIssues);

    const linkedChangeSetIds = state.changeSets
      .filter((changeSet) => {
        if (
          changeSet.status !== "pending_publication"
          || changeSet.fromVersionId !== latest?.id
        ) return false;
        const selectedRevisionId = selections.get(changeSet.nodeId);
        return selectedRevisionId === changeSet.toRevisionId;
      })
      .map(({ id }) => id)
      .sort(compareCodePoints);
    const linkedIds = new Set(linkedChangeSetIds);
    const nextChangeSets: WorkflowChangeSet[] = state.changeSets.map((changeSet) => {
      if (!linkedIds.has(changeSet.id) || changeSet.status !== "pending_publication") {
        return changeSet;
      }
      const published: PublishedWorkflowChangeSet = {
        ...changeSet,
        status: "published",
        toVersionId: versionIdResult.value,
      };
      return deepFreeze(published);
    });

    const frozenSnapshot = deepFreeze(snapshot);
    const version = deepFreeze<PublishedWorkflowVersion>({
      id: versionIdResult.value,
      projectId: state.projectId,
      versionNo,
      baseVersionId: latest?.id ?? null,
      label: command.label ?? null,
      snapshot: frozenSnapshot,
      publishedAt: context.serverTime,
      publishedBy: actorRecord(context.actor),
    });
    const outcome = deepFreeze<PublishVersionOutcome>({
      stateRevision: state.stateRevision + 1,
      version,
      linkedChangeSetIds,
    });
    const nextState = deepFreeze<WorkflowState>({
      ...state,
      stateRevision: outcome.stateRevision,
      draft: cloneSnapshot(frozenSnapshot),
      publishedVersions: [...state.publishedVersions, version],
      changeSets: nextChangeSets,
    });
    const invalidNextState = stateFailure<PublishVersionOutcome>(context, nextState);
    if (invalidNextState) return invalidNextState;
    const audit: WorkflowAuditIntent = deepFreeze({
      eventType: "project_version_published",
      organizationId: state.organizationId,
      projectId: state.projectId,
      actor: actorRecord(context.actor),
      occurredAt: context.serverTime,
      requestId: context.requestId,
      versionId: version.id,
      baseVersionId: version.baseVersionId,
      versionNo: version.versionNo,
      selectedRevisionCount: selections.size,
      linkedChangeSetIds,
    });
    const stored: WorkflowStoredResult = deepFreeze({
      operation: "publish_version",
      value: outcome,
    });
    const commitRequest: WorkflowAtomicCommit = {
      projectId: state.projectId,
      organizationId: state.organizationId,
      expectedStateRevision: state.stateRevision,
      commandIdentity: identityResult.value,
      nextState,
      auditIntents: [audit],
      result: stored,
    };
    const committed = await this.statePort.commit(commitRequest);
    return portCommitResult(context, "publish_version", outcome, committed);
  }

  reviseDecision(
    context: WorkflowExecutionContext,
    command: ReviseDecisionCommand,
  ): Promise<WorkflowApplicationResult<ReviseDecisionOutcome>> {
    return this.executeReviseDecision(
      captureExecutionContext(context),
      captureReviseCommand(command),
    );
  }

  private async executeReviseDecision(
    context: WorkflowExecutionContext,
    command: ReviseDecisionCommand,
  ): Promise<WorkflowApplicationResult<ReviseDecisionOutcome>> {
    const contextProblem = contextFailure<ReviseDecisionOutcome>(
      context,
      command.projectId,
      "revise_decision",
      true,
    );
    if (contextProblem) return contextProblem;
    if (
      !command.reason.trim()
      || !(WORKFLOW_CHANGE_REASON_CODES as readonly string[]).includes(command.reasonCode)
    ) {
      return failure(context, "CHANGE_REASON_REQUIRED", {
        nodeId: command.nodeId,
      });
    }
    if (!command.title.trim()) {
      return failure(context, "INVALID_TRANSITION", {
        detailCode: "DECISION_TITLE_REQUIRED",
        nodeId: command.nodeId,
      });
    }

    const identityResult = await this.identity(
      context,
      "revise_decision",
      command.projectId,
      command.idempotencyKey,
      {
        operation: "revise_decision",
        projectId: command.projectId,
        nodeId: command.nodeId,
        baseVersionId: command.baseVersionId,
        expectedRevisionId: command.expectedRevisionId,
        expectedStateRevision: command.expectedStateRevision,
        title: command.title,
        payload: command.payload,
        reasonCode: command.reasonCode,
        reason: command.reason,
      },
    );
    if (!identityResult.ok) return identityResult;

    const loaded = await this.statePort.load({
      projectId: command.projectId,
      organizationId: context.actor.organizationId,
      commandIdentity: identityResult.value,
    });
    if (loaded.kind === "replay") {
      return replayResult(context, "revise_decision", loaded.result);
    }
    if (loaded.kind !== "loaded") return portLoadFailure(context, loaded.kind);
    const state = loaded.state;
    const invalidState = stateFailure<ReviseDecisionOutcome>(context, state);
    if (invalidState) return invalidState;
    if (state.stateRevision !== command.expectedStateRevision) {
      return failure(context, "STATE_STALE", {
        currentStateRevision: state.stateRevision,
      });
    }

    const latest = latestVersion(state);
    if (!latest || latest.id !== command.baseVersionId) {
      return failure(context, "VERSION_STALE", {
        currentVersionId: latest?.id ?? null,
      });
    }
    const node = state.draft.nodes.find(({ id }) => id === command.nodeId);
    if (!node) {
      return failure(context, "INVALID_TRANSITION", {
        detailCode: "DECISION_NODE_NOT_FOUND",
        nodeId: command.nodeId,
      });
    }
    if (node.projectId !== state.projectId) {
      return failure(context, "PROJECT_SCOPE_VIOLATION", {
        detailCode: "DECISION_NODE_SCOPE_MISMATCH",
      });
    }
    if (node.kind !== "decision") {
      return failure(context, "INVALID_TRANSITION", {
        detailCode: "NODE_NOT_DECISION",
        nodeId: node.id,
      });
    }
    const currentRevision = state.draft.revisions.find(
      ({ id }) => id === command.expectedRevisionId,
    );
    if (!currentRevision || node.currentRevisionId !== command.expectedRevisionId) {
      return failure(context, "REVISION_STALE", {
        currentRevisionId: node.currentRevisionId,
      });
    }
    if (
      currentRevision.projectId !== state.projectId
      || currentRevision.nodeId !== node.id
    ) {
      return failure(context, "PROJECT_SCOPE_VIOLATION", {
        detailCode: "DECISION_REVISION_SCOPE_MISMATCH",
      });
    }

    const baseNode = latest.snapshot.nodes.find(({ id }) => id === node.id);
    if (!baseNode || baseNode.currentRevisionId !== command.expectedRevisionId) {
      return failure(context, "VERSION_STALE", {
        currentVersionId: latest.id,
        baseRevisionId: baseNode?.currentRevisionId ?? null,
      });
    }
    const confirmed = state.draft.reviews.some(
      (review) => review.targetRevisionId === currentRevision.id
        && review.decision === "confirmed",
    ) || latest.snapshot.reviews.some(
      (review) => review.targetRevisionId === currentRevision.id
        && review.decision === "confirmed",
    );
    if (!confirmed) {
      return failure(context, "INVALID_TRANSITION", {
        detailCode: "CONFIRMED_DECISION_REQUIRED",
        revisionId: currentRevision.id,
      });
    }
    if (workflowJsonEqual(currentRevision.payload, command.payload)) {
      return failure(context, "INVALID_TRANSITION", {
        detailCode: "NO_SEMANTIC_CHANGE",
        nodeId: node.id,
      });
    }

    const revisionIdResult = await this.id(context, "revision", state.projectId);
    if (!revisionIdResult.ok) return revisionIdResult;
    const reviewIdResult = await this.id(context, "review", state.projectId);
    if (!reviewIdResult.ok) return reviewIdResult;
    const changeSetIdResult = await this.id(context, "change_set", state.projectId);
    if (!changeSetIdResult.ok) return changeSetIdResult;
    if (
      state.draft.revisions.some(({ id }) => id === revisionIdResult.value)
      || state.draft.reviews.some(({ id }) => id === reviewIdResult.value)
      || state.changeSets.some(({ id }) => id === changeSetIdResult.value)
    ) {
      return failure(context, "DOMAIN_CONTRACT_VIOLATION", {
        detailCode: "SERVER_ID_COLLISION",
      });
    }

    const revision: GraphNodeRevision = deepFreeze({
      id: revisionIdResult.value,
      nodeId: node.id,
      projectId: state.projectId,
      title: command.title,
      payload: cloneJson(command.payload),
      origin: "human",
      claimStatus: "interpreted",
      replacesRevisionId: currentRevision.id,
    });
    const review: HumanReview = deepFreeze({
      id: reviewIdResult.value,
      projectId: state.projectId,
      targetRevisionId: revision.id,
      decision: "confirmed",
      actor: { id: context.actor.actorId, type: "human" },
      reviewedAt: context.serverTime,
    });
    const changeSet = deepFreeze({
      id: changeSetIdResult.value,
      projectId: state.projectId,
      nodeId: node.id,
      fromVersionId: latest.id,
      toVersionId: null,
      fromRevisionId: currentRevision.id,
      toRevisionId: revision.id,
      reasonCode: command.reasonCode,
      reason: command.reason,
      actor: { actorId: context.actor.actorId, actorType: "human" as const },
      occurredAt: context.serverTime,
      status: "pending_publication" as const,
    });

    const nodeRevisionIds = new Set(
      state.draft.revisions
        .filter(({ nodeId }) => nodeId === node.id)
        .map(({ id }) => id),
    );
    const nextDraft = cloneSnapshot(state.draft);
    nextDraft.versionId = `draft:${state.projectId}:state:${state.stateRevision + 1}`;
    nextDraft.nodes = nextDraft.nodes.map((draftNode) => draftNode.id === node.id
      ? { ...draftNode, currentRevisionId: revision.id }
      : draftNode);
    nextDraft.revisions.push({
      ...revision,
      payload: cloneJson(revision.payload),
    });
    nextDraft.reviews = nextDraft.reviews
      .filter(({ targetRevisionId }) => !nodeRevisionIds.has(targetRevisionId));
    nextDraft.reviews.push({ ...review, actor: { ...review.actor } });
    const nextIssues = validateProjectGraphSnapshot(nextDraft);
    if (nextIssues.length) return mapDomainFailure(context, nextIssues);

    const outcome = deepFreeze<ReviseDecisionOutcome>({
      stateRevision: state.stateRevision + 1,
      revision,
      review,
      changeSet,
    });
    const nextState = deepFreeze<WorkflowState>({
      ...state,
      stateRevision: outcome.stateRevision,
      draft: nextDraft,
      publishedVersions: [...state.publishedVersions],
      changeSets: [...state.changeSets, changeSet],
    });
    const invalidNextState = stateFailure<ReviseDecisionOutcome>(context, nextState);
    if (invalidNextState) return invalidNextState;
    const audit: WorkflowAuditIntent = deepFreeze({
      eventType: "confirmed_decision_revised",
      organizationId: state.organizationId,
      projectId: state.projectId,
      actor: actorRecord(context.actor),
      occurredAt: context.serverTime,
      requestId: context.requestId,
      changeSetId: changeSet.id,
      nodeId: node.id,
      fromRevisionId: currentRevision.id,
      toRevisionId: revision.id,
      reasonCode: command.reasonCode,
    });
    const stored: WorkflowStoredResult = deepFreeze({
      operation: "revise_decision",
      value: outcome,
    });
    const committed = await this.statePort.commit({
      projectId: state.projectId,
      organizationId: state.organizationId,
      expectedStateRevision: state.stateRevision,
      commandIdentity: identityResult.value,
      nextState,
      auditIntents: [audit],
      result: stored,
    });
    return portCommitResult(context, "revise_decision", outcome, committed);
  }
}

export function createWorkflowApplicationService(
  dependencies: WorkflowApplicationDependencies,
): WorkflowApplicationService {
  return new DefaultWorkflowApplicationService(dependencies);
}
