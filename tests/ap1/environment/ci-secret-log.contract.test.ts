import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(__dirname, "../../../.github/workflows/ci.yml"), "utf8");
const repoRoot = resolve(__dirname, "../../..");
const receiptGate = resolve(repoRoot, "tests/ap5/assert-no-skips.mjs");

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

  it("runs AP5 unconditionally and fails when its JSON receipt is skipped", () => {
    expect(workflow).toContain("name: Require AP5 scope prerequisite");
    expect(workflow).toContain("if: ${{ !cancelled() }}");
    expect(workflow).toContain("PLAYWRIGHT_JSON_OUTPUT_FILE");
    expect(workflow).toContain("tests/ap5/assert-no-skips.mjs");
    expect(workflow).toContain("node tests/ap5/assert-no-skips.mjs \"${PLAYWRIGHT_JSON_OUTPUT_FILE}\"");
    expect(readFileSync(resolve(repoRoot, "playwright.config.ts"), "utf8"))
      .toContain("outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE");
    expect(workflow).not.toMatch(/ap5:\n[\s\S]*?if:\s*>-[\s\S]*?needs\.scope\.outputs\.m4_v1/);
  });

  it("rejects missing, empty, and malformed AP5 receipts", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "ap5-receipt-gate-"));
    for (const report of [{}, { stats: {} }, { stats: { expected: 0, skipped: 0 } }]) {
      const path = resolve(dir, `${Math.random()}.json`);
      writeFileSync(path, JSON.stringify(report));
      const result = spawnSync(process.execPath, [receiptGate, path], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("AP5_NO_SKIPS_FAILED");
    }
  });

  it("accepts a non-empty receipt only when no tests are skipped", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "ap5-receipt-gate-"));
    const path = resolve(dir, "receipt.json");
    writeFileSync(path, JSON.stringify({ stats: { expected: 27, skipped: 0 } }));
    const result = spawnSync(process.execPath, [receiptGate, path], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AP5_NO_SKIPS_OK skipped=0 passed=27");
  });

  it("scans runtime logs separately from the Playwright receipt", () => {
    const scanBlock = workflow.slice(
      workflow.indexOf("- name: Scan AP5 logs for credentials"),
      workflow.indexOf("- uses: actions/upload-artifact@v4", workflow.indexOf("- name: Scan AP5 logs for credentials")),
    );
    expect(scanBlock).toContain('"${RUNNER_TEMP}/app.log"');
    expect(scanBlock).toContain('"${RUNNER_TEMP}/ap5-output.log"');
    expect(scanBlock).not.toContain("${PLAYWRIGHT_JSON_OUTPUT_FILE}");
  });

  it("keeps hosted acceptance manual and bound to the disposable environment", () => {
    expect(workflow).toContain("hosted_staging:");
    expect(workflow).toContain("inputs.hosted_staging == true");
    expect(workflow).toContain("environment: disposable-staging");
    expect(workflow).toContain("EXPECTED_STAGING_REF: ukkzasfsmannjprfkaxp");
    expect(workflow).not.toContain("PRODUCTION_PROJECT_REF:");
    expect(workflow).toContain('const production = "ztnycrchwxqczqbyegnp";');
    expect(workflow).toContain("HOSTED_STAGING_PRODUCTION_REF_REJECTED");
    expect(workflow).not.toContain("PRODUCTION_SUPABASE_SERVICE_ROLE_KEY");
  });

  it("routes hosted credentials only through GitHub environment secrets", () => {
    expect(workflow).toContain("AP1_DB_URL: ${{ secrets.AP1_DB_URL }}");
    expect(workflow).toContain(
      "NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}",
    );
    expect(workflow).toContain(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}",
    );
    expect(workflow).toContain(
      "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}",
    );
    expect(workflow).toContain("without printing credentials");
  });

  it("applies migrations before exposing the exact disposable Data API schemas", () => {
    const dbOnly = workflow.indexOf(
      "bootstrap-disposable.zsh --target hosted --db-only",
    );
    const exposedSchemas = workflow.indexOf(
      "alter role authenticator set pgrst.db_schemas",
    );
    const runtime = workflow.indexOf(
      "bootstrap-disposable.zsh --target hosted",
      exposedSchemas + 1,
    );

    expect(dbOnly).toBeGreaterThan(-1);
    expect(exposedSchemas).toBeGreaterThan(dbOnly);
    expect(runtime).toBeGreaterThan(exposedSchemas);
    expect(workflow).toContain(
      "public, projectceo_api, projectceo_read_api, projectceo_product_api, projectceo_m3_api, projectceo_m4_api, projectceo_platform_api",
    );
    expect(workflow).toContain("notify pgrst, 'reload config'");
  });
});
