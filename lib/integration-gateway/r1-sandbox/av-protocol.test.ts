import { describe, expect, it } from "vitest";
import { AV_PROTOCOL, AvOutputDecoder, decodeAvHeader, encodeAvHeader, receiveAvInput } from "./av-protocol";
const header = { byteLength: 3, sourceSha256: "a".repeat(64), timeoutMs: 1000, nonce: "b".repeat(32) };
const manifest = "c".repeat(64);
const ready = { protocol: AV_PROTOCOL, kind: "ready", runtimeManifestSha256: manifest };
const failure = { ...ready, ...header, kind: "scan_failed", reason: "scan_incomplete" };
delete (failure as Partial<typeof failure>).timeoutMs;
const packets = (terminal: unknown = failure) => Buffer.from(`${JSON.stringify(ready)}\n${JSON.stringify(terminal)}\n`);
async function* chunks(data: Buffer, size = 1) { for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size); }
describe("AV wire protocol (no engine or OS evidence)", () => {
  it("uses exactly 68 bytes and decodes every one-byte fragment with awaited body writes", async () => {
    const wire = encodeAvHeader(header); expect(wire.length).toBe(68); expect(decodeAvHeader(wire)).toEqual(header);
    const received: number[] = []; let announced = false;
    expect(await receiveAvInput(chunks(Buffer.concat([wire, Buffer.from("abc")])), async h => { expect(h).toEqual(header); announced = true; },
      async body => { expect(announced).toBe(true); await Promise.resolve(); received.push(...body); }, new AbortController().signal)).toEqual(header);
    expect(Buffer.from(received).toString()).toBe("abc");
  });
  it.each([0n, 100_000_001n, 2n ** 64n - 1n])("rejects bigint length %s before numeric conversion", value => {
    const wire = encodeAvHeader(header); wire.writeBigUInt64BE(value, 8); expect(() => decodeAvHeader(wire)).toThrow();
  });
  it("rejects altered high-bit magic, timeout zero and unknown DTO fields", () => {
    const wire = encodeAvHeader(header); wire[0] = wire[0]! | 128; expect(() => decodeAvHeader(wire)).toThrow();
    const zero = encodeAvHeader(header); zero.writeUInt32BE(0, 48); expect(() => decodeAvHeader(zero)).toThrow();
    expect(() => encodeAvHeader({ ...header, path: "/tmp/source" } as typeof header)).toThrow();
  });
  it.each(["", "ab", "abcd"])("rejects incomplete/trailing body %s", async body => {
    await expect(receiveAvInput(chunks(Buffer.concat([encodeAvHeader(header), Buffer.from(body)])), async () => {}, async () => {}, new AbortController().signal)).rejects.toThrow();
  });
  it("rejects truncated header and oversized producer chunks", async () => {
    for (const bytes of [Buffer.alloc(67), Buffer.alloc(65537)]) await expect(receiveAvInput(chunks(bytes, bytes.length), async () => {}, async () => {}, new AbortController().signal)).rejects.toThrow();
  });
  it("checks cancellation before new body writes", async () => {
    const controller = new AbortController(); let writes = 0;
    await expect(receiveAvInput(chunks(Buffer.concat([encodeAvHeader(header), Buffer.from("abc")])), async () => controller.abort(), async () => { writes++; }, controller.signal)).rejects.toThrow();
    expect(writes).toBe(0);
  });
  it("preserves well-formed scan failure as distinct from no result", () => {
    const decoder = new AvOutputDecoder(); for (const byte of packets()) decoder.push("stdout", Buffer.from([byte]));
    expect(decoder.finish({ ...header, runtimeManifestSha256: manifest })).toEqual(failure);
  });
  it.each(["missing", "extra", "duplicate", "partial", "stderr", "overflow", "wrong_nonce", "unknown_key", "invalid_utf8"])("refuses %s output", mode => {
    const decoder = new AvOutputDecoder();
    let bytes = packets(mode === "wrong_nonce" ? { ...failure, nonce: "d".repeat(32) } : mode === "unknown_key" ? { ...failure, path: "/secret" } : failure);
    if (mode === "missing") bytes = Buffer.alloc(0);
    if (mode === "partial") bytes = bytes.subarray(0, -1);
    if (mode === "extra" || mode === "duplicate") bytes = Buffer.concat([bytes, Buffer.from(`${JSON.stringify(ready)}\n`)]);
    if (mode === "invalid_utf8") bytes[0] = 255;
    decoder.push("stdout", bytes);
    if (mode === "stderr") decoder.push("stderr", Buffer.from("diagnostic"));
    if (mode === "overflow") decoder.push("stdout", Buffer.alloc(65537));
    expect(decoder.finish({ ...header, runtimeManifestSha256: manifest }).kind).toBe("no_result");
  });
  it.each([0, 1] as const)("preserves correlated engine result %s without promoting it to accepted receipt", exit => {
    const evidence = { sourceSha256: header.sourceSha256, byteLength: header.byteLength, runtimeManifestSha256: manifest,
      engineVersion: "1.5.4", executableSha256: manifest, signatureBundleSha256: manifest, signatureVersion: 1,
      dailyTimestampSeconds: 1, scannerPolicyVersion: "r1-clamav-policy/v1" };
    const result = { ...failure, kind: "av_result", outcome: exit === 0 ? "clean" : "infected", nativeExitCode: exit, evidence };
    delete (result as Partial<typeof result>).reason;
    const decoder = new AvOutputDecoder(); decoder.push("stdout", packets(result)); expect(decoder.finish({ ...header, runtimeManifestSha256: manifest }).kind).toBe("av_result");
    const bad = new AvOutputDecoder(); bad.push("stdout", packets({ ...result, nativeExitCode: 1 - exit })); expect(bad.finish({ ...header, runtimeManifestSha256: manifest }).kind).toBe("no_result");
  });
});
