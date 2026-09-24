import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

// Shape-valid input is not completed cycle7. Runtime is separate, and this gate
// additionally requires its current-HEAD, full native-delivery receipt. This
// checks the published receipt claim, not independent authenticity of a file
// supplied by an operator; the protected runner/finalizer remains required.
const koraPath = "tests/fixtures/cycle7/kora-one-room-pilot.json";
const externalPath = process.env.ARCHIDOM_EXTERNAL_PILOT_MANIFEST
  ?? "tests/fixtures/cycle7/the-abian-source-manifest.json";

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
    const kora = JSON.parse(readFileSync(koraPath,"utf8"));
    const external = JSON.parse(readFileSync(externalPath,"utf8"));
    expect(external).toMatchObject({contractVersion:"remhaos.wp32-external-source-manifest/1",
      evidenceClass:"external_real_package_operator_verified",project:{name:"The Abian House",model:"full_project"}});
    expect(external.project.name).not.toBe(kora.project.name);
    expect(external.sources).toHaveLength(3);
    expect(new Set(external.sources.map((source:{sha256:string})=>source.sha256)).size).toBe(3);
  });

  it("keeps facts separate from the immutable runtime verdict", () => {
    const manifest = JSON.parse(readFileSync(externalPath,"utf8"));
    expect(manifest).not.toHaveProperty("status");
    expect(manifest).not.toHaveProperty("verdict");
    expect(JSON.stringify(manifest)).not.toMatch(/\/Users\/|file:\/\/|originalFilename|storagePath/i);
  });
});
