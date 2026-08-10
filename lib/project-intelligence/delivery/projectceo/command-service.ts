import "server-only";

import {
  Db2HumanPostgresAdapter,
  FoundationPostgresAdapter,
  ProjectCeoM3HumanPostgresAdapter,
  ProjectCeoAuthenticatedReadPostgresAdapter,
  ProjectBrainHumanPostgresAdapter,
  ProjectCeoM4HumanPostgresAdapter,
  ProjectIntelligenceAdapterError,
  type CommandMutation,
  type FoundationErrorCode,
  type PostgresRpcClient,
  type ProductDeliveryProjection,
  type ProjectListItem,
} from "../../adapters/postgres";
import { deriveOpaqueToken } from "../../adapters/storage";
import {
  PROJECTCEO_COMMAND_CONTRACT_VERSION,
  type ProjectCeoCommand,
  type ProjectCeoCommandResponse,
} from "./command-contract";
import { isDocumentationModuleEnabled } from "./documentation-flag";

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
  "publish_release",
  "build_handover",
]);

// Intake — поверхность модуля 3, поэтому она закрыта его флагом (A5 §4.2.2).
// Проверка серверная и стоит до чтений и записей: при выключенном модуле
// команда не доходит ни до одного RPC.
const DOCUMENTATION_MODULE = new Set<ProjectCeoCommand["kind"]>([
  "register_source",
  "review_source",
  "register_documentation_sheet",
  "attach_documentation_sheet_specifications",
]);

