import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import {
  applyProjectTimelineClipResize,
  calculateProjectTimelineClipResizePreview,
  calculateProjectTimelineDropPosition,
  getProjectTimelinePlacementItems,
} from "./projectTimelinePlacement";

describe("shared project timeline placement engine", () => {
  it("uses Master Shots as occupancy when dropping an ordinary clip", () => {
    const project = structuredClone(sampleProject);
    const videoTracks = project.tracks.filter(track => track.kind === "video");
    const shot = { ...project.shots[0], masterStart: 4, masterTrackId: videoTracks[1].id, duration: 4 };
    project.shots = [shot];
    const moving = { id: "ordinary", name: "Ordinary", kind: "video" as const, trackId: videoTracks[0].id, start: 12, duration: 2 };
    project.timelineClips = [moving];
    const position = calculateProjectTimelineDropPosition(project, moving, videoTracks[1].id, 4, 14);
    expect(position).toBeTruthy();
    expect(position!.start + moving.duration <= 4 + 1e-7 || position!.start >= 8 - 1e-7).toBe(true);
  });

  it("uses the moving materialized Storyboard clip instead of counting its Shot twice", () => {
    const project = structuredClone(sampleProject);
    const shot = project.shots[0];
    const materialized = { id: "storyboard-" + shot.id + "-slot-a", name: "Generated", kind: "video" as const, trackId: "track-video-1", start: 0, duration: 2, shotId: shot.id };
    project.timelineClips = [materialized];
    const items = getProjectTimelinePlacementItems(project, materialized);
    expect(items.filter(item => item.id === shot.id)).toHaveLength(0);
    expect(items.filter(item => item.id === materialized.id)).toHaveLength(1);
  });

  it("resizes an ordinary clip and trims an adjacent Master Shot atomically", () => {
    const project = structuredClone(sampleProject);
    const track = project.tracks.find(item => item.kind === "video")!;
    project.shots = [{ ...project.shots[0], masterStart: 3, masterTrackId: track.id, duration: 6 }];
    const clip = { id: "before-shot", name: "Before Shot", kind: "video" as const, trackId: track.id, start: 0, duration: 3 };
    project.timelineClips = [clip];
    const preview = calculateProjectTimelineClipResizePreview(project, clip, "right", 5, 10);
    expect(preview?.trims).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.shots[0].id })]));
    const updated = applyProjectTimelineClipResize(project, preview!);
    expect(updated.timelineClips![0].duration).toBeGreaterThan(3);
    expect(updated.shots[0].masterStart).toBeGreaterThan(3);
    expect(updated.shots[0].duration).toBeLessThan(6);
  });

  it("keeps linked source audio aligned when a cross-model resize trims the video", () => {
    const project = structuredClone(sampleProject);
    const track = project.tracks.find(item => item.kind === "video")!;
    const audioTrack = project.tracks.find(item => item.kind === "audio")!;
    project.shots = [{ ...project.shots[0], masterStart: 3, masterTrackId: track.id, duration: 6 }];
    const clip = { id: "video-with-audio", name: "Video", kind: "video" as const, trackId: track.id, start: 0, duration: 3, sourceIn: 0, sourceOut: 3 };
    const audio = { id: "linked-audio", name: "Audio", kind: "audio" as const, trackId: audioTrack.id, start: 0, duration: 3, linkedVideoClipId: clip.id, sourceIn: 0, sourceOut: 3, fadeOut: 1 };
    project.timelineClips = [clip, audio];
    const preview = calculateProjectTimelineClipResizePreview(project, clip, "right", 5, 10);
    const updated = applyProjectTimelineClipResize(project, preview!);
    const updatedVideo = updated.timelineClips!.find(item => item.id === clip.id)!;
    const updatedAudio = updated.timelineClips!.find(item => item.id === audio.id)!;
    expect(updatedAudio).toMatchObject({ start: updatedVideo.start, duration: updatedVideo.duration, linkedVideoClipId: clip.id });
    expect(updatedAudio.fadeOut).toBeLessThanOrEqual(updatedAudio.duration);
  });

  it("resizes a Master Shot and trims an adjacent ordinary clip in the same operation", () => {
    const project = structuredClone(sampleProject);
    const track = project.tracks.find(item => item.kind === "video")!;
    project.shots = [{ ...project.shots[0], masterStart: 0, masterTrackId: track.id, duration: 6 }];
    const clip = { id: "after-shot", name: "After Shot", kind: "video" as const, trackId: track.id, start: 6, duration: 5 };
    project.timelineClips = [clip];
    const movingShot = { id: project.shots[0].id, name: project.shots[0].title, kind: "video" as const, trackId: track.id, start: 0, duration: 6 };
    const preview = calculateProjectTimelineClipResizePreview(project, movingShot, "right", 2, 15);
    expect(preview?.trims).toEqual(expect.arrayContaining([expect.objectContaining({ id: clip.id })]));
    const updated = applyProjectTimelineClipResize(project, preview!);
    expect(updated.shots[0].duration).toBeGreaterThan(6);
    expect(updated.timelineClips![0].start).toBeGreaterThanOrEqual(updated.shots[0].duration);
    expect(updated.timelineClips![0].duration).toBeLessThan(5);
  });
});
