import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(__dirname, "../../../.github/workflows/ci.yml"), "utf8");

describe("AP1 CI credential log boundary", () => {
  it("does not place a reusable credential in job-level env", () => {
    expect(workflow).not.toMatch(/^\s+AP1_TEST_PASSWORD:/m);
    expect(workflow).not.toContain("ap5-local-only-password");
  });

  it("masks the per-run credential before exposing it to later steps", () => {
    const mask = workflow.indexOf('echo "::add-mask::${credential}"');
    const exportToEnv = workflow.indexOf("AP1_TEST_PASSWORD=%s");
    expect(mask).toBeGreaterThan(-1);
    expect(exportToEnv).toBeGreaterThan(mask);
  });

  it("never prints the credential while generating or exporting it", () => {
    const generationBlock = workflow.slice(
      workflow.indexOf("- name: Generate and mask disposable AP1 credential"),
      workflow.indexOf("- run: npm ci", workflow.indexOf("- name: Generate and mask disposable AP1 credential")),
    );
    const nonMaskLines = generationBlock
      .split("\n")
      .filter((line) => !line.includes("::add-mask::"))
      .join("\n");
    expect(nonMaskLines).not.toMatch(/echo\s+.*credential/);
    expect(generationBlock).toContain("printf 'AP1_TEST_PASSWORD=%s\\n'");
  });
});
