import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { addClipVersionLayer, addClipVersionTrack, deleteClipVersionLayer, duplicateClipVersionComposition, ensureClipVersionComposition, moveClipVersionLayer, normalizeClipVersionTracks, updateClipVersionDescription, updateClipVersionDuration, updateClipVersionLayer, updateClipVersionTrack } from "./clipVersionTracks";
import { validateProject } from "./projectValidation";

describe("normalizeClipVersionTracks", () => {
  it("assigns stable shared tracks to legacy layer kinds without losing layer data", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    version.layers = [
      { id: "video-a", name: "Video A", kind: "video", start: 0, duration: 2, x: 12 },
      { id: "image-a", name: "Image A", kind: "image", start: 1, duration: 3, assetId: "image-id" },
      { id: "audio-a", name: "Audio A", kind: "audio", start: 0, duration: 4, volume: 0.5 },
      { id: "text-a", name: "Text A", kind: "text", start: 1, duration: 1 },
      { id: "code-a", name: "Code A", kind: "procedural", start: 2, duration: 2, code: "return 1;" },
    ];
    const normalized = normalizeClipVersionTracks(version);
    expect(normalized.tracks?.map(track => track.kind)).toEqual(["video", "audio", "text"]);
    expect(normalized.layers.map(layer => layer.trackId)).toEqual([
      "clip-track:" + version.id + ":video",
      "clip-track:" + version.id + ":video",
      "clip-track:" + version.id + ":audio",
      "clip-track:" + version.id + ":text",
      "clip-track:" + version.id + ":video",
    ]);
    expect(normalized.layers[1]).toMatchObject({ kind: "image", assetId: "image-id", trackId: normalized.layers[0].trackId });
    expect(normalized.layers[4]).toMatchObject({ kind: "procedural", code: "return 1;" });
    const project = structuredClone(sampleProject);
    project.assets.push({ id: "image-id", name: "Image", kind: "image" });
    project.shots[0].slots[0].versions[0] = normalized;
    expect(validateProject(project)).toBe(true);
  });

  it("preserves valid explicit track IDs and ordering", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    version.tracks = [
      { id: "track-video-custom", name: "Main video", kind: "video" },
      { id: "track-audio-custom", name: "Music", kind: "audio" },
    ];
    version.layers = [
      { id: "v", name: "Video", kind: "video", trackId: "track-video-custom", start: 0, duration: 2 },
      { id: "a", name: "Audio", kind: "audio", trackId: "track-audio-custom", start: 0, duration: 2 },
    ];
    const normalized = normalizeClipVersionTracks(version);
    expect(normalized.tracks?.map(track => track.id)).toEqual(["track-video-custom", "track-audio-custom"]);
    expect(normalized.layers.map(layer => layer.trackId)).toEqual(["track-video-custom", "track-audio-custom"]);
  });
});

