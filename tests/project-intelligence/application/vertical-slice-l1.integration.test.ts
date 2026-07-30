import { describe, expect, it } from "vitest";
import {
  ChangeHandoffApplicationService,
  createEmptyChangeHandoffState,
  createWorkflowApplicationService,
  semanticSha256,
} from "@/lib/project-intelligence/application";
import type {
  ChangeHandoffApplicationState,
  ChangeHandoffIdFactory,
  ImpactRun,
  LogicalHandoff,
} from "@/lib/project-intelligence/application/change-handoff";
import {
  fixture,
  graphV1,
  handoffPolicy,
} from "@/lib/project-intelligence/application/change-handoff/__tests__/support/fixtures";
import type {
  PublishedWorkflowChangeSet,
  PublishedWorkflowVersion,
  WorkflowAtomicCommit,
  WorkflowAuditIntent,
  WorkflowCommandDigester,
  WorkflowCommandIdentity,
  WorkflowCommitResult,
  WorkflowExecutionContext,
  WorkflowIdFactory,
  WorkflowIdKind,
  WorkflowLoadRequest,
  WorkflowLoadResult,
  WorkflowState,
  WorkflowStatePort,
  WorkflowStoredResult,
} from "@/lib/project-intelligence/application/workflow";
import type { ProjectVersionSnapshot } from "@/lib/project-intelligence";

const ORGANIZATION_ID = "organization-synthetic-001";
const PROJECT_ID = "project-kitchen-001";
const DECISION_NODE_ID = "decision-worktop-material";
const DECISION_R1_ID = "revision-decision-worktop-material-r1";
const DECISION_R2_ID = "revision-decision-worktop-material-r2";
const VERSION_V1_ID = "version-kitchen-001-v1";
const VERSION_V2_ID = "version-kitchen-001-v2";
const CHANGE_SET_ID = "change-set-kitchen-v1-v2";

interface WorkflowIdempotencyRecord {
  readonly digest: string;
  readonly result: WorkflowStoredResult;
}

class IntegrationWorkflowPort implements WorkflowStatePort {
  state: WorkflowState;
  readonly auditIntents: WorkflowAuditIntent[] = [];
  readonly idempotency = new Map<string, WorkflowIdempotencyRecord>();

  constructor(state: WorkflowState) {
    this.state = state;
  }

  private key(identity: WorkflowCommandIdentity): string {
    return [
      identity.organizationId,
      identity.projectId,
      identity.operation,
      identity.idempotencyKey,
    ].join("\u0000");
  }

  async load(request: WorkflowLoadRequest): Promise<WorkflowLoadResult> {
    const existing = this.idempotency.get(this.key(request.commandIdentity));
    if (existing) {
      return existing.digest === request.commandIdentity.digest
        ? { kind: "replay", result: existing.result }
        : { kind: "idempotency_conflict" };
    }
    if (
      this.state.projectId !== request.projectId
      || this.state.organizationId !== request.organizationId
    ) {
      return { kind: "not_found" };
    }
    return { kind: "loaded", state: this.state };
  }

  async commit(request: WorkflowAtomicCommit): Promise<WorkflowCommitResult> {
    const key = this.key(request.commandIdentity);
    const existing = this.idempotency.get(key);
    if (existing) {
      return existing.digest === request.commandIdentity.digest
        ? { kind: "replay", result: existing.result }
        : { kind: "idempotency_conflict" };
    }
    if (
      this.state.projectId !== request.projectId
      || this.state.organizationId !== request.organizationId
    ) {
      return { kind: "not_found" };
    }
    if (this.state.stateRevision !== request.expectedStateRevision) {
      return {
        kind: "state_stale",
        currentStateRevision: this.state.stateRevision,
      };
    }

    // Test-only model of one logical atomic commit.
    this.state = request.nextState;
    this.idempotency.set(key, {
      digest: request.commandIdentity.digest,
      result: request.result,
    });
    this.auditIntents.push(...request.auditIntents);
    return { kind: "committed" };
  }
}

