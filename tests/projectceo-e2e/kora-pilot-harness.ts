import goldenJson from "@/fixtures/project-intelligence/kora/kora-project-brain-golden.json";
import scenarioJson from "@/fixtures/project-intelligence/kora/kora-pilot-scenario.json";
import {
  createApprovalPackage,
  createSelectionCandidate,
  reviewApprovalPackage,
  submitApprovalPackage,
  validateRevisionEntity,
  type AssumptionRevision,
  type DecisionRevision,
  type RequirementRevision,
} from "@/lib/project-intelligence/modules/decisions";
import {
  approveNoChangeTerminal,
  buildBaselineCandidate,
  buildProductionPackageVersion,
  buildReleaseDescriptor,
  diffProjectBaselines,
  planSourceImport,
  publishProjectBaseline,
} from "@/lib/project-intelligence/modules/package";
import type { KoraProjectBrainGolden } from "@/lib/project-intelligence/modules/package/kora-golden";
import {
  applyExecutionImpactDispositions,
  createProjectChangeRequest,
  deriveExecutionChangeSet,
  validateConstructionHandover,
} from "@/lib/project-intelligence/modules/execution";
import { assertExactPackageScope, can } from "@/components/projectceo/role-policy";

const golden = goldenJson as KoraProjectBrainGolden;

interface PilotScenario {
  readonly schemaVersion: "project-ceo-kora-pilot/0.1";
  readonly sanitized: true;
  readonly project: {
    readonly name: string;
    readonly areaM2: number;
    readonly model: "full_project";
    readonly sourceRevisionSampleSize: number;
  };
  readonly actors: Readonly<Record<"owner" | "architect" | "builder" | "client" | "guest", string>>;
  readonly revisions: {
    readonly requirement: string;
    readonly assumption: string;
    readonly decision: string;
    readonly selectionV1: string;
    readonly selectionV2: string;
  };
  readonly artifacts: Readonly<Record<string, string>>;
  readonly distribution: {
    readonly id: string;
    readonly acknowledgementId: string;
    readonly recipientRole: "builder";
    readonly guestPackageStableKey: string;
  };
  readonly change: {
    readonly reason: string;
    readonly deltaCostRub: number;
    readonly deltaDays: number;
    readonly maxDepth: number;
    readonly dispositions: readonly ("accepted" | "resolved" | "dismissed")[];
  };
  readonly fieldClosure: {
    readonly areas: readonly string[];
    readonly milestones: readonly {
      readonly id: string;
      readonly areaIds: readonly string[];
      readonly acceptedPhotoIds: readonly string[];
    }[];
    readonly warrantyDocumentIds: readonly string[];
  };
  readonly expected: {
    readonly physicalRecords: number;
    readonly materializedRecords: number;
    readonly placeholders: number;
    readonly workPackages: number;
    readonly impactCount: number;
    readonly baselineV1Hash: `sha256:${string}`;
    readonly baselineV2Hash: `sha256:${string}`;
    readonly rootReleaseV2Hash: `sha256:${string}`;
  };
}

const scenario = scenarioJson as PilotScenario;
const owner = { actorId: scenario.actors.owner, actorType: "human" } as const;
const architect = { actorId: scenario.actors.architect, actorType: "human" } as const;

function approvedRevisionPackage(input: {
  readonly id: string;
  readonly revisions: readonly (
    | RequirementRevision
    | AssumptionRevision
    | DecisionRevision
    | ReturnType<typeof createSelectionCandidate>
  )[];
  readonly submittedAt: string;
  readonly reviewedAt: string;
}) {
  const draft = createApprovalPackage({
    id: input.id,
    projectId: golden.projectId,
    packageId: golden.packages[0]!.id,
    revisions: input.revisions,
  });
  const submitted = submitApprovalPackage(draft, architect, input.submittedAt);
  return reviewApprovalPackage(submitted, {
    decision: "approved",
    actor: owner,
    reviewedAt: input.reviewedAt,
    reason: "Точные revisions проверены и утверждены человеком.",
  });
}

