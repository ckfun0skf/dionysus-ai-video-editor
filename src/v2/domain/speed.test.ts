import { describe, expect, it } from "vitest";
import { createProject, sourceAt, type Composition, type Placement } from "./model";
import * as ops from "./ops";

const S = 120000;
const clip = (over: Partial<Placement> = {}): Placement => ({ id: "v", startTicks: 0, durationTicks: 4 * S, sourceInTicks: S, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "video", ...over });
const comp = (...ps: Placement[]): Composition => {
  const c = Object.values(createProject().compositions)[0];
  return { ...c, tracks: c.tracks.map((t) => (t.kind === "video" ? { ...t, placements: ps } : t)) };
};
const all = (c: Composition) => c.tracks.flatMap((t) => t.placements);
const byId = (c: Composition, id: string) => all(c).find((p) => p.id === id)!;

describe("speed / reverse / freeze", () => {
  it("speed rescales duration over the same source span and maps source time", () => {
    const c = ops.setSpeed(comp(clip()), "v", 2);
    const p = byId(c, "v");
    expect(p.durationTicks).toBe(2 * S);
    expect(sourceAt(p, S)).toBe(3 * S);
    expect(byId(ops.setSpeed(c, "v", 1), "v")).toEqual(clip());
  });
  it("slowing down is clamped by the next clip", () => {
    const c = ops.setSpeed(comp(clip(), clip({ id: "n", startTicks: 6 * S })), "v", 0.5);
    expect(byId(c, "v").durationTicks).toBe(6 * S);
  });
  it("reverse maps start to the end of the span and split keeps continuity", () => {
    const c = ops.setReverse(comp(clip()), "v", true);
    const p = byId(c, "v");
    expect(sourceAt(p, 0)).toBe(5 * S - 1);
    expect(sourceAt(p, 4 * S)).toBe(S);
    const sp = ops.splitPlacement(c, "v", S, "r");
    expect(sourceAt(byId(sp, "v"), S / 2)).toBe(sourceAt(p, S / 2));
    expect(sourceAt(byId(sp, "r"), 3 * S)).toBe(sourceAt(p, 3 * S));
  });
  it("split at 2x keeps continuity", () => {
    const c = ops.setSpeed(comp(clip()), "v", 2);
    const sp = ops.splitPlacement(c, "v", S / 2, "r");
    expect(sourceAt(byId(sp, "r"), S)).toBe(sourceAt(byId(c, "v"), S));
  });
  it("trim respects source bounds at speed", () => {
    const c = ops.setSpeed(comp(clip()), "v", 2); // span 1s..9s of a 10s file
    const t = ops.trimPlacement(c, "v", "right", 100 * S, 10 * S);
    expect(byId(t, "v").durationTicks).toBe(4.5 * S);
  });
  it("freeze inserts a held frame and pushes later clips", () => {
    const c = ops.freezeFrame(comp(clip(), clip({ id: "n", startTicks: 5 * S })), "v", S, 3 * S, "f", "r");
    const f = byId(c, "f");
    expect(f).toMatchObject({ startTicks: S, durationTicks: 3 * S, freeze: true, sourceInTicks: 2 * S });
    expect(sourceAt(f, 2 * S)).toBe(2 * S);
    expect(byId(c, "r").startTicks).toBe(4 * S);
    expect(byId(c, "n").startTicks).toBe(8 * S);
    // freeze ignores speed changes; trimming a freeze keeps its frame
    expect(byId(ops.setSpeed(c, "f", 2), "f").durationTicks).toBe(3 * S);
    expect(byId(ops.trimPlacement(c, "f", "left", 2 * S, 10 * S), "f").sourceInTicks).toBe(2 * S);
  });
});
