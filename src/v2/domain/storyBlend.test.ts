import { describe, expect, it } from "vitest";
import { createProject, transformOf, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import * as ops from "./ops";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { RULES, ruleNumber } from "./storyPrompt";
import { sendStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";
import { listPresets } from "../registry";
import { loadPresetModules } from "../presets/load";
import { blendOp, withBlend } from "../render/blend";

const S = TICKS_PER_SECOND;
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S, width: 1920, height: 1080 };
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });
const doc = (layers: unknown[]) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "light-leak", name: "Light leak", type: "video", prompt: "Orange light leak on black" }],
  shots: [{ id: "a", title: "a", description: "", durationSec: 5, prompt: "P", assets: [], qa: [], layers }],
});
const text = (extra: Record<string, unknown> = {}) => ({ id: "t", type: "text", text: "Hi", startSec: 0, endSec: 5, position: { x: 0.5, y: 0.8 }, ...extra });
const leak = (extra: Record<string, unknown> = {}) => ({ id: "l", type: "video", asset: "light-leak", startSec: 0, endSec: 3, box: { x: 0, y: 0, width: 1, height: 1 }, ...extra });
const parse = (raw: unknown) => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return { doc: r.doc as StoryDoc, warnings: r.warnings.map((w) => `${w.path}: ${w.message}`).filter((w) => w.startsWith("shots")) }; };

describe("blend modes and overlays (V2-SB-128)", () => {
  it("ships the blend presets with descriptions and a composite operation each", () => {
    const ids = listPresets("blend").map((d) => d.id);
    expect(ids).toEqual(["normal", "screen", "add", "lighten", "multiply", "darken", "overlay", "soft-light"]);
    for (const d of listPresets("blend")) { expect(d.description.length).toBeGreaterThan(10); expect(typeof d.data?.op).toBe("string"); }
    expect(blendOp("screen")).toBe("screen");
    expect(blendOp("add")).toBe("lighter");
    expect(blendOp("screen@1")).toBe("screen");
    expect(blendOp("normal")).toBeUndefined();
    expect(blendOp("sparkle")).toBeUndefined();
    expect(blendOp(undefined)).toBeUndefined();
  });

  it("rejects a blend module with an unsupported operation", () => {
    const r = loadPresetModules({ "./blend/xor.ts": { default: { kind: "blend", id: "xor", name: "Xor", category: "Odd", description: "Not a real blend mode.", op: "xor" as never } } });
    expect(r.descriptors).toEqual([]);
    expect(r.problems[0]).toMatch(/blend op "xor" must be one of/);
  });

  it("keeps blend and opacity on layers; unknown ids and bad opacity warn", () => {
    const ok = parse(doc([text({ blend: "multiply", opacity: 0.5 }), leak({ blend: "screen", opacity: 0.7 })]));
    expect(ok.warnings).toEqual([]);
    expect(ok.doc.shots[0].layers).toMatchObject([{ blend: "multiply", opacity: 0.5 }, { blend: "screen", opacity: 0.7 }]);
    const bad = parse(doc([leak({ blend: "glow", opacity: 2 })]));
    expect(bad.warnings[0]).toMatch(/^shots\[0\]\.layers\[0\]\.blend: Unknown blend mode "glow"; using "normal" \(the id is kept for export\)\. Known: normal, screen, add/);
    expect(bad.warnings[1]).toBe('shots[0].layers[0].opacity: opacity 2 is ignored: use 0 (invisible) to 1 (solid, the default).');
    expect(bad.doc.shots[0].layers![0]).toMatchObject({ blend: "glow" });
    expect(bad.doc.shots[0].layers![0]).not.toHaveProperty("opacity");
  });

  it("Send to timeline sets the clip blend mode and opacity", () => {
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(parse(doc([text({ blend: "soft-light", opacity: 0.8 }), leak({ blend: "screen", opacity: 0.7 }), leak({ id: "plain", blend: "normal" })])).doc));
    p = up(up(p, { shot: "a" }, vid), { slot: "light-leak" }, vid);
    const { project, result } = sendStory(p);
    expect(result).toMatchObject({ layers: 3 });
    const all = project.compositions[project.rootCompositionId].tracks.flatMap((t) => t.placements);
    const t = all.find((x) => x.clipType === "text")!;
    const overlays = all.filter((x) => x.clipType === "video" && x.storyLink);
    expect(t.blend).toBe("soft-light");
    expect(transformOf(t).opacity).toBeCloseTo(0.8);
    const screen = overlays.find((o) => o.blend)!, plain = overlays.find((o) => !o.blend)!;
    expect(overlays).toHaveLength(2);
    expect(screen.blend).toBe("screen");
    expect(transformOf(screen).opacity).toBeCloseTo(0.7);
    expect(transformOf(plain).opacity).toBe(1);
  });

  it("setBlend sets and clears the mode; it ignores audio clips", () => {
    const comp = { id: "c", tracks: [{ id: "t", kind: "video", name: "V", placements: [{ id: "p", startTicks: 0, durationTicks: S, sourceInTicks: 0, source: { kind: "blob", blobKey: "v" }, clipType: "video" }, { id: "a", startTicks: 0, durationTicks: S, sourceInTicks: 0, source: { kind: "blob", blobKey: "v" }, clipType: "audio" }] }] } as never;
    const pl = (c: { tracks: { placements: { id: string; blend?: string }[] }[] }, id: string) => c.tracks[0].placements.find((x) => x.id === id)!;
    const a = ops.setBlend(comp, "p", "multiply");
    expect(pl(a as never, "p").blend).toBe("multiply");
    expect(pl(ops.setBlend(a, "p", "normal") as never, "p")).not.toHaveProperty("blend");
    expect(pl(ops.setBlend(comp, "a", "screen") as never, "a")).not.toHaveProperty("blend");
  });

  it("withBlend draws with the mode and restores the previous one", () => {
    const seen: string[] = [];
    const ctx = { globalCompositeOperation: "source-over" } as CanvasRenderingContext2D;
    withBlend(ctx, "multiply", () => seen.push(ctx.globalCompositeOperation));
    withBlend(ctx, undefined, () => seen.push(ctx.globalCompositeOperation));
    expect(seen).toEqual(["multiply", "source-over"]);
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });

  it("the guide rule's overlay example is a valid layer", () => {
    const ex = JSON.parse(RULES[ruleNumber("blend-overlays") - 1].match(/(\{ "id": "leak".*?"opacity": 0\.7 \})/)![1]);
    expect(parse(doc([ex])).warnings).toEqual([]);
  });
});
