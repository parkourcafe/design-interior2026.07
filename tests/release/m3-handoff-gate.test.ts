import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baselineRoomHandoffRefs } from "../../lib/project-intelligence/delivery/projectceo/handoff-refs";

// DEC-042 (4) и DEC-041 §4: baseline и выпуск M3 требуют свежую передачу
// M2→M3 по каждой комнате с утверждённым дизайном и хотя бы одну в каждом
// пакете (миграции 20260925100000, 20260928090000; DB4 81, 83). Свежесть
// считает сервер — здесь проверяется только сборка ссылок из его ответа.

const room = (
  packageId: string, roomId: string, problem: string | null, applicable = true,
  handoff: string | null = `h-${roomId}`,
) => ({
  packageId, roomId, applicable,
  handoffId: handoff, handoffRevisionId: handoff ? `${handoff}@1` : null, problem,
});

describe("baselineRoomHandoffRefs", () => {
  it("binds every fresh room, ordered by package and room", () => {
    expect(baselineRoomHandoffRefs(["p1", "p2"], [
      room("p2", "kitchen", null),
      room("p1", "living", null),
      room("p1", "bath", null),
    ])).toEqual({
      ok: true,
      refs: [
        { packageId: "p1", roomId: "bath", handoffId: "h-bath", handoffRevisionId: "h-bath@1" },
        { packageId: "p1", roomId: "living", handoffId: "h-living", handoffRevisionId: "h-living@1" },
        { packageId: "p2", roomId: "kitchen", handoffId: "h-kitchen", handoffRevisionId: "h-kitchen@1" },
      ],
    });
  });

  it("blocks when a room with an approved design has no fresh handoff", () => {
    expect(baselineRoomHandoffRefs(["p1"], [
      room("p1", "living", null),
      room("p1", "kitchen", "M2_HANDOFF_SELECTION_SUPERSEDED"),
      room("p1", "bath", "M2_HANDOFF_MISSING", true, null),
    ])).toEqual({
      ok: false,
      missingPackageIds: [],
      blockedRooms: [
        { packageId: "p1", roomId: "kitchen", problem: "M2_HANDOFF_SELECTION_SUPERSEDED" },
        { packageId: "p1", roomId: "bath", problem: "M2_HANDOFF_MISSING" },
      ],
    });
  });

  it("skips a stale handoff of a room without an approved design", () => {
    expect(baselineRoomHandoffRefs(["p1"], [
      room("p1", "living", null),
      room("p1", "draft-room", "M2_HANDOFF_STALE", false),
    ])).toEqual({
      ok: true,
      refs: [{ packageId: "p1", roomId: "living", handoffId: "h-living", handoffRevisionId: "h-living@1" }],
    });
  });

  it("refuses when an active package has no handoff at all", () => {
    expect(baselineRoomHandoffRefs(["p1", "p2"], [room("p1", "living", null)]))
      .toEqual({ ok: false, missingPackageIds: ["p2"], blockedRooms: [] });
    expect(baselineRoomHandoffRefs(["p1"], []))
      .toEqual({ ok: false, missingPackageIds: ["p1"], blockedRooms: [] });
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
