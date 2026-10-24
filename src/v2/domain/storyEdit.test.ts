import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import * as edit from "./storyEdit";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { sendStory } from "./storySend";

const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const doc = parse(LANTERN_KEEPER);
const img: MediaRef = { blobKey: "b", mime: "image/png", width: 16, height: 9 };
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 600_000 };
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m?: MediaRef) => board.addStoryVersion(p, t, m ?? ("slot" in t ? img : vid), { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });
const fresh = (d = doc) => board.setStoryboard(createProject("s"), board.storyboardFromDoc(d));
const sb = (p: Project) => p.storyboard!;

/** A v1.1 doc: an html title card, a still shot sharing it, layers, an effect and a crossfade. */
const v11 = parse({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "card", name: "Card", type: "html", prompt: "<h1>Hi</h1>" },
    { id: "photo", name: "Photo", type: "image", prompt: "A photo" },
  ],
  shots: [
    { id: "a", title: "Open", description: "", durationSec: 4, prompt: "", assets: [], qa: [], render: "html", clip: "card" },
    { id: "b", title: "Middle", description: "", durationSec: 6, prompt: "Walk", assets: ["photo"], qa: ["Steady"], dialogue: "Hello", captions: true,
      layers: [{ id: "t1", type: "text", text: "Hi", position: { x: 0.5, y: 0.8 }, startSec: 1, endSec: 6 }], effects: [{ preset: "blur", startSec: 4, endSec: 6 }] },
    { id: "c", title: "End", description: "", durationSec: 3, prompt: "Fade", assets: [], qa: [] },
  ],
  connections: [{ from: "a", to: "b", kind: "cut", transition: { preset: "crossfade", params: { durationSec: 0.5 } } }],
});

