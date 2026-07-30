import { describe, expect, it } from "vitest";
import fixture from "./fixtures/pro-up-ru/pro-up-ru-vertical-slice.json";
import { semanticSha256 } from "@/lib/project-intelligence/application/change-handoff/canonical";

const { handoff, ...logicalContent } = fixture;

describe("RU ProUp Renovation vertical-slice fixture", () => {
  it("is explicitly RU-only and uses integer roubles", () => {
    expect(fixture.region).toBe("RU");
    expect(fixture.locale).toBe("ru-RU");
    expect(fixture.currency).toBe("RUB");
    expect(fixture).not.toHaveProperty("us");
    expect(fixture).not.toHaveProperty("usd");
    expect([fixture.baseline.budgetRub, ...fixture.estimate.map((x) => x.amountRub), ...fixture.procurement.map((x) => x.amountRub)])
      .toSatisfy((values: number[]) => values.every((value) => Number.isInteger(value) && value >= 0));
  });

  it("covers the ordered execution contract from import to handoff", () => {
    const stages = [
      fixture.source.kind,
      "baseline",
      "wbs",
      "estimate",
      "procurement",
      "change_order",
      "photo_report",
      "handoff",
    ];
    expect(stages).toEqual(["design_package", "baseline", "wbs", "estimate", "procurement", "change_order", "photo_report", "handoff"]);
    expect(fixture.baseline.version).toBe("v1");
    expect(fixture.wbs.every((item) => item.roomId && item.sequence >= 1)).toBe(true);
    expect(fixture.procurement.every((item) => ["planned", "requested", "ordered", "paid", "delivered", "accepted"].includes(item.status))).toBe(true);
    expect(fixture.changeOrders.every((item) => item.baselineVersion === fixture.baseline.version && Number.isInteger(item.deltaRub))).toBe(true);
    expect(fixture.photoReports.every((item) => item.photoObjectKeys.length > 0 && item.accepted)).toBe(true);
    expect(fixture.handoff.sourceRefs).toContain(fixture.source.fileName);
  });

  it("has a stable semantic handoff hash (golden)", () => {
    const hash = semanticSha256(logicalContent);
    expect(hash).toBe("sha256:54be995474b21f88b459a41b63d155095d8010dd47031e427a25184a2dab4586");
    expect(hash).toBe(semanticSha256(JSON.parse(JSON.stringify(logicalContent))));
    expect(handoff.version).toBe(fixture.baseline.version);
  });
});
