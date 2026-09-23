import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import { FileIntakeStorageAdapter, type FileIntakeStorageAuthorization } from "./storage";
import { validateFileIntakeUpload, type ValidatedFileIntakeUpload } from "./policy";

const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.string(), z.unknown()),
});

const uploadAuthorizationSchema = z.object({
  intakeId: z.string().uuid(),
  projectId: z.string().uuid(),
  packageId: z.string().uuid(),
  organizationId: z.string().uuid(),
  bucket: z.literal("client-uploads"),
  checksumHex: z.string().regex(/^[a-f0-9]{64}$/),
  mediaType: z.string().min(1),
  extension: z.string().min(1),
  sourceRole: z.string().min(1),
  objectKey: z.string().min(1),
  internalObjectKey: z.string().min(1),
  status: z.string().min(1),
  reused: z.boolean(),
});

const projectionSchema = z.object({
  intakeId: z.string().uuid(),
  projectId: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
  originalFilename: z.string().min(1),
  mediaType: z.string().min(1),
  extension: z.string().min(1),
  sourceRole: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  status: z.string().min(1),
  scanOutcome: z.string().nullable(),
  reviewDecision: z.string().nullable(),
  sourceId: z.string().nullable(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  quarantineObjectKey: z.string().nullable(),
  internalObjectKey: z.string().nullable(),
  clientProjection: z.boolean(),
});

export type FileIntakeProjection = z.infer<typeof projectionSchema>;

function commandResult(value: unknown): z.infer<typeof commandResultSchema> {
  return commandResultSchema.parse(value);
}

export class FileIntakeService {
  private readonly storageAdapter: FileIntakeStorageAdapter;

  constructor(
    private readonly client: PostgresRpcClient,
    storage: PrivateStorageClient,
  ) {
    this.storageAdapter = new FileIntakeStorageAdapter(storage);
  }

  async list(projectId: string): Promise<FileIntakeProjection[]> {
    return z.array(projectionSchema).parse(
      await callRpc(this.client, "remhaos_integration_api", "list_file_intakes", {
        p_project_id: projectId,
      }),
    );
  }

  async create(input: {
    readonly projectId: string;
    readonly upload: ValidatedFileIntakeUpload;
    readonly idempotencyKey: string;
  }): Promise<z.infer<typeof commandResultSchema>> {
    const result = commandResult(
      await callRpc(this.client, "remhaos_integration_api", "create_file_intake", {
        p_project_id: input.projectId,
        p_original_filename: input.upload.filename,
        p_media_type: input.upload.mediaType,
        p_extension: input.upload.extension,
        p_size_bytes: input.upload.sizeBytes,
        p_checksum_hex: input.upload.checksumHex,
        p_source_role: input.upload.sourceRole,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
    uploadAuthorizationSchema.parse(result.result);
    return result;
  }

  async createAndUpload(input: {
    readonly projectId: string;
    readonly upload: ValidatedFileIntakeUpload;
    readonly idempotencyKey: string;
  }) {
    const created = await this.create(input);
    const authorization = uploadAuthorizationSchema.parse(created.result);
    if (authorization.status === "requested") {
      const completedReplay = async () => {
        if (!created.replay) return null;
        // The immutable create receipt may predate the successful upload. Read
        // current authorized state before retrying an INSERT into quarantine.
        const current = (await this.list(input.projectId)).find(
          (item) => item.intakeId === authorization.intakeId && item.projectId === input.projectId,
        );
        if (!current) throw new ProjectIntelligenceAdapterError("not_found", "P1204");
        if (current.status !== "requested") {
          if (![
            "uploaded_to_quarantine", "scan_pending", "clean", "infected", "scan_failed",
            "human_reviewed", "rejected", "ingested_candidate", "published_internal_copy",
          ].includes(current.status)) throw new Error("file_intake_replay_state_unknown");
          return {
            ...created,
            result: { ...created.result, status: current.status, uploaded: true },
          };
        }
        return null;
      };
      const replay = await completedReplay();
      if (replay) return replay;
      const storageAuthorization: FileIntakeStorageAuthorization = {
        ...authorization,
        upsert: false,
      };
      try {
        const written = await this.storageAdapter.uploadQuarantine(storageAuthorization, input.upload.bytes);
        if (!written) throw new Error("file_intake_existing_object_unverified");
      } catch (error) {
        // A concurrent replay may have completed after the first state read.
        // Recover only from an authorized durable transition, never from 409/500 alone.
        const concurrentReplay = await completedReplay();
        if (concurrentReplay) return concurrentReplay;
        throw error;
      }
      await this.markUploaded({
        projectId: input.projectId,
        intakeId: authorization.intakeId,
        idempotencyKey: `${input.idempotencyKey}:uploaded`,
      });
      return {
        ...created,
        result: { ...created.result, status: "scan_pending", uploaded: true },
      };
    }
    return created;
  }

  async markUploaded(input: {
    readonly projectId: string;
    readonly intakeId: string;
    readonly idempotencyKey: string;
  }) {
    return commandResult(
      await callRpc(this.client, "remhaos_integration_api", "mark_file_intake_uploaded", {
        p_project_id: input.projectId,
        p_intake_id: input.intakeId,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async review(input: {
    readonly projectId: string;
    readonly intakeId: string;
    readonly decision: "accepted" | "rejected";
    readonly reason: string;
    readonly idempotencyKey: string;
  }) {
    return commandResult(
      await callRpc(this.client, "remhaos_integration_api", "review_file_intake", {
        p_project_id: input.projectId,
        p_intake_id: input.intakeId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async publish(input: {
    readonly projectId: string;
    readonly intakeId: string;
    readonly idempotencyKey: string;
  }) {
    return commandResult(
      await callRpc(this.client, "remhaos_integration_api", "publish_file_intake", {
        p_project_id: input.projectId,
        p_intake_id: input.intakeId,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async authorizeDownload(input: { readonly projectId: string; readonly intakeId: string }) {
    return z.object({
      bucket: z.literal("client-uploads"),
      objectKey: z.string().min(1),
      projectId: z.string().uuid(),
      packageId: z.string().uuid(),
      sourceId: z.string().min(1),
      ttlSeconds: z.number().int().positive().max(900),
    }).parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "authorize_file_intake_download",
      { p_project_id: input.projectId, p_intake_id: input.intakeId, p_ttl_seconds: 900 },
    ));
  }

  async storageAuthorization(input: { readonly projectId: string; readonly intakeId: string }) {
    return z.object({
      organizationId: z.string().uuid(),
      projectId: z.string().uuid(),
      intakeId: z.string().uuid(),
      packageId: z.string().uuid(),
      bucket: z.literal("client-uploads"),
      objectKey: z.string().min(1),
      internalObjectKey: z.string().min(1),
      checksumHex: z.string().regex(/^[a-f0-9]{64}$/),
      mediaType: z.string().min(1),
      extension: z.string().min(1),
      sourceRole: z.string().min(1),
      status: z.enum(["ingested_candidate", "published_internal_copy"]),
      upsert: z.literal(false),
      canonicalReceipt: z.object({
        receiptId: z.string().uuid(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
        checksumHex: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().max(100_000_000),
      }).strict().nullable().optional(),
    }).parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "get_file_intake_storage",
      { p_project_id: input.projectId, p_intake_id: input.intakeId },
    ));
  }

  async createSignedDownload(input: { readonly projectId: string; readonly intakeId: string }) {
    const authorization = await this.authorizeDownload(input);
    return this.storageAdapter.createSignedUrl(authorization);
  }

  async publishWithStorage(input: {
    readonly projectId: string; readonly intakeId: string; readonly idempotencyKey: string;
  }) {
    // This context comes only from the authenticated server RPC, never the
    // request body. CLEAN alone is not a publication or human-review grant.
    const authorization = await this.storageAuthorization(input);
    if (authorization.projectId !== input.projectId || authorization.intakeId !== input.intakeId
      || (authorization.canonicalReceipt && authorization.canonicalReceipt.checksumHex !== authorization.checksumHex)) {
      throw new Error("file_intake_canonical_receipt_mismatch");
    }
    if (authorization.status === "ingested_candidate" && !authorization.canonicalReceipt) {
      await this.copyToInternal({ authorization });
    }
    return this.publish(input);
  }

  async copyToInternal(input: {
    readonly authorization: FileIntakeStorageAuthorization;
  }): Promise<void> {
    await this.storageAdapter.copyToInternal({
      authorization: input.authorization,
      internalObjectKey: input.authorization.internalObjectKey ?? "",
    });
  }
}

export class FileIntakeWorkerService {
  private readonly storageAdapter: FileIntakeStorageAdapter;

  constructor(
    private readonly client: PostgresRpcClient,
    storage: PrivateStorageClient,
  ) {
    this.storageAdapter = new FileIntakeStorageAdapter(storage);
  }

  async createAndUpload(input: {
    readonly projectId: string;
    readonly upload: ValidatedFileIntakeUpload;
    readonly idempotencyKey: string;
  }) {
    const created = commandResult(
      await callRpc(this.client, "remhaos_integration_api", "create_file_intake_worker", {
        p_project_id: input.projectId,
        p_original_filename: input.upload.filename,
        p_media_type: input.upload.mediaType,
        p_extension: input.upload.extension,
        p_size_bytes: input.upload.sizeBytes,
        p_checksum_hex: input.upload.checksumHex,
        p_source_role: input.upload.sourceRole,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
    const authorization = uploadAuthorizationSchema.parse(created.result);
    if (authorization.status === "requested") {
      await this.storageAdapter.uploadQuarantine(
        { ...authorization, upsert: false },
        input.upload.bytes,
      );
      await this.markUploaded({
        projectId: input.projectId,
        intakeId: authorization.intakeId,
        idempotencyKey: `${input.idempotencyKey}:uploaded`,
      });
      return {
        ...created,
        result: { ...created.result, status: "scan_pending", uploaded: true },
      };
    }
    return created;
  }

  private async markUploaded(input: {
    readonly projectId: string;
    readonly intakeId: string;
    readonly idempotencyKey: string;
  }) {
    return commandResult(
      await callRpc(this.client, "remhaos_integration_api", "mark_file_intake_uploaded_worker", {
        p_project_id: input.projectId,
        p_intake_id: input.intakeId,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
  }
}

export function validateUpload(input: {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly browserMediaType: string | null;
  readonly sourceRole: string;
}): ValidatedFileIntakeUpload {
  return validateFileIntakeUpload(input);
}
