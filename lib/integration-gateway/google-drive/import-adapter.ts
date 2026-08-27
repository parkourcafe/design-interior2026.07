import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import { FileIntakeWorkerService } from "../file-intake/service";
import type { FileMalwareScanner } from "../file-intake/scanner";
import type { GoogleDriveImportPorts } from "./import-worker";

const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.string(), z.unknown()),
});

const externalObjectResultSchema = z.object({
  externalObjectId: z.string().uuid(),
});

const candidateResultSchema = z.object({
  candidateId: z.string().uuid(),
});

const intakeResultSchema = z.object({
  intakeId: z.string().uuid(),
});

export interface GoogleDriveImportAdapterDependencies {
  /** Explicit worker client; never substitute a service-role or browser client. */
  readonly workerClient: PostgresRpcClient;
  readonly storage: PrivateStorageClient;
  readonly scanner: FileMalwareScanner;
  readonly downloadSelectedObject: GoogleDriveImportPorts["downloadSelectedObject"];
}

export class PostgresGoogleDriveImportPorts implements GoogleDriveImportPorts {
  private readonly fileIntake: FileIntakeWorkerService;

  constructor(private readonly dependencies: GoogleDriveImportAdapterDependencies) {
    this.fileIntake = new FileIntakeWorkerService(dependencies.workerClient, dependencies.storage);
  }

  downloadSelectedObject(input: Parameters<GoogleDriveImportPorts["downloadSelectedObject"]>[0]) {
    return this.dependencies.downloadSelectedObject(input);
  }

  async upsertExternalObject(
    input: Parameters<GoogleDriveImportPorts["upsertExternalObject"]>[0],
  ) {
    const command = commandResultSchema.parse(await callRpc(
      this.dependencies.workerClient,
      "remhaos_integration_api",
      "upsert_external_object",
      {
        p_project_connection_id: input.projectConnectionId,
        p_provider_object_key: input.providerObjectKey,
        p_provider_object_hash: `\\x${input.providerObjectHashHex}`,
        p_object_kind: input.objectKind,
        p_display_name: input.displayName,
        p_mime_type: input.mimeType,
        p_size_bytes: input.sizeBytes,
        p_external_revision: input.externalRevision,
        p_modified_at_provider: input.modifiedAtProvider,
        p_metadata: input.metadata,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
    return externalObjectResultSchema.parse(command.result);
  }

  async createQuarantine(
    input: Parameters<GoogleDriveImportPorts["createQuarantine"]>[0],
  ) {
    const command = commandResultSchema.parse(await this.fileIntake.createAndUpload({
      projectId: input.projectId,
      upload: input.upload,
      idempotencyKey: input.idempotencyKey,
    }));
    return intakeResultSchema.parse(command.result);
  }

  async completeScan(
    input: Parameters<GoogleDriveImportPorts["completeScan"]>[0],
  ): Promise<void> {
    commandResultSchema.parse(await callRpc(
      this.dependencies.workerClient,
      "remhaos_integration_api",
      "complete_file_intake_scan",
      {
        p_project_id: input.projectId,
        p_intake_id: input.intakeId,
        p_outcome: input.outcome,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
  }

  async createCandidate(
    input: Parameters<GoogleDriveImportPorts["createCandidate"]>[0],
  ) {
    const command = commandResultSchema.parse(await callRpc(
      this.dependencies.workerClient,
      "remhaos_integration_api",
      "create_import_candidate",
      {
        p_project_id: input.projectId,
        p_external_object_id: input.externalObjectId,
        p_source_kind: "file",
        p_target_kind: "source",
        p_internal_object_key: null,
        p_server_sha256: input.serverSha256,
        p_scan_state: "clean",
        p_provenance: {
          providerCode: "google_drive",
          exactExternalRevision: input.exactExternalRevision,
          intakeId: input.intakeId,
        },
        p_idempotency_key: input.idempotencyKey,
      },
    ));
    return candidateResultSchema.parse(command.result);
  }

  scan(input: Parameters<GoogleDriveImportPorts["scan"]>[0]) {
    return this.dependencies.scanner.scan(input);
  }
}
