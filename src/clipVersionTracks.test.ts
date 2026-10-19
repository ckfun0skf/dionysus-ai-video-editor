import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { normalizeClipVersionTracks } from "./clipVersionTracks";
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