class IntegrationWorkflowIdFactory implements WorkflowIdFactory {
  private readonly offsets = new Map<WorkflowIdKind, number>();
  private readonly ids: Record<WorkflowIdKind, readonly string[]> = {
    review: ["review-decision-r1", "review-decision-r2-edit"],
    version: [VERSION_V1_ID, VERSION_V2_ID],
    revision: [DECISION_R2_ID],
    change_set: [CHANGE_SET_ID],
  };

  nextId({ kind }: { readonly kind: WorkflowIdKind; readonly projectId: string }): string {
    const offset = this.offsets.get(kind) ?? 0;
    this.offsets.set(kind, offset + 1);
    return this.ids[kind][offset] ?? `${kind}-integration-${offset + 1}`;
  }
}

const workflowDigester: WorkflowCommandDigester = {
  digestCanonicalCommand(canonicalCommand: string): string {
    return semanticSha256(canonicalCommand);
  },
};

const changeHandoffIdFactory: ChangeHandoffIdFactory = {
  createId({ kind, semanticIdentity, hints }): string {
    switch (kind) {
      case "impact_run": return "impact-run-kitchen-v1-v2-001";
      case "impact": return `impact-${hints.impactedNodeId}`;
      case "impact_review": return `review-${hints.impactId}-${hints.disposition}`;
      case "handoff_artifact": return hints.idempotencyKey === "build-handoff-001"
        ? "export-kitchen-v2-render-001"
        : `export-${semanticIdentity.slice(-12)}`;
      case "source_reference": return `source-reference-${hints.fragmentId}`;
    }
  },
};

function initialWorkflowState(): WorkflowState {
  const draft = structuredClone(graphV1);
  draft.versionId = `draft:${PROJECT_ID}:state:0`;
  draft.reviews = draft.reviews.filter(
    ({ targetRevisionId }) => targetRevisionId !== DECISION_R1_ID,
  );
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    stateRevision: 0,
    draft,
    publishedVersions: [],
    changeSets: [],
  };
}

function workflowContext(
  actorId: string,
  serverTime: string,
  requestId: string,
  capabilities: WorkflowExecutionContext["actor"]["capabilities"],
): WorkflowExecutionContext {
  return {
    actor: {
      actorId,
      actorType: "human",
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      capabilities,
    },
    serverTime,
    requestId,
  };
}

function asVersionSnapshot(version: PublishedWorkflowVersion): ProjectVersionSnapshot {
  const revisions = new Map(version.snapshot.revisions.map((revision) => [revision.id, revision]));
  return {
    projectId: version.projectId,
    versionId: version.id,
    nodes: version.snapshot.nodes.map((node) => {
      const revision = revisions.get(node.currentRevisionId);
      if (!revision) throw new Error(`Missing selected revision ${node.currentRevisionId}.`);
      return {
        nodeId: node.id,
        revisionId: revision.id,
        payload: structuredClone(revision.payload),
      };
    }),
  };
}

function requireSuccess<T>(result: { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly error: { readonly code: string };
}): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function requireErrorCode(
  result: { readonly ok: boolean; readonly error?: { readonly code: string } },
  code: string,
): void {
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe(code);
}

function reviewPlan(impact: ImpactRun["impacts"][number]): {
  disposition: "accepted" | "resolved";
  reasonCode: string;
  serverTime: string;
} {
  switch (impact.impactedNodeId) {
    case "item-kitchen-worktop":
      return {
        disposition: "accepted",
        reasonCode: "downstream_update_required",
        serverTime: "2026-07-16T01:06:00.000Z",
      };
    case "deliverable-budget":
      return {
        disposition: "accepted",
        reasonCode: "cost_recalculation_required",
        serverTime: "2026-07-16T01:07:00.000Z",
      };
    case "deliverable-finish-schedule":
      return {
        disposition: "resolved",
        reasonCode: "schedule_updated",
        serverTime: "2026-07-16T01:08:00.000Z",
      };
    default:
      throw new Error(`Unexpected impacted node ${impact.impactedNodeId}.`);
  }
}

