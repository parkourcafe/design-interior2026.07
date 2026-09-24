import { createHash } from "node:crypto";
import { z } from "zod";
import { callRpc } from "../../../lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "../../../lib/project-intelligence/adapters/postgres/contracts";
import { planSourceImport, type KoraInventoryRecord } from "../../../lib/project-intelligence/modules/package";
import { canonicalJson } from "../../../lib/project-intelligence/application/change-handoff/canonical";
import type { BoundScanClaim, BoundScanEvidence } from "../../../lib/integration-gateway/file-intake/bound-scan";
import { assertFileIntakeInternalKey } from "../../../lib/integration-gateway/file-intake/policy";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const completionSchema = z.object({ taskId: z.string().uuid(), intakeId: z.string().uuid(), receiptId: z.string().uuid(),
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/), outcome: z.literal("clean") });
type Completion = z.infer<typeof completionSchema>;
const object = z.record(z.unknown());
export interface ChildSourceObservation { readonly operation: string; readonly request: Readonly<Record<string, unknown>>; readonly response: unknown; readonly replay?: unknown; }

/** Local disposable orchestration, NOT a production import API or independent
 * scanner attestation. The harness owns the real human client and verified
 * worker transport. No business mutation is delegated to the SYSTEM ports.
 * Call before legacy root publish_file_intake registers the same checksum. */
