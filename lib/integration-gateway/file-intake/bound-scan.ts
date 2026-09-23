import { createHash } from "node:crypto";
import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import { assertFileIntakeInternalKey, assertFileIntakeQuarantineKey, FILE_INTAKE_EXTENSIONS, FILE_INTAKE_SOURCE_ROLES } from "./policy";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
export const boundScanPolicySchema = z.object({
  policyVersion: z.literal("wp32-clamav-local17/v1"),
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  engineVersion: z.literal("1.5.4"), executableSha256: digest, receiverSha256: digest,
  signatureBundleSha256: digest, signatureVersion: z.number().int().positive().safe(),
  signatureTimestamp: z.number().int().positive().safe(),
}).strict();
export type BoundScanPolicy = z.infer<typeof boundScanPolicySchema>;

const claimSchema = z.object({
  taskId: z.string().uuid(), intakeId: z.string().uuid(), organizationId: z.string().uuid(),
  projectId: z.string().uuid(), packageId: z.string().uuid(), attempt: z.number().int().min(1).max(3),
  fence: z.number().int().min(1).max(3), nonce: z.string().uuid(), claimedAt: instant, expiresAt: instant,
  bucket: z.literal("client-uploads"), objectKey: z.string().min(1).max(2048), canonicalKey: z.string().min(1).max(2048),
  checksumHex: digest, byteLength: z.number().int().positive().max(100_000_000),
  sourceRole: z.enum(FILE_INTAKE_SOURCE_ROLES), extension: z.enum(FILE_INTAKE_EXTENSIONS), mediaType: z.string().min(1),
  policy: boundScanPolicySchema,
}).strict();
export type BoundScanClaim = z.infer<typeof claimSchema>;

const executionSchema = z.object({
  taskId: z.string().uuid(), nonce: z.string().uuid(), attempt: z.number().int().positive(), fence: z.number().int().positive(),
  sourceSha256: digest, byteLength: z.number().int().positive(), policy: boundScanPolicySchema,
  scanStartedAt: instant, scanCompletedAt: instant,
  outcome: z.enum(["clean", "infected", "scan_failed"]), exitCode: z.number().int().nullable(),
  sandboxEvidenceSha256: digest,
}).strict();
export type BoundScanExecution = z.infer<typeof executionSchema>;
export type BoundScanEvidence = BoundScanExecution & {
  readonly schemaVersion: "remhaos.file-scan-evidence/1";
  readonly storageAfterSha256: string;
  readonly canonicalSha256: string | null;
  readonly canonicalByteLength: number | null;
  readonly canonicalVerifiedAt: string | null;
};

const envelopeSchema = z.object({ operation: z.string(), replay: z.boolean(), result: z.unknown() });
const completionSchema = z.object({
  taskId: z.string().uuid(), intakeId: z.string().uuid(), receiptId: z.string().uuid(), evidenceDigest: digest,
  outcome: z.enum(["clean", "infected", "scan_failed"]),
}).strict();

/** Trusted SYSTEM ports, not browser inputs. Implementations must bound reads
 * while streaming, preserve write-once canonical bytes and run the actual scanner
 * after this claim. A caller-supplied JSON verdict is not an implementation. */
export interface BoundScanPorts {
  readonly readObject: (bucket: "client-uploads", key: string, maxBytes: number) => Promise<Uint8Array>;
  readonly putCanonicalIfAbsent: (bucket: "client-uploads", key: string, bytes: Uint8Array, mediaType: string) => Promise<void>;
  readonly executeScanner: (input: { readonly claim: BoundScanClaim; readonly bytes: Uint8Array }) => Promise<BoundScanExecution>;
  readonly retainEvidence: (evidence: BoundScanEvidence) => Promise<void>;
}

export function fileScanDigest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function requestBoundFileScan(humanClient: PostgresRpcClient, input: {
  readonly projectId: string; readonly intakeId: string; readonly capabilityDigest: string; readonly idempotencyKey: string;
}) {
  z.string().uuid().parse(input.projectId); z.string().uuid().parse(input.intakeId); digest.parse(input.capabilityDigest);
  const command = envelopeSchema.parse(await callRpc(humanClient, "remhaos_integration_api", "request_bound_file_scan", {
    p_project_id: input.projectId, p_intake_id: input.intakeId,
    p_capability_digest: input.capabilityDigest, p_idempotency_key: input.idempotencyKey,
  }));
  return { ...command, result: z.object({ taskId: z.string().uuid(), intakeId: z.string().uuid() }).strict().parse(command.result) };
}

/** Existing service transport plus task capability; the platform credential itself
 * is NOT globally downscoped. Neither it nor either capability belongs in logs. */
export class BoundFileScanWorker {
  constructor(private readonly systemClient: PostgresRpcClient, private readonly ports: BoundScanPorts) {
    if (typeof window !== "undefined") throw new Error("file_scan_system_only");
  }

