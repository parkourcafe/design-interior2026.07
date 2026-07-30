import { describe, expect, it } from "vitest";
import {
  ChangeHandoffApplicationService,
  IMPACT_REASON_CODES,
  canonicalJson,
  createEmptyChangeHandoffState,
  type ImpactRun,
  type ReviewImpactCommand,
} from "./index";
import {
  calculateExecution,
  changeContext,
  fixtureIdFactory,
  graphV2,
  reviewExecution,
  versionV1,
  versionV2,
} from "./__tests__/support/fixtures";

const service = new ChangeHandoffApplicationService({ idFactory: fixtureIdFactory });

function calculated() {
  const result = service.calculateImpactRun({
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
    idempotencyKey: "calculate-impact-review-test",
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function command(
  overrides: Partial<ReviewImpactCommand> = {},
): ReviewImpactCommand {
  const calculation = calculated();
  return {
    execution: reviewExecution,
    state: calculation.nextState,
    expectedStateRevision: calculation.nextState.stateRevision,
    impactRun: calculation.result,
    impactId: calculation.result.impacts[0]!.id,
    expectedImpactStatus: "needs_review",
    disposition: "accepted",
    reasonCode: "downstream_update_required",
    idempotencyKey: "review-impact-001",
    ...overrides,
  };
}

describe("ChangeHandoffApplicationService.reviewImpact", () => {
  it("exports the complete controlled impact-review reason vocabulary", () => {
    expect(IMPACT_REASON_CODES).toEqual([
      "downstream_update_required",
      "cost_recalculation_required",
      "schedule_updated",
      "downstream_update_completed",
      "not_applicable_to_impacted_node",
      "not_applicable_to_deliverable",
    ]);
  });

  it("creates a separate immutable human review and leaves the run/impact unchanged", () => {
    const input = command();
    const beforeRun = canonicalJson(input.impactRun);
    const result = service.reviewImpact(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result).toEqual({
      id: `review-${input.impactId}-accepted`,
      projectId: changeContext.projectId,
      impactRunId: input.impactRun.id,
      impactId: input.impactId,
      previousStatus: "needs_review",
      disposition: "accepted",
      reasonCode: "downstream_update_required",
      actor: { actorId: reviewExecution.actorId, actorType: "human" },
      reviewedAt: reviewExecution.serverTime,
    });
    expect(canonicalJson(input.impactRun)).toBe(beforeRun);
    expect(result.value.nextState.impactRuns[0]).toEqual(input.impactRun);
    expect(result.value.nextState.impactReviews).toEqual([result.value.result]);
    expect(result.value.auditIntents).toEqual([
      expect.objectContaining({
        eventName: "impact_reviewed",
        actorType: "human",
        controlledMetadata: expect.objectContaining({
          disposition: "accepted",
          reasonCode: "downstream_update_required",
        }),
      }),
    ]);
    expect(Object.isFrozen(result.value.result)).toBe(true);
  });

  it("denies AI/system actors even when they hold the review capability", () => {
    for (const actorType of ["ai", "system"] as const) {
      const input = command({
        execution: {
          ...reviewExecution,
          actorType,
          actorId: `actor-${actorType}`,
        },
      });
      const before = canonicalJson(input.state);
      const result = service.reviewImpact(input);

      expect(result).toMatchObject({
        ok: false,
        error: { code: "ACCESS_DENIED", details: { reasonCode: "HUMAN_ACTOR_REQUIRED" } },
      });
      expect(canonicalJson(input.state)).toBe(before);
    }
  });

  it("rejects duplicate/stale impact status without partial state or audit", () => {
    const firstInput = command();
    const first = service.reviewImpact(firstInput);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const duplicateInput = command({
      state: first.value.nextState,
      expectedStateRevision: first.value.nextState.stateRevision,
      impactRun: firstInput.impactRun,
      impactId: firstInput.impactId,
      idempotencyKey: "review-impact-duplicate-key",
    });
    const before = canonicalJson(first.value.nextState);
    const duplicate = service.reviewImpact(duplicateInput);

    expect(duplicate).toMatchObject({
      ok: false,
      error: {
        code: "IMPACT_STALE",
        details: { expectedImpactStatus: "needs_review", currentImpactStatus: "accepted" },
      },
    });
    expect(canonicalJson(first.value.nextState)).toBe(before);
  });

  it("allows acknowledged unresolved work to move from accepted to resolved explicitly", () => {
    const acceptedInput = command();
    const accepted = service.reviewImpact(acceptedInput);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    const resolved = service.reviewImpact(command({
      execution: {
        ...reviewExecution,
        serverTime: "2026-07-16T01:09:00.000Z",
        requestId: "request-review-resolved",
      },
      state: accepted.value.nextState,
      expectedStateRevision: accepted.value.nextState.stateRevision,
      impactRun: acceptedInput.impactRun,
      impactId: acceptedInput.impactId,
      expectedImpactStatus: "accepted",
      disposition: "resolved",
      reasonCode: "downstream_update_completed",
      idempotencyKey: "review-impact-resolved",
    }));

    expect(resolved.ok && resolved.value.result).toMatchObject({
      previousStatus: "accepted",
      disposition: "resolved",
    });
  });

  it("records dismissed as an explicit reviewed disposition and requires a controlled reason", () => {
    const dismissed = service.reviewImpact(command({
      disposition: "dismissed",
      reasonCode: "not_applicable_to_impacted_node",
      idempotencyKey: "review-impact-dismissed",
    }));
    expect(dismissed.ok && dismissed.value.result).toMatchObject({
      previousStatus: "needs_review",
      disposition: "dismissed",
      reasonCode: "not_applicable_to_impacted_node",
    });

    const missingReason = service.reviewImpact(command({
      disposition: "dismissed",
      reasonCode: " ",
      idempotencyKey: "review-impact-dismissed-missing-reason",
    }));
    expect(missingReason).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSITION", details: { reasonCode: "IMPACT_REASON_REQUIRED" } },
    });
  });

  it("rejects forged runtime dispositions before persistence or audit", () => {
    const input = command({
      disposition: "forged_runtime_value" as ReviewImpactCommand["disposition"],
      idempotencyKey: "review-impact-forged-disposition",
    });
    const before = canonicalJson(input.state);
    const result = service.reviewImpact(input);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "DOMAIN_CONTRACT_VIOLATION",
        details: { reasonCode: "INVALID_IMPACT_DISPOSITION" },
      },
    });
    expect(canonicalJson(input.state)).toBe(before);
  });

  it("rejects free-form impact reasons before they enter controlled audit metadata", () => {
    const input = command({
      reasonCode: "Client email alice@example.com" as ReviewImpactCommand["reasonCode"],
      idempotencyKey: "review-impact-free-form-reason",
    });
    const before = canonicalJson(input.state);
    const result = service.reviewImpact(input);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "DOMAIN_CONTRACT_VIOLATION",
        details: { reasonCode: "INVALID_IMPACT_REASON_CODE" },
      },
    });
    expect(canonicalJson(input.state)).toBe(before);
  });

  it("rejects forged expected statuses as invalid runtime contract values", () => {
    const result = service.reviewImpact(command({
      expectedImpactStatus: "forged_runtime_value" as ReviewImpactCommand["expectedImpactStatus"],
      idempotencyKey: "review-impact-forged-status",
    }));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "DOMAIN_CONTRACT_VIOLATION",
        details: { reasonCode: "INVALID_IMPACT_STATUS" },
      },
    });
  });

  it("rejects a caller-modified or unknown exact run", () => {
    const input = command();
    const modifiedRun: ImpactRun = {
      ...input.impactRun,
      resultDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const result = service.reviewImpact({ ...input, impactRun: modifiedRun });

    expect(result).toMatchObject({ ok: false, error: { code: "IMPACT_STALE" } });
  });

  it("replays one key/digest and returns conflict before any mutation for a changed digest", () => {
    const input = command();
    const first = service.reviewImpact(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = service.reviewImpact({ ...input, state: first.value.nextState });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.idempotentReplay).toBe(true);
    expect(replay.value.result).toEqual(first.value.result);
    expect(replay.value.nextState).toBe(first.value.nextState);
    expect(replay.value.auditIntents).toEqual([]);

    const changedRunContext = service.reviewImpact({
      ...input,
      state: first.value.nextState,
      impactRun: {
        ...input.impactRun,
        changeContext: {
          ...input.impactRun.changeContext,
          reasonCode: "downstream_update_completed",
        },
      },
    });
    expect(changedRunContext).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const before = canonicalJson(first.value.nextState);
    const conflict = service.reviewImpact({
      ...input,
      state: first.value.nextState,
      disposition: "resolved",
      reasonCode: "downstream_update_completed",
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(canonicalJson(first.value.nextState)).toBe(before);
  });
});
