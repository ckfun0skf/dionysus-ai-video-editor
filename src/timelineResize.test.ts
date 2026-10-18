import { describe, expect, it } from "vitest";
import type { TimelineClip } from "./types";
import { applyTimelineClipResize, calculateTimelineClipResizePreview } from "./timelineResize";

const video = (id: string, start: number, duration: number, trackId = "v1"): TimelineClip => ({
  id, name: id, kind: "video", trackId, start, duration
});

describe("timeline clip resize and adjacent trimming", () => {
  it("previews and trims the next clip when extending the current clip into it", () => {
    const clips: TimelineClip[] = [
      { ...video("left", 0, 5), sourceIn: 0, sourceOut: 5 },
      { ...video("right", 5, 4), sourceIn: 10, sourceOut: 14 },
      { id: "right-audio", name: "right audio", kind: "audio", trackId: "a1", start: 5, duration: 4, sourceIn: 10, sourceOut: 14, linkedVideoClipId: "right" }
    ];
    const preview = calculateTimelineClipResizePreview(clips, "left", "right", 3, 12, 24);
    expect(preview).toMatchObject({
      id: "left", start: 0, duration: 8,
      overlap: { start: 5, duration: 3 },
      trims: [{ id: "right", start: 8, duration: 1, edge: "left" }]
    });
    const result = applyTimelineClipResize(clips, preview!, 24);
    expect(result.find(item => item.id === "left")).toMatchObject({ start: 0, duration: 8, sourceOut: 8 });
    expect(result.find(item => item.id === "right")).toMatchObject({ start: 8, duration: 1, sourceIn: 13, sourceOut: 14 });
    expect(result.find(item => item.id === "right-audio")).toMatchObject({ start: 8, duration: 1, sourceIn: 13, sourceOut: 14 });
  });

  it("previews and trims the previous clip when dragging the left edge backward", () => {
    const clips = [video("left", 0, 5), video("right", 5, 4)];
    const preview = calculateTimelineClipResizePreview(clips, "right", "left", -2, 12, 24);
    expect(preview).toMatchObject({
      id: "right", start: 3, duration: 6,
      overlap: { start: 3, duration: 2 },
      trims: [{ id: "left", start: 0, duration: 3, edge: "right" }]
    });
    const result = applyTimelineClipResize(clips, preview!, 24);
    expect(result.find(item => item.id === "left")).toMatchObject({ start: 0, duration: 3 });
    expect(result.find(item => item.id === "right")).toMatchObject({ start: 3, duration: 6 });
  });

  it("keeps the adjacent clip at least one frame long for a large extension", () => {
    const clips = [video("left", 0, 5), video("right", 5, 4)];
    const preview = calculateTimelineClipResizePreview(clips, "left", "right", 99, 12, 24)!;
    expect(preview.duration).toBeLessThan(9);
    expect(preview.trims[0].duration).toBeCloseTo(1 / 24, 7);
  });

  it("does not touch an adjacent clip when the resize stops before it", () => {
    const clips = [video("left", 0, 3), video("right", 5, 4)];
    const preview = calculateTimelineClipResizePreview(clips, "left", "right", 1, 12, 24)!;
    expect(preview.trims).toEqual([]);
    expect(preview.overlap).toBeUndefined();
    expect(applyTimelineClipResize(clips, preview, 24).find(item => item.id === "right")).toEqual(clips[1]);
  });

  it("does not mutate the caller's clip array", () => {
    const clips = [video("left", 0, 5), video("right", 5, 4)];
    const snapshot = JSON.stringify(clips);
    const preview = calculateTimelineClipResizePreview(clips, "left", "right", 3, 12, 24)!;
    applyTimelineClipResize(clips, preview, 24);
    expect(JSON.stringify(clips)).toBe(snapshot);
  });
});
