import { describe, expect, it } from "vitest";
import {
  createProjectCeoMockPort,
  KORA_ARCHITECTURE_PACKAGE_ID,
  KORA_PROJECT_ID,
} from "../../components/projectceo/mock";

describe("ProjectCEO deterministic pilot read port", () => {
  const port = createProjectCeoMockPort();

  it("represents Kora as one full 1,800 m² project with the frozen source counts", async () => {
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      role: "owner",
      packageId: null,
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
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      role: "owner",
      packageId: null,
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
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      role: "guest",
      packageId: KORA_ARCHITECTURE_PACKAGE_ID,
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
  });

  it("returns controlled errors for cross-project and scope leakage attempts", async () => {
    const missing = await port.getProjectWorkspace({
      projectId: "different-project",
      role: "owner",
      packageId: null,
      requestId: "cross-project",
    });
    const wrongPackage = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      role: "guest",
      packageId: "sibling-package",
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
    expect(wrongPackage).toMatchObject({
      data: null,
      error: {
        code: "scope_conflict",
        messageKey: "exact_package_scope_required",
        retryable: false,
      },
    });
    expect(JSON.stringify([missing, wrongPackage])).not.toMatch(/sql|token|email|relation/i);
  });
});
