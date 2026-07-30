import { describe, expect, it } from "vitest";
import { buildAdminSummary } from "./summary";
import type { ProjectTask } from "./types";

const base = { id: "t", title: "Task", description: "", owner_role: "designer" as const, assignee_participant_id: null, client_facing: true, related_scope_item: null, proposal_section: null, created_from: "system" as const, sort_order: 1 };
describe("buildAdminSummary", () => {
  it("reports overdue, blocked and waiting work without changing tasks", () => {
    const tasks: ProjectTask[] = [{ ...base, due_date: "2026-01-01", status: "blocked" }, { ...base, id: "2", due_date: null, status: "waiting_client" }];
    const summary = buildAdminSummary(tasks, new Date("2026-01-10T00:00:00Z"));
    expect(summary.overdue).toHaveLength(1);
    expect(summary.blocked).toHaveLength(1);
    expect(summary.waitingClient).toHaveLength(1);
    expect(tasks[0]?.status).toBe("blocked");
  });
});