function buildExactRevisions(source: {
  readonly logicalSourceId: string;
  readonly sourceRevisionId: string;
}) {
  const evidence = {
    evidenceId: "evidence-kora-pilot-exact",
    sourceId: source.logicalSourceId,
    sourceRevisionId: source.sourceRevisionId,
    fragmentId: "fragment-kora-pilot-001",
  };
  const requirement = validateRevisionEntity<RequirementRevision>({
    id: scenario.revisions.requirement,
    projectId: golden.projectId,
    entityId: "requirement-project-scope",
    revisionNo: 1,
    kind: "requirement",
    statement: "Сохранить Kora единым полноразмерным проектом 1 800 м².",
    areaId: null,
    packageId: golden.packages[0]!.id,
    claimStatus: "human_origin",
    reviewStatus: "approved",
    evidence: [],
    createdAt: "2026-07-17T13:00:00Z",
    createdBy: owner,
    reason: "Владелец зафиксировал границу проекта.",
    replacesRevisionId: null,
  });
  const assumption = validateRevisionEntity<AssumptionRevision>({
    id: scenario.revisions.assumption,
    projectId: golden.projectId,
    entityId: "assumption-site-access",
    revisionNo: 1,
    kind: "assumption",
    statement: "Доступ на объект сверяется перед каждой полевой фиксацией.",
    areaId: null,
    packageId: golden.packages[0]!.id,
    validationNeeded: "Подтвердить человеком до milestone.",
    claimStatus: "interpreted",
    reviewStatus: "approved",
    evidence: [evidence],
    createdAt: "2026-07-17T13:05:00Z",
    createdBy: { actorId: "pilot-source-extractor", actorType: "system" },
    reason: "Интерпретировано из exact source revision.",
    replacesRevisionId: null,
  });
  const decision = validateRevisionEntity<DecisionRevision>({
    id: scenario.revisions.decision,
    projectId: golden.projectId,
    entityId: "decision-floor-finish",
    revisionNo: 1,
    kind: "decision",
    title: "Чистовое покрытие общественных зон",
    resolution: "Использовать утверждённую износостойкую систему покрытия.",
    areaId: "area-first-floor",
    packageId: golden.packages[0]!.id,
    status: "confirmed",
    claimStatus: "interpreted",
    reviewStatus: "approved",
    evidence: [evidence],
    createdAt: "2026-07-17T13:10:00Z",
    createdBy: { actorId: "pilot-source-extractor", actorType: "system" },
    reason: "Решение связано с exact evidence и подтверждено человеком.",
    replacesRevisionId: null,
  });
  const selectionV1 = createSelectionCandidate({
    projectId: golden.projectId,
    entityId: "selection-floor-finish",
    title: "Материал покрытия V1",
    areaId: "area-first-floor",
    packageId: golden.packages[0]!.id,
    decisionRevisionId: decision.id,
    specification: { material: "porcelain", finish: "matte" },
    claimStatus: "human_origin",
    identity: {
      revisionId: scenario.revisions.selectionV1,
      revisionNo: 1,
      createdAt: "2026-07-17T13:20:00Z",
      createdBy: architect,
      reason: "Архитектор зафиксировал исходный материал.",
    },
  });
  const selectionV2 = validateRevisionEntity({
    ...selectionV1,
    id: scenario.revisions.selectionV2,
    revisionNo: 2,
    title: "Материал покрытия V2",
    specification: { material: "porcelain", finish: "anti-slip matte" },
    reviewStatus: "draft" as const,
    createdAt: "2026-07-17T16:45:00Z",
    createdBy: architect,
    reason: scenario.change.reason,
    replacesRevisionId: selectionV1.id,
  });
  return { requirement, assumption, decision, selectionV1, selectionV2, evidence };
}

export interface KoraPilotEvidence {
  readonly contractVersion: "project-ceo-kora-pilot-evidence/0.1";
  readonly project: {
    readonly areaM2: 1800;
    readonly model: "full_project";
    readonly packageCount: number;
    readonly workPackageCount: number;
  };
  readonly sources: ReturnType<typeof planSourceImport>["summary"];
  readonly approval: {
    readonly baselineV1Approval: "approved";
    readonly baselineV2Approval: "approved";
    readonly exactEvidenceBound: boolean;
  };
  readonly versions: {
    readonly baselineV1Hash: `sha256:${string}`;
    readonly baselineV2Hash: `sha256:${string}`;
    readonly immutableV1: boolean;
    readonly rootReleaseV2Hash: `sha256:${string}`;
    readonly workPackageVersions: number;
  };
  readonly delivery: {
    readonly distributionId: string;
    readonly acknowledgementId: string;
    readonly exactPackageVersionId: string;
    readonly exactSemanticHash: `sha256:${string}`;
  };
  readonly change: {
    readonly deltaCostRub: number;
    readonly deltaDays: number;
    readonly boundedDepth: number;
    readonly impactCount: number;
    readonly humanDispositionCount: number;
  };
  readonly noChange: {
    readonly status: "approved_no_change";
    readonly packageVersionId: string;
  };
  readonly fieldClosure: {
    readonly milestoneCount: number;
    readonly acceptedAreaCount: number;
    readonly acceptedPhotoCount: number;
    readonly warrantyDocumentCount: number;
    readonly incompleteClosureRejected: boolean;
    readonly handoverReady: boolean;
  };
  readonly isolation: {
    readonly builderCannotPublish: boolean;
    readonly clientCannotDistribute: boolean;
    readonly guestCannotReviewSource: boolean;
    readonly guestExactPackageAllowed: boolean;
    readonly guestSiblingPackageDenied: boolean;
  };
  readonly productionChanged: false;
}

