import { describe, expect, it } from "vitest";
import { resolveStudioValue } from "./studio-resolver";

describe("studio resolver precedence", () => {
  const base = { studioDefault: { value: "studio", versionId: "v2" }, platformDefault: "platform" };

  it("uses approved decision before all defaults", () => {
    expect(
      resolveStudioValue({
        ...base,
        approvedProjectDecision: "approved",
        projectOverride: "override",
      }),
    ).toMatchObject({
      value: "approved",
      source: "approved_project_decision",
    });
  });

  it("uses project override before studio default", () => {
    expect(resolveStudioValue({ ...base, projectOverride: "override" })).toMatchObject({
      value: "override",
      source: "project_override",
    });
  });

  it.each([
    {
      selectedValue: { approvedProjectDecision: "approved" },
      expectedSource: "approved_project_decision",
    },
    {
      selectedValue: { projectOverride: "override" },
      expectedSource: "project_override",
    },
  ] as const)(
    "keeps the pinned studio standard provenance for $expectedSource instead of substituting the current standard",
    ({ selectedValue, expectedSource }) => {
      expect(
        resolveStudioValue({
          ...base,
          ...selectedValue,
          referencedStudioStandardVersionId: "v1",
        }),
      ).toMatchObject({
        source: expectedSource,
        studioStandardVersionId: "v1",
      });
    },
  );

  it("keeps the studio standard version reference", () => {
    expect(resolveStudioValue(base).studioStandardVersionId).toBe("v2");
  });

  it("falls back to platform default", () => {
    expect(resolveStudioValue({ platformDefault: "platform" }).source).toBe("platform_default");
  });
});
