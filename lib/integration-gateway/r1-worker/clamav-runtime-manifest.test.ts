import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertCvdFreshness, assertReadonlyImageOs, assertVerifiedReadonlyClamAvRuntime, clamAvRuntimeManifestSchema, cvdBundleDigest, parseCvdDailyHeader, verifyReadonlyClamAvRuntime } from "./clamav-runtime-manifest";
const file = { sha256: "a".repeat(64), byteLength: 512 };
const cvds = { "main.cvd": file, "daily.cvd": { ...file, version: 1, timestampSeconds: 1_800_000_000 }, "bytecode.cvd": file };
const manifest = { schemaVersion: "r1-av-runtime-manifest/v1", protocolVersion: "r1-av-wire/v1", scannerPolicyVersion: "r1-clamav-policy/v1",
  buildReference: "fixture-only", licenseReference: "fixture-only", nodeVersion: "22.0.0", nodeExecutable: file, executable: { ...file, version: "1.5.4" }, entrypoint: file,
  libraries: [{ ...file, path: "/usr/lib/libc.so.6" }], cvds, signatureBundleSha256: cvdBundleDigest(cvds) };
const os = { platform: "linux", uid: 65532, gid: 65532, status: "CapEff:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t2\n",
  mountinfo: "1 0 0:1 / / ro - overlay overlay ro\n2 1 0:2 / /scratch rw,noexec,nosuid,nodev - tmpfs tmpfs rw",
  network: "Inter-| Receive\n face |bytes\n lo: 0" };
describe("AV manifest and OS policy (controlled fixtures, not OS/AV proof)", () => {
  it("preserves the ordered hex aggregate and rejects extra/self-referential metadata", () => {
    expect(cvdBundleDigest(cvds)).toBe(createHash("sha256").update(file.sha256.repeat(3)).digest("hex"));
    expect(clamAvRuntimeManifestSchema.parse(manifest)).toEqual(manifest);
    expect(clamAvRuntimeManifestSchema.safeParse({ ...manifest, imageSha256: file.sha256 }).success).toBe(false);
    expect(clamAvRuntimeManifestSchema.safeParse({ ...manifest, signatureBundleSha256: "b".repeat(64) }).success).toBe(false);
  });
  it.each(["/tmp/lib.so", "/usr/lib/../lib.so", "/usr/lib//lib.so"])("rejects unsafe library path %s", path => {
    expect(clamAvRuntimeManifestSchema.safeParse({ ...manifest, libraries: [{ ...file, path }] }).success).toBe(false);
  });
  it("requires libraries and rejects duplicates/missing runtime bytes", () => {
    for (const value of [{ ...manifest, libraries: [] }, { ...manifest, libraries: [...manifest.libraries, ...manifest.libraries] }, { ...manifest, nodeExecutable: undefined }]) expect(clamAvRuntimeManifestSchema.safeParse(value).success).toBe(false);
  });
  it("honors exact freshness horizon, future skew and safe timestamp arithmetic", () => {
    const stamp = cvds["daily.cvd"].timestampSeconds; const now = (stamp + 86400) * 1000 - 61000;
    expect(() => assertCvdFreshness(stamp, now, 1000)).not.toThrow();
    expect(() => assertCvdFreshness(stamp, now + 1, 1000)).toThrow();
    expect(() => assertCvdFreshness(stamp, stamp * 1000 - 300001, 1)).toThrow();
    expect(() => assertCvdFreshness(Number.MAX_SAFE_INTEGER, now, 1)).toThrow();
  });
  it("reads actual daily header fields without claiming cryptographic authentication", () => {
    const bytes = Buffer.from("ClamAV-VDB:fixture:123:1:90:hash:signature:fixture:1800000000".padEnd(512));
    expect(parseCvdDailyHeader(bytes)).toEqual({ version: 123, timestampSeconds: 1800000000 });
    expect(() => parseCvdDailyHeader(bytes.subarray(1))).toThrow();
  });
  it("accepts the controlled readonly OS shape but never mints a runtime proof from it", () => {
    expect(() => assertReadonlyImageOs(os, ["/opt/r1/bin/clamscan"])).not.toThrow();
    expect(() => assertVerifiedReadonlyClamAvRuntime({ manifest: clamAvRuntimeManifestSchema.parse(manifest), manifestSha256: file.sha256 })).toThrow("not_verified");
  });
  it.each([ { uid: 0 }, { platform: "darwin" }, { status: "CapEff: 1\nNoNewPrivs: 1\nSeccomp: 2" },
    { network: "a\nb\neth0: 0" }, { network: "" }, { mountinfo: os.mountinfo.replace("/ / ro", "/ / rw") },
    { mountinfo: os.mountinfo.replace("noexec,", "") },
    { mountinfo: os.mountinfo + "\n3 1 0:3 / /opt/r1 rw - tmpfs tmpfs rw" } ])("refuses missing/unsafe OS evidence %j", change => {
    expect(() => assertReadonlyImageOs({ ...os, ...change }, ["/opt/r1/bin/clamscan"])).toThrow();
  });
  it("actual verifier refuses unconfigured local host without leaking paths", async () => {
    await expect(verifyReadonlyClamAvRuntime("invalid", 1000, new AbortController().signal)).rejects.toThrow(/^av_runtime_unavailable$/);
  });
});
