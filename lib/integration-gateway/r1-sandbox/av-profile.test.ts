import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AV_PROFILE, SYNTHETIC_SMALL, createArguments, expectedAvConfigDigest, expectedConfigDigest, intentProfile, type SandboxIntent, type AvIntentMetadata } from "./profile";
import { assertHostAdmission } from "./admission";
import { SandboxRegistry } from "./registry";
const imageId = `sha256:${"a".repeat(64)}`;
const av: AvIntentMetadata = { version: "r1-av-config/v1", profileId: "clamav-v1", protocol: "r1-av-wire/v1", manifestSha256: "b".repeat(64), architecture: "arm64", receiverBudgetMs: 10000, jobBindingSha256: "c".repeat(64) };
function intent(): SandboxIntent { const operationId = randomUUID(); return { operationId, nonce: "d".repeat(32), fence: 1, daemonId: "fixture", bootId: "fixture", imageId, name: `r1-sandbox-${operationId}`,
  configDigest: expectedAvConfigDigest(imageId, av), mode: "av", av, createdAt: Date.now(), deadline: Date.now() + 10000 }; }
describe("versioned AV profile and historical journal compatibility", () => {
  it("keeps the historical synthetic digest byte preimage and uses a separate AV envelope", () => {
    expect(expectedConfigDigest(imageId, "observe")).toBe(createHash("sha256").update(JSON.stringify({ imageId, mode: "observe", profile: SYNTHETIC_SMALL, readonlyRoot: true })).digest("hex"));
    expect(intentProfile({ mode: "observe" })).toBe(SYNTHETIC_SMALL);
    const args = createArguments(intent()); expect(args).toContain(`--memory=${AV_PROFILE.memoryBytes}`); expect(args).toContain("--read-only");
    expect(args).toContain("--entrypoint=/opt/r1/bin/node"); expect(args).not.toContain("/opt/r1/probe.mjs");
  });
  it.each([{ mode: "av" }, { mode: "future" }, { mode: "observe", av }, { mode: "av", av: { ...av, profileId: "synthetic-small-v1" } },
    { mode: "av", av: { ...av, version: "future" } }, { mode: "av", av: { ...av, readonly: false } }])("rejects unknown/mixed profile %j", value => {
    expect(() => intentProfile(value as SandboxIntent)).toThrow();
  });
  it("charges AV scratch inside hard RAM without double counting and handles owned usage", () => {
    const GiB = 1024 ** 3;
    const host = { daemonId: "fixture", bootId: "fixture", at: 1000, totalBytes: 8 * GiB, availableBytes: 5 * GiB, serviceEnvelopes: [] };
    expect(() => assertHostAdmission(host, 1000, undefined, AV_PROFILE.id)).not.toThrow();
    expect(() => assertHostAdmission({ ...host, availableBytes: 5 * GiB - 1 }, 1000, undefined, AV_PROFILE.id)).toThrow();
    expect(() => assertHostAdmission({ ...host, availableBytes: 3 * GiB, serviceEnvelopes: [{ id: "owned", limit: 3 * GiB, used: 2 * GiB }] }, 1000, "owned", AV_PROFILE.id)).not.toThrow();
    expect(() => assertHostAdmission(host, 1000, undefined, "unknown")).toThrow();
  });
  it("persists AV metadata across reopen and cannot rewind create dispatch into measurement", async () => {
    const root = await mkdtemp(join(tmpdir(), "r1-av-profile-test-")); const path = join(root, "registry.sqlite"); const registry = new SandboxRegistry(path);
    let second: SandboxRegistry | undefined;
    try {
      const first = await registry.admit(intent(), async () => {}); expect(first.state).toBe("measuring");
      second = new SandboxRegistry(path); expect(second.read(first.operationId)?.av).toEqual(av);
      const dispatched = registry.cas(first, { state: "create_inflight" });
      expect(() => registry.cas(dispatched, { state: "measuring" })).toThrow("sandbox_create_boundary_immutable");
      expect(second.live("fixture")).toHaveLength(1);
    } finally { second?.close(); registry.close(); await rm(root, { recursive: true, force: true }); }
  });
});
