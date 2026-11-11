import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { migrateLegacyProjectToComposition } from "./compositionMigration";
import { createCompositionSnapshot } from "./compositionSnapshot";
import type { DionysusProject } from "./types";

function fixture(): DionysusProject {
  const project = structuredClone(sampleProject);
  const trackId = project.tracks[0].id;
  project.timelineClips = [
    { id: "snap-clip-a", name: "A", kind: "video", trackId, start: 0, duration: 4, sourceIn: 1, sourceOut: 5 },
    { id: "snap-clip-b", name: "B", kind: "audio", trackId, start: 0, duration: 4, sourceIn: 1, sourceOut: 5, linkedVideoClipId: "snap-clip-a" },
  ];
  return project;
}

function originId(placement: { legacyData: Record<string, unknown> }): string {
  return (placement.legacyData.snapshotOrigin as { placementId: string }).placementId;
}

describe("structure-preserving Composition snapshot", () => {
  it("preserves tracks, placement order, timing and source ranges", () => {
    const project = fixture();
    const root = migrateLegacyProjectToComposition(project).rootComposition;
    const { composition } = createCompositionSnapshot(project, { snapshotId: "snap-1" });
    expect(composition.tracks.map(track => [track.name, track.kind, track.order])).toEqual(root.tracks.map(track => [track.name, track.kind, track.order]));
    expect(composition.placements.map(placement => originId(placement))).toEqual(root.placements.map(placement => placement.id));
    for (const [index, placement] of composition.placements.entries()) {
      const source = root.placements[index];
      expect([placement.name, placement.start, placement.duration, placement.order, placement.sourceIn, placement.sourceOut]).toEqual(
        [source.name, source.start, source.duration, source.order, source.sourceIn, source.sourceOut],
      );
    }
    expect([composition.duration, composition.frameRate, composition.width, composition.height]).toEqual([root.duration, root.frameRate, root.width, root.height]);
  });

  it("assigns fresh IDs and remaps track and linked-placement relationships", () => {
    const project = fixture();
    const snapshot = createCompositionSnapshot(project, { snapshotId: "snap-2" });
    const sourceIds = new Set([...project.tracks.map(track => track.id), ...migrateLegacyProjectToComposition(project).rootComposition.placements.map(placement => placement.id)]);
    const trackIds = new Set(snapshot.composition.tracks.map(track => track.id));
    for (const track of snapshot.composition.tracks) expect(sourceIds.has(track.id)).toBe(false);
    for (const placement of snapshot.composition.placements) {
      expect(sourceIds.has(placement.id)).toBe(false);
      expect(trackIds.has(placement.trackId)).toBe(true);
    }
    const audio = snapshot.composition.placements.find(placement => originId(placement) === "snap-clip-b");
    expect(audio?.linkedToPlacementId).toBe(snapshot.placementIdMap["snap-clip-a"]);
    expect(snapshot.warnings).toEqual([]);
  });

  it("is independent of the source project in both directions", () => {
    const project = fixture();
    const projectBefore = JSON.stringify(project);
    const snapshot = createCompositionSnapshot(project, { snapshotId: "snap-3" });
    expect(JSON.stringify(project)).toBe(projectBefore);

    const snapshotBefore = JSON.stringify(snapshot.composition);
    project.timelineClips![0].duration = 99;
    project.tracks[0].name = "Changed after snapshot";
    expect(JSON.stringify(snapshot.composition)).toBe(snapshotBefore);

    const projectAfterEdit = JSON.stringify(project);
    snapshot.composition.placements[0].duration = 123;
    snapshot.composition.tracks[0].name = "Edited snapshot";
    expect(JSON.stringify(project)).toBe(projectAfterEdit);
  });

  it("is deterministic and survives a JSON round trip", () => {
    const project = fixture();
    const first = createCompositionSnapshot(project, { snapshotId: "snap-4" });
    const second = createCompositionSnapshot(project, { snapshotId: "snap-4" });
    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it("pins a Clip placement to the asset's selected version", () => {
    const project = fixture();
    project.assets.push({
      id: "snap-clip-asset", name: "Reusable", kind: "clip", selectedClipVersionId: "snap-v2",
      clipVersions: ["snap-v1", "snap-v2"].map(versionId => ({ id: versionId, name: versionId, description: "", duration: 3, layers: [], scriptVersionIds: [], generationRecords: [] })),
    });
    project.timelineClips!.push({ id: "snap-clip-c", name: "C", kind: "clip", trackId: project.tracks[0].id, start: 5, duration: 3, assetId: "snap-clip-asset" });
    const snapshot = createCompositionSnapshot(project, { snapshotId: "snap-5" });
    const placement = snapshot.composition.placements.find(candidate => originId(candidate) === "snap-clip-c");
    expect(placement?.source).toEqual({ type: "clip", assetId: "snap-clip-asset", versionId: "snap-v2" });
  });

  it("warns instead of guessing when a Clip version cannot be pinned", () => {
    const project = fixture();
    project.assets.push({
      id: "snap-unpinned-asset", name: "Unpinned", kind: "clip",
      clipVersions: [{ id: "snap-u1", name: "U1", description: "", duration: 3, layers: [], scriptVersionIds: [], generationRecords: [] }],
    });
    project.timelineClips!.push({ id: "snap-clip-d", name: "D", kind: "clip", trackId: project.tracks[0].id, start: 5, duration: 3, assetId: "snap-unpinned-asset" });
    const snapshot = createCompositionSnapshot(project, { snapshotId: "snap-6" });
    expect(snapshot.warnings.map(warning => [warning.code, warning.entityId])).toContainEqual(["unpinned-source", "snap-clip-d"]);
    const placement = snapshot.composition.placements.find(candidate => originId(candidate) === "snap-clip-d");
    expect(placement?.source).toEqual({ type: "clip", assetId: "snap-unpinned-asset" });
  });

  it("retains missing sources and reports them", () => {
    const project = fixture();
    project.timelineClips!.push({ id: "snap-clip-e", name: "E", kind: "video", trackId: project.tracks[0].id, start: 6, duration: 2, assetId: "does-not-exist" });
    const snapshot = createCompositionSnapshot(project, { snapshotId: "snap-7" });
    const placement = snapshot.composition.placements.find(candidate => originId(candidate) === "snap-clip-e");
    expect(placement?.source).toMatchObject({ type: "missing", originalId: "does-not-exist" });
    expect(snapshot.warnings.map(warning => [warning.code, warning.entityId])).toContainEqual(["missing-source", "snap-clip-e"]);
  });
});
