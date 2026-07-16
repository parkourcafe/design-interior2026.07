import {
  buildBaselineCandidate,
  buildProductionPackageVersion,
  buildReleaseDescriptor,
  diffProjectBaselines,
  planSourceImport,
  publishProjectBaseline,
} from "../../../lib/project-intelligence/modules/package";
import goldenJson from "../../../fixtures/project-intelligence/kora/kora-project-brain-golden.json";
import type { KoraProjectBrainGolden } from "../../../lib/project-intelligence/modules/package/kora-golden";
import {
  applyExecutionImpactDispositions,
  createProjectChangeRequest,
  deriveExecutionChangeSet,
} from "../../../lib/project-intelligence/modules/execution";

const actor = { actorId: "demo-human-reviewer", actorType: "human" } as const;

function approvalPackage(
  projectId: string,
  packageId: string,
  id: string,
  requirementRevisionIds: readonly string[],
  assumptionRevisionIds: readonly string[],
  decisionRevisionIds: readonly string[],
  selectionRevisionIds: readonly string[],
) {
  return {
    id,
    projectId,
    packageId,
    items: [
      ...requirementRevisionIds.map((revisionId) => ({
        targetKind: "requirement_revision" as const,
        entityId: "requirement-project-scope",
        revisionId,
      })),
      ...assumptionRevisionIds.map((revisionId) => ({
        targetKind: "assumption_revision" as const,
        entityId: "assumption-site-access",
        revisionId,
      })),
      ...decisionRevisionIds.map((revisionId) => ({
        targetKind: "decision_revision" as const,
        entityId: "decision-floor-finish",
        revisionId,
      })),
      ...selectionRevisionIds.map((revisionId) => ({
        targetKind: "selection_revision" as const,
        entityId: "selection-floor-finish",
        revisionId,
      })),
    ],
    status: "approved" as const,
    submittedAt: "2026-07-17T14:00:00Z",
    submittedBy: actor,
    review: {
      decision: "approved" as const,
      actor,
      reviewedAt: "2026-07-17T15:00:00Z",
      reason: "Sanitized demo exact revisions approved by a human.",
    },
  };
}

function main(): void {
  const golden = goldenJson as KoraProjectBrainGolden;
  const importPlan = planSourceImport(golden.inventory);
  const sourceRevisionIds = [...new Set(importPlan.entries
    .filter((entry) => entry.evidenceEligible && entry.sourceRevisionId)
    .map((entry) => entry.sourceRevisionId!))]
    .slice(0, 12);
  const common = {
    organizationId: golden.organizationId,
    projectId: golden.projectId,
    packages: golden.packages,
    importPlan,
    includedSourceRevisionIds: sourceRevisionIds,
    requirementRevisionIds: ["requirement-project-scope-r1"],
    assumptionRevisionIds: ["assumption-site-access-r1"],
    conflictReviews: golden.conflictReviews,
  };
  const candidateV1 = buildBaselineCandidate({
    ...common,
    id: "baseline-candidate-v1",
    previousBaselineId: null,
    decisionRevisionIds: golden.scenario.baselineV1.decisionRevisionIds,
    selectionRevisionIds: golden.scenario.baselineV1.selectionRevisionIds,
    approvalPackages: [approvalPackage(
      golden.projectId,
      golden.packages[0]!.id,
      golden.scenario.baselineV1.approvalPackageIds[0]!,
      common.requirementRevisionIds,
      common.assumptionRevisionIds,
      golden.scenario.baselineV1.decisionRevisionIds,
      golden.scenario.baselineV1.selectionRevisionIds,
    )],
  });
  const baselineV1 = publishProjectBaseline({
    candidate: candidateV1,
    baselineId: golden.scenario.baselineV1.id,
    versionNo: 1,
    actor,
    publishedAt: "2026-07-17T16:00:00Z",
  });
  const packageV1 = buildProductionPackageVersion({
    id: "production-package-v1",
    packageId: golden.packages[0]!.id,
    baseline: baselineV1,
    versionNo: 1,
    previousVersionId: null,
    actor,
    publishedAt: "2026-07-17T16:10:00Z",
  });

  const candidateV2 = buildBaselineCandidate({
    ...common,
    id: "baseline-candidate-v2",
    previousBaselineId: baselineV1.id,
    decisionRevisionIds: golden.scenario.baselineV2.decisionRevisionIds,
    selectionRevisionIds: golden.scenario.baselineV2.selectionRevisionIds,
    approvalPackages: [approvalPackage(
      golden.projectId,
      golden.packages[0]!.id,
      golden.scenario.baselineV2.approvalPackageIds[0]!,
      common.requirementRevisionIds,
      common.assumptionRevisionIds,
      golden.scenario.baselineV2.decisionRevisionIds,
      golden.scenario.baselineV2.selectionRevisionIds,
    )],
  });
  const baselineV2 = publishProjectBaseline({
    candidate: candidateV2,
    baselineId: golden.scenario.baselineV2.id,
    versionNo: 2,
    actor,
    publishedAt: "2026-07-17T17:00:00Z",
  });
  const diff = diffProjectBaselines(baselineV1, baselineV2);
  const request = createProjectChangeRequest({
    id: golden.scenario.changeRequestId,
    projectId: golden.projectId,
    fromBaselineId: baselineV1.id,
    proposedBaselineId: baselineV2.id,
    reason: "Sanitized demo selection change.",
    requestedBy: actor,
    requestedAt: "2026-07-17T16:50:00Z",
    deltaCostRub: 180_000,
    deltaDays: 2,
    status: "submitted",
  }, baselineV1, baselineV2);
  const changeSet = deriveExecutionChangeSet({
    id: "change-set-v2",
    request,
    diff,
    dependencies: golden.scenario.dependencies,
    maxDepth: 3,
  });
  const reviewedChangeSet = applyExecutionImpactDispositions(
    changeSet,
    changeSet.impacts.map((impact) => ({
      impactKey: `${impact.rootRevisionId}->${impact.impactedRevisionId}`,
      disposition: "accepted" as const,
      actor,
      reviewedAt: "2026-07-17T17:10:00Z",
      reason: "Sanitized demo impact reviewed by a human.",
    })),
  );
  const packageV2 = buildProductionPackageVersion({
    id: "production-package-v2",
    packageId: golden.packages[0]!.id,
    baseline: baselineV2,
    versionNo: 2,
    previousVersionId: packageV1.id,
    actor,
    publishedAt: "2026-07-17T17:20:00Z",
  });
  const releaseV2 = buildReleaseDescriptor({
    productionPackage: packageV2,
    artifacts: [{
      kind: "logical_json",
      contentHash: packageV2.semanticHash,
    }],
  });

  process.stdout.write(`${JSON.stringify({
    KORA_DB_GOLDEN: importPlan.summary.physicalRecords === 209,
    M2_DECISIONS_SELECTIONS: diff.impactRootRevisionIds.length === 1,
    M3_BASELINE_RELEASE: packageV2.previousVersionId === packageV1.id,
    CHANGE_IMPACT_GOLDEN: reviewedChangeSet.dispositions.length === 3,
    NO_ROOM_ONLY_REDUCTION: golden.projectProfile.model === "full_project",
    PRODUCTION_CHANGED: false,
    inventory: importPlan.summary,
    baselineV1Hash: baselineV1.semanticHash,
    baselineV2Hash: baselineV2.semanticHash,
    releaseV2Hash: releaseV2.semanticHash,
    impactCount: changeSet.impacts.length,
  }, null, 2)}\n`);
}

main();