  async claim(input: { readonly taskId: string; readonly capability: string; readonly leaseSecret: string; readonly key: string }) {
    z.string().uuid().parse(input.taskId); digest.parse(input.capability); digest.parse(input.leaseSecret);
    const command = envelopeSchema.parse(await callRpc(this.systemClient, "remhaos_integration_api", "claim_bound_file_scan", {
      p_task: input.taskId, p_capability: input.capability, p_lease_digest: fileScanDigest(input.leaseSecret), p_idempotency_key: input.key,
    }));
    const claim = claimSchema.parse(command.result);
    if (claim.taskId !== input.taskId || claim.fence !== claim.attempt || Date.parse(claim.expiresAt) <= Date.now()
      || Date.parse(claim.expiresAt) - Date.parse(claim.claimedAt) > 300_000) throw new Error("file_scan_claim_invalid");
    assertFileIntakeQuarantineKey({ objectKey: claim.objectKey, organizationId: claim.organizationId, projectId: claim.projectId,
      intakeId: claim.intakeId, checksumHex: claim.checksumHex, sourceRole: claim.sourceRole, extension: claim.extension });
    assertFileIntakeInternalKey({ objectKey: claim.canonicalKey, organizationId: claim.organizationId, projectId: claim.projectId,
      checksumHex: claim.checksumHex, sourceRole: claim.sourceRole, extension: claim.extension });
    return claim;
  }

  private verifyBytes(claim: BoundScanClaim, bytes: Uint8Array) {
    if (bytes.byteLength !== claim.byteLength || fileScanDigest(bytes) !== claim.checksumHex) throw new Error("file_scan_stored_bytes_mismatch");
  }

  async execute(input: { readonly taskId: string; readonly capability: string; readonly leaseSecret: string; readonly claimKey: string; readonly completionKey: string }) {
    const claim = await this.claim({ ...input, key: input.claimKey });
    const bytes = await this.ports.readObject(claim.bucket, claim.objectKey, claim.byteLength);
    this.verifyBytes(claim, bytes);
    const execution = executionSchema.parse(await this.ports.executeScanner({ claim, bytes }));
    if (execution.taskId !== claim.taskId || execution.nonce !== claim.nonce || execution.attempt !== claim.attempt || execution.fence !== claim.fence
      || execution.sourceSha256 !== claim.checksumHex || execution.byteLength !== claim.byteLength
      || JSON.stringify(execution.policy) !== JSON.stringify(claim.policy)
      || Date.parse(execution.scanStartedAt) < Date.parse(claim.claimedAt)
      || Date.parse(execution.scanCompletedAt) < Date.parse(execution.scanStartedAt)
      || Date.parse(execution.scanCompletedAt) > Date.now() || Date.parse(execution.scanCompletedAt) > Date.parse(claim.expiresAt)
      || (execution.outcome === "clean" && execution.exitCode !== 0)
      || (execution.outcome === "infected" && execution.exitCode !== 1)
      || (execution.outcome === "scan_failed" && ![null, 1, 2].includes(execution.exitCode))) throw new Error("file_scan_execution_binding_invalid");
    // A successful scan is not enough: reject an object replaced during scanning.
    const after = await this.ports.readObject(claim.bucket, claim.objectKey, claim.byteLength);
    this.verifyBytes(claim, after);
    const refreshed = await this.claim({ ...input, key: input.claimKey });
    if (JSON.stringify(refreshed) !== JSON.stringify(claim)) throw new Error("file_scan_claim_changed");
    let canonicalSha256: string | null = null, canonicalByteLength: number | null = null, canonicalVerifiedAt: string | null = null;
    if (execution.outcome === "clean") {
      // Never overwrite an existing object or accept conflict as byte proof.
      await this.ports.putCanonicalIfAbsent(claim.bucket, claim.canonicalKey, bytes, claim.mediaType);
      const canonical = await this.ports.readObject(claim.bucket, claim.canonicalKey, claim.byteLength);
      this.verifyBytes(claim, canonical);
      canonicalSha256 = fileScanDigest(canonical); canonicalByteLength = canonical.byteLength; canonicalVerifiedAt = new Date().toISOString();
    }
    const evidence: BoundScanEvidence = { schemaVersion: "remhaos.file-scan-evidence/1", ...execution,
      storageAfterSha256: fileScanDigest(after), canonicalSha256, canonicalByteLength, canonicalVerifiedAt };
    await this.ports.retainEvidence(evidence);
    return this.complete(input, evidence);
  }

  /** Identical network retries reuse the full previously measured evidence. This
   * does not rerun a scan under a new claim or relabel an old offline receipt. */
  async complete(input: { readonly taskId: string; readonly capability: string; readonly leaseSecret: string; readonly completionKey: string }, evidence: {
    readonly schemaVersion: string; readonly taskId: string; readonly attempt: number; readonly fence: number;
    readonly [key: string]: unknown;
  }) {
    const command = envelopeSchema.parse(await callRpc(this.systemClient, "remhaos_integration_api", "complete_bound_file_scan", {
      p_task: input.taskId, p_capability: input.capability, p_attempt: evidence.attempt, p_fence: evidence.fence,
      p_lease_secret: input.leaseSecret, p_evidence: evidence, p_idempotency_key: input.completionKey,
    }));
    const result = completionSchema.parse(command.result);
    if (result.taskId !== input.taskId) throw new Error("file_scan_completion_binding_invalid");
    return { ...command, result };
  }
}
