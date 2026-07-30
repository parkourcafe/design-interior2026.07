import { describe, expect, it } from "vitest";
import { canSeeTask, canUpdateTask } from "./access";
import type { ProjectTask } from "./types";

const task: ProjectTask = { id: "t", title: "", description: "", owner_role: "executor", assignee_participant_id: "executor-1", due_date: null, status: "todo", client_facing: false, related_scope_item: null, proposal_section: null, created_from: "system", sort_order: 1 };
describe("project room access", () => {
  it("lets designer see all, client only client-facing, executor only assigned", () => {
    expect(canSeeTask("designer", "d", task)).toBe(true);
    expect(canSeeTask("client", "c", task)).toBe(false);
    expect(canSeeTask("executor", "executor-1", task)).toBe(true);
    expect(canSeeTask("executor", "executor-2", task)).toBe(false);
  });
  it("allows participants to update only their assigned role tasks", () => {
    expect(canUpdateTask("executor", "executor-1", task)).toBe(true);
    expect(canUpdateTask("client", "c", task)).toBe(false);
  });
});