describe("storyEdit", () => {
  it("adds a shot after another with defaults and a free id", () => {
    let p = fresh();
    const id = edit.nextShotId(sb(p));
    expect(id).toBe("s4");
    p = edit.addShot(p, id, { title: "Beat" }, "s1");
    expect(sb(p).order).toEqual(["s1", "s4", "s2", "s3"]);
    expect(sb(p).shots.s4).toMatchObject({ title: "Beat", durationSec: 5, prompt: "", slotIds: [], qa: [] });
    expect(edit.addShot(p, "s4")).toBe(p);
  });

  it("edits fields, keeps check ids and clamps the length", () => {
    let p = fresh();
    const qa = [...sb(p).shots.s1.qa, { id: edit.newCheckId("s1", sb(p).shots.s1.qa), text: " New check " }, { id: "x", text: "  " }];
    p = edit.updateShot(p, "s1", { title: "  ", durationSec: 500, camera: "", dialogue: "Line", qa });
    const s = sb(p).shots.s1;
    expect(s.title).toBe(fresh().storyboard!.shots.s1.title);
    expect(s.durationSec).toBe(120);
    expect(s.camera).toBeUndefined();
    expect(s.dialogue).toBe("Line");
    expect(s.qa.map((q) => q.id)).toEqual([...fresh().storyboard!.shots.s1.qa.map((q) => q.id), `s1.qa${qa.length - 1}`]);
    expect(s.qa.at(-1)!.text).toBe("New check");
  });

  it("shortening a shot clamps its layers and effects instead of dropping them", () => {
    let p = fresh(v11);
    expect(edit.partsPastEnd(sb(p).shots.b, 3)).toBe(2);
    p = edit.updateShot(p, "b", { durationSec: 3 });
    const s = sb(p).shots.b;
    expect(s.layers![0]).toMatchObject({ startSec: 1, endSec: 3 });
    expect(s.effects![0]).toMatchObject({ startSec: 2.9, endSec: 3 });
  });

  it("switches render ai ↔ still, keeping the shot's own clip versions aside", () => {
    let p = fresh(v11);
    p = up(p, { shot: "b" });
    const own = sb(p).shots.b.assetId!;
    p = up(p, { slot: "photo" });
    expect(edit.updateShot(p, "b", { render: "still", clipSlot: "card" })).toEqual(p); // wrong type: unchanged
    p = edit.updateShot(p, "b", { render: "still", clipSlot: "photo" });
    expect(sb(p).shots.b).toMatchObject({ render: "still", clipSlot: "photo", assetId: sb(p).slots.photo.assetId, ownAssetId: own });
    p = edit.updateShot(p, "b", { render: "ai" });
    expect(sb(p).shots.b.assetId).toBe(own);
    expect(sb(p).shots.b.render).toBeUndefined();
    expect(sb(p).shots.b.slotIds).toEqual([]);
  });

  it("duplicates a shot right after it without versions; html copies share the clip and both can be sent", () => {
    let p = fresh(v11);
    p = up(p, { slot: "card" }, { blobKey: "h", mime: "text/html" } as MediaRef);
    p = edit.duplicateShot(p, "a", "a2");
    expect(sb(p).order).toEqual(["a", "a2", "b", "c"]);
    expect(sb(p).shots.a2).toMatchObject({ title: "Open (copy)", render: "html", clipSlot: "card", assetId: sb(p).shots.a.assetId });
    const first = sendStory(p);
    expect(first.result.shots).toBe(2);
    expect(board.sendPlan(first.project).filter((s) => s.shotId.startsWith("a")).map((s) => s.state)).toEqual(["placed", "placed"]);
    p = up(p, { shot: "b" });
    p = edit.duplicateShot(p, "b", "b2");
    const b2 = sb(p).shots.b2;
    expect(b2.assetId).toBeUndefined();
    expect(b2.layers).toEqual(sb(p).shots.b.layers);
    expect(b2.qa.map((q) => q.id)).toEqual(["b2.qa1"]);
  });

  it("deletes a shot: last frames become uploads, connections go, timeline clips stay, undo is the old project", () => {
    let p = fresh();
    for (const s of ["keeper", "cliff", "lantern"]) p = up(p, { slot: s });
    p = up(p, { shot: "s1" });
    p = up(p, { slot: "s1-end" });
    p = sendStory(p).project;
    const clips = p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements).length;
    expect(edit.deleteShotEffects(sb(p), "s1").frames.map((s) => s.id)).toEqual(["s1-end"]);
    const q = edit.deleteShot(p, "s1");
    expect(sb(q).order).toEqual(["s2", "s3"]);
    expect(sb(q).slots["s1-end"].source).toEqual({ type: "upload" });
    expect(sb(q).slots["s1-end"].assetId).toBe(sb(p).slots["s1-end"].assetId);
    expect(sb(q).connections.some((c) => c.from === "s1" || c.to === "s1")).toBe(false);
    expect(q.compositions[q.rootCompositionId].tracks.flatMap((t) => t.placements).length).toBe(clips);
    expect(board.productionSteps(q).some((s) => s.key === "shot:s1")).toBe(false);
  });

  it("moves shots, renumbers clip names and only uses connections between neighbours", () => {
    let p = fresh(v11);
    p = up(p, { shot: "c" });
    expect(p.assets[sb(p).shots.c.assetId!].name).toBe("3. End");
    expect(edit.connectionBetween(sb(p), "a", "b")?.transition?.preset).toBe("crossfade");
    expect(edit.connectionsLostByMove(sb(p), edit.orderAfterMove(sb(p), "a", 2)).map((c) => c.to)).toEqual(["b"]);
    p = edit.moveShot(p, "c", 0);
    expect(sb(p).order).toEqual(["c", "a", "b"]);
    expect(p.assets[sb(p).shots.c.assetId!].name).toBe("1. End");
    p = edit.moveShot(p, "b", 0);
    expect(edit.connectionBetween(sb(p), "a", "b")).toBeUndefined();
    expect(sb(p).connections).toHaveLength(1); // kept: moving back restores it
    expect(edit.moveShot(p, "b", 0)).toBe(p);
    p = edit.updateShot(p, "c", { title: "Finale" });
    expect(p.assets[sb(p).shots.c.assetId!].name).toBe("2. Finale");
  });

  it("a transition is sent only while its shots are neighbours", () => {
    let p = fresh(v11);
    p = up(p, { slot: "card" }, { blobKey: "h", mime: "text/html" } as MediaRef);
    p = up(p, { shot: "b" });
    p = up(p, { shot: "c" });
    expect(sendStory(p).result.transitions).toBe(1);
    const moved = edit.moveShot(edit.moveShot(p, "c", 1), "c", 1);
    expect(sb(moved).order).toEqual(["a", "c", "b"]);
    expect(sendStory(moved).result.transitions).toBe(0);
  });

  it("sets and clears connections between neighbours only", () => {
    let p = fresh(v11);
    expect(edit.setConnection(p, "a", "c", { kind: "match" })).toBe(p);
    p = edit.setConnection(p, "b", "c", { kind: "continuity", note: " Same light " });
    expect(edit.connectionBetween(sb(p), "b", "c")).toEqual({ from: "b", to: "c", kind: "continuity", note: "Same light" });
    p = edit.setConnection(p, "a", "b", { transition: null });
    expect(sb(p).connections.some((c) => c.from === "a")).toBe(false);
    p = edit.setConnection(p, "b", "c", { kind: "cut", note: "", transition: { preset: "dip", params: { durationSec: 1 } } });
    expect(edit.connectionBetween(sb(p), "b", "c")).toEqual({ from: "b", to: "c", kind: "cut", transition: { preset: "dip", params: { durationSec: 1 } } });
  });
});
