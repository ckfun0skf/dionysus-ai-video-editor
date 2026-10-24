import { describe, expect, it } from "vitest";
import { createProject, type Placement } from "./model";
import { cutsOnTrack, setTransition, setTransitionAll, trackTransitions, transitionKind, transitionKinds } from "./transitions";
import { activeAt } from "../render/frame";

const T = 120_000;
const clip = (id: string, start: number, dur = 2 * T): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "video" });
function comp(...ps: Placement[]) { const p = createProject(); const c = p.compositions[p.rootCompositionId]; c.tracks[0].placements = ps; return c; }

describe("transitions", () => {
  it("only attaches to a clip with an adjacent clip before it", () => {
    const c = comp(clip("a", 0), clip("b", 2 * T), clip("c", 5 * T));
    const c1 = setTransition(c, "b", { kind: "crossfade", durationTicks: T });
    expect(c1.tracks[0].placements[1].transitionIn).toEqual({ kind: "crossfade", durationTicks: T });
    expect(setTransition(c1, "c", { kind: "crossfade", durationTicks: T })).toEqual(c1);
    expect(setTransition(c1, "b", undefined).tracks[0].placements[1].transitionIn).toBeUndefined();
  });
  it("centres on the cut and clamps to the shorter clip", () => {
    const c = setTransition(comp(clip("a", 0, T / 2), clip("b", T / 2)), "b", { kind: "crossfade", durationTicks: 4 * T });
    const [tr] = trackTransitions(c.tracks[0]);
    expect([tr.from, tr.to]).toEqual([T / 4, (3 * T) / 4]);
  });
  it("draws both clips with the incoming fading in on top", () => {
    const c = setTransition(comp(clip("a", 0), clip("b", 2 * T)), "b", { kind: "crossfade", durationTicks: T });
    const mid = activeAt(c, 2 * T);
    expect(mid.map((l) => [l.placement.id, l.mix])).toEqual([["a", 1], ["b", 0.5]]);
    expect(mid[0].sourceTicks).toBe(2 * T - 1); // outgoing holds its last frame
    const early = activeAt(c, 1.5 * T + T / 4);
    expect(early.map((l) => [l.placement.id, l.mix])).toEqual([["a", 1], ["b", 0.25]]);
    expect(early[1].sourceTicks).toBe(0); // incoming holds its first frame
    expect(activeAt(c, T).map((l) => l.placement.id)).toEqual(["a"]);
    expect(activeAt(c, 3 * T)[0].mix).toBeUndefined();
  });
  it("ignores a transition once the clips are no longer adjacent", () => {
    const c = setTransition(comp(clip("a", 0), clip("b", 2 * T)), "b", { kind: "crossfade", durationTicks: T });
    c.tracks[0].placements[1] = { ...c.tracks[0].placements[1], startTicks: 3 * T };
    expect(trackTransitions(c.tracks[0])).toEqual([]);
  });
  it("Apply to all sets (or clears) every cut on the track, each clamped to its own clips", () => {
    const c = comp(clip("a", 0), clip("b", 2 * T, T / 2), clip("c", 2.5 * T), clip("d", 8 * T));
    expect(cutsOnTrack(c, "a").map((p) => p.id)).toEqual(["b", "c"]);
    const all = setTransitionAll(c, "a", { kind: "zoom-in", durationTicks: T });
    expect(all.tracks[0].placements.map((p) => p.transitionIn)).toEqual([undefined, { kind: "zoom-in", durationTicks: T / 2 }, { kind: "zoom-in", durationTicks: T / 2 }, undefined]);
    expect(setTransitionAll(all, "d", undefined).tracks[0].placements.every((p) => !p.transitionIn)).toBe(true);
  });
  it("every transition kind has a category, finite look values and ends fully on the incoming clip", () => {
    const kinds = transitionKinds();
    expect(kinds.length).toBeGreaterThanOrEqual(20);
    expect(kinds.filter((k) => k.popular).length).toBeGreaterThanOrEqual(6);
    for (const k of kinds) {
      expect(k.category, k.id).toBeTruthy();
      expect(k.mix(1).in, k.id).toBeGreaterThan(0.99);
      for (let i = 0; i <= 10; i++) { const l = k.look(i / 10); for (const v of [l.out, l.in]) for (const n of Object.values(v ?? {})) if (typeof n === "number") expect(Number.isFinite(n), k.id).toBe(true); }
    }
    expect(transitionKind("push-left")!.look(0.5).in?.dx).toBeGreaterThan(0);
    expect(transitionKind("push-left")!.look(1).in?.dx ?? 0).toBeCloseTo(0, 5);
    expect(transitionKind("wipe-right")!.look(0.5).in?.clip).toBeTruthy();
  });
});
