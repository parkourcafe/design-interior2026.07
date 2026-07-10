import type { ParticipantRole, ProjectTask } from "./types";

export function canSeeTask(role: ParticipantRole, participantId: string, task: ProjectTask): boolean {
  if (role === "designer") return true;
  if (role === "client") return task.client_facing;
  return task.owner_role === "executor" && task.assignee_participant_id === participantId;
}

export function canUpdateTask(role: ParticipantRole, participantId: string, task: ProjectTask): boolean {
  if (role === "designer") return true;
  return task.owner_role === role && task.assignee_participant_id === participantId;
}
