import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPilotManifest, validateExternalPilot } from "./m2-pilot-evidence-contract";

// Гейт цикла 7. Запускается ТОЛЬКО через `npm run test:cycle7` и намеренно
// красный, пока не предоставлен внешний реальный пакет. Вынесен из
// `npm run test`, чтобы постоянно красный CI не перестали читать — но не
// ослаблен: заявлять завершённость M2 P0 можно только когда зелёный он.
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
});
