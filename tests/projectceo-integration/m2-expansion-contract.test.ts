import { describe, expect, it } from "vitest";
import {
  PROJECTCEO_COMMAND_CONTRACT_VERSION,
  projectCeoCommandSchema,
} from "../../lib/project-intelligence/delivery/projectceo/command-contract";

const base = {
  contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
  commandId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
};

describe("M2 expansion command contract", () => {
  it("accepts immutable room, variant, material, budget and handoff commands", () => {
    const common = {
      packageId: "33333333-3333-4333-8333-333333333333",
      revisionId: "44444444-4444-4444-8444-444444444444",
      expectedRevisionId: null,
    };
    for (const command of [
      { ...base, kind: "create_m2_room", payload: { ...common, roomId: "room-1", name: "Кухня", areaM2: 20, reason: "create room" } },
      { ...base, kind: "create_m2_variant", payload: { ...common, variantId: "variant-1", roomId: "room-1", title: "Вариант A", description: "Описание", reason: "create variant" } },
      { ...base, kind: "create_m2_material", payload: { ...common, materialId: "material-1", variantId: "variant-1", name: "Керамогранит", supplierRef: "SKU-1", unit: "м²", unitCostRub: 1000, quantity: 20, reason: "create material" } },
      { ...base, kind: "set_m2_budget", payload: { ...common, budgetId: "budget-1", minRub: 100000, maxRub: 150000, contingencyPct: 10, reason: "set budget" } },
      { ...base, kind: "create_m2_client_handoff", payload: { ...common, handoffId: "handoff-1", approvalPackageId: "approval-1", title: "Передача", note: "После approval", reason: "handoff" } },
    ]) {
      expect(projectCeoCommandSchema.safeParse(command).success).toBe(true);
    }
  });

  it("rejects an inverted budget range", () => {
    expect(projectCeoCommandSchema.safeParse({
      ...base,
      kind: "set_m2_budget",
      payload: {
        packageId: "33333333-3333-4333-8333-333333333333",
        budgetId: "budget-1",
        revisionId: "44444444-4444-4444-8444-444444444444",
        expectedRevisionId: null,
        minRub: 200000,
        maxRub: 100000,
        contingencyPct: 10,
        reason: "invalid budget",
      },
    }).success).toBe(false);
  });
});
