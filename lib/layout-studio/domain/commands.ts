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
  }

  next.stateRevision = document.stateRevision + 1;
  const validation = validateLayoutDocument(next);
  if (!validation.valid) return { ok: false, document, issues: validation.issues };
  return { ok: true, document: next, issues: [] };
}
