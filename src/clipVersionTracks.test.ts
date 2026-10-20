import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { addClipVersionLayer, addClipVersionTrack, deleteClipVersionLayer, moveClipVersionLayer, normalizeClipVersionTracks } from "./clipVersionTracks";
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

    const moved = moveClipVersionLayer(saved, "canonical-placement", withPlacement.layers[0]?.trackId ?? saved.tracks![0].id, 4);
    const placement = moved.composition?.placements.find(item => item.id === "canonical-placement");
    const layer = moved.layers.find(item => item.id === "canonical-placement");

    expect(placement).toMatchObject({ start: 4, sourceIn: 3, sourceOut: 5 });
    expect(placement?.legacyData).toMatchObject({ x: 12, volume: 0.4 });
    expect(layer).toMatchObject({ start: 4, sourceIn: 3, sourceOut: 5, x: 12, volume: 0.4 });
    expect(moved.composition?.provenance).toEqual(canonical.provenance);
    expect(moved.composition?.nestedCompositions?.[0]?.id).toBe("embedded-child");
    expect(moved.composition?.nestedCompositions?.[0]?.placements).toEqual([]);
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
});
