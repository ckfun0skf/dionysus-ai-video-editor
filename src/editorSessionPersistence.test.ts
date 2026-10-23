import { describe, expect, it } from "vitest";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { addCompositionLinkedAudioChild, extractLinkedAudio } from "./compositionCommands";
import { readProjectDocument } from "./projectDocument";
import { sampleProject } from "./sampleProject";
import {
  COMPOSITION_PROJECT_STORAGE_KEY,
  LEGACY_PROJECT_STORAGE_KEY,
  persistEditorSession,
  chooseEditorSessionRecoverySource,
} from "./editorSessionPersistence";

function memoryStorage(failOn?: string) {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values,
    writes,
    setItem(key: string, value: string) {
      writes.push(key);
      if (key === failOn) throw new Error("storage full");
      values.set(key, value);
    },
  };
}

describe("Editor session persistence boundary", () => {
  it("writes only the canonical envelope and preserves its compatibility projection", () => {
    const project = structuredClone(sampleProject);
    const composition = migrateLegacyProjectToComposition(project).rootComposition;
    const storage = memoryStorage();

    persistEditorSession(storage, { project, composition }, "2026-10-22T12:34:56.000Z");

    expect(storage.writes).toEqual([COMPOSITION_PROJECT_STORAGE_KEY]);
    const envelope = JSON.parse(storage.values.get(COMPOSITION_PROJECT_STORAGE_KEY)!);
    expect(envelope.documentVersion).toBe("2.0");
    expect(envelope.project.updatedAt).toBe("2026-10-22T12:34:56.000Z");
    expect(envelope.compositionModel.rootComposition).toEqual(composition);
    expect(envelope.project).toEqual(projectRootCompositionToLegacy({ ...project, updatedAt: "2026-10-22T12:34:56.000Z" }, composition));
    expect(storage.values.has(LEGACY_PROJECT_STORAGE_KEY)).toBe(false);
  });

  it("round-trips canonical pinned nested Composition trees through save and reopen", () => {
    const project = structuredClone(sampleProject);
    const root = migrateLegacyProjectToComposition(project).rootComposition;
    const pinnedChild = structuredClone(root);
    pinnedChild.id = "composition:pinned-shot-slot:older-version";
    pinnedChild.name = "Pinned older Shot Slot version";
    pinnedChild.nestedCompositions = [];
    pinnedChild.provenance = {
      kind: "derived-clip-version",
      sourceProjectId: project.id,
      sourceCompositionId: "source-composition",
      sourceUpdatedAt: project.updatedAt,
      createdAt: "2026-10-23T10:30:00.000Z",
      pinnedVersions: [{ shotId: "shot-1", slotId: "slot-1", versionId: "shot-version-1" }],
    };
    root.nestedCompositions = [pinnedChild];
    const sessionProject = projectRootCompositionToLegacy(project, root);
    const storage = memoryStorage();

    persistEditorSession(storage, { project: sessionProject, composition: root }, "2026-10-23T10:31:00.000Z");
    const saved = JSON.parse(storage.values.get(COMPOSITION_PROJECT_STORAGE_KEY)!);
    const reopened = readProjectDocument(saved, true);
    const reopenedRoot = reopened.compositionModel!.rootComposition;

    expect(reopened.sourceDocumentVersion).toBe("2.0");
    expect(reopenedRoot.id).toBe(root.id);
    expect(reopenedRoot.nestedCompositions).toEqual([pinnedChild]);
    expect(reopenedRoot.nestedCompositions?.[0].provenance).toEqual(pinnedChild.provenance);
  });

  it("round-trips extracted linked audio with a non-zero source in-point as an independent audio placement", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({
      id: "persisted-linked-audio-source",
      name: "Embedded source audio",
      kind: "audio",
      path: "idb://persisted-linked-audio-source",
    });
    let root = migrateLegacyProjectToComposition(project).rootComposition;
    const owner = root.placements[0];
    expect(owner).toBeDefined();
    const sourceIn = 3;
    const sourceOut = sourceIn + owner!.duration;
    root = addCompositionLinkedAudioChild(root, owner!.id, {
      id: "persisted-linked-audio-child",
      name: "Embedded audio",
      source: { type: "asset", assetId: "persisted-linked-audio-source" },
      sourceIn,
      sourceOut,
      legacyData: {
        id: "persisted-linked-audio-child",
        kind: "audio",
        linkedVideoClipId: owner!.id,
        assetId: "persisted-linked-audio-source",
      },
    });
    root = extractLinkedAudio(root, "persisted-linked-audio-child");
    const sessionProject = projectRootCompositionToLegacy(project, root);
    const storage = memoryStorage();

    persistEditorSession(storage, { project: sessionProject, composition: root }, "2026-10-23T11:00:00.000Z");
    const reopened = readProjectDocument(
      JSON.parse(storage.values.get(COMPOSITION_PROJECT_STORAGE_KEY)!),
      true,
    );
    const restored = reopened.compositionModel!.rootComposition.placements.find(
      item => item.id === "persisted-linked-audio-child",
    );

    expect(restored).toMatchObject({
      id: "persisted-linked-audio-child",
      trackId: root.tracks.find(track => track.kind === "audio")?.id,
      start: owner!.start,
      duration: owner!.duration,
      source: { type: "asset", assetId: "persisted-linked-audio-source" },
      sourceIn,
      sourceOut,
    });
    expect(restored?.linkedToPlacementId).toBeUndefined();
    expect(reopened.compositionModel!.rootComposition.placements
      .find(item => item.id === owner!.id)?.linkedAudioChildren).toEqual([]);
  });

  it("leaves the existing legacy fallback untouched if the canonical write fails", () => {
    const project = structuredClone(sampleProject);
    const composition = migrateLegacyProjectToComposition(project).rootComposition;
    const storage = memoryStorage(COMPOSITION_PROJECT_STORAGE_KEY);
    const legacy = JSON.stringify({ schemaVersion: "1.0", id: "legacy-fallback" });
    storage.values.set(LEGACY_PROJECT_STORAGE_KEY, legacy);

    expect(() => persistEditorSession(
      storage,
      { project, composition },
      "2026-10-22T12:34:56.000Z",
    )).toThrow("storage full");

    expect(storage.values.has(COMPOSITION_PROJECT_STORAGE_KEY)).toBe(false);
    expect(storage.values.get(LEGACY_PROJECT_STORAGE_KEY)).toBe(legacy);
    expect(storage.writes).toEqual([COMPOSITION_PROJECT_STORAGE_KEY]);
  });
});

describe("Editor session recovery source selection", () => {
  const doc = (id: string, name: string, updatedAt: string) => ({
    project: { id, name, updatedAt },
  });

  it("chooses the complete canonical envelope whenever one is available", () => {
    expect(chooseEditorSessionRecoverySource(
      doc("old-project", "Legacy", "2026-10-22T12:05:00.000Z"),
      doc("new-project", "Canonical", "2026-10-22T12:00:00.000Z"),
    )).toBe("composition");
    expect(chooseEditorSessionRecoverySource(
      doc("p1", "Project", "not-a-date"),
      doc("p1", "Project", "not-a-date"),
    )).toBe("composition");
  });

  it("uses legacy only when canonical recovery is absent or invalid", () => {
    expect(chooseEditorSessionRecoverySource(doc("p1", "Project", "2026-10-22T12:00:00.000Z"), undefined)).toBe("legacy");
    expect(chooseEditorSessionRecoverySource(undefined, undefined)).toBe("empty");
    expect(chooseEditorSessionRecoverySource(undefined, doc("p1", "Project", "not-a-date"))).toBe("composition");
  });
});
