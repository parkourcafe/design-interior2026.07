import { describe, expect, it } from "vitest";

import {
  GRID_MM,
  isDegenerate,
  nextEntityId,
  segmentLengthMm,
  snapPoint,
  wallExistsBetween,
} from "@/lib/layout-studio/application/wall-drawing";
import { createRoomDocument } from "@/lib/layout-studio/domain/create-room";
import { applyLayoutCommand, validateLayoutDocument } from "@/lib/layout-studio/domain";
import type { LayoutCommand, LayoutDocument } from "@/lib/layout-studio/domain";

function room(): LayoutDocument {
  return createRoomDocument({
    widthMm: 6000,
    depthMm: 4000,
    clearHeightMm: 2800,
    name: "Комната",
    projectUuid: "11111111-1111-1111-1111-111111111111",
    documentId: "layout.draw.room",
  });
}

const RADIUS = 200;
const NE = { xMm: 6000, yMm: 4000 };

describe("Привязка при рисовании", () => {
  it("притягивает к существующему углу и возвращает его id", () => {
    const document = room();
    const snapped = snapPoint(document, { xMm: 5950, yMm: 4030 }, { snapRadiusMm: RADIUS });

    expect(snapped.kind).toBe("node");
    expect(snapped.xMm).toBe(NE.xMm);
    expect(snapped.yMm).toBe(NE.yMm);
    expect(snapped.nodeId).toBe("node.layout.draw.room.ne");
  });

  it("выбирает ближайший угол, когда рядом несколько", () => {
    const document = room();
    // Между юго-западным (0,0) и юго-восточным (6000,0), но ближе к первому.
    const snapped = snapPoint(document, { xMm: 40, yMm: 30 }, { snapRadiusMm: 10_000 });
    expect(snapped.nodeId).toBe("node.layout.draw.room.sw");
  });

  it("не притягивает угол, который дальше радиуса захвата", () => {
    const document = room();
    const snapped = snapPoint(document, { xMm: 3000, yMm: 2000 }, { snapRadiusMm: RADIUS });
    expect(snapped.kind).not.toBe("node");
    expect(snapped.nodeId).toBeUndefined();
  });

  it("держит ортогональ относительно предыдущей точки", () => {
    const document = room();
    const anchor = { xMm: 1000, yMm: 1000 };

    // Почти вертикально вверх: X должен остаться ровно якорным.
    const vertical = snapPoint(document, { xMm: 1080, yMm: 3000 }, { anchor, snapRadiusMm: 10 });
    expect(vertical.kind).toBe("orthogonal");
    expect(vertical.xMm).toBe(1000);

    // Почти горизонтально: Y остаётся якорным.
    const horizontal = snapPoint(document, { xMm: 3000, yMm: 1090 }, { anchor, snapRadiusMm: 10 });
    expect(horizontal.kind).toBe("orthogonal");
    expect(horizontal.yMm).toBe(1000);
  });

  it("не выпрямляет стену, задуманную под углом", () => {
    const document = room();
    const anchor = { xMm: 1000, yMm: 1000 };
    const diagonal = snapPoint(document, { xMm: 2500, yMm: 2500 }, { anchor, snapRadiusMm: 10 });
    expect(diagonal.kind).toBe("grid");
  });

  it("иначе кладёт точку на сетку", () => {
    const document = room();
    const snapped = snapPoint(document, { xMm: 2013, yMm: 977 }, { snapRadiusMm: 10 });
    expect(snapped.kind).toBe("grid");
    expect(snapped.xMm % GRID_MM).toBe(0);
    expect(snapped.yMm % GRID_MM).toBe(0);
  });

  it("угол побеждает ортогональ: замкнуть контур важнее, чем выпрямить", () => {
    const document = room();
    const snapped = snapPoint(
      document,
      { xMm: 5980, yMm: 3990 },
      { anchor: { xMm: 5980, yMm: 1000 }, snapRadiusMm: RADIUS },
    );
    expect(snapped.kind).toBe("node");
    expect(snapped.nodeId).toBe("node.layout.draw.room.ne");
  });
});

