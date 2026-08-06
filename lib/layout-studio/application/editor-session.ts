import {
  applyLayoutCommand,
  type ApplyLayoutCommandResult,
  type LayoutCommand,
  type LayoutDocument,
  type LayoutIssue,
} from "@/lib/layout-studio/domain";

export interface EditorSessionState {
  document: LayoutDocument;
  selection: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

function cloneDocument(document: LayoutDocument): LayoutDocument {
  return structuredClone(document);
}

function historyResult(document: LayoutDocument, issue?: LayoutIssue): ApplyLayoutCommandResult {
  return {
    ok: issue === undefined,
    document: cloneDocument(document),
    issues: issue ? [issue] : [],
  };
}

export class EditorSession {
  private document: LayoutDocument;
  private selection: string | null = null;
  private dirty = false;
  private readonly undoStack: LayoutDocument[] = [];
  private readonly redoStack: LayoutDocument[] = [];
  private readonly commandLedger = new Map<string, { fingerprint: string; document: LayoutDocument }>();

  constructor(initialDocument: LayoutDocument) {
    this.document = cloneDocument(initialDocument);
  }

  select(entityId: string | null): void {
    this.selection = entityId;
  }

  dispatch(command: LayoutCommand): ApplyLayoutCommandResult {
    const fingerprint = JSON.stringify(command);
    const recorded = this.commandLedger.get(command.idempotencyKey);
    if (recorded) {
      if (recorded.fingerprint !== fingerprint) {
        return historyResult(this.document, {
          code: "IDEMPOTENCY_CONFLICT",
          severity: "blocking",
          message: "Ключ идемпотентности уже использован другой командой",
        });
      }
      return historyResult(recorded.document);
    }
    const result = applyLayoutCommand(this.document, command);
    if (!result.ok) {
      return {
        ...result,
        document: cloneDocument(result.document),
        issues: structuredClone(result.issues),
      };
    }

    this.undoStack.push(cloneDocument(this.document));
    this.document = cloneDocument(result.document);
    this.redoStack.length = 0;
    this.dirty = true;
    this.commandLedger.set(command.idempotencyKey, {
      fingerprint,
      document: cloneDocument(this.document),
    });
    return historyResult(this.document);
  }

  undo(): ApplyLayoutCommandResult {
    const previous = this.undoStack.pop();
    if (!previous) {
      return historyResult(this.document, {
        code: "UNDO_EMPTY",
        severity: "blocking",
        message: "Нет изменений для отмены",
      });
    }

    this.redoStack.push(cloneDocument(this.document));
    const revision = this.document.stateRevision + 1;
    this.document = cloneDocument(previous);
    this.document.stateRevision = revision;
    this.dirty = this.undoStack.length > 0;
    return historyResult(this.document);
  }

  redo(): ApplyLayoutCommandResult {
    const next = this.redoStack.pop();
    if (!next) {
      return historyResult(this.document, {
        code: "REDO_EMPTY",
        severity: "blocking",
        message: "Нет изменений для повтора",
      });
    }

    this.undoStack.push(cloneDocument(this.document));
    const revision = this.document.stateRevision + 1;
    this.document = cloneDocument(next);
    this.document.stateRevision = revision;
    this.dirty = this.undoStack.length > 0;
    return historyResult(this.document);
  }

  getState(): EditorSessionState {
    return {
      document: cloneDocument(this.document),
      selection: this.selection,
      dirty: this.dirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }
}
