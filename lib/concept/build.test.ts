import { describe, expect, it } from "vitest";
import type { Passport } from "@/lib/types";
import { buildConceptPackFromPassport } from "@/lib/concept/build";
import { conceptPackSchema } from "@/lib/concept/schema";

function passport(overrides: Partial<Passport> = {}): Passport {
  return {
    object: { type: "flat", area_m2: 78, city: "Москва", replanning: "maybe" },
    asset_horizon: "self_long",
    household: {
      now: "2 взрослых и ребёнок",
      in_5y: "2 взрослых и двое детей",
      kids: true,
      pets: false,
    },
    lifestyle: {
      morning_load: "high",
      bathrooms: 1,
      cooking: "heavy",
      storage_pressure: "high",
    },
    budget: { range: [4_000_000, 6_000_000], risk_level: "mid" },
    timeline: { target: "6–12 месяцев", urgency: "normal" },
    style: {
      refs: ["https://example.test/reference"],
      anti: ["глянцевые поверхности"],
      notes: "",
      directions: ["japandi", "minimal"],
      palette: "warm",
    },
    rooms: {
      kitchen: { layout: "island", dining: "4" },
      bath: { count: "two", sinks: "two", shower: "both" },
      bedrooms: "2",
      living: "kitchen_living_dining",
      hallway: ["wardrobe", "seat"],
      zones: ["kids", "office", "walkin"],
    },
    pain_points: "не хватает хранения и рабочего света",
    scope: { package: "full" },
    ...overrides,
  };
}

describe("buildConceptPackFromPassport", () => {
  it("builds every MVP output from passport, scope, answers and accepted risks", () => {
    const pack = buildConceptPackFromPassport({
      passport: passport(),
      answers: { cooking_people: 4, style_direction: ["japandi", "minimal"] },
      acceptedRisks: [
        {
          risk_type: "function",
          impact: "Утренние очереди сохранятся при одном санузле.",
          designer_action: "Проверить возможность второго санузла.",
          proposal_implication: "Включить вариант планировки с двумя санузлами.",
        },
      ],
      proposalSections: [{ id: "works", title: "Состав работ", body: "Полный дизайн-проект" }],
    });

    expect(conceptPackSchema.safeParse(pack).success).toBe(true);
    expect(pack.status).toBe("ready");
    expect(pack.source).toEqual({
      package: "full",
      answer_count: 2,
      accepted_risk_count: 1,
      proposal_present: true,
    });
    expect(pack.style_direction.title).toContain("джапанди");
    expect(pack.palette_direction.base).toContain("песочный");
    expect(pack.moodboard_outline.frames).toHaveLength(5);
    expect(pack.room_directions.map((room) => room.zone)).toEqual(
      expect.arrayContaining(["Кухня-гостиная", "Кухня и обеденная зона", "Детская", "Кабинет / рабочее место"]),
    );
    expect(pack.room_directions.find((room) => room.id === "kitchen")?.priorities.join(" ")).toContain("4 чел");
    expect(pack.designer_notes.join(" ")).toContain("Проверить возможность второго санузла");
    expect(pack.client_ready_summary).not.toContain("второго санузла");
    expect(pack.client_ready_summary).toContain("тёплый минимализм");
    expect(pack.concept_sections.some((section) => section.kind === "client_summary")).toBe(true);
  });

  it("uses a safe deterministic fallback for a sparse legacy passport", () => {
    const sparse = passport({
      object: { type: null, area_m2: null, city: "Секретный город" },
      asset_horizon: "unknown",
      household: { now: "не указано", in_5y: "не указано", kids: false, pets: false },
      lifestyle: {
        morning_load: "low",
        bathrooms: null,
        cooking: "none",
        storage_pressure: "low",
      },
      budget: { range: "undisclosed", risk_level: "mid" },
      style: { refs: [], anti: [], notes: "" },
      rooms: undefined,
      contact: { name: "Анна", phone: "+7 999 123-45-67", email: "anna@example.test" },
      pain_points: "",
      scope: { package: null },
    });

    const first = buildConceptPackFromPassport({ passport: sparse });
    const second = buildConceptPackFromPassport({ passport: sparse });

    expect(first).toEqual(second);
    expect(first.source.package).toBe("concept");
    expect(first.style_direction.title).toContain("Спокойный современный");
    expect(first.room_directions).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain("Секретный город");
    expect(JSON.stringify(first)).not.toContain("+7 999");
    expect(JSON.stringify(first)).not.toContain("anna@example.test");
  });

  it("lets an explicit package override a legacy passport without parsing proposal copy", () => {
    const source = passport({ scope: { package: null } });
    const before = structuredClone(source);
    const pack = buildConceptPackFromPassport({
      passport: source,
      package: "full_plus_supervision",
      proposalSections: [
        {
          id: "works",
          title: "Состав работ",
          body: "Полный дизайн-проект, рабочие чертежи и авторское сопровождение.",
        },
      ],
    });

    expect(pack.source.package).toBe("full_plus_supervision");
    expect(pack.designer_notes.join(" ")).toContain("коммерческого предложения");
    expect(pack.designer_notes.join(" ")).toContain("рабочие чертежи");
    expect(source).toEqual(before);
  });

  it("masks contact-like text and stabilizes accepted-risk order", () => {
    const source = passport({
      style: {
        refs: [],
        anti: ["писать @private_handle"],
        notes: "Связаться: anna@example.test, +7 999 123-45-67",
      },
      pain_points: "Обсудить по номеру 8 999 123 45 67",
    });
    const budgetRisk = {
      risk_type: "budget" as const,
      impact: "Бюджет требует проверки.",
      designer_action: "Сначала подтвердить бюджет.",
      proposal_implication: "Зафиксировать допустимые аналоги.",
    };
    const timelineRisk = {
      risk_type: "timeline" as const,
      impact: "Срок требует проверки.",
      designer_action: "Сначала подтвердить срок.",
      proposal_implication: "Зафиксировать календарь.",
    };

    const first = buildConceptPackFromPassport({
      passport: source,
      acceptedRisks: [timelineRisk, budgetRisk],
    });
    const second = buildConceptPackFromPassport({
      passport: source,
      acceptedRisks: [budgetRisk, timelineRisk],
    });
    const json = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(json).not.toContain("anna@example.test");
    expect(json).not.toContain("+7 999");
    expect(json).not.toContain("@private_handle");
    expect(json).toContain("[контакт скрыт]");
  });

  it("rejects unknown persisted fields through the strict schema", () => {
    const pack = buildConceptPackFromPassport({ passport: passport() });
    expect(conceptPackSchema.safeParse({ ...pack, unexpected: true }).success).toBe(false);
  });
});
