import { describe, expect, it } from "vitest";
import type { JsonValue, ProjectGraphSnapshot } from "../../index";
import {
  canonicalizeWorkflowCommand,
  createWorkflowApplicationService,
  type PublishVersionCommand,
  type ReviseDecisionCommand,
  type ReviewClaimCommand,
  type WorkflowApplicationError,
  type WorkflowApplicationResult,
  type WorkflowAtomicCommit,
  type WorkflowAuditIntent,
  type WorkflowCommandDigester,
  type WorkflowCommandIdentity,
  type WorkflowCommitResult,
  type WorkflowExecutionContext,
  type WorkflowIdFactory,
  type WorkflowIdKind,
  type WorkflowLoadRequest,
  type WorkflowLoadResult,
  type WorkflowState,
  type WorkflowStatePort,
  type WorkflowStoredResult,
} from "./index";

const ORGANIZATION_ID = "organization-synthetic-001";
const PROJECT_ID = "project-synthetic-001";
const DECISION_NODE_ID = "decision-worktop-material";
const REVISION_R1_ID = "revision-worktop-r1";
const SOURCE_ID = "source-transcript-synthetic";
const FRAGMENT_ID = "fragment-transcript-synthetic";
const EVIDENCE_ID = "evidence-worktop-r1";
const REVIEWED_AT = "2026-07-16T00:05:00.000Z";
const V1_PUBLISHED_AT = "2026-07-16T00:06:00.000Z";
const REVISED_AT = "2026-07-16T01:00:00.000Z";
const V2_PUBLISHED_AT = "2026-07-16T01:02:00.000Z";

const R1_PAYLOAD: JsonValue = {
  areaId: "area-kitchen",
  material: "natural_stone",
  subject: "kitchen_worktop",
};

const R2_PAYLOAD: JsonValue = {
  areaId: "area-kitchen",
  material: "quartz_composite",
  subject: "kitchen_worktop",
};

function initialDraft(): ProjectGraphSnapshot {
  return {
    projectId: PROJECT_ID,
    versionId: "draft-synthetic-initial",
    sources: [{
      id: SOURCE_ID,
      projectId: PROJECT_ID,
      kind: "transcript",
      checksum: "sha256:synthetic",
    }],
    sourceFragments: [{
      id: FRAGMENT_ID,
      projectId: PROJECT_ID,
      sourceId: SOURCE_ID,
      locator: { kind: "transcript", startMs: 0, endMs: 1_000 },
    }],
    nodes: [{
      id: DECISION_NODE_ID,
      projectId: PROJECT_ID,
      kind: "decision",
      stableKey: "kitchen-worktop-material",
      currentRevisionId: REVISION_R1_ID,
    }],
    revisions: [{
      id: REVISION_R1_ID,
      nodeId: DECISION_NODE_ID,
      projectId: PROJECT_ID,
      title: "Use natural stone",
      payload: R1_PAYLOAD,
      origin: "ai",
      claimStatus: "extracted",
    }],
    reviews: [],
    evidenceLinks: [{
      id: EVIDENCE_ID,
      projectId: PROJECT_ID,
      nodeRevisionId: REVISION_R1_ID,
      sourceFragmentId: FRAGMENT_ID,
    }],
    edges: [],
  };
}

function initialState(): WorkflowState {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    stateRevision: 0,
    draft: initialDraft(),
    publishedVersions: [],
    changeSets: [],
  };
}

function context(
  serverTime: string,
  requestId: string,
  overrides: Partial<WorkflowExecutionContext["actor"]> = {},
): WorkflowExecutionContext {
  return {
    actor: {
      actorId: "actor-human-synthetic",
      actorType: "human",
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      capabilities: ["review_claim", "publish_version", "revise_decision"],
      ...overrides,
    },
    serverTime,
    requestId,
  };
}

function reviewCommand(
  overrides: Partial<ReviewClaimCommand> = {},
): ReviewClaimCommand {
  return {
    projectId: PROJECT_ID,
    targetRevisionId: REVISION_R1_ID,
    expectedRevisionId: REVISION_R1_ID,
    expectedStateRevision: 0,
    decision: "confirmed",
    idempotencyKey: "review-r1-key",
    ...overrides,
  };
}

function publishV1Command(
  overrides: Partial<PublishVersionCommand> = {},
): PublishVersionCommand {
  return {
    projectId: PROJECT_ID,
    expectedLatestVersionId: null,
    expectedStateRevision: 1,
    label: "Approved kitchen baseline",
    idempotencyKey: "publish-v1-key",
    ...overrides,
  };
}

function reviseCommand(
  overrides: Partial<ReviseDecisionCommand> = {},
): ReviseDecisionCommand {
  return {
    projectId: PROJECT_ID,
    nodeId: DECISION_NODE_ID,
    baseVersionId: "version-synthetic-v1",
    expectedRevisionId: REVISION_R1_ID,
    expectedStateRevision: 2,
    title: "Use quartz composite",
    payload: R2_PAYLOAD,
    reasonCode: "schedule_constraint",
    reason: "Natural stone lead time exceeds the approved schedule.",
    idempotencyKey: "revise-r2-key",
    ...overrides,
  };
}

