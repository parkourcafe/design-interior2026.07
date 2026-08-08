import { describe, expect, it } from "vitest";

import {
  applyLayoutCommand,
  canonicalSerialize,
  deriveLayout,
  diffLayoutDocuments,
  semanticHash,
  validateLayoutDocument,
  type LayoutCommand,
  type LayoutDocument,
} from "@/lib/layout-studio/domain";

function makeSimpleRoom(): LayoutDocument {
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

function cloneDocument(document: LayoutDocument): LayoutDocument {
  return structuredClone(document);
}

function issueCodes(result: { issues: Array<{ code: string }> }): string[] {
  return result.issues.map((issue) => issue.code);
}

function moveTableCommand(overrides: Partial<LayoutCommand> = {}): LayoutCommand {
  return {
    commandId: "command.simple-room.move-table-1",
    idempotencyKey: "idem.simple-room.move-table-1",
    documentId: "document.simple-room",
    expectedStateRevision: 3,
    type: "MOVE_OBJECT",
    payload: {
      objectId: "object.simple-room.table",
      xMm: 1100,
      yMm: 1500,
    },
    reasonCode: "USER_INSPECTOR_EDIT",
    reason: "Перемещение тестового оборудования",
    ...overrides,
  } as LayoutCommand;
}

describe("LS-010: frozen layout document contract", () => {
  it("accepts a schema-valid integer-millimeter document", () => {
    const result = validateLayoutDocument(makeSimpleRoom());

    expect(result.valid).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
  });

  it.each([
    ["coordinate", (document: LayoutDocument) => (document.nodes[0]!.xMm = 0.5)],
    ["linear dimension", (document: LayoutDocument) => (document.walls[0]!.thicknessMm = 199.5)],
  ])("rejects a decimal canonical %s", (_label, mutate) => {
    const document = makeSimpleRoom();
    mutate(document);

    const result = validateLayoutDocument(document);

    expect(result.valid).toBe(false);
    expect(issueCodes(result)).toContain("NON_INTEGER_DIMENSION");
  });

  it("reports a duplicate stable ID across entity collections", () => {
    const document = makeSimpleRoom();
    document.objects[0]!.id = document.columns[0]!.id;

    const result = validateLayoutDocument(document);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_STABLE_ID",
        severity: "blocking",
        entityIds: ["column.simple-room.center"],
      }),
    );
  });

  it.each([
    [
      "wall node",
      (document: LayoutDocument) => {
        document.walls[0]!.startNodeId = "node.simple-room.missing";
      },
      "MISSING_NODE",
    ],
    [
      "opening parent",
      (document: LayoutDocument) => {
        document.openings[0]!.parentWallId = "wall.simple-room.missing";
      },
      "MISSING_OPENING_PARENT",
    ],
  ])("rejects a missing referenced %s", (_label, mutate, expectedCode) => {
    const document = makeSimpleRoom();
    mutate(document);

    const result = validateLayoutDocument(document);

    expect(result.valid).toBe(false);
    expect(issueCodes(result)).toContain(expectedCode);
  });
});

