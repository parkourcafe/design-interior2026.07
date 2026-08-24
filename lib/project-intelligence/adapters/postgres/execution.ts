import type {
  CommandMutation,
  PostgresRpcClient,
} from "./contracts";
import { parseCommandMutation } from "./contracts";
import { callRpc } from "./rpc";

export type ProjectCeoHash = `sha256:${string}`;

export interface ChangeRequestMutation {
  readonly id: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly fromBaselineId: string;
  readonly proposedBaselineId: string;
  readonly fromProductionPackageVersionId: string;
  readonly initiatorRole: "client" | "architect" | "builder" | "owner";
  readonly reasonHash: ProjectCeoHash;
  readonly deltaCostRub: number;
  readonly deltaDays: number;
  readonly rootCount: number;
  readonly status: "submitted";
}

export interface ImpactRunMutation {
  readonly id: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly changeRequestId: string;
  readonly targetBaselineId: string;
  readonly targetGraphVersionId: string;
  readonly impactCount: number;
  readonly impacts: readonly Readonly<Record<string, unknown>>[];
  readonly algorithm: Readonly<Record<string, unknown>>;
  readonly resultHash: ProjectCeoHash;
  /** Неполнота прогона — часть результата, а не служебная деталь. */
  readonly isTruncated: boolean;
  readonly truncationReason: "depth_limit" | "result_limit" | null;
  readonly calculatedDepth: number;
  readonly policyMaxDepth: number;
}

export interface ImpactReviewMutation {
  readonly id: string;
  readonly impactRunId: string;
  readonly impactId: string;
  readonly disposition: "accepted" | "resolved" | "dismissed";
  readonly reasonHash: ProjectCeoHash;
  /**
   * Рассмотрены ли все ВОЗВРАЩЁННЫЕ карточки. Вакуумно true, когда карточек
   * ноль (blocked) — просмотреть все показанные не значит «анализ завершён».
   */
  readonly allReturnedImpactsReviewed: boolean;
  /** Покрытие исчерпано внутри политики: coverage_status = 'complete'. */
  readonly coverageComplete: boolean;
  /** `allReturnedImpactsReviewed` AND `coverageComplete`; override не существует (DEC-034). */
  readonly impactReviewComplete: boolean;
  readonly everyImpactReviewed: boolean;
  readonly isTruncated: boolean;
  readonly truncationReason: "depth_limit" | "result_limit" | null;
  readonly reviewedBy: {
    readonly actorId: string;
    readonly actorType: "human";
  };
}

export interface MilestoneMutation {
  readonly id: string;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly baselineId: string;
  readonly graphVersionId: string;
  readonly title: string;
  readonly areaNodeIds: readonly string[];
  readonly areaCount: number;
}

export interface PhotoEvidenceMutation {
  readonly id: string;
  readonly milestoneId: string;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly areaNodeId: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly sourceChecksum: ProjectCeoHash;
  readonly capturedAt: string;
  readonly status: "awaiting_review";
}

export interface PhotoEvidenceReviewMutation {
  readonly id: string;
  readonly photoEvidenceId: string;
  readonly decision: "accepted" | "rejected";
  readonly reasonHash: ProjectCeoHash;
  readonly reviewedBy: {
    readonly actorId: string;
    readonly actorType: "human";
  };
}

export interface MilestoneAcceptanceMutation {
  readonly id: string;
  readonly milestoneId: string;
  readonly semanticContent: Readonly<Record<string, unknown>>;
  readonly semanticHash: ProjectCeoHash;
  readonly status: "accepted";
}

export interface HandoverDocumentMutation {
  readonly id: string;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly documentKind: "acceptance_act" | "warranty" | "manual";
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly sourceChecksum: ProjectCeoHash;
}

