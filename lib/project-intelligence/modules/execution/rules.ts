import { compareCodePoints } from "../../ordering";
import type { BaselineRevisionDiff, ProjectBaseline } from "../package";
import {
  CHANGE_ORDER_INITIATORS,
  CHANGE_ORDER_STATUSES,
  type ChangeOrderStatus,
  type ExecutionChangeSet,
  type ExecutionEstimate,
  type ExecutionImpact,
  type ExecutionImpactDisposition,
  type ExecutionWorkInput,
  type ExecutionWbsItem,
  type NormalizedMessage,
  type ProjectChangeRequest,
  type RevisionDependency,
  type StrictChangeOrder,
} from "./contracts";

export class ExecutionContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionContractError";
  }
}

const PREFIXED_HASH = /^sha256:[a-f0-9]{64}$/;

function immutable<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(cloned);
  return cloned;
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

export function buildExecutionWbs(items: readonly ExecutionWorkInput[]): ExecutionWbsItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (byId.size !== items.length) {
    throw new ExecutionContractError("DUPLICATE_WBS_ID", "WBS item IDs must be unique.");
  }
  for (const item of items) {
    if (
      !item.id.trim()
      || !item.areaId.trim()
      || !item.discipline.trim()
      || !item.title.trim()
      || !Number.isSafeInteger(item.sequence)
      || item.sequence < 1
    ) {
      throw new ExecutionContractError("WBS_ITEM_INVALID", item.id);
    }
    for (const dependencyId of item.explicitDependsOn ?? []) {
      if (!byId.has(dependencyId) || dependencyId === item.id) {
        throw new ExecutionContractError("WBS_DEPENDENCY_INVALID", `${item.id}:${dependencyId}`);
      }
    }
  }

  const groups = new Map<string, ExecutionWorkInput[]>();
  for (const item of items) {
    const groupKey = `${item.areaId}\u0000${item.discipline}`;
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }
  const automaticPrevious = new Map<string, string | null>();
  for (const group of groups.values()) {
    group.sort((left, right) => (
      left.sequence - right.sequence || compareCodePoints(left.id, right.id)
    ));
    group.forEach((item, index) => automaticPrevious.set(item.id, index ? group[index - 1]!.id : null));
  }

  return immutable(
    [...items]
      .sort((left, right) => compareCodePoints(left.id, right.id))
      .map((item) => ({
        ...item,
        dependsOn: [...new Set([
          ...(automaticPrevious.get(item.id) ? [automaticPrevious.get(item.id)!] : []),
          ...(item.explicitDependsOn ?? []),
        ])].sort(compareCodePoints),
      })),
  );
}

export function calculateSafeRubEstimate(
  lines: readonly { readonly id: string; readonly quantity: number; readonly unitCostRub: number }[],
): ExecutionEstimate {
  const output: ExecutionEstimate["lines"][number][] = [];
  let totalRub = 0;
  for (const line of lines) {
    if (
      !line.id.trim()
      || !Number.isFinite(line.quantity)
      || line.quantity <= 0
      || !Number.isSafeInteger(line.unitCostRub)
      || line.unitCostRub < 0
    ) {
      throw new ExecutionContractError("ESTIMATE_LINE_INVALID", line.id);
    }
    const amountRub = line.quantity * line.unitCostRub;
    if (!Number.isSafeInteger(amountRub)) {
      throw new ExecutionContractError(
        "ESTIMATE_AMOUNT_NOT_SAFE_INTEGER_RUB",
        `${line.id}: amount must be a safe integer in RUB.`,
      );
    }
    totalRub += amountRub;
    if (!Number.isSafeInteger(totalRub)) {
      throw new ExecutionContractError("ESTIMATE_TOTAL_OVERFLOW", "Estimate total exceeds safe integer.");
    }
    output.push({ ...line, amountRub });
  }
  return immutable({ lines: output, totalRub });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCodePoints);
  const expected = [...keys].sort(compareCodePoints);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parseStrictChangeOrder(
  value: unknown,
  context: {
    readonly projectId: string;
    readonly publishedBaselineIds: readonly string[];
    readonly currentDecisionRevisionIds: readonly string[];
  },
): StrictChangeOrder {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExecutionContractError("CHANGE_ORDER_SCHEMA_INVALID", "Change order must be an object.");
  }
  const input = value as Record<string, unknown>;
  const keys = [
    "id",
    "projectId",
    "baselineId",
    "decisionRevisionId",
    "reason",
    "initiatedBy",
    "deltaCostRub",
    "deltaDays",
    "status",
  ] as const;
  if (!exactKeys(input, keys)) {
    throw new ExecutionContractError("CHANGE_ORDER_SCHEMA_INVALID", "Unexpected or missing fields.");
  }
  if (
    typeof input.id !== "string"
    || typeof input.projectId !== "string"
    || typeof input.baselineId !== "string"
    || typeof input.decisionRevisionId !== "string"
    || typeof input.reason !== "string"
    || typeof input.initiatedBy !== "string"
    || typeof input.status !== "string"
    || typeof input.deltaCostRub !== "number"
    || typeof input.deltaDays !== "number"
    || !input.id.trim()
    || !input.reason.trim()
    || input.projectId !== context.projectId
    || !context.publishedBaselineIds.includes(input.baselineId)
    || !context.currentDecisionRevisionIds.includes(input.decisionRevisionId)
    || !(CHANGE_ORDER_INITIATORS as readonly string[]).includes(input.initiatedBy)
    || !(CHANGE_ORDER_STATUSES as readonly string[]).includes(input.status)
    || !Number.isSafeInteger(input.deltaCostRub)
    || !Number.isSafeInteger(input.deltaDays)
  ) {
    throw new ExecutionContractError("CHANGE_ORDER_CONTRACT_INVALID", "Invalid change order values or scope.");
  }
  return immutable(input as unknown as StrictChangeOrder);
}

