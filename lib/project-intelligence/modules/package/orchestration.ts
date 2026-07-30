import { compareCodePoints } from "../../ordering";
import { semanticSha256 } from "../../application/change-handoff/canonical";
import type { HumanActorRef } from "../decisions";
import {
  IMPORT_STAGES,
  type BaselineCandidateInput,
  type BaselineRevisionDiff,
  type BaselineSemanticContent,
  type ExactRevisionRefs,
  type ImportPlan,
  type ImportPlanEntry,
  type ImportStageState,
  type KoraInventoryRecord,
  type NoChangeTerminal,
  type ProductionPackageVersion,
  type ProjectBaseline,
  type ProjectBaselineCandidate,
  type ProjectPackage,
  type ReleaseArtifact,
  type ReleaseArtifactBuildOutcome,
  type ReleaseArtifactBuildRequest,
  type ReleaseDescriptor,
} from "./contracts";

export class PackageContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PackageContractError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const PREFIXED_HASH = /^sha256:[a-f0-9]{64}$/;

function immutable<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(cloned);
  return cloned;
}

function sortedUnique(values: readonly string[], code: string): string[] {
  for (const value of values) {
    if (!value || value !== value.trim()) {
      throw new PackageContractError(code, `${code}: identifiers must be non-empty and trimmed.`);
    }
  }
  const unique = [...new Set(values)].sort(compareCodePoints);
  if (unique.length !== values.length) {
    throw new PackageContractError(code, `${code}: identifiers must be unique.`);
  }
  return unique;
}

function validateActor(actor: HumanActorRef): void {
  if (actor.actorType !== "human" || !actor.actorId.trim()) {
    throw new PackageContractError("HUMAN_ACTOR_REQUIRED", "Publication requires a human actor.");
  }
}

function validateTime(value: string): void {
  if (!Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new PackageContractError("SERVER_TIME_INVALID", "Server time must be an offset timestamp.");
  }
}

function stage(
  name: (typeof IMPORT_STAGES)[number],
  status: ImportStageState["status"],
  blockReason: string | null = null,
): ImportStageState {
  return { stage: name, status, blockReason };
}

function logicalSourceId(checksum: string): string {
  return `source-sha256-${checksum.slice(0, 24)}`;
}

