import { describe, expect, it } from "vitest";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { sampleProject } from "./sampleProject";
import { commitEditorSessionChange, reconcileEditorSessionComposition, restoreEditorSessionHistory, transitionEditorSession } from "./editorSession";
import { createEditorSessionHistory } from "./editorSessionHistory";
import type { EditorSessionSnapshot } from "./editorSessionHistory";

function makeSession(): EditorSessionSnapshot {
  const project = structuredClone(sampleProject);
  const composition = migrateLegacyProjectToComposition(project).rootComposition;
  return { project: projectRootCompositionToLegacy(project, composition), composition };
}

describe("Editor session transition boundary", () => {
  it("applies compatibility metadata without letting migrated timing overwrite existing canonical placement geometry", () => {
    const current = makeSession();
    const existing = current.composition.placements[0];
    expect(existing).toBeDefined();

    const target = structuredClone(current.composition);
    const desired = target.placements.find(item => item.id === existing.id)!;
    desired.name = "Renamed placement";
    desired.start += 4;
    desired.duration += 2;
    desired.sourceIn = (existing.sourceIn ?? 0) + 1;
    desired.sourceOut = (existing.sourceOut ?? existing.duration) + 1;

    const next = reconcileEditorSessionComposition(current.composition, target);
    const actual = next.placements.find(item => item.id === existing.id)!;

    expect(actual.name).toBe("Renamed placement");
    expect(actual.start).toBe(existing.start);
    expect(actual.duration).toBe(existing.duration);
    expect(actual.trackId).toBe(existing.trackId);
    expect(actual.sourceIn).toBe(existing.sourceIn);
    expect(actual.sourceOut).toBe(existing.sourceOut);
    expect(current.composition.placements[0]).toEqual(existing);
  });

  it("reconciles a legacy-domain edit into a paired session and preserves canonical placement timing", () => {
    const current = makeSession();
    const nextProject = structuredClone(current.project);
    const shot = nextProject.shots[0];
    expect(shot).toBeDefined();
    const canonicalPlacement = current.composition.placements.find(item => item.id === shot.id)!;
    shot.title = "Renamed from Storyboard";
    shot.masterStart = (shot.masterStart ?? canonicalPlacement.start) + 8;

    const next = commitEditorSessionChange(current, nextProject);
    const placement = next.composition.placements.find(item => item.id === shot.id)!;

    expect(placement.name).toBe("Renamed from Storyboard");
    expect(placement.start).toBe(canonicalPlacement.start);
    expect(next.project.shots.find(item => item.id === shot.id)?.title).toBe("Renamed from Storyboard");
    expect(current.project.shots.find(item => item.id === shot.id)?.title).not.toBe("Renamed from Storyboard");
  });

  it("commits an explicit canonical root and its Project projection as one immutable session", () => {
    const current = makeSession();
    const nextProject = structuredClone(current.project);
    nextProject.width = 1920;
    nextProject.height = 1080;
    nextProject.name = "Edited project";
    const nextComposition = structuredClone(current.composition);
    nextComposition.width = 1920;
    nextComposition.height = 1080;
    nextComposition.name = "Edited project";

    const next = commitEditorSessionChange(current, nextProject, nextComposition);

    expect(next.project.width).toBe(1920);
    expect(next.project.height).toBe(1080);
    expect(next.project.name).toBe("Edited project");
    expect(next.composition.width).toBe(1920);
    expect(next.composition.height).toBe(1080);
    expect(current.project.width).not.toBe(1920);
    expect(current.composition.width).not.toBe(1920);
  });
});


describe("Editor session transaction", () => {
  it("returns the next paired session and matching pre-edit history without mutating the current session", () => {
    const current = makeSession();
    const history = createEditorSessionHistory();

    const transition = transitionEditorSession(
      current,
      history,
      project => ({ ...project, name: "Atomic transaction" }),
      "rename",
      undefined,
      Date.parse("2026-10-22T12:34:56.000Z"),
    );

    expect(transition.session.project.name).toBe("Atomic transaction");
    expect(transition.session.composition.name).toBe("Atomic transaction — Master Timeline");
    expect(transition.session.project.updatedAt).toBe("2026-10-22T12:34:56.000Z");
    expect(transition.history.undo).toHaveLength(1);
    expect(transition.history.undo[0]).toEqual(current);
    expect(transition.history.redo).toEqual([]);
    expect(current.project.name).not.toBe("Atomic transaction");
    expect(current.composition.name).not.toBe("Atomic transaction");
  });
});


describe("Editor session history restoration", () => {
  it("restores undo and redo as complete sessions with a fresh compatibility revision", () => {
    const before = makeSession();
    const edited = transitionEditorSession(
      before,
      createEditorSessionHistory(),
      project => ({ ...project, name: "After edit" }),
      "rename",
      undefined,
      Date.parse("2026-10-22T12:34:56.000Z"),
    );
    const undo = restoreEditorSessionHistory(
      edited.session,
      edited.history,
      "undo",
      Date.parse("2026-10-22T12:35:00.000Z"),
    );

    expect(undo.session?.project.name).toBe(before.project.name);
    expect(undo.session?.composition.name).toBe(before.composition.name);
    expect(undo.session?.project.updatedAt).toBe("2026-10-22T12:35:00.000Z");
    expect(undo.history.redo).toHaveLength(1);

    const redo = restoreEditorSessionHistory(
      undo.session!,
      undo.history,
      "redo",
      Date.parse("2026-10-22T12:35:01.000Z"),
    );
    expect(redo.session?.project.name).toBe("After edit");
    expect(redo.session?.composition.name).toBe("After edit — Master Timeline");
    expect(redo.session?.project.updatedAt).toBe("2026-10-22T12:35:01.000Z");
    expect(redo.history.redo).toHaveLength(0);
  });
});
