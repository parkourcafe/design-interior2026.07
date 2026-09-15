import { describe, expect, it } from "vitest";
import {
  planR1Retention,
  R1_RETENTION_MAX_DRY_RUN_TARGETS,
  R1_RETENTION_POLICY_VERSION,
  type R1RetentionDryRunInput,
} from "./r1-lifecycle";

const baseInput: R1RetentionDryRunInput = {
  now: "2026-10-01T00:00:00Z",
  activeEntitlement: false,
  graceEvent: {
    source: "server_retention_ledger",
    eventId: "11111111-1111-4111-8111-111111111111",
    eventSequence: 7,
    scopeRevision: 3,
    kind: "retention_grace_started",
    effectiveAt: "2026-09-01T00:00:00Z",
    reason: "project_closed",
    policyVersion: R1_RETENTION_POLICY_VERSION,
  },
  hold: false,
  liveReferenceCount: 0,
  scopeKind: "external_attachment",
  targetCount: 3,
  completedTargetCount: 0,
  phase: "idle",
  claimFence: null,
  workerFence: null,
};

describe("R1 retention dry-run planner", () => {
  it("computes exactly 30 UTC days and never authorizes destructive work", () => {
    const beforeExpiry = planR1Retention({
      ...baseInput,
      now: "2026-09-30T23:59:59Z",
    });
    const atExpiry = planR1Retention(baseInput);

    expect(beforeExpiry).toMatchObject({
      decision: "grace_read_only",
      nextAction: "wait_for_expiry",
      access: { read: true, write: false },
      grace: {
        scheduledDeletionAt: "2026-10-01T00:00:00.000Z",
        remainingMs: 1_000,
        sourceEventId: "11111111-1111-4111-8111-111111111111",
        sourceEventSequence: 7,
        sourceScopeRevision: 3,
      },
      purge: { destructiveActionAuthorized: false },
    });
    expect(atExpiry).toMatchObject({
      decision: "eligible_for_owner_review",
      nextAction: "request_owner_purge_gate",
      access: { read: false, write: false },
      purge: { destructiveActionAuthorized: false },
    });
  });

  it("requires a server-ledger grace projection instead of deriving expiry from upload time", () => {
    expect(planR1Retention({
      ...baseInput,
      graceEvent: null,
    })).toMatchObject({
      decision: "awaiting_grace_start",
      nextAction: "record_grace_start",
      grace: {
        scheduledDeletionAt: null,
        sourceEventId: null,
        sourceEventSequence: null,
        sourceScopeRevision: null,
      },
    });
  });

  it("requires a cancel event when entitlement resumes before a purge claim", () => {
    expect(planR1Retention({
      ...baseInput,
      activeEntitlement: true,
      now: "2026-09-15T00:00:00Z",
    })).toMatchObject({
      decision: "active_entitlement",
      nextAction: "record_grace_cancel",
      access: { read: true, write: true },
      grace: { cancelEventRequired: true },
    });
  });

  it("does not let a hold grant access and blocks unclaimed targets", () => {
    expect(planR1Retention({ ...baseInput, hold: true })).toMatchObject({
      decision: "hold",
      nextAction: "resolve_hold",
      access: { read: false, write: false },
    });
  });

  it("blocks a shared blob while another retained scope references it", () => {
    expect(planR1Retention({ ...baseInput, liveReferenceCount: 1 })).toMatchObject({
      decision: "shared_reference",
      nextAction: "resolve_shared_references",
    });
  });

  it("keeps canonical layout payloads behind the unresolved destructive policy gate", () => {
    expect(planR1Retention({ ...baseInput, scopeKind: "canonical_layout" })).toMatchObject({
      decision: "canonical_layout_policy_hold",
      nextAction: "resolve_canonical_layout_policy",
    });
  });

  it("bounds a dry-run target set before an owner gate can be requested", () => {
    expect(planR1Retention({
      ...baseInput,
      targetCount: R1_RETENTION_MAX_DRY_RUN_TARGETS + 1,
    })).toMatchObject({
      decision: "target_limit_exceeded",
      nextAction: "split_target_batch",
    });
  });

  it("does not promise cancellation once a purge claim exists", () => {
    expect(planR1Retention({
      ...baseInput,
      activeEntitlement: true,
      phase: "claimed",
      claimFence: "claim-v7",
    })).toMatchObject({
      decision: "purge_claimed",
      nextAction: "await_fenced_worker",
      grace: { cancelEventRequired: false },
      purge: { claimFence: "claim-v7", destructiveActionAuthorized: false },
    });
  });

  it("stops remaining targets on a late hold without resurrecting completed bytes", () => {
    expect(planR1Retention({
      ...baseInput,
      hold: true,
      phase: "partial",
      claimFence: "claim-v7",
      completedTargetCount: 1,
    })).toMatchObject({
      decision: "partial_purge_hold",
      nextAction: "record_partial_hold",
      purge: {
        completedTargetCount: 1,
        remainingTargetCount: 2,
        destructiveActionAuthorized: false,
      },
    });
  });

  it("rejects a stale worker fence and keeps the claimed generation closed", () => {
    expect(planR1Retention({
      ...baseInput,
      phase: "purging",
      claimFence: "claim-v8",
      workerFence: "claim-v7",
      completedTargetCount: 1,
    })).toMatchObject({
      decision: "stale_worker_fence",
      nextAction: "reject_stale_worker",
      purge: { remainingTargetCount: 2, destructiveActionAuthorized: false },
    });
  });

  it("requires a matching worker fence before a purge can resume", () => {
    expect(planR1Retention({
      ...baseInput,
      phase: "purging",
      claimFence: "claim-v8",
      workerFence: null,
      completedTargetCount: 1,
    })).toMatchObject({
      decision: "worker_fence_required",
      nextAction: "reject_unfenced_worker",
    });

    expect(planR1Retention({
      ...baseInput,
      phase: "purging",
      claimFence: "claim-v8",
      workerFence: "claim-v8",
      completedTargetCount: 1,
    })).toMatchObject({
      decision: "purge_in_progress",
      nextAction: "resume_fenced_purge",
    });
  });

  it("rechecks shared-reference and batch blockers after a claim", () => {
    expect(planR1Retention({
      ...baseInput,
      phase: "claimed",
      claimFence: "claim-v8",
      liveReferenceCount: 1,
    })).toMatchObject({
      decision: "shared_reference",
      nextAction: "resolve_shared_references",
    });

    expect(planR1Retention({
      ...baseInput,
      phase: "claimed",
      claimFence: "claim-v8",
      targetCount: R1_RETENTION_MAX_DRY_RUN_TARGETS + 1,
    })).toMatchObject({
      decision: "target_limit_exceeded",
      nextAction: "split_target_batch",
    });
  });

  it("distinguishes a zero-progress claim hold from a partial purge", () => {
    expect(planR1Retention({
      ...baseInput,
      hold: true,
      phase: "claimed",
      claimFence: "claim-v8",
    })).toMatchObject({
      decision: "hold",
      nextAction: "record_claim_hold",
      purge: { completedTargetCount: 0, remainingTargetCount: 3 },
    });
  });

  it("does not request a purge gate for an empty target set", () => {
    expect(planR1Retention({ ...baseInput, targetCount: 0 })).toMatchObject({
      decision: "nothing_to_purge",
      nextAction: "none",
      purge: { destructiveActionAuthorized: false },
    });
  });

  it("keeps a completed tombstone closed and treats backup deletion separately", () => {
    expect(planR1Retention({
      ...baseInput,
      phase: "tombstoned",
      claimFence: "claim-v8",
      completedTargetCount: 3,
    })).toMatchObject({
      decision: "tombstoned",
      nextAction: "keep_tombstone_closed",
      access: { read: false, write: false },
      backup: {
        policyStatus: "separate_policy_required",
        deletionConfirmed: false,
        restoreMustReapplyTombstone: true,
      },
    });
  });

  it("emits bounded, content-free observability metadata", () => {
    expect(planR1Retention(baseInput).observability).toEqual({
      event: "retention_dry_run",
      policyVersion: R1_RETENTION_POLICY_VERSION,
      evaluatedAt: "2026-10-01T00:00:00.000Z",
      decision: "eligible_for_owner_review",
      phase: "idle",
      liveReferenceCount: 0,
      targetCount: 3,
      completedTargetCount: 0,
    });
  });

  it.each([
    ["non-UTC now", { now: "2026-10-01T03:00:00+03:00" }, "r1_retention_now_must_be_utc"],
    ["negative refs", { liveReferenceCount: -1 }, "r1_retention_live_reference_count_invalid"],
    ["progress overflow", { completedTargetCount: 4 }, "r1_retention_completed_target_count_invalid"],
    ["invalid grace event", { graceEvent: { ...baseInput.graceEvent!, kind: "wrong" } }, "r1_retention_grace_event_invalid"],
    ["upload timestamp without ledger projection", { graceEvent: { effectiveAt: "2026-09-01T00:00:00Z" } }, "r1_retention_grace_event_invalid"],
    ["invalid ledger event id", { graceEvent: { ...baseInput.graceEvent!, eventId: "upload-time" } }, "r1_retention_grace_event_invalid"],
    ["invalid ledger sequence", { graceEvent: { ...baseInput.graceEvent!, eventSequence: 0 } }, "r1_retention_grace_event_invalid"],
    ["future grace event", { graceEvent: { ...baseInput.graceEvent!, effectiveAt: "2026-10-02T00:00:00Z" } }, "r1_retention_grace_event_in_future"],
    ["claim without fence", { phase: "claimed" }, "r1_retention_claim_fence_invalid"],
    ["fence without claim", { claimFence: "claim-v1" }, "r1_retention_claim_fence_invalid"],
    ["invalid partial", { phase: "partial", claimFence: "claim-v1" }, "r1_retention_partial_progress_invalid"],
    ["incomplete tombstone", { phase: "tombstoned", claimFence: "claim-v1" }, "r1_retention_tombstone_progress_invalid"],
    ["claim without grace event", { phase: "claimed", claimFence: "claim-v1", graceEvent: null }, "r1_retention_claim_without_grace_event"],
    ["claim before expiry", { phase: "claimed", claimFence: "claim-v1", now: "2026-09-15T00:00:00Z" }, "r1_retention_claim_before_expiry"],
    ["canonical layout claim", { phase: "claimed", claimFence: "claim-v1", scopeKind: "canonical_layout" }, "r1_retention_canonical_layout_claim_invalid"],
    ["empty claim", { phase: "claimed", claimFence: "claim-v1", targetCount: 0 }, "r1_retention_empty_claim_invalid"],
  ] as const)("fails closed for %s", (_name, delta, error) => {
    expect(() => planR1Retention({ ...baseInput, ...delta } as unknown as R1RetentionDryRunInput)).toThrow(error);
  });
});
