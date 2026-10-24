import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProject, transformAt, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { effectMoves, followKeyframes, motionAt } from "./storyFollow";
import { RULES, ruleNumber } from "./storyPrompt";
import { sendStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";
import { effectFrameAt } from "../render/effects";

const S = TICKS_PER_SECOND;
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S, width: 1920, height: 1080 };
const img: MediaRef = { blobKey: "i", mime: "image/png", width: 1920, height: 1080 };
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });

const doc = (layers: unknown[], effects: unknown[] = [{ preset: "ken-burns", endSec: 4 }]) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "logo", name: "Logo", type: "image", prompt: "A logo" }],
  shots: [{ id: "a", title: "a", description: "", durationSec: 5, prompt: "P", assets: [], qa: [], layers, effects }],
});
const text = (extra: Record<string, unknown> = {}) => ({ id: "t", type: "text", text: "Hi", startSec: 0, endSec: 5, position: { x: 0.75, y: 0.25 }, ...extra });
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const warnings = (raw: unknown) => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.warnings.map((w) => `${w.path}: ${w.message}`).filter((w) => w.startsWith("shots")); };

describe("layers that follow the shot (V2-SB-126)", () => {
  it("defaults to fixed: follow is kept only as \"shot\"; bad values and nothing-to-follow warn", () => {
    expect(parse(doc([text()])).shots[0].layers![0].follow).toBeUndefined();
    expect(parse(doc([text({ follow: "frame" })])).shots[0].layers![0].follow).toBeUndefined();
    expect(parse(doc([text({ follow: "shot" })])).shots[0].layers![0].follow).toBe("shot");
    expect(warnings(doc([text({ follow: "shot" })]))).toEqual([]);
    expect(warnings(doc([text({ follow: "camera" })]))).toEqual(['shots[0].layers[0].follow: follow "camera" is ignored: use "frame" (stays put, the default) or "shot" (moves with the shot\'s zoom and pan).']);
    const still = 'shots[0].layers[0].follow: Layer "t" follows the shot, but no effect moves or zooms shot "a" while it is on screen, so it stays put.';
    expect(warnings(doc([text({ follow: "shot" })], []))).toEqual([still]);
    expect(warnings(doc([text({ follow: "shot" })], [{ preset: "vignette" }]))).toEqual([still]);
    expect(warnings(doc([text({ follow: "shot", startSec: 4.5 })]))).toEqual([still]);
  });

  it("knows which effects move the picture", () => {
    expect(effectMoves("ken-burns")).toBe(true);
    expect(effectMoves("ken-burns", { zoom: 0, pan: 0 })).toBe(false);
    expect(effectMoves("vignette")).toBe(false);
  });

  it("bakes the picture's motion into keyframes that match the effect render exactly", () => {
    const fx = [{ preset: "ken-burns", offset: 0, duration: 4 * S }];
    const k = followKeyframes(fx, 0, 5 * S, { x: 0.25, y: -0.25, scale: 1 }, S / 4)!;
    expect(k.x).toEqual([{ t: 0, v: 0.25 }, { t: 4 * S - 1, v: 0.3625 }, { t: 4 * S, v: 0.25 }, { t: 5 * S - 1, v: 0.25 }]);
    expect(k.scale).toEqual([{ t: 0, v: 1 }, { t: 4 * S - 1, v: 1.25 }, { t: 4 * S, v: 1 }, { t: 5 * S - 1, v: 1 }]);
    expect(motionAt(fx, 2 * S).scale).toBeCloseTo(1 + 0.25 * (2 * S) / (4 * S - 1));
    expect(followKeyframes(fx, 4 * S, S, { x: 0, y: 0, scale: 1 }, S / 4)).toBeUndefined();
  });

  it("Send to timeline gives following text and overlays keyframes and leaves fixed ones alone", () => {
    const raw = doc([text({ follow: "shot" }), text({ id: "fixed", text: "Fixed" }), { id: "l", type: "image", asset: "logo", startSec: 0, endSec: 5, box: { x: 0.05, y: 0.05, width: 0.2, height: 0.2 }, follow: "shot" }]);
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(parse(raw)));
    p = up(up(p, { shot: "a" }, vid), { slot: "logo" }, img);
    const { project, result } = sendStory(p);
    expect(result).toMatchObject({ layers: 3, effects: 1 });
    const comp = project.compositions[project.rootCompositionId];
    const all = comp.tracks.flatMap((t) => t.placements);
    const texts = all.filter((x) => x.clipType === "text");
    const fixed = texts.find((x) => x.text?.text === "Fixed")!, follow = texts.find((x) => x.text?.text === "Hi")!;
    const logo = all.find((x) => x.clipType === "image")!;
    expect(fixed.keyframes).toBeUndefined();
    expect(follow.keyframes?.x?.length).toBeGreaterThan(1);
    // At every sampled time the layer sits where the zoomed/panned picture puts its original position.
    for (const t of [0, S, 2.5 * S, 4 * S - 1, 4.5 * S]) {
      const at = follow.startTicks + t, f = effectFrameAt(comp, at) ?? { dx: 0, dy: 0, scale: 1 };
      const tr = transformAt(follow, at), lt = transformAt(logo, at);
      expect(tr.x).toBeCloseTo(f.dx + f.scale * 0.25, 3);
      expect(tr.y).toBeCloseTo(f.dy + f.scale * -0.25, 3);
      expect(tr.scale).toBeCloseTo(f.scale, 3);
      expect(lt.x).toBeCloseTo(f.dx + f.scale * (0.15 - 0.5), 3);
      expect(lt.scale).toBeCloseTo(f.scale * 0.2, 3);
    }
  });
  it("the fixture's card text follows the push-in, and the guide's example imports cleanly", () => {
    const fx = JSON.parse(readFileSync(new URL("./__fixtures__/ep01_opening.storyboard.json", import.meta.url), "utf8"));
    const r = validateStoryboard(fx);
    expect(r.ok && r.warnings.filter((w) => w.path.endsWith(".follow"))).toEqual([]);
    expect(r.ok && r.doc.shots.find((s) => s.id === "s03")!.layers![0].follow).toBe("shot");
    const tag = JSON.parse(RULES[ruleNumber("layer-follow") - 1].match(/(\{ "id": "tag".*?"follow": "shot" \})/)![1]);
    expect(warnings(doc([tag]))).toEqual([]);
    expect(warnings(doc([tag], []))).toEqual(['shots[0].layers[0].follow: Layer "tag" follows the shot, but no effect moves or zooms shot "a" while it is on screen, so it stays put.']);
  });
});
