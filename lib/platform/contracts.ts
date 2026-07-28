import { z } from "zod";

export const COST_CLASSES = ["free_deterministic", "metered_ai", "external_paid"] as const;
export type CostClass = (typeof COST_CLASSES)[number];

export const WORKFLOW_STATUSES = [
  "queued",
  "running",
  "waiting_for_human",
  "pending_cost_confirmation",
  "retrying",
  "completed",
  "failed",
  "cancelled",
  "rolled_back",
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

const workflowTransitions: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["waiting_for_human", "pending_cost_confirmation", "completed", "failed", "cancelled"],
  waiting_for_human: ["running", "cancelled"],
  pending_cost_confirmation: ["running", "cancelled"],
  retrying: ["running", "failed", "cancelled"],
  completed: [],
  failed: ["retrying", "cancelled", "rolled_back"],
  cancelled: [],
  rolled_back: [],
};

export function canTransitionWorkflow(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return workflowTransitions[from].includes(to);
}

export const FACT_STATUSES = [
  "extracted",
  "interpreted",
  "unknown",
  "human_confirmed",
  "rejected",
] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export function canCreateFactStatus(actor: "human" | "ai" | "system", status: FactStatus): boolean {
  return actor !== "ai" || status !== "human_confirmed";
}

export function nextFactVersion(current: { id: string; version: number }) {
  return { version: current.version + 1, supersedes_id: current.id };
}

export function approvalPresentation(requestedBy: string, decisionBy: string) {
  const selfApproved = requestedBy === decisionBy;
  return {
    selfApproved,
    label: selfApproved ? "Подтверждено автором действия" : "Выпуск подтверждён",
  };
}

const jsonObject = z.record(z.string(), z.unknown());

export interface ActionContract {
  key: string;
  version: number;
  allowedRoles: readonly ("owner" | "member")[];
  reads: readonly string[];
  writes: readonly string[];
  auditEvents: readonly string[];
  costClass: CostClass;
  approval: "none" | "human_review" | "release_authorized";
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}

export const M1_ACTIONS = {
  extract_client_brief: {
    key: "extract_client_brief", version: 1, allowedRoles: ["owner", "member"],
    reads: ["answers", "project_sources"], writes: ["project_facts"],
    auditEvents: ["facts_extracted"], costClass: "free_deterministic", approval: "human_review",
    inputSchema: jsonObject, outputSchema: z.array(jsonObject),
  },
  generate_clarifying_questions: {
    key: "generate_clarifying_questions", version: 1, allowedRoles: ["owner", "member"],
    reads: ["project_facts"], writes: ["project_facts"],
    auditEvents: ["clarifying_questions_generated"], costClass: "free_deterministic", approval: "human_review",
    inputSchema: z.array(jsonObject), outputSchema: z.array(jsonObject),
  },
  build_project_passport: {
    key: "build_project_passport", version: 1, allowedRoles: ["owner", "member"],
    reads: ["answers", "project_facts"], writes: ["projects.passport"],
    auditEvents: ["passport_built"], costClass: "free_deterministic", approval: "human_review",
    inputSchema: jsonObject, outputSchema: jsonObject,
  },
  generate_risk_register: {
    key: "generate_risk_register", version: 1, allowedRoles: ["owner", "member"],
    reads: ["answers", "projects.passport"], writes: ["risk_cards"],
    auditEvents: ["risk_register_generated"], costClass: "metered_ai", approval: "human_review",
    inputSchema: jsonObject, outputSchema: z.array(jsonObject),
  },
  build_scope_draft: {
    key: "build_scope_draft", version: 1, allowedRoles: ["owner", "member"],
    reads: ["projects.passport", "risk_cards"], writes: ["proposals.sections"],
    auditEvents: ["scope_draft_built"], costClass: "free_deterministic", approval: "human_review",
    inputSchema: jsonObject, outputSchema: z.array(jsonObject),
  },
  calculate_fee: {
    key: "calculate_fee", version: 1, allowedRoles: ["owner", "member"],
    reads: ["projects.passport", "designers.pricing"], writes: ["proposals.sections"],
    auditEvents: ["fee_calculated"], costClass: "free_deterministic", approval: "human_review",
    inputSchema: jsonObject, outputSchema: jsonObject,
  },
  generate_proposal_draft: {
    key: "generate_proposal_draft", version: 1, allowedRoles: ["owner", "member"],
    reads: ["projects.passport", "risk_cards", "designers"], writes: ["proposals"],
    auditEvents: ["proposal_draft_generated"], costClass: "free_deterministic", approval: "human_review",
    inputSchema: jsonObject, outputSchema: z.array(jsonObject),
  },
  issue_proposal: {
    key: "issue_proposal", version: 1, allowedRoles: ["owner", "member"],
    reads: ["proposals", "approval_requests"], writes: ["proposals.status", "projects.status"],
    auditEvents: ["proposal_issued"], costClass: "free_deterministic", approval: "release_authorized",
    inputSchema: jsonObject, outputSchema: jsonObject,
  },
} satisfies Record<string, ActionContract>;

export type M1ActionKey = keyof typeof M1_ACTIONS;
