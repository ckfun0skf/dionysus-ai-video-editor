import { describe, expect, it } from "vitest";
import { collectCompositionLayers, getCompositionDuration } from "./compositionRenderer";
import { sampleProject } from "./sampleProject";

describe("compositionRenderer", () => {
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
    }];
    const layers = collectCompositionLayers(project);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({ id: "audio-clip", kind: "audio", start: 2, duration: 4, assetId: "audio-asset", muted: true, volume: 0.4, fadeIn: 0.5, fadeOut: 1 });
    expect(layers.find(layer => layer.id === "master-video-clip")).toMatchObject({ sourceIn: 1.5, sourceOut: 6, shortSourceBehavior: "loop", fitMode: "cover" });
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
});
