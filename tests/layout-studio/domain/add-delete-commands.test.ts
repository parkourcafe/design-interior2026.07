import { describe, expect, it } from "vitest";

import { applyLayoutCommand, validateLayoutDocument } from "@/lib/layout-studio/domain";
import { createRoomDocument } from "@/lib/layout-studio/domain/create-room";
import type { LayoutCommand, LayoutDocument } from "@/lib/layout-studio/domain";

function room(): LayoutDocument {
  return createRoomDocument({
    widthMm: 6000,
    depthMm: 4000,
    clearHeightMm: 2800,
    name: "Комната",
    projectUuid: "11111111-1111-1111-1111-111111111111",
    documentId: "layout.cmd.room",
  });
}

function command(
  document: LayoutDocument,
  type: LayoutCommand["type"],
  payload: unknown,
): LayoutCommand {
  return {
    commandId: `cmd.${type}.${document.stateRevision}`,
    idempotencyKey: `key.${type}.${document.stateRevision}`,
    documentId: document.documentId,
    expectedStateRevision: document.stateRevision,
    reasonCode: "DESIGNER_EDIT",
    reason: "Тест",
    type,
    payload,
  } as LayoutCommand;
}

/** Применяет команду и требует успеха, возвращая новый документ. */
function apply(document: LayoutDocument, type: LayoutCommand["type"], payload: unknown) {
  const result = applyLayoutCommand(document, command(document, type, payload));
  if (!result.ok) {
    throw new Error(`команда ${type} отклонена: ${result.issues.map((i) => i.code).join(", ")}`);
  }
  return result.document;
}

const SOUTH_WALL = "wall.layout.cmd.room.south";

