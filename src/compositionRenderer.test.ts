import { describe, expect, it } from "vitest";
import { collectCompositionLayers, getCompositionDuration, isPlayableAudioLayer, waitForVideoFrame } from "./compositionRenderer";
import { sampleProject } from "./sampleProject";
import { migrateLegacyProjectToComposition } from "./compositionMigration";
import type { ClipVersion } from "./types";

describe("compositionRenderer", () => {
  it("waits for decoded video data instead of treating loaded metadata as a drawable frame", async () => {
    let readyState = 1;
    const video = new EventTarget() as HTMLVideoElement;
    Object.defineProperty(video, "readyState", { configurable: true, get: () => readyState });
    let completed = false;
    const waiting = waitForVideoFrame(video).then(() => { completed = true; });

    await Promise.resolve();
    expect(completed).toBe(false);

    readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    await waiting;
    expect(completed).toBe(true);
  });
  it("prefers canonical nested Composition placements over stale compatibility layers", () => {
    const project = structuredClone(sampleProject);
    const shot = project.shots[0];
    const slotVersion = shot.slots[0].versions[0];
    slotVersion.layers = [{ id: "canonical-shot-layer", name: "Canonical shot layer", kind: "text", start: 0, duration: 2 }];
    const shotDocument = migrateLegacyProjectToComposition(project).legacyShotSlotCompositions.find(document =>
      document.legacyData?.shotId === shot.id &&
      document.legacyData?.slotId === shot.slots[0].id &&
      document.legacyData?.versionId === slotVersion.id
    );
    expect(shotDocument).toBeDefined();
    slotVersion.composition = structuredClone(shotDocument!);
    slotVersion.layers = [{ id: "stale-shot-layer", name: "Stale projection", kind: "text", start: 0, duration: 2 }];

    const clipVersion: ClipVersion = {
      id: "canonical-clip-version",
      name: "Canonical clip version",
      description: "",
      duration: 2,
      layers: [{ id: "canonical-clip-layer", name: "Canonical clip layer", kind: "text" as const, start: 0, duration: 2 }],
      scriptVersionIds: [],
      generationRecords: [],
    };
    project.assets.push({
      id: "canonical-clip-asset",
      name: "Canonical clip",
      kind: "clip",
      selectedClipVersionId: clipVersion.id,
      clipVersions: [clipVersion],
    });
    const clipDocument = migrateLegacyProjectToComposition(project).clipCompositions.find(document =>
      document.legacyData?.assetId === "canonical-clip-asset" &&
      document.legacyData?.clipVersionId === clipVersion.id
    );
    expect(clipDocument).toBeDefined();
    clipVersion.composition = structuredClone(clipDocument!);
    clipVersion.layers = [{ id: "stale-clip-layer", name: "Stale projection", kind: "text", start: 0, duration: 2 }];
    project.timelineClips = [{
      id: "canonical-clip-instance",
      name: "Canonical clip instance",
      kind: "clip",
      trackId: "track-video-1",
      start: 5,
      duration: 2,
      assetId: "canonical-clip-asset",
      clipVersionId: clipVersion.id,
    }];

    const layers = collectCompositionLayers(project);
    expect(layers).toContainEqual(expect.objectContaining({
      id: "canonical-shot-layer",
      name: "Canonical shot layer",
      kind: "text",
    }));
    expect(layers).toContainEqual(expect.objectContaining({
      id: "canonical-clip-instance:canonical-clip-layer:0",
      name: "Canonical clip layer",
      kind: "text",
      start: 5,
    }));
    expect(layers.some(layer => layer.id === "stale-shot-layer" || layer.id.includes("stale-clip-layer"))).toBe(false);
  });

  it("renders canonical linked-audio children for nested Shot and Slot Versions", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({
      id: "nested-video-source",
      name: "Nested video",
      kind: "video",
      path: "data:video/webm;base64,AA==",
    });
    const shot = project.shots[0];
    const slot = shot.slots[0];
    const version = slot.versions[0];
    version.layers = [{
      id: "nested-video-owner",
      name: "Nested video owner",
      kind: "video",
      start: 0,
      duration: 2,
      assetId: "nested-video-source",
    }];
    const migrated = migrateLegacyProjectToComposition(project);
    const canonical = migrated.legacyShotSlotCompositions.find(document =>
      document.legacyData?.shotId === shot.id &&
      document.legacyData?.slotId === slot.id &&
      document.legacyData?.versionId === version.id
    );
    expect(canonical).toBeDefined();
    version.composition = structuredClone(canonical!);
    version.composition.placements[0].linkedAudioChildren = [{
      id: "nested-linked-audio",
      name: "Nested linked audio",
      source: { type: "asset", assetId: "nested-video-source" },
      sourceIn: 0,
      sourceOut: 2,
      muted: true,
      volume: 0.4,
      legacyData: {
        kind: "audio",
        assetId: "stale-audio-source",
        linkedVideoClipId: "nested-video-owner",
      },
    }];
    version.composition.tracks.push({
      id: "nested-muted-audio-track",
      name: "Muted Audio",
      kind: "audio",
      order: version.composition.tracks.length,
      muted: true,
      legacyData: { kind: "audio", muted: true },
    });
    version.composition.placements.push({
      id: "nested-muted-track-audio",
      name: "Audio on muted track",
      trackId: "nested-muted-audio-track",
      start: 0,
      duration: 2,
      order: version.composition.placements.length,
      source: { type: "asset", assetId: "nested-video-source" },
      legacyData: { kind: "audio", assetId: "nested-video-source" },
    });

    const layers = collectCompositionLayers(project);
    const linkedAudio = layers.find(layer => layer.id === "nested-linked-audio");
    expect(linkedAudio).toMatchObject({
      kind: "audio",
      assetId: "nested-video-source",
      linkedVideoClipId: "nested-video-owner",
      start: 0,
      duration: 2,
      sourceIn: 0,
      sourceOut: 2,
      muted: true,
      volume: 0.4,
    });
    expect(isPlayableAudioLayer(linkedAudio!, project.assets.find(asset => asset.id === "nested-video-source"))).toBe(true);
    expect(layers.find(layer => layer.id === "nested-muted-track-audio")).toMatchObject({
      kind: "audio",
      muted: true,
      assetId: "nested-video-source",
    });
  });

  it("collects selected-version layers with absolute shot and slot offsets", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].slots[0].versions[0].layers = [{ id: "layer-selected", name: "Selected layer", kind: "image", start: 1, duration: 2 }];
    project.shots[0].slots[0].versions.push({
      id: "version-unselected", name: "Version B", description: "not selected", duration: 4,
      layers: [{ id: "layer-unselected", name: "Wrong version", kind: "text", start: 0, duration: 1 }],
      scriptVersionIds: [], generationRecords: []
    });
    project.shots[1].slots[0].versions[0].layers = [{ id: "layer-later-shot", name: "Later shot layer", kind: "text", start: 1, duration: 1 }];
    project.shots[1].masterStart = 20;
    const layers = collectCompositionLayers(project);
    expect(layers.map(layer => layer.id)).toEqual(["layer-selected", "layer-later-shot"]);
    expect(layers.find(layer => layer.id === "layer-selected")?.start).toBe(1);
    expect(layers.find(layer => layer.id === "layer-later-shot")?.start).toBe(21);
  });

  it("preserves stored Version layer order instead of sorting by start time", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].slots[0].versions[0].layers = [
      { id: "top-layer", name: "Top layer", kind: "image", start: 4, duration: 2 },
      { id: "bottom-layer", name: "Bottom layer", kind: "image", start: 0, duration: 6 }
    ];
    const layers = collectCompositionLayers(project);
    expect(layers.slice(0, 2).map(layer => layer.id)).toEqual(["top-layer", "bottom-layer"]);
    expect(layers.map(layer => layer.start)).toEqual([4, 0]);
  });

  it("includes referenced master timeline clips and their media type", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({ id: "audio-asset", name: "Bed", kind: "audio", path: "data:audio/wav;base64,AA==" });
    project.assets.push({ id: "video-asset", name: "Storyboard video", kind: "video", path: "data:video/webm;base64,AA==" });
    project.timelineClips = [{
      id: "audio-clip", name: "Music bed", kind: "audio", trackId: "track-audio-1",
      start: 2, duration: 4, assetId: "audio-asset", sourceIn: 0, sourceOut: 4, muted: true, volume: 0.4, fadeIn: 0.5, fadeOut: 1
    }, {
      id: "master-video-clip", name: "Master video clip", kind: "video", trackId: "track-video-1",
      start: 0, duration: 4, assetId: "video-asset", sourceIn: 1.5, sourceOut: 6, shortSourceBehavior: "loop", fitMode: "cover"
    }, {
      id: "linked-video-audio", name: "Master video clip audio", kind: "audio", trackId: "track-audio-1",
      start: 0, duration: 4, assetId: "video-asset", linkedVideoClipId: "master-video-clip", sourceIn: 1.5, sourceOut: 5.5
    }];
    const layers = collectCompositionLayers(project);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toMatchObject({ id: "audio-clip", kind: "audio", start: 2, duration: 4, assetId: "audio-asset", muted: true, volume: 0.4, fadeIn: 0.5, fadeOut: 1 });
    expect(layers.find(layer => layer.id === "master-video-clip")).toMatchObject({ sourceIn: 1.5, sourceOut: 6, shortSourceBehavior: "loop", fitMode: "cover" });
    const linkedAudio = layers.find(layer => layer.id === "linked-video-audio")!;
    expect(linkedAudio).toMatchObject({ kind: "audio", assetId: "video-asset", linkedVideoClipId: "master-video-clip", sourceIn: 1.5 });
    expect(isPlayableAudioLayer(linkedAudio, project.assets.find(asset => asset.id === "video-asset"))).toBe(true);
    expect(isPlayableAudioLayer(linkedAudio, project.assets.find(asset => asset.id === "audio-asset"))).toBe(true);
    expect(isPlayableAudioLayer({ kind: "audio" }, project.assets.find(asset => asset.id === "video-asset"))).toBe(true); // Extracted child audio remains playable without an ownership link.
    expect(isPlayableAudioLayer({ kind: "video" }, project.assets.find(asset => asset.id === "video-asset"))).toBe(false);
  });

  it("includes source-free Text blocks and procedural blocks, without pretending to render procedural code", () => {
    const project = structuredClone(sampleProject);
    project.timelineClips = [
      { id: "title-block", name: "A title", kind: "text", trackId: "track-text-1", start: 1, duration: 2 },
      { id: "threejs-block", name: "Code clip", kind: "procedural", trackId: "track-procedural-1", start: 0, duration: 4, scriptVersionId: "script-version-1", html: "<canvas></canvas>", css: "canvas{width:100%}", code: "console.log(1)" }
    ];
    const layers = collectCompositionLayers(project);
    expect(layers).toContainEqual(expect.objectContaining({ id: "title-block", name: "A title", kind: "text", start: 1, duration: 2 }));
    expect(layers).toContainEqual(expect.objectContaining({ id: "threejs-block", kind: "procedural", scriptVersionId: "script-version-1", html: "<canvas></canvas>", css: "canvas{width:100%}", code: "console.log(1)" }));
  });

  it("expands reusable clip assets into multiple timed layers and repeats them when requested", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({
      id: "reusable-clip", name: "Code and audio bumper", kind: "clip", selectedClipVersionId: "clip-v1",
      clipVersions: [{
        id: "clip-v1", name: "Version A", description: "", duration: 3,
        layers: [
          { id: "code-layer", name: "Particle animation", kind: "procedural", start: 0, duration: 3, html: "<canvas></canvas>", css: "", code: "render()" },
          { id: "audio-layer", name: "Sound bed", kind: "audio", start: 0.5, duration: 2.5, assetId: "audio-inside-clip", volume: 0.7 }
        ],
        scriptVersionIds: [], generationRecords: []
      }]
    });
    project.assets.push({ id: "audio-inside-clip", name: "Sound bed", kind: "audio", path: "data:audio/wav;base64,AA==" });
    project.timelineClips = [{
      id: "clip-instance", name: "Bumper", kind: "clip", trackId: "track-video-1",
      start: 4, duration: 6, assetId: "reusable-clip", shortSourceBehavior: "loop"
    }];
    const layers = collectCompositionLayers(project);
    expect(layers).toHaveLength(4);
    expect(layers.map(layer => layer.start).sort((a, b) => a - b)).toEqual([4, 4.5, 7, 7.5]);
    expect(layers.filter(layer => layer.kind === "procedural")).toHaveLength(2);
    expect(layers.filter(layer => layer.kind === "audio").every(layer => layer.assetId === "audio-inside-clip")).toBe(true);
  });

  it("calculates output duration from the last visible layer end", () => {
    expect(getCompositionDuration([
      { id: "a", name: "a", kind: "image", start: 0, duration: 3 },
      { id: "b", name: "b", kind: "text", start: 2.5, duration: 4 }
    ])).toBe(6.5);
  });
  it("uses the pinned Clip Version when a Clip Asset is placed on the Master Timeline", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({
      id: "multi-version-clip", name: "Multi-version clip", kind: "clip",
      selectedClipVersionId: "clip-version-b",
      clipVersions: [
        { id: "clip-version-a", name: "Version A", description: "", duration: 3,
          layers: [{ id: "clip-layer-a", name: "A layer", kind: "text", start: 0, duration: 3 }],
          scriptVersionIds: [], generationRecords: [] },
        { id: "clip-version-b", name: "Version B", description: "", duration: 4,
          layers: [{ id: "clip-layer-b", name: "B layer", kind: "image", start: 0, duration: 4, assetId: "image-b" }],
          scriptVersionIds: [], generationRecords: [] }
      ]
    });
    project.assets.push({ id: "image-b", name: "Image B", kind: "image", path: "data:image/png;base64,AA==" });
    project.timelineClips = [{
      id: "master-clip-a", name: "Pinned Version A", kind: "clip", trackId: "track-video-1",
      start: 2, duration: 3, assetId: "multi-version-clip", clipVersionId: "clip-version-a"
    }];
    const layers = collectCompositionLayers(project);
    expect(layers).toContainEqual(expect.objectContaining({
      id: "master-clip-a:clip-layer-a:0", name: "A layer", kind: "text", start: 2, duration: 3
    }));
    expect(layers.some(layer => layer.id.includes("clip-layer-b"))).toBe(false);
  });

  it("keeps a nested Clip reference pinned to its selected child Version", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({
      id: "parent-clip", name: "Parent", kind: "clip",
      selectedClipVersionId: "parent-v1",
      clipVersions: [{
        id: "parent-v1", name: "Version A", description: "", duration: 5,
        layers: [{
          id: "nested-module", name: "Child Clip", kind: "composition", start: 1, duration: 3,
          assetId: "child-clip", childCompositionId: "child-clip", clipVersionId: "child-v1"
        }],
        scriptVersionIds: [], generationRecords: []
      }]
    });
    project.assets.push({
      id: "child-clip", name: "Child", kind: "clip", selectedClipVersionId: "child-v2",
      clipVersions: [
        { id: "child-v1", name: "Version A", description: "", duration: 2,
          layers: [{ id: "child-a", name: "Pinned child", kind: "text", start: 0, duration: 2 }],
          scriptVersionIds: [], generationRecords: [] },
        { id: "child-v2", name: "Version B", description: "", duration: 4,
          layers: [{ id: "child-b", name: "Unpinned child", kind: "text", start: 0, duration: 4 }],
          scriptVersionIds: [], generationRecords: [] }
      ]
    });
    project.timelineClips = [{
      id: "master-parent", name: "Parent instance", kind: "clip", trackId: "track-video-1",
      start: 0, duration: 5, assetId: "parent-clip", clipVersionId: "parent-v1"
    }];
    const layers = collectCompositionLayers(project);
    const nested = layers.find(layer => layer.id === "master-parent:nested-module:0");
    expect(nested).toMatchObject({ kind: "composition", childCompositionId: "child-clip", clipVersionId: "child-v1" });
    expect(layers.some(layer => layer.id.includes("child-b"))).toBe(false);
  });

  it("uses clip frame transforms or parent Video Layer geometry for master clips", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({ id: "frame-image", name: "Frame image", kind: "image", path: "data:image/png;base64,AA==" });
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    videoTrack.x = 10;
    videoTrack.y = 15;
    videoTrack.width = 55;
    videoTrack.height = 60;
    project.timelineClips = [{
      id: "transformed-image-clip",
      name: "Transformed image",
      kind: "video",
      trackId: videoTrack.id,
      start: 0,
      duration: 2,
      assetId: "frame-image",
      x: 20,
      y: 25,
      width: 30,
      height: 35
    }];
    expect(collectCompositionLayers(project).find(layer => layer.id === "transformed-image-clip"))
      .toMatchObject({ x: 20, y: 25, width: 30, height: 35 });
    delete project.timelineClips![0].x;
    delete project.timelineClips![0].y;
    delete project.timelineClips![0].width;
    delete project.timelineClips![0].height;
    expect(collectCompositionLayers(project).find(layer => layer.id === "transformed-image-clip"))
      .toMatchObject({ x: 10, y: 15, width: 55, height: 60 });
  });

});
