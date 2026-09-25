import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baselineHandoffRefs } from "../../lib/project-intelligence/delivery/projectceo/handoff-refs";

// DEC-040 (4): baseline и выпуск M3 требуют опубликованную передачу M2→M3 по
// каждому пакету (миграция 20260925100000, DB4 81).

const handoff = (id: string, packageId: string, revisionNo: number, createdAt: string) => ({
  id, packageId, revisionId: `${id}@${revisionNo}`, revisionNo, createdAt,
});

describe("baselineHandoffRefs", () => {
  it("picks the latest revision of the newest handoff per package", () => {
    const result = baselineHandoffRefs(["p1", "p2"], [
      handoff("h-a", "p1", 1, "2026-09-25T10:00:00Z"),
      handoff("h-a", "p1", 2, "2026-09-25T11:00:00Z"),
      handoff("h-b", "p2", 1, "2026-09-25T09:00:00Z"),
      handoff("h-c", "p2", 1, "2026-09-25T12:00:00Z"),
    ]);
    expect(result).toEqual({
      ok: true,
      refs: [
        { packageId: "p1", handoffId: "h-a", handoffRevisionId: "h-a@2" },
        { packageId: "p2", handoffId: "h-c", handoffRevisionId: "h-c@1" },
      ],
    });
  });

  it("refuses when any baseline package has no published handoff", () => {
    expect(baselineHandoffRefs(["p1", "p2"], [handoff("h-a", "p1", 1, "2026-09-25T10:00:00Z")]))
      .toEqual({ ok: false, missingPackageIds: ["p2"] });
    expect(baselineHandoffRefs(["p1"], [])).toEqual({ ok: false, missingPackageIds: ["p1"] });
  });
});

describe("chains that publish a baseline seed the handoff first", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("AP5 Kora chain seeds before every baseline publication", () => {
    const spec = read("tests/ap5/02-kora-chain.spec.ts");
    const baselines = [...spec.matchAll(/command\(architect, "publish_baseline"/g)].map((m) => m.index!);
    const seeds = [...spec.matchAll(/seedM3HandoffsForBaseline\(/g)].map((m) => m.index!);
    // Первая публикация и её «устаревший повтор» делят один засев.
    expect(seeds.length).toBe(3);
    for (const position of baselines) {
      expect(seeds.some((seed) => seed < position), `baseline at ${position}`).toBe(true);
    }
  });

  it("run-five-sessions seeds before both baseline publications", () => {
    const script = read("tests/ap1/e2e/run-five-sessions.zsh");
    const first = script.indexOf('seed_m3_handoffs "${decision_revision_id}"');
    const second = script.indexOf('seed_m3_handoffs "${change_decision_revision_id}"');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(first).toBeLessThan(script.indexOf("architect-workspace-m2.json"));
    expect(second).toBeLessThan(script.indexOf("architect-workspace-change-baseline.json"));
  });
});
