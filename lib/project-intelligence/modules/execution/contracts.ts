import type { HumanActorRef } from "../decisions";

export interface ExecutionWorkInput {
  readonly id: string;
  readonly areaId: string;
  readonly discipline: string;
  readonly title: string;
  readonly sequence: number;
  readonly explicitDependsOn?: readonly string[];
}

export interface ExecutionWbsItem extends ExecutionWorkInput {
  readonly dependsOn: readonly string[];
}

export interface ExecutionEstimateLine {
  readonly id: string;
  readonly quantity: number;
  readonly unitCostRub: number;
}

export interface ExecutionEstimate {
  readonly lines: readonly {
    readonly id: string;
    readonly quantity: number;
    readonly unitCostRub: number;
    readonly amountRub: number;
  }[];
  readonly totalRub: number;
}

export const CHANGE_ORDER_INITIATORS = [
  "client",
  "architect",
  "builder",
  "owner",
] as const;

export type ChangeOrderInitiator = (typeof CHANGE_ORDER_INITIATORS)[number];

export const CHANGE_ORDER_STATUSES = [
  "draft",
  "requested",
  "approved",
  "rejected",
  "cancelled",
] as const;

export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

export interface StrictChangeOrder {
  readonly id: string;
  readonly projectId: string;
  readonly baselineId: string;
  readonly decisionRevisionId: string;
  readonly reason: string;
  readonly initiatedBy: ChangeOrderInitiator;
  readonly deltaCostRub: number;
  readonly deltaDays: number;
  readonly status: ChangeOrderStatus;
}

export interface NormalizedMessage {
  readonly sourceKind: "email" | "transcript" | "plain_text";
  readonly parserVersion: "project-ceo-message-normalizer/0.1";
  readonly normalizedText: string;
  readonly locator: {
    readonly kind: "email" | "transcript" | "plain_text";
    readonly messageId?: string;
    readonly startCharacter?: number;
    readonly endCharacter?: number;
    readonly startMs?: number;
    readonly endMs?: number;
  };
}

export interface ProjectChangeRequest {
  readonly id: string;
  readonly projectId: string;
  readonly fromBaselineId: string;
  readonly proposedBaselineId: string;
  readonly reason: string;
  readonly requestedBy: HumanActorRef;
  readonly requestedAt: string;
  readonly deltaCostRub: number;
  readonly deltaDays: number;
  readonly status: "submitted";
}

export interface RevisionDependency {
  readonly fromRevisionId: string;
  readonly toRevisionId: string;
  readonly relation: "depends_on" | "specified_by" | "satisfies";
}

export interface ExecutionImpact {
  readonly rootRevisionId: string;
  readonly impactedRevisionId: string;
  readonly distance: number;
  readonly path: readonly string[];
}

export interface ExecutionImpactDisposition {
  readonly impactKey: string;
  readonly disposition: "accepted" | "resolved" | "dismissed";
  readonly actor: HumanActorRef;
  readonly reviewedAt: string;
  readonly reason: string;
}

export interface ExecutionChangeSet {
  readonly id: string;
  readonly projectId: string;
  readonly fromBaselineId: string;
  readonly toBaselineId: string;
  readonly changeRequestId: string;
  readonly impactRootRevisionIds: readonly string[];
  readonly impacts: readonly ExecutionImpact[];
  readonly dispositions: readonly ExecutionImpactDisposition[];
  readonly status: "impact_review";
}
