import "server-only";

import {
  FoundationPostgresAdapter,
  ProjectBrainHumanPostgresAdapter,
  ProjectCeoM4HumanPostgresAdapter,
  ProjectIntelligenceAdapterError,
  type CommandMutation,
  type FoundationErrorCode,
  type PostgresRpcClient,
  type ProductDeliveryProjection,
  type ProjectListItem,
} from "../../adapters/postgres";
import {
  PROJECTCEO_COMMAND_CONTRACT_VERSION,
  type ProjectCeoCommand,
  type ProjectCeoCommandResponse,
} from "./command-contract";

type UnknownRecord = Readonly<Record<string, unknown>>;
type CommandErrorCode =
  | "unauthenticated"
  | "identity_unverified"
  | "forbidden"
  | "not_found"
  | "stale_state"
  | "scope_conflict"
  | "validation_failed"
  | "idempotency_conflict"
  | "operation_unavailable"
  | "internal_error";

const UNAVAILABLE = new Set<ProjectCeoCommand["kind"]>([
  "create_invitation",
  "acknowledge_release",
  "register_source",
  "review_source",
  "review_selection",
  "publish_baseline",
  "publish_release",
  "distribute_release",
  "build_handover",
]);

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function rows(value: unknown): readonly UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function failure(
  requestId: string,
  status: "unavailable" | "error",
  code: CommandErrorCode,
): ProjectCeoCommandResponse {
  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    requestId,
    status,
    error: {
      code,
      messageKey: `project_ceo.error.${code}`,
      retryable: code === "stale_state" || code === "internal_error",
    },
  };
}

function completed(
  requestId: string,
  mutation: CommandMutation<unknown>,
  resultOverride?: UnknownRecord,
): ProjectCeoCommandResponse {
  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    requestId,
    status: "completed",
    operation: mutation.operation,
    replay: mutation.replay,
    stateRevision: mutation.stateRevision,
    result: resultOverride ?? record(mutation.result),
  };
}

function errorCode(error: unknown): Exclude<FoundationErrorCode, "expired" | "revoked" | "unsupported_source" | "rate_limited"> | "internal_error" {
  if (!(error instanceof ProjectIntelligenceAdapterError)) return "internal_error";
  if (error.code === "expired" || error.code === "revoked") return "forbidden";
  if (error.code === "unsupported_source" || error.code === "rate_limited") return "validation_failed";
  return error.code;
}

function effectiveScope(entries: readonly ProjectListItem[], projectId: string): ProjectListItem | null {
  const matching = entries.filter((entry) => entry.projectId === projectId);
  if (new Set(matching.map((entry) => entry.organizationId)).size > 1) {
    throw new ProjectIntelligenceAdapterError("scope_conflict", null);
  }
  const projectScope = matching.find((entry) => entry.accessScope === "project");
  if (projectScope) return projectScope;
  if (matching.length > 1) {
    throw new ProjectIntelligenceAdapterError("scope_conflict", null);
  }
  return matching[0] ?? null;
}

export interface ProjectCeoCommandDependencies {
  readonly client: PostgresRpcClient;
}

/**
 * Human-command orchestration. The request body carries a project selector and
 * target resource IDs only. Membership, effective role, organization, exact
 * package, state revision and idempotency key are always re-derived server-side
 * for this request, and every mutation is finally authorized again by the RPC.
 */
export class ProjectCeoCommandService {
  private readonly foundation: FoundationPostgresAdapter;
  private readonly product: ProjectBrainHumanPostgresAdapter;
  private readonly execution: ProjectCeoM4HumanPostgresAdapter;

  constructor(private readonly dependencies: ProjectCeoCommandDependencies) {
    this.foundation = new FoundationPostgresAdapter(dependencies.client);
    this.product = new ProjectBrainHumanPostgresAdapter(dependencies.client);
    this.execution = new ProjectCeoM4HumanPostgresAdapter(dependencies.client);
  }

  private async context(projectId: string): Promise<{
    readonly scope: ProjectListItem;
    readonly delivery: ProductDeliveryProjection;
  }> {
    const projects = await this.foundation.listProjects();
    if (projects.error || !projects.data) {
      throw new ProjectIntelligenceAdapterError(
        projects.error?.code ?? "internal_error",
        null,
      );
    }
    const scope = effectiveScope(projects.data, projectId);
    if (!scope) throw new ProjectIntelligenceAdapterError("not_found", null);
    const delivery = await this.product.getProjectDelivery({
      projectId,
      packageId: scope.accessScope === "package" ? scope.packageId ?? null : null,
    });
    if (delivery.error || !delivery.data) {
      throw new ProjectIntelligenceAdapterError(
        delivery.error?.code ?? "internal_error",
        null,
      );
    }
    return { scope, delivery: delivery.data };
  }

