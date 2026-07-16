import { describe, expect, it } from "vitest";
import {
  ChangeHandoffApplicationService,
  canonicalJson,
  createEmptyChangeHandoffState,
  semanticSha256,
  type BuildLogicalHandoffCommand,
  type ChangeHandoffApplicationState,
  type ImpactReasonCode,
  type ImpactReview,
  type ImpactRun,
} from "./index";
import {
  buildExecution,
  calculateExecution,
  changeContext,
  fixture,
  fixtureIdFactory,
  graphV2,
  handoffPolicy,
  reviewExecution,
  targetPublishedVersion,
  versionV1,
  versionV2,
} from "./__tests__/support/fixtures";

const service = new ChangeHandoffApplicationService({ idFactory: fixtureIdFactory });

interface ReviewPlan {
  disposition: "accepted" | "resolved" | "dismissed";
  reasonCode: ImpactReasonCode;
  serverTime: string;
}

function reviewed(reviewOverrides: Partial<Record<string, ReviewPlan>> = {}): {
  state: ChangeHandoffApplicationState;
  run: ImpactRun;
  reviews: readonly ImpactReview[];
} {
  const calculation = service.calculateImpactRun({
    execution: calculateExecution,
    state: createEmptyChangeHandoffState(
      calculateExecution.organizationId,
      calculateExecution.projectId,
    ),
    expectedStateRevision: 0,
    changeContext,
    fromVersion: versionV1,
    toVersion: versionV2,
    targetGraph: graphV2,
    idempotencyKey: "calculate-impact-handoff-test",
  });
  if (!calculation.ok) throw new Error(calculation.error.code);

  let state = calculation.value.nextState;
  const reviewPolicy: Record<string, ReviewPlan> = {
    "item-kitchen-worktop": {
      disposition: "accepted",
      reasonCode: "downstream_update_required",
      serverTime: "2026-07-16T01:06:00.000Z",
    },
    "deliverable-budget": {
      disposition: "accepted",
      reasonCode: "cost_recalculation_required",
      serverTime: "2026-07-16T01:07:00.000Z",
    },
    "deliverable-finish-schedule": {
      disposition: "resolved",
      reasonCode: "schedule_updated",
      serverTime: "2026-07-16T01:08:00.000Z",
    },
    ...reviewOverrides,
  };
  for (const impact of calculation.value.result.impacts) {
    const policy = reviewPolicy[impact.impactedNodeId]!;
    const review = service.reviewImpact({
      execution: {
        ...reviewExecution,
        serverTime: policy.serverTime,
        requestId: `request-${impact.id}`,
      },
      state,
      expectedStateRevision: state.stateRevision,
      impactRun: calculation.value.result,
      impactId: impact.id,
      expectedImpactStatus: "needs_review",
      disposition: policy.disposition,
      reasonCode: policy.reasonCode,
      idempotencyKey: `review-${impact.id}`,
    });
    if (!review.ok) throw new Error(review.error.code);
    state = review.value.nextState;
  }
  return { state, run: calculation.value.result, reviews: state.impactReviews };
}

function command(
  overrides: Partial<BuildLogicalHandoffCommand> = {},
  reviewOverrides: Partial<Record<string, ReviewPlan>> = {},
): BuildLogicalHandoffCommand {
  const reviewedState = reviewed(reviewOverrides);
  return {
    execution: buildExecution,
    state: reviewedState.state,
    expectedStateRevision: reviewedState.state.stateRevision,
    changeContext,
    targetVersion: targetPublishedVersion,
    targetGraph: graphV2,
    impactRun: reviewedState.run,
    reviews: reviewedState.reviews,
    policy: handoffPolicy,
    idempotencyKey: "build-handoff-001",
    ...overrides,
  };
}

