import {
  DomainContractError,
  PROPAGATING_RELATIONS,
  calculateChangeImpact,
  changedNodeIds as deriveChangedNodeIds,
  compareCodePoints,
  diffProjectVersions,
  validateProjectGraphSnapshot,
  type GraphNodeRevision,
  type JsonValue,
  type ProjectGraphSnapshot,
  type SourceLocator,
  type ProjectVersionSnapshot,
} from "../../index";
import { canonicalJson, semanticSha256 } from "./canonical";
import {
  APPLICATION_ACTOR_TYPES,
  CHANGE_HANDOFF_CAPABILITIES,
  IMPACT_DISPOSITIONS,
  IMPACT_REASON_CODES,
  IMPACT_STATUSES,
} from "./types";
import type {
  ApplicationActorType,
  ApplicationExecutionContext,
  BuildLogicalHandoffCommand,
  CalculateImpactRunCommand,
  ChangeContext,
  ChangeHandoffApplicationError,
  ChangeHandoffApplicationErrorCode,
  ChangeHandoffApplicationResult,
  ChangeHandoffApplicationState,
  ChangeHandoffAuditIntent,
  ChangeHandoffCapability,
  ChangeHandoffIdFactory,
  ChangeHandoffIdInput,
  ChangeHandoffIdempotencyRecord,
  ChangeHandoffMutationSuccess,
  ImpactAlgorithmDescriptor,
  ImpactDisposition,
  ImpactReasonCode,
  ImpactReview,
  ImpactRun,
  ImpactStatus,
  LogicalHandoff,
  LogicalHandoffArea,
  LogicalHandoffContent,
  LogicalHandoffDecision,
  LogicalHandoffDeliverable,
  LogicalHandoffImpact,
  LogicalHandoffItem,
  LogicalHandoffRequirement,
  LogicalHandoffSourceReference,
  JsonObject,
  PersistedImpact,
  ReviewImpactCommand,
} from "./types";

const IMPACT_ALGORITHM: ImpactAlgorithmDescriptor = {
  version: "project-intelligence-impact/0.1",
  direction: "reverse_dependency",
  propagatingRelations: [...PROPAGATING_RELATIONS].sort(compareCodePoints),
  cyclePolicy: "shortest_path_per_changed_root",
  ordering: "unicode_code_point",
};

const ID_PREFIX = {
  impact_run: "impact-run",
  impact: "impact",
  impact_review: "impact-review",
  handoff_artifact: "handoff-artifact",
  source_reference: "source-reference",
} as const;

type ApplicationFailure = {
  readonly ok: false;
  readonly error: ChangeHandoffApplicationError;
};

function applicationError(
  code: ChangeHandoffApplicationErrorCode,
  details?: JsonObject,
  retryable = false,
): ApplicationFailure {
  const error: ChangeHandoffApplicationError = {
    code,
    retryable,
    ...(details ? { details } : {}),
  };
  return { ok: false, error };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function immutable<T>(value: T): T {
  return freezeDeep(clone(value));
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function sortedById<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareCodePoints(left.id, right.id));
}

function normalizeChangeContext(context: ChangeContext): ChangeContext {
  return {
    projectId: context.projectId,
    fromVersionId: context.fromVersionId,
    toVersionId: context.toVersionId,
    changeSetId: context.changeSetId,
    reasonCode: context.reasonCode,
  };
}

function normalizeVersion(version: ProjectVersionSnapshot): ProjectVersionSnapshot {
  return {
    projectId: version.projectId,
    versionId: version.versionId,
    nodes: [...version.nodes]
      .sort((left, right) => compareCodePoints(left.nodeId, right.nodeId))
      .map((node) => clone(node)),
  };
}

function normalizeGraph(graph: ProjectGraphSnapshot): ProjectGraphSnapshot {
  return {
    projectId: graph.projectId,
    versionId: graph.versionId,
    sources: sortedById(graph.sources).map((value) => clone(value)),
    sourceFragments: sortedById(graph.sourceFragments).map((value) => clone(value)),
    nodes: sortedById(graph.nodes).map((value) => clone(value)),
    revisions: sortedById(graph.revisions).map((value) => clone(value)),
    reviews: sortedById(graph.reviews).map((value) => clone(value)),
    evidenceLinks: sortedById(graph.evidenceLinks).map((value) => clone(value)),
    edges: sortedById(graph.edges).map((value) => clone(value)),
  };
}

