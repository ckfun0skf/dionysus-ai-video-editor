import { describe, expect, it } from "vitest";
import type { CompositionDocument, CompositionPlacement } from "./compositionModel";
import {
  addCompositionTrack,
  applyCompositionResizePreview,
  assertValidCompositionDocument,
  deleteCompositionPlacement,
  duplicateCompositionPlacement,
  insertCompositionPlacement,
  moveCompositionPlacement,
  removeCompositionTrack,
  reorderCompositionTrack,
  rippleReorderCompositionMasterShots,
  splitCompositionPlacement,
  trimCompositionPlacement,
  unlinkCompositionPlacement,
  updateCompositionPlacement,
} from "./compositionCommands";

function fixture(): CompositionDocument {
  const video: CompositionPlacement = {
    id: "video",
    name: "Video",
    trackId: "v1",
    start: 1,
    duration: 6,
    order: 0,
    source: { type: "asset", assetId: "video-asset" },
    sourceIn: 2,
    sourceOut: 8,
    legacyData: { id: "video", name: "Video", kind: "video", start: 1, duration: 6 },
  };
  const audio: CompositionPlacement = {
    id: "audio",
    name: "Linked audio",
    trackId: "a1",
    start: 1,
    duration: 6,
    order: 0,
    source: { type: "asset", assetId: "audio-asset" },
    sourceIn: 2,
    sourceOut: 8,
    linkedToPlacementId: "video",
    legacyData: { id: "audio", name: "Linked audio", kind: "audio", start: 1, duration: 6, linkedVideoClipId: "video" },
  };
  return {
    id: "root-composition",
    name: "Root",
    duration: 7,
    frameRate: 24,
    width: 1920,
    height: 1080,
    tracks: [
      { id: "v1", name: "Video 1", kind: "video", order: 0 },
      { id: "a1", name: "Audio 1", kind: "audio", order: 1 },
      { id: "t1", name: "Text", kind: "text", order: 2 },
    ],
    placements: [video, audio],
  };
}

function placement(document: CompositionDocument, id: string): CompositionPlacement {
  const result = document.placements.find(item => item.id === id);
  if (!result) throw new Error("Test placement not found: " + id);
  return result;
}

