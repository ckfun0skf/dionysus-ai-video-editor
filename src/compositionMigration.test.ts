import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { migrateLegacyProjectToComposition } from "./compositionMigration";

describe("migrateLegacyProjectToComposition", () => {
  it("preserves root track order, placement IDs, timing, source ranges and linked audio", () => {
    const project = structuredClone(sampleProject);
    project.assets.push(
      { id: "migration-video", name: "Source", kind: "video", path: "idb://video" },
      { id: "migration-audio", name: "Music", kind: "audio", path: "idb://audio" },
    );
    project.timelineClips = [
      { id: "master-video", name: "Source shot", kind: "video", trackId: "track-video-1", start: 4, duration: 6, assetId: "migration-video", sourceIn: 2, sourceOut: 8, x: 10, y: 5, width: 80, height: 90 },
      { id: "master-audio", name: "Linked audio", kind: "audio", trackId: "track-audio-1", start: 4, duration: 6, assetId: "migration-audio", linkedVideoClipId: "master-video", sourceIn: 1, sourceOut: 7, volume: 0.4, fadeIn: 0.5, fadeOut: 1 },
    ];
    const result = migrateLegacyProjectToComposition(project);
    expect(result.schemaVersion).toBe("2.0");
    expect(result.rootComposition.tracks.map((track) => track.id)).toEqual(project.tracks.map((track) => track.id));
    const videoPlacement = result.rootComposition.placements.find((placement) => placement.id === "master-video")!;
    const audioPlacement = result.rootComposition.placements.find((placement) => placement.id === "master-audio")!;
    expect(result.rootComposition.placements.some((placement) => placement.source.type === "shot")).toBe(true);
    expect(videoPlacement).toMatchObject({
      start: 4, duration: 6, sourceIn: 2, sourceOut: 8,
      source: { type: "asset", assetId: "migration-video" },
      legacyData: { x: 10, y: 5, width: 80, height: 90 },
    });
    expect(audioPlacement).toMatchObject({
      linkedToPlacementId: "master-video",
      sourceIn: 1, sourceOut: 7,
      legacyData: { volume: 0.4, fadeIn: 0.5, fadeOut: 1 },
    });
  });

  it("pins Shot Slot and Clip Asset versions instead of resolving to a mutable latest version", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({
      id: "migration-clip",
      name: "Reusable scene",
      kind: "clip",
      selectedClipVersionId: "clip-v2",
      clipVersions: [
        { id: "clip-v1", name: "Version 1", description: "older", duration: 3, layers: [], scriptVersionIds: [], generationRecords: [] },
        { id: "clip-v2", name: "Version 2", description: "selected", duration: 4, layers: [], scriptVersionIds: [], generationRecords: [] },
      ],
    });
    const shot = project.shots[0];
    const slot = shot.slots[0];
    project.timelineClips = [
      { id: "shot-placement", name: "Shot", kind: "video", trackId: "track-video-1", start: 0, duration: 2, shotId: shot.id, slotId: slot.id },
      { id: "clip-placement", name: "Clip", kind: "clip", trackId: "track-video-2", start: 3, duration: 4, assetId: "migration-clip", clipVersionId: "clip-v1" },
    ];
    const result = migrateLegacyProjectToComposition(project);
    expect(result.rootComposition.placements.find(placement => placement.id === "shot-placement")!.source).toMatchObject({ type: "shot", shotId: shot.id, slotId: slot.id, versionId: slot.selectedVersionId });
    expect(result.rootComposition.placements.find(placement => placement.id === "clip-placement")!.source).toEqual({ type: "clip", assetId: "migration-clip", versionId: "clip-v1" });
  });

  it("creates a composition per Clip Asset Version and preserves nested layer order and source timing", () => {
    const project = structuredClone(sampleProject);
    project.assets.push(
      { id: "nested-image", name: "Background", kind: "image", path: "idb://image" },
      {
        id: "nested-clip", name: "Reusable", kind: "clip", canvasWidth: 1280, canvasHeight: 720,
        clipVersions: [{
          id: "nested-v1", name: "V1", description: "desc", duration: 12,
          layers: [
            { id: "layer-audio", name: "Music", kind: "audio", start: 2, duration: 5, sourceIn: 7, sourceOut: 12, volume: 0.3 },
            { id: "layer-image", name: "Image", kind: "image", start: 0, duration: 4, assetId: "nested-image", x: 10, y: 20, width: 50, height: 60 },
            { id: "layer-title", name: "Title", kind: "text", start: 1, duration: 3 },
          ],
          scriptVersionIds: ["script-v1"], generationRecords: [],
        }],
      },
    );
    const result = migrateLegacyProjectToComposition(project);
    expect(result.clipCompositions).toHaveLength(1);
    const composition = result.clipCompositions[0];
    expect(composition).toMatchObject({ duration: 12, width: 1280, height: 720 });
    expect(composition.placements.map((placement) => placement.id)).toEqual(["layer-audio", "layer-image", "layer-title"]);
    expect(composition.tracks.map((track) => track.kind)).toEqual(["audio", "video", "text"]);
    expect(composition.placements[0]).toMatchObject({ start: 2, sourceIn: 7, sourceOut: 12 });
    expect(composition.placements[1].source).toEqual({ type: "asset", assetId: "nested-image" });
    expect(composition.placements[1].legacyData).toMatchObject({ x: 10, y: 20, width: 50, height: 60 });
  });

  it("preserves canonical nested Composition trees, pins and provenance instead of rebuilding from layers", () => {
    const project = structuredClone(sampleProject);
    const child = {
      id: "composition:child:pinned-v2",
      name: "Pinned child",
      duration: 3,
      frameRate: 24,
      width: 640,
      height: 360,
      tracks: [{ id: "child-track", name: "Child video", kind: "video" as const, order: 0 }],
      placements: [{
        id: "child-placement",
        name: "Pinned source",
        trackId: "child-track",
        start: 0.5,
        duration: 2,
        order: 0,
        source: { type: "asset" as const, assetId: "asset-v1" },
        sourceIn: 4,
        sourceOut: 6,
        legacyData: { x: 11, y: 12, width: 80, height: 70, volume: 0.35 },
      }],
    };
    const canonical = {
      id: "composition:saved-clip:version-v3",
      name: "Saved canonical tree",
      duration: 9,
      frameRate: 30,
      width: 1280,
      height: 720,
      tracks: [{ id: "canonical-track", name: "Canonical lane", kind: "video" as const, order: 0, muted: true }],
      placements: [{
        id: "canonical-placement",
        name: "Nested saved clip",
        trackId: "canonical-track",
        start: 2,
        duration: 4,
        order: 7,
        source: { type: "clip" as const, assetId: "child-asset", versionId: "pinned-v2" },
        sourceIn: 1,
        sourceOut: 5,
        legacyData: { x: 15, y: 25, width: 75, height: 65, volume: 0.6 },
      }],
      provenance: {
        kind: "derived-clip-version" as const,
        sourceProjectId: project.id,
        sourceCompositionId: "composition:project:root:master",
        sourceUpdatedAt: "2026-10-20T10:00:00.000Z",
        createdAt: "2026-10-20T11:00:00.000Z",
        pinnedVersions: [{ assetId: "child-asset", versionId: "pinned-v2" }],
      },
      nestedCompositions: [child],
      legacyData: { snapshotMarker: "canonical-must-survive", description: "Version description", scriptVersionIds: ["script-v3"], generationRecords: [] },
    };
    const asset = {
      id: "canonical-asset",
      name: "Canonical asset",
      kind: "clip" as const,
      clipVersions: [{
        id: "canonical-version",
        name: "Version 3",
        description: "Version description",
        duration: 9,
        layers: [{ id: "compatibility-layer", name: "Stale projection", kind: "video" as const, start: 0, duration: 1 }],
        composition: structuredClone(canonical),
        scriptVersionIds: ["script-v3"],
        generationRecords: [],
      }],
    };
    project.assets.push(asset);

    const shotVersion = project.shots[0].slots[0].versions[0];
    shotVersion.description = "Version description";
    shotVersion.scriptVersionIds = ["script-v3"];
    shotVersion.generationRecords = [];
    shotVersion.composition = structuredClone(canonical);
    const result = migrateLegacyProjectToComposition(project);
    const clipComposition = result.clipCompositions.find(item => item.id === canonical.id);
    const slotComposition = result.legacyShotSlotCompositions.find(item => item.id === canonical.id);

    expect(clipComposition).toEqual(canonical);
    expect(slotComposition).toEqual(canonical);
    expect(clipComposition?.placements[0]).toMatchObject({
      order: 7,
      source: { type: "clip", assetId: "child-asset", versionId: "pinned-v2" },
      sourceIn: 1,
      sourceOut: 5,
      legacyData: { x: 15, y: 25, width: 75, height: 65, volume: 0.6 },
    });
    expect(clipComposition?.nestedCompositions?.[0]).toEqual(child);
    expect(clipComposition?.provenance?.pinnedVersions).toEqual([{ assetId: "child-asset", versionId: "pinned-v2" }]);
  });

  it("deduplicates a materialized Storyboard placement and reports dangling source references", () => {
    const project = structuredClone(sampleProject);
    const shot = project.shots[0];
    const slot = shot.slots[0];
    project.timelineClips = [
      { id: "manual-placement", name: "Manual", kind: "video", trackId: "track-video-1", start: 1, duration: 2, shotId: shot.id, slotId: slot.id },
      { id: "storyboard-shot-slot", name: "Generated duplicate", kind: "video", trackId: "track-video-1", start: 8, duration: 2, shotId: shot.id, slotId: slot.id },
      { id: "missing-source-placement", name: "Missing", kind: "video", trackId: "track-video-1", start: 12, duration: 2, assetId: "missing-asset" },
    ];
    const result = migrateLegacyProjectToComposition(project);
    expect(result.rootComposition.placements.some((placement) => placement.id === shot.id && placement.source.type === "shot")).toBe(true);
    expect(result.rootComposition.placements.some((placement) => placement.id === "manual-placement")).toBe(true);
    expect(result.rootComposition.placements.some((placement) => placement.id === "missing-source-placement")).toBe(true);
    expect(result.rootComposition.placements.some((placement) => placement.id === "storyboard-shot-slot")).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate-storyboard-placement", entityId: "storyboard-shot-slot" }),
      expect.objectContaining({ code: "missing-source", entityId: "missing-source-placement" }),
    ]));
    expect(project.timelineClips).toHaveLength(3);
    expect(result.sourceProject.timelineClips).toHaveLength(3);
  });

  it("projects Master Shots into the root timeline and preserves every legacy Shot Slot Version separately", () => {
    const project = structuredClone(sampleProject);
    const result = migrateLegacyProjectToComposition(project);
    const shot = project.shots[0];
    const shotPlacement = result.rootComposition.placements.find(placement => placement.id === shot.id);
    expect(shotPlacement).toMatchObject({
      name: shot.title,
      source: { type: "shot", shotId: shot.id },
      duration: shot.duration,
      legacyData: { entityType: "master-shot" },
    });
    const expectedLegacyVersions = project.shots.reduce((sum, item) => sum + item.slots.reduce((slotSum, slot) => slotSum + slot.versions.length, 0), 0);
    expect(result.legacyShotSlotCompositions).toHaveLength(expectedLegacyVersions);
    expect(result.legacyShotSlotCompositions.some(composition =>
      composition.id.includes(shot.id) &&
      composition.legacyData?.legacyEntityType === "shot-slot-version" &&
      composition.legacyData?.selected === true
    )).toBe(true);
    expect(result.sourceProject).toEqual(project);
  });

  it("does not mutate the legacy project and is deterministic across repeated migration", () => {
    const project = structuredClone(sampleProject);
    project.timelineClips = [{ id: "stable", name: "Stable", kind: "video", trackId: "track-video-1", start: 0, duration: 2 }];
    const before = JSON.stringify(project);
    const first = migrateLegacyProjectToComposition(project);
    const second = migrateLegacyProjectToComposition(project);
    expect(JSON.stringify(project)).toBe(before);
    expect(first.rootComposition).toEqual(second.rootComposition);
    expect(first.clipCompositions).toEqual(second.clipCompositions);
  });

  it("preserves every Shot Slot alternative and each version's generation provenance", () => {
    const project = structuredClone(sampleProject);
    const shot = project.shots[0];
    const slot = shot.slots[0];
    const referenceSnapshot = [
      { id: "migration-reference-1", assetId: "migration-character", role: "identity" as const, notes: "Pinned character identity" },
    ];
    slot.versions = [
      {
        id: "migration-version-original",
        name: "Original take",
        description: "First generation attempt",
        duration: 4,
        layers: [{
          id: "migration-layer-original",
          name: "Original video",
          kind: "video",
          start: 0,
          duration: 4,
          prompt: "A slow push-in on the original subject.",
          modelName: "Video Model",
          modelVersion: "v1",
        }],
        scriptVersionIds: ["script-original"],
        generationRecords: [{
          id: "migration-run-original",
          createdAt: "2026-10-10T12:00:00.000Z",
          prompt: "Original take prompt",
          referenceSnapshot: structuredClone(referenceSnapshot),
          modelName: "Video Model",
          modelVersion: "v1",
          outputAssetId: "asset-original-output",
        }],
      },
      {
        id: "migration-version-alternative",
        name: "Alternative take",
        description: "Second generation attempt",
        duration: 5,
        layers: [{
          id: "migration-layer-alternative",
          name: "Alternative video",
          kind: "video",
          start: 0,
          duration: 5,
          prompt: "A handheld reveal from the opposite angle.",
          modelName: "Video Model",
          modelVersion: "v2",
        }],
        scriptVersionIds: ["script-alternative"],
        generationRecords: [{
          id: "migration-run-alternative",
          createdAt: "2026-10-11T13:30:00.000Z",
          prompt: "Alternative take prompt",
          referenceSnapshot: structuredClone(referenceSnapshot),
          modelName: "Video Model",
          modelVersion: "v2",
          outputAssetId: "asset-alternative-output",
        }],
      },
    ];
    slot.selectedVersionId = "migration-version-alternative";
    const before = structuredClone(project);

    const result = migrateLegacyProjectToComposition(project);
    const alternatives = result.legacyShotSlotCompositions.filter(composition =>
      composition.legacyData?.shotId === shot.id && composition.legacyData?.slotId === slot.id
    );

    expect(alternatives).toHaveLength(2);
    expect(alternatives.map(composition => composition.legacyData?.versionId)).toEqual([
      "migration-version-original",
      "migration-version-alternative",
    ]);
    expect(alternatives.map(composition => composition.legacyData?.selected)).toEqual([false, true]);
    expect(alternatives[0].legacyData).toMatchObject({
      description: "First generation attempt",
      scriptVersionIds: ["script-original"],
      generationRecords: [{
        id: "migration-run-original",
        prompt: "Original take prompt",
        referenceSnapshot,
        modelName: "Video Model",
        modelVersion: "v1",
        outputAssetId: "asset-original-output",
      }],
    });
    expect(alternatives[1].legacyData).toMatchObject({
      description: "Second generation attempt",
      scriptVersionIds: ["script-alternative"],
      generationRecords: [{
        id: "migration-run-alternative",
        prompt: "Alternative take prompt",
        referenceSnapshot,
        modelName: "Video Model",
        modelVersion: "v2",
        outputAssetId: "asset-alternative-output",
      }],
    });
    expect(alternatives[1].placements[0].legacyData).toMatchObject({
      prompt: "A handheld reveal from the opposite angle.",
      modelName: "Video Model",
      modelVersion: "v2",
    });
    expect(project).toEqual(before);
    expect(result.sourceProject).toEqual(before);
  });

});