export async function registerBoundChildSource(human: PostgresRpcClient, input: {
  readonly projectId: string; readonly packageId: string; readonly physicalRecordId: string;
  readonly alias: string; readonly sourceRevisionId: string; readonly key: string;
  readonly bytes: Uint8Array; readonly claim: BoundScanClaim; readonly evidence: BoundScanEvidence;
  readonly completion: Completion;
  readonly area?: { readonly nodeId: string; readonly revisionId: string; readonly title: string;
    readonly payload: Readonly<Record<string, unknown>> };
  readonly dependencyTargetNodeId?: string;
}, ports: {
  /** Replay the actual completed SYSTEM RPC with retained exact evidence/key;
   * it rechecks capability/gate/current authority. Never return a fixed true. */
  readonly confirmCompletion: (evidence: BoundScanEvidence) => Promise<Completion>;
  readonly readCanonical: (key: string, maxBytes: number) => Promise<Uint8Array>;
  /** Parse the exact verified bytes read above; never guess a page or cell. */
  readonly measureAnchor: (bytes: Uint8Array, kind: "pdf" | "image" | "spreadsheet") => Promise<unknown>;
  readonly retainObservation: (value: ChildSourceObservation) => Promise<void>;
}) {
  z.string().uuid().parse(input.projectId); z.string().uuid().parse(input.packageId); z.string().uuid().parse(input.physicalRecordId);
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/).parse(input.sourceRevisionId);
  z.string().min(1).max(150).parse(input.key);
  const area = input.area ? z.object({nodeId:z.string().min(1).max(160),revisionId:z.string().min(1).max(160),
    title:z.string().min(1).max(1000),payload:z.record(z.unknown())}).strict().parse(input.area) : null;
  const dependencyTargetNodeId=input.dependencyTargetNodeId
    ? z.string().min(1).max(160).parse(input.dependencyTargetNodeId) : null;
  const { claim, evidence } = input;
  const completion = completionSchema.parse(input.completion);
  if (input.packageId === input.projectId || claim.projectId !== input.projectId || claim.packageId !== input.projectId
    || !/^[a-z0-9_-]+\.(pdf|xlsx|jpg|png|webp)$/.test(input.alias) || input.alias.split(".").at(-1) !== claim.extension) throw new Error("CHILD_SOURCE_SCOPE_INVALID");
  const checksum = sha(input.bytes);
  if (!input.bytes.byteLength || checksum !== claim.checksumHex || input.bytes.byteLength !== claim.byteLength
    || evidence.outcome !== "clean" || evidence.exitCode !== 0 || completion.taskId !== claim.taskId || completion.intakeId !== claim.intakeId
    || evidence.taskId !== claim.taskId || evidence.nonce !== claim.nonce || evidence.attempt !== claim.attempt || evidence.fence !== claim.fence
    || evidence.sourceSha256 !== checksum || evidence.canonicalSha256 !== checksum || evidence.storageAfterSha256 !== checksum
    || evidence.byteLength !== input.bytes.byteLength || evidence.canonicalByteLength !== input.bytes.byteLength
    || canonicalJson(evidence.policy) !== canonicalJson(claim.policy)) throw new Error("CHILD_SOURCE_SCAN_BINDING_INVALID");
  assertFileIntakeInternalKey({objectKey:claim.canonicalKey,organizationId:claim.organizationId,projectId:input.projectId,
    checksumHex:checksum,sourceRole:claim.sourceRole,extension:claim.extension});
  const kind = claim.extension === "pdf" ? "pdf" : claim.extension === "xlsx" ? "spreadsheet"
    : ["jpg","png","webp"].includes(claim.extension) ? "image" : null;
  if (!kind) throw new Error("CHILD_SOURCE_KIND_UNSUPPORTED");
  const authorizationArgs = {project_id:input.projectId,package_id:input.packageId,checksum_hex:checksum,
    media_type:claim.mediaType,extension:claim.extension,size_bytes:input.bytes.byteLength,source_role:claim.sourceRole};
  const authorization = object.parse(await callRpc(human,"projectceo_api","authorize_source_upload",authorizationArgs));
  const data = object.parse(authorization.data);
  if (data.projectId !== input.projectId || data.packageId !== input.packageId || data.bucket !== "client-uploads"
    || data.objectKey !== claim.canonicalKey || data.checksum !== checksum || data.mediaType !== claim.mediaType || data.upsert !== false) throw new Error("CHILD_SOURCE_AUTHORIZATION_MISMATCH");
  await ports.retainObservation({operation:"authorize_source_upload",request:authorizationArgs,response:authorization});
  const confirmed = completionSchema.parse(await ports.confirmCompletion(evidence));
  if (canonicalJson(confirmed) !== canonicalJson(completion)) throw new Error("CHILD_SOURCE_COMPLETION_CHANGED");
  const stored = await ports.readCanonical(claim.canonicalKey,input.bytes.byteLength);
  if (stored.byteLength !== input.bytes.byteLength || sha(stored) !== checksum) throw new Error("CHILD_SOURCE_CANONICAL_CHANGED");
  const anchor = z.object({sourceSha256:z.string(),method:z.string().min(1).max(100),locator:z.discriminatedUnion("kind",[
    z.object({kind:z.literal("pdf"),page:z.number().int().positive()}).strict(),
    z.object({kind:z.literal("spreadsheet"),sheet:z.string().min(1).max(31),cellRange:z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/)}).strict(),
    z.object({kind:z.literal("image"),coordinateSystem:z.literal("normalized"),bbox:z.tuple([z.literal(0),z.literal(0),z.literal(1),z.literal(1)])}).strict(),
  ])}).strict().parse(await ports.measureAnchor(stored,kind));
  if (anchor.sourceSha256 !== checksum || anchor.locator.kind !== kind) throw new Error("CHILD_SOURCE_ANCHOR_UNBOUND");
  await ports.retainObservation({operation:"measure_source_identity_anchor",request:{sourceSha256:checksum,byteLength:stored.byteLength},response:anchor});

  const state = async () => {
    const result = object.parse(await callRpc(human,"projectceo_api","list_projects"));
    const projects = z.array(z.object({projectId:z.string().uuid(),stateRevision:z.number().int().nonnegative()})).parse(result.data);
    const project = projects.find(p=>p.projectId===input.projectId);
    if (!project) throw new Error("CHILD_SOURCE_PROJECT_NOT_VISIBLE");
    return project.stateRevision;
  };
  const mutate = async (operation: string, args: Record<string,unknown>) => {
    const first = object.parse(await callRpc(human,"projectceo_api",operation,args));
    // Retain first outcome before retry; a retry failure must not erase it.
    await ports.retainObservation({operation,request:args,response:first});
    const replay = object.parse(await callRpc(human,"projectceo_api",operation,args));
    if (replay.replay !== true || canonicalJson(first.result) !== canonicalJson(replay.result)
      || first.stateRevision !== replay.stateRevision) throw new Error("CHILD_SOURCE_REPLAY_MISMATCH");
    await ports.retainObservation({operation,request:args,response:first,replay});
    return first;
  };
  const sourceId = `source-sha256-${checksum.slice(0,24)}`;
  const record: KoraInventoryRecord = {physicalRecordId:input.physicalRecordId,sanitizedName:input.alias,
    hierarchy:{projectId:input.projectId,packageId:input.packageId,floorId:"unassigned",zoneId:"unassigned",disciplineId:"unassigned"},
    availability:"materialized",documentStatus:"unknown",mediaKind:kind,sizeBytes:input.bytes.byteLength,checksum,
    sourceRevisionId:input.sourceRevisionId,semanticConflict:false};
  const registration = await mutate("register_source_inventory", {project_id:input.projectId,records:[record],import_plan:planSourceImport([record]),
    expected_state_revision:await state(),idempotency_key:`${input.key}:inventory`});
  const nodeId = `node-${sourceId}`;
  const fragmentId = `fragment-${input.physicalRecordId}`, evidenceLinkId = `identity-${input.physicalRecordId}`;
  const payload = {schemaVersion:"project-ceo/source-metadata/0.1",sourceId};
  const graphNodes: Array<Record<string, unknown>> = [{nodeId,kind:"source",stableKey:`source:${sourceId}`,currentRevisionId:input.sourceRevisionId}];
  const graphRevisions: Array<Record<string, unknown>> = [{revisionId:input.sourceRevisionId,nodeId,revisionNo:1,title:input.alias,payload,origin:"import",claimStatus:"extracted",
    unknownReason:null,replacesRevisionId:null,contentDigestHex:sha(JSON.stringify(payload))}];
  const graphEvidence: Array<Record<string, unknown>> = [{evidenceLinkId,nodeRevisionId:input.sourceRevisionId,sourceFragmentId:fragmentId}];
  if (area) {
    graphNodes.push({nodeId:area.nodeId,kind:"area",stableKey:`area:${area.nodeId}`,currentRevisionId:area.revisionId});
    graphRevisions.push({revisionId:area.revisionId,nodeId:area.nodeId,revisionNo:1,title:area.title,payload:area.payload,origin:"import",
      claimStatus:"extracted",unknownReason:null,replacesRevisionId:null,contentDigestHex:sha(JSON.stringify(area.payload))});
    graphEvidence.push({evidenceLinkId:`${evidenceLinkId}-area`,nodeRevisionId:area.revisionId,sourceFragmentId:fragmentId});
  }
  const graphEdges=dependencyTargetNodeId
    ? [{edgeId:`dependency-${input.physicalRecordId}`,fromNodeId:nodeId,toNodeId:dependencyTargetNodeId,relation:"depends_on"}]
    : [];
  const ingestion = await mutate("ingest_source_graph",{project_id:input.projectId,
    source:{sourceId,sourceRevisionId:input.sourceRevisionId,kind,checksumHex:checksum,packageId:input.packageId,
      metadata:{originalFilename:input.alias,mediaType:claim.mediaType,sizeBytes:input.bytes.byteLength,extension:claim.extension,
        sourceRole:claim.sourceRole,declaredRevision:null,documentStatus:"unknown"}},
    fragments:[{fragmentId,sourceId,locatorKind:anchor.locator.kind,locator:anchor.locator}],
    nodes:graphNodes,revisions:graphRevisions,evidence_links:graphEvidence,
    edges:graphEdges,expected_state_revision:await state(),idempotency_key:`${input.key}:graph`});
  const ingested = object.parse(ingestion.result);
  if (ingested.sourceId !== sourceId || ingested.sourceRevisionId !== input.sourceRevisionId || ingested.packageId !== input.packageId) throw new Error("CHILD_SOURCE_RESULT_BINDING_INVALID");
  return {sourceId,sourceRevisionId:input.sourceRevisionId,checksum,packageId:input.packageId,fragmentId,evidenceLinkId,
    areaEvidenceLinkId:area ? `${evidenceLinkId}-area` : null,anchor,registration,ingestion};
}