describe("Команды добавления", () => {
  it("добавляет проём в существующую стену", () => {
    const next = apply(room(), "ADD_OPENING", {
      openingId: "opening.new.door",
      parentWallId: SOUTH_WALL,
      kind: "door",
      offsetMm: 1000,
      widthMm: 900,
      heightMm: 2100,
      sillMm: 0,
      handing: "left",
      label: "Входная дверь",
    });

    expect(next.openings).toHaveLength(1);
    expect(next.openings[0]?.parentWallId).toBe(SOUTH_WALL);
    expect(validateLayoutDocument(next).valid).toBe(true);
  });

  it("добавляет колонну и объект", () => {
    let next = apply(room(), "ADD_COLUMN", {
      columnId: "column.new",
      xMm: 3000,
      yMm: 2000,
      widthMm: 250,
      depthMm: 250,
      baseZMm: 0,
      heightMm: 2800,
    });
    next = apply(next, "ADD_OBJECT", {
      objectId: "object.new",
      kind: "counter",
      xMm: 1000,
      yMm: 1000,
      zMm: 0,
      widthMm: 1600,
      depthMm: 600,
      heightMm: 1100,
    });

    expect(next.columns).toHaveLength(1);
    expect(next.objects).toHaveLength(1);
    expect(validateLayoutDocument(next).valid).toBe(true);
  });

  it("добавляет узел и стену на него — так растёт непрямоугольный контур", () => {
    let next = apply(room(), "ADD_NODE", { nodeId: "node.extra", xMm: 8000, yMm: 4000 });
    next = apply(next, "ADD_WALL", {
      wallId: "wall.extra",
      startNodeId: "node.layout.cmd.room.ne",
      endNodeId: "node.extra",
      thicknessMm: 100,
      heightMm: 2800,
      label: "Пристройка",
    });

    expect(next.nodes).toHaveLength(5);
    expect(next.walls).toHaveLength(5);
    expect(validateLayoutDocument(next).valid).toBe(true);
  });

  it("новая сущность не заблокирована: только что нарисованное не подтверждено обмером", () => {
    const next = apply(room(), "ADD_COLUMN", {
      columnId: "column.fresh",
      xMm: 3000,
      yMm: 2000,
      widthMm: 250,
      depthMm: 250,
      baseZMm: 0,
      heightMm: 2800,
    });
    expect(next.columns[0]?.locked).toBe(false);
  });

  it("не принимает второй элемент с тем же id", () => {
    const base = room();
    const result = applyLayoutCommand(
      base,
      command(base, "ADD_NODE", {
        nodeId: "node.layout.cmd.room.nw",
        xMm: 10,
        yMm: 10,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("DUPLICATE_ENTITY_ID");
    expect(result.document.nodes).toHaveLength(4);
  });

  it("не вешает проём на несуществующую стену", () => {
    const base = room();
    const result = applyLayoutCommand(
      base,
      command(base, "ADD_OPENING", {
        openingId: "opening.orphan",
        parentWallId: "wall.does-not-exist",
        kind: "window",
        offsetMm: 100,
        widthMm: 600,
        heightMm: 1200,
        sillMm: 800,
      }),
    );
    // Ловит общая валидация документа, а не отдельная проверка в команде.
    expect(result.ok).toBe(false);
    expect(result.document.openings).toHaveLength(0);
  });

  it("не принимает проём шире своей стены", () => {
    const base = room();
    const result = applyLayoutCommand(
      base,
      command(base, "ADD_OPENING", {
        openingId: "opening.too-wide",
        parentWallId: SOUTH_WALL,
        kind: "free_opening",
        offsetMm: 0,
        widthMm: 99_000,
        heightMm: 2000,
        sillMm: 0,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.document.openings).toHaveLength(0);
  });
});

describe("Удаление", () => {
  it("удаляет одиночный объект", () => {
    let next = apply(room(), "ADD_OBJECT", {
      objectId: "object.temp",
      kind: "decor",
      xMm: 500,
      yMm: 500,
      zMm: 0,
      widthMm: 400,
      depthMm: 400,
      heightMm: 400,
    });
    next = apply(next, "DELETE_ENTITY", { entityId: "object.temp" });

    expect(next.objects).toHaveLength(0);
    expect(validateLayoutDocument(next).valid).toBe(true);
  });

  it("не удаляет стену с проёмом молча — нужен явный каскад", () => {
    const withDoor = apply(room(), "ADD_OPENING", {
      openingId: "opening.door",
      parentWallId: SOUTH_WALL,
      kind: "door",
      offsetMm: 1000,
      widthMm: 900,
      heightMm: 2100,
      sillMm: 0,
    });

    const refused = applyLayoutCommand(
      withDoor,
      command(withDoor, "DELETE_ENTITY", { entityId: SOUTH_WALL }),
    );
    expect(refused.ok).toBe(false);
    expect(refused.issues[0]?.code).toBe("ENTITY_HAS_DEPENDENTS");
    // Документ не тронут: ни стена, ни дверь не исчезли.
    expect(refused.document.walls).toHaveLength(4);
    expect(refused.document.openings).toHaveLength(1);

    const cascaded = apply(withDoor, "DELETE_ENTITY", {
      entityId: SOUTH_WALL,
      cascade: true,
    });
    expect(cascaded.walls).toHaveLength(3);
    expect(cascaded.openings).toHaveLength(0);
  });

  it("каскад от узла разворачивается вглубь: узел → стены → их проёмы", () => {
    const withDoor = apply(room(), "ADD_OPENING", {
      openingId: "opening.door",
      parentWallId: SOUTH_WALL,
      kind: "door",
      offsetMm: 1000,
      widthMm: 900,
      heightMm: 2100,
      sillMm: 0,
    });

    // Юго-восточный угол держит южную и восточную стены; на южной висит дверь.
    const next = apply(withDoor, "DELETE_ENTITY", {
      entityId: "node.layout.cmd.room.se",
      cascade: true,
    });

    expect(next.nodes).toHaveLength(3);
    expect(next.walls).toHaveLength(2);
    expect(next.openings).toHaveLength(0);
    expect(validateLayoutDocument(next).valid).toBe(true);
  });

  it("вычищает назначения материалов удалённой стены", () => {
    const before = room();
    expect(before.materialAssignments.some((a) => a.targetId === SOUTH_WALL)).toBe(true);

    const next = apply(before, "DELETE_ENTITY", { entityId: SOUTH_WALL, cascade: true });
    expect(next.materialAssignments.some((a) => a.targetId === SOUTH_WALL)).toBe(false);
    expect(validateLayoutDocument(next).valid).toBe(true);
  });

  it("не удаляет заблокированное", () => {
    const base = room();
    base.walls[0]!.locked = true;
    const result = applyLayoutCommand(
      base,
      command(base, "DELETE_ENTITY", { entityId: base.walls[0]!.id }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("ENTITY_LOCKED");
  });

  it("отказывает в каскаде, если под него попадает заблокированный элемент", () => {
    const withDoor = apply(room(), "ADD_OPENING", {
      openingId: "opening.locked",
      parentWallId: SOUTH_WALL,
      kind: "door",
      offsetMm: 1000,
      widthMm: 900,
      heightMm: 2100,
      sillMm: 0,
    });
    withDoor.openings[0]!.locked = true;

    const result = applyLayoutCommand(
      withDoor,
      command(withDoor, "DELETE_ENTITY", { entityId: SOUTH_WALL, cascade: true }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("ENTITY_LOCKED");
    expect(result.document.openings).toHaveLength(1);
  });

  it("сообщает, что удалять нечего", () => {
    const base = room();
    const result = applyLayoutCommand(
      base,
      command(base, "DELETE_ENTITY", { entityId: "нет-такого" }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("ENTITY_NOT_FOUND");
  });
});

describe("Общие правила движка распространяются на новые команды", () => {
  it("ревизия растёт на единицу за команду", () => {
    const base = room();
    const next = apply(base, "ADD_NODE", { nodeId: "node.rev", xMm: 100, yMm: 100 });
    expect(next.stateRevision).toBe(base.stateRevision + 1);
  });

  it("отклоняет команду на устаревшей ревизии", () => {
    const base = room();
    const stale = {
      ...command(base, "ADD_NODE", { nodeId: "node.stale", xMm: 100, yMm: 100 }),
      expectedStateRevision: base.stateRevision + 5,
    } as LayoutCommand;
    const result = applyLayoutCommand(base, stale);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("STATE_STALE");
  });

  it("отклонённая команда не меняет исходный документ", () => {
    const base = room();
    const snapshot = JSON.stringify(base);
    applyLayoutCommand(base, command(base, "DELETE_ENTITY", { entityId: SOUTH_WALL }));
    applyLayoutCommand(base, command(base, "ADD_NODE", { nodeId: base.nodes[0]!.id, xMm: 0, yMm: 0 }));
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
