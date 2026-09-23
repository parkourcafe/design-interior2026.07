import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readPilotManifest, validateExternalPilot } from "./m2-pilot-evidence-contract";

// Shape-valid input is not completed cycle7. Runtime is separate, and this gate
// additionally requires its current-HEAD, full native-delivery receipt. This
// checks the published receipt claim, not independent authenticity of a file
// supplied by an operator; the protected runner/finalizer remains required.
const koraPath = "tests/fixtures/cycle7/kora-one-room-pilot.json";
const externalPath = process.env.ARCHIDOM_EXTERNAL_PILOT_MANIFEST
  ?? "tests/fixtures/cycle7/external-package.manifest.json";

describe("Cycle 7 external real package gate", () => {
  it("requires full native runtime evidence, not merely an operator-prepared manifest", () => {
    const receiptPath = process.env.ARCHIDOM_EXTERNAL_PILOT_RECEIPT;
    expect(Boolean(receiptPath) && existsSync(receiptPath!), "CYCLE7_NATIVE_RUNTIME_RECEIPT_REQUIRED").toBe(true);
    if (!receiptPath || !existsSync(receiptPath)) return;
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const manifestDigest = `sha256:${createHash("sha256").update(readFileSync(externalPath)).digest("hex")}`;
    expect(receipt.contractVersion).toBe("remhaos.wp32-runtime-receipt/1");
    expect(receipt.status).toBe("completed");
    expect(receipt.verdict).toBe("EXTERNAL_REAL_PACKAGE_PASS");
    expect(receipt.headSha).toBe(head);
    expect(receipt.manifestDigest).toBe(manifestDigest);
    expect(receipt.deliveryEvidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.gates).toMatchObject({ nativeM3FullDelivery: true, sourceContentVerified: true });
  });

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
