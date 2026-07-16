import type {
  ApprovalPackage,
  DecisionRevision,
  PriceObservation,
  SelectionRevision,
} from "./contracts";

export interface ProjectBrainActorContext {
  readonly actorId: string;
  readonly actorType: "human" | "system";
  readonly organizationId: string;
  readonly projectId: string;
  readonly packageId: string | null;
  readonly capabilities: readonly string[];
  readonly requestId: string;
  readonly serverTime: string;
}

export type ProjectBrainHumanActorContext = ProjectBrainActorContext & {
  readonly actorType: "human";
};

export type ProjectBrainMutationCode =
  | "stale_state"
  | "idempotency_conflict"
  | "forbidden"
  | "validation_failed"
  | "scope_conflict"
  | "not_found";

export type ProjectBrainMutationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly idempotentReplay: boolean;
    }
  | {
      readonly ok: false;
      readonly code: ProjectBrainMutationCode;
    };

export interface DecisionSelectionPersistencePort {
  appendDecisionRevision(input: {
    readonly context: ProjectBrainActorContext;
    readonly revision: DecisionRevision;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<DecisionRevision>>;

  appendSelectionRevision(input: {
    readonly context: ProjectBrainActorContext;
    readonly revision: SelectionRevision;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<SelectionRevision>>;

  appendPriceObservation(input: {
    readonly context: ProjectBrainActorContext;
    readonly observation: PriceObservation;
    readonly expectedSelectionRevisionId: string;
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<PriceObservation>>;

  transitionApprovalPackage(input: {
    readonly context: ProjectBrainHumanActorContext;
    readonly approvalPackage: ApprovalPackage;
    readonly expectedStatus: ApprovalPackage["status"];
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<ApprovalPackage>>;
}
