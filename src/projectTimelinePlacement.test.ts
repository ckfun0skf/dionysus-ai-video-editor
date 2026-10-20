import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import {
  applyProjectTimelineClipResize,
  applyProjectTimelineInsertion,
  calculateProjectTimelineInsertionPlan,
  calculateProjectTimelineClipResizePreview,
  calculateProjectTimelineDropPosition,
  getProjectTimelinePlacementItems,
  moveProjectTimelinePlacement,
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


  it("moves a Master Shot and its materialized Storyboard placements together", () => {
    const project = structuredClone(sampleProject);
    const videoTracks = project.tracks.filter(track => track.kind === "video");
    const audioTrack = project.tracks.find(track => track.kind === "audio")!;
    const shot = { ...project.shots[0], masterStart: 2, masterTrackId: videoTracks[0].id, duration: 6 };
    project.shots = [shot];
    const storyboardVideo = { id: "storyboard-" + shot.id + "-slot-a", name: "Generated video", kind: "video" as const, trackId: videoTracks[0].id, start: 2, duration: 3, shotId: shot.id };
    const storyboardAudio = { id: "storyboard-" + shot.id + "-slot-a-audio", name: "Generated audio", kind: "audio" as const, trackId: audioTrack.id, start: 2, duration: 3 };
    project.timelineClips = [storyboardVideo, storyboardAudio];
    const updated = moveProjectTimelinePlacement(project, { type: "shot", shotId: shot.id }, videoTracks[1].id, 5);
    expect(updated.shots[0]).toMatchObject({ masterStart: 5, masterTrackId: videoTracks[1].id });
    expect(updated.timelineClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: storyboardVideo.id, start: 5, trackId: videoTracks[1].id }),
      expect.objectContaining({ id: storyboardAudio.id, start: 5, trackId: audioTrack.id }),
    ]));
  });

  it("moves a normal video clip and its linked audio as one placement group", () => {
    const project = structuredClone(sampleProject);
    const videoTracks = project.tracks.filter(track => track.kind === "video");
    const audioTrack = project.tracks.find(track => track.kind === "audio")!;
    const video = { id: "move-video", name: "Video", kind: "video" as const, trackId: videoTracks[0].id, start: 1, duration: 4, sourceIn: 2, sourceOut: 6 };
    const audio = { id: "move-audio", name: "Audio", kind: "audio" as const, trackId: audioTrack.id, start: 1, duration: 4, sourceIn: 2, sourceOut: 6, linkedVideoClipId: video.id };
    project.timelineClips = [video, audio];
    const updated = moveProjectTimelinePlacement(project, { type: "clip", clipId: video.id }, videoTracks[1].id, 8);
    expect(updated.timelineClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: video.id, trackId: videoTracks[1].id, start: 8, sourceIn: 2, sourceOut: 6 }),
      expect.objectContaining({ id: audio.id, trackId: audioTrack.id, start: 8, duration: 4, sourceIn: 2, sourceOut: 6, linkedVideoClipId: video.id }),
    ]));
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

  it("places a new clip into an empty gap without creating overlap", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    const left = { id: "left", name: "Left", kind: "video" as const, trackId: videoTrack.id, start: 0, duration: 2 };
    const right = { id: "right", name: "Right", kind: "video" as const, trackId: videoTrack.id, start: 5, duration: 2 };
    project.timelineClips = [left, right];
    const draft = { id: "new", name: "New asset", kind: "video" as const, trackId: videoTrack.id, start: 0, duration: 2 };
    const plan = calculateProjectTimelineInsertionPlan(project, draft, videoTrack.id, 2);
    expect(plan.status).toBe("ready");
    const updated = applyProjectTimelineInsertion(project, plan);
    expect(updated.timelineClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "left", start: 0, duration: 2 }),
      expect.objectContaining({ id: "new", start: 2, duration: 2 }),
      expect.objectContaining({ id: "right", start: 5, duration: 2 }),
    ]));
  });

  it("asks for resolution when a new clip is longer than the remaining gap", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    project.timelineClips = [
      { id: "left", name: "Left", kind: "video", trackId: track.id, start: 0, duration: 3 },
      { id: "right", name: "Right", kind: "video", trackId: track.id, start: 4, duration: 2 },
    ];
    const draft = { id: "new", name: "New", kind: "video" as const, trackId: track.id, start: 0, duration: 3 };
    const plan = calculateProjectTimelineInsertionPlan(project, draft, track.id, 3);
    expect(plan).toMatchObject({ status: "needs-resolution", start: 3, duration: 3, availableDuration: 1, conflictStart: 4, shiftBy: 2 });
  });

  it("ripples later clips, linked audio, and extends the resulting timeline in one update", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const videoTrack = project.tracks.find(item => item.kind === "video")!;
    const audioTrack = project.tracks.find(item => item.kind === "audio")!;
    project.timelineClips = [
      { id: "left", name: "Left", kind: "video", trackId: videoTrack.id, start: 0, duration: 3 },
      { id: "next", name: "Next", kind: "video", trackId: videoTrack.id, start: 4, duration: 2 },
      { id: "after", name: "After", kind: "video", trackId: videoTrack.id, start: 7, duration: 2 },
      { id: "next-audio", name: "Next audio", kind: "audio", trackId: audioTrack.id, start: 4, duration: 2, linkedVideoClipId: "next" },
    ];
    const draft = { id: "new", name: "New", kind: "video" as const, trackId: videoTrack.id, start: 0, duration: 3 };
    const plan = calculateProjectTimelineInsertionPlan(project, draft, videoTrack.id, 3);
    const updated = applyProjectTimelineInsertion(project, plan, "ripple");
    expect(updated.timelineClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "new", start: 3, duration: 3 }),
      expect.objectContaining({ id: "next", start: 6, duration: 2 }),
      expect.objectContaining({ id: "next-audio", start: 6, duration: 2 }),
      expect.objectContaining({ id: "after", start: 9, duration: 2 }),
    ]));
    expect(Math.max(...updated.timelineClips!.map(clip => clip.start + clip.duration))).toBe(11);
  });

  it("trims the newly inserted clip to the available gap and leaves existing clips unchanged", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    project.timelineClips = [
      { id: "next", name: "Next", kind: "video", trackId: track.id, start: 4, duration: 2 },
    ];
    const draft = { id: "new", name: "New", kind: "video" as const, trackId: track.id, start: 0, duration: 3 };
    const plan = calculateProjectTimelineInsertionPlan(project, draft, track.id, 2);
    expect(plan.status).toBe("needs-resolution");
    const updated = applyProjectTimelineInsertion(project, plan, "trim");
    expect(updated.timelineClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "new", start: 2, duration: 2 }),
      expect.objectContaining({ id: "next", start: 4, duration: 2 }),
    ]));
  });

  it("rejects a placement click inside an occupied interval", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    const occupied = { id: "occupied", name: "Occupied", kind: "video" as const, trackId: track.id, start: 2, duration: 3 };
    project.timelineClips = [occupied];
    const draft = { id: "new", name: "New", kind: "video" as const, trackId: track.id, start: 0, duration: 1 };
    expect(calculateProjectTimelineInsertionPlan(project, draft, track.id, 3).status).toBe("start-occupied");
  });

  it("ripples a Master Shot and its materialized Storyboard media together", () => {
    const project = structuredClone(sampleProject);
    const videoTrack = project.tracks.find(item => item.kind === "video")!;
    const audioTrack = project.tracks.find(item => item.kind === "audio")!;
    const shot = { ...project.shots[0], masterStart: 4, masterTrackId: videoTrack.id, duration: 3 };
    project.shots = [shot];
    project.timelineClips = [
      { id: "storyboard-" + shot.id + "-slot-a", name: "Generated video", kind: "video", trackId: videoTrack.id, start: 4, duration: 3, shotId: shot.id },
      { id: "storyboard-" + shot.id + "-slot-a-audio", name: "Generated audio", kind: "audio", trackId: audioTrack.id, start: 4, duration: 3, shotId: shot.id },
    ];
    const draft = { id: "new", name: "New", kind: "video" as const, trackId: videoTrack.id, start: 0, duration: 2 };
    const plan = calculateProjectTimelineInsertionPlan(project, draft, videoTrack.id, 3);
    expect(plan.status).toBe("needs-resolution");
    const updated = applyProjectTimelineInsertion(project, plan, "ripple");
    expect(updated.shots[0].masterStart).toBe(5);
    expect(updated.timelineClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "storyboard-" + shot.id + "-slot-a", start: 5 }),
      expect.objectContaining({ id: "storyboard-" + shot.id + "-slot-a-audio", start: 5 }),
    ]));
  });


  it("routes root resize through shared Composition commands and synchronizes linked audio ranges", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const videoTrack = project.tracks.find(item => item.kind === "video")!;
    const audioTrack = project.tracks.find(item => item.kind === "audio")!;
    const video = {
      id: "root-video", name: "Root video", kind: "video" as const, trackId: videoTrack.id,
      start: 1, duration: 6, sourceIn: 2, sourceOut: 8,
    };
    const audio = {
      id: "root-audio", name: "Linked audio", kind: "audio" as const, trackId: audioTrack.id,
      start: 1, duration: 6, sourceIn: 2, sourceOut: 8, linkedVideoClipId: video.id,
    };
    project.timelineClips = [video, audio];

    const preview = calculateProjectTimelineClipResizePreview(project, video, "right", 2, 12);
    expect(preview).toMatchObject({ id: video.id, start: 1, duration: 8, edge: "right" });
    const updated = applyProjectTimelineClipResize(project, preview!);

    expect(updated.timelineClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: video.id, start: 1, duration: 8, sourceIn: 2, sourceOut: 10 }),
      expect.objectContaining({ id: audio.id, start: 1, duration: 8, sourceIn: 2, sourceOut: 10, linkedVideoClipId: video.id }),
    ]));
    expect(project.timelineClips).toEqual([video, audio]);
  });

  it("rejects duplicate placement IDs before inserting into the canonical root", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    project.timelineClips = [
      { id: "duplicate", name: "Existing", kind: "video", trackId: track.id, start: 0, duration: 1 },
    ];
    const draft = { id: "duplicate", name: "New", kind: "video" as const, trackId: track.id, start: 2, duration: 1 };
    const plan = calculateProjectTimelineInsertionPlan(project, draft, track.id, 2);
    expect(plan.status).toBe("ready");
    expect(() => applyProjectTimelineInsertion(project, plan)).toThrow(/IDs must be unique/);
    expect(project.timelineClips).toHaveLength(1);
  });

});
