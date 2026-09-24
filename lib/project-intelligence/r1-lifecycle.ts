const DAY_MS = 24 * 60 * 60 * 1000;

export const R1_RETENTION_GRACE_DAYS = 90;
export const R1_RETENTION_MAX_DRY_RUN_TARGETS = 10_000;
export const R1_RETENTION_POLICY_VERSION = "remhaos.external-retention/1.1";

export type R1RetentionPhase =
  | "idle"
  | "claimed"
  | "purging"
  | "partial"
  | "tombstoned";

export type R1RetentionDecision =
  | "active_entitlement"
  | "awaiting_grace_start"
  | "grace_read_only"
  | "hold"
  | "shared_reference"
  | "canonical_layout_policy_hold"
  | "target_limit_exceeded"
  | "eligible_for_owner_review"
  | "nothing_to_purge"
  | "purge_claimed"
  | "purge_in_progress"
  | "partial_purge_hold"
  | "worker_fence_required"
  | "stale_worker_fence"
  | "tombstoned";

export type R1RetentionNextAction =
  | "none"
  | "record_grace_cancel"
  | "record_grace_start"
  | "wait_for_expiry"
  | "resolve_hold"
  | "resolve_shared_references"
  | "resolve_canonical_layout_policy"
  | "split_target_batch"
  | "request_owner_purge_gate"
  | "await_fenced_worker"
  | "resume_fenced_purge"
  | "record_claim_hold"
  | "record_partial_hold"
  | "reject_unfenced_worker"
  | "reject_stale_worker"
  | "keep_tombstone_closed";

export interface R1RetentionGraceEvent {
  readonly source: "server_retention_ledger";
  readonly eventId: string;
  readonly eventSequence: number;
  readonly scopeRevision: number;
  readonly kind: "retention_grace_started";
  readonly effectiveAt: string;
  readonly reason: string;
  readonly policyVersion: typeof R1_RETENTION_POLICY_VERSION;
}

export interface R1RetentionDryRunInput {
  readonly now: string;
  readonly activeEntitlement: boolean;
  readonly graceEvent: R1RetentionGraceEvent | null;
  readonly hold: boolean;
  readonly liveReferenceCount: number;
  readonly scopeKind: "external_attachment" | "canonical_layout";
  readonly targetCount: number;
  readonly completedTargetCount: number;
  readonly phase: R1RetentionPhase;
  readonly claimFence: string | null;
  readonly workerFence: string | null;
}

export interface R1RetentionDryRunPlan {
  readonly decision: R1RetentionDecision;
  readonly nextAction: R1RetentionNextAction;
  readonly access: {
    readonly read: boolean;
    readonly write: boolean;
  };
  readonly grace: {
    readonly startedAt: string | null;
    readonly scheduledDeletionAt: string | null;
    readonly remainingMs: number | null;
    readonly cancelEventRequired: boolean;
    readonly sourceEventId: string | null;
    readonly sourceEventSequence: number | null;
    readonly sourceScopeRevision: number | null;
  };
  readonly purge: {
    readonly phase: R1RetentionPhase;
    readonly claimFence: string | null;
    readonly targetCount: number;
    readonly completedTargetCount: number;
    readonly remainingTargetCount: number;
    readonly destructiveActionAuthorized: false;
  };
  readonly backup: {
    readonly policyStatus: "separate_policy_required";
    readonly deletionConfirmed: false;
    readonly restoreMustReapplyTombstone: true;
  };
  readonly observability: {
    readonly event: "retention_dry_run";
    readonly policyVersion: typeof R1_RETENTION_POLICY_VERSION;
    readonly evaluatedAt: string;
    readonly decision: R1RetentionDecision;
    readonly phase: R1RetentionPhase;
    readonly liveReferenceCount: number;
    readonly targetCount: number;
    readonly completedTargetCount: number;
  };
}

function parseUtcTimestamp(value: string, field: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error(`r1_retention_${field}_must_be_utc`);
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`r1_retention_${field}_invalid`);
  }

  return parsed;
}

function assertSafeCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`r1_retention_${field}_invalid`);
  }
}

