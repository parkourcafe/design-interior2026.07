import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { semanticSha256 } from "../../lib/project-intelligence/application/change-handoff/canonical";
import { EXTERNAL_RUN_ROLES } from "./external-pilot-receipt";
import { validateExternalDeliveryPreparation as validateExternalDeliveryEvidence,
  validateExternalDeliveryEvidence as validateFullNativeDelivery, type ExternalDeliveryExpected } from "./external-delivery-evidence";

// Synthetic unit data only. Never serialized as a runtime receipt or PASS.
const uuid = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
type Row = Record<string, unknown>;
// Only actual returned result fields; no actor/upstream/source-join enrichment.
function transportResult(stage: string, row: Row): Row {
  const pick = (...keys: string[]) => Object.fromEntries(keys.map((key) => [key, row[key]]));
  switch (stage) {
    case "handoff": return { entityId: row.id, revisionId: row.handoffRevisionId, packageId: row.packageId };
    case "approvalB1": case "approvalB2": return { approvalPackageId: row.id, status: "approved" };
    case "baselineB1": return { baseline: pick("id", "graphVersionId"), version: { id: row.graphVersionId } };
    case "baselineB2": return { baseline: pick("id", "graphVersionId", "previousBaselineId"), version: { id: row.graphVersionId } };
    case "release": return pick("id", "baselineId", "packageId");
    case "artifact": return { artifact: pick("id", "productionPackageVersionId") };
    case "distribution": return { distributionId: row.id, ...pick("artifactId", "productionPackageVersionId", "recipientUserId", "packageId") };
    case "acknowledgement": return pick("distributionId", "artifactId", "productionPackageVersionId", "packageId");
    case "change": return pick("id", "fromBaselineId", "proposedBaselineId", "fromProductionPackageVersionId", "packageId");
    case "impact": return { ...pick("id", "changeRequestId", "coverageStatus", "policyVersion", "returnedImpactCount", "knownImpactCountLowerBound", "policyMaxDepth", "maxImpacts", "calculatedDepth", "isTruncated", "hasMoreBeyondDepth", "cutoffReason", "truncationReason", "targetGraphVersionId", "packageId", "projectId"),
      targetBaselineId: row.proposedBaselineId, impactCount: row.returnedImpactCount,
      impacts: (row.impacts as Row[]).map((impact) => ({ impactId: impact.impactId, impactedNodeId: impact.targetNodeId, impactedRevisionId: impact.targetRevisionId })) };
    case "impactReview": return pick("id", "impactRunId", "impactId", "disposition");
    case "milestone": return pick("id", "baselineId", "productionPackageVersionId", "graphVersionId", "packageId");
    case "photo": { const source = row.source as Row; return { ...pick("id", "milestoneId", "areaNodeId", "productionPackageVersionId", "packageId"), sourceId: source.sourceId, sourceRevisionId: source.sourceRevisionId, sourceChecksum: source.checksum }; }
    case "photoReview": return pick("id", "photoEvidenceId", "decision");
    default: return pick("id", "milestoneId");
  }
}
function fixture() {
  const scope = { organizationId: uuid(1), projectId: uuid(2), packageId: uuid(3) };
  const upstream = { handoffId: "synthetic-handoff", handoffRevisionId: uuid(4), approvedCommitId: "synthetic-commit", approvedCommitRevisionId: uuid(5) };
  const sessions = EXTERNAL_RUN_ROLES.map((role, i) => ({ role, userId: uuid(10 + i), sessionId: uuid(20 + i), requestId: uuid(30 + i),
    serverSessionDigest: `sha256:${createHash("sha256").update(uuid(20 + i)).digest("hex")}` }));
  const source = { sourceId: "synthetic-source", sourceRevisionId: uuid(40), checksum: semanticSha256("synthetic-file-bytes") };
  const expected: ExternalDeliveryExpected = { scope, upstream, sessions, sources: [source], sourceChecksums: [source.checksum],
    manifestDigest: semanticSha256("synthetic-manifest"), challengeNonce: "synthetic-test-only", excludedProjectIds: [uuid(999)], workerInvocations: [] };
  const human = (role: string) => {
    const s = sessions.find((s) => s.role === role)!;
    return { kind: "human", role, userId: s.userId, sessionId: s.sessionId, sessionDigest: s.serverSessionDigest };
  };
  const worker = { kind: "system_worker", role: "service_role", workerRunId: uuid(50) };
  const entries: [string, string, string, Row][] = [
    ["handoff", "publish_m2_m3_handoff", "owner_lead", { id: upstream.handoffId, ...upstream }],
    ["approvalB1", "review_selection", "client_approver", { id: "approval-1", decision: "approved", decisionRevisionId: uuid(60) }],
    ["baselineB1", "publish_baseline", "architect", { id: "baseline-1", graphVersionId: "graph-1", ...upstream, approvalId: "approval-1", decisionRevisionId: uuid(60), sources: [source] }],
    ["release", "publish_release", "architect", { id: "release-1", baselineId: "baseline-1", productionPackageVersionId: "release-1" }],
    ["artifact", "build_release_artifact", "service_role", { id: "artifact-1", baselineId: "baseline-1", productionPackageVersionId: "release-1", contentDigest: semanticSha256("artifact"), byteLength: 123 }],
    ["distribution", "distribute_release", "owner_lead", { id: "distribution-1", productionPackageVersionId: "release-1", artifactId: "artifact-1", recipientUserId: sessions[3]!.userId }],
    ["acknowledgement", "acknowledge_release", "builder", { id: "ack-1", artifactId: "artifact-1", distributionId: "distribution-1", productionPackageVersionId: "release-1", recipientUserId: sessions[3]!.userId }],
    ["approvalB2", "review_selection", "client_approver", { id: "approval-2", decision: "approved", decisionRevisionId: uuid(61) }],
    ["baselineB2", "publish_baseline", "architect", { id: "baseline-2", graphVersionId: "graph-2", ...upstream, approvalId: "approval-2", decisionRevisionId: uuid(61), sources: [source], previousBaselineId: "baseline-1" }],
    ["change", "create_change", "builder", { id: "change-1", fromBaselineId: "baseline-1", proposedBaselineId: "baseline-2", fromProductionPackageVersionId: "release-1" }],
    ["impact", "calculate_change_impact_policy_bound", "service_role", { id: "impact-run-1", changeRequestId: "change-1", fromBaselineId: "baseline-1", proposedBaselineId: "baseline-2", targetGraphVersionId: "graph-2", coverageStatus: "complete", policyVersion: "project-ceo-impact-policy/0.2", policyMaxDepth: 7, maxImpacts: 5000, calculatedDepth: 1, isTruncated: false, hasMoreBeyondDepth: false, cutoffReason: null, truncationReason: null, returnedImpactCount: 1, knownImpactCountLowerBound: 1, impacts: [{ impactId: "impact-1", targetNodeId: "target-1", targetRevisionId: "target-revision-1" }] }],
    ["impactReview", "review_change_impact", "owner_lead", { id: "review-1", impactRunId: "impact-run-1", impactId: "impact-1", disposition: "resolved" }],
    ["milestone", "define_milestone", "owner_lead", { id: "milestone-1", baselineId: "baseline-1", productionPackageVersionId: "release-1", graphVersionId: "graph-1", areaNodeId: "area-1", areaRevisionId: "area-revision-1" }],
    ["photo", "upload_photo_evidence", "builder", { id: "photo-1", milestoneId: "milestone-1", baselineId: "baseline-1", productionPackageVersionId: "release-1", graphVersionId: "graph-1", areaNodeId: "area-1", areaRevisionId: "area-revision-1", source, capturedAt: "2026-09-22T12:00:00.000Z" }],
    ["photoReview", "review_photo_evidence", "owner_lead", { id: "photo-review-1", photoEvidenceId: "photo-1", decision: "accepted" }],
    ["acceptance", "accept_milestone", "client_approver", { id: "acceptance-1", milestoneId: "milestone-1", baselineId: "baseline-1", productionPackageVersionId: "release-1", photoEvidenceIds: ["photo-1"], photoReviewIds: ["photo-review-1"], impactRunId: "impact-run-1" }],
  ];
  const stages = entries.map(([stage, operation, role, fields], i) => {
    const row = { ...scope, ...fields, actor: role === "service_role" ? worker : human(role) };
    const auditOperation = ({ review_selection: "review_approval_package", publish_baseline: "publish_project_baseline", publish_release: "publish_production_package_version", create_change: "submit_change_request", calculate_change_impact_policy_bound: "calculate_change_impact", upload_photo_evidence: "register_photo_evidence", distribute_release: "distribute_release_request_bound", acknowledge_release: "acknowledge_release_request_bound" } as Record<string, string>)[operation] ?? operation;
    const responseOperation = ({ publish_baseline: "publish_baseline_atomic", publish_release: "publish_release_request_bound", acknowledge_release: "acknowledge_release" } as Record<string, string>)[operation] ?? auditOperation;
    const response: Row = { operation: responseOperation, replay: false, stateRevision: 3 + i % 4, result: transportResult(stage, row as Row),
      ...(role === "service_role" ? {} : { requestId: uuid(100 + i), status: "completed" }) };
    const replayResponse: Row = { ...structuredClone(response), replay: true, ...(role === "service_role" ? {} : { requestId: uuid(500 + i) }) };
    const command = { requestId: uuid(100 + i), commandId: uuid(200 + i), submittedCommandId: uuid(600 + i), auditRequestId: `db:${uuid(700 + i)}`, operation, response, responseDigest: semanticSha256(response) };
    let logicalResult = structuredClone(response.result) as Row;
    if (stage === "baselineB1" || stage === "baselineB2") logicalResult = logicalResult.baseline as Row;
    if (stage === "acknowledgement") { delete logicalResult.artifactId; logicalResult.acknowledgementId = fields.id; }
    const audit = { ...scope, auditEventId: uuid(300 + i), commandId: command.commandId, requestId: command.auditRequestId, operation: auditOperation, actor: row.actor, objectId: String(fields.id), logicalResult, resultDigest: semanticSha256(logicalResult) };
    const query = { ...scope, requestId: uuid(400 + i), manifestDigest: expected.manifestDigest, challengeNonce: expected.challengeNonce, commandId: command.commandId, submittedCommandId: command.submittedCommandId, auditRequestId: command.auditRequestId, auditEventId: audit.auditEventId, rows: [row as Row] };
    return { stage, command, replay: { ...command, requestId: uuid(500 + i), response: replayResponse, responseDigest: semanticSha256(replayResponse) }, audit, query, auditDigest: semanticSha256(audit), queryDigest: semanticSha256(query) };
  });
  const workerInvocations: ExternalDeliveryExpected["workerInvocations"] = stages.filter((s) => s.stage === "artifact" || s.stage === "impact").map((s) => ({ stage: s.stage as "artifact" | "impact", invocationId: worker.workerRunId, exitCode: 0, commandId: s.command.commandId, responseDigest: s.command.responseDigest, entrypoint: s.stage === "artifact" ? "scripts/run-release-artifact-worker.ts" : "projectceo_m4_api.calculate_change_impact_policy_bound" }));
  return { expected: { ...expected, workerInvocations }, proof: { schemaVersion: "external-delivery-evidence/1", scope, upstream, manifestDigest: expected.manifestDigest, challengeNonce: expected.challengeNonce, stages } };
}
type Fixture = ReturnType<typeof fixture>;
// Re-signing adversarial projections tests semantic linkage, not just digests.
function changeRow(f: Fixture, stage: string, updates: Row) {
  const s = f.proof.stages.find((s) => s.stage === stage)!;
  Object.assign(s.query.rows[0]!, updates);
  s.command.response.result = transportResult(stage, s.query.rows[0]!); s.replay.response.result = structuredClone(s.command.response.result);
  s.command.responseDigest = semanticSha256(s.command.response); s.replay.responseDigest = semanticSha256(s.replay.response);
  let logicalResult = structuredClone(s.command.response.result) as Row;
  if (stage === "baselineB1" || stage === "baselineB2") logicalResult = logicalResult.baseline as Row;
  if (stage === "acknowledgement") { delete logicalResult.artifactId; logicalResult.acknowledgementId = s.query.rows[0]!.id; }
  s.audit.logicalResult = logicalResult; s.audit.resultDigest = semanticSha256(logicalResult); s.audit.objectId = String(s.query.rows[0]!.id);
  s.auditDigest = semanticSha256(s.audit); s.queryDigest = semanticSha256(s.query);
}
describe("external full-delivery evidence (synthetic only)", () => {
  it("normalizes the full measured chain without a fictitious global revision counter", () => {
    const f = fixture(); const result = validateExternalDeliveryEvidence(f.proof, f.expected);
    expect(result.evidenceDigest).toBe(semanticSha256(f.proof));
    expect(result.stages).toHaveLength(16);
    expect(result).not.toHaveProperty("status");
    expect(result.integrationStatus).toBe("BLOCKED_NATIVE_M3_PROOF_REQUIRED");
  });
  it("never accepts generic root publication as native M3 full-delivery evidence", () => {
    const f = fixture();
    expect(() => validateFullNativeDelivery(f.proof, f.expected)).toThrow("EXTERNAL_DELIVERY_NATIVE_M3_PROOF_REQUIRED");
  });
  it.each([
    ["impacts", [{ impactId: "impact-1", targetNodeId: "substituted-target", targetRevisionId: "target-revision-1" }]],
    ["calculatedDepth", 2], ["isTruncated", true], ["hasMoreBeyondDepth", true], ["cutoffReason", "depth_boundary"],
    ["truncationReason", "depth_limit"], ["proposedBaselineId", "other-baseline"], ["targetGraphVersionId", "other-graph"],
  ])("rejects query-only impact %s tampering with unchanged captured worker response", (key, value) => {
    const f = fixture(), step = f.proof.stages.find((s) => s.stage === "impact")!;
    step.query.rows[0]![String(key)] = value; step.queryDigest = semanticSha256(step.query);
    expect(() => validateExternalDeliveryEvidence(f.proof, f.expected)).toThrow();
  });
  it.each(["handoff", "baselineB1", "approvalB2", "artifact", "acknowledgement", "impactReview", "photo", "acceptance"])("rejects omitted %s", (stage) => {
    const f = fixture(); f.proof.stages = f.proof.stages.filter((s) => s.stage !== stage);
    expect(() => validateExternalDeliveryEvidence(f.proof, f.expected)).toThrow();
  });
  it.each([
    ["baselineB1", { handoffRevisionId: uuid(999) }],
    ["baselineB2", { id: "baseline-1" }],
    ["baselineB2", { decisionRevisionId: uuid(60) }],
    ["distribution", { productionPackageVersionId: "other-release" }],
    ["acknowledgement", { recipientUserId: uuid(10) }],
    ["change", { proposedBaselineId: "baseline-1" }],
    ["impact", { coverageStatus: "partial_depth" }],
    ["impact", { coverageStatus: "blocked_result_limit" }],
    ["impact", { coverageStatus: "unknown" }],
    ["impact", { policyMaxDepth: 8 }],
    ["impact", { returnedImpactCount: 2 }],
    ["impactReview", { impactId: "unmeasured-impact" }],
    ["photo", { source: { sourceId: "synthetic-source", sourceRevisionId: uuid(999), checksum: semanticSha256("synthetic-file-bytes") } }],
    ["photo", { milestoneId: "other-milestone" }],
    ["photo", { areaRevisionId: "other-area-revision" }],
    ["acceptance", { productionPackageVersionId: "undistributed-release" }],
    ["acceptance", { photoReviewIds: ["unreviewed-photo"] }],
    ["photo", { projectId: uuid(900) }],
    ["baselineB1", { packageId: uuid(900) }],
  ] as [string, Row][])("rejects re-digested invalid %s lineage %j", (stage, updates) => {
    const f = fixture(); changeRow(f, stage, updates);
    expect(() => validateExternalDeliveryEvidence(f.proof, f.expected)).toThrow();
  });
  it.each(["result", "replay", "audit", "query"])("rejects mutated %s", (kind) => {
    const f = fixture(), step = f.proof.stages[0]!;
    if (kind === "result") step.command.response.result = { id: "mutated" };
    if (kind === "replay") (step.replay.response.result as Row).id = "mutated";
    if (kind === "audit") step.audit.requestId = uuid(999);
    if (kind === "query") step.query.commandId = uuid(999);
    expect(() => validateExternalDeliveryEvidence(f.proof, f.expected)).toThrow();
  });
  it("rejects absent, failed and substituted trusted worker invocation receipts", () => {
    const f = fixture();
    expect(() => validateExternalDeliveryEvidence(f.proof, { ...f.expected, workerInvocations: [] })).toThrow("WORKER_INVOCATION_REQUIRED");
    for (const update of [{ exitCode: 1 }, { responseDigest: semanticSha256("other") }, { invocationId: uuid(999) }]) {
      expect(() => validateExternalDeliveryEvidence(f.proof, { ...f.expected, workerInvocations: f.expected.workerInvocations.map((r) => ({ ...r, ...update })) })).toThrow("WORKER_INVOCATION_UNBOUND");
    }
  });
  it("retains separate HTTP and server audit request identities and rejects mismatched binding", () => {
    const f = fixture();
    expect(f.proof.stages[0]!.command.requestId).not.toBe(f.proof.stages[0]!.audit.requestId);
    f.proof.stages[0]!.command.auditRequestId = `db:${uuid(999)}`;
    expect(() => validateExternalDeliveryEvidence(f.proof, f.expected)).toThrow("QUERY_AUDIT_BINDING_INVALID");
  });
  it("binds actual returned IDs even if response and audit digests are recomputed", () => {
    const f = fixture(), step = f.proof.stages.find((s) => s.stage === "distribution")!;
    (step.command.response.result as Row).distributionId = "other-distribution";
    step.replay.response.result = structuredClone(step.command.response.result);
    step.command.responseDigest = semanticSha256(step.command.response);
    step.replay.responseDigest = semanticSha256(step.replay.response);
    step.audit.resultDigest = semanticSha256(step.command.response.result);
    step.audit.logicalResult = structuredClone(step.command.response.result) as Row;
    step.auditDigest = semanticSha256(step.audit);
    expect(() => validateExternalDeliveryEvidence(f.proof, f.expected)).toThrow("RESPONSE_OBJECT_UNBOUND");
  });
  it("rejects a substituted submitted-command binding independently of DB command ID", () => {
    const f = fixture(), step = f.proof.stages[0]!;
    step.query.submittedCommandId = uuid(999); step.queryDigest = semanticSha256(step.query);
    expect(() => validateExternalDeliveryEvidence(f.proof, f.expected)).toThrow("QUERY_AUDIT_BINDING_INVALID");
  });
  it("rejects worker impersonation, boolean receipts and Kora substitution", () => {
    const f = fixture(); changeRow(f, "impact", { actor: f.proof.stages[0]!.audit.actor });
    expect(() => validateExternalDeliveryEvidence(f.proof, f.expected)).toThrow();
    expect(() => validateExternalDeliveryEvidence({ complete: true }, f.expected)).toThrow();
    const k = fixture(); changeRow(k, "photo", { id: "kora-photo" });
    expect(() => validateExternalDeliveryEvidence(k.proof, k.expected)).toThrow("REFERENCE_PROJECT_FORBIDDEN");
  });
  it("rejects substituted trusted scope and upstream bindings", () => {
    const f = fixture();
    expect(() => validateExternalDeliveryEvidence(f.proof, { ...f.expected, scope: { ...f.expected.scope, organizationId: uuid(999) } })).toThrow();
    expect(() => validateExternalDeliveryEvidence(f.proof, { ...f.expected, upstream: { ...f.expected.upstream, approvedCommitId: "wrong" } })).toThrow();
    expect(() => validateExternalDeliveryEvidence(f.proof, { ...f.expected, sourceChecksums: [semanticSha256("other-file")] })).toThrow("MANIFEST_SOURCE_UNBOUND");
  });
});
