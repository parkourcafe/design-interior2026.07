import type { FileHandle } from "node:fs/promises";
import type { FileIntakeSourceRole } from "../file-intake/policy";
import type { ClamAvProcessResult } from "../r1-worker/clamav-process";
import type { R1UploadFormat, R1ValidationProfile } from "./formats";
import type { UploadAdapterCapabilities, UploadSessionPolicyState } from "./policy";

/** Internal transport types only. Never serialize these as a browser projection. */
export interface ExternalUploadScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly packageId: string;
}
export interface ExternalUploadSession extends UploadSessionPolicyState {
  readonly scope: ExternalUploadScope;
  readonly sessionId: string;
  readonly intakeId: string;
  readonly originatingActorId: string;
  readonly originatingUserId: string;
  readonly format: R1UploadFormat;
  readonly sourceRole: Extract<FileIntakeSourceRole, "document">;
  readonly declaredByteLength: number;
  readonly quotaReservationId: string;
}

interface PinnedObjectBase {
  readonly scope: ExternalUploadScope;
  readonly generationId: string;
  readonly adapterId: string;
  readonly privateLocator: string;
  readonly observedLength: number;
}
export type ExternalPinnedObject = PinnedObjectBase & (
  | { readonly kind: "provider_version"; readonly immutableVersionId: string; readonly providerReceiptDigest: string }
  | { readonly kind: "sealed_copy"; readonly sealReceiptId: string; readonly sealPolicyVersion: string }
);

export interface ExternalValidationJobInput {
  readonly jobId: string;
  readonly scope: ExternalUploadScope;
  readonly generationId: string;
  readonly pinnedObject: ExternalPinnedObject;
  readonly observedLength: number;
  readonly requestedFormat: R1UploadFormat;
  readonly attempt: number;
  readonly fence: number;
  readonly leaseCapability: string;
  readonly leaseExpiresAtMs: number;
  // No trusted checksum at this stage; the worker must measure the pinned bytes.
}

export interface ExternalByteMeasurement {
  readonly sourceSha256: string;
  readonly byteLength: number;
}
export interface ExternalValidationEvidence {
  readonly measurement: ExternalByteMeasurement;
  readonly scanner: ClamAvProcessResult;
  readonly structure: {
    readonly profile: R1ValidationProfile;
    readonly validatorVersion: string;
    readonly result: "valid" | "invalid";
    readonly sourceSha256: string;
    readonly byteLength: number;
  };
}

export interface CanonicalObjectReceipt {
  readonly scope: ExternalUploadScope;
  readonly generationId: string;
  readonly receiptId: string;
  readonly pinnedObject: ExternalPinnedObject;
  readonly serverSha256: string;
  readonly byteLength: number;
}

export interface ExternalUploadPartGrant {
  readonly partNumber: number;
  readonly offset: number;
  readonly byteLength: number;
  readonly expiresAtMs: number;
  /** Opaque, narrowly scoped transport capability; never an audit field. */
  readonly capability: string;
}

/** The implementation must establish real provider guarantees and receipt provenance.
 * Interfaces and capability declarations are not a production adapter or Gate 0 proof.
 */
export interface ExternalUploadStorageAdapter {
  readonly capabilities: UploadAdapterCapabilities;
  issueBoundedGrant(session: ExternalUploadSession, partNumbers: readonly number[]): Promise<readonly ExternalUploadPartGrant[]>;
  resumeParts(session: ExternalUploadSession, partNumbers: readonly number[]): Promise<readonly ExternalUploadPartGrant[]>;
  inspectAndSeal(session: ExternalUploadSession, finalizeClaimId: string): Promise<ExternalPinnedObject>;
  revokeWrite(session: ExternalUploadSession): Promise<{ readonly state: "revoked" | "awaiting_expiry" }>;
  openPinned(object: ExternalPinnedObject, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
  persistCanonicalFromVerifiedFd(input: {
    readonly session: ExternalUploadSession;
    readonly generationId: string;
    readonly file: FileHandle;
    readonly measurement: ExternalByteMeasurement;
  }, signal: AbortSignal): Promise<CanonicalObjectReceipt>;
  verifyCanonical(receipt: CanonicalObjectReceipt, signal: AbortSignal): Promise<ExternalByteMeasurement>;
  reconcileOrphan(session: ExternalUploadSession): Promise<{ readonly state: "pending" | "reconciled"; readonly remainingBytes: number }>;
}
