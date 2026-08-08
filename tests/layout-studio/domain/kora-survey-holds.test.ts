import { describe, expect, it } from "vitest";

import { LayoutExportService } from "@/lib/layout-studio/application/export-service";
import { MemoryLayoutRepository } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { validateLayoutDocument, type LayoutDocument } from "@/lib/layout-studio/domain";
import koraFixture from "@/fixtures/layout-studio/kora-liquid-station.v0.1.json";

const KORA = koraFixture as unknown as LayoutDocument;

/**
 * LS-AT-002/013/014/015 are ACCEPTED_DECLARED, not verified: the owner scoped the
 * KORA fixture to preview fidelity on 2026-08-07 rather than survey fidelity. The
 * acceptance therefore rests entirely on the fixture continuing to declare what it
 * does not know, and on that declaration reaching every artifact a reader could
 * see. These tests are what makes the acceptance honest — they fail if a
 * declaration is dropped, or if an assumption is quietly promoted to a fact.
 *
 * Reopening any row means deleting its warning here and supplying the measurement.
 */
const DECLARED_LIMITS = [
  { row: "LS-AT-002", warning: "PARTIAL_OWNER_LOCK", input: "owner lock covers intent only" },
  { row: "LS-AT-013", warning: "DOOR_HEIGHT_AND_SWING_NOT_SITE_VERIFIED", input: "door height, frame and swing" },
  { row: "LS-AT-002", warning: "COLUMN_ABSOLUTE_AXIS_NOT_SITE_VERIFIED", input: "column absolute axis" },
  { row: "LS-AT-014/015", warning: "EQUIPMENT_SET_OUT_PENDING", input: "rear equipment and central sink set-out" },
] as const;

/** Owner-confirmed geometry. These are facts, not assumptions. */
const OWNER_CONFIRMED = {
  // Locked 2026-08-04.
  contourMm: { widthMm: 8100, depthMm: 3000 },
  columnSectionMm: 250,
  doorWidthMm: 1200,
  leftOpeningMm: 1500,
  counterHeightMm: 1100,
  worktopHeightMm: 900,
  // Confirmed 2026-08-07: "высота у нас ровно 3 м". Closes LS-AT-012; the value
  // was already 3000 but carried CLEAR_HEIGHT_ASSUMED_3000 until this lock.
  clearHeightMm: 3000,
};

describe("LS-AT-002/013-015: accepted-declared limits stay declared", () => {
  it("declares a warning for every input accepted without measurement", () => {
    for (const item of DECLARED_LIMITS) {
      expect(KORA.metadata.warnings, `${item.row} — ${item.input}`).toContain(item.warning);
    }
  });

  it("does not carry warnings for inputs that are not actually open", () => {
    const declared = new Set(DECLARED_LIMITS.map((item) => item.warning));
    for (const warning of KORA.metadata.warnings) {
      expect(declared, `undocumented warning ${warning}`).toContain(warning);
    }
  });

  it("keeps the owner-confirmed geometry exactly as locked", () => {
    const xs = KORA.nodes.map((node) => node.xMm);
    const ys = KORA.nodes.map((node) => node.yMm);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(OWNER_CONFIRMED.contourMm.widthMm);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(OWNER_CONFIRMED.contourMm.depthMm);

    const column = KORA.columns.at(0);
    expect(column).toBeDefined();
    expect(column?.widthMm).toBe(OWNER_CONFIRMED.columnSectionMm);
    expect(column?.depthMm).toBe(OWNER_CONFIRMED.columnSectionMm);

    const door = KORA.openings.find((opening) => opening.kind === "door");
    expect(door?.widthMm).toBe(OWNER_CONFIRMED.doorWidthMm);
    // Door centre shares the column axis.
    expect((door?.offsetMm ?? 0) + (door?.widthMm ?? 0) / 2).toBe(column?.xMm);

    const leftOpening = KORA.openings.find((opening) => opening.parentWallId.endsWith(".left"));
    expect(leftOpening?.widthMm).toBe(OWNER_CONFIRMED.leftOpeningMm);

    const counter = KORA.objects.find((object) => object.kind === "counter");
    expect(counter?.heightMm).toBe(OWNER_CONFIRMED.counterHeightMm);
    const worktop = KORA.objects.find((object) => object.kind === "service");
    expect((worktop?.zMm ?? 0)).toBe(OWNER_CONFIRMED.worktopHeightMm);
  });

  it("keeps the right wall continuous and the left side half open", () => {
    const rightWall = KORA.walls.find((wall) => wall.id.endsWith(".right"));
    expect(KORA.openings.some((opening) => opening.parentWallId === rightWall?.id)).toBe(false);

    const leftWall = KORA.walls.find((wall) => wall.id.endsWith(".left"));
    const leftOpening = KORA.openings.find((opening) => opening.parentWallId === leftWall?.id);
    // 1500 open / 1500 wall on a 3000 mm side.
    expect(leftOpening?.offsetMm).toBe(0);
    expect(leftOpening?.widthMm).toBe(1500);
  });

  it("carries the owner-confirmed clear height without an assumption warning", () => {
    expect(KORA.floor.clearHeightMm).toBe(OWNER_CONFIRMED.clearHeightMm);
    expect(KORA.columns.at(0)?.heightMm).toBe(OWNER_CONFIRMED.clearHeightMm);
    expect(KORA.metadata.warnings).not.toContain("CLEAR_HEIGHT_ASSUMED_3000");
    expect(KORA.metadata.sourceRefs).toContain("owner-lock://selena/2026-08-07-clear-height");
  });

  it("still validates against the frozen schema while holds are open", () => {
    const result = validateLayoutDocument(KORA);
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("propagates every declaration into a published version and its artifacts", async () => {
    const repository = new MemoryLayoutRepository();
    const version = await repository.publishVersion(KORA, {
      versionId: "version.kora.holds",
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Проверка предупреждений",
      createdAt: "2026-08-06T10:00:00.000Z",
      warnings: [...KORA.metadata.warnings],
    });
    const service = new LayoutExportService({
      repository,
      generatorVersion: "archidom-layout-studio/test",
      now: () => "2026-08-06T12:00:00.000Z",
    });

    for (const format of ["json", "svg", "glb", "print"] as const) {
      const exported = await service.exportVersion(version.versionId, format);
      expect(exported.manifest.warnings, `manifest for ${format}`)
        .toEqual([...KORA.metadata.warnings]);
    }

    const print = await service.exportVersion(version.versionId, "print");
    for (const item of DECLARED_LIMITS) {
      expect(print.artifact as string, `print must show ${item.warning}`).toContain(item.warning);
    }
  });
});
