/** P6-FX-SCOPE: effect clips' "Apply to" scope (main / overlay / all) — model, commands, renderer, storyboard JSON, zip. */
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { Engine } from "../engine/engine";
import * as cmd from "../engine/commands";
import { createProject, effectScopeOf, type Project } from "../domain/model";
import { validateStoryboard, STORYBOARD_FORMAT } from "../domain/storyJson";
import { storyboardFromDoc } from "../domain/storyboard";
import { storyboardToDoc } from "../domain/storyRoundtrip";
import { createMemoryStorage } from "../persistence/memory";
import { BlobSink, exportProjectArchive, importProjectArchive, readProjectArchive } from "../persistence/archive/projectArchive";
import { applyPreset, identityFrame } from "../registry";
import { mockCtx, stubOffscreen } from "../presets/__testutils__/mockCanvas";
import { applyEffectFrame, effectFrameAt } from "./effects";

const root = (p: Project) => p.compositions[p.rootCompositionId];
const fxOf = (e: Engine, id: string) => root(e.getState().project).tracks.flatMap((t) => t.placements).find((x) => x.id === id)!.effect!;

describe("effect scope (P6-FX-SCOPE)", () => {
  it("defaults to main: a missing or unknown applyTo is main, so old projects render as before", () => {
    expect(effectScopeOf({})).toBe("main");
    expect(effectScopeOf(undefined)).toBe("main");
    expect(effectScopeOf({ applyTo: "everything" })).toBe("main");
    expect(effectScopeOf({ applyTo: "all" })).toBe("all");
    const e = new Engine(createProject("x"));
    e.dispatch(cmd.addEffectClip(0, "ken-burns", { zoom: 0.5, pan: 0 }, "a"));
    expect(fxOf(e, "a").applyTo).toBeUndefined();
    expect(effectFrameAt(root(e.getState().project), 0)).toBeDefined();
  });

  it("setEffectScope switches the scope (main stored as no field), undoable; effectFrameAt filters by scope", () => {
    const e = new Engine(createProject("x"));
    e.dispatch(cmd.addEffectClip(0, "bw", undefined, "a"));
    e.dispatch(cmd.addEffectClip(0, "ken-burns", { zoom: 0.5, pan: 0 }, "b"));
    e.dispatch(cmd.setEffectScope("b", "all"));
    expect(fxOf(e, "b").applyTo).toBe("all");
    const c = () => root(e.getState().project);
    expect(effectFrameAt(c(), 360_000 - 1, "main")).toMatchObject({ gray: 1, scale: 1 });
    expect(effectFrameAt(c(), 360_000 - 1, "all")!.scale).toBeCloseTo(1.5);
    expect(effectFrameAt(c(), 0, "overlay")).toBeUndefined();
    e.dispatch(cmd.setEffectScope("a", "overlay"));
    expect(effectFrameAt(c(), 0, "overlay")!.gray).toBe(1);
    expect(effectFrameAt(c(), 0, "main")).toBeUndefined();
    e.dispatch(cmd.setEffectScope("a", "main"));
    expect("applyTo" in fxOf(e, "a")).toBe(false);
    e.undo(); e.undo();
    expect(fxOf(e, "a").applyTo).toBeUndefined();
    expect(fxOf(e, "b").applyTo).toBe("all");
  });

  it("changing the preset or its params keeps the scope", () => {
    const e = new Engine(createProject("x"));
    e.dispatch(cmd.addEffectClip(0, "blur", undefined, "a"));
    e.dispatch(cmd.setEffectScope("a", "all"));
    e.dispatch(cmd.setEffect("a", { params: { amount: 0.5 } }));
    expect(fxOf(e, "a")).toEqual({ preset: "blur", params: { amount: 0.5 }, applyTo: "all" });
    e.dispatch(cmd.setEffect("a", { preset: "vignette" }));
    expect(fxOf(e, "a")).toEqual({ preset: "vignette", applyTo: "all" });
  });

  it("overlay layers keep their transparency: the uncovered area is cleared, not filled black", () => {
    stubOffscreen();
    const f = applyPreset("videoEffect", "ken-burns", 1, identityFrame(), { zoom: 0.5, pan: 0 });
    const opaque = mockCtx(), clear = mockCtx();
    applyEffectFrame(opaque.ctx, 64, 36, f);
    applyEffectFrame(clear.ctx, 64, 36, f, true);
    expect(opaque.calls).toContain("fillRect");
    expect(clear.calls).toContain("clearRect");
    expect(clear.calls).not.toContain("fillRect");
    vi.unstubAllGlobals();
  });

  it("storyboard JSON: applyTo is parsed, a bad value warns and falls back to main, and it round-trips on export", () => {
    const d = {
      format: STORYBOARD_FORMAT, meta: { title: "T", aspect: "16:9" }, assets: [],
      shots: [{ id: "s1", title: "One", durationSec: 4, prompt: "a walk", assets: [], qa: [], effects: [{ preset: "ken-burns", applyTo: "all" }, { preset: "bw", applyTo: "overlay" }, { preset: "blur", applyTo: "both" }] }],
      connections: [],
    };
    const r = validateStoryboard(d);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.doc.shots[0].effects?.map((x) => x.applyTo)).toEqual(["all", "overlay", undefined]);
    expect(r.warnings.map((w) => w.path)).toContain("shots[0].effects[2].applyTo");
    const back = storyboardToDoc(storyboardFromDoc(r.doc));
    expect(back.shots[0].effects?.map((x) => x.applyTo)).toEqual(["all", "overlay", undefined]);
  });

  it("project export/import zip round-trips the scope", async () => {
    const e = new Engine(createProject("zip"));
    e.dispatch(cmd.addEffectClip(0, "ken-burns", undefined, "a"));
    e.dispatch(cmd.setEffectScope("a", "all"));
    const p = e.getState().project;
    const s = createMemoryStorage();
    await s.projects.save(p);
    const sink = new BlobSink();
    await exportProjectArchive(p, s.blobs, sink);
    const got = await importProjectArchive(createMemoryStorage(), await readProjectArchive(sink.blob()), "new");
    expect(root(got).tracks.flatMap((t) => t.placements).find((x) => x.id === "a")?.effect).toEqual({ preset: "ken-burns", applyTo: "all" });
  });
});