export function runKoraPilotScenario(): KoraPilotEvidence {
  if (
    scenario.schemaVersion !== "project-ceo-kora-pilot/0.1"
    || !scenario.sanitized
    || golden.projectProfile.areaM2 !== scenario.project.areaM2
    || golden.projectProfile.model !== scenario.project.model
  ) {
    throw new Error("KORA_PILOT_FIXTURE_SCOPE_INVALID");
  }

  const importPlan = planSourceImport(golden.inventory);
  const eligibleSources = importPlan.entries.filter((entry) => (
    entry.evidenceEligible && entry.logicalSourceId && entry.sourceRevisionId
  ));
  const includedSourceRevisionIds = [...new Set(eligibleSources
    .map((entry) => entry.sourceRevisionId!))]
    .slice(0, scenario.project.sourceRevisionSampleSize);
  const primarySource = eligibleSources[0]!;
  const revisions = buildExactRevisions({
    logicalSourceId: primarySource.logicalSourceId!,
    sourceRevisionId: primarySource.sourceRevisionId!,
  });
  const approvalV1 = approvedRevisionPackage({
    id: golden.scenario.baselineV1.approvalPackageIds[0]!,
    revisions: [
      revisions.requirement,
      revisions.assumption,
      revisions.decision,
      revisions.selectionV1,
    ],
    submittedAt: "2026-07-17T14:00:00Z",
    reviewedAt: "2026-07-17T15:00:00Z",
  });
  const candidateV1 = buildBaselineCandidate({
    id: "pilot-baseline-candidate-v1",
    organizationId: golden.organizationId,
    projectId: golden.projectId,
    previousBaselineId: null,
    packages: golden.packages,
    importPlan,
    includedSourceRevisionIds,
    requirementRevisionIds: [revisions.requirement.id],
    assumptionRevisionIds: [revisions.assumption.id],
    decisionRevisionIds: [revisions.decision.id],
    selectionRevisionIds: [revisions.selectionV1.id],
    approvalPackages: [approvalV1],
    conflictReviews: golden.conflictReviews,
  });
  const baselineV1 = publishProjectBaseline({
    candidate: candidateV1,
    baselineId: golden.scenario.baselineV1.id,
    versionNo: 1,
    actor: owner,
    publishedAt: "2026-07-17T16:00:00Z",
  });
  const rootPackage = golden.packages.find((item) => item.kind === "project_root")!;
  const architecturePackage = golden.packages.find(
    (item) => item.stableKey === "architecture-release",
  )!;
  const engineeringPackage = golden.packages.find(
    (item) => item.stableKey === "engineering-release",
  )!;
  const rootV1 = buildProductionPackageVersion({
    id: scenario.artifacts.rootV1!,
    packageId: rootPackage.id,
    baseline: baselineV1,
    versionNo: 1,
    previousVersionId: null,
    actor: owner,
    publishedAt: "2026-07-17T16:10:00Z",
  });
  const architectureV1 = buildProductionPackageVersion({
    id: scenario.artifacts.architectureV1!,
    packageId: architecturePackage.id,
    baseline: baselineV1,
    versionNo: 1,
    previousVersionId: null,
    exactRevisionRefs: {
      sources: includedSourceRevisionIds.slice(0, 6),
      requirements: [revisions.requirement.id],
      assumptions: [revisions.assumption.id],
      decisions: [revisions.decision.id],
      selections: [revisions.selectionV1.id],
    },
    actor: owner,
    publishedAt: "2026-07-17T16:12:00Z",
  });
  const engineeringV1 = buildProductionPackageVersion({
    id: scenario.artifacts.engineeringV1!,
    packageId: engineeringPackage.id,
    baseline: baselineV1,
    versionNo: 1,
    previousVersionId: null,
    exactRevisionRefs: {
      sources: includedSourceRevisionIds.slice(6),
      requirements: [revisions.requirement.id],
      assumptions: [revisions.assumption.id],
      decisions: [],
      selections: [],
    },
    actor: owner,
    publishedAt: "2026-07-17T16:13:00Z",
  });
  const noChange = approveNoChangeTerminal({
    baseline: baselineV1,
    productionPackage: engineeringV1,
    actor: owner,
    approvedAt: "2026-07-17T16:20:00Z",
    reason: golden.scenario.noChange.reason,
  });

  const approvalV2 = approvedRevisionPackage({
    id: golden.scenario.baselineV2.approvalPackageIds[0]!,
    revisions: [
      revisions.requirement,
      revisions.assumption,
      revisions.decision,
      revisions.selectionV2,
    ],
    submittedAt: "2026-07-17T16:50:00Z",
    reviewedAt: "2026-07-17T17:00:00Z",
  });
  const candidateV2 = buildBaselineCandidate({
    id: "pilot-baseline-candidate-v2",
    organizationId: golden.organizationId,
    projectId: golden.projectId,
    previousBaselineId: baselineV1.id,
    packages: golden.packages,
    importPlan,
    includedSourceRevisionIds,
    requirementRevisionIds: [revisions.requirement.id],
    assumptionRevisionIds: [revisions.assumption.id],
    decisionRevisionIds: [revisions.decision.id],
    selectionRevisionIds: [revisions.selectionV2.id],
    approvalPackages: [approvalV2],
    conflictReviews: golden.conflictReviews,
  });
  const baselineV2 = publishProjectBaseline({
    candidate: candidateV2,
    baselineId: golden.scenario.baselineV2.id,
    versionNo: 2,
    actor: owner,
    publishedAt: "2026-07-17T17:10:00Z",
  });
  const baselineV1Snapshot = JSON.stringify(baselineV1);
  const diff = diffProjectBaselines(baselineV1, baselineV2);
  const changeRequest = createProjectChangeRequest({
    id: golden.scenario.changeRequestId,
    projectId: golden.projectId,
    fromBaselineId: baselineV1.id,
    proposedBaselineId: baselineV2.id,
    reason: scenario.change.reason,
    requestedBy: architect,
    requestedAt: "2026-07-17T17:05:00Z",
    deltaCostRub: scenario.change.deltaCostRub,
    deltaDays: scenario.change.deltaDays,
    status: "submitted",
  }, baselineV1, baselineV2);
  const changeSet = deriveExecutionChangeSet({
    id: "pilot-change-set-v2",
    request: changeRequest,
    diff,
    dependencies: golden.scenario.dependencies,
    maxDepth: scenario.change.maxDepth,
  });
  const reviewedChangeSet = applyExecutionImpactDispositions(
    changeSet,
    changeSet.impacts.map((impact, index) => ({
      impactKey: `${impact.rootRevisionId}->${impact.impactedRevisionId}`,
      disposition: scenario.change.dispositions[index]!,
      actor: architect,
      reviewedAt: `2026-07-17T17:1${index}:00Z`,
      reason: "Человек разобрал детерминированно найденное влияние.",
    })),
  );
  const rootV2 = buildProductionPackageVersion({
    id: scenario.artifacts.rootV2!,
    packageId: rootPackage.id,
    baseline: baselineV2,
    versionNo: 2,
    previousVersionId: rootV1.id,
    actor: owner,
    publishedAt: "2026-07-17T17:20:00Z",
  });
  const architectureV2 = buildProductionPackageVersion({
    id: scenario.artifacts.architectureV2!,
    packageId: architecturePackage.id,
    baseline: baselineV2,
    versionNo: 2,
    previousVersionId: architectureV1.id,
    exactRevisionRefs: {
      sources: includedSourceRevisionIds.slice(0, 6),
      requirements: [revisions.requirement.id],
      assumptions: [revisions.assumption.id],
      decisions: [revisions.decision.id],
      selections: [revisions.selectionV2.id],
    },
    actor: owner,
    publishedAt: "2026-07-17T17:22:00Z",
  });
  const rootReleaseV2 = buildReleaseDescriptor({
    productionPackage: rootV2,
    artifacts: [{ kind: "logical_json", contentHash: rootV2.semanticHash }],
  });
  const architectureReleaseV2 = buildReleaseDescriptor({
    productionPackage: architectureV2,
    artifacts: [{ kind: "logical_json", contentHash: architectureV2.semanticHash }],
  });
  const distribution = {
    id: scenario.distribution.id,
    artifactId: scenario.artifacts.architectureReleaseV2!,
    packageId: architecturePackage.id,
    productionPackageVersionId: architectureV2.id,
    recipientRole: scenario.distribution.recipientRole,
    semanticHash: architectureReleaseV2.semanticHash,
  } as const;
  const acknowledgement = {
    id: scenario.distribution.acknowledgementId,
    distributionId: distribution.id,
    packageId: distribution.packageId,
    productionPackageVersionId: distribution.productionPackageVersionId,
    semanticHash: distribution.semanticHash,
  } as const;

  const acceptedPhotoAreaIds = scenario.fieldClosure.milestones.flatMap(
    (milestone) => milestone.areaIds,
  );
  const incompleteClosureErrors = validateConstructionHandover({
    semanticHash: rootReleaseV2.semanticHash,
    acceptedAreaIds: scenario.fieldClosure.areas,
    acceptedPhotoAreaIds: acceptedPhotoAreaIds.slice(0, -1),
    warrantyArchiveObjectIds: scenario.fieldClosure.warrantyDocumentIds,
  });
  const closureErrors = validateConstructionHandover({
    semanticHash: rootReleaseV2.semanticHash,
    acceptedAreaIds: scenario.fieldClosure.areas,
    acceptedPhotoAreaIds,
    warrantyArchiveObjectIds: scenario.fieldClosure.warrantyDocumentIds,
  });

  return {
    contractVersion: "project-ceo-kora-pilot-evidence/0.1",
    project: {
      areaM2: 1800,
      model: "full_project",
      packageCount: golden.packages.length,
      workPackageCount: golden.packages.filter((item) => item.kind === "work_package").length,
    },
    sources: importPlan.summary,
    approval: {
      baselineV1Approval: approvalV1.status as "approved",
      baselineV2Approval: approvalV2.status as "approved",
      exactEvidenceBound: (
        revisions.assumption.evidence[0]?.sourceRevisionId
        === primarySource.sourceRevisionId
        && revisions.decision.evidence[0]?.sourceRevisionId
        === primarySource.sourceRevisionId
      ),
    },
    versions: {
      baselineV1Hash: baselineV1.semanticHash,
      baselineV2Hash: baselineV2.semanticHash,
      immutableV1: baselineV1Snapshot === JSON.stringify(baselineV1),
      rootReleaseV2Hash: rootReleaseV2.semanticHash,
      workPackageVersions: [architectureV1, engineeringV1, architectureV2].length,
    },
    delivery: {
      distributionId: distribution.id,
      acknowledgementId: acknowledgement.id,
      exactPackageVersionId: acknowledgement.productionPackageVersionId,
      exactSemanticHash: acknowledgement.semanticHash,
    },
    change: {
      deltaCostRub: changeRequest.deltaCostRub,
      deltaDays: changeRequest.deltaDays,
      boundedDepth: scenario.change.maxDepth,
      impactCount: changeSet.impacts.length,
      humanDispositionCount: reviewedChangeSet.dispositions.length,
    },
    noChange: {
      status: noChange.status,
      packageVersionId: noChange.productionPackageVersionId,
    },
    fieldClosure: {
      milestoneCount: scenario.fieldClosure.milestones.length,
      acceptedAreaCount: scenario.fieldClosure.areas.length,
      acceptedPhotoCount: scenario.fieldClosure.milestones.reduce(
        (sum, milestone) => sum + milestone.acceptedPhotoIds.length,
        0,
      ),
      warrantyDocumentCount: scenario.fieldClosure.warrantyDocumentIds.length,
      incompleteClosureRejected: incompleteClosureErrors.some((error) => (
        error.startsWith("accepted_photo_required:")
      )),
      handoverReady: closureErrors.length === 0,
    },
    isolation: {
      builderCannotPublish: !can("builder", "publish_release"),
      clientCannotDistribute: !can("client", "distribute_release"),
      guestCannotReviewSource: !can("guest", "review_source"),
      guestExactPackageAllowed: assertExactPackageScope({
        role: "guest",
        actorPackageId: architecturePackage.id,
        requestedPackageId: architecturePackage.id,
      }),
      guestSiblingPackageDenied: !assertExactPackageScope({
        role: "guest",
        actorPackageId: architecturePackage.id,
        requestedPackageId: engineeringPackage.id,
      }),
    },
    productionChanged: false,
  };
}

export function getKoraPilotScenarioFixture(): PilotScenario {
  return scenario;
}
