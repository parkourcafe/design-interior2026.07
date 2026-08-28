import {
  parseCommandMutation,
  type CommandMutation,
  type PostgresRpcClient,
} from "./contracts";
import { callRpc } from "./rpc";

/**
 * Результат системного ингеста источника — логический результат
 * `ingest_source_graph` (форма человеческой двери: системная дверь зовёт её
 * же и ничего к ответу не приписывает).
 */
export interface SourceIngestMutation {
  readonly ingestionId: string;
  readonly packageId: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
}

/**
 * Адаптер воркера ингеста источников (`20260825040000`, M3 backlog #5).
 * Все три RPC выданы только `service_role`; миграция падает, если до них
 * дотягиваются `anon`/`authenticated`.
 */
export class ProjectCeoIngestWorkerPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  /**
   * Очередь инвентаря без графа. Разбор конверта живёт в воркере: адаптер
   * отвечает за границу с базой, а не за контракт очереди.
   */
  async listSourceIngestBacklog(input: {
    readonly maxRows: number;
  }): Promise<unknown> {
    return callRpc(
      this.client,
      "projectceo_api",
      "list_source_ingest_backlog",
      { max_rows: input.maxRows },
    );
  }

  /**
   * Системная дверь ингеста. Воркер не передаёт ни байта содержимого — граф
   * синтезируется сервером из строки инвентаря, исполнение идёт от имени
   * зарегистрировавшего автора (см. шапку миграции `20260825040000`).
   */
  async ingestSourceGraphSystem(input: {
    readonly projectId: string;
    readonly logicalSourceId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<SourceIngestMutation>> {
    return parseCommandMutation<SourceIngestMutation>(
      await callRpc(
        this.client,
        "projectceo_api",
        "ingest_source_graph_system",
        {
          project_id: input.projectId,
          logical_source_id: input.logicalSourceId,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  /**
   * Durable отказ (контур DEC-036). Вызывается только когда системная дверь
   * завершилась отказом, который воркер не считает нормальным исходом гонки.
   */
  async recordSourceIngestWorkerFailure(input: {
    readonly projectId: string;
    readonly logicalSourceId: string;
    readonly failureKind: "transient" | "permanent";
    readonly errorCode: string;
    readonly errorDetail?: Readonly<Record<string, unknown>> | null;
  }): Promise<unknown> {
    return callRpc(
      this.client,
      "projectceo_api",
      "record_source_ingest_worker_failure",
      {
        p_project_id: input.projectId,
        p_logical_source_id: input.logicalSourceId,
        p_failure_kind: input.failureKind,
        p_error_code: input.errorCode,
        p_error_detail: input.errorDetail ?? null,
      },
    );
  }
}