export function planSourceImport(records: readonly KoraInventoryRecord[]): ImportPlan {
  if (records.length === 0) {
    throw new PackageContractError("INVENTORY_REQUIRED", "At least one physical record is required.");
  }
  const physicalIds = new Set<string>();
  const projectIds = new Set<string>();
  const byChecksum = new Map<string, KoraInventoryRecord[]>();

  for (const record of records) {
    if (physicalIds.has(record.physicalRecordId)) {
      throw new PackageContractError("DUPLICATE_PHYSICAL_RECORD", record.physicalRecordId);
    }
    physicalIds.add(record.physicalRecordId);
    projectIds.add(record.hierarchy.projectId);
    if (record.sizeBytes !== null && (!Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 0)) {
      throw new PackageContractError("SOURCE_SIZE_INVALID", record.physicalRecordId);
    }
    if (record.availability === "placeholder") {
      if (record.checksum !== null || record.sourceRevisionId !== null) {
        throw new PackageContractError(
          "PLACEHOLDER_MUST_NOT_CLAIM_MATERIALIZATION",
          record.physicalRecordId,
        );
      }
      continue;
    }
    if (!record.checksum || !HASH.test(record.checksum) || !record.sourceRevisionId) {
      throw new PackageContractError("MATERIALIZED_SOURCE_IDENTITY_INVALID", record.physicalRecordId);
    }
    const group = byChecksum.get(record.checksum) ?? [];
    group.push(record);
    byChecksum.set(record.checksum, group);
  }
  if (projectIds.size !== 1) {
    throw new PackageContractError("PROJECT_SCOPE_VIOLATION", "One import plan cannot span projects.");
  }

  const exactHashGroups = [...byChecksum.entries()]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([checksum, group]) => {
      const sourceRevisionId = group[0]!.sourceRevisionId;
      if (
        !sourceRevisionId
        || group.some((record) => record.sourceRevisionId !== sourceRevisionId)
      ) {
        throw new PackageContractError(
          "SOURCE_REVISION_DEDUPE_VIOLATION",
          `Exact duplicate bytes must share one source revision: ${checksum}`,
        );
      }
      return {
        checksum,
        logicalSourceId: logicalSourceId(checksum),
        sourceRevisionId,
        physicalRecordIds: group.map((record) => record.physicalRecordId).sort(compareCodePoints),
        semanticConflict: group.some((record) => record.semanticConflict),
      };
    });
  const groupByChecksum = new Map(exactHashGroups.map((group) => [group.checksum, group]));

  const entries: ImportPlanEntry[] = [...records]
    .sort((left, right) => compareCodePoints(left.physicalRecordId, right.physicalRecordId))
    .map((record) => {
      if (record.availability === "placeholder") {
        return {
          physicalRecordId: record.physicalRecordId,
          logicalSourceId: null,
          sourceRevisionId: null,
          checksum: null,
          evidenceEligible: false,
          quarantineReason: null,
          stages: [
            stage("inventory_registration", "completed"),
            stage("bytes_materialization", "blocked", "bytes_not_materialized"),
            stage("checksum_source_registration", "blocked", "checksum_unavailable"),
            stage("fragment_evidence_extraction", "blocked", "source_revision_unavailable"),
            stage("human_review", "blocked", "evidence_unavailable"),
            stage("baseline_candidate", "blocked", "evidence_unavailable"),
            stage("baseline_publication", "blocked", "human_baseline_required"),
          ],
        };
      }
      const hashGroup = groupByChecksum.get(record.checksum!)!;
      const conversionBlock = record.mediaKind === "cad_binary"
        ? "cad_preview_required"
        : record.mediaKind === "archive"
          ? "archive_expansion_required"
          : record.mediaKind === "document"
            ? "text_extraction_required"
            : null;
      const quarantineReason = hashGroup.semanticConflict
        ? "semantic_conflict"
        : conversionBlock;
      return {
        physicalRecordId: record.physicalRecordId,
        logicalSourceId: hashGroup.logicalSourceId,
        sourceRevisionId: hashGroup.sourceRevisionId,
        checksum: record.checksum,
        evidenceEligible: quarantineReason === null,
        quarantineReason,
        stages: [
          stage("inventory_registration", "completed"),
          stage("bytes_materialization", "completed"),
          stage("checksum_source_registration", "completed"),
          stage(
            "fragment_evidence_extraction",
            quarantineReason ? "blocked" : "pending",
            quarantineReason,
          ),
          stage("human_review", "pending"),
          stage("baseline_candidate", "pending"),
          stage("baseline_publication", "blocked", "human_baseline_required"),
        ],
      };
    });

  return immutable({
    projectId: [...projectIds][0]!,
    entries,
    exactHashGroups,
    summary: {
      physicalRecords: records.length,
      materializedRecords: records.filter((record) => record.availability === "materialized").length,
      placeholders: records.filter((record) => record.availability === "placeholder").length,
      uniqueMaterializedBlobs: exactHashGroups.length,
      duplicateGroups: exactHashGroups.filter((group) => group.physicalRecordIds.length > 1).length,
      semanticConflictGroups: exactHashGroups.filter((group) => group.semanticConflict).length,
    },
  });
}

