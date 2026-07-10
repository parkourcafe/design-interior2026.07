export type ParticipantRole = "designer" | "client" | "executor";
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "waiting_client"
  | "waiting_executor"
  | "done";

export interface ProjectTask {
  id: string;
  title: string;
  description: string;
  owner_role: ParticipantRole;
  assignee_participant_id: string | null;
  due_date: string | null;
  status: TaskStatus;
  client_facing: boolean;
  related_scope_item: string | null;
  proposal_section: string | null;
  created_from: "proposal" | "accepted_risk" | "system" | "manual";
  sort_order: number;
}

export interface TaskSeed extends Omit<ProjectTask, "id" | "assignee_participant_id" | "status"> {
  status?: TaskStatus;
}
