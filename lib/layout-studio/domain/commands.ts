import { blockingIssue } from "./shared";
import type {
  ApplyLayoutCommandResult,
  LayoutCommand,
  LayoutDocument,
  LayoutIssue,
} from "./types";
import { validateLayoutDocument } from "./validate";

function failedCommand(
  document: LayoutDocument,
  issue: LayoutIssue,
): ApplyLayoutCommandResult {
  return { ok: false, document, issues: [issue] };
}

type MutationOutcome = { ok: true } | { ok: false; issue: LayoutIssue };

/** Все идентификаторы документа: новый не должен совпасть ни с одним из них. */
function everyId(document: LayoutDocument): Set<string> {
  return new Set<string>([
    ...document.nodes.map((entity) => entity.id),
    ...document.walls.map((entity) => entity.id),
    ...document.openings.map((entity) => entity.id),
    ...document.columns.map((entity) => entity.id),
    ...document.objects.map((entity) => entity.id),
    ...document.clearanceZones.map((entity) => entity.id),
    ...document.materials.map((entity) => entity.id),
    ...document.lights.map((entity) => entity.id),
  ]);
}

/**
 * Добавление сущности.
 *
 * Проверяется ровно одно, чего не поймает общая валидация: уникальность
 * идентификатора среди ВСЕХ сущностей, а не только внутри своего массива.
 * Всё остальное — висящие ссылки, проём за пределами стены, нулевая длина —
 * ловится единым `validateLayoutDocument` в конце applyLayoutCommand, и
 * дублировать это здесь значило бы завести второй свод правил.
 *
 * Новые сущности всегда `locked: false`: блокировка означает «подтверждено
 * обмером», а только что нарисованное подтверждённым быть не может.
 */
function addEntity(
  document: LayoutDocument,
  command: Extract<
    LayoutCommand,
    { type: "ADD_NODE" | "ADD_WALL" | "ADD_OPENING" | "ADD_COLUMN" | "ADD_OBJECT" }
  >,
): MutationOutcome {
  const payload = command.payload as Record<string, unknown>;
  const id = String(
    payload.nodeId ?? payload.wallId ?? payload.openingId ?? payload.columnId ?? payload.objectId,
  );

  if (everyId(document).has(id)) {
    return {
      ok: false,
      issue: blockingIssue("DUPLICATE_ENTITY_ID", "Сущность с таким id уже существует", {
        entityIds: [id],
      }),
    };
  }

  switch (command.type) {
    case "ADD_NODE": {
      const { nodeId, xMm, yMm } = command.payload;
      document.nodes.push({ id: nodeId, xMm, yMm, locked: false });
      return { ok: true };
    }
    case "ADD_WALL": {
      const p = command.payload;
      document.walls.push({
        id: p.wallId,
        startNodeId: p.startNodeId,
        endNodeId: p.endNodeId,
        thicknessMm: p.thicknessMm,
        heightMm: p.heightMm,
        kind: p.kind ?? "partition",
        locked: false,
        label: p.label ?? "Стена",
      });
      return { ok: true };
    }
    case "ADD_OPENING": {
      const p = command.payload;
      document.openings.push({
        id: p.openingId,
        parentWallId: p.parentWallId,
        kind: p.kind,
        offsetMm: p.offsetMm,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        sillMm: p.sillMm,
        handing: p.handing ?? "none",
        locked: false,
        label: p.label ?? "Проём",
      });
      return { ok: true };
    }
    case "ADD_COLUMN": {
      const p = command.payload;
      document.columns.push({
        id: p.columnId,
        xMm: p.xMm,
        yMm: p.yMm,
        widthMm: p.widthMm,
        depthMm: p.depthMm,
        baseZMm: p.baseZMm,
        heightMm: p.heightMm,
        rotationDeg: p.rotationDeg ?? 0,
        locked: false,
        label: p.label ?? "Колонна",
      });
      return { ok: true };
    }
    case "ADD_OBJECT": {
      const p = command.payload;
      document.objects.push({
        id: p.objectId,
        kind: p.kind,
        ...(p.catalogKey ? { catalogKey: p.catalogKey } : {}),
        xMm: p.xMm,
        yMm: p.yMm,
        zMm: p.zMm,
        widthMm: p.widthMm,
        depthMm: p.depthMm,
        heightMm: p.heightMm,
        rotationDeg: p.rotationDeg ?? 0,
        locked: false,
        label: p.label ?? "Объект",
      });
      return { ok: true };
    }
  }
}

/** Что осиротеет, если убрать эту сущность. */
function dependentsOf(document: LayoutDocument, entityId: string): string[] {
  return [
    // Стена опирается на узлы; проём живёт на стене.
    ...document.walls
      .filter((wall) => wall.startNodeId === entityId || wall.endNodeId === entityId)
      .map((wall) => wall.id),
    ...document.openings
      .filter((opening) => opening.parentWallId === entityId)
      .map((opening) => opening.id),
  ];
}

