import {
  blockingIssue,
  ENTITY_COLLECTIONS,
  isRecord,
  nodeMap,
  visitValues,
  wallLength,
} from "./shared";
import type { LayoutDocument, LayoutIssue, LayoutValidationResult } from "./types";

const ROOT_FIELDS = [
  "contractVersion",
  "documentId",
  "projectId",
  "name",
  "canonicalUnits",
  "stateRevision",
  "floor",
  "variant",
  ...ENTITY_COLLECTIONS,
  "metadata",
] as const;

const ENTITY_SHAPES = {
  nodes: {
    required: ["id", "xMm", "yMm", "locked"],
    optional: [],
  },
  walls: {
    required: [
      "id",
      "startNodeId",
      "endNodeId",
      "thicknessMm",
      "heightMm",
      "kind",
      "locked",
    ],
    optional: ["label"],
  },
  openings: {
    required: [
      "id",
      "parentWallId",
      "kind",
      "offsetMm",
      "widthMm",
      "heightMm",
      "sillMm",
      "locked",
    ],
    optional: ["handing", "label"],
  },
  columns: {
    required: [
      "id",
      "xMm",
      "yMm",
      "widthMm",
      "depthMm",
      "baseZMm",
      "heightMm",
      "rotationDeg",
      "locked",
    ],
    optional: ["label"],
  },
  objects: {
    required: [
      "id",
      "kind",
      "xMm",
      "yMm",
      "zMm",
      "widthMm",
      "depthMm",
      "heightMm",
      "rotationDeg",
      "locked",
    ],
    optional: ["label"],
  },
  clearanceZones: {
    required: ["id"],
    optional: [
      "kind",
      "targetId",
      "xMm",
      "yMm",
      "zMm",
      "widthMm",
      "depthMm",
      "heightMm",
      "rotationDeg",
      "locked",
      "label",
    ],
  },
  materials: {
    required: [
      "id",
      "labelRu",
      "baseColor",
      "roughness",
      "metalness",
      "emissive",
      "emissiveIntensity",
      "provenance",
    ],
    optional: [],
  },
  materialAssignments: {
    required: ["id", "targetId", "surfaceRole", "materialId"],
    optional: [],
  },
  lights: {
    required: ["id", "kind", "xMm", "yMm", "zMm", "color", "intensity", "label"],
    optional: ["targetId", "groundColor", "distanceMm", "decay"],
  },
} as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function shapeIssue(
  issues: LayoutIssue[],
  code: string,
  message: string,
  path: string,
  entityId?: unknown,
): void {
  issues.push(
    blockingIssue(code, message, {
      path,
      ...(typeof entityId === "string" ? { entityIds: [entityId] } : {}),
    }),
  );
}

function validateExactKeys(
  value: Record<string, unknown>,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: LayoutIssue[],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      shapeIssue(issues, "MISSING_REQUIRED_FIELD", "Отсутствует обязательное поле", `${path}.${key}`, value.id);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      shapeIssue(issues, "UNKNOWN_FIELD", "Поле не входит в зафиксированный контракт", `${path}.${key}`, value.id);
    }
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: LayoutIssue[],
): void {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    shapeIssue(issues, "INVALID_FIELD_TYPE", "Поле должно быть непустой строкой", `${path}.${key}`, value.id);
  }
}

function requireBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: LayoutIssue[],
): void {
  if (typeof value[key] !== "boolean") {
    shapeIssue(issues, "INVALID_FIELD_TYPE", "Поле должно быть boolean", `${path}.${key}`, value.id);
  }
}

function requireFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: LayoutIssue[],
): void {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
    shapeIssue(issues, "INVALID_FIELD_TYPE", "Поле должно быть конечным числом", `${path}.${key}`, value.id);
  }
}