function validatePackageHierarchy(
  packages: readonly ProjectPackage[],
  organizationId: string,
  projectId: string,
): string[] {
  const blockers: string[] = [];
  const byId = new Map(packages.map((item) => [item.id, item]));
  if (byId.size !== packages.length) blockers.push("duplicate_package_id");
  const roots = packages.filter((item) => item.parentPackageId === null);
  if (roots.length !== 1 || roots[0]?.kind !== "project_root") {
    blockers.push("project_package_root_required");
  }
  const stableKeys = new Set(packages.map((item) => item.stableKey));
  if (stableKeys.size !== packages.length) blockers.push("duplicate_package_stable_key");
  for (const item of packages) {
    if (item.organizationId !== organizationId) {
      blockers.push(`package_organization_mismatch:${item.id}`);
    }
    if (item.projectId !== projectId) blockers.push(`package_project_mismatch:${item.id}`);
    if (item.parentPackageId && !byId.has(item.parentPackageId)) {
      blockers.push(`package_parent_missing:${item.id}`);
    }
    if (item.kind === "project_root" && item.parentPackageId !== null) {
      blockers.push(`project_root_parent_forbidden:${item.id}`);
    }
    if (item.kind === "work_package" && item.parentPackageId === null) {
      blockers.push(`work_package_parent_required:${item.id}`);
    }
    const visited = new Set<string>([item.id]);
    let parentId = item.parentPackageId;
    while (parentId) {
      if (visited.has(parentId)) {
        blockers.push(`package_cycle:${item.id}`);
        break;
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentPackageId ?? null;
    }
  }
  return blockers;
}

function baselineSemanticContent(input: BaselineCandidateInput): BaselineSemanticContent {
  const packages = [...input.packages]
    .sort((left, right) => compareCodePoints(left.id, right.id))
    .map((item) => ({
      id: item.id,
      parentPackageId: item.parentPackageId,
      kind: item.kind,
      stableKey: item.stableKey,
    }));
  return {
    schemaVersion: "project-ceo-baseline/0.1",
    organizationId: input.organizationId,
    projectId: input.projectId,
    previousBaselineId: input.previousBaselineId,
    packages,
    packageIds: packages.map((item) => item.id),
    sourceRevisionIds: sortedUnique(input.includedSourceRevisionIds, "SOURCE_REVISIONS_INVALID"),
    requirementRevisionIds: sortedUnique(input.requirementRevisionIds, "REQUIREMENT_REVISIONS_INVALID"),
    assumptionRevisionIds: sortedUnique(input.assumptionRevisionIds, "ASSUMPTION_REVISIONS_INVALID"),
    decisionRevisionIds: sortedUnique(input.decisionRevisionIds, "DECISION_REVISIONS_INVALID"),
    selectionRevisionIds: sortedUnique(input.selectionRevisionIds, "SELECTION_REVISIONS_INVALID"),
    approvalPackageIds: sortedUnique(
      input.approvalPackages.map((approvalPackage) => approvalPackage.id),
      "APPROVAL_PACKAGES_INVALID",
    ),
  };
}

export function buildBaselineCandidate(input: BaselineCandidateInput): ProjectBaselineCandidate {
  const blockers = validatePackageHierarchy(
    input.packages,
    input.organizationId,
    input.projectId,
  );
  if (input.importPlan.projectId !== input.projectId) blockers.push("import_plan_project_mismatch");
  const eligibleRevisions = new Set(
    input.importPlan.entries
      .filter((entry) => entry.evidenceEligible && entry.sourceRevisionId)
      .map((entry) => entry.sourceRevisionId!),
  );
  for (const sourceRevisionId of input.includedSourceRevisionIds) {
    if (!eligibleRevisions.has(sourceRevisionId)) {
      blockers.push(`source_revision_not_eligible:${sourceRevisionId}`);
    }
  }
  if (input.includedSourceRevisionIds.length === 0) blockers.push("source_revision_required");
  if (input.decisionRevisionIds.length === 0) blockers.push("decision_revision_required");
  if (input.approvalPackages.length === 0) blockers.push("approval_package_required");
  const approvedRevisionKeys = new Set<string>();
  const packageIds = new Set(input.packages.map((item) => item.id));
  for (const approvalPackage of input.approvalPackages) {
    if (
      approvalPackage.projectId !== input.projectId
      || !packageIds.has(approvalPackage.packageId)
    ) {
      blockers.push(`approval_package_scope_mismatch:${approvalPackage.id}`);
      continue;
    }
    if (
      approvalPackage.status !== "approved"
      || approvalPackage.review?.decision !== "approved"
      || approvalPackage.review.actor.actorType !== "human"
      || !approvalPackage.review.reviewedAt
      || !approvalPackage.review.reason.trim()
    ) {
      blockers.push(`approval_package_not_approved:${approvalPackage.id}`);
      continue;
    }
    approvalPackage.items.forEach((item) => {
      approvedRevisionKeys.add(`${item.targetKind}:${item.revisionId}`);
    });
  }
  const requiredApprovals = [
    ...input.requirementRevisionIds.map((revisionId) => ({
      targetKind: "requirement_revision" as const,
      revisionId,
    })),
    ...input.assumptionRevisionIds.map((revisionId) => ({
      targetKind: "assumption_revision" as const,
      revisionId,
    })),
    ...input.decisionRevisionIds.map((revisionId) => ({
      targetKind: "decision_revision" as const,
      revisionId,
    })),
    ...input.selectionRevisionIds.map((revisionId) => ({
      targetKind: "selection_revision" as const,
      revisionId,
    })),
  ];
  for (const { targetKind, revisionId } of requiredApprovals) {
    if (!approvedRevisionKeys.has(`${targetKind}:${revisionId}`)) {
      blockers.push(`revision_not_approved:${revisionId}`);
    }
  }

  const reviews = new Map(input.conflictReviews.map((review) => [review.checksum, review]));
  for (const conflict of input.importPlan.exactHashGroups.filter((group) => group.semanticConflict)) {
    const review = reviews.get(conflict.checksum);
    if (
      !review
      || review.disposition !== "resolved"
      || review.actor?.actorType !== "human"
      || !review.reviewedAt
      || !review.reason?.trim()
    ) {
      blockers.push(`semantic_conflict_unresolved:${conflict.checksum}`);
    }
  }

  const semanticContent = baselineSemanticContent(input);
  return immutable({
    ...input,
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers: blockers.sort(compareCodePoints),
    semanticContent,
    semanticHash: semanticSha256(semanticContent),
  });
}

export function publishProjectBaseline(input: {
  readonly candidate: ProjectBaselineCandidate;
  readonly baselineId: string;
  readonly versionNo: number;
  readonly actor: HumanActorRef;
  readonly publishedAt: string;
}): ProjectBaseline {
  if (input.candidate.status !== "ready" || input.candidate.blockers.length > 0) {
    throw new PackageContractError("BASELINE_BLOCKED", input.candidate.blockers.join(","));
  }
  validateActor(input.actor);
  validateTime(input.publishedAt);
  if (!Number.isSafeInteger(input.versionNo) || input.versionNo < 1) {
    throw new PackageContractError("BASELINE_VERSION_INVALID", "Baseline version must be positive.");
  }
  return immutable({
    id: input.baselineId,
    organizationId: input.candidate.organizationId,
    projectId: input.candidate.projectId,
    versionNo: input.versionNo,
    previousBaselineId: input.candidate.previousBaselineId,
    status: "published",
    semanticContent: input.candidate.semanticContent,
    semanticHash: input.candidate.semanticHash,
    publishedAt: input.publishedAt,
    publishedBy: input.actor,
  });
}

export function buildProductionPackageVersion(input: {
  readonly id: string;
  readonly packageId: string;
  readonly baseline: ProjectBaseline;
  readonly versionNo: number;
  readonly previousVersionId: string | null;
  readonly exactRevisionRefs?: ExactRevisionRefs;
  readonly actor: HumanActorRef;
  readonly publishedAt: string;
}): ProductionPackageVersion {
  validateActor(input.actor);
  validateTime(input.publishedAt);
  const targetPackage = input.baseline.semanticContent.packages.find(
    (item) => item.id === input.packageId,
  );
  if (!targetPackage) {
    throw new PackageContractError("PACKAGE_NOT_IN_BASELINE", input.packageId);
  }
  if (!Number.isSafeInteger(input.versionNo) || input.versionNo < 1) {
    throw new PackageContractError("PACKAGE_VERSION_INVALID", "Package version must be positive.");
  }
  const fullBaselineRefs: ExactRevisionRefs = {
    sources: [...input.baseline.semanticContent.sourceRevisionIds],
    requirements: [...input.baseline.semanticContent.requirementRevisionIds],
    assumptions: [...input.baseline.semanticContent.assumptionRevisionIds],
    decisions: [...input.baseline.semanticContent.decisionRevisionIds],
    selections: [...input.baseline.semanticContent.selectionRevisionIds],
  };
  if (targetPackage.kind === "work_package" && input.exactRevisionRefs === undefined) {
    throw new PackageContractError(
      "WORK_PACKAGE_SUBSET_REQUIRED",
      "A work package must publish an explicit exact subset of the baseline.",
    );
  }
  const requestedRefs = input.exactRevisionRefs ?? fullBaselineRefs;
  const exactRevisionRefs: ExactRevisionRefs = {
    sources: sortedUnique(requestedRefs.sources, "PACKAGE_SOURCE_REFS_INVALID"),
    requirements: sortedUnique(
      requestedRefs.requirements,
      "PACKAGE_REQUIREMENT_REFS_INVALID",
    ),
    assumptions: sortedUnique(
      requestedRefs.assumptions,
      "PACKAGE_ASSUMPTION_REFS_INVALID",
    ),
    decisions: sortedUnique(
      requestedRefs.decisions,
      "PACKAGE_DECISION_REFS_INVALID",
    ),
    selections: sortedUnique(
      requestedRefs.selections,
      "PACKAGE_SELECTION_REFS_INVALID",
    ),
  };
  const baselineSets = {
    sources: new Set(fullBaselineRefs.sources),
    requirements: new Set(fullBaselineRefs.requirements),
    assumptions: new Set(fullBaselineRefs.assumptions),
    decisions: new Set(fullBaselineRefs.decisions),
    selections: new Set(fullBaselineRefs.selections),
  };
  for (const kind of Object.keys(exactRevisionRefs) as (keyof ExactRevisionRefs)[]) {
    for (const revisionId of exactRevisionRefs[kind]) {
      if (!baselineSets[kind].has(revisionId)) {
        throw new PackageContractError(
          "PACKAGE_REVISION_NOT_IN_BASELINE",
          `${kind}:${revisionId}`,
        );
      }
    }
  }
  if (Object.values(exactRevisionRefs).every((values) => values.length === 0)) {
    throw new PackageContractError(
      "PACKAGE_SUBSET_EMPTY",
      "A package version must contain at least one exact revision.",
    );
  }
  const semanticHash = semanticSha256({
    schemaVersion: "project-ceo-production-package/0.1",
    organizationId: input.baseline.organizationId,
    projectId: input.baseline.projectId,
    packageId: input.packageId,
    baselineId: input.baseline.id,
    versionNo: input.versionNo,
    previousVersionId: input.previousVersionId,
    exactRevisionRefs,
  });
  return immutable({
    id: input.id,
    organizationId: input.baseline.organizationId,
    projectId: input.baseline.projectId,
    packageId: input.packageId,
    baselineId: input.baseline.id,
    versionNo: input.versionNo,
    previousVersionId: input.previousVersionId,
    status: "published",
    exactRevisionRefs,
    semanticHash,
    publishedAt: input.publishedAt,
    publishedBy: input.actor,
  });
}

export function buildReleaseDescriptor(input: {
  readonly productionPackage: ProductionPackageVersion;
  readonly artifacts: readonly {
    readonly kind: "logical_json" | "pdf" | "xlsx" | "csv";
    readonly contentHash: `sha256:${string}`;
  }[];
}): ReleaseDescriptor {
  for (const artifact of input.artifacts) {
    if (!PREFIXED_HASH.test(artifact.contentHash)) {
      throw new PackageContractError("ARTIFACT_HASH_INVALID", artifact.kind);
    }
  }
  const artifacts = [...input.artifacts].sort((left, right) => (
    compareCodePoints(left.kind, right.kind)
    || compareCodePoints(left.contentHash, right.contentHash)
  ));
  const logicalContent = {
    schemaVersion: "project-ceo-release/0.1" as const,
    organizationId: input.productionPackage.organizationId,
    projectId: input.productionPackage.projectId,
    packageId: input.productionPackage.packageId,
    productionPackageVersionId: input.productionPackage.id,
    productionPackageSemanticHash: input.productionPackage.semanticHash,
    baselineId: input.productionPackage.baselineId,
    exactRevisionRefs: input.productionPackage.exactRevisionRefs,
    artifacts,
  };
  return immutable({
    logicalContent,
    semanticHash: semanticSha256(logicalContent),
  });
}

export function resolveReleaseArtifactBuild(
  existing: readonly ReleaseArtifact[],
  request: ReleaseArtifactBuildRequest,
): ReleaseArtifactBuildOutcome {
  if (!PREFIXED_HASH.test(request.semanticHash) || !request.idempotencyKey.trim()) {
    throw new PackageContractError("RELEASE_BUILD_REQUEST_INVALID", "Hash and idempotency key are required.");
  }
  const byKey = existing.find((artifact) => artifact.idempotencyKey === request.idempotencyKey);
  if (byKey) {
    return immutable(
      byKey.productionPackageVersionId === request.productionPackageVersionId
      && byKey.format === request.format
      && byKey.semanticHash === request.semanticHash
        ? { kind: "idempotent_replay", artifact: byKey }
        : { kind: "idempotency_conflict" },
    );
  }
  const bySemanticTuple = existing.find((artifact) => (
    artifact.productionPackageVersionId === request.productionPackageVersionId
    && artifact.format === request.format
    && artifact.semanticHash === request.semanticHash
  ));
  if (bySemanticTuple) {
    return immutable({ kind: "existing_artifact", artifact: bySemanticTuple });
  }
  return immutable({
    kind: "created",
    artifact: {
      id: request.artifactId,
      productionPackageVersionId: request.productionPackageVersionId,
      format: request.format,
      semanticHash: request.semanticHash,
      idempotencyKey: request.idempotencyKey,
    },
  });
}

function symmetricDifference(left: readonly string[], right: readonly string[]): string[] {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return [...new Set([
    ...left.filter((value) => !rightSet.has(value)),
    ...right.filter((value) => !leftSet.has(value)),
  ])].sort(compareCodePoints);
}

export function diffProjectBaselines(
  previous: ProjectBaseline,
  next: ProjectBaseline,
): BaselineRevisionDiff {
  if (previous.projectId !== next.projectId || previous.organizationId !== next.organizationId) {
    throw new PackageContractError("PROJECT_SCOPE_VIOLATION", "Baseline diff scope mismatch.");
  }
  const changedRequirementRevisionIds = symmetricDifference(
    previous.semanticContent.requirementRevisionIds,
    next.semanticContent.requirementRevisionIds,
  );
  const changedAssumptionRevisionIds = symmetricDifference(
    previous.semanticContent.assumptionRevisionIds,
    next.semanticContent.assumptionRevisionIds,
  );
  const changedDecisionRevisionIds = symmetricDifference(
    previous.semanticContent.decisionRevisionIds,
    next.semanticContent.decisionRevisionIds,
  );
  const changedSelectionRevisionIds = symmetricDifference(
    previous.semanticContent.selectionRevisionIds,
    next.semanticContent.selectionRevisionIds,
  );
  const impactRootRevisionIds = [
    ...next.semanticContent.decisionRevisionIds.filter(
      (revisionId) => !previous.semanticContent.decisionRevisionIds.includes(revisionId),
    ),
    ...next.semanticContent.selectionRevisionIds.filter(
      (revisionId) => !previous.semanticContent.selectionRevisionIds.includes(revisionId),
    ),
  ].sort(compareCodePoints);
  return immutable({
    changed: [
      changedRequirementRevisionIds,
      changedAssumptionRevisionIds,
      changedDecisionRevisionIds,
      changedSelectionRevisionIds,
    ].some((values) => values.length > 0),
    changedRequirementRevisionIds,
    changedAssumptionRevisionIds,
    changedDecisionRevisionIds,
    changedSelectionRevisionIds,
    impactRootRevisionIds,
  });
}

export function approveNoChangeTerminal(input: {
  readonly baseline: ProjectBaseline;
  readonly productionPackage: ProductionPackageVersion;
  readonly actor: HumanActorRef;
  readonly approvedAt: string;
  readonly reason: string;
}): NoChangeTerminal {
  validateActor(input.actor);
  validateTime(input.approvedAt);
  if (!input.reason.trim()) {
    throw new PackageContractError("NO_CHANGE_REASON_REQUIRED", "No-change approval requires a reason.");
  }
  if (input.productionPackage.baselineId !== input.baseline.id) {
    throw new PackageContractError("BASELINE_PACKAGE_MISMATCH", "Package does not belong to baseline.");
  }
  return immutable({
    status: "approved_no_change",
    baselineId: input.baseline.id,
    productionPackageVersionId: input.productionPackage.id,
    approvedAt: input.approvedAt,
    approvedBy: input.actor,
    reason: input.reason,
  });
}
