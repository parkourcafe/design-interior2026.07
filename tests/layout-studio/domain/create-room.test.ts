import { describe, expect, it } from "vitest";

import {
  createRoomDocument,
  validateRoomSpec,
  ROOM_LIMITS,
  type RoomSpec,
} from "@/lib/layout-studio/domain/create-room";
import { deriveLayout, validateLayoutDocument } from "@/lib/layout-studio/domain";

const SPEC: RoomSpec = {
  widthMm: 6000,
  depthMm: 4000,
  clearHeightMm: 2800,
  name: "Гостиная",
  projectUuid: "11111111-1111-1111-1111-111111111111",
  documentId: "layout.test.room",
};

describe("createRoomDocument: новая планировка из габаритов", () => {
  it("порождает документ, проходящий замороженную схему", () => {
    const result = validateLayoutDocument(createRoomDocument(SPEC));
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("строит замкнутый контур: четыре угла, четыре стены, каждая начинается там, где кончилась предыдущая", () => {
    const document = createRoomDocument(SPEC);
    expect(document.nodes).toHaveLength(4);
    expect(document.walls).toHaveLength(4);

    for (let index = 0; index < document.walls.length; index += 1) {
      const wall = document.walls[index]!;
      const next = document.walls[(index + 1) % document.walls.length]!;
      expect(wall.endNodeId, `стена ${wall.id} не стыкуется со следующей`).toBe(next.startNodeId);
    }
  });

  it("даёт ровно те габариты, которые запросили", () => {
    const document = createRoomDocument(SPEC);
    const xs = document.nodes.map((node) => node.xMm);
    const ys = document.nodes.map((node) => node.yMm);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(SPEC.widthMm);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(SPEC.depthMm);
    expect(document.floor.clearHeightMm).toBe(SPEC.clearHeightMm);
    expect(document.walls.every((wall) => wall.heightMm === SPEC.clearHeightMm)).toBe(true);
  });

  it("считает площадь из габаритов, а не из отдельного поля", () => {
    const derived = deriveLayout(createRoomDocument(SPEC));
    // 6000 × 4000 = 24 000 000 мм² (24 м²). Проверяется производная величина:
    // если контур собран неверно, площадь разойдётся, даже когда схема довольна.
    expect(derived.roomAreaMm2).toBe(24_000_000);
  });

  it("честно помечает, что габариты введены руками, а не обмерены", () => {
    const document = createRoomDocument(SPEC);
    expect(document.metadata.warnings).toContain("DIMENSIONS_FROM_USER_INPUT_NOT_SURVEYED");
    expect(document.variant.status).toBe("draft");
  });

  it("начинается с нулевой ревизии и без версий", () => {
    const document = createRoomDocument(SPEC);
    expect(document.stateRevision).toBe(0);
    expect(document.openings).toEqual([]);
    expect(document.objects).toEqual([]);
  });

  it("не запирает контур: габариты уточняются после обмера", () => {
    const document = createRoomDocument(SPEC);
    expect(document.walls.every((wall) => wall.locked === false)).toBe(true);
    expect(document.nodes.every((node) => node.locked === false)).toBe(true);
  });

  it("разводит идентификаторы разных планировок", () => {
    const first = createRoomDocument(SPEC);
    const second = createRoomDocument({ ...SPEC, documentId: "layout.test.other" });
    const firstIds = new Set(first.walls.map((wall) => wall.id));
    expect(second.walls.some((wall) => firstIds.has(wall.id))).toBe(false);
  });
});

describe("validateRoomSpec: понятные ошибки до сборки", () => {
  it("принимает нормальные габариты", () => {
    expect(validateRoomSpec(SPEC)).toEqual([]);
  });

  it("ловит слишком маленькое и слишком большое помещение", () => {
    expect(validateRoomSpec({ ...SPEC, widthMm: ROOM_LIMITS.minSideMm - 1 })).toContain(
      "WIDTH_OUT_OF_RANGE",
    );
    expect(validateRoomSpec({ ...SPEC, depthMm: ROOM_LIMITS.maxSideMm + 1 })).toContain(
      "DEPTH_OUT_OF_RANGE",
    );
    expect(validateRoomSpec({ ...SPEC, clearHeightMm: 100 })).toContain("HEIGHT_OUT_OF_RANGE");
  });

  it("не принимает дробные миллиметры", () => {
    expect(validateRoomSpec({ ...SPEC, widthMm: 6000.5 })).toContain(
      "NON_INTEGER_MILLIMETRES",
    );
  });

  it("требует название", () => {
    expect(validateRoomSpec({ ...SPEC, name: "   " })).toContain("NAME_REQUIRED");
  });

  it("не собирает документ из некорректных габаритов", () => {
    expect(() => createRoomDocument({ ...SPEC, widthMm: 0 })).toThrow();
  });
});
