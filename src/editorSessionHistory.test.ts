import { describe, expect, it } from "vitest";
import { migrateLegacyProjectToComposition } from "./compositionMigration";
import { sampleProject } from "./sampleProject";
import {
  createEditorSessionHistory,
  recordEditorSessionChange,
  redoEditorSessionChange,
  undoEditorSessionChange,
  type EditorSessionSnapshot,
} from "./editorSessionHistory";

function makeSnapshot(name: string): EditorSessionSnapshot {
  const project = structuredClone(sampleProject);
  project.name = name;
  const composition = {
    ...migrateLegacyProjectToComposition(project).rootComposition,
    name,
  };
  return { project, composition };
}

describe("atomic Editor session history", () => {
  it("undoes and redoes the project projection and canonical Composition as one snapshot", () => {
    const before = makeSnapshot("Before edit");
    const after = makeSnapshot("After edit");
    const recorded = recordEditorSessionChange(createEditorSessionHistory(), before, "", 1000);

    const undone = undoEditorSessionChange(recorded, after);
    expect(undone.snapshot?.project.name).toBe("Before edit");
    expect(undone.snapshot?.composition.name).toBe("Before edit");

    const redoCurrent = undone.snapshot;
    expect(redoCurrent).toBeDefined();
    if (!redoCurrent) throw new Error("Undo should return a complete editor snapshot.");
    const redone = redoEditorSessionChange(undone.history, redoCurrent);
    expect(redone.snapshot?.project.name).toBe("After edit");
    expect(redone.snapshot?.composition.name).toBe("After edit");
  });

  it("coalesces rapid edits in one history group and clears redo on a new edit", () => {
    const before = makeSnapshot("Before");
    const afterFirstEdit = makeSnapshot("First edit");
    const afterSecondEdit = makeSnapshot("Second edit");
    const history = recordEditorSessionChange(createEditorSessionHistory(), before, "rename", 1000);
    const coalesced = recordEditorSessionChange(history, afterFirstEdit, "rename", 1500);

    expect(coalesced.undo).toHaveLength(1);
    expect(coalesced.undo[0].project.name).toBe("Before");
    expect(coalesced.undo[0].composition.name).toBe("Before");

    const undone = undoEditorSessionChange(coalesced, afterSecondEdit);
    expect(undone.history.redo).toHaveLength(1);
    const newEdit = recordEditorSessionChange(undone.history, afterFirstEdit, "move", 2500);
    expect(newEdit.redo).toHaveLength(0);
    expect(newEdit.undo).toHaveLength(1);
  });

  it("keeps the history within its configured limit and safely ignores empty undo/redo", () => {
    const first = makeSnapshot("First");
    const second = makeSnapshot("Second");
    const third = makeSnapshot("Third");
    const history = recordEditorSessionChange(createEditorSessionHistory(), first, "", 1000, 2);
    const next = recordEditorSessionChange(history, second, "", 2000, 2);
    const bounded = recordEditorSessionChange(next, third, "", 3000, 2);

    expect(bounded.undo).toHaveLength(2);
    expect(bounded.undo.map(snapshot => snapshot.project.name)).toEqual(["Second", "Third"]);
    expect(undoEditorSessionChange(createEditorSessionHistory(), first).snapshot).toBeUndefined();
    expect(redoEditorSessionChange(createEditorSessionHistory(), first).snapshot).toBeUndefined();
  });
});
