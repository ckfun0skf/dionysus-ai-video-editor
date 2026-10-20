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

  it("does not create an overlap if the adjacent clip cannot retain a full frame", () => {
    const frame = 1 / 24;
    const clips = [video("left", 0, 5), video("tiny-right", 5, frame)];
    const preview = calculateTimelineClipResizePreview(clips, "left", "right", 1, 12, 24)!;
    expect(preview.start).toBe(0);
    expect(preview.duration).toBe(5);
    expect(preview.trims).toEqual([]);
    const updated = applyTimelineClipResize(clips, preview, 24);
    const left = updated.find(item => item.id === "left")!;
    const right = updated.find(item => item.id === "tiny-right")!;
    expect(left.start + left.duration).toBeLessThanOrEqual(right.start + 1e-7);
    expect(right.duration).toBeCloseTo(frame, 7);
  });

  it("does not extend a left trim into a previous clip that cannot keep a full frame", () => {
    const frame = 1 / 24;
    const clips = [video("tiny-left", 0, frame), video("right", frame, 3)];
    const preview = calculateTimelineClipResizePreview(clips, "right", "left", -1, 8, 24)!;
    expect(preview.start).toBeCloseTo(frame, 7);
    expect(preview.trims).toEqual([]);
    expect(preview.overlap).toBeUndefined();
  });

  it("does not touch an adjacent clip when the resize stops before it", () => {
    const clips = [video("left", 0, 3), video("right", 5, 4)];
    const preview = calculateTimelineClipResizePreview(clips, "left", "right", 1, 12, 24)!;
    expect(preview.trims).toEqual([]);
    expect(preview.overlap).toBeUndefined();
    expect(applyTimelineClipResize(clips, preview, 24).find(item => item.id === "right")).toEqual(clips[1]);
  });


  it("clears stale linked-audio source ranges when the video has no explicit source range", () => {
    const clips: TimelineClip[] = [
      video("video", 0, 5),
      {
        id: "linked-audio", name: "linked audio", kind: "audio", trackId: "a1",
        start: 0, duration: 5, linkedVideoClipId: "video", sourceIn: 12, sourceOut: 17
      }
    ];
    const preview = calculateTimelineClipResizePreview(clips, "video", "right", 1, 12, 24)!;
    const result = applyTimelineClipResize(clips, preview, 24);
    const audio = result.find(item => item.id === "linked-audio")!;
    expect(audio).toMatchObject({ start: 0, duration: 6, linkedVideoClipId: "video" });
    expect(audio).not.toHaveProperty("sourceIn");
    expect(audio).not.toHaveProperty("sourceOut");
  });


  it("does not round a right-edge trim past the last whole frame of a non-aligned timeline", () => {
    const clips = [video("end-clip", 0, 10)];
    const preview = calculateTimelineClipResizePreview(clips, "end-clip", "right", 2, 10.02, 24)!;
    expect(preview.duration).toBe(10);
    expect(preview.start + preview.duration).toBeLessThanOrEqual(10.02);
  });

  it("does not mutate the caller's clip array", () => {
    const clips = [video("left", 0, 5), video("right", 5, 4)];
    const snapshot = JSON.stringify(clips);
    const preview = calculateTimelineClipResizePreview(clips, "left", "right", 3, 12, 24)!;
    applyTimelineClipResize(clips, preview, 24);
    expect(JSON.stringify(clips)).toBe(snapshot);
  });
});