/**
 * Удаление сущности любого вида.
 *
 * Заблокированное не удаляется — иначе блокировка защищала бы от правки, но не
 * от исчезновения, что бессмысленно.
 *
 * Зависимости не удаляются молча. Убрать стену, на которой висят окна, можно
 * только явным cascade: тихое каскадное удаление превращает «убрал стену» в
 * «потерял три окна», и заметить это можно уже после публикации версии.
 */
function deleteEntity(
  document: LayoutDocument,
  entityId: string,
  cascade: boolean,
): MutationOutcome {
  // Удаление одинаково для всех видов сущностей, поэтому массивы приводятся к
  // общему минимуму: идентификатор и признак блокировки. Собственные поля
  // здесь не нужны — их целостность проверит валидация документа.
  type Removable = { id: string; locked?: boolean };
  const buckets: Removable[][] = [
    document.nodes,
    document.walls,
    document.openings,
    document.columns,
    document.objects,
  ];

  const bucket = buckets.find((items) => items.some((item) => item.id === entityId));
  if (!bucket) {
    return {
      ok: false,
      issue: blockingIssue("ENTITY_NOT_FOUND", "Удаляемая сущность не найдена", {
        entityIds: [entityId],
      }),
    };
  }

  const entity = bucket.find((item) => item.id === entityId)!;
  if (entity.locked === true) {
    return {
      ok: false,
      issue: blockingIssue("ENTITY_LOCKED", "Заблокированную сущность нельзя удалить", {
        entityIds: [entityId],
      }),
    };
  }

  const dependents = dependentsOf(document, entityId);
  if (dependents.length > 0 && !cascade) {
    return {
      ok: false,
      issue: blockingIssue(
        "ENTITY_HAS_DEPENDENTS",
        "Сначала удалите зависимые элементы или подтвердите каскадное удаление",
        { entityIds: [entityId, ...dependents] },
      ),
    };
  }

  // Каскад разворачивается вглубь: узел → его стены → проёмы этих стен.
  const doomed = new Set<string>([entityId]);
  const queue = cascade ? [...dependents] : [];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (doomed.has(next)) continue;
    doomed.add(next);
    queue.push(...dependentsOf(document, next));
  }

  const locked = buckets
    .flatMap((items) => items)
    .filter((item) => doomed.has(item.id) && item.locked === true);
  if (locked.length > 0) {
    return {
      ok: false,
      issue: blockingIssue(
        "ENTITY_LOCKED",
        "Каскад затрагивает заблокированный элемент",
        { entityIds: locked.map((item) => item.id) },
      ),
    };
  }

  for (const items of buckets) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (doomed.has(items[index]!.id)) items.splice(index, 1);
    }
  }

  // Всё, что ссылается на удалённое, вычищается вместе — иначе документ не
  // пройдёт валидацию и вся команда откатится, хотя дизайнер сделал
  // осмысленное действие. Это касается назначений материалов, света,
  // наведённого на удалённый объект (светильники не удаляются никакой
  // командой, и объект под таким светом стал бы неудаляемым навсегда), и
  // ссылок зон прохода на связанные объекты.
  document.materialAssignments = document.materialAssignments.filter(
    (assignment) => !doomed.has(assignment.targetId),
  );
  document.lights = document.lights.filter(
    (light) => light.targetId === undefined || !doomed.has(light.targetId),
  );
  for (const zone of document.clearanceZones) {
    if (Array.isArray(zone.relatedObjectIds)) {
      zone.relatedObjectIds = zone.relatedObjectIds.filter((id) => !doomed.has(id));
    }
  }

  return { ok: true };
}