function isValidServerTime(value: unknown): value is string {
  return typeof value === "string"
    && value.trim() === value
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value === value.trim();
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isApplicationActorType(value: unknown): value is ApplicationActorType {
  return isOneOf(value, APPLICATION_ACTOR_TYPES);
}

function isImpactDisposition(value: unknown): value is ImpactDisposition {
  return isOneOf(value, IMPACT_DISPOSITIONS);
}

function isImpactStatus(value: unknown): value is ImpactStatus {
  return isOneOf(value, IMPACT_STATUSES);
}

function isImpactReasonCode(value: unknown): value is ImpactReasonCode {
  return isOneOf(value, IMPACT_REASON_CODES);
}

function hasValidCapabilities(
  value: unknown,
): value is readonly ChangeHandoffCapability[] {
  return Array.isArray(value)
    && value.every((capability) => isOneOf(capability, CHANGE_HANDOFF_CAPABILITIES))
    && new Set(value).size === value.length;
}

function hasCapability(
  execution: ApplicationExecutionContext,
  capability: ChangeHandoffCapability,
): boolean {
  return execution.capabilities.includes(capability);
}

function validateCommon(
  execution: ApplicationExecutionContext,
  state: ChangeHandoffApplicationState,
  projectId: string,
  capability: ChangeHandoffCapability,
  idempotencyKey: string,
): ChangeHandoffApplicationResult<true> {
  if (!isApplicationActorType(execution.actorType)) {
    return applicationError("DOMAIN_CONTRACT_VIOLATION", {
      reasonCode: "INVALID_APPLICATION_ACTOR_TYPE",
    });
  }
  if (!hasValidCapabilities(execution.capabilities)) {
    return applicationError("DOMAIN_CONTRACT_VIOLATION", {
      reasonCode: "INVALID_CHANGE_HANDOFF_CAPABILITY",
    });
  }
  if (
    execution.projectId !== projectId
    || state.projectId !== projectId
    || state.organizationId !== execution.organizationId
  ) {
    return applicationError("PROJECT_SCOPE_VIOLATION", { reasonCode: "PROJECT_SCOPE_MISMATCH" });
  }
  if (!hasCapability(execution, capability)) {
    return applicationError("ACCESS_DENIED", { requiredCapability: capability });
  }
  if (
    !nonEmpty(execution.actorId)
    || !nonEmpty(execution.organizationId)
    || !nonEmpty(execution.requestId)
    || !isValidServerTime(execution.serverTime)
    || !nonEmpty(idempotencyKey)
  ) {
    return applicationError("DOMAIN_CONTRACT_VIOLATION", {
      reasonCode: "INVALID_SERVER_CONTEXT_OR_IDEMPOTENCY_KEY",
    });
  }
  return { ok: true, value: true };
}

function idempotencyRecord(
  state: ChangeHandoffApplicationState,
  execution: ApplicationExecutionContext,
  operation: ChangeHandoffIdempotencyRecord["operation"],
  key: string,
): ChangeHandoffIdempotencyRecord | undefined {
  return state.idempotencyRecords.find((record) => (
    record.organizationId === execution.organizationId
    && record.projectId === execution.projectId
    && record.operation === operation
    && record.key === key
  ));
}

function exactTargetFailure(
  version: ProjectVersionSnapshot,
  graph: ProjectGraphSnapshot,
): ApplicationFailure | undefined {
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const graphRevisions = new Map(graph.revisions.map((revision) => [revision.id, revision]));
  const selectedIds = [...version.nodes.map(({ nodeId }) => nodeId)].sort(compareCodePoints);
  const graphIds = [...graph.nodes.map(({ id }) => id)].sort(compareCodePoints);
  if (canonicalJson(selectedIds) !== canonicalJson(graphIds)) {
    return applicationError("VERSION_STALE", { reasonCode: "TARGET_GRAPH_NODE_SET_MISMATCH" });
  }

  for (const selected of version.nodes) {
    const node = graphNodes.get(selected.nodeId);
    const revision = graphRevisions.get(selected.revisionId);
    if (
      !node
      || node.currentRevisionId !== selected.revisionId
      || !revision
      || revision.nodeId !== selected.nodeId
      || canonicalJson(revision.payload) !== canonicalJson(selected.payload)
    ) {
      return applicationError("VERSION_STALE", {
        reasonCode: "TARGET_GRAPH_REVISION_MISMATCH",
        nodeId: selected.nodeId,
      });
    }
  }
  return undefined;
}

function domainFailure(error: unknown): ApplicationFailure {
  if (!(error instanceof DomainContractError)) throw error;
  const scopeCodes = new Set([
    "diff_project_mismatch",
    "project_mismatch",
    "source_project_mismatch",
  ]);
  return applicationError(
    scopeCodes.has(error.code) ? "PROJECT_SCOPE_VIOLATION" : "DOMAIN_CONTRACT_VIOLATION",
    {
      domainCode: error.code,
      ...(error.entityId ? { entityId: error.entityId } : {}),
      ...(error.path ? { path: error.path } : {}),
    },
  );
}

function latestImpactStatus(
  reviews: readonly ImpactReview[],
  impactRunId: string,
  impactId: string,
): ImpactStatus {
  const latest = [...reviews]
    .reverse()
    .find((review) => review.impactRunId === impactRunId && review.impactId === impactId);
  return latest?.disposition ?? "needs_review";
}

function transitionAllowed(from: unknown, to: unknown): boolean {
  if (!isImpactStatus(from) || !isImpactDisposition(to)) return false;
  if (from === "needs_review") return true;
  if (from === "accepted") return to === "resolved" || to === "dismissed";
  return false;
}

function impactReviewRuntimeFailure(
  reviews: readonly ImpactReview[],
): ApplicationFailure | undefined {
  const invalid = reviews.find((review) => (
    !isImpactStatus(review.previousStatus)
    || !isImpactDisposition(review.disposition)
    || !isImpactReasonCode(review.reasonCode)
    || review.actor.actorType !== "human"
    || !nonEmpty(review.actor.actorId)
    || !isValidServerTime(review.reviewedAt)
  ));
  return invalid
    ? applicationError("DOMAIN_CONTRACT_VIOLATION", {
      reasonCode: "INVALID_STORED_IMPACT_REVIEW",
      impactReviewId: invalid.id,
    })
    : undefined;
}

function normalizePolicy(command: BuildLogicalHandoffCommand): unknown {
  return {
    canonicalMetadata: clone(command.policy.canonicalMetadata),
    displayMetadata: clone(command.policy.displayMetadata),
    sourceReferenceProjections: [...(command.policy.sourceReferenceProjections ?? [])]
      .sort((left, right) => compareCodePoints(left.evidenceLinkId, right.evidenceLinkId)
        || compareCodePoints(left.referenceId, right.referenceId))
      .map((projection) => clone(projection)),
  };
}

function asJsonRecord(value: JsonValue): { [key: string]: JsonValue } | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function stringField(revision: GraphNodeRevision, field: string, fallback: string): string {
  const value = asJsonRecord(revision.payload)?.[field];
  return typeof value === "string" ? value : fallback;
}

function effectiveClaimStatus(
  graph: ProjectGraphSnapshot,
  revision: GraphNodeRevision,
): "extracted" | "interpreted" | "unknown" | "human_confirmed" | "human_rejected" {
  const review = graph.reviews.find(({ targetRevisionId }) => targetRevisionId === revision.id);
  if (review?.decision === "confirmed") return "human_confirmed";
  if (review?.decision === "rejected") return "human_rejected";
  return revision.claimStatus;
}

function displayLocator(locator: SourceLocator): JsonValue {
  switch (locator.kind) {
    case "pdf": return {
      page: locator.page,
      ...(locator.bbox ? { bbox: [...locator.bbox] } : {}),
    };
    case "transcript": return {
      startMs: locator.startMs,
      endMs: locator.endMs,
      ...(locator.speaker ? { speaker: locator.speaker } : {}),
    };
    case "image": return {
      coordinateSystem: locator.coordinateSystem,
      bbox: [...locator.bbox],
    };
    case "spreadsheet": return { sheet: locator.sheet, cellRange: locator.cellRange };
    case "email": return {
      messageId: locator.messageId,
      ...(locator.paragraph !== undefined ? { paragraph: locator.paragraph } : {}),
      ...(locator.part !== undefined ? { part: locator.part } : {}),
    };
    case "plain_text": return {
      startCharacter: locator.startCharacter,
      endCharacter: locator.endCharacter,
    };
  }
}

function containsForbiddenLogicalKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenLogicalKey);
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const forbidden = new Set(["artifactId", "generatedAt", "jobStatus", "signedUrl"]);
  return Object.keys(record).some((key) => forbidden.has(key))
    || Object.values(record).some(containsForbiddenLogicalKey);
}

