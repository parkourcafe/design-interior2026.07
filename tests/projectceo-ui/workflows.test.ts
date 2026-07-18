import { describe, expect, it } from "vitest";
import {
  createProjectCeoMockPort,
  KORA_PROJECT_ID,
} from "../../components/projectceo/mock";

describe("ProjectCEO RU pilot workflow projection", () => {
  it("maps all three paid pilot scopes and the second-project signal", async () => {
    const port = createProjectCeoMockPort("owner");
    const result = await port.getPortfolio({
      requestId: "paid-pilots",
    });

    expect(result.data?.organization.paidPilotScopeCount).toBe(3);
    expect(result.data?.projects).toHaveLength(3);
    expect(result.data?.projects.filter((project) => project.secondProjectSignal)).toHaveLength(2);
  });

  it("covers invitation and guest grant lifecycle states", async () => {
    const port = createProjectCeoMockPort("owner");
    const result = await port.getPortfolio({
      requestId: "access-lifecycle",
    });

    expect(result.data?.invitations.map((item) => item.status)).toEqual(
      expect.arrayContaining(["pending", "accepted", "revoked", "expired"]),
    );
    expect(result.data?.grants.map((item) => item.status)).toEqual(
      expect.arrayContaining(["active", "revoked", "expired"]),
    );
    expect(result.data?.grants.find((item) => item.status === "active")).toMatchObject({
      canAcknowledge: true,
    });
  });

  it("shows exact decision and selection revisions with evidence and checked price", async () => {
    const port = createProjectCeoMockPort("client");
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      requestId: "selection-flow",
    });
    const selection = result.data?.selections[0];

    expect(selection).toMatchObject({
      revisionNo: 2,
      revisionId: "selection-floor-finish-r2",
      decisionRevisionId: "decision-floor-finish-r2",
      reviewStatus: "submitted",
      priceObservation: {
        amountRub: 1_480_000,
        sourceCode: "SRC-087",
      },
    });
    expect(selection?.evidence[0]).toMatchObject({
      sourceCode: "SRC-014",
      sourceRevision: "source-revision-014",
    });
    expect(selection?.revisionHistory.map((revision) => revision.status)).toEqual([
      "current",
      "superseded",
    ]);
  });

  it("projects immutable replacement releases and a real change impact", async () => {
    const port = createProjectCeoMockPort("architect");
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      requestId: "release-change",
    });

    expect(result.data?.baseline).toMatchObject({
      versionNo: 2,
      status: "published",
      blockerCount: 0,
    });
    expect(result.data?.releases.map((release) => ({
      versionNo: release.versionNo,
      status: release.status,
    }))).toEqual([
      { versionNo: 2, status: "current" },
      { versionNo: 1, status: "superseded" },
    ]);
    expect(result.data?.releases.every((release) => release.semanticHash.startsWith("sha256:"))).toBe(true);
    expect(result.data?.changes[0]).toMatchObject({
      status: "impact_review",
      fromBaseline: "Baseline V1",
      toBaseline: "Baseline V2",
      deltaRub: 180_000,
      deltaDays: 2,
      impactCount: 3,
      reviewedImpactCount: 2,
    });
  });

  it("includes photo milestone evidence and handover readiness without inventing completion", async () => {
    const port = createProjectCeoMockPort("builder");
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      requestId: "field-handover",
    });

    expect(result.data?.milestones).toHaveLength(2);
    expect(result.data?.milestones.reduce((sum, item) => sum + item.photoCount, 0)).toBe(20);
    expect(result.data?.handover).toEqual({
      status: "not_ready",
      acceptedAreaCount: 1,
      totalAreaCount: 2,
      warrantyDocumentCount: 4,
      archiveHash: null,
    });
  });
});
