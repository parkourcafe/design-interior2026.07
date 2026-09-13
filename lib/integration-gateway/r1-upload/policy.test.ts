import { describe, expect, it } from "vitest";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { R1_WORKER_LIMITS } from "../r1-worker/policy";
import { externalUploadProjectionSchema, R1_UPLOAD_LIMITS } from "./contracts";
import type { ExternalValidationEvidence } from "./adapters";
import {
  assertCompletedParts, assertValidationEvidenceCorrelation, checkUploadSessionAction,
  requireUploadAdapterCapabilities, uploadGrantExpiry, uploadPartCount, uploadPartRange,
  validationRetryDisposition, type UploadSessionPolicyState,
} from "./policy";

const session: UploadSessionPolicyState = { state: "open", revision: 2, createdAtMs: 1_000, expiresAtMs: 1_801_000 };
const capability = {
  adapterId: "synthetic-policy-fixture", privateQuarantine: true, boundedParts: true,
  absoluteExpiry: true, finalizedBytesNotWritableByUploadGrant: true, exactPinnedRead: true,
  pinMode: "provider_version", capabilityReceiptId: "00000000-0000-4000-8000-000000000001",
};
// Shape/correlation fixture only, never actual AV or storage proof.
const evidence: ExternalValidationEvidence = {
  measurement: { sourceSha256: "a".repeat(64), byteLength: 1 },
  scanner: { exitCode: 0, timedOut: false, evidence: { sourceSha256: "a".repeat(64), byteLength: 1,
    engineVersion: "1.2.3", signatureVersion: 1, signatureBundleSha256: "b".repeat(64) } },
  structure: { profile: "skp-original-retention-v1", validatorVersion: "fixture-v1", result: "valid", sourceSha256: "a".repeat(64), byteLength: 1 },
};

