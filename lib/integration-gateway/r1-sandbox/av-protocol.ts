import { z } from "zod";

export const AV_PROTOCOL = "r1-av-wire/v1";
export const AV_HEADER_BYTES = 68;
export const AV_CHUNK_BYTES = 65_536;
export const AV_OUTPUT_BYTES = 65_536;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonce = z.string().regex(/^[a-f0-9]{32}$/);
const length = z.number().int().min(1).max(100_000_000);
export const avHeaderSchema = z.object({ byteLength: length, sourceSha256: sha256,
  timeoutMs: z.number().int().min(1).max(300_000), nonce }).strict();
export type AvHeader = z.infer<typeof avHeaderSchema>;
export function encodeAvHeader(value: AvHeader): Buffer {
  const header = avHeaderSchema.parse(value); const bytes = Buffer.alloc(AV_HEADER_BYTES);
  bytes.write("R1AV0001", 0, "ascii"); bytes.writeBigUInt64BE(BigInt(header.byteLength), 8);
  Buffer.from(header.sourceSha256, "hex").copy(bytes, 16); bytes.writeUInt32BE(header.timeoutMs, 48);
  Buffer.from(header.nonce, "hex").copy(bytes, 52); return bytes;
}
export function decodeAvHeader(bytes: Uint8Array): AvHeader {
  const buffer = Buffer.from(bytes);
  if (buffer.length !== AV_HEADER_BYTES || !buffer.subarray(0, 8).equals(Buffer.from("R1AV0001"))) throw new Error("av_header_invalid");
  const byteLength = buffer.readBigUInt64BE(8);
  if (byteLength < 1n || byteLength > 100_000_000n) throw new Error("av_header_invalid");
  return avHeaderSchema.parse({ byteLength: Number(byteLength), sourceSha256: buffer.subarray(16, 48).toString("hex"),
    timeoutMs: buffer.readUInt32BE(48), nonce: buffer.subarray(52).toString("hex") });
}
const common = { protocol: z.literal(AV_PROTOCOL), runtimeManifestSha256: sha256 };
export const avReadySchema = z.object({ ...common, kind: z.literal("ready") }).strict();
const binding = { ...common, nonce, sourceSha256: sha256, byteLength: length };
export const avEvidenceSchema = z.object({ engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  signatureVersion: z.number().int().positive().safe(), signatureBundleSha256: sha256,
  sourceSha256: sha256, byteLength: length, runtimeManifestSha256: sha256, executableSha256: sha256,
  dailyTimestampSeconds: z.number().int().positive().safe(), scannerPolicyVersion: z.literal("r1-clamav-policy/v1") }).strict();
export const avTerminalSchema = z.discriminatedUnion("kind", [
  z.object({ ...binding, kind: z.literal("av_result"), outcome: z.enum(["clean", "infected"]), nativeExitCode: z.union([z.literal(0), z.literal(1)]), evidence: avEvidenceSchema }).strict(),
  z.object({ ...binding, kind: z.literal("scan_failed"), reason: z.enum(["input_invalid", "scan_incomplete", "deadline", "receiver_failed"]) }).strict(),
]);
export type AvReady = z.infer<typeof avReadySchema>;
export type AvTerminal = z.infer<typeof avTerminalSchema>;
export type AvPacketObservation = AvTerminal | { kind: "no_result"; reason: "invalid_protocol" };

/** Bounded packet observation only. Packet C must independently enforce daemon
 * exit/OOM, lease, freshness and timely cleanup before accepting any AV fact. */
export class AvOutputDecoder {
  private bytes = 0;
  private chunks: Buffer[] = [];
  private invalid = false;
  push(channel: "stdout" | "stderr", chunk: Uint8Array): void {
    if (this.invalid || chunk.byteLength === 0) return;
    this.bytes += chunk.byteLength;
    if (this.bytes > AV_OUTPUT_BYTES || (channel === "stderr" && chunk.byteLength > 0)) {
      this.invalid = true; this.chunks = []; return;
    }
    this.chunks.push(Buffer.from(chunk));
  }
  finish(expected: AvHeader & { runtimeManifestSha256: string }): AvPacketObservation {
    try {
      if (this.invalid) throw new Error();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(this.chunks));
      const lines = text.split("\n");
      if (lines.length !== 3 || lines[2] !== "") throw new Error();
      const ready = avReadySchema.parse(JSON.parse(lines[0]!)); const terminal = avTerminalSchema.parse(JSON.parse(lines[1]!));
      if (ready.runtimeManifestSha256 !== expected.runtimeManifestSha256 || terminal.runtimeManifestSha256 !== expected.runtimeManifestSha256
        || terminal.nonce !== expected.nonce || terminal.sourceSha256 !== expected.sourceSha256 || terminal.byteLength !== expected.byteLength) throw new Error();
      if (terminal.kind === "av_result" && (terminal.nativeExitCode !== (terminal.outcome === "clean" ? 0 : 1)
        || terminal.evidence.sourceSha256 !== expected.sourceSha256 || terminal.evidence.byteLength !== expected.byteLength
        || terminal.evidence.runtimeManifestSha256 !== expected.runtimeManifestSha256)) throw new Error();
      return terminal;
    } catch { return { kind: "no_result", reason: "invalid_protocol" }; }
  }
}

/** Incremental ingress; retains only the fixed header and the producer's current
 * bounded chunk. The caller supplies abortable I/O and awaits each body write. */
export async function receiveAvInput(input: AsyncIterable<Uint8Array>, onHeader: (header: AvHeader) => Promise<void>,
  writeBody: (chunk: Uint8Array) => Promise<void>, signal: AbortSignal): Promise<AvHeader> {
  const bytes = Buffer.alloc(AV_HEADER_BYTES); let headerBytes = 0; let bodyBytes = 0; let header: AvHeader | undefined;
  for await (const chunk of input) {
    signal.throwIfAborted();
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > AV_CHUNK_BYTES) throw new Error("av_input_invalid");
    let offset = 0;
    if (!header) {
      const count = Math.min(chunk.length, AV_HEADER_BYTES - headerBytes);
      bytes.set(chunk.subarray(0, count), headerBytes); headerBytes += count; offset += count;
      if (headerBytes === AV_HEADER_BYTES) { header = decodeAvHeader(bytes); await onHeader(header); }
    }
    if (header && offset < chunk.length) {
      const body = chunk.subarray(offset);
      if (bodyBytes + body.length > header.byteLength) throw new Error("av_input_invalid");
      signal.throwIfAborted(); await writeBody(body); bodyBytes += body.length;
    }
  }
  signal.throwIfAborted();
  if (!header || bodyBytes !== header.byteLength) throw new Error("av_input_invalid");
  return header;
}
