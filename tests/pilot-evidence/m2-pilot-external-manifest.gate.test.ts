import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPilotManifest, validateExternalPilot } from "./m2-pilot-evidence-contract";

// Гейт цикла 7 проверяет контракт входного внешнего пакета. Полный runtime
// прогон выполняется отдельным disposable-only runner, а не unit-тестом.
const koraPath = "tests/fixtures/cycle7/kora-one-room-pilot.json";
const externalPath = process.env.ARCHIDOM_EXTERNAL_PILOT_MANIFEST
  ?? "tests/fixtures/cycle7/external-package.manifest.json";

describe("Cycle 7 external real package gate", () => {
  it("requires a supplied real external manifest and never manufactures one", () => {
    expect(existsSync(externalPath), `CYCLE7_EXTERNAL_MANIFEST_REQUIRED:${externalPath}`).toBe(true);
    const kora = readPilotManifest(koraPath);
    const external = readPilotManifest(externalPath);
    expect(() => validateExternalPilot(external, kora)).not.toThrow();
  });

  it("rejects an input manifest that is already completed", () => {
    const kora = readPilotManifest(koraPath);
    const external = readPilotManifest(externalPath);
    expect(() => validateExternalPilot({ ...external, status: "completed" }, kora))
      .toThrow("CYCLE7_EXTERNAL_MANIFEST_MUST_BE_PENDING");
  });

  it("keeps the tracked input manifest pending and never pre-completes it", () => {
    const manifest = readPilotManifest(externalPath);
    expect(manifest.status).toBe("pending");
    const runner = readFileSync("tests/pilot-evidence/run-m2-pilot-evidence.zsh", "utf8");
    expect(runner).not.toMatch(/external_manifest[\s\S]{0,240}completed/i);
    expect(runner).not.toMatch(/(?:sed|perl|jq|printf|writeFileSync|mv|cp)[^\n]*external_manifest[^\n]*completed/i);
  });
});
