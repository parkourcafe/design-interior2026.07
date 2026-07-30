import { describe, expect, it } from "vitest";
import goldenJson from "@/fixtures/project-intelligence/kora/kora-project-brain-golden.json";
import sourceManifest from "@/tests/project-intelligence/fixtures/pro-up-ru/kora-food-hall-source-manifest.json";
import {
  approveNoChangeTerminal,
  buildBaselineCandidate,
  buildProductionPackageVersion,
  buildReleaseDescriptor,
  diffProjectBaselines,
  planSourceImport,
  publishProjectBaseline,
  resolveReleaseArtifactBuild,
} from "@/lib/project-intelligence/modules/package";
import {
  buildKoraProjectBrainGolden,
  type KoraProjectBrainGolden as KoraGoldenFixture,
  type KoraSourceManifestInput,
} from "@/lib/project-intelligence/modules/package/kora-golden";
import {
  applyExecutionImpactDispositions,
  createProjectChangeRequest,
  deriveExecutionChangeSet,
} from "@/lib/project-intelligence/modules/execution";

const golden = goldenJson as unknown as KoraGoldenFixture;
const actor = { actorId: "member-architect", actorType: "human" } as const;
const requirementRevisionIds = ["requirement-project-scope-r1"];
const assumptionRevisionIds = ["assumption-site-access-r1"];