  async execute(
    command: ProjectCeoCommand,
    requestId: string,
  ): Promise<ProjectCeoCommandResponse> {
    if (UNAVAILABLE.has(command.kind)) {
      return failure(requestId, "unavailable", "operation_unavailable");
    }
    try {
      const { scope, delivery } = await this.context(command.projectId);
      const idempotencyKey = `ui:${command.projectId}:${command.kind}:${command.commandId}`;
      if (command.kind === "revoke_invitation") {
        const access = await this.foundation.listProjectAccess(command.projectId);
        if (access.error || !access.data) {
          throw new ProjectIntelligenceAdapterError(
            access.error?.code ?? "internal_error",
            null,
          );
        }
        const invitationExists = rows(record(access.data).invitations)
          .some((item) => item.invitationId === command.payload.invitationId);
        if (!invitationExists) return failure(requestId, "error", "scope_conflict");
        return completed(requestId, await this.foundation.revokeInvitation({
          projectId: command.projectId,
          invitationId: command.payload.invitationId,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "revoke_guest_grant") {
        return completed(requestId, await this.foundation.revokeGuestGrant({
          projectId: command.projectId,
          grantId: command.payload.grantId,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "create_change") {
        const baselineId = typeof record(delivery.latestBaseline).id === "string"
          ? record(delivery.latestBaseline).id as string
          : null;
        const previousVersion = delivery.packageVersions.find((version) => (
          version.id === command.payload.fromProductionPackageVersionId
        ));
        if (!baselineId || !previousVersion) {
          return failure(requestId, "error", "scope_conflict");
        }
        if (previousVersion.baselineId === baselineId) {
          return failure(requestId, "unavailable", "operation_unavailable");
        }
        return completed(requestId, await this.execution.submitChangeRequest({
          projectId: command.projectId,
          packageId: previousVersion.packageId,
          fromBaselineId: previousVersion.baselineId,
          proposedBaselineId: baselineId,
          fromProductionPackageVersionId: previousVersion.id,
          reason: command.payload.reason,
          deltaCostRub: command.payload.deltaCostRub,
          deltaDays: command.payload.deltaDays,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }

      const packageIds = scope.accessScope === "package"
        ? scope.packageId ? [scope.packageId] : []
        : [...new Set(delivery.packageVersions.map((version) => version.packageId))];
      const executionDeliveries = await Promise.all(packageIds.map((packageId) => (
        this.execution.getExecutionDelivery({ projectId: command.projectId, packageId })
      )));

      if (command.kind === "review_change_impact") {
        const belongs = executionDeliveries.some((envelope) => (
          envelope.data.impactRuns.some((run) => (
            run.id === command.payload.impactRunId
            && rows(run.impacts).some((impact) => impact.id === command.payload.impactId)
          ))
        ));
        if (!belongs) return failure(requestId, "error", "scope_conflict");
        return completed(requestId, await this.execution.reviewChangeImpact({
          projectId: command.projectId,
          impactRunId: command.payload.impactRunId,
          impactId: command.payload.impactId,
          disposition: command.payload.disposition,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "upload_photo_evidence") {
        const belongs = executionDeliveries.some((envelope) => (
          envelope.data.milestones.some((milestone) => (
            milestone.id === command.payload.milestoneId
            && rows(milestone.areas).some((area) => area.areaNodeId === command.payload.areaNodeId)
          ))
        ));
        if (!belongs) return failure(requestId, "error", "scope_conflict");
        return completed(requestId, await this.execution.registerPhotoEvidence({
          projectId: command.projectId,
          milestoneId: command.payload.milestoneId,
          areaNodeId: command.payload.areaNodeId,
          sourceId: command.payload.sourceId,
          sourceRevisionId: command.payload.sourceRevisionId,
          capturedAt: command.payload.capturedAt,
          note: command.payload.note,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "review_photo_evidence") {
        const belongs = executionDeliveries.some((envelope) => (
          envelope.data.milestones.some((milestone) => rows(milestone.areas).some((area) => (
            rows(area.photos).some((photo) => photo.id === command.payload.photoEvidenceId)
          )))
        ));
        if (!belongs) return failure(requestId, "error", "scope_conflict");
        return completed(requestId, await this.execution.reviewPhotoEvidence({
          projectId: command.projectId,
          photoEvidenceId: command.payload.photoEvidenceId,
          decision: command.payload.decision,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "accept_milestone") {
        const belongs = executionDeliveries.some((envelope) => (
          envelope.data.milestones.some((milestone) => milestone.id === command.payload.milestoneId)
        ));
        if (!belongs) return failure(requestId, "error", "scope_conflict");
        return completed(requestId, await this.execution.acceptMilestone({
          projectId: command.projectId,
          milestoneId: command.payload.milestoneId,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      return failure(requestId, "unavailable", "operation_unavailable");
    } catch (error) {
      return failure(requestId, "error", errorCode(error));
    }
  }
}