function latestReviewInValidChain(reviews: readonly ImpactReview[]): ImpactReview | undefined {
  let currentStatus: ImpactStatus = "needs_review";
  let latest: ImpactReview | undefined;
  const remaining = [...reviews];

  while (remaining.length > 0) {
    const matching = remaining.filter(({ previousStatus }) => previousStatus === currentStatus);
    if (matching.length !== 1) return undefined;
    const next = matching[0]!;
    if (!transitionAllowed(currentStatus, next.disposition)) return undefined;
    remaining.splice(remaining.indexOf(next), 1);
    currentStatus = next.disposition;
    latest = next;
  }
  return latest;
}

function buildLogicalContent(
  command: BuildLogicalHandoffCommand,
  graph: ProjectGraphSnapshot,
  idFactory: ChangeHandoffIdFactory,
): ChangeHandoffApplicationResult<LogicalHandoffContent> {
  const selected = [...command.targetVersion.snapshot.nodes]
    .sort((left, right) => compareCodePoints(left.nodeId, right.nodeId));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const revisions = new Map(graph.revisions.map((revision) => [revision.id, revision]));
  const fragments = new Map(graph.sourceFragments.map((fragment) => [fragment.id, fragment]));
  const evidence = new Map(graph.evidenceLinks.map((link) => [link.id, link]));
  const projections = new Map<string, NonNullable<BuildLogicalHandoffCommand["policy"]["sourceReferenceProjections"]>[number]>();
  const referenceIds = new Set<string>();

  for (const projection of command.policy.sourceReferenceProjections ?? []) {
    if (
      projections.has(projection.evidenceLinkId)
      || referenceIds.has(projection.referenceId)
      || !nonEmpty(projection.evidenceLinkId)
      || !nonEmpty(projection.referenceId)
      || !evidence.has(projection.evidenceLinkId)
      || containsForbiddenLogicalKey(projection.locator)
    ) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_SOURCE_REFERENCE_PROJECTION",
        evidenceLinkId: projection.evidenceLinkId,
      });
    }
    try {
      canonicalJson(projection.locator);
    } catch {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "NON_CANONICAL_SOURCE_LOCATOR",
        evidenceLinkId: projection.evidenceLinkId,
      });
    }
    projections.set(projection.evidenceLinkId, projection);
    referenceIds.add(projection.referenceId);
  }

  const requiredEvidenceRoles = new Map<string, "direct" | "superseded_input">();
  const includedKinds = new Set(["requirement", "decision", "item"]);
  for (const selection of selected) {
    const node = nodes.get(selection.nodeId);
    if (!node || !includedKinds.has(node.kind)) continue;
    for (const link of graph.evidenceLinks) {
      if (link.nodeRevisionId === selection.revisionId) requiredEvidenceRoles.set(link.id, "direct");
    }
  }
  for (const change of command.impactRun.changes) {
    const node = nodes.get(change.nodeId);
    if (node?.kind !== "decision" || !change.fromRevisionId) continue;
    for (const link of graph.evidenceLinks) {
      if (link.nodeRevisionId === change.fromRevisionId && !requiredEvidenceRoles.has(link.id)) {
        requiredEvidenceRoles.set(link.id, "superseded_input");
      }
    }
  }

  const sourceReferences: LogicalHandoffSourceReference[] = [];
  const referenceIdByEvidenceId = new Map<string, string>();
  for (const [evidenceLinkId, evidenceRole] of [...requiredEvidenceRoles]
    .sort(([left], [right]) => compareCodePoints(left, right))) {
    const link = evidence.get(evidenceLinkId)!;
    const fragment = fragments.get(link.sourceFragmentId);
    if (!fragment) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "HANDOFF_EVIDENCE_FRAGMENT_MISSING",
        evidenceLinkId,
      });
    }
    const projection = projections.get(evidenceLinkId);
    const referenceId = projection?.referenceId ?? idFactory.createId({
      kind: "source_reference",
      projectId: command.changeContext.projectId,
      semanticIdentity: canonicalJson({ evidenceLinkId, evidenceRole }),
      hints: {
        evidenceLinkId,
        fragmentId: fragment.id,
        revisionId: link.nodeRevisionId,
      },
    });
    if (!nonEmpty(referenceId) || referenceIdByEvidenceId.has(evidenceLinkId)) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_SOURCE_REFERENCE_ID",
        evidenceLinkId,
      });
    }
    referenceIdByEvidenceId.set(evidenceLinkId, referenceId);
    sourceReferences.push({
      id: referenceId,
      sourceId: fragment.sourceId,
      fragmentId: fragment.id,
      locator: clone(projection?.locator ?? displayLocator(fragment.locator)),
      evidenceRole,
    });
  }
  const outputReferenceIds = sourceReferences.map(({ id }) => id);
  if (new Set(outputReferenceIds).size !== outputReferenceIds.length) {
    return applicationError("DOMAIN_CONTRACT_VIOLATION", {
      reasonCode: "DUPLICATE_SOURCE_REFERENCE_ID",
    });
  }
  sourceReferences.sort((left, right) => compareCodePoints(left.id, right.id));

  const referencesForRevision = (revisionId: string): string[] => graph.evidenceLinks
    .filter((link) => link.nodeRevisionId === revisionId && referenceIdByEvidenceId.has(link.id))
    .map((link) => referenceIdByEvidenceId.get(link.id)!)
    .sort(compareCodePoints);

  const areas: LogicalHandoffArea[] = [];
  const requirements: LogicalHandoffRequirement[] = [];
  const decisions: LogicalHandoffDecision[] = [];
  const items: LogicalHandoffItem[] = [];
  const deliverables: LogicalHandoffDeliverable[] = [];

  for (const selection of selected) {
    const node = nodes.get(selection.nodeId)!;
    const revision = revisions.get(selection.revisionId)!;
    switch (node.kind) {
      case "area":
        areas.push({
          nodeId: node.id,
          revisionId: revision.id,
          stableKey: node.stableKey,
          name: stringField(revision, "name", revision.title),
        });
        break;
      case "requirement":
        requirements.push({
          nodeId: node.id,
          revisionId: revision.id,
          claimStatus: effectiveClaimStatus(graph, revision),
          contentOrigin: revision.origin,
          summary: revision.title,
          sourceReferenceIds: referencesForRevision(revision.id),
        });
        break;
      case "decision": {
        const change = command.impactRun.changes.find(({ nodeId }) => nodeId === node.id);
        decisions.push({
          nodeId: node.id,
          revisionId: revision.id,
          claimStatus: effectiveClaimStatus(graph, revision),
          contentOrigin: revision.origin,
          material: stringField(revision, "material", ""),
          summary: revision.title,
          ...(change?.fromRevisionId ? {
            provenance: {
              changeSetId: command.impactRun.changeContext.changeSetId,
              previousRevisionId: change.fromRevisionId,
              previousSourceReferenceIds: referencesForRevision(change.fromRevisionId),
              reasonCode: command.impactRun.changeContext.reasonCode,
            },
          } : {}),
        });
        break;
      }
      case "item":
        items.push({
          nodeId: node.id,
          revisionId: revision.id,
          areaNodeId: stringField(revision, "areaId", ""),
          name: stringField(revision, "name", revision.title),
          sourceReferenceIds: referencesForRevision(revision.id),
        });
        break;
      case "deliverable":
        deliverables.push({
          nodeId: node.id,
          revisionId: revision.id,
          title: revision.title,
        });
        break;
    }
  }

  const latestReviewByImpactId = new Map<string, ImpactReview>();
  for (const impact of command.impactRun.impacts) {
    const chain = command.reviews.filter((review) => (
      review.impactRunId === command.impactRun.id && review.impactId === impact.id
    ));
    const latest = latestReviewInValidChain(chain);
    if (!latest) {
      return applicationError("INVALID_TRANSITION", {
        reasonCode: "IMPACT_REVIEW_INCOMPLETE_OR_INVALID",
        impactId: impact.id,
      });
    }
    latestReviewByImpactId.set(impact.id, latest);
  }

  const unresolved: LogicalHandoffImpact[] = [];
  const resolved: LogicalHandoffImpact[] = [];
  for (const impact of command.impactRun.impacts) {
    const review = latestReviewByImpactId.get(impact.id)!;
    const logicalImpact: LogicalHandoffImpact = {
      impactId: impact.id,
      status: review.disposition,
      changedNodeId: impact.changedNodeId,
      impactedNodeId: impact.impactedNodeId,
      nodePath: [...impact.nodePath],
      edgeIds: impact.edgePath.map(({ edgeId }) => edgeId),
    };
    (review.disposition === "accepted" ? unresolved : resolved).push(logicalImpact);
  }

  const logicalContent: LogicalHandoffContent = {
    schemaVersion: "project-intelligence-handoff/0.1",
    project: {
      projectId: command.changeContext.projectId,
      versionId: command.targetVersion.snapshot.versionId,
      versionNo: command.targetVersion.versionNo,
      baseVersionId: command.targetVersion.baseVersionId,
      label: command.targetVersion.label,
    },
    canonicalMetadata: clone(command.policy.canonicalMetadata),
    displayMetadata: clone(command.policy.displayMetadata),
    areas,
    requirements,
    decisions,
    items,
    deliverables,
    sourceReferences,
    impacts: { unresolved, resolved },
  };
  if (containsForbiddenLogicalKey(logicalContent)) {
    return applicationError("DOMAIN_CONTRACT_VIOLATION", {
      reasonCode: "VOLATILE_FIELD_IN_LOGICAL_CONTENT",
    });
  }
  return { ok: true, value: immutable(logicalContent) };
}

