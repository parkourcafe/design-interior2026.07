import {
  blockingIssue,
  ENTITY_COLLECTIONS,
  isRecord,
  nodeMap,
  visitValues,
  wallLength,
} from "./shared";
import type { LayoutDocument, LayoutIssue, LayoutValidationResult } from "./types";

export function validateLayoutDocument(document: LayoutDocument): LayoutValidationResult {
  const issues: LayoutIssue[] = [];

  if (!isRecord(document)) {
    return {
      valid: false,
      issues: [blockingIssue("INVALID_DOCUMENT", "Документ планировки должен быть объектом")],
    };
  }

  if (document.canonicalUnits !== "mm") {
    issues.push(
      blockingIssue("INVALID_CANONICAL_UNITS", "Канонические единицы документа должны быть mm", {
        path: "canonicalUnits",
      }),
    );
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
  for (const collectionName of ENTITY_COLLECTIONS) {
    const collection = document[collectionName];
    if (!Array.isArray(collection)) {
      issues.push(
        blockingIssue("INVALID_ENTITY_COLLECTION", `Коллекция ${collectionName} должна быть массивом`, {
          path: collectionName,
        }),
      );
      continue;
    }
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

  const nodes = nodeMap(document);
  for (const wall of document.walls) {
    if (!nodes.has(wall.startNodeId) || !nodes.has(wall.endNodeId)) {
      issues.push(
        blockingIssue("MISSING_NODE", "Стена ссылается на отсутствующий узел", {
          entityIds: [wall.id],
        }),
      );
    }
  }

  const walls = new Map(document.walls.map((wall) => [wall.id, wall]));
  for (const opening of document.openings) {
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

  return { valid: issues.every((issue) => issue.severity !== "blocking"), issues };
}