describe("nested Clip Version track operations", () => {
  it("adds separate tracks and places multiple layers on a chosen track", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    const withTrack = addClipVersionTrack(version, { id: "video-2", name: "Video 2", kind: "video" });
    const withLayers = addClipVersionLayer(withTrack, { id: "image-1", name: "Image", kind: "image", start: 0, duration: 2 }, "video-2");
    const withSecondLayer = addClipVersionLayer(withLayers, { id: "code-1", name: "Code", kind: "procedural", start: 1, duration: 2 }, "video-2");
    expect(withSecondLayer.tracks?.map(track => track.id)).toContain("video-2");
    expect(withSecondLayer.layers.filter(layer => layer.trackId === "video-2").map(layer => layer.id)).toEqual(["image-1", "code-1"]);
  });

  it("keeps nested Version description aligned with canonical Composition metadata", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    const withLayer = addClipVersionLayer(version, {
      id: "nested-description-layer",
      name: "Description layer",
      kind: "video",
      start: 0,
      duration: 2,
    });
    const updated = updateClipVersionDescription(withLayer, "Updated canonical description");

    expect(updated.description).toBe("Updated canonical description");
    expect(updated.composition?.legacyData?.description).toBe("Updated canonical description");
    expect(withLayer.composition?.legacyData?.description).not.toBe("Updated canonical description");
  });

  it("materializes a canonical Composition for an empty nested Version", () => {
    const version = {
      ...structuredClone(sampleProject.shots[0].slots[0].versions[0]),
      id: "empty-canonical-version",
      duration: 6,
      layers: [],
      tracks: [{ id: "fresh-empty-video-track", name: "Video 1", kind: "video" as const }],
      composition: undefined,
    };
    const ensured = ensureClipVersionComposition(version, { width: 1080, height: 1920 });

    expect(ensured.composition).toMatchObject({
      duration: 6,
      width: 1080,
      height: 1920,
      placements: [],
      tracks: [{ id: "fresh-empty-video-track", name: "Video 1", kind: "video" }],
    });
    expect(version.composition).toBeUndefined();
  });

  it("updates nested duration in canonical Composition and compatibility projection", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    const withLayer = addClipVersionLayer(version, {
      id: "nested-duration-layer",
      name: "Duration layer",
      kind: "video",
      start: 0,
      duration: 2,
    });
    const updated = updateClipVersionDuration(withLayer, 3);

    expect(updated.duration).toBe(3);
    expect(updated.composition?.duration).toBe(3);
    expect(updated.layers.find(layer => layer.id === "nested-duration-layer")?.duration).toBe(2);
    expect(withLayer.duration).not.toBe(3);
    expect(withLayer.composition?.duration).not.toBe(3);
    expect(() => updateClipVersionDuration(withLayer, Number.NaN)).toThrow(/duration/i);
  });

  it("updates nested track mute in canonical Composition and compatibility projection", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    const withAudio = addClipVersionLayer(version, {
      id: "nested-audio-for-track-mute",
      name: "Nested audio",
      kind: "audio",
      start: 0,
      duration: 2,
    });
    const audioTrack = withAudio.tracks?.find(track => track.kind === "audio");
    expect(audioTrack).toBeDefined();
    const before = structuredClone(withAudio);
    const muted = updateClipVersionTrack(withAudio, audioTrack!.id, { muted: true });

    expect(muted.composition?.tracks.find(track => track.id === audioTrack!.id)?.muted).toBe(true);
    expect(muted.tracks?.find(track => track.id === audioTrack!.id)?.muted).toBe(true);
    expect(before.composition?.tracks.find(track => track.id === audioTrack!.id)?.muted).toBeUndefined();
    expect(() => updateClipVersionTrack(withAudio, "missing-track", { muted: true })).toThrow(/track/i);
  });

  it("inserts layers through Composition commands without mutating the original version", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    const before = JSON.stringify(version);
    const added = addClipVersionLayer(version, {
      id: "image-command-added",
      name: "Command-added image",
      kind: "image",
      start: 1,
      duration: 2,
      assetId: "image-asset",
      x: 12,
      prompt: "Preserve the original framing",
    });
    expect(added.layers.find(layer => layer.id === "image-command-added")).toMatchObject({
      name: "Command-added image",
      kind: "image",
      assetId: "image-asset",
      start: 1,
      duration: 2,
      x: 12,
      prompt: "Preserve the original framing",
      trackId: added.tracks?.find(track => track.kind === "video")?.id,
    });
    expect(JSON.stringify(version)).toBe(before);
    expect(() => addClipVersionLayer(added, {
      id: "image-command-added",
      name: "Duplicate",
      kind: "image",
      start: 0,
      duration: 1,
    })).toThrow(/unique/i);
  });

  it("deletes a nested root and linked descendants through Composition commands", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    version.tracks = [
      { id: "nested-video", name: "Video", kind: "video" },
      { id: "nested-audio", name: "Audio", kind: "audio" },
    ];
    version.layers = [
      { id: "nested-source", name: "Source", kind: "video", trackId: "nested-video", start: 0, duration: 2, sourceIn: 0, sourceOut: 2 },
      {
        id: "nested-source-audio",
        name: "Source audio",
        kind: "audio",
        trackId: "nested-audio",
        start: 0,
        duration: 2,
        sourceIn: 0,
        sourceOut: 2,
        assetId: "source-asset",
        linkedVideoClipId: "nested-source",
      } as unknown as import("./types").CompositionLayer,
      { id: "keep", name: "Independent", kind: "text", trackId: "clip-track:" + version.id + ":text", start: 3, duration: 1 },
    ];
    const before = JSON.stringify(version);
    const deleted = deleteClipVersionLayer(version, "nested-source");
    expect(deleted.layers.map(layer => layer.id)).toEqual(["keep"]);
    expect(JSON.stringify(version)).toBe(before);

    const deletedChildOnly = deleteClipVersionLayer(version, "nested-source-audio");
    expect(deletedChildOnly.layers.map(layer => layer.id)).toEqual(["nested-source", "keep"]);
  });

  it("treats a saved canonical Composition as authoritative and preserves nested snapshot metadata", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    const withPlacement = addClipVersionLayer(version, {
      id: "canonical-placement",
      name: "Canonical placement",
      kind: "video",
      start: 1,
      duration: 2,
      assetId: "source-asset",
      sourceIn: 3,
      sourceOut: 5,
      x: 12,
      volume: 0.4,
    });
    const canonical = structuredClone(withPlacement.composition!);
    canonical.provenance = {
      kind: "derived-clip-version",
      sourceProjectId: "project-source",
      sourceCompositionId: "root-composition",
      sourceUpdatedAt: "2026-10-20T10:00:00.000Z",
      createdAt: "2026-10-20T11:00:00.000Z",
      pinnedVersions: [{ assetId: "nested-asset", versionId: "nested-v3" }],
    };
    canonical.nestedCompositions = [{
      ...structuredClone(canonical),
      id: "embedded-child",
      placements: [],
      nestedCompositions: [],
    }];
    const saved = {
      ...withPlacement,
      composition: canonical,
      // Deliberately stale compatibility projection: canonical document must win.
      layers: withPlacement.layers.map(layer => ({ ...layer, start: 99, sourceIn: 99 })),
    };

    const moved = moveClipVersionLayer(saved, "canonical-placement", withPlacement.layers.find(layer => layer.id === "canonical-placement")?.trackId ?? saved.tracks![0].id, 4);
    const placement = moved.composition?.placements.find(item => item.id === "canonical-placement");
    const layer = moved.layers.find(item => item.id === "canonical-placement");

    expect(placement).toMatchObject({ start: 4, sourceIn: 3, sourceOut: 5 });
    expect(placement?.legacyData).toMatchObject({ x: 12, volume: 0.4 });
    expect(layer).toMatchObject({ start: 4, sourceIn: 3, sourceOut: 5, x: 12, volume: 0.4 });
    expect(moved.composition?.provenance).toEqual(canonical.provenance);
    expect(moved.composition?.nestedCompositions?.[0]?.id).toBe("embedded-child");
    expect(moved.composition?.nestedCompositions?.[0]?.placements).toEqual([]);

    const withAudio = addClipVersionLayer(moved, {
      id: "new-audio-placement",
      name: "New audio",
      kind: "audio",
      start: 0,
      duration: 1,
      volume: 0.7,
    });
    const audioTrack = withAudio.tracks?.find(track => track.kind === "audio");
    expect(audioTrack).toBeTruthy();
    expect(withAudio.composition?.tracks.map(track => track.id)).toContain(audioTrack?.id);
    expect(withAudio.composition?.placements.find(item => item.id === "new-audio-placement")?.trackId).toBe(audioTrack?.id);
  });

  it("synchronizes inspector property edits into canonical placement metadata", () => {
    const version = addClipVersionLayer(
      structuredClone(sampleProject.shots[0].slots[0].versions[0]),
      {
        id: "inspector-placement",
        name: "Before",
        kind: "video",
        start: 1,
        duration: 3,
        assetId: "source-before",
        sourceIn: 2,
        sourceOut: 5,
        x: 10,
        y: 20,
        width: 70,
        height: 80,
        volume: 0.35,
        fadeIn: 0.5,
      },
    );
    const edited = updateClipVersionLayer(version, "inspector-placement", {
      name: "After",
      assetId: "source-after",
      start: 2,
      duration: 2,
      sourceIn: 4,
      sourceOut: 6,
      x: 30,
      width: 50,
      volume: 0.8,
      fadeIn: 0.25,
    });
    const placement = edited.composition?.placements.find(item => item.id === "inspector-placement");
    expect(placement).toMatchObject({
      name: "After",
      start: 2,
      duration: 2,
      source: { type: "asset", assetId: "source-after" },
      sourceIn: 4,
      sourceOut: 6,
      legacyData: { x: 30, y: 20, width: 50, height: 80, volume: 0.8, fadeIn: 0.25 },
    });
    expect(edited.layers.find(layer => layer.id === "inspector-placement")).toMatchObject({
      name: "After",
      assetId: "source-after",
      start: 2,
      duration: 2,
      sourceIn: 4,
      sourceOut: 6,
      x: 30,
      y: 20,
      width: 50,
      height: 80,
      volume: 0.8,
      fadeIn: 0.25,
    });
    expect(version.composition?.placements.find(item => item.id === "inspector-placement")?.start).toBe(1);
  });

  it("routes inspector edits through Composition validation and clears optional source ranges", () => {
    const base = addClipVersionLayer(
      structuredClone(sampleProject.shots[0].slots[0].versions[0]),
      {
        id: "validated-inspector-layer",
        name: "Before",
        kind: "video",
        start: 0,
        duration: 2,
        assetId: "source-asset",
        sourceIn: 1,
        sourceOut: 3,
      },
    );

    const cleared = updateClipVersionLayer(base, "validated-inspector-layer", {
      sourceIn: undefined,
      sourceOut: undefined,
      start: 1,
    });
    const placement = cleared.composition?.placements.find(item => item.id === "validated-inspector-layer");
    expect(placement).toMatchObject({ start: 1 });
    expect(placement?.sourceIn).toBeUndefined();
    expect(placement?.sourceOut).toBeUndefined();
    const projectedLayer = cleared.layers.find(layer => layer.id === "validated-inspector-layer");
    expect(projectedLayer?.start).toBe(1);
    expect(projectedLayer?.sourceIn).toBeUndefined();
    expect(projectedLayer?.sourceOut).toBeUndefined();
    expect(() => updateClipVersionLayer(base, "validated-inspector-layer", {
      trackId: "missing-track",
    })).toThrow(/track/i);
    expect(base.composition?.placements.find(item => item.id === "validated-inspector-layer")).toMatchObject({
      start: 0,
      sourceIn: 1,
      sourceOut: 3,
    });
  });

  it("preserves canonical Shot Slot and script source references during inspector edits", () => {
    const base = addClipVersionLayer(
      structuredClone(sampleProject.shots[0].slots[0].versions[0]),
      { id: "source-ref-layer", name: "Shot source", kind: "video", start: 0, duration: 2 },
    );
    const shotDocument = structuredClone(base.composition!);
    shotDocument.placements = shotDocument.placements.map(placement => placement.id !== "source-ref-layer" ? placement : ({
      ...placement,
      source: { type: "shot", shotId: "shot-source", slotId: "slot-source", versionId: "shot-version-7" },
      legacyData: { ...placement.legacyData, shotId: "shot-source", slotId: "slot-source", shotVersionId: "shot-version-7" },
    }));
    const shotEdited = updateClipVersionLayer({ ...base, composition: shotDocument }, "source-ref-layer", { x: 44 });
    expect(shotEdited.composition?.placements.find(item => item.id === "source-ref-layer")?.source).toEqual({
      type: "shot", shotId: "shot-source", slotId: "slot-source", versionId: "shot-version-7",
    });

    const scriptDocument = structuredClone(base.composition!);
    scriptDocument.placements = scriptDocument.placements.map(placement => placement.id !== "source-ref-layer" ? placement : ({
      ...placement,
      source: { type: "script", assetId: "script-asset", scriptVersionId: "script-v4" },
      legacyData: { ...placement.legacyData, kind: "procedural", assetId: "script-asset", scriptVersionId: "script-v4" },
    }));
    const scriptEdited = updateClipVersionLayer({ ...base, composition: scriptDocument }, "source-ref-layer", { x: 55 });
    expect(scriptEdited.composition?.placements.find(item => item.id === "source-ref-layer")?.source).toEqual({
      type: "script", assetId: "script-asset", scriptVersionId: "script-v4",
    });
  });

  it("moves a layer to a compatible track and rejects incompatible track kinds", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    const baseTrack = addClipVersionTrack(version, { id: "video-1", name: "Video 1", kind: "video" });
    const tracked = addClipVersionTrack(baseTrack, { id: "video-2", name: "Video 2", kind: "video" });
    const populated = addClipVersionLayer(tracked, { id: "layer-a", name: "Image", kind: "image", start: 0, duration: 2 }, "video-2");
    const defaultVideoTrackId = "video-1";
    const moved = moveClipVersionLayer(populated, "layer-a", defaultVideoTrackId, 3);
    expect(moved.layers.find(layer => layer.id === "layer-a")).toMatchObject({ trackId: defaultVideoTrackId, start: 3 });
    const audio = addClipVersionTrack(moved, { id: "audio-1", name: "Audio", kind: "audio" });
    expect(() => moveClipVersionLayer(audio, "layer-a", "audio-1", 0)).toThrow(/cannot be moved/);
  });
  it("duplicates canonical placements and tracks with remapped linked references while retaining pinned children", () => {
    const base = addClipVersionLayer(
      structuredClone(sampleProject.shots[0].slots[0].versions[0]),
      { id: "source-video", name: "Video", kind: "video", start: 0, duration: 3, assetId: "source-asset", sourceIn: 2, sourceOut: 5 },
    );
    const linked = addClipVersionLayer(base, {
      id: "source-audio", name: "Audio", kind: "audio", start: 0, duration: 3,
      assetId: "audio-asset", sourceIn: 2, sourceOut: 5, linkedVideoClipId: "source-video", volume: 0.6,
    } as unknown as import("./types").CompositionLayer);
    const composition = structuredClone(linked.composition!);
    composition.provenance = {
      kind: "derived-clip-version", sourceProjectId: "project-pin", sourceCompositionId: "source-comp",
      createdAt: "2026-10-20T12:00:00.000Z", pinnedVersions: [{ assetId: "nested-asset", versionId: "nested-v2" }],
    };
    composition.nestedCompositions = [{
      ...structuredClone(composition), id: "pinned-child", tracks: [], placements: [], nestedCompositions: [],
    }];
    const source = { ...linked, composition, layers: linked.layers.map(layer => ({ ...layer })) };
    let n = 0;
    const duplicate = duplicateClipVersionComposition(source, kind => kind + "-copy-" + (++n));
    const duplicatedDoc = duplicate.composition!;
    expect(duplicatedDoc.id).not.toBe(composition.id);
    const sourcePlacementIds = new Set(composition.placements.map(item => item.id));
    const sourceTrackIds = new Set(composition.tracks.map(item => item.id));
    expect(duplicatedDoc.placements.every(item => !sourcePlacementIds.has(item.id))).toBe(true);
    expect(duplicatedDoc.tracks.every(item => !sourceTrackIds.has(item.id))).toBe(true);
    expect(duplicatedDoc.placements.every(item => duplicatedDoc.tracks.some(track => track.id === item.trackId))).toBe(true);
    const duplicatedVideo = duplicate.layers.find(layer => layer.name === "Video")!;
    const duplicatedAudio = duplicate.layers.find(layer => layer.name === "Audio")!;
    expect(duplicatedAudio.id).not.toBe("source-audio");
    expect((duplicatedAudio as unknown as Record<string, unknown>).linkedVideoClipId).toBe(duplicatedVideo.id);
    const audioPlacement = duplicatedDoc.placements.find(item => item.id === duplicatedAudio.id)!;
    expect(audioPlacement.linkedToPlacementId).toBe(duplicatedVideo.id);
    expect(audioPlacement.legacyData).toMatchObject({ linkedVideoClipId: duplicatedVideo.id, volume: 0.6 });
    expect(audioPlacement).toMatchObject({ sourceIn: 2, sourceOut: 5 });
    expect(duplicatedDoc.provenance).toEqual(composition.provenance);
    expect(duplicatedDoc.nestedCompositions?.[0]?.id).toBe("pinned-child");
    expect(duplicatedDoc.nestedCompositions?.[0]?.placements).toEqual([]);
    expect(source.composition?.placements.map(item => item.id)).toEqual(composition.placements.map(item => item.id));
  });

  it("duplicates legacy-only versions without breaking linked layer references", () => {
    const version = structuredClone(sampleProject.shots[0].slots[0].versions[0]);
    version.composition = undefined;
    version.tracks = [{ id: "legacy-video-track", name: "Video", kind: "video" }, { id: "legacy-audio-track", name: "Audio", kind: "audio" }];
    version.layers = [
      { id: "legacy-video", name: "Video", kind: "video", trackId: "legacy-video-track", start: 0, duration: 2 },
      { id: "legacy-audio", name: "Audio", kind: "audio", trackId: "legacy-audio-track", start: 0, duration: 2, linkedVideoClipId: "legacy-video" } as unknown as import("./types").CompositionLayer,
    ];
    let n = 0;
    const duplicate = duplicateClipVersionComposition(version, kind => kind + "-legacy-copy-" + (++n));
    expect(duplicate.layers[0].id).not.toBe("legacy-video");
    expect((duplicate.layers[1] as unknown as Record<string, unknown>).linkedVideoClipId).toBe(duplicate.layers[0].id);
    expect(duplicate.layers[0].trackId).not.toBe("legacy-video-track");
    expect(duplicate.layers[1].trackId).not.toBe("legacy-audio-track");
    expect(duplicate.composition).toBeDefined();
    expect(duplicate.composition?.placements).toHaveLength(2);
    expect(duplicate.composition?.placements.find(item => item.id === duplicate.layers[1].id)?.linkedToPlacementId).toBe(duplicate.layers[0].id);
    expect(version.composition).toBeUndefined();
  });

});
