import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Placement, type Project } from "./model";
import * as board from "./storyboard";
import * as edit from "./storyEdit";
import * as refs from "./storyRefs";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { sendStory } from "./storySend";

const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const img: MediaRef = { blobKey: "b", mime: "image/png", width: 16, height: 9 };
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 600_000 };
let n = 0;
const up = (p: Project, t: board.Target, m?: MediaRef) => board.addStoryVersion(p, t, m ?? ("slot" in t ? img : vid), { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });
const fresh = (d: StoryDoc) => board.setStoryboard(createProject("s"), board.storyboardFromDoc(d));
const sb = (p: Project) => p.storyboard!;
const all = (p: Project): Placement[] => Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements));

const example = parse(LANTERN_KEEPER);
/** Two shots sharing a photo: shot a uses it as a reference, shot b also as an image layer. */
const layered = parse({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "photo", name: "Photo", type: "image", prompt: "A photo" },
    { id: "card", name: "Card", type: "html", prompt: "<h1>Hi</h1>" },
  ],
  shots: [
    { id: "a", title: "One", description: "", durationSec: 4, prompt: "Walk", assets: ["photo"], qa: [] },
    { id: "b", title: "Two", description: "", durationSec: 4, prompt: "Look", assets: ["photo"], qa: [],
      layers: [{ id: "l1", type: "image", asset: "photo", box: { x: 0.6, y: 0.6, width: 0.3, height: 0.3 }, startSec: 0, endSec: 4 }] },
    { id: "c", title: "Card", description: "", durationSec: 3, prompt: "", assets: [], qa: [], render: "html", clip: "card" },
  ],
  connections: [],
});

