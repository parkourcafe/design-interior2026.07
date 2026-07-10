import { describe, expect, it } from "vitest";
import { derivePlanAssistedDraft } from "./plan-assist";

describe("plan assisted brief", () => {
  it("extracts visible residential facts from plan notes", () => {
    const draft = derivePlanAssistedDraft({
      project_type: "residential",
      description:
        "Двухэтажный дом, план участка 15 x 16.6 м. Есть летняя кухня, кухня-гостиная 40 м², спальни, детские и с/у.",
      area_m2: 220,
      location: "Бали",
      plan_notes: "Слева соседи вплотную, справа поле. Дом упирается в заднюю стену участка.",
      plan_files: [{ name: "house-plan.png", type: "image/png" }],
    });

    const values = draft.facts.map((fact) => fact.value).join(" ");
    expect(draft.facts.length).toBeGreaterThan(8);
    expect(values).toContain("220 м²");
    expect(values).toContain("15 x 16.6 м");
    expect(values).toContain("2 этажа");
    expect(values).toContain("летняя кухня");
    expect(values).toContain("соседство");
  });

  it("infers commercial engineering disciplines from file names and notes", () => {
    const draft = derivePlanAssistedDraft({
      project_type: "wellness",
      description: "Массажная студия на Бали, нужно собрать вопросы по плану.",
      area_m2: 300,
      location: "Бали",
      plan_notes: "Нужно проверить вентиляцию, воду, канализацию, душевые и процедурные кабинеты.",
      plan_files: [
        { name: "Kora Food Hall - First Floor - MEP Progress 1.1.pdf", type: "application/pdf" },
        { name: "Kora Food Hall - 2nd Floor - AD02 - Signage Rev 1.pdf", type: "application/pdf" },
      ],
    });

    const values = draft.facts.map((fact) => fact.value);
    expect(values).toContain("wellness / массаж");
    expect(values).toContain("300 м²");
    expect(values).toContain("инженерные системы / MEP");
    expect(values).toContain("signage / вывески");
    expect(values).toContain("вентиляция / вытяжка");
    expect(values).toContain("вода и канализация");
  });
});