describe("shared Composition editing commands", () => {
  it("adds, reorders and removes root tracks through immutable Composition commands", () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const added = addCompositionTrack(source, {
      id: "v2", name: "Video 2", kind: "video", order: 3, legacyData: { kind: "video" },
    });
    const reordered = reorderCompositionTrack(added, "t1", 0);
    expect([...reordered.tracks].sort((a, b) => a.order - b.order).map(track => track.id)).toEqual(["t1", "v1", "a1", "v2"]);
    const removed = removeCompositionTrack(reordered, "v2", "v1");
    expect(removed.tracks.some(track => track.id === "v2")).toBe(false);
    expect(removed.placements.map(item => item.id)).toEqual(["video", "audio"]);
    expect(JSON.stringify(source)).toBe(before);
  });


  it("removing a video track also removes linked audio on a separate audio track", () => {
    const source = fixture();
    const withFallback = addCompositionTrack(source, {
      id: "v2", name: "Video 2", kind: "video", order: 3, legacyData: { kind: "video" },
    });
    const removed = removeCompositionTrack(withFallback, "v1", "v2");
    expect(removed.tracks.some(track => track.id === "v1")).toBe(false);
    expect(removed.tracks.some(track => track.id === "a1")).toBe(true);
    expect(removed.placements).toHaveLength(0);
    expect(() => assertValidCompositionDocument(removed)).not.toThrow();
  });

  it("removes a video track with a linked group atomically and rejects removing a Master Shot track without fallback", () => {
    const source = fixture();
    const withShotTrack = addCompositionTrack(source, {
      id: "v2", name: "Video 2", kind: "video", order: 3, legacyData: { kind: "video" },
    });
    withShotTrack.placements.push({
      id: "shot", name: "Master Shot", trackId: "v2", start: 8, duration: 3, order: 0,
      source: { type: "shot", shotId: "shot" },
      legacyData: { entityType: "master-shot", kind: "video", start: 8, duration: 3 },
    });
    expect(() => removeCompositionTrack(withShotTrack, "v2")).toThrow(/fallback video track/);
    const moved = removeCompositionTrack(withShotTrack, "v2", "v1");
    expect(moved.placements.find(item => item.id === "shot")).toMatchObject({ trackId: "v1", start: 8, duration: 3 });
    expect(moved.tracks.some(track => track.id === "v2")).toBe(false);
    expect(withShotTrack.placements.find(item => item.id === "shot")?.trackId).toBe("v2");
  });

  it("refuses to remove the final video track", () => {
    const source = fixture();
    expect(() => removeCompositionTrack(source, "v1")).toThrow(/last video track/);
    expect(source.tracks.some(track => track.id === "v1")).toBe(true);
  });

  it("removes a linked audio track without deleting its video parent on another track", () => {
    const source = fixture();
    const next = removeCompositionTrack(source, "a1");
    expect(next.tracks.some(track => track.id === "a1")).toBe(false);
    expect(next.placements.map(item => item.id)).toContain("video");
    expect(next.placements.map(item => item.id)).not.toContain("audio");
    expect(placement(source, "audio").linkedToPlacementId).toBe("video");
  });

  it("updates canonical source/link metadata without changing unrelated source ranges", () => {
    const source = fixture();
    const unlinked = updateCompositionPlacement(source, "audio", {
      linkedToPlacementId: undefined,
      source: { type: "asset", assetId: "different-audio" },
      legacyData: { ...placement(source, "audio").legacyData, linkedVideoClipId: undefined },
    });
    expect(placement(unlinked, "audio")).toMatchObject({
      source: { type: "asset", assetId: "different-audio" }, sourceIn: 2, sourceOut: 8,
    });
    expect(placement(unlinked, "audio").linkedToPlacementId).toBeUndefined();
    expect(placement(unlinked, "audio").legacyData.linkedVideoClipId).toBeUndefined();
    expect(placement(source, "audio").linkedToPlacementId).toBe("video");
  });

  it("ripple-reorders Master Shots from canonical placements and preserves source ranges", () => {
    const source = fixture();
    source.placements.push(
      { id: "shot-a", name: "A", trackId: "v1", start: 0, duration: 3, order: 2, source: { type: "shot", shotId: "shot-a" }, legacyData: { entityType: "master-shot", kind: "video" } },
      { id: "shot-b", name: "B", trackId: "v1", start: 3, duration: 4, order: 3, source: { type: "shot", shotId: "shot-b" }, legacyData: { entityType: "master-shot", kind: "video" } },
    );
    const before = JSON.stringify(source);
    const next = rippleReorderCompositionMasterShots(source, "shot-b", 0, "v1");
    expect(placement(next, "shot-b")).toMatchObject({ start: 0, duration: 4 });
    expect(placement(next, "shot-a")).toMatchObject({ start: 4, duration: 3 });
    expect(placement(next, "video")).toMatchObject({ start: 1, sourceIn: 2, sourceOut: 8 });
    expect(placement(next, "audio")).toMatchObject({ start: 1, sourceIn: 2, sourceOut: 8, linkedToPlacementId: "video" });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("inserts a placement on an existing track without mutating the original document", () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const next = insertCompositionPlacement(source, {
      id: "title",
      name: "Title",
      trackId: "t1",
      start: 0,
      duration: 2,
      source: { type: "none" },
      legacyData: { kind: "text" },
    });
    expect(placement(next, "title").order).toBe(0);
    expect(next.duration).toBe(7);
    expect(source.placements).toHaveLength(2);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("moves a linked group atomically and keeps legacy timing fields synchronized", () => {
    const source = fixture();
    const next = moveCompositionPlacement(source, "video", 5);
    expect(placement(next, "video")).toMatchObject({ start: 5, duration: 6, sourceIn: 2, sourceOut: 8 });
    expect(placement(next, "audio")).toMatchObject({ start: 5, duration: 6, sourceIn: 2, sourceOut: 8, linkedToPlacementId: "video" });
    expect(placement(next, "audio").legacyData).toMatchObject({ start: 5, duration: 6, linkedVideoClipId: "video" });
    expect(next.duration).toBe(11);
    expect(placement(source, "video").start).toBe(1);
  });

  it("trims linked placements and updates source out-points without changing source in-points", () => {
    const next = trimCompositionPlacement(fixture(), "audio", 4);
    expect(placement(next, "video")).toMatchObject({ start: 1, duration: 4, sourceIn: 2, sourceOut: 6 });
    expect(placement(next, "audio")).toMatchObject({ start: 1, duration: 4, sourceIn: 2, sourceOut: 6 });
    expect(placement(next, "audio").legacyData).toMatchObject({ duration: 4, sourceOut: 6 });
  });

  it("trims linked video and audio together while preserving different source in-points", () => {
    const source = updateCompositionPlacement(fixture(), "audio", { sourceIn: 5, sourceOut: 11 });
    const before = JSON.stringify(source);

    const next = trimCompositionPlacement(source, "video", 4);

    expect(placement(next, "video")).toMatchObject({ start: 1, duration: 4, sourceIn: 2, sourceOut: 6 });
    expect(placement(next, "audio")).toMatchObject({ start: 1, duration: 4, sourceIn: 5, sourceOut: 9, linkedToPlacementId: "video" });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("resizes linked video and audio on shared timeline while preserving member source offsets", () => {
    const source = updateCompositionPlacement(fixture(), "audio", { sourceIn: 5, sourceOut: 11 });
    const before = JSON.stringify(source);

    const next = applyCompositionResizePreview(source, {
      id: "video", start: 1, duration: 8, edge: "right", trims: [],
    });

    expect(placement(next, "video")).toMatchObject({ start: 1, duration: 8, sourceIn: 2, sourceOut: 10 });
    expect(placement(next, "audio")).toMatchObject({ start: 1, duration: 8, sourceIn: 5, sourceOut: 13, linkedToPlacementId: "video" });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("splits linked video and audio at one timeline point but keeps distinct source offsets", () => {
    const source = updateCompositionPlacement(fixture(), "audio", { sourceIn: 5, sourceOut: 11 });
    const before = JSON.stringify(source);

    const next = splitCompositionPlacement(source, "video", 4, {
      newPlacementIds: { video: "video-right", audio: "audio-right" },
    });

    expect(placement(next, "video")).toMatchObject({ start: 1, duration: 3, sourceIn: 2, sourceOut: 5 });
    expect(placement(next, "video-right")).toMatchObject({ start: 4, duration: 3, sourceIn: 5, sourceOut: 8 });
    expect(placement(next, "audio")).toMatchObject({ start: 1, duration: 3, sourceIn: 5, sourceOut: 8, linkedToPlacementId: "video" });
    expect(placement(next, "audio-right")).toMatchObject({ start: 4, duration: 3, sourceIn: 8, sourceOut: 11, linkedToPlacementId: "video-right" });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("inherits root source ranges only for linked members without explicit trim metadata", () => {
    const source = updateCompositionPlacement(fixture(), "audio", {
      sourceIn: undefined, sourceOut: undefined,
    });
    const before = JSON.stringify(source);

    const trimmed = trimCompositionPlacement(source, "video", 4);
    expect(placement(trimmed, "audio")).toMatchObject({ start: 1, duration: 4, sourceIn: 2, sourceOut: 6 });

    const resized = applyCompositionResizePreview(source, {
      id: "video", start: 1, duration: 8, edge: "right", trims: [],
    });
    expect(placement(resized, "audio")).toMatchObject({ start: 1, duration: 8, sourceIn: 2, sourceOut: 10 });

    const split = splitCompositionPlacement(source, "video", 4, {
      newPlacementIds: { video: "video-right", audio: "audio-right" },
    });
    expect(placement(split, "audio")).toMatchObject({ sourceIn: 2, sourceOut: 5 });
    expect(placement(split, "audio-right")).toMatchObject({ sourceIn: 5, sourceOut: 8, linkedToPlacementId: "video-right" });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("commits resize and adjacent trim atomically while preserving linked timing and source ranges", () => {
    const source = fixture();
    source.placements.push(
      {
        id: "next-video", name: "Next", trackId: "v1", start: 7, duration: 4, order: 1,
        source: { type: "asset", assetId: "next-video-asset" }, sourceIn: 10, sourceOut: 14,
        legacyData: { id: "next-video", kind: "video", start: 7, duration: 4 },
      },
      {
        id: "next-audio", name: "Next audio", trackId: "a1", start: 7, duration: 4, order: 1,
        source: { type: "asset", assetId: "next-audio-asset" }, sourceIn: 10, sourceOut: 14,
        linkedToPlacementId: "next-video",
        legacyData: { id: "next-audio", kind: "audio", start: 7, duration: 4, linkedVideoClipId: "next-video" },
      },
    );
    const before = JSON.stringify(source);
    const next = applyCompositionResizePreview(source, {
      id: "video", start: 1, duration: 8, edge: "right",
      trims: [{ id: "next-video", start: 9, duration: 2, edge: "left" }],
    });
    expect(placement(next, "video")).toMatchObject({ start: 1, duration: 8, sourceIn: 2, sourceOut: 10 });
    expect(placement(next, "audio")).toMatchObject({ start: 1, duration: 8, sourceIn: 2, sourceOut: 10 });
    expect(placement(next, "next-video")).toMatchObject({ start: 9, duration: 2, sourceIn: 12, sourceOut: 14 });
    expect(placement(next, "next-audio")).toMatchObject({ start: 9, duration: 2, sourceIn: 12, sourceOut: 14 });
    expect(placement(next, "next-audio").legacyData).toMatchObject({ start: 9, duration: 2, sourceIn: 12, sourceOut: 14 });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("splits video and linked audio into aligned, source-trimmed pairs", () => {
    const source = fixture();
    const next = splitCompositionPlacement(source, "video", 4, {
      newPlacementIds: { video: "video-right", audio: "audio-right" },
    });
    expect(placement(next, "video")).toMatchObject({ start: 1, duration: 3, sourceIn: 2, sourceOut: 5 });
    expect(placement(next, "video-right")).toMatchObject({ start: 4, duration: 3, sourceIn: 5, sourceOut: 8 });
    expect(placement(next, "audio")).toMatchObject({ start: 1, duration: 3, sourceIn: 2, sourceOut: 5, linkedToPlacementId: "video" });
    expect(placement(next, "audio-right")).toMatchObject({ start: 4, duration: 3, sourceIn: 5, sourceOut: 8, linkedToPlacementId: "video-right" });
    expect(placement(next, "audio-right").legacyData).toMatchObject({ id: "audio-right", linkedVideoClipId: "video-right", start: 4, duration: 3 });
    expect(placement(source, "video").duration).toBe(6);
  });

  it("duplicates the selected linked group with fresh IDs and remapped links", () => {
    const next = duplicateCompositionPlacement(fixture(), "video", {
      start: 10,
      newPlacementIds: { video: "video-copy", audio: "audio-copy" },
    });
    expect(placement(next, "video-copy")).toMatchObject({ start: 10, duration: 6, sourceIn: 2, sourceOut: 8 });
    expect(placement(next, "audio-copy")).toMatchObject({ start: 10, duration: 6, linkedToPlacementId: "video-copy" });
    expect(placement(next, "audio-copy").legacyData).toMatchObject({ id: "audio-copy", linkedVideoClipId: "video-copy" });
    expect(next.duration).toBe(16);
  });

  it("deletes a root with linked descendants and permits independent audio edits after unlink", () => {
    const source = fixture();
    const unlinked = unlinkCompositionPlacement(source, "audio");
    expect(placement(unlinked, "audio")).not.toHaveProperty("linkedToPlacementId");
    expect(placement(unlinked, "audio").legacyData).not.toHaveProperty("linkedVideoClipId");
    const moved = moveCompositionPlacement(unlinked, "audio", 9);
    expect(placement(moved, "audio").start).toBe(9);
    expect(placement(moved, "video").start).toBe(1);
    const withIndependentAudio = insertCompositionPlacement(source, {
      id: "independent-audio",
      name: "Independent audio",
      trackId: "a1",
      start: 0,
      duration: 1,
      order: 1,
      source: { type: "asset", assetId: "independent-audio-asset" },
      legacyData: { id: "independent-audio", kind: "audio", start: 0, duration: 1 },
    });
    const deleted = deleteCompositionPlacement(withIndependentAudio, "video");
    expect(deleted.placements.map(item => item.id)).toEqual(["independent-audio"]);
  });

  it("rejects duplicate IDs, missing tracks, dangling links, invalid time, and cyclic links", () => {
    const source = fixture();
    expect(() => insertCompositionPlacement(source, {
      id: "video", name: "Duplicate", trackId: "v1", start: 0, duration: 1,
      source: { type: "none" }, legacyData: {},
    })).toThrow(/unique/);
    expect(() => insertCompositionPlacement(source, {
      id: "new", name: "Missing track", trackId: "gone", start: 0, duration: 1,
      source: { type: "none" }, legacyData: {},
    })).toThrow(/missing track/);
    const dangling = fixture();
    dangling.placements[1].linkedToPlacementId = "missing";
    expect(() => assertValidCompositionDocument(dangling)).toThrow(/existing different placement/);
    const cyclic = fixture();
    cyclic.placements[0].linkedToPlacementId = "audio";
    expect(() => assertValidCompositionDocument(cyclic)).toThrow(/share start and duration|cycles/);
    expect(() => moveCompositionPlacement(source, "video", -1)).toThrow(/non-negative/);
  });
});