describe("R1 pure upload policy", () => {
  it("bounds final part and validates a complete observed manifest independently of ordering", () => {
    expect(uploadPartCount("skp", 100_000_000)).toBe(13);
    expect(uploadPartRange("skp", 100_000_000, 13)).toEqual({ partNumber: 13, offset: 96_000_000, byteLength: 4_000_000 });
    const parts = Array.from({ length: 13 }, (_, i) => uploadPartRange("skp", 100_000_000, i + 1));
    expect(() => assertCompletedParts("skp", 100_000_000, parts.toReversed())).not.toThrow();
    expect(() => assertCompletedParts("skp", 100_000_000, parts.slice(1))).toThrow();
    expect(() => assertCompletedParts("skp", 100_000_000, [...parts.slice(0, 12), uploadPartRange("skp", 100_000_000, 1)])).toThrow();
    expect(() => assertCompletedParts("skp", 100_000_000, [...parts.slice(0, 12), { partNumber: 13, byteLength: 4_000_001 }])).toThrow();
    expect(() => uploadPartRange("pdf", 52_428_801, 1)).toThrow();
    expect(() => uploadPartRange("skp", 1, 2)).toThrow();
  });
  it("requires matching revision and excludes stale finalize/cancel plans", () => {
    const claim = checkUploadSessionAction(session, "claim_finalize", 2, 2_000);
    expect(claim).toEqual({ expectedRevision: 2, nextRevision: 3, nextState: "finalizing" });
    const claimed = { ...session, revision: claim.nextRevision, state: claim.nextState };
    expect(() => checkUploadSessionAction(claimed, "cancel", 2, 2_001)).toThrow(ProjectIntelligenceAdapterError);
    expect(checkUploadSessionAction(claimed, "cancel", 3, 2_001).nextState).toBe("cancelled");
    expect(checkUploadSessionAction(claimed, "complete_finalize", 3, 2_001).nextState).toBe("finalized");
    expect(() => checkUploadSessionAction(session, "complete_finalize", 2, 2_000)).toThrow();
    expect(() => checkUploadSessionAction(claimed, "resume", 3, 2_001)).toThrow();
    for (const state of ["finalized", "cancelled", "expired", "failed"] as const) {
      expect(() => checkUploadSessionAction({ ...session, state }, "claim_finalize", 2, 2_000)).toThrow();
    }
    expect(session.revision).toBe(2);
  });
  it("projects the last representable transition without permitting revision overflow", () => {
    const lastRevision = Number.MAX_SAFE_INTEGER - 1;
    const result = checkUploadSessionAction({ ...session, revision: lastRevision }, "cancel", lastRevision, 2_000);
    const id = "00000000-0000-4000-8000-000000000001";
    expect(externalUploadProjectionSchema.parse({ sessionId: id, intakeId: id, packageId: id,
      format: "skp", status: result.nextState, revision: result.nextRevision }).revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => checkUploadSessionAction({ ...session, state: result.nextState, revision: result.nextRevision },
      "resume", result.nextRevision, 2_001)).toThrow();
  });
  it("expires at exact boundary, caps grants and never extends session on resume", () => {
    expect(uploadGrantExpiry(session, 2_000)).toBe(302_000);
    expect(uploadGrantExpiry(session, session.expiresAtMs - 1)).toBe(session.expiresAtMs);
    expect(() => uploadGrantExpiry(session, session.expiresAtMs)).toThrow();
    expect(() => uploadGrantExpiry({ ...session, expiresAtMs: session.expiresAtMs + 1 }, 2_000)).toThrow();
    for (const now of [NaN, Infinity, -1, session.createdAtMs - 1]) expect(() => uploadGrantExpiry(session, now)).toThrow();
    expect(() => checkUploadSessionAction({ ...session, revision: Number.MAX_SAFE_INTEGER }, "resume", Number.MAX_SAFE_INTEGER, 2_000)).toThrow();
    expect(session.expiresAtMs - session.createdAtMs).toBe(R1_UPLOAD_LIMITS.sessionLifetimeMs);
  });
  it("fails closed for every missing capability, ETag-only pins and unbounded grants", () => {
    expect(requireUploadAdapterCapabilities(capability).pinMode).toBe("provider_version");
    expect(requireUploadAdapterCapabilities({ ...capability, pinMode: "sealed_copy" }).pinMode).toBe("sealed_copy");
    for (const key of Object.keys(capability)) {
      const candidate = { ...capability };
      Reflect.deleteProperty(candidate, key);
      expect(() => requireUploadAdapterCapabilities(candidate)).toThrow();
    }
    for (const input of [undefined, null, {}, { ...capability, pinMode: "etag" }, { ...capability, exactPinnedRead: false }, { ...capability, capabilityReceiptId: "generated-version" }]) {
      try { requireUploadAdapterCapabilities(input); throw new Error("unexpected_acceptance"); }
      catch (error) {
        expect(error).toBeInstanceOf(ProjectIntelligenceAdapterError);
        expect(error).toMatchObject({ code: "validation_failed", reason: "storage_pin_unavailable" });
      }
    }
  });
  it("reuses the bounded worker retry budget and never retries malware/format rejection", () => {
    expect(validationRetryDisposition(1, "transient")).toBe("retry");
    expect(validationRetryDisposition(R1_WORKER_LIMITS.maxAttempts, "transient")).toBe("terminal");
    for (const failure of ["malware", "invalid_format", "cancelled"] as const) expect(validationRetryDisposition(1, failure)).toBe("terminal");
    for (const attempt of [0, 4, NaN, 1.5]) expect(() => validationRetryDisposition(attempt, "transient")).toThrow();
  });
  it("requires measured scanner evidence and exact length/hash/profile agreement", () => {
    expect(() => assertValidationEvidenceCorrelation("skp", 1, evidence)).not.toThrow();
    const cases: ExternalValidationEvidence[] = [
      { ...evidence, scanner: { exitCode: 0, timedOut: false } },
      { ...evidence, scanner: { ...evidence.scanner, timedOut: true } },
      { ...evidence, scanner: { ...evidence.scanner, exitCode: 1 } },
      { ...evidence, measurement: { ...evidence.measurement, byteLength: 2 } },
      { ...evidence, measurement: { ...evidence.measurement, sourceSha256: "c".repeat(64) } },
      { ...evidence, structure: { ...evidence.structure, profile: "glb-viewable-input-v1" } },
      { ...evidence, structure: { ...evidence.structure, result: "invalid" } },
      { ...evidence, structure: { ...evidence.structure, validatorVersion: " " } },
    ];
    for (const candidate of cases) expect(() => assertValidationEvidenceCorrelation("skp", 1, candidate)).toThrow();
    expect(() => assertValidationEvidenceCorrelation("glb", 1, evidence)).toThrow();
  });
});