export function createDeterministicChangeHandoffIdFactory(): ChangeHandoffIdFactory {
  return {
    createId(input: ChangeHandoffIdInput): string {
      const digest = semanticSha256({
        kind: input.kind,
        projectId: input.projectId,
        semanticIdentity: input.semanticIdentity,
      }).slice("sha256:".length, "sha256:".length + 24);
      return `${ID_PREFIX[input.kind]}-${digest}`;
    },
  };
}

export function createEmptyChangeHandoffState(
  organizationId: string,
  projectId: string,
): ChangeHandoffApplicationState {
  if (!nonEmpty(organizationId) || !nonEmpty(projectId)) {
    throw new TypeError("Change-handoff state requires non-empty organization and project IDs.");
  }
  return immutable({
    organizationId,
    projectId,
    stateRevision: 0,
    impactRuns: [],
    impactReviews: [],
    handoffs: [],
    idempotencyRecords: [],
  });
}

export interface ChangeHandoffApplicationServiceOptions {
  readonly idFactory?: ChangeHandoffIdFactory;
}

export class ChangeHandoffApplicationService {
  readonly #idFactory: ChangeHandoffIdFactory;

  constructor(options: ChangeHandoffApplicationServiceOptions = {}) {
    this.#idFactory = options.idFactory ?? createDeterministicChangeHandoffIdFactory();
  }

