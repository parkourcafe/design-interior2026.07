import { describe, it, expect } from "vitest";
import { QUESTIONS, visibleQuestions, questionById } from "./questions";

describe("brief questions", () => {
  it("has the 10 core questions plus optional attachments", () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(ids).toContain("object");
    expect(ids).toContain("asset_horizon");
    expect(ids).toContain("budget");
    expect(ids).toContain("pain");
    // 10 содержательных + cooking_people (ветка) + attachments (опц.)
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(11);
  });

  it("every question carries a passport_field mapping", () => {
    for (const q of QUESTIONS) {
      expect(q.passport_field, `question ${q.id}`).toBeTruthy();
    }
  });

  it("hides cooking_people when the client does not cook (branching)", () => {
    const visible = visibleQuestions({ cooking: "none" });
    expect(visible.find((q) => q.id === "cooking_people")).toBeUndefined();
  });

  it("shows cooking_people when the client cooks", () => {
    const visible = visibleQuestions({ cooking: "heavy" });
    expect(visible.find((q) => q.id === "cooking_people")).toBeDefined();
  });

  it("hides cooking_people until cooking is answered", () => {
    const visible = visibleQuestions({});
    expect(visible.find((q) => q.id === "cooking_people")).toBeUndefined();
  });

  it("looks up questions by id", () => {
    expect(questionById("budget")?.type).toBe("budget");
    expect(questionById("nope")).toBeUndefined();
  });
});
