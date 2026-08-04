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
    if (updates.rotationDeg !== undefined) object.rotationDeg = updates.rotationDeg;
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
    if (updates.handing !== undefined) opening.handing = updates.handing;
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
    if (updates.rotationDeg !== undefined) column.rotationDeg = updates.rotationDeg;
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
  }

  next.stateRevision = document.stateRevision + 1;
  const validation = validateLayoutDocument(next);
  if (!validation.valid) return { ok: false, document, issues: validation.issues };
  return { ok: true, document: next, issues: [] };
}
