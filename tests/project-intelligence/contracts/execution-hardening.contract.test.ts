import { describe, expect, it } from "vitest";
import {
  ExecutionContractError,
  buildExecutionWbs,
  calculateSafeRubEstimate,
  canTransitionChangeOrder,
  normalizeProjectMessage,
  parseStrictChangeOrder,
  validateConstructionHandover,
  validateExactHandoffHash,
} from "@/lib/project-intelligence/modules/execution";

describe("RU execution domain hardening", () => {
  it("never creates automatic WBS dependencies across rooms or disciplines", () => {
    const wbs = buildExecutionWbs([
      { id: "a-demolition", areaId: "area-a", discipline: "general", title: "Демонтаж", sequence: 1 },
      { id: "b-demolition", areaId: "area-b", discipline: "general", title: "Демонтаж", sequence: 1 },
      { id: "a-install", areaId: "area-a", discipline: "general", title: "Монтаж", sequence: 2 },
      { id: "a-electrical", areaId: "area-a", discipline: "electrical", title: "Электрика", sequence: 1 },
    ]);
    expect(wbs.find((item) => item.id === "a-install")?.dependsOn).toEqual(["a-demolition"]);
    expect(wbs.find((item) => item.id === "b-demolition")?.dependsOn).toEqual([]);
    expect(wbs.find((item) => item.id === "a-electrical")?.dependsOn).toEqual([]);
  });

  it("allows explicit cross-area dependency without inventing one", () => {
    const wbs = buildExecutionWbs([
      { id: "plant-room-ready", areaId: "plant-room", discipline: "mep", title: "Plant room", sequence: 1 },
      {
        id: "hall-commission",
        areaId: "food-hall",
        discipline: "commissioning",
        title: "Commission",
        sequence: 1,
        explicitDependsOn: ["plant-room-ready"],
      },
    ]);
    expect(wbs.find((item) => item.id === "hall-commission")?.dependsOn).toEqual(["plant-room-ready"]);
  });

  it("rejects fractional and overflowing RUB totals", () => {
    expect(calculateSafeRubEstimate([
      { id: "line-1", quantity: 2, unitCostRub: 45_000 },
      { id: "line-2", quantity: 0.5, unitCostRub: 20_000 },
    ])).toMatchObject({ totalRub: 100_000 });
    expect(() => calculateSafeRubEstimate([
      { id: "line-fraction", quantity: 0.333, unitCostRub: 100 },
    ])).toThrowError(/safe integer/);
    expect(() => calculateSafeRubEstimate([
      { id: "line-overflow", quantity: 2, unitCostRub: Number.MAX_SAFE_INTEGER },
    ])).toThrowError(ExecutionContractError);
  });

  it("parses exact ChangeOrder schema and enforces baseline/decision binding", () => {
    const parsed = parseStrictChangeOrder({
      id: "change-order-1",
      projectId: "project-kora",
      baselineId: "baseline-v1",
      decisionRevisionId: "decision-r2",
      reason: "Заказчик подтвердил замену материала.",
      initiatedBy: "client",
      deltaCostRub: 125_000,
      deltaDays: 3,
      status: "requested",
    }, {
      projectId: "project-kora",
      publishedBaselineIds: ["baseline-v1"],
      currentDecisionRevisionIds: ["decision-r2"],
    });
    expect(parsed.status).toBe("requested");
    expect(canTransitionChangeOrder("draft", "requested")).toBe(true);
    expect(canTransitionChangeOrder("approved", "draft")).toBe(false);
    expect(() => parseStrictChangeOrder({ ...parsed, injected: true }, {
      projectId: "project-kora",
      publishedBaselineIds: ["baseline-v1"],
      currentDecisionRevisionIds: ["decision-r2"],
    })).toThrowError(/Unexpected or missing fields/);
  });

  it("normalizes messages deterministically by explicit media type", () => {
    const first = normalizeProjectMessage({
      mediaType: "text/plain",
      rawText: "  Решение\r\nподтверждено   \r\n",
    });
    const second = normalizeProjectMessage({
      mediaType: "text/plain",
      rawText: "  Решение\nподтверждено",
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      sourceKind: "plain_text",
      normalizedText: "Решение\nподтверждено",
      locator: { kind: "plain_text", startCharacter: 0 },
    });
  });

  it("requires the exact prefixed SHA-256 and warranty evidence for handover", () => {
    const hash = `sha256:${"a".repeat(64)}`;
    expect(validateExactHandoffHash(hash)).toBe(true);
    expect(validateExactHandoffHash("hash")).toBe(false);
    expect(validateConstructionHandover({
      semanticHash: hash,
      acceptedAreaIds: ["area-a"],
      acceptedPhotoAreaIds: ["area-a"],
      warrantyArchiveObjectIds: ["object-warranty-1"],
    })).toEqual([]);
    expect(validateConstructionHandover({
      semanticHash: "hash",
      acceptedAreaIds: ["area-a"],
      acceptedPhotoAreaIds: [],
      warrantyArchiveObjectIds: [],
    })).toEqual([
      "accepted_photo_required:area-a",
      "semantic_hash_invalid",
      "warranty_archive_required",
    ]);
  });
});