describe("LS-011: immutable commands, canonical hash and diff", () => {
  it("applies a valid command immutably and increments stateRevision once", () => {
    const original = makeSimpleRoom();
    const before = cloneDocument(original);

    const result = applyLayoutCommand(original, moveTableCommand());

    expect(result.ok).toBe(true);
    expect(original).toEqual(before);
    expect(result.document).not.toBe(original);
    expect(result.document.stateRevision).toBe(4);
    expect(result.document.objects[0]).toEqual(
      expect.objectContaining({ xMm: 1100, yMm: 1500 }),
    );
  });

  it("rejects a stale expected revision and preserves the last valid state", () => {
    const original = makeSimpleRoom();

    const result = applyLayoutCommand(
      original,
      moveTableCommand({ expectedStateRevision: 2 }),
    );

    expect(result.ok).toBe(false);
    expect(result.document).toEqual(original);
    expect(result.document).toBe(original);
    expect(issueCodes(result)).toContain("STATE_STALE");
  });

  it("rejects an edit to a locked structural column", () => {
    const original = makeSimpleRoom();
    const command = {
      commandId: "command.simple-room.move-column-1",
      idempotencyKey: "idem.simple-room.move-column-1",
      documentId: original.documentId,
      expectedStateRevision: original.stateRevision,
      type: "UPDATE_COLUMN",
      payload: {
        columnId: "column.simple-room.center",
        xMm: 2100,
      },
      reasonCode: "USER_DRAG",
      reason: "Попытка перемещения заблокированной колонны",
    } as LayoutCommand;

    const result = applyLayoutCommand(original, command);

    expect(result.ok).toBe(false);
    expect(result.document).toBe(original);
    expect(result.document.stateRevision).toBe(3);
    expect(issueCodes(result)).toContain("ENTITY_LOCKED");
  });

  it("returns the same logical result for an idempotent replay", () => {
    const original = makeSimpleRoom();
    const command = moveTableCommand();

    const first = applyLayoutCommand(original, command);
    const replay = applyLayoutCommand(original, command);

    expect(replay).toEqual(first);
    expect(replay.document.stateRevision).toBe(4);
  });

  it("canonicalizes entity order and excludes revision and UI/session fields", async () => {
    const original = makeSimpleRoom();
    const semanticallyEqual = {
      ...cloneDocument(original),
      stateRevision: 99,
      nodes: [...original.nodes].reverse(),
      walls: [...original.walls].reverse(),
      updatedAt: "2099-01-01T00:00:00.000Z",
      selection: { entityId: "wall.simple-room.north" },
      session: { zoom: 4 },
    } as unknown as LayoutDocument;

    expect(canonicalSerialize(semanticallyEqual)).toBe(canonicalSerialize(original));
    await expect(semanticHash(semanticallyEqual)).resolves.toBe(
      await semanticHash(original),
    );
  });

  it("reports the exact canonical entity field changed", () => {
    const before = makeSimpleRoom();
    const after = cloneDocument(before);
    after.stateRevision += 1;
    after.objects[0]!.xMm = 1100;

    const diff = diffLayoutDocuments(
      "version.simple-room.a",
      before,
      "version.simple-room.b",
      after,
    );

    expect(diff).toEqual({
      fromVersionId: "version.simple-room.a",
      toVersionId: "version.simple-room.b",
      addedEntityIds: [],
      removedEntityIds: [],
      changed: [
        {
          entityId: "object.simple-room.table",
          entityType: "object",
          fields: [{ path: "xMm", before: 1000, after: 1100 }],
        },
      ],
    });
  });
});

describe("LS-012: deterministic geometry derivation", () => {
  it("derives deterministic 200 mm wall polygons", () => {
    const document = makeSimpleRoom();

    const first = deriveLayout(document);
    const second = deriveLayout(cloneDocument(document));

    expect(second).toEqual(first);
    expect(first.wallPolygons).toHaveLength(4);
    expect(first.wallPolygons).toContainEqual({
      wallId: "wall.simple-room.north",
      polygon: [
        { xMm: 0, yMm: -100 },
        { xMm: 4000, yMm: -100 },
        { xMm: 4000, yMm: 100 },
        { xMm: 0, yMm: 100 },
      ],
    });
  });

  it("derives the exact node-contour room area and physical bounds", () => {
    const derived = deriveLayout(makeSimpleRoom());

    expect(derived.valid).toBe(true);
    expect(derived.roomAreaMm2).toBe(12_000_000);
    expect(derived.bounds).toEqual({
      minXMm: -100,
      minYMm: -100,
      maxXMm: 4100,
      maxYMm: 3100,
    });
  });

  it("keeps a column independent from room and wall derivation", () => {
    const withColumn = makeSimpleRoom();
    const withoutColumn = cloneDocument(withColumn);
    withoutColumn.columns = [];

    const first = deriveLayout(withColumn);
    const second = deriveLayout(withoutColumn);

    expect(first.roomAreaMm2).toBe(second.roomAreaMm2);
    expect(first.wallPolygons).toEqual(second.wallPolygons);
    expect(first.sceneProjection.columns).toContainEqual(
      expect.objectContaining({
        id: "column.simple-room.center",
        widthMm: 250,
        depthMm: 250,
        baseZMm: 0,
        heightMm: 2800,
      }),
    );
    expect(second.sceneProjection.columns).toEqual([]);
  });

  it("rejects a zero-length wall", () => {
    const document = makeSimpleRoom();
    document.walls[0]!.endNodeId = document.walls[0]!.startNodeId;

    const derived = deriveLayout(document);

    expect(derived.valid).toBe(false);
    expect(issueCodes(derived)).toContain("ZERO_LENGTH_WALL");
  });

  it("rejects an opening whose offset plus width exceeds its parent wall", () => {
    const document = makeSimpleRoom();
    document.openings[0]!.offsetMm = 3500;
    document.openings[0]!.widthMm = 600;

    const validation = validateLayoutDocument(document);
    const derived = deriveLayout(document);

    expect(validation.valid).toBe(false);
    expect(issueCodes(validation)).toContain("OPENING_OUTSIDE_WALL");
    expect(derived.valid).toBe(false);
    expect(issueCodes(derived)).toContain("OPENING_OUTSIDE_WALL");
  });
});