export function applyLayoutCommand(
  document: LayoutDocument,
  command: LayoutCommand,
): ApplyLayoutCommandResult {
  if (command.documentId !== document.documentId) {
    return failedCommand(
      document,
      blockingIssue("DOCUMENT_MISMATCH", "Команда адресована другому документу", {
        entityIds: [command.documentId, document.documentId],
      }),
    );
  }
  if (command.expectedStateRevision !== document.stateRevision) {
    return failedCommand(
      document,
      blockingIssue("STATE_STALE", "Команда основана на устаревшей ревизии документа"),
    );
  }

  const next = structuredClone(document);

  if (command.type === "MOVE_OBJECT") {
    const object = next.objects.find((candidate) => candidate.id === command.payload.objectId);
    if (!object) {
      return failedCommand(
        document,
        blockingIssue("ENTITY_NOT_FOUND", "Объект команды не найден", {
          entityIds: [command.payload.objectId],
        }),
      );
    }
    if (object.locked) {
      return failedCommand(
        document,
        blockingIssue("ENTITY_LOCKED", "Заблокированный объект нельзя изменить", {
          entityIds: [object.id],
        }),
      );
    }
    if (command.payload.xMm !== undefined) object.xMm = command.payload.xMm;
    if (command.payload.yMm !== undefined) object.yMm = command.payload.yMm;
    if (command.payload.zMm !== undefined) object.zMm = command.payload.zMm;
  } else if (command.type === "UPDATE_OBJECT") {
    const object = next.objects.find((candidate) => candidate.id === command.payload.objectId);
    if (!object) {
      return failedCommand(document, blockingIssue("ENTITY_NOT_FOUND", "Объект команды не найден", {
        entityIds: [command.payload.objectId],
      }));
    }
    if (object.locked) {
      return failedCommand(document, blockingIssue("ENTITY_LOCKED", "Заблокированный объект нельзя изменить", {
        entityIds: [object.id],
      }));
    }
    const updates = command.payload;
    if (updates.xMm !== undefined) object.xMm = updates.xMm;
    if (updates.yMm !== undefined) object.yMm = updates.yMm;
    if (updates.zMm !== undefined) object.zMm = updates.zMm;
    if (updates.widthMm !== undefined) object.widthMm = updates.widthMm;
    if (updates.depthMm !== undefined) object.depthMm = updates.depthMm;
    if (updates.heightMm !== undefined) object.heightMm = updates.heightMm;
    if (updates.rotationDeg !== undefined) {
      object.rotationDeg = updates.rotationDeg as typeof object.rotationDeg;
    }
  } else if (command.type === "UPDATE_OPENING") {
    const opening = next.openings.find((candidate) => candidate.id === command.payload.openingId);
    if (!opening) {
      return failedCommand(document, blockingIssue("ENTITY_NOT_FOUND", "Проём команды не найден", {
        entityIds: [command.payload.openingId],
      }));
    }
    if (opening.locked) {
      return failedCommand(document, blockingIssue("ENTITY_LOCKED", "Заблокированный проём нельзя изменить", {
        entityIds: [opening.id],
      }));
    }
    const updates = command.payload;
    if (updates.offsetMm !== undefined) opening.offsetMm = updates.offsetMm;
    if (updates.widthMm !== undefined) opening.widthMm = updates.widthMm;
    if (updates.heightMm !== undefined) opening.heightMm = updates.heightMm;
    if (updates.sillMm !== undefined) opening.sillMm = updates.sillMm;
    if (updates.handing !== undefined) {
      opening.handing = updates.handing as typeof opening.handing;
    }
  } else if (command.type === "UPDATE_COLUMN") {
    const column = next.columns.find((candidate) => candidate.id === command.payload.columnId);
    if (!column) {
      return failedCommand(
        document,
        blockingIssue("ENTITY_NOT_FOUND", "Колонна команды не найдена", {
          entityIds: [command.payload.columnId],
        }),
      );
    }
    if (column.locked) {
      return failedCommand(
        document,
        blockingIssue("ENTITY_LOCKED", "Заблокированную колонну нельзя изменить", {
          entityIds: [column.id],
        }),
      );
    }
    const updates = command.payload;
    if (updates.xMm !== undefined) column.xMm = updates.xMm;
    if (updates.yMm !== undefined) column.yMm = updates.yMm;
    if (updates.widthMm !== undefined) column.widthMm = updates.widthMm;
    if (updates.depthMm !== undefined) column.depthMm = updates.depthMm;
    if (updates.baseZMm !== undefined) column.baseZMm = updates.baseZMm;
    if (updates.heightMm !== undefined) column.heightMm = updates.heightMm;
    if (updates.rotationDeg !== undefined) {
      column.rotationDeg = updates.rotationDeg as typeof column.rotationDeg;
    }
  } else if (command.type === "ASSIGN_MATERIAL") {
    const assignment = next.materialAssignments.find(
      (candidate) => candidate.id === command.payload.assignmentId,
    );
    if (!assignment) {
      return failedCommand(
        document,
        blockingIssue("ENTITY_NOT_FOUND", "Назначение материала команды не найдено", {
          entityIds: [command.payload.assignmentId],
        }),
      );
    }
    if (!next.materials.some((material) => material.id === command.payload.materialId)) {
      return failedCommand(
        document,
        blockingIssue("MATERIAL_NOT_FOUND", "Материал команды не найден", {
          entityIds: [command.payload.materialId],
        }),
      );
    }
    assignment.materialId = command.payload.materialId;
  } else if (
    command.type === "ADD_NODE" ||
    command.type === "ADD_WALL" ||
    command.type === "ADD_OPENING" ||
    command.type === "ADD_COLUMN" ||
    command.type === "ADD_OBJECT"
  ) {
    const added = addEntity(next, command);
    if (!added.ok) return failedCommand(document, added.issue);
  } else if (command.type === "DELETE_ENTITY") {
    const removed = deleteEntity(next, command.payload.entityId, command.payload.cascade === true);
    if (!removed.ok) return failedCommand(document, removed.issue);
  }

  next.stateRevision = document.stateRevision + 1;
  const validation = validateLayoutDocument(next);
  if (!validation.valid) return { ok: false, document, issues: validation.issues };
  return { ok: true, document: next, issues: [] };
}
