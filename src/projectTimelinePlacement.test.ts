import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { duplicateCompositionPlacement, moveCompositionPlacement, splitCompositionPlacement, updateCompositionPlacement } from "./compositionCommands";
import {
  applyCanonicalRootTimelineResize,
  applyProjectTimelineClipResize,
  applyProjectTimelineInsertion,
  applyCanonicalCompositionInsertion,
  calculateCanonicalCompositionDropPosition,
  calculateCanonicalCompositionInsertionPlan,
  calculateCanonicalCompositionResizePreview,
  calculateProjectTimelineInsertionPlan,
  calculateProjectTimelineClipResizePreview,
  calculateProjectTimelineDropPosition,
  getProjectTimelinePlacementItems,
  moveCanonicalRootTimelineClip,
  ensureCanonicalTimelineClips,
  trimCanonicalRootTimelineClip,
  moveProjectTimelinePlacement,
} from "./projectTimelinePlacement";

describe("shared project timeline placement engine", () => {
  it("promotes a legacy-only linked group before canonical split and duplicate", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const root = migrateLegacyProjectToComposition(project).rootComposition;
    const videoTrack = root.tracks.find(track => track.kind === "video")!;
    const audioTrack = root.tracks.find(track => track.kind === "audio")!;
    const video = {
      id: "legacy-split-video", name: "Legacy split video", kind: "video" as const,
      trackId: videoTrack.id, start: 0, duration: 4, sourceIn: 3, sourceOut: 7,
    };
    const audio = {
      id: "legacy-split-audio", name: "Legacy split audio", kind: "audio" as const,
      trackId: audioTrack.id, start: 0, duration: 4, sourceIn: 8, sourceOut: 12,
      linkedVideoClipId: video.id, volume: 0.4,
    };
    project.timelineClips = [...(project.timelineClips ?? []), video, audio];

    const promoted = ensureCanonicalTimelineClips(project, root, [video.id]);
    expect(promoted.placements.find(item => item.id === video.id)).toBeDefined();
    expect(promoted.placements.find(item => item.id === audio.id)).toMatchObject({
      linkedToPlacementId: video.id, sourceIn: 8, sourceOut: 12,
    });

    const split = splitCompositionPlacement(promoted, video.id, 2, {
      newPlacementIds: { [video.id]: "legacy-split-video-right", [audio.id]: "legacy-split-audio-right" },
    });
    const projected = projectRootCompositionToLegacy(project, split);
    expect(projected.timelineClips?.filter(item => item.kind === "video" && item.id.startsWith("legacy-split-video"))).toHaveLength(2);
    expect(projected.timelineClips?.find(item => item.id === audio.id)).toMatchObject({
      start: 0, duration: 2, sourceIn: 8, sourceOut: 10, linkedVideoClipId: video.id,
    });
    expect(projected.timelineClips?.find(item => item.id === "legacy-split-audio-right")).toMatchObject({
      start: 2, duration: 2, sourceIn: 10, sourceOut: 12, linkedVideoClipId: "legacy-split-video-right",
    });

    const duplicated = duplicateCompositionPlacement(promoted, video.id, {
      newPlacementIds: { [video.id]: "legacy-split-video-copy", [audio.id]: "legacy-split-audio-copy" },
      start: 4,
    });
    const duplicatedProject = projectRootCompositionToLegacy(project, duplicated);
    expect(duplicatedProject.timelineClips?.find(item => item.id === "legacy-split-video-copy")).toMatchObject({ start: 4, duration: 4 });
    expect(duplicatedProject.timelineClips?.find(item => item.id === "legacy-split-audio-copy")).toMatchObject({
      start: 4, duration: 4, linkedVideoClipId: "legacy-split-video-copy", volume: 0.4,
    });
  });

  it("promotes a legacy-only clip and linked audio before canonical trim", () => {
    const project = structuredClone(sampleProject);
    const root = migrateLegacyProjectToComposition(project).rootComposition;
    const videoTrack = root.tracks.find(track => track.kind === "video");
    const audioTrack = root.tracks.find(track => track.kind === "audio");
    expect(videoTrack).toBeDefined();
    expect(audioTrack).toBeDefined();
    const clip = { id: "legacy-trim-video", name: "Trim video", kind: "video" as const, trackId: videoTrack!.id, start: 0, duration: 4 };
    const audio = { id: "legacy-trim-audio", name: "Trim audio", kind: "audio" as const, trackId: audioTrack!.id, start: 0, duration: 4, linkedVideoClipId: clip.id };
    project.timelineClips = [...(project.timelineClips ?? []), clip, audio];

    const next = trimCanonicalRootTimelineClip(project, root, clip.id, 1.5);

    expect(next.placements.find(placement => placement.id === clip.id)).toMatchObject({ duration: 1.5 });
    expect(next.placements.find(placement => placement.id === audio.id)).toMatchObject({
      linkedToPlacementId: clip.id,
      duration: 1.5,
    });
    expect(root.placements.some(placement => placement.id === clip.id || placement.id === audio.id)).toBe(false);
  });

  it("promotes legacy-only clips before applying a canonical resize and adjacent trim", () => {
    const project = structuredClone(sampleProject);
    let root = migrateLegacyProjectToComposition(project).rootComposition;
    const videoTrack = root.tracks.find(track => track.kind === "video");
    expect(videoTrack).toBeDefined();
    const audioTrack = root.tracks.find(track => track.kind === "audio");
    expect(audioTrack).toBeDefined();
    const first = { id: "legacy-resize-first", name: "First", kind: "video" as const, trackId: videoTrack!.id, start: 0, duration: 2 };
    const firstAudio = { id: "legacy-resize-first-audio", name: "First audio", kind: "audio" as const, trackId: audioTrack!.id, start: 0, duration: 2, linkedVideoClipId: first.id };
    const second = { id: "legacy-resize-second", name: "Second", kind: "video" as const, trackId: videoTrack!.id, start: 2, duration: 4 };
    project.timelineClips = [...(project.timelineClips ?? []), first, firstAudio, second];
    const before = structuredClone(root);
    const preview = { id: first.id, trackId: first.trackId, edge: "right" as const, start: 0, duration: 3, trims: [{ id: second.id, start: 3, duration: 3, edge: "left" as const }] };

    root = applyCanonicalRootTimelineResize(project, root, preview);

    expect(root.placements.find(placement => placement.id === first.id)).toMatchObject({ start: 0, duration: 3 });
    expect(root.placements.find(placement => placement.id === second.id)).toMatchObject({ start: 3, duration: 3 });
    expect(root.placements.find(placement => placement.id === firstAudio.id)).toMatchObject({
      linkedToPlacementId: first.id,
      start: 0,
      duration: 3,
    });
    expect(before.placements.some(placement => placement.id === first.id || placement.id === firstAudio.id || placement.id === second.id)).toBe(false);
  });

  it("promotes a legacy-only clip into canonical Composition before moving it", () => {
    const project = structuredClone(sampleProject);
    let root = migrateLegacyProjectToComposition(project).rootComposition;
    const videoTrack = root.tracks.find(track => track.kind === "video");
    expect(videoTrack).toBeDefined();
    const audioTrack = root.tracks.find(track => track.kind === "audio");
    expect(audioTrack).toBeDefined();
    const clip = {
      id: "legacy-only-timeline-clip",
      name: "Legacy-only clip",
      kind: "video" as const,
      trackId: videoTrack!.id,
      start: 0,
      duration: 2,
    };
    const linkedAudio = {
      id: "legacy-only-timeline-audio",
      name: "Legacy-only clip audio",
      kind: "audio" as const,
      trackId: audioTrack!.id,
      start: 0,
      duration: 2,
      linkedVideoClipId: clip.id,
    };
    project.timelineClips = [...(project.timelineClips ?? []), clip, linkedAudio];
    const before = structuredClone(root);

    root = moveCanonicalRootTimelineClip(project, root, clip.id, videoTrack!.id, 4);

    expect(root.placements.find(placement => placement.id === clip.id)).toMatchObject({
      id: clip.id,
      trackId: videoTrack!.id,
      start: 4,
      duration: 2,
    });
    expect(root.placements.find(placement => placement.id === linkedAudio.id)).toMatchObject({
      linkedToPlacementId: clip.id,
      start: 4,
      duration: 2,
    });
    expect(before.placements.some(placement => placement.id === clip.id || placement.id === linkedAudio.id)).toBe(false);
  });

  it("plans insertion from canonical root occupancy even when the legacy projection is stale", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    const existing = { id: "existing", name: "Existing", kind: "video" as const, trackId: track.id, start: 2, duration: 2, sourceIn: 4, sourceOut: 6 };
    project.timelineClips = [existing];
    const migrated = migrateLegacyProjectToComposition(project).rootComposition;
    const canonical = moveCompositionPlacement(migrated, existing.id, 8);
    const draft = { id: "inserted", name: "Inserted", kind: "video" as const, trackId: track.id, start: 0, duration: 2 };
    const plan = calculateCanonicalCompositionInsertionPlan(canonical, draft, track.id, 2);
    expect(plan.status).toBe("ready");
    const committed = applyCanonicalCompositionInsertion(canonical, project, plan);
    expect(committed.placements.find(item => item.id === existing.id)).toMatchObject({ start: 8, sourceIn: 4, sourceOut: 6 });
    expect(committed.placements.find(item => item.id === draft.id)).toMatchObject({ start: 2, duration: 2 });
    expect(project.timelineClips?.[0].start).toBe(2);
  });

  it("plans resize and adjacent trimming from canonical timing when the legacy projection is stale", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    const moving = { id: "moving", name: "Moving", kind: "video" as const, trackId: track.id, start: 2, duration: 2, sourceIn: 3, sourceOut: 5 };
    const adjacent = { id: "adjacent", name: "Adjacent", kind: "video" as const, trackId: track.id, start: 4, duration: 4, sourceIn: 10, sourceOut: 14 };
    project.timelineClips = [moving, adjacent];
    const migrated = migrateLegacyProjectToComposition(project).rootComposition;
    const canonical = moveCompositionPlacement(migrated, moving.id, 8);
    const before = JSON.stringify(canonical);

    const canonicalPreview = calculateCanonicalCompositionResizePreview(canonical, moving.id, "right", 2, 12);
    const staleLegacyPreview = calculateProjectTimelineClipResizePreview(project, moving, "right", 2, 12);

    expect(canonicalPreview).toMatchObject({ id: moving.id, start: 8, duration: 4, trims: [] });
    expect(staleLegacyPreview?.trims).toEqual([expect.objectContaining({ id: adjacent.id })]);
    expect(JSON.stringify(canonical)).toBe(before);
    expect(project.timelineClips?.[0]).toMatchObject({ start: 2, duration: 2, sourceIn: 3, sourceOut: 5 });
  });

  it("uses canonical clip duration when planning drag/drop against stale legacy clip metadata", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    const moving = { id: "moving", name: "Moving", kind: "video" as const, trackId: track.id, start: 0, duration: 2 };
    const blocker = { id: "blocker", name: "Blocker", kind: "video" as const, trackId: track.id, start: 8, duration: 2 };
    project.timelineClips = [moving, blocker];
    const migrated = migrateLegacyProjectToComposition(project).rootComposition;
    const canonical = updateCompositionPlacement(migrated, moving.id, { duration: 5 });
    const before = JSON.stringify(canonical);

    const position = calculateCanonicalCompositionDropPosition(canonical, moving, track.id, 7, 10);

    expect(position?.start).toBe(3);
    expect(JSON.stringify(canonical)).toBe(before);
    expect(project.timelineClips?.[0].duration).toBe(2);
  });

  it("ripples canonical placements and linked source ranges as one insertion transaction", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const videoTrack = project.tracks.find(item => item.kind === "video")!;
    const audioTrack = project.tracks.find(item => item.kind === "audio")!;
    project.timelineClips = [
      { id: "before", name: "Before", kind: "video", trackId: videoTrack.id, start: 0, duration: 3 },
      { id: "linked-video", name: "Video", kind: "video", trackId: videoTrack.id, start: 4, duration: 2, sourceIn: 10, sourceOut: 12 },
      { id: "linked-audio", name: "Audio", kind: "audio", trackId: audioTrack.id, start: 4, duration: 2, sourceIn: 5, sourceOut: 7, linkedVideoClipId: "linked-video" },
      { id: "after", name: "After", kind: "video", trackId: videoTrack.id, start: 7, duration: 2 },
    ];
    const root = migrateLegacyProjectToComposition(project).rootComposition;
    const draft = { id: "new", name: "New", kind: "video" as const, trackId: videoTrack.id, start: 0, duration: 3 };
    const plan = calculateCanonicalCompositionInsertionPlan(root, draft, videoTrack.id, 3);
    expect(plan).toMatchObject({ status: "needs-resolution", conflictStart: 4, shiftBy: 2 });
    const committed = applyCanonicalCompositionInsertion(root, project, plan, "ripple");
    expect(committed.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "new", start: 3, duration: 3 }),
      expect.objectContaining({
        id: "linked-video", start: 6, sourceIn: 10, sourceOut: 12,
        linkedAudioChildren: [expect.objectContaining({ id: "linked-audio", sourceIn: 5, sourceOut: 7 })],
      }),
      expect.objectContaining({ id: "after", start: 9 }),
    ]));
    expect(committed.placements.some(item => item.id === "linked-audio")).toBe(false);
    const projected = projectRootCompositionToLegacy(project, committed);
    expect(projected.timelineClips).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "linked-video", start: 6, sourceIn: 10, sourceOut: 12 }),
      expect.objectContaining({ id: "linked-audio", start: 6, sourceIn: 5, sourceOut: 7, linkedVideoClipId: "linked-video" }),
    ]));
    expect(root.placements.find(item => item.id === "linked-video")?.start).toBe(4);
  });

  it("trims a canonical inserted clip to the free gap while retaining source in-point", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const track = project.tracks.find(item => item.kind === "video")!;
    project.timelineClips = [{ id: "next", name: "Next", kind: "video", trackId: track.id, start: 4, duration: 2 }];
    const root = migrateLegacyProjectToComposition(project).rootComposition;
    const draft = { id: "trimmed", name: "Trimmed", kind: "video" as const, trackId: track.id, start: 0, duration: 3, sourceIn: 7, sourceOut: 10 };
    const plan = calculateCanonicalCompositionInsertionPlan(root, draft, track.id, 2);
    const committed = applyCanonicalCompositionInsertion(root, project, plan, "trim");
    expect(committed.placements.find(item => item.id === "trimmed")).toMatchObject({ start: 2, duration: 2, sourceIn: 7, sourceOut: 9 });
    expect(committed.placements.find(item => item.id === "next")?.start).toBe(4);
  });



  it("rejects incompatible destination tracks before suggesting a drag position", () => {
    const project = structuredClone(sampleProject);
    project.shots = [];
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    const audioTrack = project.tracks.find(track => track.kind === "audio")!;
    const video = { id: "move-video", name: "Video", kind: "video" as const, trackId: videoTrack.id, start: 0, duration: 2 };
    const audio = { id: "move-audio", name: "Audio", kind: "audio" as const, trackId: audioTrack.id, start: 0, duration: 2 };
    project.timelineClips = [video, audio];
    expect(calculateProjectTimelineDropPosition(project, video, audioTrack.id, 4, 12)).toBeNull();
    expect(calculateProjectTimelineDropPosition(project, audio, videoTrack.id, 4, 12)).toBeNull();

    const root = migrateLegacyProjectToComposition(project).rootComposition;
    expect(calculateCanonicalCompositionDropPosition(root, video, audioTrack.id, 4, 12)).toBeNull();
    expect(calculateCanonicalCompositionDropPosition(root, audio, videoTrack.id, 4, 12)).toBeNull();
  });

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
    const before = structuredClone(project);
    const updated = moveProjectTimelinePlacement(project, { type: "shot", shotId: shot.id }, videoTracks[1].id, 5);
    const projectedRoot = migrateLegacyProjectToComposition(updated).rootComposition;
    expect(updated.shots[0]).toMatchObject({ masterStart: 5, masterTrackId: videoTracks[1].id });
    expect(projectedRoot.placements.find(placement => placement.id === shot.id)).toMatchObject({
      start: 5,
      duration: shot.duration,
      trackId: videoTracks[1].id,
    });
    expect(project).toEqual(before);
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
      expect.objectContaining({ id: audio.id, trackId: videoTracks[1].id, start: 8, duration: 4, sourceIn: 2, sourceOut: 6, linkedVideoClipId: video.id }),
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
    expect(updatedAudio).toMatchObject({
      start: updatedVideo.start, duration: updatedVideo.duration, linkedVideoClipId: clip.id,
      trackId: updatedVideo.trackId, sourceIn: 0, sourceOut: updatedVideo.duration,
    });
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
      expect.objectContaining({
        id: audio.id, trackId: videoTrack.id, start: 1, duration: 8,
        sourceIn: 2, sourceOut: 10, linkedVideoClipId: video.id,
      }),
    ]));
    const owner = migrateLegacyProjectToComposition(project).rootComposition.placements.find(item => item.id === video.id)!;
    expect(owner.linkedAudioChildren).toHaveLength(1);
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
