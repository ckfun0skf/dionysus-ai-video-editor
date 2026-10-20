import { describe, expect, it } from "vitest";
import type { DionysusProject, GenerationRecord } from "./types";
import { createClipVersionSnapshot } from "./clipVersionSnapshot";

function fixture(): DionysusProject {
  const generation: GenerationRecord = {
    id: "generation-1",
    createdAt: "2026-10-20T10:00:00.000Z",
    prompt: "Keep the same character design",
    referenceSnapshot: [{ id: "ref-1", assetId: "ref-image", role: "identity" }],
    modelName: "model-x",
    modelVersion: "v2",
    outputAssetId: "render-1",
  };
  return {
    schemaVersion: "1.0",
    id: "project-1",
    name: "Demo",
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    frameRate: 24,
    width: 1280,
    height: 720,
    tracks: [
      { id: "video-track", name: "Video", kind: "video", x: 10, y: 15, width: 80, height: 75 },
      { id: "audio-track", name: "Audio", kind: "audio", muted: false },
    ],
    timelineClips: [{
      id: "nested-placement",
      name: "Pinned nested clip",
      kind: "clip",
      trackId: "video-track",
      start: 5,
      duration: 3,
      assetId: "nested-asset",
      clipVersionId: "nested-v2",
      sourceIn: 1,
      sourceOut: 4,
      x: 12,
      y: 14,
      width: 55,
      height: 66,
      volume: 0.4,
      fadeIn: 0.25,
      fadeOut: 0.5,
    }],
    assets: [
      { id: "media", name: "Media", kind: "video", path: "/media.mp4" },
      {
        id: "nested-asset",
        name: "Nested",
        kind: "clip",
        canvasWidth: 640,
        canvasHeight: 360,
        selectedClipVersionId: "nested-v2",
        clipVersions: [{
          id: "nested-v2",
          name: "Version 2",
          description: "Pinned version",
          duration: 4,
          layers: [{ id: "inner-layer", name: "Inner", kind: "video", start: 0, duration: 4, assetId: "media", sourceIn: 2, sourceOut: 6, x: 3, y: 4, width: 70, height: 80, opacity: 0.75, volume: 0.6 }],
          tracks: [{ id: "nested-video", name: "Nested video", kind: "video" }],
          scriptVersionIds: [],
          generationRecords: [],
        }],
      },
    ],
    referenceProfiles: [],
    shots: [{
      id: "shot-1",
      title: "Shot 1",
      intent: "Preserve identity",
      duration: 4,
      masterStart: 0,
      masterTrackId: "video-track",
      status: "ready",
      referenceProfileIds: [],
      referenceOverrides: [],
      slots: [{
        id: "slot-1",
        name: "Main",
        start: 0,
        duration: 4,
        selectedVersionId: "shot-version-1",
        versions: [{
          id: "shot-version-1",
          name: "Shot version",
          description: "Generated source",
          duration: 4,
          layers: [{ id: "shot-layer", name: "Generated", kind: "video", start: 0, duration: 4, assetId: "media" }],
          scriptVersionIds: ["script-version-1"],
          generationRecords: [generation],
        }],
      }],
    }],
  };
}

describe("structure-preserving Clip Version snapshots", () => {
  it("preserves tracks, placement order, source ranges, transforms, mix, pinned versions and provenance", () => {
    const project = fixture();
    const before = JSON.stringify(project);
    const version = createClipVersionSnapshot(project, {
      assetId: "snapshot-asset",
      versionId: "snapshot-version",
      versionName: "Version A",
      createdAt: "2026-10-20T11:00:00.000Z",
    });

    expect(JSON.stringify(project)).toBe(before);
    expect(version.tracks?.map(track => track.id)).toEqual(["video-track", "audio-track"]);
    expect(version.composition?.tracks.map(track => track.id)).toEqual(["video-track", "audio-track"]);
    const placement = version.composition?.placements.find(item => item.id === "nested-placement");
    expect(placement).toBeTruthy();
    expect(placement?.order).toBeGreaterThanOrEqual(0);
    expect(placement?.source).toEqual({ type: "clip", assetId: "nested-asset", versionId: "nested-v2" });
    expect(placement?.sourceIn).toBe(1);
    expect(placement?.sourceOut).toBe(4);
    expect(placement?.legacyData).toMatchObject({ x: 12, y: 14, width: 55, height: 66, volume: 0.4, fadeIn: 0.25, fadeOut: 0.5 });
    expect(version.composition?.nestedCompositions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "composition:nested-asset:nested-v2",
        placements: expect.arrayContaining([expect.objectContaining({
          id: "inner-layer",
          sourceIn: 2,
          sourceOut: 6,
          legacyData: expect.objectContaining({ x: 3, y: 4, width: 70, height: 80, opacity: 0.75, volume: 0.6 }),
        })]),
      }),
    ]));
    expect(version.composition?.nestedCompositions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "composition:legacy-shot-slot:shot-1:slot-1:shot-version-1",
        legacyData: expect.objectContaining({ shotId: "shot-1", slotId: "slot-1", versionId: "shot-version-1" }),
        placements: expect.arrayContaining([expect.objectContaining({ id: "shot-layer" })]),
      }),
    ]));
    project.assets.find(asset => asset.id === "nested-asset")!.clipVersions![0].layers[0].x = 99;
    expect(version.composition?.nestedCompositions?.find(item => item.id === "composition:nested-asset:nested-v2")?.placements[0].legacyData).toMatchObject({ x: 3 });
    expect(version.composition?.provenance).toMatchObject({
      kind: "master-timeline-snapshot",
      sourceProjectId: "project-1",
      sourceUpdatedAt: "2026-10-20T10:00:00.000Z",
      createdAt: "2026-10-20T11:00:00.000Z",
    });
    expect(version.composition?.provenance?.pinnedVersions).toEqual(expect.arrayContaining([
      { assetId: "nested-asset", versionId: "nested-v2" },
      { shotId: "shot-1", slotId: "slot-1", versionId: "shot-version-1" },
    ]));
    expect(version.scriptVersionIds).toContain("script-version-1");
    expect(version.generationRecords).toHaveLength(1);
  });

  it("persists the full editable snapshot through the same JSON serialization used by local project storage", () => {
    const project = fixture();
    const version = createClipVersionSnapshot(project, {
      assetId: "snapshot-asset",
      versionId: "snapshot-version",
      versionName: "Version A",
      createdAt: "2026-10-20T11:00:00.000Z",
    });
    project.assets.push({
      id: "snapshot-asset",
      name: "Snapshot",
      kind: "clip",
      selectedClipVersionId: "snapshot-version",
      clipVersions: [version],
    });
    const reloaded = JSON.parse(JSON.stringify(project)) as DionysusProject;
    const saved = reloaded.assets.find(asset => asset.id === "snapshot-asset")?.clipVersions?.[0];
    expect(saved?.composition).toEqual(version.composition);
    expect(saved?.composition?.placements).toEqual(version.composition?.placements);
    expect(saved?.composition?.nestedCompositions).toEqual(version.composition?.nestedCompositions);
    expect(saved?.composition?.provenance).toEqual(version.composition?.provenance);
    expect(saved?.layers).toEqual(version.layers);
  });
});
