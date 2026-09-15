import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import type { ExternalByteMeasurement } from "./adapters";
import { R1_UPLOAD_FORMATS, r1UploadFormatPolicy } from "./formats";

const chunkBytes = 65_536;
const maxBytes = Math.max(...R1_UPLOAD_FORMATS.map(format => r1UploadFormatPolicy(format).maxBytes));
type FailureReason = "pinned_measurement_invalid" | "pinned_measurement_changed" | "pinned_measurement_aborted" | "pinned_measurement_failed";

function unchanged(before: BigIntStats, after: BigIntStats): boolean {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino
    && before.mode === after.mode && before.nlink === after.nlink && before.size === after.size
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

/** Measures only the borrowed descriptor, never a path or client checksum.
 * The trusted caller must establish the broker pin, open read-only/no-follow,
 * exclude concurrent writers and run in the separately approved sandbox. Stat
 * checks do not establish those guarantees. This is not AV or lineage proof.
 * Explicit offsets preserve the caller's descriptor position; ownership stays
 * with the caller on success, abort and failure.
 */
export async function measurePinnedFile(input: {
  readonly file: FileHandle;
  readonly observedByteLength: number;
  readonly signal: AbortSignal;
}): Promise<ExternalByteMeasurement> {
  let reason: FailureReason = "pinned_measurement_failed";
  const reject = (failure: FailureReason): never => {
    reason = failure;
    throw new Error("pinned_measurement_rejected");
  };
  const checkAbort = () => {
    if (input.signal.aborted) reject("pinned_measurement_aborted");
  };
  try {
    checkAbort();
    if (!Number.isSafeInteger(input.observedByteLength) || input.observedByteLength < 1
      || input.observedByteLength > maxBytes) reject("pinned_measurement_invalid");
    const before = await input.file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(input.observedByteLength)) {
      reject("pinned_measurement_invalid");
    }
    checkAbort();
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(Math.min(chunkBytes, input.observedByteLength));
    let byteLength = 0;
    while (byteLength < input.observedByteLength) {
      checkAbort();
      const requested = Math.min(buffer.length, input.observedByteLength - byteLength);
      const { bytesRead } = await input.file.read(buffer, 0, requested, byteLength);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 1 || bytesRead > requested) {
        reject("pinned_measurement_changed");
      }
      checkAbort();
      hash.update(buffer.subarray(0, bytesRead));
      byteLength += bytesRead;
    }
    checkAbort();
    const extra = await input.file.read(buffer, 0, 1, byteLength);
    if (extra.bytesRead !== 0) reject("pinned_measurement_changed");
    checkAbort();
    const after = await input.file.stat({ bigint: true });
    if (!unchanged(before, after)) reject("pinned_measurement_changed");
    checkAbort();
    const sourceSha256 = hash.digest("hex");
    checkAbort();
    return { sourceSha256, byteLength };
  } catch {
    // Preserve detected invalid/changed evidence even if cancellation also arrived.
    // Do not propagate filesystem paths or arbitrary AbortSignal.reason values.
    throw new ProjectIntelligenceAdapterError("validation_failed", null, reason);
  }
}
