import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { validateProject } from "./projectValidation";

describe("validateProject", () => {
  it("accepts the shipped sample project", () => {
    expect(validateProject(sampleProject)).toBe(true);
  });

  it("rejects a project with missing tracks", () => {
    const project = structuredClone(sampleProject) as unknown as Record<string, unknown>;
    delete project.tracks;
    expect(validateProject(project)).toBe(false);
  });

  it("rejects a clip slot whose selected version does not exist", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].slots[0].selectedVersionId = "missing-version";
    expect(validateProject(project)).toBe(false);
  });

  it("rejects invalid durations and non-finite canvas settings", () => {
    const badDuration = structuredClone(sampleProject);
    badDuration.shots[0].duration = 0;
    expect(validateProject(badDuration)).toBe(false);

    const badCanvas = structuredClone(sampleProject);
    badCanvas.width = Number.POSITIVE_INFINITY;
    expect(validateProject(badCanvas)).toBe(false);
  });

  it("rejects invalid nested layer values", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].slots[0].versions[0].layers.push({
      id: "bad-layer",
      name: "Bad layer",
      kind: "unknown" as never,
      start: -1,
      duration: 0,
    });
    expect(validateProject(project)).toBe(false);
  });
  it("accepts procedural layers and persistent audio mute state", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].slots[0].versions[0].layers.push({
      id: "procedural-layer", name: "Three.js Layer", kind: "procedural",
      start: 0, duration: 2, muted: false,
    });
    project.timelineClips = [{
      id: "muted-audio", name: "Muted audio", kind: "audio", trackId: "track-audio-1",
      start: 0, duration: 2, muted: true,
    }];
    expect(validateProject(project)).toBe(true);
  });

  it("accepts text and procedural Master Timeline blocks on their typed tracks", () => {
    const project = structuredClone(sampleProject);
    project.tracks.push({ id: "track-procedural-test", name: "Three.js", kind: "procedural" });
    project.timelineClips = [
      { id: "text-block", name: "Subtitle Block", kind: "text", trackId: "track-text-1", start: 1, duration: 2 },
      { id: "procedural-block", name: "Three.js Module", kind: "procedural", trackId: "track-procedural-test", start: 0, duration: 3, scriptVersionId: "script-version-1" }
    ];
    expect(validateProject(project)).toBe(true);
  });

  it("rejects Master Timeline clips with stale Shot or Slot links", () => {
    const project = structuredClone(sampleProject);
    project.timelineClips = [{
      id: "shot-link", name: "Shot clip", kind: "video", trackId: "track-video-1",
      start: 0, duration: 2, shotId: project.shots[0].id, slotId: "missing-slot",
    }];
    expect(validateProject(project)).toBe(false);
    project.timelineClips[0].slotId = project.shots[0].slots[0].id;
    expect(validateProject(project)).toBe(true);
    project.timelineClips[0].shotId = "missing-shot";
    expect(validateProject(project)).toBe(false);
  });

  it("rejects profile references to missing assets", () => {
    const project = structuredClone(sampleProject);
    project.referenceProfiles.push({
      id: "profile-test", name: "Test character", entityType: "character",
      references: [{ id: "ref-test", assetId: "missing-asset", role: "identity" }],
    });
    expect(validateProject(project)).toBe(false);
  });

  it("accepts optional absolute Master Shot start and rejects invalid values", () => {
    const project = structuredClone(sampleProject);
    project.shots[1].masterStart = 12.5;
    expect(validateProject(project)).toBe(true);
    project.shots[1].masterStart = -1;
    expect(validateProject(project)).toBe(false);
    project.shots[1].masterStart = Number.NaN;
    expect(validateProject(project)).toBe(false);
  });

  it("rejects shots assigned to missing reference profiles", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].referenceProfileIds.push("missing-profile");
    expect(validateProject(project)).toBe(false);
  });

  it("rejects overrides for references not assigned to the shot", () => {
    const project = structuredClone(sampleProject);
    project.assets.push({ id: "asset-test", name: "Reference", kind: "image" });
    project.referenceProfiles.push({
      id: "profile-test", name: "Test character", entityType: "character",
      references: [{ id: "ref-test", assetId: "asset-test", role: "identity" }],
    });
    project.shots[0].referenceOverrides.push({ referenceId: "ref-test", action: "exclude" });
    expect(validateProject(project)).toBe(false);
  });

  it("rejects reference overrides with missing references or replacement assets", () => {
    const missingReference = structuredClone(sampleProject);
    missingReference.shots[0].referenceOverrides.push({ referenceId: "missing-reference", action: "exclude" });
    expect(validateProject(missingReference)).toBe(false);

    const missingReplacement = structuredClone(sampleProject);
    missingReplacement.referenceProfiles.push({
      id: "profile-test", name: "Test character", entityType: "character",
      references: [{ id: "ref-test", assetId: "asset-test", role: "identity" }],
    });
    missingReplacement.assets.push({ id: "asset-test", name: "Reference", kind: "image" });
    missingReplacement.shots[0].referenceProfileIds.push("profile-test");
    missingReplacement.shots[0].referenceOverrides.push({
      referenceId: "ref-test", action: "replace", replacementAssetId: "missing-asset",
    });
    expect(validateProject(missingReplacement)).toBe(false);
  });


  it("accepts legacy schema 1.0 projects that omit timelineClips", () => {
    const legacy = structuredClone(sampleProject) as unknown as Record<string, unknown>;
    delete legacy.timelineClips;
    expect(validateProject(legacy)).toBe(true);
  });

  it("preserves linked and unlinked clips through JSON round-trip", () => {
    const project = structuredClone(sampleProject);
    project.timelineClips = [
      { id: "video-clip", name: "Video", kind: "video", trackId: "track-video-1", start: 1.25, duration: 4 },
      { id: "linked-audio", name: "Source audio", kind: "audio", trackId: "track-audio-1", start: 1.25, duration: 4, linkedVideoClipId: "video-clip" },
      { id: "music", name: "Music", kind: "audio", trackId: "track-audio-1", start: 0, duration: 10 },
    ];
    const imported: unknown = JSON.parse(JSON.stringify(project));
    expect(validateProject(imported)).toBe(true);
    if (!validateProject(imported)) throw new Error("Round-tripped project failed validation");
    expect(imported.timelineClips).toEqual(project.timelineClips);
    expect(imported.timelineClips?.[1].linkedVideoClipId).toBe("video-clip");
    expect(imported.timelineClips?.[2]).not.toHaveProperty("linkedVideoClipId");
  });

  it("rejects blank timeline clip IDs", () => {
    const project = structuredClone(sampleProject);
    project.timelineClips = [
      { id: "   ", name: "Video", kind: "video", trackId: "track-video-1", start: 0, duration: 2 },
    ];
    expect(validateProject(project)).toBe(false);
  });

  it("rejects duplicate timeline clip IDs and linked audio pointing to a non-video clip", () => {
    const duplicate = structuredClone(sampleProject);
    duplicate.timelineClips = [
      { id: "same", name: "Video", kind: "video", trackId: "track-video-1", start: 0, duration: 2 },
      { id: "same", name: "Audio", kind: "audio", trackId: "track-audio-1", start: 0, duration: 2 },
    ];
    expect(validateProject(duplicate)).toBe(false);

    const invalidLink = structuredClone(sampleProject);
    invalidLink.timelineClips = [
      { id: "audio-1", name: "Audio", kind: "audio", trackId: "track-audio-1", start: 0, duration: 2, linkedVideoClipId: "audio-2" },
      { id: "audio-2", name: "Other audio", kind: "audio", trackId: "track-audio-1", start: 0, duration: 2 },
    ];
    expect(validateProject(invalidLink)).toBe(false);
  });

  it("accepts and round-trips composition frame settings", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].slots[0].versions[0].layers.push({
      id: "frame-layer", name: "Picture in picture", kind: "video", start: 0, duration: 3,
      fitMode: "cover", x: 10, y: 15, width: 45, height: 50, backgroundColor: "#121212",
      borderColor: "#ffffff", borderWidth: 2, shape: "rounded", cornerRadius: 12, scale: 1.2, opacity: 0.8,
    });
    const imported: unknown = JSON.parse(JSON.stringify(project));
    expect(validateProject(imported)).toBe(true);
    if (!validateProject(imported)) throw new Error("Frame settings did not survive JSON round-trip");
    expect(imported.shots[0].slots[0].versions[0].layers[0]).toMatchObject({fitMode:"cover",x:10,y:15,width:45,height:50,shape:"rounded",cornerRadius:12,scale:1.2,opacity:0.8});
  });

  it("accepts layer animation presets and rejects invalid animation timing", () => {
    const animated = structuredClone(sampleProject);
    animated.shots[0].slots[0].versions[0].layers.push({
      id: "animated-layer", name: "Floating image", kind: "image", start: 0, duration: 3,
      animation: "float", animationDuration: 2.5,
    });
    expect(validateProject(animated)).toBe(true);
    const invalid = structuredClone(sampleProject);
    invalid.shots[0].slots[0].versions[0].layers.push({
      id: "invalid-animation", name: "Invalid", kind: "image", start: 0, duration: 3,
      animation: "bounce" as never, animationDuration: 0,
    });
    expect(validateProject(invalid)).toBe(false);
  });

  it("rejects invalid composition frame geometry and opacity", () => {
    const badWidth = structuredClone(sampleProject);
    badWidth.shots[0].slots[0].versions[0].layers.push({id:"bad-width",name:"Bad width",kind:"video",start:0,duration:1,width:0});
    expect(validateProject(badWidth)).toBe(false);
    const badOpacity = structuredClone(sampleProject);
    badOpacity.shots[0].slots[0].versions[0].layers.push({id:"bad-opacity",name:"Bad opacity",kind:"video",start:0,duration:1,opacity:1.5});
    expect(validateProject(badOpacity)).toBe(false);
  });

});
