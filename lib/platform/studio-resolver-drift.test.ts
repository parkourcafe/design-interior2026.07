import { describe, expect, it } from "vitest";
import { resolveStudioValueWithDrift } from "./studio-resolver";

describe("resolveStudioValueWithDrift", () => {
  it("preserves an approved project decision and reports drift when the referenced studio standard changes", () => {
    const approvedDecision = { approvalMode: "manual" };

    const result = resolveStudioValueWithDrift({
      approvedProjectDecision: approvedDecision,
      referencedStudioStandardVersionId: "studio-standard-v1",
      studioDefault: {
        value: { approvalMode: "automatic" },
        versionId: "studio-standard-v2",
      },
      platformDefault: { approvalMode: "platform" },
    });

    expect(result).toMatchObject({
      value: approvedDecision,
      source: "approved_project_decision",
      studioStandardVersionId: "studio-standard-v1",
      drift: {
        type: "standard_drift",
        previousStudioStandardVersionId: "studio-standard-v1",
        currentStudioStandardVersionId: "studio-standard-v2",
      },
    });
  });

  it("preserves a project override and reports drift from its pinned standard to the current standard", () => {
    const projectOverride = { approvalMode: "project-specific" };

    expect(
      resolveStudioValueWithDrift({
        projectOverride,
        referencedStudioStandardVersionId: "studio-standard-v1",
        studioDefault: {
          value: { approvalMode: "studio-current" },
          versionId: "studio-standard-v3",
        },
        platformDefault: { approvalMode: "platform" },
      }),
    ).toMatchObject({
      value: projectOverride,
      source: "project_override",
      studioStandardVersionId: "studio-standard-v1",
      drift: {
        type: "standard_drift",
        previousStudioStandardVersionId: "studio-standard-v1",
        currentStudioStandardVersionId: "studio-standard-v3",
      },
    });
  });

  it("does not report drift when a pinned decision already references the current standard", () => {
    expect(
      resolveStudioValueWithDrift({
        approvedProjectDecision: "approved",
        referencedStudioStandardVersionId: "studio-standard-v2",
        studioDefault: {
          value: "studio-current",
          versionId: "studio-standard-v2",
        },
        platformDefault: "platform",
      }),
    ).toMatchObject({
      studioStandardVersionId: "studio-standard-v2",
      drift: null,
    });
  });

  it("does not manufacture drift provenance for an unpinned studio or platform default", () => {
    expect(
      resolveStudioValueWithDrift({
        studioDefault: {
          value: "studio-current",
          versionId: "studio-standard-v2",
        },
        platformDefault: "platform",
      }),
    ).toMatchObject({
      source: "studio_default",
      studioStandardVersionId: "studio-standard-v2",
      drift: null,
    });

    expect(
      resolveStudioValueWithDrift({
        platformDefault: "platform",
      }),
    ).toMatchObject({
      source: "platform_default",
      studioStandardVersionId: null,
      drift: null,
    });
  });
});
