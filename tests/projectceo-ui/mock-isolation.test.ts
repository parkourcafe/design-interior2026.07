import { describe, expect, it } from "vitest";
import {
  createProjectCeoMockPort,
  KORA_ARCHITECTURE_PACKAGE_ID,
  KORA_PROJECT_ID,
} from "../../components/projectceo/mock";

describe("ProjectCEO deterministic pilot read port", () => {
  it("represents Kora as one full 1,800 m² project with the frozen source counts", async () => {
    const port = createProjectCeoMockPort("owner");
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      requestId: "owner-kora",
    });

    expect(result.error).toBeNull();
    expect(result.data?.project).toMatchObject({
      name: "Kora Food Hall",
      areaM2: 1800,
      model: "full_project",
      packageCount: 5,
      sourceStats: {
        physicalRecords: 209,
        materializedRecords: 81,
        placeholders: 128,
        uniqueBlobs: 28,
        duplicateGroups: 18,
        quarantinedGroups: 8,
      },
    });
    expect(result.data?.sources).toHaveLength(209);
    expect(result.data?.sources.filter((source) => source.availability === "materialized")).toHaveLength(81);
    expect(result.data?.sources.filter((source) => source.availability === "placeholder")).toHaveLength(128);
  });

  it("does not expose original filenames, local paths or private relation details", async () => {
    const port = createProjectCeoMockPort("owner");
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      requestId: "safe-projection",
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/\/Users\//);
    expect(serialized).not.toMatch(/KORA_Construction/i);
    expect(serialized).not.toMatch(/Second Floor\.pdf/i);
    expect(serialized).not.toMatch(/private\.[a-z_]+/i);
    expect(serialized).not.toMatch(/service[_ -]?role/i);
    expect(serialized).not.toContain("supabase");
  });

  it("limits a guest to one exact current published package", async () => {
    const port = createProjectCeoMockPort("guest");
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      requestId: "guest-exact",
    });

    expect(result.error).toBeNull();
    expect(result.data?.packages).toHaveLength(1);
    expect(result.data?.packages[0]?.id).toBe(KORA_ARCHITECTURE_PACKAGE_ID);
    expect(result.data?.releases).toHaveLength(1);
    expect(result.data?.releases[0]?.status).toBe("current");
    expect(result.data?.sources).toEqual([]);
    expect(result.data?.participants).toEqual([]);
    expect(result.data?.invitations).toEqual([]);
    expect(result.data?.grants).toEqual([]);
    expect(result.data?.history).toEqual([]);
    expect(result.data?.project).toMatchObject({
      areaM2: 0,
      packageCount: 1,
      openChangeCount: 0,
      participantCount: 0,
      secondProjectSignal: false,
      sourceStats: {
        physicalRecords: 0,
        materializedRecords: 0,
        placeholders: 0,
        uniqueBlobs: 0,
        duplicateGroups: 0,
        quarantinedGroups: 0,
        reviewQueue: 0,
      },
    });
    expect(result.data?.handover).toEqual({
      status: "not_ready",
      acceptedAreaCount: 0,
      totalAreaCount: 0,
      warrantyDocumentCount: 0,
      archiveHash: null,
    });
  });

  it("keeps the guest portfolio exact-package scoped", async () => {
    const result = await createProjectCeoMockPort("guest").getPortfolio({
      requestId: "guest-portfolio",
    });
    expect(result.data?.projects).toHaveLength(1);
    expect(result.data?.projects[0]).toMatchObject({
      areaM2: 0,
      packageCount: 1,
      participantCount: 0,
      sourceStats: { physicalRecords: 0, materializedRecords: 0, placeholders: 0 },
    });
  });

  it("returns controlled errors for cross-project and scope leakage attempts", async () => {
    const port = createProjectCeoMockPort("owner");
    const missing = await port.getProjectWorkspace({
      projectId: "different-project",
      requestId: "cross-project",
    });
    const wrongPackage = await createProjectCeoMockPort("guest").getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      requestId: "cross-package",
    });

    expect(missing).toMatchObject({
      data: null,
      error: {
        code: "not_found",
        messageKey: "project_not_found",
        retryable: false,
      },
    });
    expect(wrongPackage.error).toBeNull();
    expect(wrongPackage.data?.actor.packageId).toBe(KORA_ARCHITECTURE_PACKAGE_ID);
    expect(JSON.stringify([missing, wrongPackage])).not.toMatch(/sql|token|email|relation/i);
  });
});
