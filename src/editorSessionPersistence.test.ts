import { describe, expect, it } from "vitest";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { addCompositionLinkedAudioChild, applyCompositionResizePreview, extractLinkedAudio, insertCompositionPlacement, splitCompositionPlacement, trimCompositionPlacement } from "./compositionCommands";
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
    project.assets.push(
      {
        id: "persisted-linked-audio-source",
        name: "Embedded source audio",
        kind: "audio",
        path: "idb://persisted-linked-audio-source",
      },
      {
        id: "persisted-linked-video-source",
        name: "Video with embedded audio",
        kind: "video",
        path: "idb://persisted-linked-video-source",
      },
    );
    let root = migrateLegacyProjectToComposition(project).rootComposition;
    const videoTrack = root.tracks.find(track => track.kind === "video");
    expect(videoTrack).toBeDefined();
    const owner = {
      id: "persisted-linked-video",
      name: "Video with embedded audio",
      trackId: videoTrack!.id,
      start: root.duration + 1,
      duration: 5,
      order: root.placements.length,
      source: { type: "asset" as const, assetId: "persisted-linked-video-source" },
      sourceIn: 0,
      sourceOut: 5,
      legacyData: { id: "persisted-linked-video", kind: "video", assetId: "persisted-linked-video-source" },
    };
    root = insertCompositionPlacement(root, owner);
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

  it("round-trips linked-audio child ranges through trim, resize and split", () => {
    const project = structuredClone(sampleProject);
    project.assets.push(
      {
        id: "linked-child-persist-audio",
        name: "Linked child audio source",
        kind: "audio",
        path: "idb://linked-child-persist-audio",
      },
      {
        id: "linked-child-persist-video",
        name: "Linked child video source",
        kind: "video",
        path: "idb://linked-child-persist-video",
      },
    );
    let root = migrateLegacyProjectToComposition(project).rootComposition;
    const videoTrack = root.tracks.find(track => track.kind === "video");
    expect(videoTrack).toBeDefined();
    const owner = {
      id: "linked-child-persist-video-placement",
      name: "Video with embedded audio",
      trackId: videoTrack!.id,
      start: root.duration + 1,
      duration: 6,
      order: root.placements.length,
      source: { type: "asset" as const, assetId: "linked-child-persist-video" },
      sourceIn: 2,
      sourceOut: 8,
      legacyData: { id: "linked-child-persist-video-placement", kind: "video", assetId: "linked-child-persist-video" },
    };
    root = insertCompositionPlacement(root, owner);
    root = addCompositionLinkedAudioChild(root, owner.id, {
      id: "linked-child-persist-audio-child",
      name: "Embedded audio",
      source: { type: "asset", assetId: "linked-child-persist-audio" },
      sourceIn: 5,
      sourceOut: 11,
      legacyData: {
        id: "linked-child-persist-audio-child",
        kind: "audio",
        linkedVideoClipId: owner.id,
        assetId: "linked-child-persist-audio",
      },
    });

    // Exercise three canonical edit commands before persisting the same document.
    root = trimCompositionPlacement(root, owner.id, 4);
    root = applyCompositionResizePreview(root, {
      id: owner.id, start: owner.start, duration: 8, edge: "right", trims: [],
    });
    root = splitCompositionPlacement(root, owner.id, owner.start + 4, {
      newPlacementIds: { [owner.id]: "linked-child-persist-video-right" },
    });

    const sessionProject = projectRootCompositionToLegacy(project, root);
    const storage = memoryStorage();
    persistEditorSession(storage, { project: sessionProject, composition: root }, "2026-10-23T12:00:00.000Z");
    const reopened = readProjectDocument(
      JSON.parse(storage.values.get(COMPOSITION_PROJECT_STORAGE_KEY)!),
      true,
    );
    const reopenedRoot = reopened.compositionModel!.rootComposition;
    const left = reopenedRoot.placements.find(item => item.id === owner.id)!;
    const right = reopenedRoot.placements.find(item => item.id === "linked-child-persist-video-right")!;
    const rightAudioId = "linked-child-persist-video-right:audio:linked-child-persist-audio-child";

    expect(left).toMatchObject({ start: owner.start, duration: 4, sourceIn: 2, sourceOut: 6 });
    expect(left.linkedAudioChildren).toMatchObject([{
      id: "linked-child-persist-audio-child",
      source: { type: "asset", assetId: "linked-child-persist-audio" },
      sourceIn: 5,
      sourceOut: 9,
      legacyData: { linkedVideoClipId: owner.id, sourceIn: 5, sourceOut: 9 },
    }]);
    expect(right).toMatchObject({
      start: owner.start + 4, duration: 4, sourceIn: 6, sourceOut: 10,
    });
    expect(right.linkedAudioChildren).toMatchObject([{
      id: rightAudioId,
      source: { type: "asset", assetId: "linked-child-persist-audio" },
      sourceIn: 9,
      sourceOut: 13,
      legacyData: { linkedVideoClipId: right.id, sourceIn: 9, sourceOut: 13 },
    }]);
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
