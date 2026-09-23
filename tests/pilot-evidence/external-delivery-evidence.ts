import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, semanticSha256 } from "../../lib/project-intelligence/application/change-handoff/canonical";
import { EXTERNAL_RUN_ROLES, type ExternalRunSession } from "./external-pilot-receipt";

/**
 * Preparatory WP32 portable proof, NOT a runtime producer or a runtime PASS.
 * A trusted disposable executor must still harvest real command/replay results,
 * audit rows and scoped relational queries. Query rows below are camelCase
 * projections of persisted joins, not new DB columns. In particular baseline
 * source refs join immutable source revisions; release/acceptance joins follow
 * production_package_version_id, baseline_id, milestone_id and photo evidence.
 * Query bindings include the run challenge, manifest and exact command/audit.
 * Digests establish internal consistency, not authenticity: the caller must
 * separately verify producer provenance and supply trusted expected bindings.
 * There is deliberately NO global stateRevision counter across M2/product/M4.
 */
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/);
const uuid = z.string().uuid();
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const scopeSchema = z.object({ organizationId: uuid, projectId: uuid, packageId: uuid }).strict();
const upstreamSchema = z.object({ handoffId: id, handoffRevisionId: uuid, approvedCommitId: id, approvedCommitRevisionId: uuid }).strict();
// source_revisions use immutable text identifiers, not necessarily UUIDs.
const sourceSchema = z.object({ sourceId: id, sourceRevisionId: id, checksum: digest }).strict();
const humanSchema = z.object({ kind: z.literal("human"), role: z.enum(EXTERNAL_RUN_ROLES), userId: uuid, sessionId: uuid, sessionDigest: digest }).strict();
const workerSchema = z.object({ kind: z.literal("system_worker"), role: z.literal("service_role"), workerRunId: uuid }).strict();
const actorSchema = z.discriminatedUnion("kind", [humanSchema, workerSchema]);
const rowBase = scopeSchema.extend({ id, actor: actorSchema });
const baselineSchema = rowBase.extend({ ...upstreamSchema.shape, graphVersionId: id, approvalId: id, decisionRevisionId: uuid, sources: z.array(sourceSchema).min(1) }).strict();
const rows = {
  handoff: rowBase.extend(upstreamSchema.shape).strict(),
  approvalB1: rowBase.extend({ decision: z.literal("approved"), decisionRevisionId: uuid }).strict(),
  baselineB1: baselineSchema,
  release: rowBase.extend({ baselineId: id, productionPackageVersionId: id }).strict(),
  artifact: rowBase.extend({ baselineId: id, productionPackageVersionId: id, contentDigest: digest, byteLength: z.number().int().positive() }).strict(),
  distribution: rowBase.extend({ productionPackageVersionId: id, artifactId: id, recipientUserId: uuid }).strict(),
  acknowledgement: rowBase.extend({ distributionId: id, artifactId: id, productionPackageVersionId: id, recipientUserId: uuid }).strict(),
  approvalB2: rowBase.extend({ decision: z.literal("approved"), decisionRevisionId: uuid }).strict(),
  baselineB2: baselineSchema.extend({ previousBaselineId: id }).strict(),
  change: rowBase.extend({ fromBaselineId: id, proposedBaselineId: id, fromProductionPackageVersionId: id }).strict(),
  impact: rowBase.extend({ changeRequestId: id, fromBaselineId: id, proposedBaselineId: id, targetGraphVersionId: id,
    coverageStatus: z.literal("complete"), policyVersion: z.literal("project-ceo-impact-policy/0.2"),
    policyMaxDepth: z.literal(7), maxImpacts: z.literal(5000), calculatedDepth: z.number().int().min(0).max(7),
    isTruncated: z.literal(false), hasMoreBeyondDepth: z.literal(false), cutoffReason: z.null(), truncationReason: z.null(),
    returnedImpactCount: z.number().int().positive().max(5000), knownImpactCountLowerBound: z.number().int().positive(),
    impacts: z.array(z.object({ impactId: id, targetNodeId: id, targetRevisionId: id }).strict()).min(1),
  }).strict(),
  impactReview: rowBase.extend({ impactRunId: id, impactId: id, disposition: z.literal("resolved") }).strict(),
  milestone: rowBase.extend({ baselineId: id, productionPackageVersionId: id, graphVersionId: id, areaNodeId: id, areaRevisionId: id }).strict(),
  photo: rowBase.extend({ milestoneId: id, baselineId: id, productionPackageVersionId: id, graphVersionId: id,
    areaNodeId: id, areaRevisionId: id, source: sourceSchema, capturedAt: z.string().datetime() }).strict(),
  photoReview: rowBase.extend({ photoEvidenceId: id, decision: z.literal("accepted") }).strict(),
  acceptance: rowBase.extend({ milestoneId: id, baselineId: id, productionPackageVersionId: id,
    photoEvidenceIds: z.array(id).min(1), photoReviewIds: z.array(id).min(1), impactRunId: id }).strict(),
};
export const EXTERNAL_DELIVERY_STAGES = Object.keys(rows) as (keyof typeof rows)[];
type Stage = keyof typeof rows;
const operations: Record<Stage, string> = {
  handoff: "publish_m2_m3_handoff", approvalB1: "review_selection", baselineB1: "publish_baseline",
  release: "publish_release", artifact: "build_release_artifact", distribution: "distribute_release",
  acknowledgement: "acknowledge_release", approvalB2: "review_selection", baselineB2: "publish_baseline",
  change: "create_change", impact: "calculate_change_impact_policy_bound", impactReview: "review_change_impact",
  milestone: "define_milestone", photo: "upload_photo_evidence", photoReview: "review_photo_evidence", acceptance: "accept_milestone",
};
// Persisted audit operation names differ from application command aliases.
const auditOperations: Record<Stage, string> = { ...operations,
  approvalB1: "review_approval_package", approvalB2: "review_approval_package",
  baselineB1: "publish_project_baseline", baselineB2: "publish_project_baseline",
  release: "publish_production_package_version", change: "submit_change_request",
  impact: "calculate_change_impact", photo: "register_photo_evidence",
  distribution: "distribute_release_request_bound", acknowledgement: "acknowledge_release_request_bound",
};
const responseOperations: Record<Stage, string> = { ...auditOperations,
  baselineB1: "publish_baseline_atomic", baselineB2: "publish_baseline_atomic",
  release: "publish_release_request_bound", acknowledgement: "acknowledge_release",
};
const roles: Record<Stage, string> = {
  handoff: "owner_lead", approvalB1: "client_approver", baselineB1: "architect", release: "architect",
  artifact: "service_role", distribution: "owner_lead", acknowledgement: "builder", approvalB2: "client_approver",
  baselineB2: "architect", change: "builder", impact: "service_role", impactReview: "owner_lead",
  milestone: "owner_lead", photo: "builder", photoReview: "owner_lead", acceptance: "client_approver",
};
const serverRequestId = z.string().regex(/^(?:db:)?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const observation = z.object({ requestId: uuid, commandId: uuid, submittedCommandId: uuid,
  auditRequestId: serverRequestId, operation: id,
  response: z.record(z.unknown()), responseDigest: digest }).strict();
const proofSchema = z.object({
  stage: z.enum(EXTERNAL_DELIVERY_STAGES as [Stage, ...Stage[]]),
  command: observation, replay: observation,
  audit: scopeSchema.extend({ auditEventId: uuid, commandId: uuid, requestId: serverRequestId, operation: id,
    actor: actorSchema, objectId: id, logicalResult: z.record(z.unknown()), resultDigest: digest }).strict(),
  query: scopeSchema.extend({ requestId: uuid, manifestDigest: digest, challengeNonce: z.string().min(1),
    commandId: uuid, submittedCommandId: uuid, auditRequestId: serverRequestId,
    auditEventId: uuid, rows: z.array(z.record(z.unknown())).length(1) }).strict(),
  auditDigest: digest, queryDigest: digest,
}).strict();
const evidenceSchema = z.object({ schemaVersion: z.literal("external-delivery-evidence/1"), scope: scopeSchema,
  upstream: upstreamSchema, manifestDigest: digest, challengeNonce: z.string().min(1),
  stages: z.array(proofSchema).min(EXTERNAL_DELIVERY_STAGES.length) }).strict();

export interface ExternalDeliveryExpected {
  readonly scope: z.infer<typeof scopeSchema>;
  readonly upstream: z.infer<typeof upstreamSchema>;
  readonly sessions: readonly ExternalRunSession[];
  readonly manifestDigest: string;
  readonly challengeNonce: string;
  /** Frozen manifest file checksums, not supplied by the candidate proof. */
  readonly sourceChecksums: readonly string[];
  /** Independently measured scoped immutable source-query bindings. NEVER
   * derive this authority merely from raw.delivery or its candidate JSON. */
  readonly sources: readonly z.infer<typeof sourceSchema>[];
  readonly excludedProjectIds?: readonly string[];
  /** Protected process-runner receipts supplied independently of candidate JSON.
   * entrypoint is the invoked RPC (AP1 direct invocation) or worker script; the
   * runner records both the invocation and the captured RPC response digest. */
  readonly workerInvocations: readonly {
    readonly stage: "artifact" | "impact";
    readonly invocationId: string;
    readonly entrypoint: string;
    readonly exitCode: number;
    readonly responseDigest: string;
    readonly commandId: string;
  }[];
}
function requireProof(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(`EXTERNAL_DELIVERY_${code}`);
}
const equal = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Real response paths, not enriched result rows. Sources:
 * 20260802090000:157 handoff result.entityId/revisionId;
 * 20260717101000:1678 approvalPackageId/status, :2247 baseline.id,
 * :2632 release.id/baselineId, :2859 artifact.id nested under artifact;
 * 20260825030000:406 atomic baseline wraps actual result in result.baseline;
 * 20260911150000:109 release wrapper preserves result, changes operation;
 * 20260718124958:248 distributionId, :446 acknowledgementId in DB result.
 * command-service:1080 strips acknowledgementId and adds artifactId for HTTP;
 * that ID is therefore bound ONLY by audited logicalResult + query row.
 * 20260717103000:538 change.id, :1203 milestone.id,
 * :1385 photo.id/sourceId/sourceRevisionId/sourceChecksum, :1540 review.id,
 * :1737 acceptance.id; 20260817010000:638 impact.id and :847 review.id.
 * command-service.completed preserves mutation.result; worker _complete_command
 * returns the same {operation,replay,stateRevision,result} without HTTP status.
 * Fields absent from these real responses stay solely in audit/query joins.
 */
function bindResponse(stage: Stage, result: Record<string, unknown>, row: Record<string, unknown>): void {
  const keys: Partial<Record<Stage, string>> = { handoff: "entityId", approvalB1: "approvalPackageId", approvalB2: "approvalPackageId",
    distribution: "distributionId" };
  const value = stage === "artifact" ? object(result.artifact).id : result[keys[stage] ?? "id"];
  if (stage !== "acknowledgement") requireProof(value === row.id, "RESPONSE_OBJECT_UNBOUND");
  const shared: Partial<Record<Stage, string[]>> = {
    baselineB1: ["graphVersionId"], baselineB2: ["graphVersionId", "previousBaselineId"],
    handoff: ["packageId"], release: ["baselineId", "packageId"], distribution: ["artifactId", "productionPackageVersionId", "recipientUserId", "packageId"],
    acknowledgement: ["distributionId", "artifactId", "productionPackageVersionId", "packageId"],
    change: ["fromBaselineId", "proposedBaselineId", "fromProductionPackageVersionId", "packageId"],
    impact: ["changeRequestId", "coverageStatus", "policyVersion", "returnedImpactCount", "knownImpactCountLowerBound", "policyMaxDepth", "maxImpacts",
      "calculatedDepth", "isTruncated", "hasMoreBeyondDepth", "cutoffReason", "truncationReason", "targetGraphVersionId", "packageId", "projectId"],
    impactReview: ["impactRunId", "impactId", "disposition"], milestone: ["baselineId", "productionPackageVersionId", "graphVersionId", "packageId"],
    photo: ["milestoneId", "areaNodeId", "productionPackageVersionId", "packageId"], photoReview: ["photoEvidenceId", "decision"], acceptance: ["milestoneId"],
  };
  for (const key of shared[stage] ?? []) requireProof(equal(result[key], row[key]), "RESPONSE_LINEAGE_INVALID");
  if (stage === "handoff") requireProof(result.revisionId === row.handoffRevisionId, "RESPONSE_LINEAGE_INVALID");
  if (stage === "approvalB1" || stage === "approvalB2") requireProof(result.status === "approved", "RESPONSE_APPROVAL_INVALID");
  if (stage === "artifact") requireProof(object(result.artifact).productionPackageVersionId === row.productionPackageVersionId, "RESPONSE_LINEAGE_INVALID");
  if (stage === "impact") {
    requireProof(result.targetBaselineId === row.proposedBaselineId && result.impactCount === row.returnedImpactCount
      && Array.isArray(result.impacts), "RESPONSE_IMPACT_INVALID");
    // RPC calls the persisted target impactedNodeId/impactedRevisionId;
    // the evidence projection names these targetNodeId/targetRevisionId.
    const measured = (result.impacts as unknown[]).map((item) => {
      const impact = object(item);
      return { impactId: impact.impactId, targetNodeId: impact.impactedNodeId, targetRevisionId: impact.impactedRevisionId };
    });
    requireProof(equal(measured, row.impacts), "RESPONSE_IMPACTS_UNBOUND");
  }
  if (stage === "photo") {
    const source = object(row.source);
    requireProof(result.sourceId === source.sourceId && result.sourceRevisionId === source.sourceRevisionId && result.sourceChecksum === source.checksum, "RESPONSE_SOURCE_INVALID");
  }
}

export function validateExternalDeliveryPreparation(raw: unknown, expected: ExternalDeliveryExpected) {
  const proof = evidenceSchema.parse(raw);
  scopeSchema.parse(expected.scope); upstreamSchema.parse(expected.upstream);
  digest.parse(expected.manifestDigest);
  requireProof(equal(proof.scope, expected.scope) && equal(proof.upstream, expected.upstream)
    && proof.manifestDigest === expected.manifestDigest && proof.challengeNonce === expected.challengeNonce, "BINDING_INVALID");
  requireProof(!expected.excludedProjectIds?.includes(proof.scope.projectId)
    && !/kora/i.test(canonicalJson(proof)), "REFERENCE_PROJECT_FORBIDDEN");
  requireProof(expected.sessions.length === 5, "FIVE_SESSIONS_REQUIRED");
  for (const field of ["userId", "sessionId", "requestId"] as const) {
    requireProof(new Set(expected.sessions.map((s) => uuid.parse(s[field]))).size === 5, "SESSION_NOT_DISTINCT");
  }
  for (const role of EXTERNAL_RUN_ROLES) {
    const sessions = expected.sessions.filter((s) => s.role === role);
    requireProof(sessions.length === 1, "SESSION_ROLE_INVALID");
    requireProof(sessions[0]!.serverSessionDigest === `sha256:${createHash("sha256").update(sessions[0]!.sessionId.toLowerCase()).digest("hex")}`, "SESSION_DIGEST_INVALID");
  }
  requireProof(expected.sources.length > 0, "SOURCE_INVENTORY_REQUIRED");
  expected.sources.forEach((source) => sourceSchema.parse(source));
  requireProof(expected.sourceChecksums.length > 0, "MANIFEST_SOURCES_REQUIRED");
  expected.sourceChecksums.forEach((checksum) => digest.parse(checksum));
  requireProof(expected.sources.every((source) => expected.sourceChecksums.includes(source.checksum)), "MANIFEST_SOURCE_UNBOUND");
  requireProof(new Set(expected.sources.map((source) => `${source.sourceId}:${source.sourceRevisionId}`)).size === expected.sources.length,
    "SOURCE_REVISION_AMBIGUOUS");
  const parsed: Record<string, z.infer<typeof rowBase> & Record<string, unknown>> = {};
  const reviews: (z.infer<typeof rows.impactReview>)[] = [];
  const commandIds = new Set<string>(); const auditIds = new Set<string>(); const queryIds = new Set<string>();
  for (const step of proof.stages) {
    const row = rows[step.stage].parse(step.query.rows[0]);
    requireProof(step.stage === "impactReview" || parsed[step.stage] === undefined, "DUPLICATE_STAGE");
    requireProof(!commandIds.has(step.command.commandId) && !auditIds.has(step.audit.auditEventId)
      && !queryIds.has(step.query.requestId), "DUPLICATE_BINDING");
    commandIds.add(step.command.commandId); auditIds.add(step.audit.auditEventId); queryIds.add(step.query.requestId);
    for (const scoped of [row, step.audit, step.query]) {
      requireProof(Object.entries(expected.scope).every(([key, value]) => scoped[key as keyof typeof scoped] === value), "SCOPE_INVALID");
    }
    requireProof(row.actor.role === roles[step.stage] && equal(row.actor, step.audit.actor), "ACTOR_INVALID");
    if (row.actor.kind === "human") {
      const actor = row.actor;
      requireProof(step.stage !== "artifact" && step.stage !== "impact", "WORKER_REQUIRED");
      const session = expected.sessions.find((s) => s.role === actor.role)!;
      requireProof(actor.userId === session.userId && actor.sessionId === session.sessionId
        && actor.sessionDigest === session.serverSessionDigest, "ACTOR_UNBOUND");
    } else {
      requireProof(step.stage === "artifact" || step.stage === "impact", "HUMAN_REQUIRED");
      const worker = row.actor;
      const receipts = expected.workerInvocations.filter((receipt) => receipt.stage === step.stage);
      requireProof(receipts.length === 1, "WORKER_INVOCATION_REQUIRED");
      const receipt = receipts[0]!;
      const allowedEntrypoints = step.stage === "artifact"
        ? ["scripts/run-release-artifact-worker.ts", "projectceo_product_api.build_release_artifact"]
        : ["scripts/run-change-impact-worker.ts", "projectceo_m4_api.calculate_change_impact_policy_bound"];
      requireProof(receipt.invocationId === worker.workerRunId && receipt.exitCode === 0
        && allowedEntrypoints.includes(receipt.entrypoint) && receipt.responseDigest === step.command.responseDigest
        && receipt.commandId === step.command.commandId, "WORKER_INVOCATION_UNBOUND");
    }
    requireProof(step.command.operation === operations[step.stage] && step.audit.operation === auditOperations[step.stage]
      && step.replay.operation === step.command.operation, "OPERATION_INVALID");
    requireProof(step.command.commandId === step.replay.commandId && step.command.commandId === step.audit.commandId
      && step.command.commandId === step.query.commandId && step.command.auditRequestId === step.audit.requestId
      && step.replay.auditRequestId === step.audit.requestId && step.query.auditRequestId === step.audit.requestId
      && step.command.submittedCommandId === step.replay.submittedCommandId && step.command.submittedCommandId === step.query.submittedCommandId
      && step.audit.auditEventId === step.query.auditEventId && step.audit.objectId === row.id, "QUERY_AUDIT_BINDING_INVALID");
    const response = step.command.response, replay = step.replay.response;
    requireProof(step.command.responseDigest === semanticSha256(response) && step.replay.responseDigest === semanticSha256(replay)
      && response.operation === responseOperations[step.stage] && replay.operation === response.operation
      && response.replay === false && replay.replay === true && Number.isSafeInteger(response.stateRevision)
      && replay.stateRevision === response.stateRevision && equal(response.result, replay.result)
      && step.audit.resultDigest === semanticSha256(step.audit.logicalResult), "RESULT_REPLAY_INVALID");
    if (row.actor.kind === "human") requireProof(response.status === "completed" && replay.status === "completed"
      && response.requestId === step.command.requestId && replay.requestId === step.replay.requestId, "HTTP_RESPONSE_UNBOUND");
    const responseResult = object(response.result);
    const logicalResult = step.audit.logicalResult;
    if (step.stage === "baselineB1" || step.stage === "baselineB2") {
      requireProof(equal(responseResult.baseline, logicalResult), "AUDIT_RESULT_UNBOUND");
      bindResponse(step.stage, object(responseResult.baseline), row);
    } else if (step.stage === "acknowledgement") {
      const { acknowledgementId, ...rest } = logicalResult;
      requireProof(acknowledgementId === row.id && equal(responseResult, { ...rest, artifactId: rows.acknowledgement.parse(row).artifactId }), "AUDIT_RESULT_UNBOUND");
      bindResponse(step.stage, responseResult, row);
    } else {
      requireProof(equal(responseResult, logicalResult), "AUDIT_RESULT_UNBOUND");
      bindResponse(step.stage, responseResult, row);
    }
    requireProof(step.auditDigest === semanticSha256(step.audit) && step.queryDigest === semanticSha256(step.query)
      && step.query.manifestDigest === expected.manifestDigest && step.query.challengeNonce === expected.challengeNonce, "DIGEST_INVALID");
    parsed[step.stage] = row;
    if (step.stage === "impactReview") reviews.push(rows.impactReview.parse(row));
  }
  requireProof(EXTERNAL_DELIVERY_STAGES.every((stage) => parsed[stage] !== undefined), "STAGE_MISSING");
  const r = <K extends Stage>(stage: K): z.infer<(typeof rows)[K]> => rows[stage].parse(parsed[stage]);
  const handoff = r("handoff"), b1 = r("baselineB1"), b2 = r("baselineB2"), a1 = r("approvalB1"), a2 = r("approvalB2");
  for (const row of [handoff, b1, b2]) requireProof(Object.entries(expected.upstream).every(([k, v]) => row[k as keyof typeof row] === v), "HANDOFF_LINEAGE_INVALID");
  requireProof(handoff.id === expected.upstream.handoffId && b1.approvalId === a1.id && b2.approvalId === a2.id
    && b1.decisionRevisionId === a1.decisionRevisionId && b2.decisionRevisionId === a2.decisionRevisionId
    && a1.id !== a2.id && a1.decisionRevisionId !== a2.decisionRevisionId && b1.id !== b2.id
    && b2.previousBaselineId === b1.id, "BASELINE_LINEAGE_INVALID");
  const sourceBound = (source: z.infer<typeof sourceSchema>) => expected.sources.some((s) => equal(s, source));
  requireProof([...b1.sources, ...b2.sources].every(sourceBound), "SOURCE_UNBOUND");
  const release = r("release"), artifact = r("artifact"), distribution = r("distribution"), ack = r("acknowledgement");
  const builder = expected.sessions.find((s) => s.role === "builder")!;
  requireProof(release.id === release.productionPackageVersionId && release.baselineId === b1.id && artifact.baselineId === b1.id
    && artifact.productionPackageVersionId === release.productionPackageVersionId
    && distribution.productionPackageVersionId === release.productionPackageVersionId && distribution.artifactId === artifact.id
    && distribution.recipientUserId === builder.userId && ack.distributionId === distribution.id
    && ack.artifactId === artifact.id
    && ack.productionPackageVersionId === release.productionPackageVersionId && ack.recipientUserId === builder.userId, "DISTRIBUTION_LINEAGE_INVALID");
  const change = r("change"), impact = r("impact");
  requireProof(change.fromBaselineId === b1.id && change.proposedBaselineId === b2.id
    && change.fromProductionPackageVersionId === release.productionPackageVersionId && impact.changeRequestId === change.id
    && impact.fromBaselineId === b1.id && impact.proposedBaselineId === b2.id
    && impact.targetGraphVersionId === b2.graphVersionId, "CHANGE_LINEAGE_INVALID");
  const impacts = new Set(impact.impacts.map((i) => i.impactId));
  requireProof(impacts.size === impact.impacts.length && impact.returnedImpactCount === impacts.size
    && impact.knownImpactCountLowerBound === impacts.size && reviews.length === impacts.size
    && new Set(reviews.map((review) => review.impactId)).size === impacts.size
    && reviews.every((review) => review.impactRunId === impact.id && impacts.has(review.impactId)), "IMPACT_INCOMPLETE");
  const milestone = r("milestone"), photo = r("photo"), photoReview = r("photoReview"), acceptance = r("acceptance");
  requireProof(sourceBound(photo.source), "PHOTO_SOURCE_UNBOUND");
  requireProof(milestone.baselineId === b1.id && milestone.productionPackageVersionId === release.productionPackageVersionId
    && photo.milestoneId === milestone.id && photo.areaNodeId === milestone.areaNodeId && photoReview.photoEvidenceId === photo.id
    && photo.baselineId === milestone.baselineId && photo.productionPackageVersionId === milestone.productionPackageVersionId
    && photo.graphVersionId === milestone.graphVersionId && photo.areaRevisionId === milestone.areaRevisionId
    && acceptance.milestoneId === milestone.id && acceptance.baselineId === b1.id
    && acceptance.productionPackageVersionId === distribution.productionPackageVersionId && acceptance.impactRunId === impact.id
    && equal(acceptance.photoEvidenceIds, [photo.id]) && equal(acceptance.photoReviewIds, [photoReview.id]), "ACCEPTANCE_LINEAGE_INVALID");
  return { ...proof, integrationStatus: "BLOCKED_NATIVE_M3_PROOF_REQUIRED" as const, evidenceDigest: semanticSha256(proof) };
}

/** Fail closed for integration. Schema /1 describes the generic AP1 root
 * publication sequence only. Full native M3 additionally needs actual
 * register_documentation_sheet and attach_documentation_sheet_specifications
 * revision/audit evidence (20260810010000), derived completeness read rows
 * (NOT an invented approval mutation), and child work_package release via
 * publish_work_package_release_request_bound (20260911140000:98-101).
 * Stamping handoff fields on root publication rows cannot supply those facts.
 * A future producer/schema must prove those joins; root release never qualifies.
 */
export function validateExternalDeliveryEvidence(raw: unknown, expected: ExternalDeliveryExpected): never {
  validateExternalDeliveryPreparation(raw, expected);
  throw new Error("EXTERNAL_DELIVERY_NATIVE_M3_PROOF_REQUIRED");
}
