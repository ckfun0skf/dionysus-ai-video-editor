/** P89: a storyboard layer's "motionPath" (frame points, seconds) → Send → the clip → Sync back → export JSON. */
import { describe, expect, it } from "vitest";
import { createProject, findPlacement, type Project } from "./index";
import { validateStoryboard, type StoryDoc, type StoryTextLayer } from "./storyJson";
import { storyboardToDoc } from "./storyRoundtrip";
import { cmd, Engine } from "../engine";

const S = 120_000;
const doc = (layer: Record<string, unknown>) => ({
  format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [],
  shots: [{ id: "s1", title: "One", durationSec: 4, prompt: "p", assets: [], qa: [], layers: [{ id: "l1", type: "text", text: "Hi", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.5 }, ...layer }] }], connections: [],
});
const all = (p: Project) => Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements));

describe("storyboard layer motionPath (P89)", () => {
  it("parses frame points into centre offsets, spreads times over the layer, and warns instead of failing", () => {
    const r = validateStoryboard(doc({ motionPath: { nodes: [{ x: 0.1, y: 0.8 }, { x: 0.5, y: 0.3, in: { x: -0.1, y: 0 }, out: { x: 0.1, y: 0 } }, { x: 0.9, y: 0.8 }], orient: true }, follow: "shot" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.doc.shots[0].layers![0] as StoryTextLayer;
    expect(l.follow).toBeUndefined();
    expect(r.warnings.map((w) => w.path)).toContain("shots[0].layers[0].follow");
    expect(l.motionPath!.nodes.map((n) => [n.x, n.y])).toEqual([[-0.4, 0.3], [0, -0.2], [0.4, 0.3]]);
    expect(l.motionPath!.nodes[0].t).toBe(0);
    expect(l.motionPath!.nodes[2].t).toBe(4 * S);
    expect(l.motionPath).toMatchObject({ constantSpeed: true, orient: { offset: 0 } });
    const bad = validateStoryboard(doc({ motionPath: { nodes: [{ x: "left", y: 0 }] } }));
    expect(bad.ok).toBe(true);
    if (bad.ok) {
      expect(bad.doc.shots[0].layers![0].motionPath).toBeUndefined();
      expect(bad.warnings.find((w) => w.path === "shots[0].layers[0].motionPath.nodes[0]")?.message).toMatch(/fractions of the frame from the top-left.*ignored/);
    }
  });

  it("Send puts the path on the layer's clip, Sync writes an edited path back, and the export is frame points in seconds", () => {
    const r = validateStoryboard(doc({ motionPath: { nodes: [{ id: "a", t: 0, x: 0.2, y: 0.5 }, { id: "b", t: 2, x: 0.8, y: 0.5, ease: "inOut" }] } }));
    if (!r.ok) throw new Error("bad doc");
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.createStoryboard(r.doc as StoryDoc));
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "k1", mime: "video/mp4", durationTicks: 4 * S }, { versionId: "o1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    const text = () => all(e.getState().project).find((x) => x.clipType === "text")!;
    expect(text().motionPath).toEqual({ nodes: [{ id: "a", t: 0, x: -0.3, y: 0 }, { id: "b", t: 2 * S, x: 0.3, y: 0, ease: "inOut" }] });
    const p = e.getState().project, edited = { ...text().motionPath!, nodes: text().motionPath!.nodes.map((n) => (n.id === "b" ? { ...n, y: -0.25 } : n)) };
    expect(findPlacement(p.compositions[p.rootCompositionId], text().id)).toBeTruthy();
    e.dispatch(cmd.setMotionPath(text().id, edited));
    e.dispatch(cmd.syncToStoryboard());
    const b = e.getState().project.storyboard!;
    expect(b.shots.s1.layers![0].motionPath!.nodes[1]).toMatchObject({ id: "b", y: -0.25 });
    const out = storyboardToDoc(b).shots[0].layers![0].motionPath as unknown as { nodes: { id: string; t: number; x: number; y: number }[] };
    expect(out.nodes).toEqual([{ id: "a", t: 0, x: 0.2, y: 0.5 }, { id: "b", t: 2, x: 0.8, y: 0.25, ease: "inOut" }]);
    // The exported JSON imports again to the same path.
    const again = validateStoryboard({ ...doc({}), shots: [{ ...doc({}).shots[0], layers: [{ ...doc({}).shots[0].layers[0], motionPath: out }] }] });
    expect(again.ok && again.doc.shots[0].layers![0].motionPath).toEqual(b.shots.s1.layers![0].motionPath);
  });
});
