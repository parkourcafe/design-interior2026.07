import type {
  CommandMutation,
  PostgresRpcClient,
} from "./contracts";
import { parseCommandMutation } from "./contracts";
import { callRpc } from "./rpc";
import { z } from "zod";

const nativeId = z.string().min(1).max(160).refine(value => value === value.trim());
const nativeDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nativeLayout = z.object({documentId:nativeId,versionId:nativeId,revisionId:nativeId,semanticHash:nativeDigest}).strict();
const nativeHandoff = z.object({handoffId:nativeId,revisionId:nativeId,revisionNo:z.number().int().positive().safe(),
  contractVersion:z.string().min(1),packageId:z.string().uuid(),roomId:nativeId,approvedM2CommitRevisionId:nativeId,
  designIntentRevisionId:nativeId,layout:nativeLayout,selectionRevisionIds:z.array(nativeId)}).strict();
const nativeSheet = z.object({sheetId:nativeId,packageId:z.string().uuid(),roomId:nativeId,sheetNumber:z.string().min(1).max(64),
  title:z.string().min(1).max(400),revisionId:nativeId,revisionNo:z.number().int().positive().safe(),
  specificationRevisionIds:z.array(nativeId),origin:z.object({handoffId:nativeId,handoffRevisionId:nativeId,
    handoffContractVersion:z.string().min(1),approvedM2CommitRevisionId:nativeId,designIntentRevisionId:nativeId,
    layoutDocumentId:nativeId,layoutVersionId:nativeId,layoutRevisionId:nativeId,semanticHash:nativeDigest}).strict()}).strict();
const nativeContext = z.object({schemaVersion:z.literal("remhaos.native-m3-release-context/1"),
  scope:z.object({organizationId:z.string().uuid(),projectId:z.string().uuid(),packageId:z.string().uuid()}).strict(),
  stateRevision:z.number().int().nonnegative().safe(),baselineId:nativeId.nullable(),previousVersionId:nativeId.nullable(),
  handoffs:z.array(nativeHandoff),sheets:z.array(nativeSheet),baselineDecisionRevisionIds:z.array(nativeId),
  baselineSelectionRevisionIds:z.array(nativeId),findings:z.array(z.object({code:z.enum([
    "BASELINE_REQUIRED","PACKAGE_NOT_IN_BASELINE","HANDOFF_REQUIRED","ROOM_WITHOUT_SHEET","SPECIFICATION_NOT_COVERED",
    "SHEET_FROM_OTHER_HANDOFF","SHEET_ORIGIN_MISMATCH","DUPLICATE_SHEET_NUMBER","HANDOFF_SELECTION_NOT_IN_BASELINE",
    "HANDOFF_DESIGN_INTENT_NOT_IN_BASELINE","BASELINE_SELECTION_WITHOUT_HANDOFF",
  ]),subject:z.string()}).strict()),structurallyComplete:z.boolean(),contextDigest:nativeDigest}).strict();
export type NativeM3ReleaseContext = z.infer<typeof nativeContext>;

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
 * mutation RPCs plus an authorized read-only native release context. Reading a
 * structurally complete context does not publish, approve content or open M3.
 */
export class ProjectCeoM3HumanPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async getNativeReleaseContext(input: {readonly projectId:string;readonly packageId:string}):
  Promise<{readonly requestId:string;readonly data:NativeM3ReleaseContext}> {
    z.string().uuid().parse(input.projectId);z.string().uuid().parse(input.packageId);
    if (input.packageId === input.projectId) throw new Error("native_m3_work_package_required");
    const raw = await callRpc(this.client,"projectceo_m3_api","get_native_m3_release_context",{
      project_id:input.projectId,package_id:input.packageId,
    });
    const parsed = z.object({requestId:z.string().refine(value => value.startsWith("db:")
      && z.string().uuid().safeParse(value.slice(3)).success),data:nativeContext,error:z.null()}).safeParse(raw);
    if (!parsed.success) throw new Error("native_m3_release_context_invalid");
    const {data,requestId}=parsed.data;
    if (data.scope.projectId!==input.projectId || data.scope.packageId!==input.packageId
      || data.handoffs.some(row=>row.packageId!==input.packageId) || data.sheets.some(row=>row.packageId!==input.packageId)) {
      throw new Error("native_m3_release_context_scope_mismatch");
    }
    if (data.structurallyComplete !== (data.findings.length===0)
      || (data.structurallyComplete && (!data.baselineId || !data.handoffs.length || !data.sheets.length))) {
      throw new Error("native_m3_release_context_inconsistent");
    }
    // Digest is server-owned; do not substitute a differently canonicalized
    // client hash, nor treat metadata completeness as runtime/content proof.
    return {requestId,data};
  }

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
