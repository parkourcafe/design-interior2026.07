import { describe, expect, it } from "vitest";
import { buildInitialTasks } from "./build";

describe("buildInitialTasks", () => {
  it("creates core tasks and accepted-risk follow-ups", () => {
    const tasks = buildInitialTasks({
      start: new Date("2026-01-01T00:00:00Z"),
      packageChoice: "full",
      sections: [
        { id: "stages", title: "Этапы", body: "" },
        { id: "works", title: "Состав работ", body: "" },
      ],
      acceptedRisks: [{ id: "r1", impact: "impact", proposal_implication: "agree" }],
    });
    expect(tasks).toHaveLength(5);
    expect(tasks[0]).toMatchObject({ owner_role: "client", due_date: "2026-01-04", client_facing: true });
    expect(tasks[1]).toMatchObject({ proposal_section: "works" });
    expect(tasks.at(-1)).toMatchObject({ created_from: "accepted_risk", related_scope_item: "r1" });
  });
});
