import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertVerifiedReadonlyClamAvRuntime, CLAMAV_IMAGE_PATHS, cvdBundleDigest, verifyReadonlyClamAvRuntime } from "./clamav-runtime-manifest";
const mapped = vi.hoisted(() => new Map<string, string>());
vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn((path, ...args) => original.open(mapped.get(String(path)) ?? path, ...args)),
    realpath: vi.fn((path, ...args) => String(path) === process.execPath ? Promise.resolve("/opt/r1/bin/node") : mapped.has(String(path)) ? Promise.resolve(String(path)) : original.realpath(path, ...args)) };
});
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
let root: string; let manifestSha: string;
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
async function put(path: string, bytes: Buffer | string) {
  const file = mapped.get(path) ?? join(root, String(mapped.size)); mapped.set(path, file); await writeFile(file, bytes);
  return { sha256: sha(bytes), byteLength: Buffer.byteLength(bytes) };
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "r1-av-manifest-test-"));
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  vi.spyOn(process, "getuid").mockReturnValue(65532); vi.spyOn(process, "getgid").mockReturnValue(65532);
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const header = `ClamAV-VDB:fixture:7:1:90:hash:signature:fixture:${timestampSeconds}`.padEnd(512);
  const cvds = { "main.cvd": await put("/opt/r1/cvd/main.cvd", header),
    "daily.cvd": { ...await put("/opt/r1/cvd/daily.cvd", header), version: 7, timestampSeconds },
    "bytecode.cvd": await put("/opt/r1/cvd/bytecode.cvd", header) };
  const manifest = { schemaVersion: "r1-av-runtime-manifest/v1", protocolVersion: "r1-av-wire/v1", scannerPolicyVersion: "r1-clamav-policy/v1",
    buildReference: "controlled-fixture", licenseReference: "controlled-fixture", nodeVersion: process.versions.node,
    nodeExecutable: await put(CLAMAV_IMAGE_PATHS.nodeExecutable, "fake-node"), executable: { ...await put(CLAMAV_IMAGE_PATHS.executable, "fake-engine"), version: "1.5.4" },
    entrypoint: await put(CLAMAV_IMAGE_PATHS.entrypoint, "fake-entrypoint"), libraries: [{ ...await put("/usr/lib/libfixture.so", "fake-library"), path: "/usr/lib/libfixture.so" }],
    cvds, signatureBundleSha256: cvdBundleDigest(cvds) };
  manifestSha = (await put(CLAMAV_IMAGE_PATHS.manifest, JSON.stringify(manifest))).sha256;
  await put("/proc/self/status", "CapEff: 0000000000000000\nNoNewPrivs: 1\nSeccomp: 2\n");
  await put("/proc/self/mountinfo", "1 0 0:1 / / ro - overlay overlay ro\n2 1 0:2 / /scratch rw,noexec,nosuid,nodev - tmpfs tmpfs rw");
  await put("/proc/net/dev", "Inter-| Receive\n face |bytes\n lo: 0");
});
afterEach(async () => { Object.defineProperty(process, "platform", platform); vi.restoreAllMocks(); mapped.clear(); await rm(root, { recursive: true, force: true }); });
describe("runtime verifier actual file reads with controlled OS/path mapping, not image proof", () => {
  it("checks exact fixture bytes and recursively freezes the verified record", async () => {
    const runtime = await verifyReadonlyClamAvRuntime(manifestSha, 1000, new AbortController().signal);
    expect(() => assertVerifiedReadonlyClamAvRuntime(runtime)).not.toThrow();
    expect(Object.isFrozen(runtime.manifest.cvds["daily.cvd"])).toBe(true);
    expect(Object.isFrozen(runtime.manifest.libraries)).toBe(true);
  });
  it.each([CLAMAV_IMAGE_PATHS.nodeExecutable, CLAMAV_IMAGE_PATHS.executable, CLAMAV_IMAGE_PATHS.entrypoint,
    "/usr/lib/libfixture.so", "/opt/r1/cvd/main.cvd", "/opt/r1/cvd/daily.cvd", "/opt/r1/cvd/bytecode.cvd", CLAMAV_IMAGE_PATHS.manifest])("refuses changed bytes at %s", async path => {
    await writeFile(mapped.get(path)!, "changed");
    await expect(verifyReadonlyClamAvRuntime(manifestSha, 1000, new AbortController().signal)).rejects.toThrow(/^av_runtime_unavailable$/);
  });
  it("refuses cancellation without minting verification", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(verifyReadonlyClamAvRuntime(manifestSha, 1000, controller.signal)).rejects.toThrow(/^av_runtime_aborted$/);
  });
});