  calculateImpactRun(
    command: CalculateImpactRunCommand,
  ): ChangeHandoffApplicationResult<ChangeHandoffMutationSuccess<ImpactRun>> {
    const common = validateCommon(
      command.execution,
      command.state,
      command.changeContext.projectId,
      "calculate_change_impact",
      command.idempotencyKey,
    );
    if (!common.ok) return common;

    const { changeContext, fromVersion, toVersion, targetGraph } = command;
    if (
      fromVersion.projectId !== changeContext.projectId
      || toVersion.projectId !== changeContext.projectId
      || targetGraph.projectId !== changeContext.projectId
    ) {
      return applicationError("PROJECT_SCOPE_VIOLATION", { reasonCode: "VERSION_PROJECT_MISMATCH" });
    }
    if (
      fromVersion.versionId !== changeContext.fromVersionId
      || toVersion.versionId !== changeContext.toVersionId
      || targetGraph.versionId !== changeContext.toVersionId
    ) {
      return applicationError("VERSION_STALE", { reasonCode: "EXACT_VERSION_MISMATCH" });
    }
    if (
      !nonEmpty(changeContext.changeSetId)
      || !nonEmpty(changeContext.reasonCode)
      || changeContext.fromVersionId === changeContext.toVersionId
    ) {
      return applicationError("INVALID_TRANSITION", { reasonCode: "INVALID_CHANGE_CONTEXT" });
    }

    const normalizedFrom = normalizeVersion(fromVersion);
    const normalizedTo = normalizeVersion(toVersion);
    const normalizedGraph = normalizeGraph(targetGraph);
    const normalizedChangeContext = normalizeChangeContext(changeContext);
    const exactFailure = exactTargetFailure(normalizedTo, normalizedGraph);
    if (exactFailure) return exactFailure;

    let targetGraphDigest: `sha256:${string}`;
    let requestDigest: `sha256:${string}`;
    try {
      targetGraphDigest = semanticSha256(normalizedGraph);
      requestDigest = semanticSha256({
        operation: "calculate_impact",
        actor: {
          actorId: command.execution.actorId,
          actorType: command.execution.actorType,
          organizationId: command.execution.organizationId,
          projectId: command.execution.projectId,
        },
        expectedStateRevision: command.expectedStateRevision,
        changeContext: normalizedChangeContext,
        fromVersion: normalizedFrom,
        toVersion: normalizedTo,
        targetGraph: normalizedGraph,
      });
    } catch {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "NON_CANONICAL_REQUEST",
      });
    }

    const existing = idempotencyRecord(
      command.state,
      command.execution,
      "calculate_impact",
      command.idempotencyKey,
    );
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        return applicationError("IDEMPOTENCY_CONFLICT", {
          operation: "calculate_impact",
          idempotencyKey: command.idempotencyKey,
        });
      }
      return {
        ok: true,
        value: {
          result: existing.logicalResult as ImpactRun,
          nextState: command.state,
          idempotentReplay: true,
          auditIntents: [],
          requestDigest,
        },
      };
    }
    if (command.state.stateRevision !== command.expectedStateRevision) {
      return applicationError("STATE_STALE", {
        expectedStateRevision: command.expectedStateRevision,
        currentStateRevision: command.state.stateRevision,
      }, true);
    }

    try {
      const changes = diffProjectVersions(normalizedFrom, normalizedTo);
      const changedNodeIds = deriveChangedNodeIds(changes);
      if (changedNodeIds.length === 0) {
        return applicationError("INVALID_TRANSITION", {
          reasonCode: "NO_IMPACT_RELEVANT_CHANGE",
        });
      }
      const pureImpacts = calculateChangeImpact(normalizedGraph, changedNodeIds);
      const resultDigest = semanticSha256({
        algorithm: IMPACT_ALGORITHM,
        changeContext: normalizedChangeContext,
        targetGraphDigest,
        changes,
        changedNodeIds,
        impacts: pureImpacts,
      });
      const runId = this.#idFactory.createId({
        kind: "impact_run",
        projectId: changeContext.projectId,
        semanticIdentity: canonicalJson({
          changeSetId: changeContext.changeSetId,
          resultDigest,
          idempotencyKey: command.idempotencyKey,
        }),
        hints: {
          changeSetId: changeContext.changeSetId,
          fromVersionId: changeContext.fromVersionId,
          toVersionId: changeContext.toVersionId,
          idempotencyKey: command.idempotencyKey,
        },
      });
      if (!nonEmpty(runId)) {
        return applicationError("DOMAIN_CONTRACT_VIOLATION", {
          reasonCode: "EMPTY_SERVER_GENERATED_ID",
          idKind: "impact_run",
        });
      }

      const impacts: PersistedImpact[] = pureImpacts.map((impact) => ({
        id: this.#idFactory.createId({
          kind: "impact",
          projectId: changeContext.projectId,
          semanticIdentity: canonicalJson({ runId, impact }),
          hints: {
            runId,
            changedNodeId: impact.changedNodeId,
            impactedNodeId: impact.impactedNodeId,
          },
        }),
        impactRunId: runId,
        projectId: changeContext.projectId,
        changeSetId: changeContext.changeSetId,
        fromVersionId: changeContext.fromVersionId,
        toVersionId: changeContext.toVersionId,
        changedNodeId: impact.changedNodeId,
        impactedNodeId: impact.impactedNodeId,
        distance: impact.distance,
        nodePath: [...impact.nodePath],
        edgePath: impact.edgePath.map((step) => ({ ...step })),
        initialStatus: "needs_review",
      }));
      const impactIds = impacts.map(({ id }) => id);
      if (
        impactIds.some((id) => !nonEmpty(id))
        || new Set(impactIds).size !== impactIds.length
      ) {
        return applicationError("DOMAIN_CONTRACT_VIOLATION", {
          reasonCode: "INVALID_SERVER_GENERATED_IMPACT_IDS",
        });
      }

      const run = immutable<ImpactRun>({
        id: runId,
        projectId: changeContext.projectId,
        changeSetId: changeContext.changeSetId,
        fromVersionId: changeContext.fromVersionId,
        toVersionId: changeContext.toVersionId,
        changeContext: normalizedChangeContext,
        targetGraphVersionId: normalizedGraph.versionId,
        targetGraphDigest,
        algorithm: IMPACT_ALGORITHM,
        changes,
        changedNodeIds,
        impacts,
        resultDigest,
        createdAt: command.execution.serverTime,
        createdBy: {
          actorId: command.execution.actorId,
          actorType: command.execution.actorType,
        },
      });
      const auditIntent: ChangeHandoffAuditIntent = immutable({
        eventName: "impact_run_created",
        projectId: changeContext.projectId,
        organizationId: command.execution.organizationId,
        actorId: command.execution.actorId,
        actorType: command.execution.actorType,
        occurredAt: command.execution.serverTime,
        requestId: command.execution.requestId,
        controlledMetadata: {
          impactRunId: run.id,
          changeSetId: run.changeSetId,
          fromVersionId: run.fromVersionId,
          toVersionId: run.toVersionId,
          algorithmVersion: run.algorithm.version,
          targetGraphDigest: run.targetGraphDigest,
          resultDigest: run.resultDigest,
          impactCount: run.impacts.length,
        },
      });
      const record: ChangeHandoffIdempotencyRecord = {
        organizationId: command.execution.organizationId,
        projectId: changeContext.projectId,
        operation: "calculate_impact",
        key: command.idempotencyKey,
        requestDigest,
        logicalResult: run,
      };
      const nextState = immutable<ChangeHandoffApplicationState>({
        ...command.state,
        stateRevision: command.state.stateRevision + 1,
        impactRuns: [...command.state.impactRuns, run],
        idempotencyRecords: [...command.state.idempotencyRecords, record],
      });

      return {
        ok: true,
        value: {
          result: run,
          nextState,
          idempotentReplay: false,
          auditIntents: [auditIntent],
          requestDigest,
        },
      };
    } catch (error) {
      return domainFailure(error);
    }
  }

  reviewImpact(
    command: ReviewImpactCommand,
  ): ChangeHandoffApplicationResult<ChangeHandoffMutationSuccess<ImpactReview>> {
    const common = validateCommon(
      command.execution,
      command.state,
      command.impactRun.projectId,
      "review_change_impact",
      command.idempotencyKey,
    );
    if (!common.ok) return common;
    if (command.execution.actorType !== "human") {
      return applicationError("ACCESS_DENIED", { reasonCode: "HUMAN_ACTOR_REQUIRED" });
    }
    if (
      command.impactRun.projectId !== command.execution.projectId
      || command.impactRun.impacts.some(({ projectId }) => projectId !== command.execution.projectId)
    ) {
      return applicationError("PROJECT_SCOPE_VIOLATION", { reasonCode: "IMPACT_PROJECT_MISMATCH" });
    }
    if (!nonEmpty(command.reasonCode)) {
      return applicationError("INVALID_TRANSITION", { reasonCode: "IMPACT_REASON_REQUIRED" });
    }
    if (!isImpactDisposition(command.disposition)) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_IMPACT_DISPOSITION",
      });
    }
    if (!isImpactReasonCode(command.reasonCode)) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_IMPACT_REASON_CODE",
      });
    }
    if (!isImpactStatus(command.expectedImpactStatus)) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_IMPACT_STATUS",
      });
    }
    if (!isApplicationActorType(command.impactRun.createdBy.actorType)) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_IMPACT_RUN_ACTOR_TYPE",
      });
    }
    const storedReviewFailure = impactReviewRuntimeFailure(command.state.impactReviews);
    if (storedReviewFailure) return storedReviewFailure;

    let requestDigest: `sha256:${string}`;
    try {
      requestDigest = semanticSha256({
        operation: "review_impact",
        actor: {
          actorId: command.execution.actorId,
          actorType: command.execution.actorType,
          organizationId: command.execution.organizationId,
          projectId: command.execution.projectId,
        },
        expectedStateRevision: command.expectedStateRevision,
        impactRun: command.impactRun,
        impactId: command.impactId,
        expectedImpactStatus: command.expectedImpactStatus,
        disposition: command.disposition,
        reasonCode: command.reasonCode,
      });
    } catch {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "NON_CANONICAL_REVIEW_REQUEST",
      });
    }
    const existing = idempotencyRecord(
      command.state,
      command.execution,
      "review_impact",
      command.idempotencyKey,
    );
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        return applicationError("IDEMPOTENCY_CONFLICT", {
          operation: "review_impact",
          idempotencyKey: command.idempotencyKey,
        });
      }
      return {
        ok: true,
        value: {
          result: existing.logicalResult as ImpactReview,
          nextState: command.state,
          idempotentReplay: true,
          auditIntents: [],
          requestDigest,
        },
      };
    }
    if (command.state.stateRevision !== command.expectedStateRevision) {
      return applicationError("STATE_STALE", {
        expectedStateRevision: command.expectedStateRevision,
        currentStateRevision: command.state.stateRevision,
      }, true);
    }

    const storedRun = command.state.impactRuns.find(({ id }) => id === command.impactRun.id);
    if (!storedRun || canonicalJson(storedRun) !== canonicalJson(command.impactRun)) {
      return applicationError("IMPACT_STALE", {
        reasonCode: "EXACT_IMPACT_RUN_MISMATCH",
        impactRunId: command.impactRun.id,
      });
    }
    const impact = storedRun.impacts.find(({ id }) => id === command.impactId);
    if (!impact) {
      return applicationError("IMPACT_STALE", {
        reasonCode: "IMPACT_NOT_IN_RUN",
        impactId: command.impactId,
      });
    }
    const currentStatus = latestImpactStatus(
      command.state.impactReviews,
      storedRun.id,
      impact.id,
    );
    if (currentStatus !== command.expectedImpactStatus) {
      return applicationError("IMPACT_STALE", {
        impactId: impact.id,
        expectedImpactStatus: command.expectedImpactStatus,
        currentImpactStatus: currentStatus,
      });
    }
    if (!transitionAllowed(currentStatus, command.disposition)) {
      return applicationError("IMPACT_STALE", {
        reasonCode: "IMPACT_STATUS_TERMINAL_OR_DUPLICATE",
        impactId: impact.id,
        currentImpactStatus: currentStatus,
        requestedDisposition: command.disposition,
      });
    }

    const reviewId = this.#idFactory.createId({
      kind: "impact_review",
      projectId: storedRun.projectId,
      semanticIdentity: canonicalJson({
        impactRunId: storedRun.id,
        impactId: impact.id,
        previousStatus: currentStatus,
        disposition: command.disposition,
        reasonCode: command.reasonCode,
        idempotencyKey: command.idempotencyKey,
      }),
      hints: {
        impactRunId: storedRun.id,
        impactId: impact.id,
        disposition: command.disposition,
        idempotencyKey: command.idempotencyKey,
      },
    });
    if (
      !nonEmpty(reviewId)
      || command.state.impactReviews.some(({ id }) => id === reviewId)
    ) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_SERVER_GENERATED_REVIEW_ID",
      });
    }

    const review = immutable<ImpactReview>({
      id: reviewId,
      projectId: storedRun.projectId,
      impactRunId: storedRun.id,
      impactId: impact.id,
      previousStatus: currentStatus,
      disposition: command.disposition,
      reasonCode: command.reasonCode,
      actor: {
        actorId: command.execution.actorId,
        actorType: "human",
      },
      reviewedAt: command.execution.serverTime,
    });
    const auditIntent: ChangeHandoffAuditIntent = immutable({
      eventName: "impact_reviewed",
      projectId: storedRun.projectId,
      organizationId: command.execution.organizationId,
      actorId: command.execution.actorId,
      actorType: "human",
      occurredAt: command.execution.serverTime,
      requestId: command.execution.requestId,
      controlledMetadata: {
        impactRunId: storedRun.id,
        impactId: impact.id,
        previousStatus: currentStatus,
        disposition: command.disposition,
        reasonCode: command.reasonCode,
      },
    });
    const record: ChangeHandoffIdempotencyRecord = {
      organizationId: command.execution.organizationId,
      projectId: storedRun.projectId,
      operation: "review_impact",
      key: command.idempotencyKey,
      requestDigest,
      logicalResult: review,
    };
    const nextState = immutable<ChangeHandoffApplicationState>({
      ...command.state,
      stateRevision: command.state.stateRevision + 1,
      impactReviews: [...command.state.impactReviews, review],
      idempotencyRecords: [...command.state.idempotencyRecords, record],
    });

    return {
      ok: true,
      value: {
        result: review,
        nextState,
        idempotentReplay: false,
        auditIntents: [auditIntent],
        requestDigest,
      },
    };
  }

  buildLogicalHandoff(
    command: BuildLogicalHandoffCommand,
  ): ChangeHandoffApplicationResult<ChangeHandoffMutationSuccess<LogicalHandoff>> {
    const common = validateCommon(
      command.execution,
      command.state,
      command.changeContext.projectId,
      "build_logical_handoff",
      command.idempotencyKey,
    );
    if (!common.ok) return common;

    const version = command.targetVersion.snapshot;
    const normalizedChangeContext = normalizeChangeContext(command.changeContext);
    if (
      version.projectId !== command.changeContext.projectId
      || command.targetGraph.projectId !== command.changeContext.projectId
      || command.impactRun.projectId !== command.changeContext.projectId
      || command.reviews.some(({ projectId }) => projectId !== command.changeContext.projectId)
    ) {
      return applicationError("PROJECT_SCOPE_VIOLATION", {
        reasonCode: "HANDOFF_PROJECT_MISMATCH",
      });
    }
    if (
      command.targetVersion.status !== "published"
      || version.versionId !== command.changeContext.toVersionId
      || command.targetGraph.versionId !== command.changeContext.toVersionId
      || command.targetVersion.baseVersionId !== command.changeContext.fromVersionId
      || command.impactRun.changeSetId !== command.changeContext.changeSetId
      || command.impactRun.fromVersionId !== command.changeContext.fromVersionId
      || command.impactRun.toVersionId !== command.changeContext.toVersionId
      || command.impactRun.targetGraphVersionId !== command.changeContext.toVersionId
    ) {
      return applicationError("INVALID_TRANSITION", {
        reasonCode: "HANDOFF_VERSION_OR_RUN_MISMATCH",
      });
    }
    if (!canonicalEqual(command.impactRun.changeContext, normalizedChangeContext)) {
      return applicationError("INVALID_TRANSITION", {
        reasonCode: "HANDOFF_CHANGE_CONTEXT_MISMATCH",
      });
    }
    if (!isApplicationActorType(command.impactRun.createdBy.actorType)) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_IMPACT_RUN_ACTOR_TYPE",
      });
    }
    const storedReviewFailure = impactReviewRuntimeFailure(command.state.impactReviews);
    if (storedReviewFailure) return storedReviewFailure;
    const suppliedReviewFailure = impactReviewRuntimeFailure(command.reviews);
    if (suppliedReviewFailure) return suppliedReviewFailure;

    const normalizedVersion = normalizeVersion(version);
    const normalizedGraph = normalizeGraph(command.targetGraph);
    const graphIssue = validateProjectGraphSnapshot(normalizedGraph)[0];
    if (graphIssue) {
      return applicationError(
        graphIssue.code === "project_mismatch" || graphIssue.code === "source_project_mismatch"
          ? "PROJECT_SCOPE_VIOLATION"
          : "DOMAIN_CONTRACT_VIOLATION",
        {
          domainCode: graphIssue.code,
          ...(graphIssue.entityId ? { entityId: graphIssue.entityId } : {}),
          ...(graphIssue.path ? { path: graphIssue.path } : {}),
        },
      );
    }
    const exactFailure = exactTargetFailure(normalizedVersion, normalizedGraph);
    if (exactFailure) {
      return applicationError("INVALID_TRANSITION", {
        reasonCode: "HANDOFF_TARGET_SNAPSHOT_MISMATCH",
      });
    }
    if (semanticSha256(normalizedGraph) !== command.impactRun.targetGraphDigest) {
      return applicationError("INVALID_TRANSITION", {
        reasonCode: "HANDOFF_TARGET_GRAPH_DIGEST_MISMATCH",
      });
    }
    if (
      !Number.isSafeInteger(command.targetVersion.versionNo)
      || command.targetVersion.versionNo < 1
      || !nonEmpty(command.targetVersion.label)
    ) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_PUBLISHED_VERSION_DESCRIPTOR",
      });
    }

    let requestDigest: `sha256:${string}`;
    try {
      requestDigest = semanticSha256({
        operation: "build_handoff",
        actor: {
          actorId: command.execution.actorId,
          actorType: command.execution.actorType,
          organizationId: command.execution.organizationId,
          projectId: command.execution.projectId,
        },
        expectedStateRevision: command.expectedStateRevision,
        changeContext: normalizedChangeContext,
        targetVersion: {
          status: command.targetVersion.status,
          snapshot: normalizedVersion,
          versionNo: command.targetVersion.versionNo,
          baseVersionId: command.targetVersion.baseVersionId,
          label: command.targetVersion.label,
        },
        targetGraph: normalizedGraph,
        impactRun: command.impactRun,
        reviews: sortedById(command.reviews),
        policy: normalizePolicy(command),
      });
    } catch {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "NON_CANONICAL_HANDOFF_REQUEST",
      });
    }

    const existing = idempotencyRecord(
      command.state,
      command.execution,
      "build_handoff",
      command.idempotencyKey,
    );
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        return applicationError("IDEMPOTENCY_CONFLICT", {
          operation: "build_handoff",
          idempotencyKey: command.idempotencyKey,
        });
      }
      return {
        ok: true,
        value: {
          result: existing.logicalResult as LogicalHandoff,
          nextState: command.state,
          idempotentReplay: true,
          auditIntents: [],
          requestDigest,
        },
      };
    }
    if (command.state.stateRevision !== command.expectedStateRevision) {
      return applicationError("STATE_STALE", {
        expectedStateRevision: command.expectedStateRevision,
        currentStateRevision: command.state.stateRevision,
      }, true);
    }

    const storedRun = command.state.impactRuns.find(({ id }) => id === command.impactRun.id);
    if (!storedRun || canonicalJson(storedRun) !== canonicalJson(command.impactRun)) {
      return applicationError("IMPACT_STALE", {
        reasonCode: "EXACT_IMPACT_RUN_MISMATCH",
        impactRunId: command.impactRun.id,
      });
    }
    const storedReviews = sortedById(command.state.impactReviews.filter(
      ({ impactRunId }) => impactRunId === storedRun.id,
    ));
    const suppliedReviews = sortedById(command.reviews);
    if (canonicalJson(storedReviews) !== canonicalJson(suppliedReviews)) {
      return applicationError("INVALID_TRANSITION", {
        reasonCode: "HANDOFF_REVIEW_SNAPSHOT_MISMATCH",
      });
    }
    if (suppliedReviews.some((review) => (
      review.impactRunId !== storedRun.id
      || !storedRun.impacts.some(({ id }) => id === review.impactId)
      || review.actor.actorType !== "human"
    ))) {
      return applicationError("INVALID_TRANSITION", {
        reasonCode: "HANDOFF_REVIEW_SCOPE_MISMATCH",
      });
    }

    const contentResult = buildLogicalContent(
      {
        ...command,
        changeContext: storedRun.changeContext,
        impactRun: storedRun,
        reviews: suppliedReviews,
      },
      normalizedGraph,
      this.#idFactory,
    );
    if (!contentResult.ok) return contentResult;
    const semanticContentHash = semanticSha256(contentResult.value);
    const artifactId = this.#idFactory.createId({
      kind: "handoff_artifact",
      projectId: command.changeContext.projectId,
      semanticIdentity: canonicalJson({
        versionId: version.versionId,
        impactRunId: storedRun.id,
        semanticContentHash,
        idempotencyKey: command.idempotencyKey,
      }),
      hints: {
        versionId: version.versionId,
        impactRunId: storedRun.id,
        idempotencyKey: command.idempotencyKey,
      },
    });
    if (!nonEmpty(artifactId)) {
      return applicationError("DOMAIN_CONTRACT_VIOLATION", {
        reasonCode: "INVALID_SERVER_GENERATED_ARTIFACT_ID",
      });
    }

    const handoff = immutable<LogicalHandoff>({
      contractVersion: "project-intelligence-vertical-slice/0.1",
      artifact: {
        artifactId,
        format: "logical_json",
        jobStatus: "ready",
        generatedAt: command.execution.serverTime,
        semanticContentHash,
      },
      hashContract: {
        algorithm: "sha256",
        encoding: "utf-8",
        canonicalization: "recursive_sorted_object_keys_arrays_preserve_contract_order",
        hashedField: "logicalContent",
        excludedVolatileFields: ["artifactId", "generatedAt", "jobStatus"],
      },
      logicalContent: contentResult.value,
    });
    const auditIntent: ChangeHandoffAuditIntent = immutable({
      eventName: "logical_handoff_built",
      projectId: command.changeContext.projectId,
      organizationId: command.execution.organizationId,
      actorId: command.execution.actorId,
      actorType: command.execution.actorType,
      occurredAt: command.execution.serverTime,
      requestId: command.execution.requestId,
      controlledMetadata: {
        artifactId,
        versionId: version.versionId,
        impactRunId: storedRun.id,
        semanticContentHash,
        unresolvedImpactCount: handoff.logicalContent.impacts.unresolved.length,
        resolvedImpactCount: handoff.logicalContent.impacts.resolved.length,
      },
    });
    const record: ChangeHandoffIdempotencyRecord = {
      organizationId: command.execution.organizationId,
      projectId: command.changeContext.projectId,
      operation: "build_handoff",
      key: command.idempotencyKey,
      requestDigest,
      logicalResult: handoff,
    };
    const nextState = immutable<ChangeHandoffApplicationState>({
      ...command.state,
      stateRevision: command.state.stateRevision + 1,
      handoffs: [...command.state.handoffs, handoff],
      idempotencyRecords: [...command.state.idempotencyRecords, record],
    });

    return {
      ok: true,
      value: {
        result: handoff,
        nextState,
        idempotentReplay: false,
        auditIntents: [auditIntent],
        requestDigest,
      },
    };
  }
}
