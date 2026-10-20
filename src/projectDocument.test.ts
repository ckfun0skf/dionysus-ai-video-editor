import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { createProjectDocument, readProjectDocument } from "./projectDocument";
import { recordProjectChange, redoProjectChange, undoProjectChange } from "./projectHistory";
import { moveCompositionPlacement } from "./compositionCommands";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { getMasterShotStart } from "./masterTimeline";

describe("versioned project document boundary", () => {
  it("exports a versioned Composition projection alongside a lossless legacy project", () => {
    const project = structuredClone(sampleProject);
    const before = JSON.stringify(project);
    const document = createProjectDocument(project);
    expect(document).toMatchObject({
      format: "dionysus-project-document",
      documentVersion: "2.0",
      project: { schemaVersion: "1.0", id: project.id },
      compositionModel: { schemaVersion: "2.0", projectId: project.id },
    });
    expect(document.compositionModel.rootComposition.tracks.length).toBeGreaterThan(0);
    expect(readProjectDocument(document)).toMatchObject({ project, sourceDocumentVersion: "2.0" });
    expect(JSON.stringify(project)).toBe(before);
  });

  it("continues to read existing schema-1.0 project files", () => {
    const project = structuredClone(sampleProject);
    expect(readProjectDocument(project)).toEqual({ project, sourceDocumentVersion: "1.0" });
  });

  it("rejects a versioned envelope whose Composition metadata belongs to another project", () => {
    const project = structuredClone(sampleProject);
    const document = createProjectDocument(project);
    document.compositionModel.projectId = "different-project";
    expect(() => readProjectDocument(document)).toThrow(/inconsistent Composition metadata/);
  });

  it("rejects a mismatched root Composition identity", () => {
    const document = createProjectDocument(structuredClone(sampleProject));
    document.compositionModel.rootComposition.id = "composition:project:wrong:master";
    expect(() => readProjectDocument(document)).toThrow(/inconsistent Composition metadata/);
  });

  it("rebuilds stale schema-1.0 placement geometry from a valid canonical root", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    project.timelineClips = [{
      id: "canonical-import-clip", name: "Canonical import", kind: "video", trackId: track.id,
      start: 2, duration: 4, sourceIn: 10, sourceOut: 14,
    }];
    const initialRoot = migrateLegacyProjectToComposition(project).rootComposition;
    const movedRoot = moveCompositionPlacement(initialRoot, "canonical-import-clip", 18);
    const document = createProjectDocument(project, movedRoot);
    expect(document.project.timelineClips?.[0]).toMatchObject({ start: 18, sourceIn: 10, sourceOut: 14 });
    document.project.timelineClips![0] = { ...document.project.timelineClips![0], start: 99, duration: 1, sourceIn: 0, sourceOut: 1 };
    const reopened = readProjectDocument(JSON.parse(JSON.stringify(document)), true);
    expect(reopened.project.timelineClips?.[0]).toMatchObject({ start: 18, duration: 4, sourceIn: 10, sourceOut: 14 });
    expect(reopened.compositionModel?.rootComposition.placements.find(item => item.id === "canonical-import-clip"))
      .toMatchObject({ start: 18, duration: 4, sourceIn: 10, sourceOut: 14 });
  });

  it("rejects a canonical root placement that cannot produce a compatible legacy clip", () => {
    const document = createProjectDocument(structuredClone(sampleProject));
    document.compositionModel.rootComposition.placements.push({
      id: "invalid-placement", name: "Invalid", trackId: document.compositionModel.rootComposition.tracks[0].id,
      start: 0, duration: 1, order: 999, source: { type: "none" }, legacyData: {},
    });
    expect(() => readProjectDocument(document)).toThrow(/no compatible legacy clip metadata/);
  });

  it("preserves validated nested and pinned Composition snapshots without re-deriving them from legacy fields", () => {
    const document = createProjectDocument(structuredClone(sampleProject));
    const nested = document.compositionModel.legacyShotSlotCompositions[0];
    const originalDuration = nested.duration;
    nested.duration += 3;
    const restored = readProjectDocument(JSON.parse(JSON.stringify(document)), true);
    expect(restored.compositionModel?.legacyShotSlotCompositions[0].duration).toBe(originalDuration + 3);
  });

  it("accepts a fresh versioned document and preserves the authoritative project payload", () => {
    const project = structuredClone(sampleProject);
    const document = createProjectDocument(project);
    const result = readProjectDocument(document);
    expect(result.sourceDocumentVersion).toBe("2.0");
    expect(result.project).toEqual(project);
  });

  it("rejects unknown versions rather than guessing a migration", () => {
    expect(() => readProjectDocument({ format: "dionysus-project-document", documentVersion: "3.0", project: {}, compositionModel: {} })).toThrow(/Unsupported/);
    expect(() => readProjectDocument({ schemaVersion: "3.0" })).toThrow(/Unsupported/);
  });

  it("round-trips legacy JSON and the versioned envelope without dropping alternatives or provenance", () => {
    const project = structuredClone(sampleProject);
    const shot = project.shots[0];
    const slot = shot.slots[0];
    const references = [
      { id: "json-reference-1", assetId: "json-character", role: "identity" as const, notes: "Use this exact identity reference" },
    ];
    slot.versions[0].generationRecords = [{
      id: "json-run-original",
      createdAt: "2026-10-12T10:00:00.000Z",
      prompt: "Original generation prompt",
      referenceSnapshot: structuredClone(references),
      modelName: "Model A",
      modelVersion: "2026-10",
      outputAssetId: "json-original-output",
    }];
    const alternative = structuredClone(slot.versions[0]);
    alternative.id = "json-version-alternative";
    alternative.name = "Alternative";
    alternative.description = "A separate generated alternative";
    alternative.generationRecords = [{
      id: "json-run-alternative",
      createdAt: "2026-10-12T11:00:00.000Z",
      prompt: "Alternative generation prompt",
      referenceSnapshot: structuredClone(references),
      modelName: "Model B",
      modelVersion: "2026-10",
      outputAssetId: "json-alternative-output",
    }];
    slot.versions.push(alternative);
    slot.selectedVersionId = alternative.id;

    const legacyJson = JSON.parse(JSON.stringify(project)) as unknown;
    expect(readProjectDocument(legacyJson)).toEqual({ project, sourceDocumentVersion: "1.0" });

    const versionedExport = JSON.parse(JSON.stringify(createProjectDocument(project))) as ReturnType<typeof createProjectDocument>;
    const imported = readProjectDocument(versionedExport);
    expect(imported).toEqual({ project, sourceDocumentVersion: "2.0" });

    const alternatives = versionedExport.compositionModel.legacyShotSlotCompositions.filter(composition =>
      composition.legacyData?.shotId === shot.id && composition.legacyData?.slotId === slot.id
    );
    expect(alternatives).toHaveLength(2);
    expect(alternatives.map(composition => composition.legacyData?.versionId)).toEqual([
      slot.versions[0].id,
      alternative.id,
    ]);
    expect(alternatives.map(composition => composition.legacyData?.selected)).toEqual([false, true]);
    expect(alternatives[0].legacyData).toMatchObject({ generationRecords: slot.versions[0].generationRecords });
    expect(alternatives[1].legacyData).toMatchObject({ generationRecords: alternative.generationRecords });
  });


  it("persists root Composition through save/reopen and restores it across project Undo/Redo", () => {
    const original = structuredClone(sampleProject);
    const originalStart = getMasterShotStart(original.shots, original.shots[0].id);
    const edited = {
      ...structuredClone(original),
      shots: original.shots.map((shot, index) => index === 0 ? { ...shot, masterStart: 23 } : shot),
    };
    const afterEdit = recordProjectChange({ current: original, undo: [], redo: [] }, edited);

    const editDocument = JSON.parse(JSON.stringify(createProjectDocument(afterEdit.current))) as ReturnType<typeof createProjectDocument>;
    const reopenedEdit = readProjectDocument(editDocument);
    expect(reopenedEdit.project.shots[0].masterStart).toBe(23);
    expect(editDocument.compositionModel.rootComposition.placements.find(placement => placement.id === original.shots[0].id)?.start).toBe(23);
    expect(reopenedEdit.sourceDocumentVersion).toBe("2.0");
    expect(reopenedEdit.project.id).toBe(original.id);

    const undone = undoProjectChange(afterEdit);
    const undoDocument = JSON.parse(JSON.stringify(createProjectDocument(undone.current))) as ReturnType<typeof createProjectDocument>;
    const reopenedUndo = readProjectDocument(undoDocument);
    expect(getMasterShotStart(reopenedUndo.project.shots, original.shots[0].id)).toBe(originalStart);
    expect(undoDocument.compositionModel.rootComposition.placements.find(placement => placement.id === original.shots[0].id)?.start).toBe(originalStart);

    const redone = redoProjectChange(undone);
    const redoDocument = JSON.parse(JSON.stringify(createProjectDocument(redone.current))) as ReturnType<typeof createProjectDocument>;
    const reopenedRedo = readProjectDocument(redoDocument);
    expect(getMasterShotStart(reopenedRedo.project.shots, original.shots[0].id)).toBe(23);
    expect(redoDocument.compositionModel.rootComposition.placements.find(placement => placement.id === original.shots[0].id)?.start).toBe(23);
  });


  it("imports the validated canonical root instead of re-migrating stale legacy placement timing", () => {
    const original = structuredClone(sampleProject);
    original.shots = [];
    const track = original.tracks.find(item => item.kind === "video")!;
    original.timelineClips = [{
      id: "canonical-import-clip", name: "Canonical import", kind: "video", trackId: track.id,
      start: 2, duration: 4, sourceIn: 10, sourceOut: 14,
    }];
    const initialRoot = migrateLegacyProjectToComposition(original).rootComposition;
    const movedRoot = moveCompositionPlacement(initialRoot, "canonical-import-clip", 18);
    const projected = projectRootCompositionToLegacy(original, movedRoot);
    const document = createProjectDocument(projected, movedRoot);
    const reopened = readProjectDocument(JSON.parse(JSON.stringify(document)), true);
    expect(reopened.project.timelineClips?.[0]).toMatchObject({ start: 18, sourceIn: 10, sourceOut: 14 });
    expect(reopened.compositionModel?.rootComposition.placements.find(item => item.id === "canonical-import-clip"))
      .toMatchObject({ start: 18, sourceIn: 10, sourceOut: 14 });
  });

  it("persists canonical root Composition edits and restores their exact snapshots through Undo/Redo", () => {
    const original = structuredClone(sampleProject);
    const initialRoot = migrateLegacyProjectToComposition(original).rootComposition;
    const shotId = original.shots[0].id;
    const originalPlacement = initialRoot.placements.find(placement => placement.id === shotId)!;
    const movedRoot = moveCompositionPlacement(initialRoot, shotId, 23);
    const editedProject = projectRootCompositionToLegacy(original, movedRoot);
    const editHistory = recordProjectChange({ current: initialRoot, undo: [], redo: [] }, movedRoot);

    const editDocument = createProjectDocument(editedProject, editHistory.current);
    const reopenedEdit = readProjectDocument(JSON.parse(JSON.stringify(editDocument)));
    expect(reopenedEdit.project.shots.find(shot => shot.id === shotId)?.masterStart).toBe(23);
    expect(editDocument.compositionModel.rootComposition.placements.find(placement => placement.id === shotId)?.start).toBe(23);

    const undoHistory = undoProjectChange(editHistory);
    const undoneProject = projectRootCompositionToLegacy(editedProject, undoHistory.current);
    const undoDocument = createProjectDocument(undoneProject, undoHistory.current);
    expect(readProjectDocument(JSON.parse(JSON.stringify(undoDocument))).project.shots.find(shot => shot.id === shotId)?.masterStart)
      .toBe(originalPlacement.start);
    expect(undoDocument.compositionModel.rootComposition.placements.find(placement => placement.id === shotId)?.start)
      .toBe(originalPlacement.start);

    const redoHistory = redoProjectChange(undoHistory);
    const redoneProject = projectRootCompositionToLegacy(editedProject, redoHistory.current);
    const redoDocument = createProjectDocument(redoneProject, redoHistory.current);
    expect(readProjectDocument(JSON.parse(JSON.stringify(redoDocument))).project.shots.find(shot => shot.id === shotId)?.masterStart)
      .toBe(23);
    expect(redoDocument.compositionModel.rootComposition.placements.find(placement => placement.id === shotId)?.start).toBe(23);
  });

});