function approvedPackage(
  id: string,
  approvedRequirementRevisionIds: readonly string[],
  approvedAssumptionRevisionIds: readonly string[],
  decisionRevisionIds: readonly string[],
  selectionRevisionIds: readonly string[],
) {
  return {
    id,
    projectId: golden.projectId,
    packageId: golden.packages[0]!.id,
    items: [
      ...approvedRequirementRevisionIds.map((revisionId) => ({
        targetKind: "requirement_revision" as const,
        entityId: "requirement-project-scope",
        revisionId,
      })),
      ...approvedAssumptionRevisionIds.map((revisionId) => ({
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
      reason: "Exact revisions approved by a human.",
    },
  };
}

function eligibleSourceRevisionIds() {
  return [...new Set(planSourceImport(golden.inventory).entries
    .filter((entry) => entry.evidenceEligible && entry.sourceRevisionId !== null)
    .map((entry) => entry.sourceRevisionId!))]
    .slice(0, 12);
}

function candidateV1() {
  const importPlan = planSourceImport(golden.inventory);
  return buildBaselineCandidate({
    id: "baseline-candidate-v1",
    organizationId: golden.organizationId,
    projectId: golden.projectId,
    previousBaselineId: null,
    packages: golden.packages,
    importPlan,
    includedSourceRevisionIds: eligibleSourceRevisionIds(),
    requirementRevisionIds,
    assumptionRevisionIds,
    decisionRevisionIds: golden.scenario.baselineV1.decisionRevisionIds,
    selectionRevisionIds: golden.scenario.baselineV1.selectionRevisionIds,
    approvalPackages: [
      approvedPackage(
        golden.scenario.baselineV1.approvalPackageIds[0]!,
        requirementRevisionIds,
        assumptionRevisionIds,
        golden.scenario.baselineV1.decisionRevisionIds,
        golden.scenario.baselineV1.selectionRevisionIds,
      ),
    ],
    conflictReviews: golden.conflictReviews,
  });
}

function publishV1() {
  return publishProjectBaseline({
    candidate: candidateV1(),
    baselineId: golden.scenario.baselineV1.id,
    versionNo: 1,
    actor,
    publishedAt: "2026-07-17T16:00:00Z",
  });
}

describe("Kora full-project Project Brain golden", () => {
  it("is reproducible, sanitized and preserves the exact 209/81/128 physical inventory", () => {
    const regenerated = buildKoraProjectBrainGolden(sourceManifest as KoraSourceManifestInput);
    expect(regenerated).toEqual(golden);
    expect(golden.inventory).toHaveLength(209);
    expect(golden.projectProfile).toEqual({
      name: "Kora Food Hall",
      areaM2: 1800,
      model: "full_project",
    });
    expect(JSON.stringify(golden)).not.toMatch(/\/Users\/|msnigmatullaeva|KORA_Construction|Drawings/);
    expect(golden.inventory.every((record) => (
      /^source-\d{3}\.(docx|dwg|heic|jpeg|jpg|md|pdf|png|rar|xlsx|zip)$/.test(record.sanitizedName)
    ))).toBe(true);

    const importPlan = planSourceImport(golden.inventory);
    expect(importPlan.summary).toEqual({
      physicalRecords: 209,
      materializedRecords: 81,
      placeholders: 128,
      uniqueMaterializedBlobs: 28,
      duplicateGroups: 18,
      semanticConflictGroups: 8,
    });
    expect(importPlan.exactHashGroups.filter((group) => group.semanticConflict)).toHaveLength(8);
    expect(golden.inventory.filter((record) => record.availability === "materialized")).toHaveLength(81);
    expect(golden.inventory.filter((record) => record.availability === "materialized").every((record) => (
      typeof record.checksum === "string"
      && /^[a-f0-9]{64}$/.test(record.checksum)
      && record.sourceRevisionId !== null
    ))).toBe(true);
    expect(
      golden.inventory
        .filter((record) => record.checksum)
        .map((record) => record.checksum)
        .sort(),
    ).toEqual(
      sourceManifest.inventory
        .filter((record) => record.sha256)
        .map((record) => record.sha256)
        .sort(),
    );
  });

  it("keeps placeholders out of source identity and evidence until bytes are materialized", () => {
    const importPlan = planSourceImport(golden.inventory);
    const placeholders = importPlan.entries.filter((entry) => entry.checksum === null);
    expect(placeholders).toHaveLength(128);
    expect(placeholders.every((entry) => (
      entry.logicalSourceId === null
      && entry.sourceRevisionId === null
      && !entry.evidenceEligible
      && entry.stages.find((stage) => stage.stage === "fragment_evidence_extraction")?.status === "blocked"
    ))).toBe(true);
    expect(golden.inventory.filter((record) => record.availability === "placeholder").every((record) => (
      record.checksum === null && record.sourceRevisionId === null
    ))).toBe(true);
    const binaryPhysicalIds = new Set(
      golden.inventory
        .filter((record) => (
          record.availability === "materialized"
          && ["cad_binary", "archive", "document"].includes(record.mediaKind)
        ))
        .map((record) => record.physicalRecordId),
    );
    expect(
      importPlan.entries
        .filter((entry) => binaryPhysicalIds.has(entry.physicalRecordId))
        .every((entry) => !entry.evidenceEligible && entry.quarantineReason !== null),
    ).toBe(true);
  });

  it("deduplicates bytes into one logical source while preserving every physical alias", () => {
    const importPlan = planSourceImport(golden.inventory);
    const group = importPlan.exactHashGroups.find((candidate) => (
      candidate.physicalRecordIds.length === 4
    ))!;
    const aliases = importPlan.entries.filter((entry) => (
      entry.checksum === group.checksum
    ));
    expect(aliases).toHaveLength(4);
    expect(new Set(aliases.map((entry) => entry.logicalSourceId))).toEqual(
      new Set([group.logicalSourceId]),
    );
    expect(new Set(aliases.map((entry) => entry.sourceRevisionId))).toEqual(
      new Set([group.sourceRevisionId]),
    );
    const mismatched = golden.inventory.map((record) => (
      record.physicalRecordId === aliases[1]!.physicalRecordId
        ? { ...record, sourceRevisionId: "source-revision-wrong-alias" }
        : record
    ));
    expect(() => planSourceImport(mismatched)).toThrowError(
      /Exact duplicate bytes must share one source revision/,
    );
  });

  it("requires exact human approval for every included revision kind", () => {
    const importPlan = planSourceImport(golden.inventory);
    const incompleteApproval = approvedPackage(
      "approval-incomplete",
      requirementRevisionIds,
      [],
      golden.scenario.baselineV1.decisionRevisionIds,
      golden.scenario.baselineV1.selectionRevisionIds,
    );
    const blocked = buildBaselineCandidate({
      id: "baseline-candidate-incomplete-approval",
      organizationId: golden.organizationId,
      projectId: golden.projectId,
      previousBaselineId: null,
      packages: golden.packages,
      importPlan,
      includedSourceRevisionIds: eligibleSourceRevisionIds(),
      requirementRevisionIds,
      assumptionRevisionIds,
      decisionRevisionIds: golden.scenario.baselineV1.decisionRevisionIds,
      selectionRevisionIds: golden.scenario.baselineV1.selectionRevisionIds,
      approvalPackages: [incompleteApproval],
      conflictReviews: golden.conflictReviews,
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.blockers).toContain(
      `revision_not_approved:${assumptionRevisionIds[0]}`,
    );
  });

  it("blocks publication while any required semantic conflict lacks human resolution", () => {
    const importPlan = planSourceImport(golden.inventory);
    const blocked = buildBaselineCandidate({
      id: "baseline-candidate-blocked",
      organizationId: golden.organizationId,
      projectId: golden.projectId,
      previousBaselineId: null,
      packages: golden.packages,
      importPlan,
      includedSourceRevisionIds: eligibleSourceRevisionIds(),
      requirementRevisionIds,
      assumptionRevisionIds,
      decisionRevisionIds: golden.scenario.baselineV1.decisionRevisionIds,
      selectionRevisionIds: golden.scenario.baselineV1.selectionRevisionIds,
      approvalPackages: [
        approvedPackage(
          golden.scenario.baselineV1.approvalPackageIds[0]!,
          requirementRevisionIds,
          assumptionRevisionIds,
          golden.scenario.baselineV1.decisionRevisionIds,
          golden.scenario.baselineV1.selectionRevisionIds,
        ),
      ],
      conflictReviews: golden.conflictReviews.slice(0, -1),
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockers.some((blocker) => blocker.startsWith("semantic_conflict_unresolved:"))).toBe(true);
    expect(() => publishProjectBaseline({
      candidate: blocked,
      baselineId: "baseline-rejected",
      versionNo: 1,
      actor,
      publishedAt: "2026-07-17T16:00:00Z",
    })).toThrowError(/semantic_conflict_unresolved/);
  });

  it("publishes immutable V1, a deterministic release and an explicit no-change terminal", () => {
    const baselineV1 = publishV1();
    const packageV1 = buildProductionPackageVersion({
      id: "production-package-v1",
      packageId: golden.packages[0]!.id,
      baseline: baselineV1,
      versionNo: 1,
      previousVersionId: null,
      actor,
      publishedAt: "2026-07-17T16:10:00Z",
    });
    const releaseA = buildReleaseDescriptor({
      productionPackage: packageV1,
      artifacts: [{
        kind: "logical_json",
        contentHash: packageV1.semanticHash,
      }],
    });
    const releaseB = buildReleaseDescriptor({
      productionPackage: packageV1,
      artifacts: [{
        kind: "logical_json",
        contentHash: packageV1.semanticHash,
      }],
    });
    const noChange = approveNoChangeTerminal({
      baseline: baselineV1,
      productionPackage: packageV1,
      actor,
      approvedAt: "2026-07-17T16:20:00Z",
      reason: golden.scenario.noChange.reason,
    });

    expect(Object.isFrozen(baselineV1)).toBe(true);
    expect(Object.isFrozen(baselineV1.semanticContent.selectionRevisionIds)).toBe(true);
    expect(releaseA.semanticHash).toBe(releaseB.semanticHash);
    expect(noChange.status).toBe("approved_no_change");
  });

  it("requires an explicit validated baseline subset for every work package", () => {
    const baselineV1 = publishV1();
    const workPackageId = golden.packages.find(
      (item) => item.kind === "work_package",
    )!.id;
    expect(() => buildProductionPackageVersion({
      id: "work-package-missing-subset",
      packageId: workPackageId,
      baseline: baselineV1,
      versionNo: 1,
      previousVersionId: null,
      actor,
      publishedAt: "2026-07-17T16:10:00Z",
    })).toThrowError(/explicit exact subset/);

    expect(() => buildProductionPackageVersion({
      id: "work-package-invalid-subset",
      packageId: workPackageId,
      baseline: baselineV1,
      versionNo: 1,
      previousVersionId: null,
      exactRevisionRefs: {
        sources: [],
        requirements: [],
        assumptions: [],
        decisions: [],
        selections: ["selection-not-in-baseline"],
      },
      actor,
      publishedAt: "2026-07-17T16:10:00Z",
    })).toThrowError(/selections:selection-not-in-baseline/);

    const workPackage = buildProductionPackageVersion({
      id: "work-package-explicit-subset",
      packageId: workPackageId,
      baseline: baselineV1,
      versionNo: 1,
      previousVersionId: null,
      exactRevisionRefs: {
        sources: [baselineV1.semanticContent.sourceRevisionIds[0]!],
        requirements: [],
        assumptions: [],
        decisions: [],
        selections: [baselineV1.semanticContent.selectionRevisionIds[0]!],
      },
      actor,
      publishedAt: "2026-07-17T16:10:00Z",
    });
    expect(workPackage.exactRevisionRefs).toEqual({
      sources: [baselineV1.semanticContent.sourceRevisionIds[0]!],
      requirements: [],
      assumptions: [],
      decisions: [],
      selections: [baselineV1.semanticContent.selectionRevisionIds[0]!],
    });
    expect(workPackage.exactRevisionRefs.sources).not.toEqual(
      baselineV1.semanticContent.sourceRevisionIds,
    );
  });

  it("builds V2 from one selection change, derives impact roots and never mutates V1", () => {
    const baselineV1 = publishV1();
    const v1HashBefore = baselineV1.semanticHash;
    const importPlan = planSourceImport(golden.inventory);
    const candidateV2 = buildBaselineCandidate({
      id: "baseline-candidate-v2",
      organizationId: golden.organizationId,
      projectId: golden.projectId,
      previousBaselineId: baselineV1.id,
      packages: golden.packages,
      importPlan,
      includedSourceRevisionIds: eligibleSourceRevisionIds(),
      requirementRevisionIds,
      assumptionRevisionIds,
      decisionRevisionIds: golden.scenario.baselineV2.decisionRevisionIds,
      selectionRevisionIds: golden.scenario.baselineV2.selectionRevisionIds,
      approvalPackages: [
        approvedPackage(
          golden.scenario.baselineV2.approvalPackageIds[0]!,
          requirementRevisionIds,
          assumptionRevisionIds,
          golden.scenario.baselineV2.decisionRevisionIds,
          golden.scenario.baselineV2.selectionRevisionIds,
        ),
      ],
      conflictReviews: golden.conflictReviews,
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
      reason: "Подтверждена замена выбранного покрытия.",
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
    const cappedChangeSet = deriveExecutionChangeSet({
      id: "change-set-v2-depth-2",
      request,
      diff,
      dependencies: golden.scenario.dependencies,
      maxDepth: 2,
    });
    const reviewed = applyExecutionImpactDispositions(
      changeSet,
      changeSet.impacts.map((impact) => ({
        impactKey: `${impact.rootRevisionId}->${impact.impactedRevisionId}`,
        disposition: "accepted" as const,
        actor,
        reviewedAt: "2026-07-17T17:10:00Z",
        reason: "Влияние проверено ответственным архитектором.",
      })),
    );
    const packageV2 = buildProductionPackageVersion({
      id: "production-package-v2",
      packageId: golden.packages[0]!.id,
      baseline: baselineV2,
      versionNo: 2,
      previousVersionId: "production-package-v1",
      actor,
      publishedAt: "2026-07-17T17:20:00Z",
    });

    expect(diff.impactRootRevisionIds).toEqual(golden.scenario.baselineV2.selectionRevisionIds);
    expect(changeSet.impacts.map(({ rootRevisionId, impactedRevisionId, distance }) => ({
      rootRevisionId,
      impactedRevisionId,
      distance,
    }))).toEqual(golden.scenario.expectedImpacts);
    expect(cappedChangeSet.impacts.every((impact) => impact.distance <= 2)).toBe(true);
    expect(cappedChangeSet.impacts).toHaveLength(2);
    expect(reviewed.dispositions).toHaveLength(3);
    expect(packageV2.previousVersionId).toBe("production-package-v1");
    expect(baselineV1.semanticHash).toBe(v1HashBefore);
    expect(baselineV1.semanticContent.selectionRevisionIds).toEqual(
      golden.scenario.baselineV1.selectionRevisionIds,
    );
  });

  it("returns a controlled existing artifact outcome for a different idempotency key", () => {
    const baselineV1 = publishV1();
    const packageV1 = buildProductionPackageVersion({
      id: "production-package-v1",
      packageId: golden.packages[0]!.id,
      baseline: baselineV1,
      versionNo: 1,
      previousVersionId: null,
      actor,
      publishedAt: "2026-07-17T16:10:00Z",
    });
    const created = resolveReleaseArtifactBuild([], {
      artifactId: "artifact-v1",
      productionPackageVersionId: packageV1.id,
      format: "logical_json",
      semanticHash: packageV1.semanticHash,
      idempotencyKey: "release-key-1",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") throw new Error("Expected created artifact.");
    const repeated = resolveReleaseArtifactBuild([created.artifact], {
      artifactId: "artifact-v1-retry",
      productionPackageVersionId: packageV1.id,
      format: "logical_json",
      semanticHash: packageV1.semanticHash,
      idempotencyKey: "release-key-2",
    });
    expect(repeated).toEqual({
      kind: "existing_artifact",
      artifact: created.artifact,
    });
  });
});
