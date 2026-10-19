import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { createCompositionSnapshot } from "./compositionSnapshot";
import { compositionSnapshotToClipVersion } from "./compositionSnapshotToClipVersion";
import type { DionysusProject } from "./types";

function fixture(): DionysusProject {
  const project = structuredClone(sampleProject);
  const videoTrack = project.tracks.find(track => track.kind === "video")!;
  const audioTrack = project.tracks.find(track => track.kind === "audio") ?? project.tracks[0];
  project.timelineClips = [
    { id: "snapshot-video", name: "Video source", kind: "video", trackId: videoTrack.id, start: 1, duration: 5, sourceIn: 2, sourceOut: 7 },
    { id: "snapshot-audio", name: "Linked audio", kind: "audio", trackId: audioTrack.id, start: 1, duration: 5, sourceIn: 2, sourceOut: 7, linkedVideoClipId: "snapshot-video" },
  ];
  return project;
}

describe("Composition snapshot to ClipVersion bridge", () => {
  it("stores canonical track/placement data, linked audio and source ranges", () => {
    const project = fixture();
    const snapshot = createCompositionSnapshot(project, { snapshotId: "bridge-test" });
    const version = compositionSnapshotToClipVersion(snapshot, project, { versionId: "version-test", name: "Snapshot", description: "Test" });
    expect(version.compositionDocument).toEqual(snapshot.composition);
    expect(version.tracks?.map(track => [track.id, track.name, track.kind])).toEqual(snapshot.composition.tracks.map(track => [track.id, track.name, track.kind]));
    expect(version.layers.map(layer => [layer.name, layer.start, layer.duration, layer.trackId, layer.sourceIn, layer.sourceOut])).toEqual(
      snapshot.composition.placements.map(p => [p.name, p.start, p.duration, p.trackId, p.sourceIn, p.sourceOut]),
    );
    const audio = version.compositionDocument!.placements.find(p => p.name === "Linked audio")!;
    const video = version.compositionDocument!.placements.find(p => p.name === "Video source")!;
    expect(audio.linkedToPlacementId).toBe(video.id);
  });

  it("retains pinned nested Clip version references", () => {
    const project = fixture();
    project.assets.push({ id: "nested-asset", name: "Nested", kind: "clip", selectedClipVersionId: "nested-v2",
      clipVersions: [{ id: "nested-v2", name: "V2", description: "", duration: 3, layers: [], scriptVersionIds: [], generationRecords: [] }] });
    project.timelineClips!.push({ id: "nested-placement", name: "Nested placement", kind: "clip", trackId: project.tracks[0].id, start: 8, duration: 3, assetId: "nested-asset", clipVersionId: "nested-v2" });
    const snapshot = createCompositionSnapshot(project, { snapshotId: "bridge-nested" });
    const version = compositionSnapshotToClipVersion(snapshot, project, { versionId: "version-nested", name: "Snapshot", description: "Nested" });
    expect(version.compositionDocument!.placements.find(p => p.name === "Nested placement")?.source).toEqual({ type: "clip", assetId: "nested-asset", versionId: "nested-v2" });
    expect(version.layers.find(layer => layer.name === "Nested placement")).toMatchObject({ kind: "composition", childCompositionId: "nested-asset", clipVersionId: "nested-v2" });
  });

  it("keeps the snapshot independent from source-project edits", () => {
    const project = fixture();
    const before = JSON.stringify(project);
    const snapshot = createCompositionSnapshot(project, { snapshotId: "bridge-independent" });
    const version = compositionSnapshotToClipVersion(snapshot, project, { versionId: "version-independent", name: "Snapshot", description: "Independent" });
    expect(JSON.stringify(project)).toBe(before);
    version.compositionDocument!.tracks[0].name = "Edited snapshot";
    expect(JSON.stringify(project)).toBe(before);
    expect(snapshot.composition.tracks[0].name).not.toBe("Edited snapshot");
  });
});
