import { describe, expect, it } from "vitest";
import goldenJson from "@/fixtures/project-intelligence/kora/kora-project-brain-golden.json";
import scenarioJson from "@/fixtures/project-intelligence/kora/kora-pilot-scenario.json";
import {
  buildProductionPackageVersion,
  PackageContractError,
} from "@/lib/project-intelligence/modules/package";
import type { KoraProjectBrainGolden } from "@/lib/project-intelligence/modules/package/kora-golden";
import {
  getKoraPilotScenarioFixture,
  runKoraPilotScenario,
} from "./kora-pilot-harness";

const golden = goldenJson as KoraProjectBrainGolden;

describe("ProjectCEO Kora deterministic P0 pilot", () => {
  it("walks the full 1 800 m² flow through exact release, change and handover closure", () => {
    const evidence = runKoraPilotScenario();
    const scenario = getKoraPilotScenarioFixture();

    expect(evidence.project).toEqual({
      areaM2: 1800,
      model: "full_project",
      packageCount: 5,
      workPackageCount: scenario.expected.workPackages,
    });
    expect(evidence.sources.physicalRecords).toBe(scenario.expected.physicalRecords);
    expect(evidence.sources.materializedRecords).toBe(scenario.expected.materializedRecords);
    expect(evidence.sources.placeholders).toBe(scenario.expected.placeholders);
    expect(evidence.approval).toEqual({
      baselineV1Approval: "approved",
      baselineV2Approval: "approved",
      exactEvidenceBound: true,
    });
    expect(evidence.versions.baselineV1Hash).toBe(scenario.expected.baselineV1Hash);
    expect(evidence.versions.baselineV2Hash).toBe(scenario.expected.baselineV2Hash);
    expect(evidence.versions.rootReleaseV2Hash).toBe(scenario.expected.rootReleaseV2Hash);
    expect(evidence.versions.immutableV1).toBe(true);
    expect(evidence.delivery.exactPackageVersionId).toBe(
      scenario.artifacts.architectureV2,
    );
    expect(evidence.delivery.exactSemanticHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evidence.change).toEqual({
      deltaCostRub: 180_000,
      deltaDays: 2,
      boundedDepth: 3,
      impactCount: scenario.expected.impactCount,
      humanDispositionCount: scenario.expected.impactCount,
    });
    expect(evidence.noChange).toEqual({
      status: "approved_no_change",
      packageVersionId: scenario.artifacts.engineeringV1,
    });
    expect(evidence.fieldClosure).toEqual({
      milestoneCount: 2,
      acceptedAreaCount: 3,
      acceptedPhotoCount: 3,
      warrantyDocumentCount: 1,
      incompleteClosureRejected: true,
      handoverReady: true,
    });
    expect(evidence.isolation).toEqual({
      builderCannotPublish: true,
      clientCannotDistribute: true,
      guestCannotReviewSource: true,
      guestExactPackageAllowed: true,
      guestSiblingPackageDenied: true,
    });
    expect(evidence.productionChanged).toBe(false);
  });

  it("is deterministic on replay and contains no local Kora paths or source filenames", () => {
    expect(runKoraPilotScenario()).toEqual(runKoraPilotScenario());
    const serialized = JSON.stringify({
      scenario: scenarioJson,
      evidence: runKoraPilotScenario(),
    });
    expect(serialized).not.toMatch(
      /\/Users\/|file:\/\/|[A-Z]:\\|KORA_[A-Z]|(?:^|["/])\d{2} [A-Z][^"/]+/,
    );
  });

  it("rejects a work package revision outside the published baseline", () => {
    const owner = { actorId: "pilot-owner", actorType: "human" } as const;
    const scenario = getKoraPilotScenarioFixture();
    const rootPackage = golden.packages.find((item) => item.kind === "project_root")!;
    const architecturePackage = golden.packages.find(
      (item) => item.stableKey === "architecture-release",
    )!;

    // The positive scenario already proves the exact baseline/package chain. This
    // deliberately altered reconstruction exercises the package subset guard.
    const evidence = runKoraPilotScenario();
    expect(evidence.versions.baselineV2Hash).toBe(scenario.expected.baselineV2Hash);
    expect(() => buildProductionPackageVersion({
      id: "pilot-cross-package-invalid",
      packageId: architecturePackage.id,
      baseline: {
        id: golden.scenario.baselineV2.id,
        organizationId: golden.organizationId,
        projectId: golden.projectId,
        versionNo: 2,
        previousBaselineId: golden.scenario.baselineV1.id,
        status: "published",
        semanticContent: {
          schemaVersion: "project-ceo-baseline/0.1",
          organizationId: golden.organizationId,
          projectId: golden.projectId,
          previousBaselineId: golden.scenario.baselineV1.id,
          packages: golden.packages.map((item) => ({
            id: item.id,
            parentPackageId: item.parentPackageId,
            kind: item.kind,
            stableKey: item.stableKey,
          })),
          packageIds: golden.packages.map((item) => item.id),
          sourceRevisionIds: ["source-revision-in-baseline"],
          requirementRevisionIds: ["requirement-in-baseline"],
          assumptionRevisionIds: [],
          decisionRevisionIds: [],
          selectionRevisionIds: [],
          approvalPackageIds: ["approval-in-baseline"],
        },
        semanticHash: scenario.expected.baselineV2Hash,
        publishedAt: "2026-07-17T17:10:00Z",
        publishedBy: owner,
      },
      versionNo: 2,
      previousVersionId: rootPackage.id,
      exactRevisionRefs: {
        sources: ["source-revision-from-sibling-package"],
        requirements: [],
        assumptions: [],
        decisions: [],
        selections: [],
      },
      actor: owner,
      publishedAt: "2026-07-17T17:22:00Z",
    })).toThrowError(PackageContractError);
  });
});
