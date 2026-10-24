import { describe, expect, it } from "vitest";
import { createProject, type Project } from "./model";
import * as board from "./storyboard";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import * as steps from "./storySteps";

const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
/** look ← char ← shot a → (last frame) lf ← shot b (+ logo layer); shot c is an html shot with clip "card". */
const doc = parse({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "look", name: "Look", type: "image", prompt: "Style" },
    { id: "char", name: "Char", type: "image", prompt: "Hero", references: ["look"] },
    { id: "lf", name: "End frame", type: "image", prompt: "", source: { type: "lastFrame", shot: "a" } },
    { id: "logo", name: "Logo", type: "image", prompt: "Logo", source: { type: "upload" } },
    { id: "card", name: "Card", type: "html", prompt: "<h1>Hi</h1>" },
  ],
  shots: [
    { id: "a", title: "One", description: "", durationSec: 4, prompt: "Walk", assets: ["char"], qa: [] },
    { id: "b", title: "Two", description: "", durationSec: 4, prompt: "Look", assets: ["lf"], qa: [],
      layers: [{ id: "l1", type: "image", asset: "logo", box: { x: 0.6, y: 0.6, width: 0.3, height: 0.3 }, startSec: 0, endSec: 4 }] },
    { id: "c", title: "Card", description: "", durationSec: 3, prompt: "", assets: [], qa: [], render: "html", clip: "card" },
  ],
  connections: [],
});
const fresh = () => board.setStoryboard(createProject("s"), board.storyboardFromDoc(doc));
const keys = (p: Project) => board.productionSteps(p).map((s) => s.key);
const NATURAL = ["slot:look", "slot:char", "shot:a", "slot:lf", "slot:logo", "shot:b", "slot:card", "shot:c"];
const respectsDeps = (p: Project) => {
  const k = keys(p), deps = steps.stepDeps(p.storyboard!);
  return k.every((x, i) => (deps.get(x) ?? []).every((d) => k.indexOf(d) < i));
};

describe("storySteps: production step order (V2-CUT-07)", () => {
  it("suggests a dependency order, with media-layer assets before their shot", () => {
    const p = fresh();
    expect(keys(p)).toEqual(NATURAL);
    expect(steps.stepDeps(p.storyboard!).get("shot:b")).toEqual(["slot:lf", "slot:logo"]);
    expect(steps.stepDeps(p.storyboard!).get("slot:lf")).toEqual(["shot:a"]);
    expect(steps.stepDeps(p.storyboard!).get("shot:c")).toEqual(["slot:card"]);
  });

  it("clamps moves to dependency order and says what stopped them", () => {
    const b = fresh().storyboard!;
    expect(steps.clampStepMove(b, NATURAL, 2, 0)).toEqual({ to: 2, by: "slot:char", why: "needs" });
    expect(steps.clampStepMove(b, NATURAL, 0, 7)).toEqual({ to: 0, by: "slot:char", why: "usedBy" });
    expect(steps.clampStepMove(b, NATURAL, 4, 0)).toEqual({ to: 0 }); // the logo needs nothing
    expect(steps.clampStepMove(b, NATURAL, 4, 7)).toEqual({ to: 4, by: "shot:b", why: "usedBy" });
    expect(steps.clampStepMove(b, NATURAL, 2, 7)).toEqual({ to: 2, by: "slot:lf", why: "usedBy" });
    expect(steps.stepMoveRange(b, NATURAL, 6)).toEqual({ min: 0, max: 6 });
  });

  it("moves steps, saves the order, and resets it", () => {
    let p = fresh();
    p = steps.moveStep(p, keys(p), "slot:card", 0);
    p = steps.moveStep(p, keys(p), "shot:c", 1);
    expect(keys(p)).toEqual(["slot:card", "shot:c", "slot:look", "slot:char", "shot:a", "slot:lf", "slot:logo", "shot:b"]);
    expect(p.storyboard!.stepOrder).toEqual(keys(p));
    // A move into a dependency stops next to it.
    p = steps.moveStep(p, keys(p), "shot:b", 0);
    expect(keys(p).indexOf("shot:b")).toBe(7);
    p = steps.moveStep(p, keys(p), "slot:logo", 0);
    expect(keys(p)[0]).toBe("slot:logo");
    expect(respectsDeps(p)).toBe(true);
    const q = steps.resetStepOrder(p);
    expect(q.storyboard!.stepOrder).toBeUndefined();
    expect(keys(q)).toEqual(NATURAL);
    expect(steps.resetStepOrder(q)).toBe(q);
    expect(steps.moveStep(q, keys(q), "slot:look", 5)).toBe(q); // nowhere to go
  });

  it("keeps dependency order when shots change after the order was saved", () => {
    let p = fresh();
    const b = p.storyboard!;
    // A saved order that is now wrong: shot c first, and shot a later gets the logo as a reference.
    p = { ...p, storyboard: { ...b, stepOrder: ["shot:c", "shot:a", "slot:card", "slot:look", "slot:char", "slot:lf", "slot:logo", "shot:b", "slot:gone"],
      shots: { ...b.shots, a: { ...b.shots.a, slotIds: ["char", "logo"] } } } };
    expect(respectsDeps(p)).toBe(true);
    expect(keys(p)).toEqual(["slot:card", "shot:c", "slot:look", "slot:char", "slot:logo", "shot:a", "slot:lf", "shot:b"]);
    // A new asset that is not in the saved order goes next to its suggested neighbour.
    const sb = { ...p.storyboard!, stepOrder: keys(p) };
    p = { ...p, storyboard: { ...sb, slots: { ...sb.slots, rain: { id: "rain", name: "Rain", type: "video", aspect: "16:9", prompt: "", references: [], source: { type: "generate" }, qa: [] } } } };
    expect(keys(p).indexOf("slot:rain")).toBe(keys(p).indexOf("shot:c") + 1); // after shot c, as in the suggested order
    expect(keys(p)).toHaveLength(9);
  });
});