export interface ConstructionHandoverMutation {
  readonly id: string;
  readonly contractVersion: "project-ceo-construction-handover/0.1";
  readonly hashContract: {
    readonly algorithm: "sha256";
    readonly canonicalization: string;
    readonly encoding: "utf-8";
    readonly excludedVolatileFields: readonly string[];
    readonly hashedField: "semanticContent";
  };
  readonly semanticContent: Readonly<Record<string, unknown>>;
  readonly semanticHash: ProjectCeoHash;
}

export interface ExecutionDeliveryProjection {
  readonly changeRequests: readonly Readonly<Record<string, unknown>>[];
  readonly impactRuns: readonly Readonly<Record<string, unknown>>[];
  readonly milestones: readonly Readonly<Record<string, unknown>>[];
  readonly handoverDocuments: readonly Readonly<Record<string, unknown>>[];
  readonly constructionHandovers: readonly Readonly<Record<string, unknown>>[];
}

export interface ExecutionDeliveryEnvelope {
  readonly contractVersion: "project-ceo-m4-delivery/0.1";
  readonly requestId: string;
  readonly data: ExecutionDeliveryProjection;
  readonly error: null;
  readonly scope: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly packageId: string;
  };
  readonly stateRevision: number;
}

function parseExecutionDelivery(value: unknown): ExecutionDeliveryEnvelope {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
    candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  if (!isRecord(value)) {
    throw new Error("Invalid ProjectCEO M4 delivery envelope");
  }
  const data = value.data;
  const scope = value.scope;
  if (!isRecord(data) || !isRecord(scope)) {
    throw new Error("Invalid ProjectCEO M4 delivery envelope");
  }
  const dataKeys = [
    "changeRequests",
    "impactRuns",
    "milestones",
    "handoverDocuments",
    "constructionHandovers",
  ] as const;
  const validArrays = dataKeys.every((key) =>
    Array.isArray(data[key])
    && data[key].every(isRecord));
  const validScope = [
    scope.organizationId,
    scope.projectId,
    scope.packageId,
  ].every((id) => typeof id === "string" && uuid.test(id));
  if (
    value.contractVersion !== "project-ceo-m4-delivery/0.1"
    || typeof value.requestId !== "string"
    || value.requestId.length === 0
    || value.error !== null
    || !validArrays
    || !validScope
    || typeof value.stateRevision !== "number"
    || !Number.isSafeInteger(value.stateRevision)
    || value.stateRevision < 0
  ) {
    throw new Error("Invalid ProjectCEO M4 delivery envelope");
  }
  return value as unknown as ExecutionDeliveryEnvelope;
}

/**
 * Request-bound authenticated-human operations. PostgreSQL derives the actor,
 * organization, package access and effective role from the authenticated
 * request; none of those security attributes are accepted from application
 * input.
 */
