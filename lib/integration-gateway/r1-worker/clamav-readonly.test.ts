import * as childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, open, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadonlyImageClamAvRunner } from "./clamav-process";
vi.mock("node:child_process", async importOriginal => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(original.spawn) };
});
const fixture = vi.hoisted(() => ({ root: "", verify: vi.fn(), assert: vi.fn() }));
vi.mock("./clamav-runtime-manifest", async importOriginal => {
  const original = await importOriginal<typeof import("./clamav-runtime-manifest")>();
  return { ...original, verifyReadonlyClamAvRuntime: fixture.verify, assertVerifiedReadonlyClamAvRuntime: fixture.assert,
    CLAMAV_IMAGE_PATHS: { ...original.CLAMAV_IMAGE_PATHS, get executable() { return join(fixture.root, "engine"); },
      get databaseDirectory() { return fixture.root; }, get scratchDirectory() { return fixture.root; } } };
});
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
let file: Awaited<ReturnType<typeof open>>;
let input: { file: typeof file; byteLength: number; checksumHex: string; timeoutMs: number };
beforeEach(async () => {
  fixture.root = await realpath(await mkdtemp(join(tmpdir(), "r1-readonly-runner-test-")));
  const script = `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>process.stdout.write('stdin: OK\\nKnown viruses: 1\\nEngine version: 1.5.4\\nScanned files: 1\\nInfected files: 0\\n'));\n`;
  await writeFile(join(fixture.root, "engine"), script); await chmod(join(fixture.root, "engine"), 0o500);
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const header = Buffer.from(`ClamAV-VDB:fixture:1:1:90:hash:signature:fixture:${timestampSeconds}`.padEnd(512));
  for (const name of ["main.cvd", "daily.cvd", "bytecode.cvd"]) await writeFile(join(fixture.root, name), header);
  fixture.verify.mockResolvedValue({ manifestSha256: "a".repeat(64), manifest: { executable: { sha256: sha(script), version: "1.5.4" },
    cvds: { "daily.cvd": { timestampSeconds } }, signatureBundleSha256: sha(sha(header).repeat(3)), scannerPolicyVersion: "r1-clamav-policy/v1" } });
  const bytes = Buffer.from("synthetic bytes"); await writeFile(join(fixture.root, "input"), bytes);
  file = await open(join(fixture.root, "input"), "r"); input = { file, byteLength: bytes.length, checksumHex: sha(bytes), timeoutMs: 3000 };
});
afterEach(async () => { vi.clearAllMocks(); await file.close(); await rm(fixture.root, { recursive: true, force: true }); });
describe("readonly runner seam with mocked OS verification and fake engine", () => {
  it("executes pinned runtime directly, retains rich evidence and leaves borrowed FD open", async () => {
    const original = await readFile(join(fixture.root, "engine"));
    const result = await createReadonlyImageClamAvRunner("a".repeat(64)).run(input, new AbortController().signal);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, evidence: { runtimeManifestSha256: "a".repeat(64), executableSha256: sha(original) } });
    expect(fixture.assert).toHaveBeenCalledOnce();
    expect(childProcess.spawn).toHaveBeenCalledWith(join(fixture.root, "engine"), expect.any(Array), expect.objectContaining({ shell: false })); expect(await file.stat()).toBeTruthy();
    expect((await readdir(fixture.root)).sort()).toEqual(["bytecode.cvd", "daily.cvd", "engine", "input", "main.cvd"]);
    expect(await readFile(join(fixture.root, "engine"))).toEqual(original);
  });
  it("never executes when runtime verification rejects", async () => {
    fixture.verify.mockRejectedValue(new Error("private path"));
    expect(await createReadonlyImageClamAvRunner("a".repeat(64)).run(input, new AbortController().signal)).toEqual({ exitCode: null, timedOut: false, reason: "readonly_runtime_unavailable" });
    expect(fixture.assert).not.toHaveBeenCalled();
  });
  it("refuses modified engine bytes after verification", async () => {
    await chmod(join(fixture.root, "engine"), 0o700); await writeFile(join(fixture.root, "engine"), "modified");
    expect((await createReadonlyImageClamAvRunner("a".repeat(64)).run(input, new AbortController().signal)).exitCode).toBeNull();
  });
});
