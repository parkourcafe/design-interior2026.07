import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");
const scannerPath = resolve(
  repoRoot,
  "tests/ap1/environment/scan-log-hygiene.mjs",
);
const runLocalPath = resolve(repoRoot, "tests/ap1/environment/run-local.zsh");
const bootstrapPath = resolve(
  repoRoot,
  "tests/ap1/environment/bootstrap-disposable.zsh",
);
const ap5SetupPath = resolve(repoRoot, "tests/ap5/global-setup.ts");
const ap5ReleaseWorkerPath = resolve(repoRoot, "tests/ap5/release-worker.ts");
const ap5ImpactWorkerPath = resolve(repoRoot, "tests/ap5/change-impact-worker.ts");

function scan(sample: string) {
  const dir = mkdtempSync(join(tmpdir(), "ap1-log-hygiene-"));
  const file = join(dir, "sample.log");
  writeFileSync(file, sample);
  return spawnSync(process.execPath, [scannerPath, file], {
    encoding: "utf8",
  });
}

describe("AP1/AP5 log hygiene", () => {
  it("detects credential-bearing diagnostics without echoing the value", () => {
    const fakeJwt = `eyJ${"a".repeat(16)}.eyJ${"b".repeat(16)}.${"c".repeat(24)}`;
    const result = scan([
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      "DB_URL=postgresql://postgres:s3cr3t-password@db.example.test:5432/postgres",
      `callback=/auth/callback?token_hash=${"a".repeat(43)}&type=magiclink`,
      `access_token=${fakeJwt}`,
      "session storage: {...}",
    ].join("\n"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LOG_HYGIENE_LEAK");
    expect(result.stderr).not.toContain("s3cr3t-password");
    expect(result.stderr).not.toContain(fakeJwt);
    expect(result.stderr).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("accepts redacted AP1/AP5 diagnostics", () => {
    const result = scan([
      "Authorization: Bearer [redacted]",
      "DB_URL=postgresql://[redacted]@db.example.test:5432/postgres",
      "access_token=[redacted]",
      "cookie: [redacted]",
      "[credential line redacted]",
    ].join("\n"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LOG_HYGIENE_OK");
  });

  it("keeps both disposable runners wired to bearer, URL and session redaction", () => {
    const scripts = [
      readFileSync(runLocalPath, "utf8"),
      readFileSync(bootstrapPath, "utf8"),
    ];
    for (const script of scripts) {
      expect(script).toContain("Bearer [redacted]");
      expect(script).toContain("session storage");
      expect(script).toContain("magic[-_ ]?link");
      expect(script).toContain("token_hash");
      expect(script).toContain("postgres");
      expect(script).not.toContain("s3cr3t-password");
    }
  });

  it("keeps AP5 browser and worker diagnostics structural", () => {
    const setup = readFileSync(ap5SetupPath, "utf8");
    const workers = [
      readFileSync(ap5ReleaseWorkerPath, "utf8"),
      readFileSync(ap5ImpactWorkerPath, "utf8"),
    ].join("\n");
    expect(setup).toContain("safePageDiagnostic");
    expect(setup).not.toMatch(/:\s*\$\{page\.url\(\)\}/);
    expect(setup).not.toContain("JSON.stringify(body)");
    expect(workers).toContain("stderrLines=");
    expect(workers).not.toMatch(/stdout:\s*\$\{|Вывод:\s*\$\{/);
  });
});
