import { describe, expect, it } from "vitest";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { sampleProject } from "./sampleProject";
import { commitEditorSessionChange, reconcileEditorSessionComposition } from "./editorSession";
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
    desired.sourceIn += 1;
    desired.sourceOut += 1;

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
