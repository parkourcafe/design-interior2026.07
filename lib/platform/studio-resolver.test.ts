import { describe, expect, it } from "vitest";
import { resolveStudioValue } from "./studio-resolver";

describe("studio resolver precedence", () => {
  const base = { studioDefault: { value: "studio", versionId: "v2" }, platformDefault: "platform" };
  it("uses approved decision before all defaults", () => {
    expect(resolveStudioValue({ ...base, approvedProjectDecision: "approved", projectOverride: "override" }).value).toBe("approved");
  });
  it("uses project override before studio default", () => {
    expect(resolveStudioValue({ ...base, projectOverride: "override" }).source).toBe("project_override");
  });
  it("keeps the studio standard version reference", () => {
    expect(resolveStudioValue(base).studioStandardVersionId).toBe("v2");
  });
  it("falls back to platform default", () => {
    expect(resolveStudioValue({ platformDefault: "platform" }).source).toBe("platform_default");
  });
});

