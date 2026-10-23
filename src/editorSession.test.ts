import { describe, expect, it } from "vitest";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { moveCompositionPlacement } from "./compositionCommands";
import { createProjectDocument, readProjectDocument } from "./projectDocument";
import { sampleProject } from "./sampleProject";
import { commitEditorSessionChange, createImportedEditorSession, createImportedEditorSessionTransition, reconcileEditorSessionComposition, restoreEditorSessionHistory, transitionEditorSession } from "./editorSession";
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

  it("preserves already-pinned nested Composition trees during legacy-domain reconciliation", () => {
    const current = makeSession();
    const pinnedChild = structuredClone(current.composition);
    pinnedChild.id = "composition:pinned-shot-slot:older-version";
    pinnedChild.name = "Pinned older Shot Slot version";
    pinnedChild.nestedCompositions = [];
    current.composition.nestedCompositions = [pinnedChild];
    const nextProject = structuredClone(current.project);
    nextProject.name = "Metadata-only rename";

    const next = commitEditorSessionChange(current, nextProject);

    expect(next.composition.nestedCompositions).toEqual([
      expect.objectContaining({
        id: "composition:pinned-shot-slot:older-version",
        name: "Pinned older Shot Slot version",
      }),
    ]);
    expect(current.composition.nestedCompositions?.[0].id).toBe("composition:pinned-shot-slot:older-version");
  });

  it("preserves canonical root identity, provenance, and unknown metadata during legacy reconciliation", () => {
    const current = makeSession();
    current.composition.id = "canonical-root-custom-id";
    current.composition.provenance = {
      kind: "master-timeline-snapshot",
      sourceProjectId: current.project.id,
      sourceCompositionId: "source-composition-id",
      sourceUpdatedAt: current.project.updatedAt,
      createdAt: "2026-10-22T12:00:00.000Z",
      pinnedVersions: [],
    };
    current.composition.legacyData = {
      ...(current.composition.legacyData ?? {}),
      canonicalOnlyFlag: "preserve-me",
    };
    const nextProject = structuredClone(current.project);
    nextProject.name = "Metadata-only project rename";

    const next = commitEditorSessionChange(current, nextProject);

    expect(next.composition.id).toBe("canonical-root-custom-id");
    expect(next.composition.provenance).toEqual(current.composition.provenance);
    expect(next.composition.legacyData).toMatchObject({ canonicalOnlyFlag: "preserve-me" });
    expect(next.composition.name).toBe("Metadata-only project rename — Master Timeline");
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


describe("Canonical nested edit round-trip", () => {
  it("restores root and pinned nested edits through undo/redo and preserves them through JSON save/reopen", () => {
    const before = makeSession();
    const root = structuredClone(before.composition);
    const rootPlacement = root.placements[0];
    expect(rootPlacement).toBeDefined();

    const pinnedChild = structuredClone(root);
    pinnedChild.id = "composition:pinned-round-trip";
    pinnedChild.name = "Pinned Shot Slot version";
    pinnedChild.nestedCompositions = [];
    const childPlacement = pinnedChild.placements[0];
    expect(childPlacement).toBeDefined();
    childPlacement.source = {
      type: "shot",
      shotId: "shot-pinned-round-trip",
      slotId: "slot-pinned-round-trip",
      versionId: "version-pinned-round-trip",
    };
    pinnedChild.provenance = {
      kind: "derived-clip-version",
      createdAt: "2026-10-23T10:00:00.000Z",
      pinnedVersions: [{
        shotId: "shot-pinned-round-trip",
        slotId: "slot-pinned-round-trip",
        versionId: "version-pinned-round-trip",
      }],
    };
    root.nestedCompositions = [pinnedChild];
    before.composition = root;
    before.project = projectRootCompositionToLegacy(before.project, root);

    const movedRoot = moveCompositionPlacement(root, rootPlacement.id, rootPlacement.start + 2);
    const movedChild = moveCompositionPlacement(pinnedChild, childPlacement.id, childPlacement.start + 4);
    movedRoot.nestedCompositions = [movedChild];
    const nextProject = projectRootCompositionToLegacy(before.project, movedRoot);
    const edit = transitionEditorSession(
      before,
      createEditorSessionHistory(),
      () => nextProject,
      "root-and-nested-move",
      movedRoot,
      Date.parse("2026-10-23T10:01:00.000Z"),
    );

    const undo = restoreEditorSessionHistory(
      edit.session,
      edit.history,
      "undo",
      Date.parse("2026-10-23T10:02:00.000Z"),
    );
    expect(undo.session?.composition.placements.find(item => item.id === rootPlacement.id)?.start)
      .toBe(rootPlacement.start);
    expect(undo.session?.composition.nestedCompositions?.[0].placements.find(item => item.id === childPlacement.id)?.start)
      .toBe(childPlacement.start);

    const redo = restoreEditorSessionHistory(
      undo.session!,
      undo.history,
      "redo",
      Date.parse("2026-10-23T10:03:00.000Z"),
    );
    expect(redo.session?.composition.placements.find(item => item.id === rootPlacement.id)?.start)
      .toBe(rootPlacement.start + 2);
    expect(redo.session?.composition.nestedCompositions?.[0].placements.find(item => item.id === childPlacement.id)?.start)
      .toBe(childPlacement.start + 4);

    const saved = createProjectDocument(redo.session!.project, redo.session!.composition);
    const reopened = readProjectDocument(JSON.parse(JSON.stringify(saved)), true);
    const restoredChild = reopened.compositionModel?.rootComposition.nestedCompositions?.find(
      item => item.id === "composition:pinned-round-trip",
    );
    expect(reopened.compositionModel?.rootComposition.placements.find(item => item.id === rootPlacement.id)?.start)
      .toBe(rootPlacement.start + 2);
    expect(restoredChild?.placements.find(item => item.id === childPlacement.id)?.start)
      .toBe(childPlacement.start + 4);
    expect(restoredChild?.placements.find(item => item.id === childPlacement.id)?.source).toEqual({
      type: "shot",
      shotId: "shot-pinned-round-trip",
      slotId: "slot-pinned-round-trip",
      versionId: "version-pinned-round-trip",
    });
    expect(restoredChild?.provenance?.pinnedVersions).toEqual([{
      shotId: "shot-pinned-round-trip",
      slotId: "slot-pinned-round-trip",
      versionId: "version-pinned-round-trip",
    }]);
  });
});


describe("Imported editor session", () => {
  it("accepts a canonical root only when its Project projection matches and always returns a paired session", () => {
    const source = structuredClone(sampleProject);
    const sourceRoot = migrateLegacyProjectToComposition(source).rootComposition;
    const compatibleProject = projectRootCompositionToLegacy(source, sourceRoot);
    const imported = createImportedEditorSession(compatibleProject, sourceRoot);

    expect(imported.composition).toEqual(sourceRoot);
    expect(imported.project).toEqual(compatibleProject);

    const staleRoot = structuredClone(sourceRoot);
    const stalePlacement = staleRoot.placements[0];
    expect(stalePlacement).toBeDefined();
    stalePlacement.start += 12;
    const fallback = createImportedEditorSession(compatibleProject, staleRoot);
    expect(fallback.composition.placements.find(item => item.id === stalePlacement.id)?.start)
      .toBe(sourceRoot.placements.find(item => item.id === stalePlacement.id)?.start);
    expect(fallback.project).toEqual(projectRootCompositionToLegacy(compatibleProject, fallback.composition));
    expect(source).toEqual(sampleProject);
  });

  it("migrates legacy imports and projects the result back into one compatible session", () => {
    const legacy = structuredClone(sampleProject);
    const imported = createImportedEditorSession(legacy);
    expect(imported.composition).toEqual(migrateLegacyProjectToComposition(legacy).rootComposition);
    expect(imported.project).toEqual(projectRootCompositionToLegacy(legacy, imported.composition));
    expect(legacy).toEqual(sampleProject);
  });

  it("replaces imported session and resets history together", () => {
    const previous = makeSession();
    const edited = transitionEditorSession(
      previous,
      createEditorSessionHistory(),
      project => ({ ...project, name: "Previous project edit" }),
      "rename",
      undefined,
      Date.parse("2026-10-22T12:34:56.000Z"),
    );
    expect(edited.history.undo).toHaveLength(1);

    const imported = createImportedEditorSessionTransition(structuredClone(sampleProject));

    expect(imported.session.project.name).toBe(sampleProject.name);
    expect(imported.session.composition).toEqual(migrateLegacyProjectToComposition(sampleProject).rootComposition);
    expect(imported.history).toEqual(createEditorSessionHistory());
    expect(imported.history.undo).toEqual([]);
    expect(imported.history.redo).toEqual([]);
    expect(previous.project.name).not.toBe("Previous project edit");
  });
});