describe("ChangeHandoffApplicationService.buildLogicalHandoff", () => {
  it("builds the accepted logical handoff and computes its fixture semantic hash", () => {
    const expected = fixture<{
      logicalContent: unknown;
      artifact: { semanticContentHash: string };
    }>("expected-handoff.json");
    const result = service.buildLogicalHandoff(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result.logicalContent).toEqual(expected.logicalContent);
    expect(result.value.result.artifact.semanticContentHash).toBe(
      expected.artifact.semanticContentHash,
    );
    expect(result.value.result.artifact.semanticContentHash).toBe(
      semanticSha256(result.value.result.logicalContent),
    );
    expect(result.value.result.artifact.artifactId).toBe("export-kitchen-v2-render-001");
    expect(result.value.auditIntents).toEqual([
      expect.objectContaining({ eventName: "logical_handoff_built" }),
    ]);
  });

  it("splits accepted work as unresolved and resolved/dismissed work as resolved", () => {
    const result = service.buildLogicalHandoff(command());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.result.logicalContent.impacts.unresolved.map(({ status }) => status))
      .toEqual(["accepted", "accepted"]);
    expect(result.value.result.logicalContent.impacts.resolved.map(({ status }) => status))
      .toEqual(["resolved"]);
    expect([
      ...result.value.result.logicalContent.impacts.unresolved,
      ...result.value.result.logicalContent.impacts.resolved,
    ].map(({ impactId }) => impactId).sort()).toEqual([
      "impact-deliverable-budget",
      "impact-deliverable-finish-schedule",
      "impact-item-kitchen-worktop",
    ]);

    const dismissed = service.buildLogicalHandoff(command(
      { idempotencyKey: "build-handoff-dismissed" },
      {
        "deliverable-finish-schedule": {
          disposition: "dismissed",
          reasonCode: "not_applicable_to_deliverable",
          serverTime: "2026-07-16T01:08:00.000Z",
        },
      },
    ));
    expect(dismissed.ok && dismissed.value.result.logicalContent.impacts.resolved.map(
      ({ status }) => status,
    )).toEqual(["dismissed"]);
  });

  it("excludes volatile artifact metadata from the hash", () => {
    const result = service.buildLogicalHandoff(command());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const changedArtifact = {
      ...result.value.result,
      artifact: {
        ...result.value.result.artifact,
        artifactId: "another-artifact",
        generatedAt: "2030-01-01T00:00:00.000Z",
        jobStatus: "ready" as const,
      },
    };
    expect(semanticSha256(changedArtifact.logicalContent)).toBe(
      result.value.result.artifact.semanticContentHash,
    );
    expect(canonicalJson(result.value.result.logicalContent)).not.toContain("artifactId");
    expect(canonicalJson(result.value.result.logicalContent)).not.toContain("generatedAt");
    expect(canonicalJson(result.value.result.logicalContent)).not.toContain("jobStatus");
  });

  it("keeps logical content/hash stable for shuffled unordered inputs", () => {
    const base = command({ idempotencyKey: "build-handoff-shuffle" });
    const first = service.buildLogicalHandoff(base);
    const shuffled = service.buildLogicalHandoff({
      ...base,
      targetVersion: {
        ...base.targetVersion,
        snapshot: {
          ...base.targetVersion.snapshot,
          nodes: [...base.targetVersion.snapshot.nodes].reverse(),
        },
      },
      targetGraph: {
        ...base.targetGraph,
        sources: [...base.targetGraph.sources].reverse(),
        sourceFragments: [...base.targetGraph.sourceFragments].reverse(),
        nodes: [...base.targetGraph.nodes].reverse(),
        revisions: [...base.targetGraph.revisions].reverse(),
        reviews: [...base.targetGraph.reviews].reverse(),
        evidenceLinks: [...base.targetGraph.evidenceLinks].reverse(),
        edges: [...base.targetGraph.edges].reverse(),
      },
      reviews: [...base.reviews].reverse(),
      policy: {
        ...base.policy,
        sourceReferenceProjections: [
          ...(base.policy.sourceReferenceProjections ?? []),
        ].reverse(),
      },
    });

    expect(first.ok && first.value.result.logicalContent)
      .toEqual(shuffled.ok && shuffled.value.result.logicalContent);
    expect(first.ok && first.value.result.artifact.semanticContentHash)
      .toBe(shuffled.ok && shuffled.value.result.artifact.semanticContentHash);
    expect(first.ok && first.value.requestDigest).toBe(shuffled.ok && shuffled.value.requestDigest);
  });

  it("rejects a target graph whose evidence binding changed after impact calculation", () => {
    const input = command({ idempotencyKey: "build-handoff-mutated-graph" });
    const mutatedGraph = {
      ...input.targetGraph,
      evidenceLinks: input.targetGraph.evidenceLinks.map((link) => (
        link.id === "evidence-item-plan-r1"
          ? { ...link, sourceFragmentId: "fragment-transcript-decision" }
          : link
      )),
    };
    const before = canonicalJson(input.state);
    const result = service.buildLogicalHandoff({ ...input, targetGraph: mutatedGraph });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        details: { reasonCode: "HANDOFF_TARGET_GRAPH_DIGEST_MISMATCH" },
      },
    });
    expect(canonicalJson(input.state)).toBe(before);
  });

  it("rejects a handoff ChangeContext reason that differs from the calculated run", () => {
    const input = command({ idempotencyKey: "build-handoff-mutated-change-context" });
    const before = canonicalJson(input.state);
    const result = service.buildLogicalHandoff({
      ...input,
      changeContext: {
        ...input.changeContext,
        reasonCode: "downstream_update_completed",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        details: { reasonCode: "HANDOFF_CHANGE_CONTEXT_MISMATCH" },
      },
    });
    expect(canonicalJson(input.state)).toBe(before);
  });

  it("rejects mismatched target version/run and incomplete review snapshots", () => {
    const input = command();
    const wrongVersion = service.buildLogicalHandoff({
      ...input,
      targetVersion: {
        ...input.targetVersion,
        snapshot: { ...input.targetVersion.snapshot, versionId: "version-wrong-v2" },
      },
    });
    expect(wrongVersion).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    });

    const mismatchedRun: ImpactRun = {
      ...input.impactRun,
      toVersionId: "version-wrong-v2",
    };
    const wrongRun = service.buildLogicalHandoff({ ...input, impactRun: mismatchedRun });
    expect(wrongRun).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    });

    const incompleteReviews = service.buildLogicalHandoff({
      ...input,
      reviews: input.reviews.slice(0, -1),
    });
    expect(incompleteReviews).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    });
  });

  it("replays the same build and conflicts atomically on changed trusted policy", () => {
    const input = command();
    const first = service.buildLogicalHandoff(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = service.buildLogicalHandoff({
      ...input,
      state: first.value.nextState,
      execution: {
        ...input.execution,
        serverTime: "2026-07-16T02:00:00.000Z",
        requestId: "request-handoff-retry",
      },
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.idempotentReplay).toBe(true);
    expect(replay.value.result).toEqual(first.value.result);
    expect(replay.value.auditIntents).toEqual([]);

    const before = canonicalJson(first.value.nextState);
    const conflict = service.buildLogicalHandoff({
      ...input,
      state: first.value.nextState,
      policy: {
        ...input.policy,
        displayMetadata: { ...input.policy.displayMetadata, locale: "ru-RU" },
      },
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(canonicalJson(first.value.nextState)).toBe(before);
  });
});
