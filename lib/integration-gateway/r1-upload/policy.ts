import { z } from "zod";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { R1_WORKER_LIMITS } from "../r1-worker/policy";
import { R1_UPLOAD_LIMITS } from "./contracts";
import { R1_UPLOAD_FORMATS, r1UploadFormatPolicy, type R1UploadFormat } from "./formats";

function invalid(reason: string): never {
  throw new ProjectIntelligenceAdapterError("validation_failed", null, reason);
}
function safeInteger(value: number, minimum = 0): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

export function assertUploadByteLength(format: R1UploadFormat, length: number): void {
  if (!R1_UPLOAD_FORMATS.includes(format) || !safeInteger(length, 1)
    || length > r1UploadFormatPolicy(format).maxBytes) invalid("upload_size_invalid");
}

export function uploadPartCount(format: R1UploadFormat, declaredLength: number): number {
  assertUploadByteLength(format, declaredLength);
  return Math.ceil(declaredLength / R1_UPLOAD_LIMITS.partBytes);
}

export function uploadPartRange(format: R1UploadFormat, declaredLength: number, partNumber: number) {
  const count = uploadPartCount(format, declaredLength);
  if (!safeInteger(partNumber, 1) || partNumber > count) invalid("upload_part_invalid");
  const offset = (partNumber - 1) * R1_UPLOAD_LIMITS.partBytes;
  return { partNumber, offset, byteLength: Math.min(R1_UPLOAD_LIMITS.partBytes, declaredLength - offset) };
}

/** Observed part lengths come from trusted storage, never browser assertions. */
export function assertCompletedParts(format: R1UploadFormat, declaredLength: number,
  parts: readonly { readonly partNumber: number; readonly byteLength: number }[]): void {
  if (parts.length !== uploadPartCount(format, declaredLength)) invalid("upload_parts_incomplete");
  const seen = new Set<number>();
  for (const part of parts) {
    if (seen.has(part.partNumber)) invalid("upload_part_duplicate");
    seen.add(part.partNumber);
    if (uploadPartRange(format, declaredLength, part.partNumber).byteLength !== part.byteLength) invalid("upload_part_length_mismatch");
  }
}

export type UploadSessionState = "open" | "finalizing" | "finalized" | "cancelled" | "expired" | "failed";
export interface UploadSessionPolicyState {
  readonly state: UploadSessionState;
  readonly revision: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}
export type UploadSessionAction = "resume" | "claim_finalize" | "complete_finalize" | "cancel";

/** A policy check, not authorization, replay storage or a substitute for transactional CAS.
 * The service must first authorize the principal and reconcile exact durable replay.
 */
export function checkUploadSessionAction(session: UploadSessionPolicyState, action: UploadSessionAction,
  expectedRevision: number, nowMs: number): { readonly expectedRevision: number; readonly nextRevision: number; readonly nextState: UploadSessionState } {
  if (!safeInteger(nowMs) || !safeInteger(session.createdAtMs) || !safeInteger(session.expiresAtMs)
    || session.expiresAtMs <= session.createdAtMs || session.expiresAtMs - session.createdAtMs > R1_UPLOAD_LIMITS.sessionLifetimeMs
    || nowMs < session.createdAtMs || !safeInteger(session.revision) || session.revision >= Number.MAX_SAFE_INTEGER
    || !safeInteger(expectedRevision)) invalid("upload_session_invalid");
  if (session.revision !== expectedRevision) throw new ProjectIntelligenceAdapterError("stale_state", null, "upload_revision_mismatch");
  if (nowMs >= session.expiresAtMs) throw new ProjectIntelligenceAdapterError("expired", null, "upload_session_expired");
  const next: Partial<Record<UploadSessionAction, UploadSessionState>> = session.state === "open"
    ? { resume: "open", claim_finalize: "finalizing", cancel: "cancelled" }
    : session.state === "finalizing" ? { complete_finalize: "finalized", cancel: "cancelled" } : {};
  const nextState = next[action];
  if (!nextState) throw new ProjectIntelligenceAdapterError("scope_conflict", null, "upload_state_conflict");
  return { expectedRevision, nextRevision: session.revision + 1, nextState };
}

export function uploadGrantExpiry(session: UploadSessionPolicyState, nowMs: number): number {
  checkUploadSessionAction(session, "resume", session.revision, nowMs);
  return Math.min(session.expiresAtMs, nowMs + R1_UPLOAD_LIMITS.grantLifetimeMs);
}

const capabilitySchema = z.object({
  adapterId: z.string().min(1).max(128),
  privateQuarantine: z.literal(true),
  boundedParts: z.literal(true),
  absoluteExpiry: z.literal(true),
  finalizedBytesNotWritableByUploadGrant: z.literal(true),
  exactPinnedRead: z.literal(true),
  pinMode: z.enum(["provider_version", "sealed_copy"]),
  // A trusted deployment's independently checked capability receipt reference, not proof created here.
  capabilityReceiptId: z.string().uuid(),
}).strict();
export type UploadAdapterCapabilities = z.infer<typeof capabilitySchema>;

/** Necessary configuration checks only. JSON flags cannot prove provider immutability. */
export function requireUploadAdapterCapabilities(input: unknown): UploadAdapterCapabilities {
  const result = capabilitySchema.safeParse(input);
  if (!result.success) invalid("storage_pin_unavailable");
  return result.data;
}

export type ValidationFailureKind = "transient" | "malware" | "invalid_format" | "cancelled";
export function validationRetryDisposition(attempt: number, failure: ValidationFailureKind): "retry" | "terminal" {
  if (!safeInteger(attempt, 1) || attempt > R1_WORKER_LIMITS.maxAttempts
    || !["transient", "malware", "invalid_format", "cancelled"].includes(failure)) invalid("validation_attempt_invalid");
  return failure === "transient" && attempt < R1_WORKER_LIMITS.maxAttempts ? "retry" : "terminal";
}

/** Correlation only, not a clean receipt issuer. The worker/broker must establish
 * real scanner provenance, pinned FD identity and sandbox policy before calling.
 */
export function assertValidationEvidenceCorrelation(format: R1UploadFormat, observedLength: number,
  evidence: import("./adapters").ExternalValidationEvidence): void {
  assertUploadByteLength(format, observedLength);
  const { measurement, scanner, structure } = evidence;
  const sha = /^[a-f0-9]{64}$/;
  if (!sha.test(measurement.sourceSha256) || measurement.byteLength !== observedLength
    || scanner.exitCode !== 0 || scanner.timedOut || !scanner.evidence
    || scanner.evidence.sourceSha256 !== measurement.sourceSha256
    || scanner.evidence.byteLength !== observedLength
    || !/^\d+\.\d+\.\d+$/.test(scanner.evidence.engineVersion)
    || !safeInteger(scanner.evidence.signatureVersion, 1)
    || !sha.test(scanner.evidence.signatureBundleSha256)
    || structure.profile !== r1UploadFormatPolicy(format).profile
    || structure.result !== "valid" || !structure.validatorVersion.trim()
    || structure.sourceSha256 !== measurement.sourceSha256 || structure.byteLength !== observedLength) {
    invalid("validation_evidence_mismatch");
  }
  // Freshness is established by the scanner at scan time, not re-expired here.
}
