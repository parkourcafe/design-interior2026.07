import { describe, expect, it } from "vitest";
import { safeDashboardPath } from "./redirect";

describe("safeDashboardPath", () => {
  it("keeps dashboard destinations", () => {
    expect(safeDashboardPath("/dashboard")).toBe("/dashboard");
    expect(safeDashboardPath("/dashboard/projects/123?tab=brief")).toBe(
      "/dashboard/projects/123?tab=brief",
    );
  });

  it("rejects external and non-dashboard destinations", () => {
    expect(safeDashboardPath("//evil.example")).toBe("/dashboard");
    expect(safeDashboardPath("https://evil.example")).toBe("/dashboard");
    expect(safeDashboardPath("/api/health")).toBe("/dashboard");
    expect(safeDashboardPath(null)).toBe("/dashboard");
  });
});
