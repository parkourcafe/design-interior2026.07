import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import { integrationProviderListSchema } from "./provider-registry";
import type { FileIntakeSourceRole } from "../file-intake/policy";

export const connectionProjectionSchema = z.object({
  connectionId: z.string().uuid(),
  providerCode: z.string().min(1),
  status: z.string().min(1),
  displayLabel: z.string().nullable(),
  metadata: z.record(z.unknown()),
  tokenExpiresAt: z.string().nullable(),
  lastSuccessfulSyncAt: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  projectsUsing: z.number().int().nonnegative().default(0),
});

export const projectConnectionProjectionSchema = z.object({
  projectConnectionId: z.string().uuid(),
  connectionId: z.string().uuid(),
  providerCode: z.string().min(1),
  status: z.string().min(1),
  displayLabel: z.string().nullable(),
  allowedCapabilities: z.array(z.string()),
  syncPolicy: z.record(z.unknown()),
  clientVisibility: z.literal("hidden"),
  boundBy: z.string().uuid(),
  boundAt: z.string(),
  unboundAt: z.string().nullable(),
  lastSuccessfulSyncAt: z.string().nullable(),
});

const importCandidateProvenanceSchema = z.object({
  providerCode: z.enum(["google_drive", "telegram", "url_reference"]).optional(),
  exactExternalRevision: z.string()
    .min(1)
    .max(255)
    .regex(/^[^\u0000-\u001f\u007f]*$/)
    .optional(),
  intakeId: z.string().uuid().optional(),
  selectionMode: z.literal("explicit_selected_object").optional(),
}).strict();

export const importCandidateProjectionSchema = z.object({
  candidateId: z.string().uuid(),
  sourceKind: z.enum(["url", "file", "message", "snapshot"]),
  status: z.enum(["candidate", "reviewing", "accepted", "rejected", "superseded"]),
  targetKind: z.enum(["source", "reference", "selection", "evidence", "other"]),
  scanState: z.enum(["pending", "clean", "infected", "failed", "not_applicable"]),
  serverSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  provenance: importCandidateProvenanceSchema,
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});

export type ImportCandidateProjection = z.infer<typeof importCandidateProjectionSchema>;

const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.unknown()),
});

export class IntegrationConnectionService {
  constructor(private readonly client: PostgresRpcClient) {}

  async listProviders() {
    return integrationProviderListSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "list_available_integration_providers",
      ),
    );
  }

  async listOrganizationConnections(organizationId: string) {
    return z.array(connectionProjectionSchema).parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "list_organization_connections",
        { p_organization_id: organizationId },
      ),
    );
  }

  async listProjectConnections(projectId: string) {
    return z.array(projectConnectionProjectionSchema).parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "list_project_connections",
        { p_project_id: projectId },
      ),
    );
  }

  async listTeamProjectConnections(projectId: string) {
    return z.array(projectConnectionProjectionSchema).parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "list_team_project_connections",
        { p_project_id: projectId },
      ),
    );
  }

  async bindProjectConnection(input: {
    readonly projectId: string;
    readonly connectionId: string;
    readonly capabilities: readonly string[];
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "bind_project_connection",
        {
          p_project_id: input.projectId,
          p_connection_id: input.connectionId,
          p_capabilities: input.capabilities,
          p_idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  async unbindProjectConnection(input: {
    readonly projectConnectionId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "unbind_project_connection",
        {
          p_project_connection_id: input.projectConnectionId,
          p_reason: input.reason,
          p_idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  async disconnectOrganizationConnection(input: {
    readonly connectionId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "disconnect_integration_connection",
        {
          p_connection_id: input.connectionId,
          p_reason: input.reason,
          p_idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  async requestManualIntegrationSync(input: {
    readonly projectId: string;
    readonly projectConnectionId: string;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "request_manual_integration_sync",
        {
          p_project_id: input.projectId,
          p_project_connection_id: input.projectConnectionId,
          p_idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  async requestSelectedGoogleDriveImport(input: {
    readonly projectId: string;
    readonly projectConnectionId: string;
    readonly selectionRef: string;
    readonly sourceRole: FileIntakeSourceRole;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "request_selected_google_drive_import",
        {
          p_project_id: input.projectId,
          p_project_connection_id: input.projectConnectionId,
          p_selection_ref: input.selectionRef,
          p_source_role: input.sourceRole,
          p_idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  async listImportCandidates(projectId: string, status?: string) {
    return z.array(importCandidateProjectionSchema).parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "list_import_candidates",
        { p_project_id: projectId, p_status: status ?? null },
      ),
    );
  }

  async reviewImportCandidate(input: {
    readonly candidateId: string;
    readonly decision: "accepted" | "rejected";
    readonly target: Record<string, unknown>;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "review_import_candidate",
        {
          p_candidate_id: input.candidateId,
          p_decision: input.decision,
          p_target: input.target,
          p_idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }
}