describe("storyRefs: per-shot reference overrides (V2-CUT-05)", () => {
  it("lists a shot's references without its clip slot", () => {
    const p = fresh(layered);
    expect(refs.shotRefIds(sb(p), sb(p).shots.b)).toEqual(["photo"]);
    expect(refs.shotRefIds(sb(p), sb(p).shots.c)).toEqual([]);
  });

  it("pins a version: the shot's upload records it and other shots follow the selection", () => {
    let p = up(up(fresh(example), { slot: "keeper" }), { slot: "keeper" });
    const [v1, v2] = board.versionsOf(p, sb(p).slots.keeper).map((v) => v.id);
    p = refs.setRefOverride(p, "s1", "keeper", v1);
    expect(sb(p).shots.s1.refOverrides).toEqual({ keeper: v1 });
    expect(board.refVersionOf(p, sb(p).shots.s1, "keeper")).toBe(v1);
    expect(board.refVersionOf(p, sb(p).shots.s2, "keeper")).toBe(v2);
    p = up(up(p, { shot: "s1" }), { shot: "s2" });
    const info = (s: string) => sb(p).versions[board.selectedOf(p, sb(p).shots[s])!].inputs.find((i) => i.slotId === "keeper")?.versionId;
    expect(info("s1")).toBe(v1);
    expect(info("s2")).toBe(v2);
    // Neither is stale: s1 matches its pin, s2 the selection.
    const st = board.storyStatus(p);
    expect(st.shots.s1.reasons.join()).not.toMatch(/keeper/);
    expect(st.shots.s2.reasons.join()).not.toMatch(/keeper/);
    // Changing the pin makes s1 stale with a pin-specific reason; the selection doesn't affect it.
    p = refs.setRefOverride(p, "s1", "keeper", v2);
    expect(board.storyStatus(p).shots.s1.reasons.join()).toMatch(/different version of “The keeper” than the one pinned/);
    p = refs.setRefOverride(p, "s1", "keeper", v1);
    p = up(p, { slot: "keeper" });
    expect(board.storyStatus(p).shots.s1.stale).toBe(false);
    expect(board.storyStatus(p).shots.s2.reasons.join()).toMatch(/older version of “The keeper”/);
  });

  it("rejects pins for unknown versions, non-references and clip slots; unpinning clears the field", () => {
    let p = up(fresh(layered), { slot: "card" });
    const cardV = board.selectedOf(p, sb(p).slots.card)!;
    expect(refs.setRefOverride(p, "c", "card", cardV)).toBe(p);
    expect(refs.setRefOverride(p, "a", "photo", "nope")).toBe(p);
    p = up(p, { slot: "photo" });
    const v = board.selectedOf(p, sb(p).slots.photo)!;
    p = refs.setRefOverride(p, "a", "photo", v);
    expect(refs.setRefOverride(p, "a", "photo", v)).toBe(p);
    p = refs.setRefOverride(p, "a", "photo", null);
    expect(sb(p).shots.a.refOverrides).toBeUndefined();
  });

  it("keeps a pinned linked image layer on its version when the asset's selection changes", () => {
    let p = up(up(fresh(layered), { slot: "photo" }), { slot: "photo" });
    const [v1, v2] = board.versionsOf(p, sb(p).slots.photo).map((v) => v.id);
    p = up(up(p, { shot: "a" }), { shot: "b" });
    p = refs.setRefOverride(p, "b", "photo", v1);
    p = sendStory(p).project;
    const photoId = sb(p).slots.photo.assetId!;
    const layer = () => all(p).find((pl) => pl.source.assetId === photoId && pl.storyLink)!;
    expect(layer().source.versionId).toBe(v1);
    // Picking v2 then v1 then v2 on the asset itself leaves the pinned layer alone.
    p = board.selectStoryVersion(p, photoId, v1);
    p = board.selectStoryVersion(p, photoId, v2);
    expect(layer().source.versionId).toBe(v1);
    // Unpinning points the layer at the selected version; re-pinning moves it back.
    p = refs.setRefOverride(p, "b", "photo", null);
    expect(layer().source.versionId).toBe(v2);
    p = refs.setRefOverride(p, "b", "photo", v1);
    expect(layer().source.versionId).toBe(v1);
  });

  it("edits a shot's references and creates assets in the same step", () => {
    let p = up(fresh(example), { slot: "keeper" });
    p = refs.setRefOverride(p, "s1", "keeper", board.selectedOf(p, sb(p).slots.keeper)!);
    const id = refs.nextSlotId(sb(p), "Keeper's coat");
    expect(id).toBe("keeper-s-coat");
    p = edit.updateShot(p, "s1", { slotIds: ["cliff", id], newSlots: [{ id, patch: { name: "Keeper's coat", type: "prop", prompt: "A yellow coat" } }] });
    expect(sb(p).shots.s1.slotIds).toEqual(["cliff", id]);
    expect(sb(p).slots[id]).toMatchObject({ name: "Keeper's coat", type: "prop", aspect: "16:9", source: { type: "generate" } });
    // The pin went with the removed reference.
    expect(sb(p).shots.s1.refOverrides).toBeUndefined();
  });

  it("keeps an html shot's clip slot when its references are edited", () => {
    let p = fresh(layered);
    p = edit.updateShot(p, "c", { slotIds: ["photo"] });
    expect(sb(p).shots.c.slotIds).toEqual(["photo", "card"]);
  });

  it("edits a slot: no cycles, type kept once versions exist, rename follows the library asset", () => {
    let p = fresh(example);
    p = refs.updateSlot(p, "cliff", { references: ["keeper"] });
    expect(sb(p).slots.cliff.references).toEqual(["keeper"]);
    expect(refs.referenceChoices(sb(p), "keeper").map((s) => s.id)).not.toContain("cliff");
    expect(refs.updateSlot(p, "keeper", { references: ["cliff"] })).toBe(p);
    p = up(p, { slot: "lantern" });
    expect(refs.updateSlot(p, "lantern", { type: "video" })).toBe(p);
    p = refs.updateSlot(p, "lantern", { type: "image", name: "Old lantern", source: "generate" });
    expect(sb(p).slots.lantern).toMatchObject({ type: "image", name: "Old lantern", source: { type: "generate" } });
    expect(p.assets[sb(p).slots.lantern.assetId!].name).toBe("Old lantern");
    // A last-frame slot keeps its source.
    expect(refs.updateSlot(p, "s1-end", { source: "upload" })).toBe(p);
  });

  it("deletes a slot from every reference list, but not a clip or layer asset", () => {
    let p = up(fresh(example), { slot: "keeper" });
    p = refs.setRefOverride(p, "s2", "keeper", board.selectedOf(p, sb(p).slots.keeper)!);
    p = refs.updateSlot(p, "cliff", { references: ["keeper"] });
    const assetId = sb(p).slots.keeper.assetId!;
    p = refs.deleteSlot(p, "keeper");
    expect(sb(p).slots.keeper).toBeUndefined();
    expect(sb(p).shots.s1.slotIds).not.toContain("keeper");
    expect(sb(p).shots.s2.refOverrides).toBeUndefined();
    expect(sb(p).slots.cliff.references).toEqual([]);
    expect(p.assets[assetId]).toBeDefined();
    const q = fresh(layered);
    expect(refs.slotDeleteBlock(sb(q), "card")).toMatch(/clip of shot 3/);
    expect(refs.slotDeleteBlock(sb(q), "photo")).toMatch(/layer in shot 2/);
    expect(refs.deleteSlot(q, "photo")).toBe(q);
  });

  it("adds a slot only with a name and a free id", () => {
    const p = fresh(example);
    expect(refs.addSlot(p, "x", { name: " " })).toBe(p);
    expect(refs.addSlot(p, "keeper", { name: "Dup" })).toBe(p);
    expect(sb(refs.addSlot(p, "x", { name: "X", type: "audio", aspect: "bad" })).slots.x).toMatchObject({ type: "audio", aspect: "16:9" });
  });
});
