import { describe, expect, it } from "vitest";

import {
  createSvgProjection,
  serializeSvgProjection,
} from "@/lib/layout-studio/adapters/svg/svg-projection";
import { deriveLayout } from "@/lib/layout-studio/domain";

import { makeSimpleRoom } from "../../application/layout-test-fixture";

describe("LS-020/060: canonical SVG projection", () => {
  it("keeps exact millimeter geometry in a deterministic exportable projection", () => {
    const projection = createSvgProjection(deriveLayout(makeSimpleRoom()));

    expect(projection.units).toBe("mm");
    expect(projection.viewBox).toEqual({ x: -100, y: -100, width: 4200, height: 3200 });
    expect(projection.walls).toContainEqual({
      sourceId: "wall.simple-room.north",
      points: [
        { xMm: 0, yMm: -100 },
        { xMm: 4000, yMm: -100 },
        { xMm: 4000, yMm: 100 },
        { xMm: 0, yMm: 100 },
      ],
    });
    expect(projection.openings).toContainEqual(
      expect.objectContaining({
        sourceId: "opening.simple-room.door",
        parentWallId: "wall.simple-room.north",
        offsetMm: 1000,
        widthMm: 900,
      }),
    );

    const svg = serializeSvgProjection(projection);
    expect(svg).toContain('viewBox="-100 -100 4200 3200"');
    expect(svg).toContain('data-source-id="wall.simple-room.north"');
    // Документный Y растёт на север (create-room), SVG — вниз: сериализация
    // отражает координаты, чтобы север был сверху и SVG совпадал с DXF в CAD,
    // а не был его зеркалом. Стена этой фикстуры на doc y≈0 поэтому рендерится
    // внизу вьюпорта (большие SVG-y).
    expect(svg).toContain("0,3100 4000,3100 4000,2900 0,2900");
    expect(svg).not.toMatch(/selected|selection|\/Users\//i);
  });
});