export class ProjectCeoM4HumanPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  private async requestBoundReplay<T>(
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<CommandMutation<T> | null> {
    const value = await callRpc(
      this.client,
      "projectceo_m4_api",
      functionName,
      args,
    );
    return value === null ? null : parseCommandMutation<T>(value);
  }

  async submitChangeRequest(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly fromBaselineId: string;
    readonly proposedBaselineId: string;
    readonly fromProductionPackageVersionId: string;
    readonly reason: string;
    readonly deltaCostRub: number;
    readonly deltaDays: number;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ChangeRequestMutation>> {
    const request = {
      project_id: input.projectId,
      package_id: input.packageId,
      from_baseline_id: input.fromBaselineId,
      proposed_baseline_id: input.proposedBaselineId,
      from_production_package_version_id:
        input.fromProductionPackageVersionId,
      reason: input.reason,
      delta_cost_rub: input.deltaCostRub,
      delta_days: input.deltaDays,
      idempotency_key: input.idempotencyKey,
    };
    const replay = await this.requestBoundReplay<ChangeRequestMutation>(
      "replay_submit_change_request",
      request,
    );
    if (replay) return replay;
    return parseCommandMutation<ChangeRequestMutation>(
      await callRpc(this.client, "projectceo_m4_api", "submit_change_request", {
        ...request,
        expected_state_revision: input.expectedStateRevision,
      }),
    );
  }

  async reviewChangeImpact(input: {
    readonly projectId: string;
    readonly impactRunId: string;
    readonly impactId: string;
    readonly disposition: "accepted" | "resolved" | "dismissed";
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ImpactReviewMutation>> {
    const request = {
      project_id: input.projectId,
      impact_run_id: input.impactRunId,
      impact_id: input.impactId,
      disposition: input.disposition,
      reason: input.reason,
      idempotency_key: input.idempotencyKey,
    };
    const replay = await this.requestBoundReplay<ImpactReviewMutation>(
      "replay_review_change_impact",
      request,
    );
    if (replay) return replay;
    return parseCommandMutation<ImpactReviewMutation>(
      await callRpc(this.client, "projectceo_m4_api", "review_change_impact", {
        ...request,
        expected_state_revision: input.expectedStateRevision,
      }),
    );
  }

  async defineMilestone(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly productionPackageVersionId: string;
    readonly title: string;
    readonly areaNodeIds: readonly string[];
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<MilestoneMutation>> {
    return parseCommandMutation<MilestoneMutation>(
      await callRpc(this.client, "projectceo_m4_api", "define_milestone", {
        project_id: input.projectId,
        package_id: input.packageId,
        production_package_version_id: input.productionPackageVersionId,
        title: input.title,
        area_node_ids: input.areaNodeIds,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async registerPhotoEvidence(input: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly areaNodeId: string;
    readonly sourceId: string;
    readonly sourceRevisionId: string;
    readonly capturedAt: string;
    readonly note: string | null;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<PhotoEvidenceMutation>> {
    const request = {
      project_id: input.projectId,
      milestone_id: input.milestoneId,
      area_node_id: input.areaNodeId,
      source_id: input.sourceId,
      source_revision_id: input.sourceRevisionId,
      captured_at: input.capturedAt,
      note: input.note,
      idempotency_key: input.idempotencyKey,
    };
    const replay = await this.requestBoundReplay<PhotoEvidenceMutation>(
      "replay_register_photo_evidence",
      request,
    );
    if (replay) return replay;
    return parseCommandMutation<PhotoEvidenceMutation>(
      await callRpc(this.client, "projectceo_m4_api", "register_photo_evidence", {
        ...request,
        expected_state_revision: input.expectedStateRevision,
      }),
    );
  }

  async reviewPhotoEvidence(input: {
    readonly projectId: string;
    readonly photoEvidenceId: string;
    readonly decision: "accepted" | "rejected";
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<PhotoEvidenceReviewMutation>> {
    const request = {
      project_id: input.projectId,
      photo_evidence_id: input.photoEvidenceId,
      decision: input.decision,
      reason: input.reason,
      idempotency_key: input.idempotencyKey,
    };
    const replay = await this.requestBoundReplay<PhotoEvidenceReviewMutation>(
      "replay_review_photo_evidence",
      request,
    );
    if (replay) return replay;
    return parseCommandMutation<PhotoEvidenceReviewMutation>(
      await callRpc(this.client, "projectceo_m4_api", "review_photo_evidence", {
        ...request,
        expected_state_revision: input.expectedStateRevision,
      }),
    );
  }

  async acceptMilestone(input: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<MilestoneAcceptanceMutation>> {
    const request = {
      project_id: input.projectId,
      milestone_id: input.milestoneId,
      idempotency_key: input.idempotencyKey,
    };
    const replay = await this.requestBoundReplay<MilestoneAcceptanceMutation>(
      "replay_accept_milestone",
      request,
    );
    if (replay) return replay;
    return parseCommandMutation<MilestoneAcceptanceMutation>(
      await callRpc(this.client, "projectceo_m4_api", "accept_milestone", {
        ...request,
        expected_state_revision: input.expectedStateRevision,
      }),
    );
  }

  async registerHandoverDocument(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly productionPackageVersionId: string;
    readonly documentKind: HandoverDocumentMutation["documentKind"];
    readonly sourceId: string;
    readonly sourceRevisionId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<HandoverDocumentMutation>> {
    return parseCommandMutation<HandoverDocumentMutation>(
      await callRpc(
        this.client,
        "projectceo_m4_api",
        "register_handover_document",
        {
          project_id: input.projectId,
          package_id: input.packageId,
          production_package_version_id: input.productionPackageVersionId,
          document_kind: input.documentKind,
          source_id: input.sourceId,
          source_revision_id: input.sourceRevisionId,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  async getExecutionDelivery(input: {
    readonly projectId: string;
    readonly packageId: string;
  }): Promise<ExecutionDeliveryEnvelope> {
    return parseExecutionDelivery(
      await callRpc(this.client, "projectceo_m4_api", "get_execution_delivery", {
        project_id: input.projectId,
        package_id: input.packageId,
      }),
    );
  }
}

/** Worker-only deterministic graph traversal and archive construction. */
export class ProjectCeoM4WorkerPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async calculateChangeImpact(input: {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly maxDepth: number;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ImpactRunMutation>> {
    return parseCommandMutation<ImpactRunMutation>(
      await callRpc(
        this.client,
        "projectceo_m4_api",
        "calculate_change_impact",
        {
          project_id: input.projectId,
          change_request_id: input.changeRequestId,
          max_depth: input.maxDepth,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  /**
   * Очередь заявок без прогона влияния — системное чтение
   * (`20260812010000`, права только у service role). Разбор конверта живёт в
   * воркере: адаптер отвечает за границу с базой, а не за контракт очереди.
   */
  async listChangeImpactBacklog(input: {
    readonly maxRows: number;
  }): Promise<unknown> {
    return callRpc(
      this.client,
      "projectceo_m4_api",
      "list_change_impact_backlog",
      { max_rows: input.maxRows },
    );
  }

  /**
   * Дверь воркера. Глубина обхода СЮДА НЕ ПЕРЕДАЁТСЯ — её берёт из versioned
   * политики сама база (`_impact_policy`). Это и есть смысл двери: пока
   * глубина была аргументом, два воркера с разными числами давали разный
   * результат на одном графе, и «детерминированный расчёт» держался на том,
   * что никто не ошибётся в вызове.
   */
  async calculateChangeImpactPolicyBound(input: {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ImpactRunMutation>> {
    return parseCommandMutation<ImpactRunMutation>(
      await callRpc(
        this.client,
        "projectceo_m4_api",
        "calculate_change_impact_policy_bound",
        {
          project_id: input.projectId,
          change_request_id: input.changeRequestId,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  /**
   * Durable отказ (DEC-036, OWNER REVIEW 12.08.2026). Вызывается только когда
   * `calculateChangeImpactPolicyBound` завершился отказом, который сам
   * воркер не считает нормальным исходом гонки (`already_present`,
   * `stale_state`) — то есть транзиентной или постоянной ошибкой. Ответ несёт
   * итог upsert'а (счётчик попыток, статус, следующая попытка), а не только
   * факт записи: вызывающий по нему решает, продолжать ли считать проход
   * незакрытым.
   */
  async recordChangeImpactWorkerFailure(input: {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly failureKind: "transient" | "permanent";
    readonly errorCode: string;
    readonly errorDetail?: Readonly<Record<string, unknown>> | null;
  }): Promise<unknown> {
    return callRpc(
      this.client,
      "projectceo_m4_api",
      "record_change_impact_worker_failure",
      {
        project_id: input.projectId,
        change_request_id: input.changeRequestId,
        failure_kind: input.failureKind,
        error_code: input.errorCode,
        error_detail: input.errorDetail ?? null,
      },
    );
  }

  async buildConstructionHandover(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly productionPackageVersionId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ConstructionHandoverMutation>> {
    return parseCommandMutation<ConstructionHandoverMutation>(
      await callRpc(
        this.client,
        "projectceo_m4_api",
        "build_construction_handover",
        {
          project_id: input.projectId,
          package_id: input.packageId,
          production_package_version_id: input.productionPackageVersionId,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }
}
