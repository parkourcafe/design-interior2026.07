/**
 * Project Intelligence application composition boundary.
 *
 * The two tracks intentionally keep separate actor-context shapes. Namespace exports
 * preserve every track-owned public symbol without ambiguous wildcard collisions.
 */
export * as workflowApplication from "./workflow";
export * as changeHandoffApplication from "./change-handoff";

export { createWorkflowApplicationService } from "./workflow";
export {
  ChangeHandoffApplicationService,
  createDeterministicChangeHandoffIdFactory,
  createEmptyChangeHandoffState,
  canonicalJson,
  semanticSha256,
} from "./change-handoff";

export type {
  ApplicationActorContext as WorkflowActorContext,
  WorkflowApplicationService,
  WorkflowExecutionContext,
  WorkflowState,
  WorkflowStatePort,
} from "./workflow";

export type {
  ApplicationActorContext as ChangeHandoffActorContext,
  ApplicationExecutionContext as ChangeHandoffExecutionContext,
  ChangeHandoffApplicationState,
  ChangeHandoffIdFactory,
  ImpactRun,
  LogicalHandoff,
} from "./change-handoff";
