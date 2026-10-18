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
    const layers = collectCompositionLayers(project);
    expect(layers.map(layer => layer.id)).toEqual(["layer-selected", "layer-later-shot"]);
    expect(layers.find(layer => layer.id === "layer-selected")?.start).toBe(1);
    expect(layers.find(layer => layer.id === "layer-later-shot")?.start).toBe(project.shots[0].duration + 1);
  });

  it("includes referenced master timeline clips and their media type", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({ id: "audio-asset", name: "Bed", kind: "audio", path: "data:audio/wav;base64,AA==" });
    project.assets.push({ id: "video-asset", name: "Storyboard video", kind: "video", path: "data:video/webm;base64,AA==" });
    project.timelineClips = [{
      id: "audio-clip", name: "Music bed", kind: "audio", trackId: "track-audio-1",
      start: 2, duration: 4, assetId: "audio-asset", sourceIn: 0, sourceOut: 4
    }, {
      id: "storyboard-shot-slot-layer", name: "Synced storyboard copy", kind: "video", trackId: "track-video-1",
      start: 0, duration: 4, assetId: "video-asset"
    }];
    const layers = collectCompositionLayers(project);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ id: "audio-clip", kind: "audio", start: 2, duration: 4, assetId: "audio-asset" });
  });

  it("calculates output duration from the last visible layer end", () => {
    expect(getCompositionDuration([
      { id: "a", name: "a", kind: "image", start: 0, duration: 3 },
      { id: "b", name: "b", kind: "text", start: 2.5, duration: 4 }
    ])).toBe(6.5);
  });
});
