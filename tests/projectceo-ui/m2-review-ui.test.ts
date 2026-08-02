import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panel = readFileSync(
  resolve(process.cwd(), "components/projectceo/m2-workflow-panel.tsx"),
  "utf8",
);

describe("M2 approval review UI", () => {
  it("exposes all server-supported human review outcomes", () => {
    expect(panel).toContain('decision: "approved"');
    expect(panel).toContain('decision: "rejected"');
    expect(panel).toContain('decision: "change_requested"');
    expect(panel).toContain("humanReviewReject");
    expect(panel).toContain("humanReviewChangeRequest");
  });
});
