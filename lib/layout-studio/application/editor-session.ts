import { applyLayoutCommand, CommandLedger, type CommandResult, type LayoutCommand, type LayoutDocument, validateLayoutDocument } from "../domain";

export interface EditorState { document: LayoutDocument; selectionId?: string; activeView: "2d" | "3d"; dirty: boolean; issues: ReturnType<typeof validateLayoutDocument>["issues"]; canUndo: boolean; canRedo: boolean }

export class EditorSession {
  private document: LayoutDocument;
  private undoStack: LayoutDocument[] = [];
  private redoStack: LayoutDocument[] = [];
  private readonly ledger = new CommandLedger();
  private selectionId?: string;
  private activeView: "2d" | "3d" = "2d";
  private dirty = false;

  constructor(document: LayoutDocument) { this.document = structuredClone(document); }
  snapshot(): EditorState { return { document: structuredClone(this.document), selectionId: this.selectionId, activeView: this.activeView, dirty: this.dirty, issues: validateLayoutDocument(this.document).issues, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 }; }
  select(id?: string) { this.selectionId = id; }
  setView(view: "2d" | "3d") { this.activeView = view; }
  markSaved() { this.dirty = false; }
  replace(document: LayoutDocument) { this.document = structuredClone(document); this.undoStack = []; this.redoStack = []; this.dirty = false; }
  dispatch(command: LayoutCommand): CommandResult {
    const before = structuredClone(this.document); const result = applyLayoutCommand(this.document, command, this.ledger);
    if (result.ok && !result.replayed) { this.undoStack.push(before); this.redoStack = []; this.document = result.document; this.dirty = true; }
    return result;
  }
  undo(): LayoutDocument | null {
    const previous = this.undoStack.pop(); if (!previous) return null;
    this.redoStack.push(structuredClone(this.document)); this.document = { ...structuredClone(previous), stateRevision: this.document.stateRevision + 1 }; this.dirty = true; return structuredClone(this.document);
  }
  redo(): LayoutDocument | null {
    const next = this.redoStack.pop(); if (!next) return null;
    this.undoStack.push(structuredClone(this.document)); this.document = { ...structuredClone(next), stateRevision: this.document.stateRevision + 1 }; this.dirty = true; return structuredClone(this.document);
  }
}