function validateInput(input: R1RetentionDryRunInput): {
  readonly nowMs: number;
  readonly graceStartedAtMs: number | null;
} {
  const nowMs = parseUtcTimestamp(input.now, "now");
  if (typeof input.activeEntitlement !== "boolean" || typeof input.hold !== "boolean") {
    throw new Error("r1_retention_boolean_input_invalid");
  }

  if (!(["idle", "claimed", "purging", "partial", "tombstoned"] as const).includes(input.phase)) {
    throw new Error("r1_retention_phase_invalid");
  }

  if (!(["external_attachment", "canonical_layout"] as const).includes(input.scopeKind)) {
    throw new Error("r1_retention_scope_kind_invalid");
  }

  if (input.graceEvent !== null
    && (input.graceEvent.source !== "server_retention_ledger"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.graceEvent.eventId)
      || !Number.isSafeInteger(input.graceEvent.eventSequence)
      || input.graceEvent.eventSequence < 1
      || !Number.isSafeInteger(input.graceEvent.scopeRevision)
      || input.graceEvent.scopeRevision < 0
      || input.graceEvent.kind !== "retention_grace_started"
      || input.graceEvent.policyVersion !== R1_RETENTION_POLICY_VERSION
      || !input.graceEvent.reason?.trim()
      || input.graceEvent.reason.length > 200)) {
    throw new Error("r1_retention_grace_event_invalid");
  }

  const graceStartedAtMs = input.graceEvent === null
    ? null
    : parseUtcTimestamp(input.graceEvent.effectiveAt, "grace_started_at");

  assertSafeCount(input.liveReferenceCount, "live_reference_count");
  assertSafeCount(input.targetCount, "target_count");
  assertSafeCount(input.completedTargetCount, "completed_target_count");

  if (input.completedTargetCount > input.targetCount) {
    throw new Error("r1_retention_completed_target_count_invalid");
  }

  if (graceStartedAtMs !== null && graceStartedAtMs > nowMs) {
    throw new Error("r1_retention_grace_event_in_future");
  }

  const hasClaim = input.phase !== "idle";
  if (hasClaim !== Boolean(input.claimFence?.trim())) {
    throw new Error("r1_retention_claim_fence_invalid");
  }

  if (input.phase === "idle" && input.completedTargetCount !== 0) {
    throw new Error("r1_retention_idle_progress_invalid");
  }

  if (hasClaim && input.targetCount === 0) {
    throw new Error("r1_retention_empty_claim_invalid");
  }

  if (hasClaim && graceStartedAtMs === null) {
    throw new Error("r1_retention_claim_without_grace_event");
  }

  if (hasClaim && graceStartedAtMs !== null
    && nowMs < graceStartedAtMs + R1_RETENTION_GRACE_DAYS * DAY_MS) {
    throw new Error("r1_retention_claim_before_expiry");
  }

  if (hasClaim && input.scopeKind === "canonical_layout") {
    throw new Error("r1_retention_canonical_layout_claim_invalid");
  }

  if (input.phase === "idle" && input.workerFence !== null) {
    throw new Error("r1_retention_worker_fence_without_claim");
  }

  if (input.workerFence !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(input.workerFence)) {
    throw new Error("r1_retention_worker_fence_invalid");
  }

  if (input.claimFence !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(input.claimFence)) {
    throw new Error("r1_retention_claim_fence_invalid");
  }

  if (input.phase === "claimed" && input.completedTargetCount !== 0) {
    throw new Error("r1_retention_claimed_progress_invalid");
  }

  if (input.phase === "partial"
    && (input.completedTargetCount === 0 || input.completedTargetCount >= input.targetCount)) {
    throw new Error("r1_retention_partial_progress_invalid");
  }

  if (input.phase === "tombstoned" && input.completedTargetCount !== input.targetCount) {
    throw new Error("r1_retention_tombstone_progress_invalid");
  }

  if (input.phase === "purging" && input.completedTargetCount >= input.targetCount) {
    throw new Error("r1_retention_purging_progress_invalid");
  }

  return { nowMs, graceStartedAtMs };
}

function buildPlan(
  input: R1RetentionDryRunInput,
  decision: R1RetentionDecision,
  nextAction: R1RetentionNextAction,
  access: R1RetentionDryRunPlan["access"],
  graceStartedAtMs: number | null,
  nowMs: number,
  cancelEventRequired = false,
): R1RetentionDryRunPlan {
  const scheduledDeletionAtMs = graceStartedAtMs === null
    ? null
    : graceStartedAtMs + R1_RETENTION_GRACE_DAYS * DAY_MS;

  return {
    decision,
    nextAction,
    access,
    grace: {
      startedAt: input.graceEvent?.effectiveAt ?? null,
      scheduledDeletionAt: scheduledDeletionAtMs === null
        ? null
        : new Date(scheduledDeletionAtMs).toISOString(),
      remainingMs: scheduledDeletionAtMs === null
        ? null
        : Math.max(0, scheduledDeletionAtMs - nowMs),
      cancelEventRequired,
      sourceEventId: input.graceEvent?.eventId ?? null,
      sourceEventSequence: input.graceEvent?.eventSequence ?? null,
      sourceScopeRevision: input.graceEvent?.scopeRevision ?? null,
    },
    purge: {
      phase: input.phase,
      claimFence: input.claimFence,
      targetCount: input.targetCount,
      completedTargetCount: input.completedTargetCount,
      remainingTargetCount: input.targetCount - input.completedTargetCount,
      destructiveActionAuthorized: false,
    },
    backup: {
      policyStatus: "separate_policy_required",
      deletionConfirmed: false,
      restoreMustReapplyTombstone: true,
    },
    observability: {
      event: "retention_dry_run",
      policyVersion: R1_RETENTION_POLICY_VERSION,
      evaluatedAt: new Date(nowMs).toISOString(),
      decision,
      phase: input.phase,
      liveReferenceCount: input.liveReferenceCount,
      targetCount: input.targetCount,
      completedTargetCount: input.completedTargetCount,
    },
  };
}

