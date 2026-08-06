import type {
  LayoutCommand,
  LayoutDocument,
} from "@/lib/layout-studio/domain";

export function makeSimpleRoom(): LayoutDocument {
  return {
    contractVersion: "archidom.layout-document/0.1",
    documentId: "document.simple-room",
    projectId: "project.simple-room",
    name: "Простая комната",
    canonicalUnits: "mm",
    stateRevision: 3,
    floor: {
      id: "floor.simple-room.main",
      label: "Этаж 1",
      elevationMm: 0,
      clearHeightMm: 2800,
    },
    variant: {
      id: "variant.simple-room.main",
      label: "Основной вариант",
      status: "draft",
    },
    nodes: [
      { id: "node.simple-room.nw", xMm: 0, yMm: 0, locked: true },
      { id: "node.simple-room.ne", xMm: 4000, yMm: 0, locked: true },
      { id: "node.simple-room.se", xMm: 4000, yMm: 3000, locked: true },
      { id: "node.simple-room.sw", xMm: 0, yMm: 3000, locked: true },
    ],
    walls: [
      {
        id: "wall.simple-room.north",
        startNodeId: "node.simple-room.nw",
        endNodeId: "node.simple-room.ne",
        thicknessMm: 200,
        heightMm: 2800,
        kind: "existing",
        locked: true,
        label: "Северная стена",
      },
      {
        id: "wall.simple-room.east",
        startNodeId: "node.simple-room.ne",
        endNodeId: "node.simple-room.se",
        thicknessMm: 200,
        heightMm: 2800,
        kind: "existing",
        locked: true,
        label: "Восточная стена",
      },
      {
        id: "wall.simple-room.south",
        startNodeId: "node.simple-room.se",
        endNodeId: "node.simple-room.sw",
        thicknessMm: 200,
        heightMm: 2800,
        kind: "existing",
        locked: true,
        label: "Южная стена",
      },
      {
        id: "wall.simple-room.west",
        startNodeId: "node.simple-room.sw",
        endNodeId: "node.simple-room.nw",
        thicknessMm: 200,
        heightMm: 2800,
        kind: "existing",
        locked: true,
        label: "Западная стена",
      },
    ],
    openings: [
      {
        id: "opening.simple-room.door",
        parentWallId: "wall.simple-room.north",
        kind: "door",
        offsetMm: 1000,
        widthMm: 900,
        heightMm: 2100,
        sillMm: 0,
        handing: "left",
        locked: true,
        label: "Дверь",
      },
    ],
    columns: [
      {
        id: "column.simple-room.center",
        xMm: 2000,
        yMm: 1500,
        widthMm: 250,
        depthMm: 250,
        baseZMm: 0,
        heightMm: 2800,
        rotationDeg: 0,
        locked: true,
        label: "Колонна",
      },
    ],
    objects: [
      {
        id: "object.simple-room.table",
        kind: "equipment",
        xMm: 1000,
        yMm: 1500,
        zMm: 0,
        widthMm: 600,
        depthMm: 600,
        heightMm: 900,
        rotationDeg: 0,
        locked: false,
        label: "Стол",
      },
    ],
    clearanceZones: [],
    materials: [
      {
        id: "material.simple-room.concrete",
        labelRu: "Бетон",
        baseColor: "#B0B0B0",
        roughness: 0.85,
        metalness: 0,
        emissive: "#000000",
        emissiveIntensity: 0,
        provenance: "synthetic-test-fixture",
      },
    ],
    materialAssignments: [
      {
        id: "assignment.simple-room.walls",
        targetId: "wall.simple-room.north",
        surfaceRole: "all",
        materialId: "material.simple-room.concrete",
      },
    ],
    lights: [
      {
        id: "light.simple-room.ambient",
        kind: "ambient",
        xMm: 2000,
        yMm: 1500,
        zMm: 2600,
        color: "#FFFFFF",
        intensity: 1,
        label: "Общий свет",
      },
    ],
    metadata: {
      sourceRefs: ["synthetic:simple-room-v0.1"],
      warnings: [],
    },
  };
}

export function moveTableCommand(
  document: LayoutDocument,
  xMm = 1100,
): LayoutCommand {
  return {
    commandId: `command.simple-room.move-table-${xMm}`,
    idempotencyKey: `idem.simple-room.move-table-${xMm}`,
    documentId: document.documentId,
    expectedStateRevision: document.stateRevision,
    type: "MOVE_OBJECT",
    payload: {
      objectId: "object.simple-room.table",
      xMm,
      yMm: 1500,
    },
    reasonCode: "USER_INSPECTOR_EDIT",
    reason: "Перемещение тестового оборудования",
  } as LayoutCommand;
}