function validateEntityFields(
  collectionName: keyof typeof ENTITY_SHAPES,
  entity: Record<string, unknown>,
  path: string,
  issues: LayoutIssue[],
): void {
  requireString(entity, "id", path, issues);

  switch (collectionName) {
    case "nodes":
      requireFiniteNumber(entity, "xMm", path, issues);
      requireFiniteNumber(entity, "yMm", path, issues);
      requireBoolean(entity, "locked", path, issues);
      break;
    case "walls":
      requireString(entity, "startNodeId", path, issues);
      requireString(entity, "endNodeId", path, issues);
      requireFiniteNumber(entity, "thicknessMm", path, issues);
      requireFiniteNumber(entity, "heightMm", path, issues);
      requireString(entity, "kind", path, issues);
      requireBoolean(entity, "locked", path, issues);
      break;
    case "openings":
      requireString(entity, "parentWallId", path, issues);
      requireString(entity, "kind", path, issues);
      for (const key of ["offsetMm", "widthMm", "heightMm", "sillMm"]) {
        requireFiniteNumber(entity, key, path, issues);
      }
      requireBoolean(entity, "locked", path, issues);
      break;
    case "columns":
      for (const key of [
        "xMm",
        "yMm",
        "widthMm",
        "depthMm",
        "baseZMm",
        "heightMm",
        "rotationDeg",
      ]) {
        requireFiniteNumber(entity, key, path, issues);
      }
      requireBoolean(entity, "locked", path, issues);
      break;
    case "objects":
      requireString(entity, "kind", path, issues);
      for (const key of [
        "xMm",
        "yMm",
        "zMm",
        "widthMm",
        "depthMm",
        "heightMm",
        "rotationDeg",
      ]) {
        requireFiniteNumber(entity, key, path, issues);
      }
      requireBoolean(entity, "locked", path, issues);
      break;
    case "materials":
      for (const key of ["labelRu", "baseColor", "emissive", "provenance"]) {
        requireString(entity, key, path, issues);
      }
      for (const key of ["roughness", "metalness", "emissiveIntensity"]) {
        requireFiniteNumber(entity, key, path, issues);
      }
      break;
    case "materialAssignments":
      for (const key of ["targetId", "surfaceRole", "materialId"]) {
        requireString(entity, key, path, issues);
      }
      break;
    case "lights":
      for (const key of ["kind", "color", "label"]) requireString(entity, key, path, issues);
      for (const key of ["xMm", "yMm", "zMm", "intensity"]) {
        requireFiniteNumber(entity, key, path, issues);
      }
      for (const key of ["targetId", "groundColor"]) {
        if (entity[key] !== undefined) requireString(entity, key, path, issues);
      }
      for (const key of ["distanceMm", "decay"]) {
        if (entity[key] !== undefined) requireFiniteNumber(entity, key, path, issues);
      }
      break;
    case "clearanceZones":
      break;
  }
}

function validateShape(document: Record<string, unknown>, issues: LayoutIssue[]): void {
  validateExactKeys(document, "document", ROOT_FIELDS, [], issues);

  for (const key of ["contractVersion", "documentId", "projectId", "name", "canonicalUnits"]) {
    requireString(document, key, "document", issues);
  }
  requireFiniteNumber(document, "stateRevision", "document", issues);

  for (const [path, required] of [
    ["floor", ["id", "label", "elevationMm", "clearHeightMm"]],
    ["variant", ["id", "label", "status"]],
    ["metadata", ["sourceRefs", "warnings"]],
  ] as const) {
    const value = document[path];
    if (!isRecord(value)) {
      shapeIssue(issues, "INVALID_FIELD_TYPE", "Поле должно быть объектом", path);
      continue;
    }
    validateExactKeys(value, path, required, [], issues);
    if (path === "floor") {
      requireString(value, "id", path, issues);
      requireString(value, "label", path, issues);
      requireFiniteNumber(value, "elevationMm", path, issues);
      requireFiniteNumber(value, "clearHeightMm", path, issues);
    } else if (path === "variant") {
      requireString(value, "id", path, issues);
      requireString(value, "label", path, issues);
      requireString(value, "status", path, issues);
    } else {
      for (const key of ["sourceRefs", "warnings"]) {
        if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string")) {
          shapeIssue(issues, "INVALID_FIELD_TYPE", "Поле должно быть массивом строк", `${path}.${key}`);
        }
      }
    }
  }

  for (const collectionName of ENTITY_COLLECTIONS) {
    const collection = document[collectionName];
    if (!Array.isArray(collection)) {
      shapeIssue(issues, "INVALID_ENTITY_COLLECTION", `Коллекция ${collectionName} должна быть массивом`, collectionName);
      continue;
    }
    const shape = ENTITY_SHAPES[collectionName];
    collection.forEach((entity, index) => {
      const path = `${collectionName}[${index}]`;
      if (!isRecord(entity)) {
        shapeIssue(issues, "INVALID_ENTITY", "Элемент коллекции должен быть объектом", path);
        return;
      }
      validateExactKeys(entity, path, shape.required, shape.optional, issues);
      validateEntityFields(collectionName, entity, path, issues);
    });
  }
}

function inRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function validateLayoutDocument(document: LayoutDocument): LayoutValidationResult {
  const issues: LayoutIssue[] = [];

  if (!isRecord(document)) {
    return {
      valid: false,
      issues: [blockingIssue("INVALID_DOCUMENT", "Документ планировки должен быть объектом")],
    };
  }

  validateShape(document, issues);

  // Structural validation below assumes the frozen contract shape. Returning here
  // also ensures malformed partial input is rejected without throwing.
  if (issues.length > 0) return { valid: false, issues };

  if (document.contractVersion !== "archidom.layout-document/0.1") {
    shapeIssue(issues, "INVALID_CONTRACT_VERSION", "Версия контракта документа не поддерживается", "contractVersion");
  }
  if (document.canonicalUnits !== "mm") {
    issues.push(
      blockingIssue("INVALID_CANONICAL_UNITS", "Канонические единицы документа должны быть mm", {
        path: "canonicalUnits",
      }),
    );
  }
  if (!Number.isSafeInteger(document.stateRevision) || document.stateRevision < 0) {
    shapeIssue(issues, "INVALID_STATE_REVISION", "Ревизия должна быть неотрицательным safe integer", "stateRevision");
  }

  visitValues(document, "", (value, path, key) => {
    if ((key.endsWith("Mm") || key.endsWith("Mm2")) && typeof value === "number") {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        issues.push(
          blockingIssue("NON_INTEGER_DIMENSION", "Размеры и координаты задаются целыми миллиметрами", {
            path,
          }),
        );
      }
    }
  });

  const ids = new Set<string>();
  const rootEntityIds = [document.floor?.id, document.variant?.id];
  for (const id of rootEntityIds) {
    if (typeof id === "string") ids.add(id);
  }
  for (const collectionName of ENTITY_COLLECTIONS) {
    const collection = document[collectionName];
    if (!Array.isArray(collection)) continue;
    for (const entity of collection) {
      if (!isRecord(entity) || typeof entity.id !== "string") continue;
      if (ids.has(entity.id)) {
        issues.push(
          blockingIssue("DUPLICATE_STABLE_ID", "Stable ID должен быть уникальным во всём документе", {
            entityIds: [entity.id],
          }),
        );
      } else {
        ids.add(entity.id);
      }
    }
  }

  if (!Array.isArray(document.nodes) || !Array.isArray(document.walls)) {
    return { valid: false, issues };
  }

  const nodes = nodeMap(document);
  for (const wall of document.walls) {
    if (!nodes.has(wall.startNodeId) || !nodes.has(wall.endNodeId)) {
      issues.push(
        blockingIssue("MISSING_NODE", "Стена ссылается на отсутствующий узел", {
          entityIds: [wall.id],
        }),
      );
    }
    if (!(wall.thicknessMm > 0) || !(wall.heightMm > 0)) {
      shapeIssue(issues, "INVALID_WALL_DIMENSION", "Размеры стены должны быть положительными", `walls.${wall.id}`, wall.id);
    }
  }

  const walls = new Map(document.walls.map((wall) => [wall.id, wall]));
  for (const opening of Array.isArray(document.openings) ? document.openings : []) {
    const parent = walls.get(opening.parentWallId);
    if (!parent) {
      issues.push(
        blockingIssue("MISSING_OPENING_PARENT", "Проём ссылается на отсутствующую стену", {
          entityIds: [opening.id],
        }),
      );
      continue;
    }
    const length = wallLength(parent, nodes);
    if (
      length !== null &&
      (opening.offsetMm < 0 || opening.widthMm <= 0 || opening.offsetMm + opening.widthMm > length)
    ) {
      issues.push(
        blockingIssue("OPENING_OUTSIDE_WALL", "Проём выходит за физические границы родительской стены", {
          entityIds: [opening.id, parent.id],
        }),
      );
    }
  }

  const targetIds = new Set<string>([
    document.floor.id,
    ...document.walls.map(({ id }) => id),
    ...(Array.isArray(document.openings) ? document.openings.map(({ id }) => id) : []),
    ...(Array.isArray(document.columns) ? document.columns.map(({ id }) => id) : []),
    ...(Array.isArray(document.objects) ? document.objects.map(({ id }) => id) : []),
    ...(Array.isArray(document.clearanceZones) ? document.clearanceZones.map(({ id }) => id) : []),
  ]);
  const materialIds = new Set(
    (Array.isArray(document.materials) ? document.materials : []).map(({ id }) => id),
  );

  for (const [index, material] of (Array.isArray(document.materials) ? document.materials : []).entries()) {
    const path = `materials[${index}]`;
    if (!HEX_COLOR.test(material.baseColor)) {
      shapeIssue(issues, "INVALID_COLOR", "Цвет должен быть в формате #RRGGBB", `${path}.baseColor`, material.id);
    }
    if (!HEX_COLOR.test(material.emissive)) {
      shapeIssue(issues, "INVALID_COLOR", "Цвет должен быть в формате #RRGGBB", `${path}.emissive`, material.id);
    }
    if (!inRange(material.roughness, 0, 1)) {
      shapeIssue(issues, "INVALID_PBR_RANGE", "Roughness должен быть в диапазоне 0..1", `${path}.roughness`, material.id);
    }
    if (!inRange(material.metalness, 0, 1)) {
      shapeIssue(issues, "INVALID_PBR_RANGE", "Metalness должен быть в диапазоне 0..1", `${path}.metalness`, material.id);
    }
    if (!inRange(material.emissiveIntensity, 0, 100)) {
      shapeIssue(issues, "INVALID_PBR_RANGE", "Emissive intensity должен быть в диапазоне 0..100", `${path}.emissiveIntensity`, material.id);
    }
  }

  for (const assignment of Array.isArray(document.materialAssignments) ? document.materialAssignments : []) {
    if (!targetIds.has(assignment.targetId)) {
      issues.push(blockingIssue("MISSING_ASSIGNMENT_TARGET", "Назначение ссылается на отсутствующую цель", {
        entityIds: [assignment.id, assignment.targetId],
      }));
    }
    if (!materialIds.has(assignment.materialId)) {
      issues.push(blockingIssue("MISSING_ASSIGNED_MATERIAL", "Назначение ссылается на отсутствующий материал", {
        entityIds: [assignment.id, assignment.materialId],
      }));
    }
  }

  const lightKinds = new Set(["ambient", "directional", "point", "hemisphere"]);
  for (const [index, light] of (Array.isArray(document.lights) ? document.lights : []).entries()) {
    const path = `lights[${index}]`;
    if (!lightKinds.has(light.kind)) {
      shapeIssue(issues, "INVALID_LIGHT_KIND", "Тип источника света не поддерживается", `${path}.kind`, light.id);
    }
    if (!HEX_COLOR.test(light.color)) {
      shapeIssue(issues, "INVALID_COLOR", "Цвет должен быть в формате #RRGGBB", `${path}.color`, light.id);
    }
    if (light.groundColor !== undefined && !HEX_COLOR.test(light.groundColor)) {
      shapeIssue(issues, "INVALID_COLOR", "Цвет должен быть в формате #RRGGBB", `${path}.groundColor`, light.id);
    }
    if (!inRange(light.intensity, 0, 100_000)) {
      shapeIssue(issues, "INVALID_LIGHT_INTENSITY", "Интенсивность света должна быть в диапазоне 0..100000", `${path}.intensity`, light.id);
    }
    if (light.targetId !== undefined && !targetIds.has(light.targetId)) {
      issues.push(blockingIssue("MISSING_LIGHT_TARGET", "Источник света ссылается на отсутствующую цель", {
        entityIds: [light.id, light.targetId],
      }));
    }
  }

  return { valid: issues.every((issue) => issue.severity !== "blocking"), issues };
}
