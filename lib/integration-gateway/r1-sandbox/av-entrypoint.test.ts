import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAvEntrypoint } from "./av-entrypoint";
import { AvOutputDecoder, encodeAvHeader } from "./av-protocol";
const fixture = vi.hoisted(() => ({ scratch: "", verify: vi.fn(), run: vi.fn() }));
vi.mock("../r1-worker/clamav-runtime-manifest", async importOriginal => {
  const original = await importOriginal<typeof import("../r1-worker/clamav-runtime-manifest")>();
  return { ...original, CLAMAV_IMAGE_PATHS: { ...original.CLAMAV_IMAGE_PATHS, get scratchDirectory() { return fixture.scratch; } }, verifyReadonlyClamAvRuntime: fixture.verify };
});
vi.mock("../r1-worker/clamav-process", () => ({ createReadonlyImageClamAvRunner: () => ({ run: fixture.run }) }));
const body = Buffer.from("synthetic protocol input"); const digest = "a".repeat(64);
const header = { byteLength: body.length, sourceSha256: createHash("sha256").update(body).digest("hex"), timeoutMs: 1000, nonce: "b".repeat(32) };
const stamp = Math.floor(Date.now() / 1000);
const evidence = { sourceSha256: header.sourceSha256, byteLength: body.length, runtimeManifestSha256: digest, executableSha256: digest,
  signatureBundleSha256: digest, engineVersion: "1.5.4", signatureVersion: 1, dailyTimestampSeconds: stamp, scannerPolicyVersion: "r1-clamav-policy/v1" };
beforeEach(async () => {
  fixture.scratch = await mkdtemp(join(tmpdir(), "r1-av-receiver-test-"));
  fixture.verify.mockResolvedValue({ manifestSha256: digest, manifest: { executable: { sha256: digest, version: "1.5.4" },
    signatureBundleSha256: digest, cvds: { "daily.cvd": { version: 1, timestampSeconds: stamp } } } });
  fixture.run.mockResolvedValue({ exitCode: 0, timedOut: false, evidence });
});
afterEach(async () => { vi.clearAllMocks(); vi.restoreAllMocks(); await rm(fixture.scratch, { recursive: true, force: true }); });
async function run(bytes = Buffer.concat([encodeAvHeader(header), body]), options: { signal?: AbortSignal; stdin?: Readable; stdout?: Writable } = {}) {
  const decoder = new AvOutputDecoder(); let output = "";
  const stdout = options.stdout ?? new Writable({ write(chunk, _encoding, callback) { decoder.push("stdout", chunk); output += chunk.toString(); setImmediate(callback); } });
  const stdin = options.stdin ?? Readable.from((function* () { for (let i = 0; i < bytes.length; i++) yield bytes.subarray(i, i + 1); })());
  const result = await runAvEntrypoint({ stdin, stdout, expectedManifestSha256: digest, remainingMs: 1000, signal: options.signal ?? new AbortController().signal });
  expect(await readdir(fixture.scratch)).toEqual([]);
  return { result, output, packet: decoder.finish({ ...header, runtimeManifestSha256: digest }) };
}
describe("AV receiver with mocked runtime/engine; no OS or AV proof", () => {
  it.each([0, 1])("measures real scratch FD and preserves engine outcome %s", async exitCode => {
    fixture.run.mockImplementation(async input => {
      expect(input.checksumHex).toBe(header.sourceSha256); expect(input.timeoutMs).toBeLessThanOrEqual(1000);
      const bytes = Buffer.alloc(body.length); await input.file.read(bytes, 0, bytes.length, 0); expect(bytes).toEqual(body);
      return { exitCode, timedOut: false, evidence };
    });
    expect((await run()).packet).toMatchObject({ kind: "av_result", outcome: exitCode === 0 ? "clean" : "infected" });
  });
  it.each([{ exitCode: 0, timedOut: false }])("does not infer clean from incomplete runner result %j", async result => {
    fixture.run.mockResolvedValue(result); expect((await run()).packet.kind).toBe("scan_failed");
  });
  it("keeps native exit 2 as an explicit scan failure", async () => {
    fixture.run.mockResolvedValue({ exitCode: 2, timedOut: false });
    expect((await run()).packet).toMatchObject({ kind: "scan_failed", reason: "scan_incomplete" });
  });
  it("emits no terminal when a short header scan times out inside a live outer budget", async () => {
    const controller = new AbortController();
    fixture.run.mockImplementation(async (input, signal) => {
      expect(input.timeoutMs).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(signal.aborted).toBe(false);
      return { exitCode: null, timedOut: true };
    });
    const result = await run(Buffer.concat([encodeAvHeader({ ...header, timeoutMs: 1 }), body]), { signal: controller.signal });
    expect(controller.signal.aborted).toBe(false);
    expect(result.result).toBe("no_result"); expect(result.packet.kind).toBe("no_result");
    expect(result.output.trim().split("\n").map(line => JSON.parse(line).kind)).toEqual(["ready"]);
  });
  it("emits no terminal when the measured pre-scan budget has expired before its timer fires", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(1001);
    const result = await run();
    expect(result.result).toBe("no_result"); expect(result.packet.kind).toBe("no_result");
    expect(result.output.trim().split("\n").map(line => JSON.parse(line).kind)).toEqual(["ready"]);
    expect(fixture.run).not.toHaveBeenCalled();
  });
  it.each(["short", "trailing", "hash"])("refuses %s input before invoking runner", async kind => {
    let bytes = Buffer.concat([encodeAvHeader(header), body]);
    if (kind === "short") bytes = bytes.subarray(0, -1);
    if (kind === "trailing") bytes = Buffer.concat([bytes, Buffer.from("x")]);
    if (kind === "hash") bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    expect((await run(bytes)).packet.kind).toBe("scan_failed"); expect(fixture.run).not.toHaveBeenCalled();
  });
  it("refuses runtime verification failure before ready/input/scan", async () => {
    fixture.verify.mockRejectedValue(new Error("private runtime diagnostic"));
    expect(await run()).toMatchObject({ result: "no_result", packet: { kind: "no_result" } }); expect(fixture.run).not.toHaveBeenCalled();
  });
  it("refuses uncorrelated evidence and cleans scratch", async () => {
    fixture.run.mockResolvedValue({ exitCode: 0, timedOut: false, evidence: { ...evidence, sourceSha256: digest } });
    expect((await run()).packet.kind).toBe("scan_failed");
  });
  it("aborts a stalled input without starting engine", async () => {
    const controller = new AbortController(); const stdin = new Readable({ read() {} });
    const pending = run(undefined, { signal: controller.signal, stdin }); setTimeout(() => controller.abort(), 20);
    expect((await pending).result).toBe("no_result"); expect(fixture.run).not.toHaveBeenCalled();
  });
  it("aborts blocked output/backpressure and does not emit a second terminal", async () => {
    const controller = new AbortController(); let writes = 0;
    const stdout = new Writable({ write(_chunk, _encoding, callback) { writes++; if (writes === 1) callback(); else setTimeout(() => controller.abort(), 10); } });
    expect((await run(undefined, { signal: controller.signal, stdout })).result).toBe("no_result"); expect(writes).toBe(2);
  });
});
