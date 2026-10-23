import { describe, expect, it } from "vitest";
import { createProject, findPlacement, ops, type Composition, type Placement } from "./index";

const vid = (id: string, start: number, dur = 1000_00): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 5000, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "video", volume: 0.7 });
function setup(): { comp: Composition; v: string; a: string } {
  const p = createProject("t");
  const c = p.compositions[p.rootCompositionId];
  return { comp: ops.insertPlacement(c, c.tracks[0].id, vid("v1", 240000)), v: c.tracks[0].id, a: c.tracks[1].id };
}

describe("linked audio (owned child)", () => {
  it("extract creates an aligned audio placement and mutes the linked audio", () => {
    const { comp, a } = setup();
    const next = ops.extractAudio(comp, "v1", "extract", "x1");
    const audio = next.tracks.find((t) => t.id === a)!.placements[0];
    expect(audio).toMatchObject({ id: "x1", clipType: "audio", startTicks: 240000, durationTicks: 100000, sourceInTicks: 5000, volume: 0.7 });
    expect(findPlacement(next, "v1")!.placement.linkedAudio).toEqual({ muted: true });
  });
  it("duplicate keeps the linked audio playing", () => {
    const { comp } = setup();
    const next = ops.extractAudio(comp, "v1", "duplicate", "x1");
    expect(findPlacement(next, "v1")!.placement.linkedAudio).toBeUndefined();
    expect(findPlacement(next, "x1")).toBeTruthy();
  });
  it("adds a new audio track when existing ones are busy over the range", () => {
    const { comp, a } = setup();
    const busy = ops.insertPlacement(comp, a, { ...vid("b", 200000, 200000), clipType: "audio" });
    const next = ops.extractAudio(busy, "v1", "extract", "x1", "trkNew");
    expect(next.tracks.find((t) => t.id === "trkNew")!.placements[0].startTicks).toBe(240000);
  });
  it("linked audio follows split (owned by the placement)", () => {
    const { comp } = setup();
    const muted = ops.setLinkedAudioMuted(comp, "v1", true);
    const split = ops.splitPlacement(muted, "v1", 290000, "v2");
    expect(findPlacement(split, "v2")!.placement.linkedAudio?.muted).toBe(true);
  });
  it("rejects non-video clips", () => {
    const { comp, a } = setup();
    const c2 = ops.insertPlacement(comp, a, { ...vid("au", 0), clipType: "audio" });
    expect(() => ops.extractAudio(c2, "au", "extract")).toThrow(/video/);
  });
});