export function planR1Retention(input: R1RetentionDryRunInput): R1RetentionDryRunPlan {
  const { nowMs, graceStartedAtMs } = validateInput(input);
  const noAccess = { read: false, write: false } as const;

  if (input.phase !== "idle") {
    if (input.phase === "tombstoned") {
      return buildPlan(input, "tombstoned", "keep_tombstone_closed", noAccess, graceStartedAtMs, nowMs);
    }

    if (input.liveReferenceCount > 0) {
      return buildPlan(input, "shared_reference", "resolve_shared_references", noAccess, graceStartedAtMs, nowMs);
    }

    if (input.targetCount > R1_RETENTION_MAX_DRY_RUN_TARGETS) {
      return buildPlan(input, "target_limit_exceeded", "split_target_batch", noAccess, graceStartedAtMs, nowMs);
    }

    if (input.hold) {
      return input.completedTargetCount === 0
        ? buildPlan(input, "hold", "record_claim_hold", noAccess, graceStartedAtMs, nowMs)
        : buildPlan(input, "partial_purge_hold", "record_partial_hold", noAccess, graceStartedAtMs, nowMs);
    }

    if (input.phase === "claimed") {
      return buildPlan(input, "purge_claimed", "await_fenced_worker", noAccess, graceStartedAtMs, nowMs);
    }

    if (input.workerFence === null) {
      return buildPlan(input, "worker_fence_required", "reject_unfenced_worker", noAccess, graceStartedAtMs, nowMs);
    }

    if (input.workerFence !== input.claimFence) {
      return buildPlan(input, "stale_worker_fence", "reject_stale_worker", noAccess, graceStartedAtMs, nowMs);
    }

    return buildPlan(input, "purge_in_progress", "resume_fenced_purge", noAccess, graceStartedAtMs, nowMs);
  }

  if (input.activeEntitlement) {
    return buildPlan(
      input,
      "active_entitlement",
      graceStartedAtMs === null ? "none" : "record_grace_cancel",
      { read: true, write: true },
      graceStartedAtMs,
      nowMs,
      graceStartedAtMs !== null,
    );
  }

  if (input.hold) {
    return buildPlan(input, "hold", "resolve_hold", noAccess, graceStartedAtMs, nowMs);
  }

  if (input.liveReferenceCount > 0) {
    return buildPlan(input, "shared_reference", "resolve_shared_references", noAccess, graceStartedAtMs, nowMs);
  }

  if (input.scopeKind === "canonical_layout") {
    return buildPlan(
      input,
      "canonical_layout_policy_hold",
      "resolve_canonical_layout_policy",
      noAccess,
      graceStartedAtMs,
      nowMs,
    );
  }

  if (input.targetCount > R1_RETENTION_MAX_DRY_RUN_TARGETS) {
    return buildPlan(input, "target_limit_exceeded", "split_target_batch", noAccess, graceStartedAtMs, nowMs);
  }

  if (input.targetCount === 0) {
    return buildPlan(input, "nothing_to_purge", "none", noAccess, graceStartedAtMs, nowMs);
  }

  if (graceStartedAtMs === null) {
    return buildPlan(input, "awaiting_grace_start", "record_grace_start", noAccess, null, nowMs);
  }

  const scheduledDeletionAtMs = graceStartedAtMs + R1_RETENTION_GRACE_DAYS * DAY_MS;
  if (nowMs < scheduledDeletionAtMs) {
    return buildPlan(input, "grace_read_only", "wait_for_expiry", { read: true, write: false }, graceStartedAtMs, nowMs);
  }

  return buildPlan(
    input,
    "eligible_for_owner_review",
    "request_owner_purge_gate",
    noAccess,
    graceStartedAtMs,
    nowMs,
  );
}