export function canTransitionChangeOrder(from: ChangeOrderStatus, to: ChangeOrderStatus): boolean {
  const allowed: Record<ChangeOrderStatus, readonly ChangeOrderStatus[]> = {
    draft: ["requested", "cancelled"],
    requested: ["approved", "rejected", "cancelled"],
    approved: [],
    rejected: [],
    cancelled: [],
  };
  return allowed[from].includes(to);
}

function normalizeText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

export function normalizeProjectMessage(input: {
  readonly mediaType: string;
  readonly rawText: string;
  readonly messageId?: string;
  readonly startMs?: number;
  readonly endMs?: number;
}): NormalizedMessage {
  const normalizedText = normalizeText(input.rawText);
  if (!normalizedText) {
    throw new ExecutionContractError("MESSAGE_TEXT_REQUIRED", "Message text is empty.");
  }
  if (input.mediaType === "message/rfc822") {
    if (!input.messageId?.trim()) {
      throw new ExecutionContractError("EMAIL_MESSAGE_ID_REQUIRED", "Email normalization requires a message ID.");
    }
    return immutable({
      sourceKind: "email",
      parserVersion: "project-ceo-message-normalizer/0.1",
      normalizedText,
      locator: { kind: "email", messageId: input.messageId },
    });
  }
  if (input.mediaType === "application/vnd.projectceo.transcript+json") {
    if (
      !Number.isSafeInteger(input.startMs)
      || !Number.isSafeInteger(input.endMs)
      || input.startMs! < 0
      || input.endMs! <= input.startMs!
    ) {
      throw new ExecutionContractError("TRANSCRIPT_RANGE_INVALID", "Transcript range is invalid.");
    }
    return immutable({
      sourceKind: "transcript",
      parserVersion: "project-ceo-message-normalizer/0.1",
      normalizedText,
      locator: {
        kind: "transcript",
        startMs: input.startMs,
        endMs: input.endMs,
      },
    });
  }
  if (input.mediaType === "text/plain") {
    return immutable({
      sourceKind: "plain_text",
      parserVersion: "project-ceo-message-normalizer/0.1",
      normalizedText,
      locator: {
        kind: "plain_text",
        startCharacter: 0,
        endCharacter: normalizedText.length,
      },
    });
  }
  throw new ExecutionContractError("MESSAGE_MEDIA_TYPE_UNSUPPORTED", input.mediaType);
}

export function validateExactHandoffHash(value: string): value is `sha256:${string}` {
  return PREFIXED_HASH.test(value);
}

export function validateConstructionHandover(input: {
  readonly semanticHash: string;
  readonly acceptedAreaIds: readonly string[];
  readonly acceptedPhotoAreaIds: readonly string[];
  readonly warrantyArchiveObjectIds: readonly string[];
}): readonly string[] {
  const errors: string[] = [];
  if (!validateExactHandoffHash(input.semanticHash)) errors.push("semantic_hash_invalid");
  const photos = new Set(input.acceptedPhotoAreaIds);
  if (input.acceptedAreaIds.length === 0) errors.push("accepted_area_required");
  for (const areaId of input.acceptedAreaIds) {
    if (!photos.has(areaId)) errors.push(`accepted_photo_required:${areaId}`);
  }
  if (input.warrantyArchiveObjectIds.length === 0) errors.push("warranty_archive_required");
  return errors.sort(compareCodePoints);
}