const MAX_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_INVITATION_TTL_MS = 5 * 60 * 1000;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function rows(value: unknown): readonly UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function semanticHash(value: unknown): `sha256:${string}` | null {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/i.test(value)
    ? value as `sha256:${string}`
    : null;
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

function completedReplay(
  requestId: string,
  operation: string,
  stateRevision: number,
  result: UnknownRecord,
): ProjectCeoCommandResponse {
  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    requestId,
    status: "completed",
    operation,
    replay: true,
    stateRevision,
    result,
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
  readonly tokenSecret?: string;
  readonly now?: () => Date;
  /** Значение REMHAOS_DOCUMENTATION_ENABLED; по умолчанию читается из окружения. */
  readonly documentationEnabled?: string;
}

/**
 * Human-command orchestration. The request body carries a project selector and
 * target resource IDs only. Membership, effective role, organization, exact
 * package, state revision and idempotency key are always re-derived server-side
 * for this request, and every mutation is finally authorized again by the RPC.
 */
export class ProjectCeoCommandService {
  private readonly foundation: FoundationPostgresAdapter;
  private readonly read: ProjectCeoAuthenticatedReadPostgresAdapter;
  private readonly product: ProjectBrainHumanPostgresAdapter;
  private readonly execution: ProjectCeoM4HumanPostgresAdapter;
  private readonly db2: Db2HumanPostgresAdapter;
  private readonly m3: ProjectCeoM3HumanPostgresAdapter;

  constructor(private readonly dependencies: ProjectCeoCommandDependencies) {
    this.foundation = new FoundationPostgresAdapter(dependencies.client);
    this.db2 = new Db2HumanPostgresAdapter(dependencies.client);
    this.m3 = new ProjectCeoM3HumanPostgresAdapter(dependencies.client);
    this.read = new ProjectCeoAuthenticatedReadPostgresAdapter(dependencies.client);
    this.product = new ProjectBrainHumanPostgresAdapter(dependencies.client);
    this.execution = new ProjectCeoM4HumanPostgresAdapter(dependencies.client);
  }

  private idempotencyKey(command: ProjectCeoCommand): string {
    return `ui:${command.projectId}:${command.kind}:${command.commandId}`;
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
    if (
      DOCUMENTATION_MODULE.has(command.kind)
      && !isDocumentationModuleEnabled(this.dependencies.documentationEnabled)
    ) {
      return failure(requestId, "unavailable", "operation_unavailable");
    }
    if (
      command.kind === "create_invitation"
      && (
        !this.dependencies.tokenSecret
        || new TextEncoder().encode(this.dependencies.tokenSecret).byteLength < 32
      )
    ) {
      return failure(requestId, "unavailable", "operation_unavailable");
    }
    try {
      const { scope, delivery } = await this.context(command.projectId);
      const idempotencyKey = this.idempotencyKey(command);
      if (command.kind === "submit_m2_client_review") {
        return completed(requestId, await this.product.submitM2ClientReview({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          submissionId: command.payload.submissionId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          approvalPackageId: command.payload.approvalPackageId,
          roomId: command.payload.roomId,
          designIntentRevisionId: command.payload.designIntentRevisionId,
          variants: command.payload.variants,
          budgetAsOf: command.payload.budgetAsOf,
          staleAfterDays: command.payload.staleAfterDays,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "review_m2_client_submission") {
        return completed(requestId, await this.product.reviewM2ClientSubmission({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          submissionId: command.payload.submissionId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          chosenVariantId: command.payload.chosenVariantId,
          decision: command.payload.decision,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "publish_m2_m3_handoff") {
        return completed(requestId, await this.product.publishM2M3Handoff({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          handoffId: command.payload.handoffId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          approvedCommitId: command.payload.approvedCommitId,
          approvedCommitRevisionId: command.payload.approvedCommitRevisionId,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "register_documentation_sheet") {
        // Происхождение листа в команде отсутствует: сервер выведет его из
        // опубликованного handoff, а подменить его параметрами нельзя — их нет.
        return completed(requestId, await this.m3.registerDocumentationSheet({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          handoffId: command.payload.handoffId,
          handoffRevisionId: command.payload.handoffRevisionId,
          sheetId: command.payload.sheetId,
          sheetNumber: command.payload.sheetNumber,
          title: command.payload.title,
          revisionId: command.payload.revisionId,
          specificationRevisionIds: command.payload.specificationRevisionIds,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "attach_documentation_sheet_specifications") {
        return completed(requestId, await this.m3.attachDocumentationSheetSpecifications({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          sheetId: command.payload.sheetId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          specificationRevisionIds: command.payload.specificationRevisionIds,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "register_source") {
        // Запись инвентаря пишет сервер: план импорта не приходит из браузера,
        // он выводится из самой команды, а RPC сверяет его projectId со своим.
        return completed(requestId, await this.foundation.registerSourceInventory({
          projectId: command.projectId,
          records: [{
            physicalRecordId: command.payload.physicalRecordId,
            sanitizedName: command.payload.sanitizedName,
            hierarchy: {
              projectId: command.projectId,
              packageId: command.payload.packageId,
              floorId: command.payload.floorId,
              zoneId: command.payload.zoneId,
              disciplineId: command.payload.disciplineId,
            },
            availability: command.payload.availability,
            documentStatus: command.payload.documentStatus,
            sizeBytes: command.payload.sizeBytes,
            checksum: command.payload.checksum,
            sourceRevisionId: command.payload.sourceRevisionId,
            semanticConflict: command.payload.semanticConflict,
          }],
          importPlan: {
            projectId: command.projectId,
            packageId: command.payload.packageId,
            origin: "projectceo_command",
            physicalRecordIds: [command.payload.physicalRecordId],
          },
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "review_source") {
        // Ревизия обязана быть ревизией источника, видимого этому человеку в
        // его же области доступа. Без этой сверки команда стала бы обобщённым
        // review_claim по любому идентификатору ревизии проекта — поверхность
        // шире той, которую открывает M3 P0.
        const read = await this.read.getProjectWorkspaceRead({
          projectId: command.projectId,
          packageId: scope.accessScope === "package" ? scope.packageId ?? null : null,
        });
        if (read.error) {
          throw new ProjectIntelligenceAdapterError(read.error.code, null);
        }
        const target = read.data.sources.find((source) => (
          source.reviewTargetRevisionId === command.payload.targetRevisionId
        ));
        if (!target) return failure(requestId, "error", "not_found");
        if (target.reviewStatus !== "pending") {
          return failure(requestId, "error", "scope_conflict");
        }
        return completed(requestId, await this.db2.reviewClaim({
          projectId: command.projectId,
          targetRevisionId: command.payload.targetRevisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          decision: command.payload.decision,
          expectedStateRevision: read.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "create_invitation") {
        const tokenSecret = this.dependencies.tokenSecret!;
        const now = (this.dependencies.now ?? (() => new Date()))();
        const expiresAt = new Date(command.payload.expiresAt);
        const ttlMs = expiresAt.getTime() - now.getTime();
        if (
          !Number.isFinite(expiresAt.getTime())
          || ttlMs < MIN_INVITATION_TTL_MS
          || ttlMs > MAX_INVITATION_TTL_MS
        ) {
          return failure(requestId, "error", "validation_failed");
        }
        const recipientEmail = command.payload.recipientEmail.trim().toLowerCase();
        const role = command.payload.targetRole === "client"
          ? "client_approver"
          : command.payload.targetRole;
        const token = deriveOpaqueToken({
          secret: tokenSecret,
          namespace: "invitation",
          scope: [
            command.projectId,
            recipientEmail,
            role,
            command.payload.expiresAt,
          ].join("\0"),
          idempotencyKey,
        });
        const mutation = await this.foundation.createInvitation({
          projectId: command.projectId,
          packageId: null,
          recipientEmail,
          role,
          expiresAt: command.payload.expiresAt,
          tokenDigest: token.tokenDigest,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        });
        return completed(requestId, mutation, {
          ...record(mutation.result),
          invitationUrl: `/projectceo/invitations/${token.rawToken}`,
        });
      }
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
      if (command.kind === "create_decision") {
        // packageId/nodeId/areaNodeId membership не пере-проверяются здесь:
        // RPC append_decision_revision авторизует через
        // _authorize_package_human(project_id, package_id, 'revise_decision')
        // и само отвергает невалидный areaNodeId/decisionRevisionId — тот же
        // паттерн defense-in-depth, что у revoke_guest_grant выше.
        return completed(requestId, await this.product.appendDecisionRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          nodeId: command.payload.nodeId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          claimStatus: command.payload.claimStatus,
          title: command.payload.title,
          resolution: command.payload.resolution,
          areaNodeId: command.payload.areaNodeId,
          decisionStatus: command.payload.decisionStatus,
          evidence: command.payload.evidence,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "create_selection") {
        return completed(requestId, await this.product.appendSelectionRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          nodeId: command.payload.nodeId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          claimStatus: command.payload.claimStatus,
          title: command.payload.title,
          areaNodeId: command.payload.areaNodeId,
          decisionRevisionId: command.payload.decisionRevisionId,
          specification: command.payload.specification,
          evidence: command.payload.evidence,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "create_m2_room") {
        return completed(requestId, await this.product.appendM2WorkspaceRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          entityKind: "room",
          entityId: command.payload.roomId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          status: "draft",
          payload: { name: command.payload.name, areaM2: command.payload.areaM2 },
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "create_m2_variant") {
        return completed(requestId, await this.product.appendM2WorkspaceRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          entityKind: "variant",
          entityId: command.payload.variantId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          status: "draft",
          payload: {
            roomId: command.payload.roomId,
            title: command.payload.title,
            description: command.payload.description,
          },
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "create_m2_material") {
        return completed(requestId, await this.product.appendM2WorkspaceRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          entityKind: "material",
          entityId: command.payload.materialId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          status: "draft",
          payload: {
            variantId: command.payload.variantId,
            name: command.payload.name,
            supplierRef: command.payload.supplierRef,
            unit: command.payload.unit,
            unitCostRub: command.payload.unitCostRub,
            quantity: command.payload.quantity,
          },
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "set_m2_budget") {
        return completed(requestId, await this.product.appendM2WorkspaceRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          entityKind: "budget",
          entityId: command.payload.budgetId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          status: "draft",
          payload: {
            currency: "RUB",
            minRub: command.payload.minRub,
            maxRub: command.payload.maxRub,
            contingencyPct: command.payload.contingencyPct,
          },
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "create_m2_client_handoff") {
        return completed(requestId, await this.product.appendM2WorkspaceRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          entityKind: "client_handoff",
          entityId: command.payload.handoffId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          status: "submitted",
          payload: {
            approvalPackageId: command.payload.approvalPackageId,
            title: command.payload.title,
            note: command.payload.note,
          },
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "commit_m2_approval") {
        return completed(requestId, await this.product.appendM2WorkspaceRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          entityKind: "approved_commit",
          entityId: command.payload.commitId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          status: "approved",
          payload: {
            approvalPackageId: command.payload.approvalPackageId,
            roomId: command.payload.roomId,
            designIntentRevisionId: command.payload.designIntentRevisionId,
            chosenVariant: command.payload.chosenVariant,
            approvedSelectionRevisionIds: command.payload.approvedSelectionRevisionIds,
            budget: command.payload.budget,
            submittedAt: command.payload.submittedAt,
            reviewedAt: command.payload.reviewedAt,
            submissionReason: command.payload.submissionReason,
            reviewReason: command.payload.reviewReason,
          },
          reason: command.payload.reviewReason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "publish_m2_layout_version") {
        return completed(requestId, await this.product.appendM2WorkspaceRevision({
          projectId: command.projectId,
          packageId: command.payload.packageId,
          entityKind: "layout_version",
          entityId: command.payload.documentId,
          revisionId: command.payload.revisionId,
          expectedRevisionId: command.payload.expectedRevisionId,
          status: "published",
          payload: {
            versionId: command.payload.versionId,
            roomId: command.payload.roomId,
            variantId: command.payload.variantId,
            role: command.payload.role,
            semanticHash: command.payload.semanticHash,
            schemaVersion: command.payload.schemaVersion,
            layoutContent: command.payload.layoutContent,
          },
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "create_approval_package") {
        return completed(requestId, await this.product.createApprovalPackage({
          projectId: command.projectId,
          approvalPackage: {
            id: command.payload.approvalPackageId,
            packageId: command.payload.packageId,
            items: command.payload.items,
          },
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "submit_approval_package") {
        return completed(requestId, await this.product.submitApprovalPackage({
          projectId: command.projectId,
          approvalPackageId: command.payload.approvalPackageId,
          expectedStatus: command.payload.expectedStatus,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "review_selection") {
        return completed(requestId, await this.product.reviewApprovalPackage({
          projectId: command.projectId,
          approvalPackageId: command.payload.approvalPackageId,
          expectedStatus: command.payload.expectedStatus,
          decision: command.payload.decision,
          reason: command.payload.reason,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        }));
      }
      if (command.kind === "publish_baseline") {
        return completed(requestId, await this.product.publishProjectBaseline({
          projectId: command.projectId,
          descriptor: command.payload.descriptor,
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
      if (command.kind === "acknowledge_release") {
        const read = await this.read.getProjectWorkspaceRead({
          projectId: command.projectId,
          packageId: scope.accessScope === "package" ? scope.packageId ?? null : null,
        });
        if (read.error) {
          throw new ProjectIntelligenceAdapterError(read.error.code, null);
        }
        const distribution = read.data.recipientDistributions.find((item) => (
          item.distributionId === command.payload.distributionId
        ));
        const expectedSemanticHash = semanticHash(distribution?.semanticHash);
        if (!distribution || !expectedSemanticHash) {
          return failure(requestId, "error", "scope_conflict");
        }
        if (distribution.acknowledged) {
          return completedReplay(
            requestId,
            "acknowledge_release",
            read.stateRevision,
            {
              acknowledgedAt: distribution.acknowledgedAt,
              artifactId: distribution.artifactId,
              distributionId: distribution.distributionId,
              packageId: distribution.packageId,
              productionPackageVersionId: distribution.productionPackageVersionId,
              semanticHash: expectedSemanticHash,
            },
          );
        }
        const mutation = await this.product.acknowledgeReleaseRequestBound({
          projectId: command.projectId,
          distributionId: command.payload.distributionId,
          expectedSemanticHash,
          expectedStateRevision: scope.stateRevision,
          idempotencyKey,
        });
        // Keep the public command contract stable across the first response
        // and a request-bound replay. The database RPC name is an adapter
        // detail and must not leak into the client-visible operation.
        const stableResult = Object.fromEntries(
          Object.entries(record(mutation.result))
            .filter(([key]) => key !== "acknowledgementId"),
        );
        return completed(
          requestId,
          { ...mutation, operation: "acknowledge_release" },
          {
            ...stableResult,
            artifactId: distribution.artifactId,
          },
        );
      }
      if (command.kind === "distribute_release") {
        if (scope.role !== "owner_lead") {
          return failure(requestId, "error", "forbidden");
        }
        const read = await this.read.getProjectWorkspaceRead({
          projectId: command.projectId,
          packageId: scope.accessScope === "package" ? scope.packageId ?? null : null,
        });
        if (read.error) {
          throw new ProjectIntelligenceAdapterError(read.error.code, null);
        }
        const version = delivery.packageVersions.find((item) => (
          item.id === command.payload.productionPackageVersionId
        ));
        const artifact = rows(read.data.releaseArtifacts).find((item) => (
          item.productionPackageVersionId === command.payload.productionPackageVersionId
        ));
        const recipient = read.data.releaseRecipients.find((item) => (
          item.userId === command.payload.recipientUserId
          && (item.packageId === null || item.packageId === version?.packageId)
        ));
        const artifactId = typeof artifact?.artifactId === "string"
          ? artifact.artifactId
          : typeof artifact?.id === "string"
            ? artifact.id
            : null;
        if (!version || !artifactId || !recipient) {
          return failure(requestId, "error", "scope_conflict");
        }
        return completed(requestId, await this.product.distributeReleaseRequestBound({
          projectId: command.projectId,
          artifactId,
          recipientUserId: command.payload.recipientUserId,
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
