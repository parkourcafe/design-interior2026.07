import type { CommandResult, LayoutCommand, LayoutDocument, PlacedObject } from "./types";
import { canonicalJson } from "./canonical";
import { validateLayoutDocument } from "./validate";

interface LedgerEntry { fingerprint: string; result: CommandResult }
export class CommandLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  get(key: string) { return this.entries.get(key); }
  set(key: string, value: LedgerEntry) { this.entries.set(key, value); }
}

const fail = (document: LayoutDocument, code: "STATE_STALE" | "LOCKED" | "INVALID_COMMAND" | "VALIDATION_FAILED" | "IDEMPOTENCY_CONFLICT", message: string, issues = []): CommandResult => ({ ok: false, code, message, document, issues });
const entity = <T extends { id: string }>(items: T[], id: unknown) => items.find((item) => item.id === id);
const allowedObjectPatch = (payload: Record<string, unknown>) => Object.fromEntries(Object.entries(payload).filter(([key]) => ["xMm", "yMm", "zMm", "widthMm", "depthMm", "heightMm", "rotationDeg", "label", "notes", "catalogKey"].includes(key)));

export function applyLayoutCommand(document: LayoutDocument, command: LayoutCommand, ledger = new CommandLedger()): CommandResult {
  const fingerprint = JSON.stringify({ ...command, idempotencyKey: undefined });
  const previous = ledger.get(command.idempotencyKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint) return fail(document, "IDEMPOTENCY_CONFLICT", "Idempotency key was reused with different command content");
    return previous.result.ok ? { ...previous.result, replayed: true } : previous.result;
  }
  if (command.documentId !== document.documentId) return fail(document, "INVALID_COMMAND", "Command targets another document");
  if (command.expectedStateRevision !== document.stateRevision) return fail(document, "STATE_STALE", "Expected revision does not match current revision");
  const next = structuredClone(document);
  const p = command.payload;
  const id = p.id;

  switch (command.type) {
    case "MOVE_NODE": { const item = entity(next.nodes, id); if (!item) return fail(document, "INVALID_COMMAND", "Node not found"); if (item.locked) return fail(document, "LOCKED", "Node is locked"); item.xMm = Number(p.xMm); item.yMm = Number(p.yMm); break; }
    case "UPDATE_WALL": { const item = entity(next.walls, id); if (!item) return fail(document, "INVALID_COMMAND", "Wall not found"); if (item.locked) return fail(document, "LOCKED", "Wall is locked"); Object.assign(item, p.patch); break; }
    case "UPDATE_OPENING": { const item = entity(next.openings, id); if (!item) return fail(document, "INVALID_COMMAND", "Opening not found"); if (item.locked) return fail(document, "LOCKED", "Opening is locked"); Object.assign(item, p.patch); break; }
    case "UPDATE_COLUMN": { const item = entity(next.columns, id); if (!item) return fail(document, "INVALID_COMMAND", "Column not found"); if (item.locked) return fail(document, "LOCKED", "Column is locked"); Object.assign(item, p.patch); break; }
    case "MOVE_OBJECT": { const item = entity(next.objects, id); if (!item) return fail(document, "INVALID_COMMAND", "Object not found"); if (item.locked) return fail(document, "LOCKED", "Object is locked"); Object.assign(item, allowedObjectPatch(p)); break; }
    case "UPDATE_OBJECT": { const item = entity(next.objects, id); if (!item) return fail(document, "INVALID_COMMAND", "Object not found"); if (item.locked) return fail(document, "LOCKED", "Object is locked"); Object.assign(item, allowedObjectPatch((p.patch ?? {}) as Record<string, unknown>)); break; }
    case "CREATE_OBJECT": { const item = p.object as PlacedObject | undefined; if (!item || item.locked || !["decor", "equipment"].includes(item.kind)) return fail(document, "INVALID_COMMAND", "Only non-locked decor/equipment may be created"); next.objects.push(item); break; }
    case "DELETE_OBJECT": { const index = next.objects.findIndex((item) => item.id === id); if (index < 0) return fail(document, "INVALID_COMMAND", "Object not found"); if (next.objects[index].locked || !["decor", "equipment"].includes(next.objects[index].kind)) return fail(document, "LOCKED", "Object cannot be deleted"); next.objects.splice(index, 1); break; }
    case "ASSIGN_MATERIAL": { const item = entity(next.materialAssignments, id); if (!item) return fail(document, "INVALID_COMMAND", "Assignment not found"); item.materialId = String(p.materialId); break; }
    case "UPDATE_LIGHT": { const item = entity(next.lights, id); if (!item) return fail(document, "INVALID_COMMAND", "Light not found"); Object.assign(item, p.patch); break; }
    case "RESTORE_CHECKPOINT": { const content = p.document as LayoutDocument | undefined; if (!content || content.documentId !== document.documentId) return fail(document, "INVALID_COMMAND", "Checkpoint document is invalid"); Object.assign(next, structuredClone(content)); break; }
    default: return fail(document, "INVALID_COMMAND", "Unsupported command type");
  }
  next.stateRevision = document.stateRevision + 1;
  const validation = validateLayoutDocument(next);
  const result: CommandResult = validation.valid ? { ok: true, document: next, issues: validation.issues, replayed: false } : fail(document, "VALIDATION_FAILED", "Command would make the document invalid", validation.issues);
  ledger.set(command.idempotencyKey, { fingerprint, result: structuredClone(result) });
  return result;
}

export function commandFingerprint(document: LayoutDocument) { return canonicalJson(document); }
