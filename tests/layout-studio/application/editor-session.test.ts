import { describe, expect, it } from "vitest";

import { EditorSession } from "@/lib/layout-studio/application/editor-session";
import type { LayoutCommand } from "@/lib/layout-studio/domain";

import { makeSimpleRoom, moveTableCommand } from "./layout-test-fixture";

describe("LS-021: EditorSession", () => {
  it("dispatches a command, tracks selection, and supports undo/redo", () => {
    const initial = makeSimpleRoom();
    const session = new EditorSession(initial);

    session.select("object.simple-room.table");
    const dispatched = session.dispatch(moveTableCommand(initial));

    expect(dispatched.ok).toBe(true);
    expect(session.getState()).toMatchObject({
      document: {
        stateRevision: 4,
        objects: [expect.objectContaining({ id: "object.simple-room.table", xMm: 1100 })],
      },
      selection: "object.simple-room.table",
      dirty: true,
      canUndo: true,
      canRedo: false,
    });

    expect(session.undo().ok).toBe(true);
    expect(session.getState()).toMatchObject({
      document: {
        stateRevision: 3,
        objects: [expect.objectContaining({ id: "object.simple-room.table", xMm: 1000 })],
      },
      selection: "object.simple-room.table",
      canUndo: false,
      canRedo: true,
    });

    expect(session.redo().ok).toBe(true);
    expect(session.getState().document.objects[0]).toMatchObject({ xMm: 1100 });
    expect(session.getState().document.stateRevision).toBe(4);
  });

  it("preserves the last valid state on a stale command and clears redo after a new edit", () => {
    const initial = makeSimpleRoom();
    const session = new EditorSession(initial);

    session.dispatch(moveTableCommand(initial));
    session.undo();
    const stale = {
      ...moveTableCommand(initial, 1200),
      expectedStateRevision: 2,
    } as LayoutCommand;
    const rejected = session.dispatch(stale);

    expect(rejected.ok).toBe(false);
    expect(rejected.issues).toContainEqual(expect.objectContaining({ code: "STATE_STALE" }));
    expect(session.getState().document).toEqual(initial);
    expect(session.getState().canRedo).toBe(true);

    const accepted = session.dispatch(moveTableCommand(initial, 1300));

    expect(accepted.ok).toBe(true);
    expect(session.getState().canRedo).toBe(false);
  });
});
