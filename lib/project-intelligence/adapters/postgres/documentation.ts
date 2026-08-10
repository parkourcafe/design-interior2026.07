import type {
  CommandMutation,
  PostgresRpcClient,
} from "./contracts";
import { parseCommandMutation } from "./contracts";
import { callRpc } from "./rpc";

export interface DocumentationSheetMutation {
  readonly sheetId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly packageId: string;
  readonly roomId?: string;
  readonly specificationRevisionIds: readonly string[];
}

/**
 * Request-bound adapter for the private M3 schema. It reaches the two fixed
 * security-definer RPCs and nothing else — there is no read method here on
 * purpose, reads travel the authenticated projection.
 */
export class ProjectCeoM3HumanPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async registerDocumentationSheet(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly handoffId: string;
    readonly handoffRevisionId: string;
    readonly sheetId: string;
    readonly sheetNumber: string;
    readonly title: string;
    readonly revisionId: string;
    readonly specificationRevisionIds: readonly string[];
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<DocumentationSheetMutation>> {
    return parseCommandMutation(
      await callRpc(this.client, "projectceo_m3_api", "register_documentation_sheet", {
        project_id: input.projectId,
        package_id: input.packageId,
        handoff_id: input.handoffId,
        handoff_revision_id: input.handoffRevisionId,
        sheet_id: input.sheetId,
        sheet_number: input.sheetNumber,
        title: input.title,
        revision_id: input.revisionId,
        specification_revision_ids: input.specificationRevisionIds,
        reason: input.reason,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async attachDocumentationSheetSpecifications(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly sheetId: string;
    readonly revisionId: string;
    readonly expectedRevisionId: string;
    readonly specificationRevisionIds: readonly string[];
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<DocumentationSheetMutation>> {
    return parseCommandMutation(
      await callRpc(
        this.client,
        "projectceo_m3_api",
        "attach_documentation_sheet_specifications",
        {
          project_id: input.projectId,
          package_id: input.packageId,
          sheet_id: input.sheetId,
          revision_id: input.revisionId,
          expected_revision_id: input.expectedRevisionId,
          specification_revision_ids: input.specificationRevisionIds,
          reason: input.reason,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }
}
