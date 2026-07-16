import { describe, expect, it } from "vitest";
import {
  assertExactPackageScope,
  can,
  capabilitiesForRole,
  visibleTabsForRole,
} from "../../components/projectceo/role-policy";
import { loadSanitizedRoleMatrixForTest } from "./role-harness";

describe("ProjectCEO role-scoped UI policy", () => {
  it("reserves project and access management for owner", () => {
    expect(can("owner", "manage_project")).toBe(true);
    expect(can("owner", "manage_access")).toBe(true);
    expect(can("architect", "manage_access")).toBe(false);
    expect(can("builder", "publish_release")).toBe(false);
    expect(can("client", "review_selection")).toBe(true);
  });

  it("never gives a guest source, member, audit or change controls", () => {
    expect(capabilitiesForRole("guest")).toEqual([
      "view_project",
      "acknowledge_release",
    ]);
    expect(visibleTabsForRole("guest")).toEqual([
      "overview",
      "releases",
    ]);
    expect(can("guest", "review_source")).toBe(false);
    expect(can("guest", "view_audit")).toBe(false);
    expect(can("guest", "create_change")).toBe(false);
  });

  it("shows participant views without owner-only administration", () => {
    expect(visibleTabsForRole("builder")).toEqual([
      "overview",
      "decisions",
      "baseline",
      "releases",
      "changes",
    ]);
    expect(visibleTabsForRole("client")).not.toContain("participants");
    expect(visibleTabsForRole("client")).not.toContain("history");
  });

  it("requires an exact package for guest scope", () => {
    expect(assertExactPackageScope({
      role: "guest",
      actorPackageId: "package-a",
      requestedPackageId: "package-a",
    })).toBe(true);
    expect(assertExactPackageScope({
      role: "guest",
      actorPackageId: "package-a",
      requestedPackageId: null,
    })).toBe(false);
    expect(assertExactPackageScope({
      role: "guest",
      actorPackageId: "package-a",
      requestedPackageId: "package-b",
    })).toBe(false);
    expect(assertExactPackageScope({
      role: "architect",
      actorPackageId: null,
      requestedPackageId: "package-b",
    })).toBe(true);
  });

  it("keeps the multi-role walkthrough in an explicit test-only harness", async () => {
    const matrix = await loadSanitizedRoleMatrixForTest();

    expect([...matrix.portfolios.keys()]).toEqual([
      "owner",
      "architect",
      "builder",
      "client",
      "guest",
    ]);
    expect(matrix.workspaces.get("owner")?.sources).toHaveLength(209);
    expect(matrix.workspaces.get("guest")?.sources).toEqual([]);
  });
});