class ControlledIdFactory implements WorkflowIdFactory {
  readonly calls: WorkflowIdKind[] = [];
  private readonly offsets = new Map<WorkflowIdKind, number>();

  private readonly values: Record<WorkflowIdKind, readonly string[]> = {
    review: ["review-synthetic-r1", "review-synthetic-r2", "review-synthetic-r3"],
    version: ["version-synthetic-v1", "version-synthetic-v2"],
    revision: ["revision-worktop-r2", "revision-worktop-r3"],
    change_set: ["change-set-synthetic-v1-v2", "change-set-synthetic-v1-v3"],
  };

  nextId({ kind }: { readonly kind: WorkflowIdKind; readonly projectId: string }): string {
    this.calls.push(kind);
    const offset = this.offsets.get(kind) ?? 0;
    this.offsets.set(kind, offset + 1);
    return this.values[kind][offset] ?? `${kind}-synthetic-${offset + 1}`;
  }
}

class DeterministicDigester implements WorkflowCommandDigester {
  readonly inputs: string[] = [];

  digestCanonicalCommand(canonicalCommand: string): string {
    this.inputs.push(canonicalCommand);
    return `synthetic-digest:${canonicalCommand}`;
  }
}

interface IdempotencyRecord {
  readonly digest: string;
  readonly result: WorkflowStoredResult;
}

class InMemoryWorkflowStatePort implements WorkflowStatePort {
  state: WorkflowState | null;
  readonly auditIntents: WorkflowAuditIntent[] = [];
  readonly records = new Map<string, IdempotencyRecord>();
  loadCount = 0;
  commitCount = 0;
  forceNextStateStale = false;

  constructor(state: WorkflowState | null) {
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
    this.loadCount += 1;
    const existing = this.records.get(this.key(request.commandIdentity));
    if (existing) {
      return existing.digest === request.commandIdentity.digest
        ? { kind: "replay", result: existing.result }
        : { kind: "idempotency_conflict" };
    }
    if (
      !this.state
      || this.state.projectId !== request.projectId
      || this.state.organizationId !== request.organizationId
    ) {
      return { kind: "not_found" };
    }
    return { kind: "loaded", state: this.state };
  }

  async commit(request: WorkflowAtomicCommit): Promise<WorkflowCommitResult> {
    this.commitCount += 1;
    const key = this.key(request.commandIdentity);
    const existing = this.records.get(key);
    if (existing) {
      return existing.digest === request.commandIdentity.digest
        ? { kind: "replay", result: existing.result }
        : { kind: "idempotency_conflict" };
    }
    if (
      !this.state
      || this.state.projectId !== request.projectId
      || this.state.organizationId !== request.organizationId
    ) {
      return { kind: "not_found" };
    }
    if (this.forceNextStateStale) {
      this.forceNextStateStale = false;
      return {
        kind: "state_stale",
        currentStateRevision: this.state.stateRevision,
      };
    }
    if (this.state.stateRevision !== request.expectedStateRevision) {
      return {
        kind: "state_stale",
        currentStateRevision: this.state.stateRevision,
      };
    }

    // These three writes are deliberately adjacent: the test adapter models one
    // logical transaction and performs no state change on any earlier return.
    this.state = request.nextState;
    this.records.set(key, {
      digest: request.commandIdentity.digest,
      result: request.result,
    });
    this.auditIntents.push(...request.auditIntents);
    return { kind: "committed" };
  }
}

function setup() {
  const statePort = new InMemoryWorkflowStatePort(initialState());
  const idFactory = new ControlledIdFactory();
  const commandDigester = new DeterministicDigester();
  const service = createWorkflowApplicationService({
    statePort,
    idFactory,
    commandDigester,
  });
  return { service, statePort, idFactory, commandDigester };
}

function valueOf<T>(result: WorkflowApplicationResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function errorOf<T>(
  result: WorkflowApplicationResult<T>,
  expectedCode: WorkflowApplicationError["code"],
): WorkflowApplicationError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a workflow failure.");
  expect(result.error.code).toBe(expectedCode);
  return result.error;
}

async function progressToV1(environment: ReturnType<typeof setup>) {
  valueOf(await environment.service.reviewClaim(
    context(REVIEWED_AT, "request-review-r1"),
    reviewCommand(),
  ));
  return valueOf(await environment.service.publishVersion(
    context(V1_PUBLISHED_AT, "request-publish-v1"),
    publishV1Command(),
  ));
}