describe("Project Intelligence L1 application vertical slice", () => {
  it("executes review → V1 → decision revision → V2 → impacts → logical handoff", async () => {
    const workflowPort = new IntegrationWorkflowPort(initialWorkflowState());
    const workflow = createWorkflowApplicationService({
      statePort: workflowPort,
      idFactory: new IntegrationWorkflowIdFactory(),
      commandDigester: workflowDigester,
    });
    const reviewContext = workflowContext(
      "actor-designer-reviewer",
      "2026-07-16T00:05:00.000Z",
      "request-review-r1",
      ["review_claim"],
    );
    const reviewCommand = {
      projectId: PROJECT_ID,
      targetRevisionId: DECISION_R1_ID,
      expectedRevisionId: DECISION_R1_ID,
      expectedStateRevision: 0,
      decision: "confirmed" as const,
      idempotencyKey: "review-decision-r1",
    };

    const reviewed = requireSuccess(await workflow.reviewClaim(reviewContext, reviewCommand));
    expect(reviewed).toMatchObject({
      effectiveClaimStatus: "human_confirmed",
      review: {
        id: "review-decision-r1",
        targetRevisionId: DECISION_R1_ID,
        actor: { id: "actor-designer-reviewer", type: "human" },
      },
    });
    expect(workflowPort.state.draft.revisions.find(({ id }) => id === DECISION_R1_ID))
      .toMatchObject({ origin: "ai", claimStatus: "extracted" });

    const replayedReviewResult = await workflow.reviewClaim(
      { ...reviewContext, serverTime: "2026-07-16T00:05:30.000Z", requestId: "request-review-replay" },
      reviewCommand,
    );
    expect(replayedReviewResult).toMatchObject({ ok: true, idempotentReplay: true });
    const replayedReview = requireSuccess(replayedReviewResult);
    expect(replayedReview).toEqual(reviewed);
    expect(workflowPort.auditIntents).toHaveLength(1);

    const stateBeforeConflict = JSON.stringify(workflowPort.state);
    const auditBeforeConflict = JSON.stringify(workflowPort.auditIntents);
    requireErrorCode(await workflow.reviewClaim(reviewContext, {
      ...reviewCommand,
      decision: "rejected",
    }), "IDEMPOTENCY_CONFLICT");
    expect(JSON.stringify(workflowPort.state)).toBe(stateBeforeConflict);
    expect(JSON.stringify(workflowPort.auditIntents)).toBe(auditBeforeConflict);

    const staleState = JSON.stringify(workflowPort.state);
    const staleAudit = JSON.stringify(workflowPort.auditIntents);
    requireErrorCode(await workflow.publishVersion(
      workflowContext(
        "actor-designer-reviewer",
        "2026-07-16T00:06:00.000Z",
        "request-publish-stale",
        ["publish_version"],
      ),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: null,
        expectedStateRevision: 0,
        label: "Kitchen baseline before material change",
        idempotencyKey: "publish-stale",
      },
    ), "STATE_STALE");
    expect(JSON.stringify(workflowPort.state)).toBe(staleState);
    expect(JSON.stringify(workflowPort.auditIntents)).toBe(staleAudit);

    const v1 = requireSuccess(await workflow.publishVersion(
      workflowContext(
        "actor-designer-reviewer",
        "2026-07-16T00:06:00.000Z",
        "request-publish-v1",
        ["publish_version"],
      ),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: null,
        expectedStateRevision: 1,
        label: "Kitchen baseline before material change",
        idempotencyKey: "publish-v1",
      },
    ));
    expect(v1.version).toMatchObject({ id: VERSION_V1_ID, versionNo: 1, baseVersionId: null });
    const frozenV1 = JSON.stringify(v1.version);

    const revision = requireSuccess(await workflow.reviseDecision(
      workflowContext(
        "actor-client-approver",
        "2026-07-16T01:00:00.000Z",
        "request-revise-r2",
        ["revise_decision"],
      ),
      {
        projectId: PROJECT_ID,
        nodeId: DECISION_NODE_ID,
        baseVersionId: VERSION_V1_ID,
        expectedRevisionId: DECISION_R1_ID,
        expectedStateRevision: 2,
        title: "Use quartz composite for the kitchen worktop",
        payload: {
          areaId: "area-kitchen",
          material: "quartz_composite",
          subject: "kitchen_worktop",
        },
        reasonCode: "schedule_constraint",
        reason: "Natural stone lead time exceeds the approved project schedule.",
        idempotencyKey: "revise-decision-r2",
      },
    ));
    expect(revision).toMatchObject({
      revision: {
        id: DECISION_R2_ID,
        nodeId: DECISION_NODE_ID,
        replacesRevisionId: DECISION_R1_ID,
        origin: "human",
      },
      changeSet: {
        id: CHANGE_SET_ID,
        fromVersionId: VERSION_V1_ID,
        toVersionId: null,
        status: "pending_publication",
      },
    });
    expect(JSON.stringify(workflowPort.state.publishedVersions[0])).toBe(frozenV1);

    const v2 = requireSuccess(await workflow.publishVersion(
      workflowContext(
        "actor-client-approver",
        "2026-07-16T01:02:00.000Z",
        "request-publish-v2",
        ["publish_version"],
      ),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: VERSION_V1_ID,
        expectedStateRevision: 3,
        label: "Kitchen baseline after worktop material change",
        idempotencyKey: "publish-v2",
      },
    ));
    expect(v2.version).toMatchObject({
      id: VERSION_V2_ID,
      versionNo: 2,
      baseVersionId: VERSION_V1_ID,
    });
    expect(v2.linkedChangeSetIds).toEqual([CHANGE_SET_ID]);
    expect(JSON.stringify(workflowPort.state.publishedVersions[0])).toBe(frozenV1);
    expect(workflowPort.state.publishedVersions).toHaveLength(2);
    expect(JSON.stringify(workflowPort.auditIntents)).not.toContain(
      "Natural stone lead time exceeds the approved project schedule.",
    );

    const publishedChangeSet = workflowPort.state.changeSets.find(
      (changeSet): changeSet is PublishedWorkflowChangeSet => (
        changeSet.id === CHANGE_SET_ID && changeSet.status === "published"
      ),
    );
    expect(publishedChangeSet).toBeDefined();
    if (!publishedChangeSet) throw new Error("Published ChangeSet is missing.");

    const fromVersion = asVersionSnapshot(v1.version);
    const toVersion = asVersionSnapshot(v2.version);
    const changeContext = {
      projectId: PROJECT_ID,
      fromVersionId: VERSION_V1_ID,
      toVersionId: VERSION_V2_ID,
      changeSetId: publishedChangeSet.id,
      reasonCode: publishedChangeSet.reasonCode,
    };
    const changeHandoff = new ChangeHandoffApplicationService({
      idFactory: changeHandoffIdFactory,
    });
    let changeState: ChangeHandoffApplicationState = createEmptyChangeHandoffState(
      ORGANIZATION_ID,
      PROJECT_ID,
    );
    const calculated = requireSuccess(changeHandoff.calculateImpactRun({
      execution: {
        actorId: "actor-impact-worker",
        actorType: "system",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        capabilities: ["calculate_change_impact"],
        serverTime: "2026-07-16T01:03:00.000Z",
        requestId: "request-impact-001",
      },
      state: changeState,
      expectedStateRevision: changeState.stateRevision,
      changeContext,
      fromVersion,
      toVersion,
      targetGraph: v2.version.snapshot,
      idempotencyKey: "calculate-impact-001",
    }));
    changeState = calculated.nextState;
    expect(calculated.result.changedNodeIds).toEqual([DECISION_NODE_ID]);
    expect(calculated.result.changes).toEqual([{
      nodeId: DECISION_NODE_ID,
      changeType: "changed",
      fromRevisionId: DECISION_R1_ID,
      toRevisionId: DECISION_R2_ID,
      changedPaths: ["/material"],
      impactRelevant: true,
    }]);
    const expectedImpacts = fixture<{
      impacts: Array<{
        id: string;
        changedNodeId: string;
        impactedNodeId: string;
        distance: number;
        nodePath: string[];
        edgePath: ImpactRun["impacts"][number]["edgePath"];
        initialReviewStatus: string;
      }>;
    }>("expected-impacts.json");
    expect(calculated.result.impacts.map((impact) => ({
      id: impact.id,
      changedNodeId: impact.changedNodeId,
      impactedNodeId: impact.impactedNodeId,
      distance: impact.distance,
      nodePath: impact.nodePath,
      edgePath: impact.edgePath,
      initialReviewStatus: impact.initialStatus,
    }))).toEqual(expectedImpacts.impacts.map((impact) => ({
      id: impact.id,
      changedNodeId: impact.changedNodeId,
      impactedNodeId: impact.impactedNodeId,
      distance: impact.distance,
      nodePath: impact.nodePath,
      edgePath: impact.edgePath,
      initialReviewStatus: impact.initialReviewStatus,
    })));
    expect(calculated.result.impacts.some(
      ({ impactedNodeId }) => impactedNodeId === "risk-natural-stone-lead-time",
    )).toBe(false);

    const changeAudit = [...calculated.auditIntents];
    for (const impact of calculated.result.impacts) {
      const plan = reviewPlan(impact);
      const reviewedImpact = requireSuccess(changeHandoff.reviewImpact({
        execution: {
          actorId: "actor-designer-reviewer",
          actorType: "human",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          capabilities: ["review_change_impact"],
          serverTime: plan.serverTime,
          requestId: `request-review-${impact.id}`,
        },
        state: changeState,
        expectedStateRevision: changeState.stateRevision,
        impactRun: calculated.result,
        impactId: impact.id,
        expectedImpactStatus: "needs_review",
        disposition: plan.disposition,
        reasonCode: plan.reasonCode,
        idempotencyKey: `review-${impact.id}`,
      }));
      changeState = reviewedImpact.nextState;
      changeAudit.push(...reviewedImpact.auditIntents);
    }
    expect(changeState.impactReviews).toHaveLength(3);

    const handoffInput = {
      execution: {
        actorId: "actor-export-worker",
        actorType: "system" as const,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        capabilities: ["build_logical_handoff" as const],
        serverTime: "2026-07-16T01:15:00.000Z",
        requestId: "request-handoff-001",
      },
      state: changeState,
      expectedStateRevision: changeState.stateRevision,
      changeContext,
      targetVersion: {
        status: "published" as const,
        snapshot: toVersion,
        versionNo: v2.version.versionNo,
        baseVersionId: v2.version.baseVersionId,
        label: v2.version.label ?? "",
      },
      targetGraph: v2.version.snapshot,
      impactRun: calculated.result,
      reviews: changeState.impactReviews,
      policy: handoffPolicy,
      idempotencyKey: "build-handoff-001",
    };
    const handoffTransition = requireSuccess(changeHandoff.buildLogicalHandoff(handoffInput));
    changeAudit.push(...handoffTransition.auditIntents);
    const handoff = handoffTransition.result;
    const expectedHandoff = fixture<LogicalHandoff>("expected-handoff.json");
    expect(handoff.logicalContent).toEqual(expectedHandoff.logicalContent);
    expect(handoff.artifact.semanticContentHash).toBe(
      "sha256:9c7d1eddd1278bda3308fc8c41b20908ee3f600e08848b49a910484fb3e8484b",
    );
    expect(handoff.artifact.semanticContentHash).toBe(semanticSha256(handoff.logicalContent));
    expect(handoff.logicalContent.impacts.unresolved).toHaveLength(2);
    expect(handoff.logicalContent.impacts.resolved).toHaveLength(1);

    const replayedHandoff = requireSuccess(changeHandoff.buildLogicalHandoff({
      ...handoffInput,
      state: handoffTransition.nextState,
      execution: {
        ...handoffInput.execution,
        serverTime: "2026-07-16T01:16:00.000Z",
        requestId: "request-handoff-replay",
      },
    }));
    expect(replayedHandoff.idempotentReplay).toBe(true);
    expect(replayedHandoff.result).toEqual(handoff);
    expect(replayedHandoff.auditIntents).toEqual([]);
    expect(changeAudit.map((event) => event.eventName)).toEqual([
      "impact_run_created",
      "impact_reviewed",
      "impact_reviewed",
      "impact_reviewed",
      "logical_handoff_built",
    ]);
    expect(workflowPort.auditIntents.map((event) => event.eventType)).toEqual([
      "claim_review_confirmed",
      "project_version_published",
      "confirmed_decision_revised",
      "project_version_published",
    ]);
    expect(Object.isFrozen(v1.version)).toBe(true);
    expect(Object.isFrozen(v2.version)).toBe(true);
    expect(Object.isFrozen(calculated.result)).toBe(true);
    expect(Object.isFrozen(handoff)).toBe(true);
  });
});
