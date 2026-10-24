import { describe, expect, it } from "vitest";
import { Engine } from "../engine/engine";
import * as cmd from "../engine/commands";
import { createProject, validateComposition } from "../domain/model";
import * as ops from "../domain/ops";
import { effectFrameAt } from "./effects";
import { listPresets } from "../registry";

const setup = () => {
  const e = new Engine(createProject("fx"));
  const comp = () => e.getState().project.compositions[e.getState().project.rootCompositionId];
  return { e, comp };
};

describe("effect layers (V2-101)", () => {
  it("registry has only the real effects, separate from text effects", () => {
    // V2-FX-MOD: new effect modules add themselves, so check the originals are there rather than an exact list.
    const fx = listPresets("videoEffect").map((d) => d.id);
    expect(fx).toEqual(expect.arrayContaining(["blur", "bw", "fade-in", "fade-out", "ken-burns", "shake", "vignette"]));
    for (const id of ["neon", "echo", "hollow"]) expect(fx).not.toContain(id);
    expect(listPresets("effect").map((d) => d.id)).toContain("glow");
  });
  it("adds effect clips on an Effects layer above main, valid and undoable", () => {
    const { e, comp } = setup();
    e.dispatch(cmd.addEffectClip(0, "bw", undefined, "fx1"));
    const t = comp().tracks.find((x) => x.kind === "effect")!;
    expect(ops.groupOf(comp(), t)).toBe("effect");
    expect(comp().tracks.indexOf(t)).toBeLessThan(comp().tracks.indexOf(ops.mainTrack(comp())!));
    expect(validateComposition(comp())).toEqual([]);
    e.dispatch(cmd.addEffectClip(0, "blur", undefined, "fx2"));
    expect(comp().tracks.filter((x) => x.kind === "effect")).toHaveLength(2);
    e.undo(); e.undo();
    expect(comp().tracks.flatMap((x) => x.placements)).toHaveLength(0);
  });
  it("composes active effects in layer order, skips hidden layers and inactive times", () => {
    const { e, comp } = setup();
    e.dispatch(cmd.addEffectClip(0, "bw", undefined, "a"));
    e.dispatch(cmd.addEffectClip(0, "ken-burns", { zoom: 0.5, pan: 0 }, "b"));
    const f = effectFrameAt(comp(), 360_000 - 1)!;
    expect(f.gray).toBe(1);
    expect(f.scale).toBeCloseTo(1.5);
    expect(effectFrameAt(comp(), 400_000)).toBeUndefined();
    const fxTrack = comp().tracks.find((t) => t.placements.some((p) => p.id === "a"))!;
    e.dispatch(cmd.toggleTrackHidden(fxTrack.id));
    expect(effectFrameAt(comp(), 0)!.gray).toBeUndefined();
  });
  it("changes preset (params reset) and params as coalesced steps", () => {
    const { e, comp } = setup();
    e.dispatch(cmd.addEffectClip(0, "blur", undefined, "a"));
    e.dispatch(cmd.setEffect("a", { params: { amount: 0.2 } }));
    e.dispatch(cmd.setEffect("a", { params: { amount: 0.9 } }));
    const p = () => comp().tracks.flatMap((t) => t.placements).find((x) => x.id === "a")!;
    expect(p().effect).toEqual({ preset: "blur", params: { amount: 0.9 } });
    e.dispatch(cmd.setEffect("a", { preset: "vignette" }));
    expect(p().effect).toEqual({ preset: "vignette" });
    e.undo();
    expect(p().effect?.preset).toBe("blur");
    expect(effectFrameAt(comp(), 0)!.blur).toBeCloseTo(0.018);
  });
  it("fade in/out ramp alpha across the clip", () => {
    const { e, comp } = setup();
    e.dispatch(cmd.addEffectClip(0, "fade-in", { length: 1 }, "a"));
    expect(effectFrameAt(comp(), 0)!.alpha).toBe(0);
    expect(effectFrameAt(comp(), 180_000)!.alpha).toBeCloseTo(0.5, 2);
  });
});