export function createProjectChangeRequest(
  input: ProjectChangeRequest,
  fromBaseline: ProjectBaseline,
  proposedBaseline: ProjectBaseline,
): ProjectChangeRequest {
  if (
    input.status !== "submitted"
    || input.projectId !== fromBaseline.projectId
    || input.projectId !== proposedBaseline.projectId
    || input.fromBaselineId !== fromBaseline.id
    || input.proposedBaselineId !== proposedBaseline.id
    || proposedBaseline.previousBaselineId !== fromBaseline.id
    || input.requestedBy.actorType !== "human"
    || !input.requestedBy.actorId.trim()
    || !validTime(input.requestedAt)
    || !input.reason.trim()
    || !Number.isSafeInteger(input.deltaCostRub)
    || !Number.isSafeInteger(input.deltaDays)
  ) {
    throw new ExecutionContractError("CHANGE_REQUEST_INVALID", "Change request is not bound to exact baselines.");
  }
  return immutable(input);
}

export function deriveExecutionChangeSet(input: {
  readonly id: string;
  readonly request: ProjectChangeRequest;
  readonly diff: BaselineRevisionDiff;
  readonly dependencies: readonly RevisionDependency[];
  readonly maxDepth: number;
}): ExecutionChangeSet {
  if (!input.diff.changed || input.diff.impactRootRevisionIds.length === 0) {
    throw new ExecutionContractError("NO_CHANGE_ROOTS", "Changed decision or selection roots are required.");
  }
  if (!Number.isSafeInteger(input.maxDepth) || input.maxDepth < 1 || input.maxDepth > 20) {
    throw new ExecutionContractError("IMPACT_DEPTH_INVALID", "Impact depth must be between 1 and 20.");
  }
  const roots = [...input.diff.impactRootRevisionIds].sort(compareCodePoints);
  const reverse = new Map<string, string[]>();
  for (const dependency of input.dependencies) {
    const list = reverse.get(dependency.fromRevisionId) ?? [];
    list.push(dependency.toRevisionId);
    reverse.set(dependency.fromRevisionId, list);
  }
  for (const values of reverse.values()) values.sort(compareCodePoints);

  const impacts: ExecutionImpact[] = [];
  for (const root of roots) {
    const queue: Array<{ id: string; path: string[] }> = [{ id: root, path: [root] }];
    const best = new Map<string, number>([[root, 0]]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const distance = current.path.length - 1;
      if (distance >= input.maxDepth) continue;
      for (const next of reverse.get(current.id) ?? []) {
        const nextDistance = distance + 1;
        if ((best.get(next) ?? Number.POSITIVE_INFINITY) <= nextDistance) continue;
        best.set(next, nextDistance);
        const path = [...current.path, next];
        impacts.push({
          rootRevisionId: root,
          impactedRevisionId: next,
          distance: nextDistance,
          path,
        });
        queue.push({ id: next, path });
      }
    }
  }
  impacts.sort((left, right) => (
    compareCodePoints(left.rootRevisionId, right.rootRevisionId)
    || left.distance - right.distance
    || compareCodePoints(left.impactedRevisionId, right.impactedRevisionId)
  ));
  return immutable({
    id: input.id,
    projectId: input.request.projectId,
    fromBaselineId: input.request.fromBaselineId,
    toBaselineId: input.request.proposedBaselineId,
    changeRequestId: input.request.id,
    impactRootRevisionIds: roots,
    impacts,
    dispositions: [],
    status: "impact_review",
  });
}

export function applyExecutionImpactDispositions(
  changeSet: ExecutionChangeSet,
  dispositions: readonly ExecutionImpactDisposition[],
): ExecutionChangeSet {
  const required = new Set(changeSet.impacts.map((impact) => (
    `${impact.rootRevisionId}->${impact.impactedRevisionId}`
  )));
  const seen = new Set<string>();
  for (const disposition of dispositions) {
    if (
      !required.has(disposition.impactKey)
      || seen.has(disposition.impactKey)
      || disposition.actor.actorType !== "human"
      || !disposition.actor.actorId.trim()
      || !validTime(disposition.reviewedAt)
      || !disposition.reason.trim()
    ) {
      throw new ExecutionContractError("IMPACT_DISPOSITION_INVALID", disposition.impactKey);
    }
    seen.add(disposition.impactKey);
  }
  if (seen.size !== required.size) {
    throw new ExecutionContractError("IMPACT_REVIEW_INCOMPLETE", "Every deterministic impact needs disposition.");
  }
  return immutable({ ...changeSet, dispositions: [...dispositions] });
}