async function progressToV2(environment: ReturnType<typeof setup>) {
  const v1 = await progressToV1(environment);
  const revision = valueOf(await environment.service.reviseDecision(
    context(REVISED_AT, "request-revise-r2"),
    reviseCommand(),
  ));
  const v2 = valueOf(await environment.service.publishVersion(
    context(V2_PUBLISHED_AT, "request-publish-v2"),
    {
      projectId: PROJECT_ID,
      expectedLatestVersionId: v1.version.id,
      expectedStateRevision: 3,
      label: "Kitchen baseline after worktop material change",
      idempotencyKey: "publish-v2-key",
    },
  ));
  return { v1, revision, v2 };
}

describe("WorkflowApplicationService", () => {
  it("rejects sparse arrays instead of colliding with dense canonical JSON", () => {
    const sparse: JsonValue[] = [];
    sparse.length = 1;

    expect(canonicalizeWorkflowCommand([])).toBe("[]");
    expect(() => canonicalizeWorkflowCommand(sparse)).toThrow(/sparse arrays/i);
  });

  it("confirms an exact AI revision without changing its origin or evidence", async () => {
    const environment = setup();
    const beforeRevision = JSON.stringify(environment.statePort.state!.draft.revisions[0]);
    const beforeEvidence = JSON.stringify(environment.statePort.state!.draft.evidenceLinks);

    const outcome = valueOf(await environment.service.reviewClaim(
      context(REVIEWED_AT, "request-review-r1"),
      reviewCommand(),
    ));

    expect(outcome).toMatchObject({
      stateRevision: 1,
      effectiveClaimStatus: "human_confirmed",
      review: {
        id: "review-synthetic-r1",
        targetRevisionId: REVISION_R1_ID,
        decision: "confirmed",
        actor: { id: "actor-human-synthetic", type: "human" },
        reviewedAt: REVIEWED_AT,
      },
    });
    expect(JSON.stringify(environment.statePort.state!.draft.revisions[0])).toBe(beforeRevision);
    expect(JSON.stringify(environment.statePort.state!.draft.evidenceLinks)).toBe(beforeEvidence);
    expect(environment.statePort.state!.draft.versionId)
      .toBe(`draft:${PROJECT_ID}:state:1`);
    expect(environment.statePort.state!.draft.revisions[0]).toMatchObject({
      origin: "ai",
      claimStatus: "extracted",
    });
    expect(environment.statePort.auditIntents).toEqual([
      expect.objectContaining({
        eventType: "claim_review_confirmed",
        actor: { actorId: "actor-human-synthetic", actorType: "human" },
        occurredAt: REVIEWED_AT,
      }),
    ]);
  });

  it("denies AI/system human actions before loading or mutating state", async () => {
    for (const actorType of ["ai", "system"] as const) {
      const environment = setup();
      const before = JSON.stringify(environment.statePort.state);
      const result = await environment.service.reviewClaim(
        context(REVIEWED_AT, `request-${actorType}`, {
          actorId: `actor-${actorType}`,
          actorType,
        }),
        reviewCommand(),
      );

      errorOf(result, "ACCESS_DENIED");
      expect(environment.statePort.loadCount).toBe(0);
      expect(environment.statePort.commitCount).toBe(0);
      expect(JSON.stringify(environment.statePort.state)).toBe(before);
      expect(environment.statePort.auditIntents).toEqual([]);
    }
  });

  it("maps missing AI evidence and cross-project graph state to controlled failures", async () => {
    const missingEvidence = setup();
    missingEvidence.statePort.state = {
      ...missingEvidence.statePort.state!,
      draft: {
        ...missingEvidence.statePort.state!.draft,
        evidenceLinks: [],
      },
    };
    errorOf(await missingEvidence.service.reviewClaim(
      context(REVIEWED_AT, "request-missing-evidence"),
      reviewCommand({ idempotencyKey: "review-missing-evidence" }),
    ), "EVIDENCE_ACK_REQUIRED");
    expect(missingEvidence.statePort.commitCount).toBe(0);
    expect(missingEvidence.statePort.auditIntents).toEqual([]);

    const crossProject = setup();
    crossProject.statePort.state = {
      ...crossProject.statePort.state!,
      draft: {
        ...crossProject.statePort.state!.draft,
        revisions: crossProject.statePort.state!.draft.revisions.map((revision) => ({
          ...revision,
          projectId: "project-other-002",
        })),
      },
    };
    errorOf(await crossProject.service.reviewClaim(
      context(REVIEWED_AT, "request-cross-project-state"),
      reviewCommand({ idempotencyKey: "review-cross-project-state" }),
    ), "PROJECT_SCOPE_VIOLATION");
    expect(crossProject.statePort.commitCount).toBe(0);
    expect(crossProject.statePort.auditIntents).toEqual([]);
  });

  it("replays the same key/digest before stale-state checks and conflicts on a different digest", async () => {
    const environment = setup();
    const command = reviewCommand();
    const first = await environment.service.reviewClaim(
      context(REVIEWED_AT, "request-review-r1"),
      command,
    );
    const stateAfterFirst = JSON.stringify(environment.statePort.state);
    const idCallsAfterFirst = [...environment.idFactory.calls];

    const replay = await environment.service.reviewClaim(
      context("2026-07-16T00:07:00.000Z", "request-review-replay"),
      command,
    );
    expect(replay).toEqual({
      ok: true,
      value: valueOf(first),
      idempotentReplay: true,
    });
    expect(environment.idFactory.calls).toEqual(idCallsAfterFirst);
    expect(JSON.stringify(environment.statePort.state)).toBe(stateAfterFirst);
    expect(environment.statePort.auditIntents).toHaveLength(1);

    const conflict = await environment.service.reviewClaim(
      context("2026-07-16T00:08:00.000Z", "request-review-conflict"),
      reviewCommand({ decision: "rejected" }),
    );
    errorOf(conflict, "IDEMPOTENCY_CONFLICT");
    expect(JSON.stringify(environment.statePort.state)).toBe(stateAfterFirst);
    expect(environment.statePort.auditIntents).toHaveLength(1);
  });

  it("resolves a concurrent same-key commit race to one review and one logical result", async () => {
    const environment = setup();
    const command = reviewCommand();
    const [left, right] = await Promise.all([
      environment.service.reviewClaim(
        context(REVIEWED_AT, "request-review-concurrent-left"),
        command,
      ),
      environment.service.reviewClaim(
        context(REVIEWED_AT, "request-review-concurrent-right"),
        command,
      ),
    ]);

    expect(valueOf(left)).toEqual(valueOf(right));
    expect([left, right].filter((result) => result.ok && result.idempotentReplay))
      .toHaveLength(1);
    expect(environment.statePort.state!.stateRevision).toBe(1);
    expect(environment.statePort.state!.draft.reviews).toHaveLength(1);
    expect(environment.statePort.records.size).toBe(1);
    expect(environment.statePort.auditIntents).toHaveLength(1);
  });

  it("denies a human review aimed at an exact revision that is no longer current", async () => {
    const environment = setup();
    await progressToV1(environment);
    valueOf(await environment.service.reviseDecision(
      context(REVISED_AT, "request-revise-r2"),
      reviseCommand(),
    ));
    const before = JSON.stringify(environment.statePort.state);
    const auditCount = environment.statePort.auditIntents.length;

    const result = await environment.service.reviewClaim(
      context("2026-07-16T01:01:00.000Z", "request-stale-review"),
      reviewCommand({
        expectedStateRevision: 3,
        idempotencyKey: "review-stale-r1-key",
      }),
    );

    const stale = errorOf(result, "REVISION_STALE");
    expect(stale.details?.currentRevisionId).toBe("revision-worktop-r2");
    expect(JSON.stringify(environment.statePort.state)).toBe(before);
    expect(environment.statePort.auditIntents).toHaveLength(auditCount);
  });

  it("publishes immutable V1 and rejects unconfirmed, stale-state and stale-latest attempts", async () => {
    const unconfirmed = setup();
    const noConfirmation = await unconfirmed.service.publishVersion(
      context(V1_PUBLISHED_AT, "request-unconfirmed-publish"),
      publishV1Command({ expectedStateRevision: 0 }),
    );
    const confirmationError = errorOf(noConfirmation, "INVALID_TRANSITION");
    expect(confirmationError.details?.detailCode).toBe("UNCONFIRMED_REQUIRED_CLAIM");
    expect(unconfirmed.statePort.auditIntents).toEqual([]);

    const environment = setup();
    valueOf(await environment.service.reviewClaim(
      context(REVIEWED_AT, "request-review-r1"),
      reviewCommand(),
    ));
    const afterReview = JSON.stringify(environment.statePort.state);
    const auditCount = environment.statePort.auditIntents.length;

    errorOf(await environment.service.publishVersion(
      context(V1_PUBLISHED_AT, "request-stale-state"),
      publishV1Command({ expectedStateRevision: 0, idempotencyKey: "publish-stale-state" }),
    ), "STATE_STALE");
    errorOf(await environment.service.publishVersion(
      context(V1_PUBLISHED_AT, "request-stale-version"),
      publishV1Command({
        expectedLatestVersionId: "version-obsolete",
        idempotencyKey: "publish-stale-version",
      }),
    ), "VERSION_STALE");
    expect(JSON.stringify(environment.statePort.state)).toBe(afterReview);
    expect(environment.statePort.auditIntents).toHaveLength(auditCount);

    const published = valueOf(await environment.service.publishVersion(
      context(V1_PUBLISHED_AT, "request-publish-v1"),
      publishV1Command(),
    ));
    expect(published).toMatchObject({
      stateRevision: 2,
      version: {
        id: "version-synthetic-v1",
        versionNo: 1,
        baseVersionId: null,
        publishedAt: V1_PUBLISHED_AT,
        publishedBy: { actorId: "actor-human-synthetic", actorType: "human" },
      },
      linkedChangeSetIds: [],
    });
    expect(published.version.snapshot.versionId).toBe("version-synthetic-v1");
    expect(Object.isFrozen(published.version)).toBe(true);
    expect(Object.isFrozen(published.version.snapshot.revisions[0]!.payload)).toBe(true);
    expect(environment.statePort.state!.publishedVersions).toHaveLength(1);

    const replay = await environment.service.publishVersion(
      context("2026-07-16T00:09:00.000Z", "request-publish-v1-replay"),
      publishV1Command(),
    );
    expect(replay).toEqual({ ok: true, value: published, idempotentReplay: true });
    expect(environment.statePort.state!.publishedVersions).toHaveLength(1);
    expect(environment.idFactory.calls.filter((kind) => kind === "version")).toHaveLength(1);
  });

  it("rejects same-ID revision content and stable-node identity changes across snapshots", async () => {
    const revisionTamper = setup();
    const v1 = await progressToV1(revisionTamper);
    const corruptedRevisionState = JSON.parse(
      JSON.stringify(revisionTamper.statePort.state),
    ) as WorkflowState;
    corruptedRevisionState.draft.revisions[0]!.payload = {
      material: "payload_changed_without_new_revision_id",
    };
    revisionTamper.statePort.state = corruptedRevisionState;
    const corruptedBytes = JSON.stringify(corruptedRevisionState);
    const auditsBefore = revisionTamper.statePort.auditIntents.length;

    const immutableError = errorOf(await revisionTamper.service.publishVersion(
      context(V2_PUBLISHED_AT, "request-publish-corrupt-revision"),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: v1.version.id,
        expectedStateRevision: 2,
        idempotencyKey: "publish-corrupt-revision",
      },
    ), "DOMAIN_CONTRACT_VIOLATION");
    expect(immutableError.details?.originalDomainCode)
      .toBe("revision_immutability_violation");
    expect(JSON.stringify(revisionTamper.statePort.state)).toBe(corruptedBytes);
    expect(revisionTamper.statePort.auditIntents).toHaveLength(auditsBefore);

    const nodeTamper = setup();
    const nodeV1 = await progressToV1(nodeTamper);
    const corruptedNodeState = JSON.parse(JSON.stringify(nodeTamper.statePort.state)) as WorkflowState;
    corruptedNodeState.draft.nodes[0]!.stableKey = "changed-stable-key";
    nodeTamper.statePort.state = corruptedNodeState;
    const stableNodeError = errorOf(await nodeTamper.service.publishVersion(
      context(V2_PUBLISHED_AT, "request-publish-corrupt-node"),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: nodeV1.version.id,
        expectedStateRevision: 2,
        idempotencyKey: "publish-corrupt-node",
      },
    ), "DOMAIN_CONTRACT_VIOLATION");
    expect(stableNodeError.details?.detailCode).toBe("STABLE_NODE_IDENTITY_VIOLATION");
    expect(nodeTamper.statePort.auditIntents).toHaveLength(2);
  });

  it("creates human r2 and protected pending ChangeSet from the exact confirmed V1", async () => {
    const environment = setup();
    const v1 = await progressToV1(environment);
    const v1Bytes = JSON.stringify(v1.version);

    const outcome = valueOf(await environment.service.reviseDecision(
      context(REVISED_AT, "request-revise-r2"),
      reviseCommand(),
    ));

    expect(outcome).toMatchObject({
      stateRevision: 3,
      revision: {
        id: "revision-worktop-r2",
        nodeId: DECISION_NODE_ID,
        projectId: PROJECT_ID,
        origin: "human",
        claimStatus: "interpreted",
        replacesRevisionId: REVISION_R1_ID,
        payload: R2_PAYLOAD,
      },
      review: {
        id: "review-synthetic-r2",
        targetRevisionId: "revision-worktop-r2",
        decision: "confirmed",
        actor: { id: "actor-human-synthetic", type: "human" },
        reviewedAt: REVISED_AT,
      },
      changeSet: {
        id: "change-set-synthetic-v1-v2",
        fromVersionId: "version-synthetic-v1",
        toVersionId: null,
        fromRevisionId: REVISION_R1_ID,
        toRevisionId: "revision-worktop-r2",
        reasonCode: "schedule_constraint",
        reason: "Natural stone lead time exceeds the approved schedule.",
        actor: { actorId: "actor-human-synthetic", actorType: "human" },
        occurredAt: REVISED_AT,
        status: "pending_publication",
      },
    });
    expect(environment.statePort.state!.draft.nodes).toEqual([
      expect.objectContaining({ currentRevisionId: "revision-worktop-r2" }),
    ]);
    expect(environment.statePort.state!.draft.revisions.find(({ id }) => id === REVISION_R1_ID))
      .toMatchObject({ origin: "ai", payload: R1_PAYLOAD });
    expect(environment.statePort.state!.draft.evidenceLinks).toContainEqual(
      expect.objectContaining({ id: EVIDENCE_ID, nodeRevisionId: REVISION_R1_ID }),
    );
    expect(JSON.stringify(environment.statePort.state!.publishedVersions[0])).toBe(v1Bytes);

    const audit = environment.statePort.auditIntents.at(-1)!;
    expect(audit).toMatchObject({
      eventType: "confirmed_decision_revised",
      reasonCode: "schedule_constraint",
      occurredAt: REVISED_AT,
    });
    expect(JSON.stringify(audit)).not.toContain("Natural stone lead time");
  });

  it("captures command and server context before awaits so digest and committed content cannot diverge", async () => {
    const environment = setup();
    await progressToV1(environment);
    const mutablePayload: { [key: string]: JsonValue } = {
      areaId: "area-kitchen",
      material: "quartz_composite",
      subject: "kitchen_worktop",
    };
    const mutableCommand = reviseCommand({
      payload: mutablePayload,
      idempotencyKey: "revise-input-capture",
    });
    const mutableContext = context(REVISED_AT, "request-input-capture");

    const pending = environment.service.reviseDecision(mutableContext, mutableCommand);
    mutablePayload.material = "mutated_after_invocation";
    (mutableCommand as { reason: string }).reason = "";
    (mutableCommand as { title: string }).title = "Mutated title";
    (mutableContext.actor as { actorId: string }).actorId = "actor-mutated";
    (mutableContext as { serverTime: string }).serverTime = "2027-01-01T00:00:00.000Z";

    const outcome = valueOf(await pending);
    expect(outcome.revision).toMatchObject({
      title: "Use quartz composite",
      payload: R2_PAYLOAD,
    });
    expect(outcome.changeSet).toMatchObject({
      reason: "Natural stone lead time exceeds the approved schedule.",
      actor: { actorId: "actor-human-synthetic" },
      occurredAt: REVISED_AT,
    });
    expect(environment.commandDigester.inputs.at(-1)).not.toContain("mutated_after_invocation");
  });

  it("denies non-human decision revision and applies revise idempotency on load", async () => {
    const denied = setup();
    await progressToV1(denied);
    const deniedState = JSON.stringify(denied.statePort.state);
    errorOf(await denied.service.reviseDecision(
      context(REVISED_AT, "request-system-revise", {
        actorId: "actor-system",
        actorType: "system",
      }),
      reviseCommand(),
    ), "ACCESS_DENIED");
    expect(JSON.stringify(denied.statePort.state)).toBe(deniedState);
    expect(denied.statePort.auditIntents).toHaveLength(2);

    const environment = setup();
    await progressToV1(environment);
    const command = reviseCommand();
    const first = await environment.service.reviseDecision(
      context(REVISED_AT, "request-revise-first"),
      command,
    );
    const afterFirst = JSON.stringify(environment.statePort.state);
    const replay = await environment.service.reviseDecision(
      context("2026-07-16T01:01:00.000Z", "request-revise-replay"),
      command,
    );
    expect(replay).toEqual({ ok: true, value: valueOf(first), idempotentReplay: true });
    errorOf(await environment.service.reviseDecision(
      context("2026-07-16T01:01:00.000Z", "request-revise-conflict"),
      reviseCommand({ reason: "Different protected reason with the same key." }),
    ), "IDEMPOTENCY_CONFLICT");
    expect(JSON.stringify(environment.statePort.state)).toBe(afterFirst);
    expect(environment.statePort.auditIntents).toHaveLength(3);
  });

  it("rejects empty reason, semantic no-op, stale revision and stale base without partial writes", async () => {
    const environment = setup();
    await progressToV1(environment);
    const before = JSON.stringify(environment.statePort.state);
    const auditsBefore = JSON.stringify(environment.statePort.auditIntents);
    const recordsBefore = environment.statePort.records.size;

    errorOf(await environment.service.reviseDecision(
      context(REVISED_AT, "request-empty-reason"),
      reviseCommand({ reason: "   ", idempotencyKey: "revise-empty-reason" }),
    ), "CHANGE_REASON_REQUIRED");

    const noOpError = errorOf(await environment.service.reviseDecision(
      context(REVISED_AT, "request-no-op"),
      reviseCommand({
        title: "A title change does not hide an identical decision payload",
        payload: { subject: "kitchen_worktop", material: "natural_stone", areaId: "area-kitchen" },
        idempotencyKey: "revise-no-op",
      }),
    ), "INVALID_TRANSITION");
    expect(noOpError.details?.detailCode).toBe("NO_SEMANTIC_CHANGE");

    errorOf(await environment.service.reviseDecision(
      context(REVISED_AT, "request-stale-revision"),
      reviseCommand({ expectedRevisionId: "revision-obsolete", idempotencyKey: "revise-stale-revision" }),
    ), "REVISION_STALE");
    errorOf(await environment.service.reviseDecision(
      context(REVISED_AT, "request-stale-base"),
      reviseCommand({ baseVersionId: "version-obsolete", idempotencyKey: "revise-stale-base" }),
    ), "VERSION_STALE");

    expect(JSON.stringify(environment.statePort.state)).toBe(before);
    expect(JSON.stringify(environment.statePort.auditIntents)).toBe(auditsBefore);
    expect(environment.statePort.records.size).toBe(recordsBefore);
  });

  it("rejects malformed version base chains and non-exact ChangeSet lineage loaded from a port", async () => {
    const brokenVersion = setup();
    await progressToV1(brokenVersion);
    const brokenVersionState = JSON.parse(JSON.stringify(brokenVersion.statePort.state)) as WorkflowState;
    (brokenVersionState.publishedVersions[0] as { baseVersionId: string | null })
      .baseVersionId = "version-synthetic-v1";
    brokenVersion.statePort.state = brokenVersionState;
    const versionError = errorOf(await brokenVersion.service.reviseDecision(
      context(REVISED_AT, "request-broken-version-chain"),
      reviseCommand({ idempotencyKey: "revise-broken-version-chain" }),
    ), "DOMAIN_CONTRACT_VIOLATION");
    expect(versionError.details?.detailCode).toBe("INVALID_VERSION_BASE_CHAIN");
    expect(brokenVersion.statePort.auditIntents).toHaveLength(2);

    const brokenChangeSet = setup();
    await progressToV1(brokenChangeSet);
    valueOf(await brokenChangeSet.service.reviseDecision(
      context(REVISED_AT, "request-create-change-set"),
      reviseCommand(),
    ));
    const brokenChangeSetState = JSON.parse(
      JSON.stringify(brokenChangeSet.statePort.state),
    ) as WorkflowState;
    (brokenChangeSetState.changeSets[0] as { fromRevisionId: string })
      .fromRevisionId = "revision-worktop-r2";
    brokenChangeSet.statePort.state = brokenChangeSetState;
    const changeSetError = errorOf(await brokenChangeSet.service.publishVersion(
      context(V2_PUBLISHED_AT, "request-broken-change-set"),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: "version-synthetic-v1",
        expectedStateRevision: 3,
        idempotencyKey: "publish-broken-change-set",
      },
    ), "DOMAIN_CONTRACT_VIOLATION");
    expect(changeSetError.details?.detailCode).toBe("INVALID_CHANGE_SET_LINEAGE");
    expect(brokenChangeSet.statePort.auditIntents).toHaveLength(3);

    const descendantDraft = setup();
    await progressToV1(descendantDraft);
    valueOf(await descendantDraft.service.reviseDecision(
      context(REVISED_AT, "request-create-descendant-base"),
      reviseCommand(),
    ));
    const descendantState = JSON.parse(
      JSON.stringify(descendantDraft.statePort.state),
    ) as WorkflowState;
    descendantState.draft.versionId = "draft-descendant-r3";
    descendantState.draft.nodes[0]!.currentRevisionId = "revision-worktop-r3";
    descendantState.draft.revisions.push({
      id: "revision-worktop-r3",
      nodeId: DECISION_NODE_ID,
      projectId: PROJECT_ID,
      title: "Use a third material",
      payload: { material: "third_material" },
      origin: "human",
      claimStatus: "interpreted",
      replacesRevisionId: "revision-worktop-r2",
    });
    descendantState.draft.reviews = [{
      id: "review-synthetic-r3",
      projectId: PROJECT_ID,
      targetRevisionId: "revision-worktop-r3",
      decision: "confirmed",
      actor: { id: "actor-human-synthetic", type: "human" },
      reviewedAt: "2026-07-16T01:01:00.000Z",
    }];
    descendantDraft.statePort.state = descendantState;
    const descendantError = errorOf(await descendantDraft.service.publishVersion(
      context(V2_PUBLISHED_AT, "request-publish-descendant-r3"),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: "version-synthetic-v1",
        expectedStateRevision: 3,
        idempotencyKey: "publish-descendant-r3",
      },
    ), "DOMAIN_CONTRACT_VIOLATION");
    expect(descendantError.details?.detailCode).toBe("PENDING_CHANGE_SET_DRAFT_MISMATCH");
    expect(descendantDraft.statePort.auditIntents).toHaveLength(3);

    const nonImmediatePublishedChangeSet = setup();
    const { v2 } = await progressToV2(nonImmediatePublishedChangeSet);
    const v3 = valueOf(await nonImmediatePublishedChangeSet.service.publishVersion(
      context("2026-07-16T01:03:00.000Z", "request-publish-v3"),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: v2.version.id,
        expectedStateRevision: 4,
        label: "Unchanged checkpoint",
        idempotencyKey: "publish-v3-key",
      },
    ));
    const nonImmediateState = JSON.parse(
      JSON.stringify(nonImmediatePublishedChangeSet.statePort.state),
    ) as WorkflowState;
    (nonImmediateState.changeSets[0] as { toVersionId: string }).toVersionId = v3.version.id;
    nonImmediatePublishedChangeSet.statePort.state = nonImmediateState;
    const nonImmediateError = errorOf(
      await nonImmediatePublishedChangeSet.service.publishVersion(
        context("2026-07-16T01:04:00.000Z", "request-after-non-immediate-change-set"),
        {
          projectId: PROJECT_ID,
          expectedLatestVersionId: v3.version.id,
          expectedStateRevision: 5,
          idempotencyKey: "publish-after-non-immediate-change-set",
        },
      ),
      "DOMAIN_CONTRACT_VIOLATION",
    );
    expect(nonImmediateError.details?.detailCode).toBe("CHANGE_SET_TO_SNAPSHOT_MISMATCH");
    expect(nonImmediatePublishedChangeSet.statePort.auditIntents).toHaveLength(5);
  });

  it("rejects cross-project commands before port access", async () => {
    const environment = setup();
    const before = JSON.stringify(environment.statePort.state);
    const result = await environment.service.reviewClaim(
      context(REVIEWED_AT, "request-cross-project"),
      reviewCommand({ projectId: "project-other-002" }),
    );

    errorOf(result, "PROJECT_SCOPE_VIOLATION");
    expect(environment.statePort.loadCount).toBe(0);
    expect(environment.statePort.commitCount).toBe(0);
    expect(JSON.stringify(environment.statePort.state)).toBe(before);
    expect(environment.statePort.auditIntents).toEqual([]);
  });

  it("preserves V1 byte/deep equality while publishing V2 and finalizing ChangeSet atomically", async () => {
    const environment = setup();
    const v1 = await progressToV1(environment);
    const capturedV1 = JSON.parse(JSON.stringify(v1.version)) as unknown;
    const v1Bytes = JSON.stringify(v1.version);
    const revision = valueOf(await environment.service.reviseDecision(
      context(REVISED_AT, "request-revise-r2"),
      reviseCommand(),
    ));
    const v2 = valueOf(await environment.service.publishVersion(
      context(V2_PUBLISHED_AT, "request-publish-v2"),
      {
        projectId: PROJECT_ID,
        expectedLatestVersionId: v1.version.id,
        expectedStateRevision: 3,
        label: "Kitchen baseline after worktop material change",
        idempotencyKey: "publish-v2-key",
      },
    ));

    const finalState = environment.statePort.state!;
    expect(finalState.publishedVersions).toHaveLength(2);
    expect(finalState.publishedVersions[0]).toEqual(capturedV1);
    expect(JSON.stringify(finalState.publishedVersions[0])).toBe(v1Bytes);
    expect(v2.version).toMatchObject({
      id: "version-synthetic-v2",
      versionNo: 2,
      baseVersionId: "version-synthetic-v1",
    });
    expect(v2.version.snapshot.nodes[0]!.currentRevisionId).toBe(revision.revision.id);
    expect(v2.linkedChangeSetIds).toEqual([revision.changeSet.id]);
    expect(finalState.changeSets).toEqual([
      expect.objectContaining({
        id: revision.changeSet.id,
        status: "published",
        fromVersionId: v1.version.id,
        toVersionId: v2.version.id,
      }),
    ]);
    expect(environment.statePort.auditIntents.at(-1)).toMatchObject({
      eventType: "project_version_published",
      versionId: "version-synthetic-v2",
      linkedChangeSetIds: [revision.changeSet.id],
    });
  });

  it("leaves state, idempotency and audit unchanged when the atomic port rejects the CAS", async () => {
    const environment = setup();
    environment.statePort.forceNextStateStale = true;
    const before = JSON.stringify(environment.statePort.state);

    const result = await environment.service.reviewClaim(
      context(REVIEWED_AT, "request-forced-cas"),
      reviewCommand(),
    );

    errorOf(result, "STATE_STALE");
    expect(JSON.stringify(environment.statePort.state)).toBe(before);
    expect(environment.statePort.records.size).toBe(0);
    expect(environment.statePort.auditIntents).toEqual([]);
  });

  it("is deterministic with controlled IDs, clock and canonical object-key ordering", async () => {
    const left = setup();
    const right = setup();
    const leftResult = await progressToV2(left);
    const rightResult = await progressToV2(right);

    expect(leftResult).toEqual(rightResult);
    expect(left.statePort.state).toEqual(right.statePort.state);
    expect(left.statePort.auditIntents).toEqual(right.statePort.auditIntents);
    expect(left.idFactory.calls).toEqual(right.idFactory.calls);
    expect(left.commandDigester.inputs).toEqual(right.commandDigester.inputs);
  });
});