describe("Вспомогательные проверки", () => {
  it("считает длину будущей стены в целых миллиметрах", () => {
    expect(segmentLengthMm({ xMm: 0, yMm: 0 }, { xMm: 3000, yMm: 4000 })).toBe(5000);
  });

  it("считает вырожденным щелчок по той же точке", () => {
    expect(isDegenerate({ xMm: 1000, yMm: 1000 }, { xMm: 1010, yMm: 1000 })).toBe(true);
    expect(isDegenerate({ xMm: 1000, yMm: 1000 }, { xMm: 1500, yMm: 1000 })).toBe(false);
  });

  it("видит уже существующую стену в любом направлении", () => {
    const document = room();
    const wall = document.walls[0]!;
    expect(wallExistsBetween(document, wall.startNodeId, wall.endNodeId)).toBe(true);
    expect(wallExistsBetween(document, wall.endNodeId, wall.startNodeId)).toBe(true);
    expect(wallExistsBetween(document, wall.startNodeId, "node.чужой")).toBe(false);
  });

  it("выдаёт идентификаторы, которые принимает замороженная схема", () => {
    const document = room();
    const pattern = /^[a-z][a-z0-9._-]{2,127}$/;
    expect(nextEntityId(document, "node")).toMatch(pattern);
    expect(nextEntityId(document, "wall")).toMatch(pattern);
  });

  it("не выдаёт занятый идентификатор", () => {
    const document = room();
    const first = nextEntityId(document, "node");
    document.nodes.push({ id: first, xMm: 0, yMm: 0, locked: false });
    expect(nextEntityId(document, "node")).not.toBe(first);
  });
});

describe("Рисование целиком: от кликов до валидного документа", () => {
  it("пристраивает к комнате замкнутый выступ", () => {
    let document = room();
    const dispatch = (type: LayoutCommand["type"], payload: unknown) => {
      const result = applyLayoutCommand(document, {
        commandId: `cmd.${document.stateRevision}`,
        idempotencyKey: `key.${document.stateRevision}`,
        documentId: document.documentId,
        expectedStateRevision: document.stateRevision,
        reasonCode: "WALL_DRAWING",
        reason: "Рисование",
        type,
        payload,
      } as LayoutCommand);
      if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join(","));
      document = result.document;
    };

    // Клик по юго-восточному углу — привязка вернула существующий узел, новый
    // не создаём. Это и есть смысл приоритета узлов.
    const start = snapPoint(document, { xMm: 6010, yMm: 20 }, { snapRadiusMm: RADIUS });
    expect(start.nodeId).toBeDefined();

    const cornerId = nextEntityId(document, "node");
    dispatch("ADD_NODE", { nodeId: cornerId, xMm: 8000, yMm: 0 });
    dispatch("ADD_WALL", {
      wallId: nextEntityId(document, "wall"),
      startNodeId: start.nodeId,
      endNodeId: cornerId,
      thicknessMm: 100,
      heightMm: 2800,
    });

    const topId = nextEntityId(document, "node");
    dispatch("ADD_NODE", { nodeId: topId, xMm: 8000, yMm: 4000 });
    dispatch("ADD_WALL", {
      wallId: nextEntityId(document, "wall"),
      startNodeId: cornerId,
      endNodeId: topId,
      thicknessMm: 100,
      heightMm: 2800,
    });

    // Замыкание на существующий северо-восточный угол.
    const close = snapPoint(document, { xMm: 6020, yMm: 3980 }, { snapRadiusMm: RADIUS });
    expect(close.nodeId).toBe("node.layout.draw.room.ne");
    dispatch("ADD_WALL", {
      wallId: nextEntityId(document, "wall"),
      startNodeId: topId,
      endNodeId: close.nodeId,
      thicknessMm: 100,
      heightMm: 2800,
    });

    expect(document.nodes).toHaveLength(6);
    expect(document.walls).toHaveLength(7);
    expect(validateLayoutDocument(document).valid).toBe(true);
  });
});
