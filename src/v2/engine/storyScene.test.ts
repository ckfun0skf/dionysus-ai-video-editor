/**
 * P79 (Phase 2 step 2.6): storyboard "scene" assets and render "scene" shots: the validator, Send to timeline (a scene
 * placeholder until the scene has a version), Update, Re-lay and Sync to Storyboard.
 */
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import { roundtrip, SAMPLE_SCENE, sceneMediaRef, syncPlan } from "../domain";
import { createProject, type Placement, type Project } from "../domain/model";
import { validateStoryboard, type StoryDoc } from "../domain/storyJson";
import { secondsToTicks as s } from "../domain/time";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): J => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "hero", name: "Hero", type: "character", prompt: "hero sheet", qa: [] },
    { id: "spin", name: "Product spin", type: "scene", prompt: "a bottle turning on a plinth, slow camera push", qa: [] },
  ],
  shots: [
    { id: "s1", title: "One", durationSec: 5, prompt: "a walk", assets: ["hero"], qa: [] },
    { id: "s2", title: "Spin", durationSec: 4, render: "scene", clip: "spin", assets: [], qa: [] },
  ],
});
const validate = (mut: (d: J) => void = () => {}) => { const d = base(); mut(d); return validateStoryboard(d); };
const doc = (mut?: (d: J) => void): StoryDoc => { const r = validate(mut); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const errs = (mut: (d: J) => void) => { const r = validate(mut); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };
const warns = (mut: (d: J) => void) => { const r = validate(mut); return r.warnings.map((e) => `${e.path}: ${e.message}`); };
const root = (p: Project) => p.compositions[p.rootCompositionId];
const mainClips = (p: Project) => ops.mainTrack(root(p))!.placements;
const ofShot = (p: Project, id: string) => mainClips(p).find((x) => x.storyShot === id)!;
const video = (sec: number) => ({ blobKey: `v${sec}`, mime: "video/mp4", durationTicks: s(sec), width: 1920, height: 1080 });

describe("P79 storyboard JSON: scene assets and render scene", () => {
  it("accepts a scene asset and a render scene shot, with an optional inline scene", () => {
    const d = doc((x) => { x.assets[1].scene = SAMPLE_SCENE; });
    expect(d.assets[1]).toMatchObject({ type: "scene", scene: { format: "dionysus.scene/1" } });
    expect(d.shots[1]).toMatchObject({ render: "scene", clip: "spin" });
    expect(validate().warnings).toEqual([]);
  });

  it("checks the clip, the brief, lastFrame and the inline scene", () => {
    expect(errs((x) => { x.shots[1].clip = "hero"; }).join("\n")).toMatch(/scene/);
    expect(errs((x) => { delete x.shots[1].clip; }).join("\n")).toMatch(/clip/);
    expect(errs((x) => { x.assets[1].prompt = ""; }).join("\n")).toMatch(/prompt/);
    // An inline scene stands in for the brief.
    expect(errs((x) => { x.assets[1].prompt = ""; x.assets[1].scene = SAMPLE_SCENE; })).toEqual([]);
    expect(errs((x) => { x.assets[1].source = { type: "lastFrame", shot: "s1" }; }).join("\n")).toMatch(/assets\[1\]/);
    expect(errs((x) => { x.assets[1].scene = { objects: [{ id: "a", shape: "star" }] }; }).join("\n")).toMatch(/^assets\[1\]\.scene\.objects\[0\]/m);
    expect(errs((x) => { x.assets[1].scene = "nope"; }).join("\n")).toMatch(/assets\[1\]\.scene/);
    expect(warns((x) => { x.assets[0].scene = SAMPLE_SCENE; }).join("\n")).toMatch(/assets\[0\]\.scene/);
    expect(errs((x) => { x.shots[1].render = "vr"; }).join("\n")).toMatch(/must be one of: ai, html, still, scene/);
  });
});

describe("P79 send, update, re-lay and sync with scene shots", () => {
  const setup = () => { const e = new Engine(createProject("t")); e.dispatch(cmd.createStoryboard(doc())); e.dispatch(cmd.addStoryVersion({ shot: "s1" }, video(5), { versionId: "a1" })); return e; };

  it("a scene shot without a version is sent as a placeholder whose intended type is scene; Update fills it with a scene clip", () => {
    const e = setup();
    e.dispatch(cmd.sendStoryToTimeline());
    const ph = ofShot(e.getState().project, "s2");
    expect(ph).toMatchObject({ clipType: "scene", placeholder: expect.any(Object), durationTicks: s(4) });
    e.dispatch(cmd.addStoryVersion({ slot: "spin" }, sceneMediaRef("scene-1"), { versionId: "sc1" }));
    const p0 = e.getState().project, b = p0.storyboard!;
    expect(p0.assets[b.slots.spin.assetId!].kind).toBe("scene");
    expect(b.shots.s2.assetId).toBe(b.slots.spin.assetId);
    e.dispatch(cmd.updateStoryTimeline());
    const pl = ofShot(e.getState().project, "s2");
    expect(pl.placeholder).toBeUndefined();
    expect(pl).toMatchObject({ clipType: "scene", startTicks: s(5), durationTicks: s(4), source: { assetId: b.slots.spin.assetId } });
  });

  it("with a version, Send places a scene clip for the planned length; Re-lay keeps it a scene clip", () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ slot: "spin" }, sceneMediaRef("scene-1"), { versionId: "sc1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(ofShot(e.getState().project, "s2")).toMatchObject({ clipType: "scene", durationTicks: s(4) });
    expect(ofShot(e.getState().project, "s2").placeholder).toBeUndefined();
    e.dispatch(cmd.updateShot("s2", { durationSec: 6 }));
    e.dispatch(cmd.relayoutStoryTimeline());
    expect(ofShot(e.getState().project, "s2")).toMatchObject({ clipType: "scene", startTicks: s(5), durationTicks: s(6) });
  });

  it("html and still placeholders keep the image type (unchanged)", () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.createStoryboard(doc((x) => { x.assets.push({ id: "logo", name: "Logo", type: "html", prompt: "logo", qa: [] }); x.shots.push({ id: "s3", title: "L", durationSec: 2, render: "html", clip: "logo", assets: [], qa: [] }); })));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(ofShot(e.getState().project, "s3").clipType).toBe("image");
  });

  it("Sync maps a scene clip added on the timeline back to a render scene shot (no prompt needed), and a sent scene shot to itself", () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ slot: "spin" }, sceneMediaRef("scene-1"), { versionId: "sc1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(syncPlan(e.getState().project).changes.filter((c) => c.kind === "newShot")).toEqual([]);
    // A scene clip made on the timeline (e.g. by create_scene_clip).
    const p = e.getState().project, m = ops.mainTrack(root(p))!;
    const end = m.placements.reduce((x, pl) => Math.max(x, pl.startTicks + pl.durationTicks), 0);
    const assetId = "ast_new_scene";
    const withScene: Project = { ...p, assets: { ...p.assets, [assetId]: { id: assetId, kind: "scene", name: "Orbit", selectedVersionId: "nv", versions: [{ id: "nv", createdAt: "", media: sceneMediaRef("scene-2"), provenance: { source: "import", inputs: [] } }] } } };
    const pl: Placement = { id: "plc_scene", startTicks: end, durationTicks: s(3), sourceInTicks: 0, source: { kind: "assetVersion", assetId, versionId: "nv" }, clipType: "scene" };
    const q: Project = { ...withScene, compositions: { ...withScene.compositions, [p.rootCompositionId]: ops.insertPlacement(root(withScene), m.id, pl) } };
    const plan = syncPlan(q);
    const added = plan.changes.find((c) => c.kind === "newShot")!;
    expect(added.label).toBe('New scene shot "Orbit" from the timeline');
    expect(added.needsPrompt).toBeUndefined();
    const b = plan.project.storyboard!, shot = b.shots[added.id];
    expect(shot).toMatchObject({ render: "scene", assetId, durationSec: 3 });
    expect(shot.needsPrompt).toBeUndefined();
    expect(b.slots[shot.clipSlot!]).toMatchObject({ type: "scene", assetId });
    expect(b.order.at(-1)).toBe(added.id);
    // The new shot exports as a render scene shot whose clip is a scene asset, and the result validates.
    const out = roundtrip.storyboardToDoc(b);
    expect(out.shots.find((x) => x.id === added.id)).toMatchObject({ render: "scene", clip: shot.clipSlot });
    expect(out.assets.find((x) => x.id === shot.clipSlot)).toMatchObject({ type: "scene" });
    const again = validateStoryboard(JSON.parse(JSON.stringify(out)));
    expect(again.ok ? [] : again.errors).toEqual([]);
  });
});
