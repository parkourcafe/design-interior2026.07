import { describe, expect, it } from "vitest";
import { resolveGuestGraphVersion } from "./guest-release-binding";

const workspace = {
  error: null,
  data: {
    latestBaseline: { id: "baseline-a", graphVersionId: "graph-a" },
    packageVersions: [{ id: "production-a", packageId: "package-a", baselineId: "baseline-a" }],
  },
};

describe("guest release graph binding", () => {
  it("returns the graph version linked to the exact production release", () => {
    expect(resolveGuestGraphVersion(workspace, "package-a", "production-a")).toBe("graph-a");
  });
  it.each([["package-b", "production-a"], ["package-a", "production-b"]])(
    "rejects a different package or release (%s, %s)", (packageId, versionId) => {
      expect(() => resolveGuestGraphVersion(workspace, packageId, versionId)).toThrow("BINDING_MISSING");
    },
  );
  it("rejects latest baseline drift rather than granting access to unrelated graph bytes", () => {
    const changed = { data: { ...workspace.data, latestBaseline: { id: "baseline-b", graphVersionId: "graph-b" } } };
    expect(() => resolveGuestGraphVersion(changed, "package-a", "production-a")).toThrow("BINDING_MISSING");
  });
  it.each([null, {}, { error: { code: "forbidden" }, data: workspace.data }])("rejects invalid reads", (read) => {
    expect(() => resolveGuestGraphVersion(read, "package-a", "production-a")).toThrow("BINDING_MISSING");
  });
});
