import "server-only";

import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import { FailClosedFileMalwareScanner, type FileMalwareScanner } from "../file-intake/scanner";
import type { FileIntakeSourceRole } from "../file-intake/policy";
import type { ConnectionRef } from "../core/connector";
import {
  createIntegrationWorkerResources,
} from "../runtime/worker-client";
import { createGoogleDriveProviderTransport, createGoogleDriveSelectionStore } from "./runtime";
import { SecretStoreGoogleDriveSelectionStore } from "./secret-store-adapters";
import { GoogleDriveSelectedImportWorker, type GoogleDriveSelectedImportResult } from "./import-worker";
import { PostgresGoogleDriveImportPorts } from "./import-adapter";
import type { GoogleDriveProviderTransport } from "./provider-transport";
import { GoogleDriveProviderError } from "./provider-transport";

const jobSchema = z.object({
  jobId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  connectionId: z.string().uuid(),
  jobKind: z.string().min(1),
  attemptCount: z.number().int().positive(),
  leaseToken: z.string().uuid(),
  inputRef: z.object({
    selectionMode: z.literal("explicit_selected_object"),
    selectionRef: z.string().regex(/^selection:google-drive:[a-f0-9]{64}$/u),
    projectConnectionId: z.string().uuid(),
    sourceRole: z.enum([
      "document", "drawing-preview", "reference", "photo-evidence", "correspondence", "schedule",
    ]),
  }).strict(),
}).strict();

const resultRef = (result: GoogleDriveSelectedImportResult): Record<string, unknown> => result.state === "candidate"
  ? {
      state: result.state,
      candidateId: result.candidateId,
      intakeId: result.intakeId,
      externalObjectId: result.externalObjectId,
      exactExternalRevision: result.exactExternalRevision,
      serverSha256: result.serverSha256,
    }
  : {
      state: result.state,
      intakeId: result.intakeId,
      exactExternalRevision: result.exactExternalRevision,
      scanOutcome: result.scanOutcome,
    };

export class GoogleDriveSelectedImportJobRunner {
  private readonly worker: GoogleDriveSelectedImportWorker;

  constructor(
    private readonly client: PostgresRpcClient,
    private readonly selections: SecretStoreGoogleDriveSelectionStore,
    provider: GoogleDriveProviderTransport,
    storage: PrivateStorageClient,
    scanner: FileMalwareScanner = new FailClosedFileMalwareScanner(),
  ) {
    this.worker = new GoogleDriveSelectedImportWorker(new PostgresGoogleDriveImportPorts({
      workerClient: client,
      storage,
      scanner,
      downloadSelectedObject: (input) => provider.downloadSelectedObject(input),
    }));
  }

  async claim(input: { readonly limit: number; readonly leaseSeconds: number }) {
    return z.array(jobSchema).parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "claim_selected_google_drive_import_jobs",
      { p_limit: input.limit, p_lease_seconds: input.leaseSeconds },
    ));
  }

  async execute(input: z.infer<typeof jobSchema>): Promise<GoogleDriveSelectedImportResult> {
    const job = jobSchema.parse(input);
    const selected = await this.selections.get(job.inputRef.selectionRef);
    if (!selected) throw new Error("google_drive_selection_expired");
    const result = await this.worker.importSelectedObject({
      actor: {
        actorId: "system:google-drive-import-worker",
        organizationId: job.organizationId,
        projectId: job.projectId,
        correlationId: job.jobId,
        effectiveCapabilities: ["import_object"],
      },
      connection: {
        connectionId: job.connectionId,
        provider: "google_drive",
        organizationId: job.organizationId,
      } satisfies ConnectionRef,
      projectId: job.projectId,
      projectConnectionId: job.inputRef.projectConnectionId,
      selected,
      sourceRole: job.inputRef.sourceRole as FileIntakeSourceRole,
      idempotencyKey: `google-drive-import-${job.jobId}`,
    });
    await callRpc(this.client, "remhaos_integration_api", "complete_integration_job", {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_result_ref: resultRef(result),
      p_idempotency_key: `google-drive-complete-${job.jobId}-${job.attemptCount}`,
    });
    await this.selections.delete(job.inputRef.selectionRef);
    return result;
  }

  async fail(input: z.infer<typeof jobSchema>, error: unknown = null): Promise<void> {
    const job = jobSchema.parse(input);
    const reauth = error instanceof GoogleDriveProviderError && error.code === "reauth_required";
    if (reauth) {
      await callRpc(this.client, "remhaos_integration_api", "mark_google_drive_reauth_required", {
        p_organization_id: job.organizationId,
        p_connection_id: job.connectionId,
        p_reason: "provider_credential_revoked",
        p_idempotency_key: `google-drive-reauth-${job.connectionId}`,
      });
    }
    await callRpc(this.client, "remhaos_integration_api", "fail_integration_job", {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_error_code: "google_drive_import_failed",
      p_retryable: !reauth,
      p_max_attempts: 3,
      p_retry_after_seconds: 60,
      p_idempotency_key: `google-drive-fail-${job.jobId}-${job.attemptCount}`,
    });
  }
}

export function createGoogleDriveSelectedImportJobRunner(): GoogleDriveSelectedImportJobRunner {
  const resources = createIntegrationWorkerResources();
  return new GoogleDriveSelectedImportJobRunner(
    resources.client,
    createGoogleDriveSelectionStore(),
    createGoogleDriveProviderTransport({ client: resources.client }),
    resources.storage,
  );
}
