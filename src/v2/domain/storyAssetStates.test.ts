/** V2-SB-136: asset states ("<asset id>@<state id>"): parse, expand into board slots, edit, attach and send. */
import { describe, expect, it } from "vitest";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import * as refs from "./storyRefs";
import { assetStateId, expandAssetStates, splitStateId, stateBaseNote, storySummary, validateStoryboard, type StoryDoc } from "./storyJson";
import { sendStory } from "./storySend";
import { EXAMPLE_STORYBOARD } from "./storyPrompt";

const img: MediaRef = { blobKey: "i", mime: "image/png", width: 1280, height: 720 };
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 6_000_000 };
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });
const clone = (): StoryDoc & Record<string, unknown> => structuredClone(LANTERN_KEEPER) as StoryDoc & Record<string, unknown>;
const check = (raw: unknown) => validateStoryboard(raw);
const errs = (raw: unknown) => { const r = check(raw); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };
const warns = (raw: unknown) => { const r = check(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.warnings.map((w) => `${w.path}: ${w.message}`); };
const parse = (raw: unknown) => { const r = check(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const a = (d: StoryDoc, id: string) => d.assets.find((x) => x.id === id)!;

/** LANTERN_KEEPER with a soaked keeper (used by s2) and a lit lantern upload (an image layer on s3). */
function withStates() {
  const d = clone();
  a(d, "keeper").states = [{ id: "soaked", name: "Soaked", prompt: "References:\nImage 1 (The keeper): keep this identity.\n\nThe keeper soaked by rain", qa: ["Same face, wet coat"] }];
  a(d, "lantern").states = [{ id: "lit", name: "Lit", prompt: "", source: "upload", references: [{ asset: "lantern", role: "start-frame" }] }];
  d.shots[1].assets = [...d.shots[1].assets, "keeper@soaked"];
  d.shots[2].layers = [...(d.shots[2].layers ?? []), { id: "s3-lamp", type: "image", asset: "lantern@lit", startSec: 0, endSec: 1, box: { x: 0, y: 0, width: 0.5, height: 0.5 } }];
  return d;
}

describe("asset states: format (V2-SB-136)", () => {
  it("parses states, keeps the authored form and imports with no warnings", () => {
    const d = withStates();
    expect(warns(d)).toEqual([]);
    const doc = parse(d);
    expect(a(doc, "keeper").states).toEqual([{ id: "soaked", name: "Soaked", prompt: expect.stringContaining("soaked by rain"), qa: ["Same face, wet coat"] }]);
    expect(a(doc, "lantern").states?.[0]).toMatchObject({ id: "lit", source: "upload" });
    expect(storySummary(doc)).toContain("2 asset states");
    expect(assetStateId("keeper", "soaked")).toBe("keeper@soaked");
    expect(splitStateId("keeper@soaked")).toEqual({ asset: "keeper", state: "soaked" });
    expect(splitStateId("keeper")).toBeUndefined();
  });

  it("expands each state after its base: same type and aspect, the base attached first", () => {
    const ex = expandAssetStates(parse(withStates()).assets);
    const ids = ex.map((x) => x.id);
    expect(ids.indexOf("keeper@soaked")).toBe(ids.indexOf("keeper") + 1);
    const soaked = ex.find((x) => x.id === "keeper@soaked")!;
    expect(soaked).toMatchObject({ name: "The keeper · Soaked", type: "character", stateOf: "keeper", stateName: "Soaked", source: { type: "generate" } });
    expect(soaked.references[0]).toEqual({ asset: "keeper", role: "identity", note: stateBaseNote("The keeper") });
    // Listing the base yourself chooses its role; it is not added twice.
    const lit = ex.find((x) => x.id === "lantern@lit")!;
    expect(lit.references).toEqual([{ asset: "lantern", role: "start-frame" }]);
    expect(lit.source).toEqual({ type: "upload" });
  });

  it("rejects bad states and unknown state references, warns on unused states and unknown fields", () => {
    const bad = (f: (d: StoryDoc) => void) => { const d = clone(); f(d); return errs(d); };
    expect(bad((d) => { a(d, "keeper").states = {} as never; })).toEqual([expect.stringMatching(/^assets\[0\]\.states: "states" must be a list/)]);
    expect(bad((d) => { d.assets.push({ id: "aud", name: "A", type: "audio", aspect: "16:9", prompt: "x", references: [], source: { type: "generate" }, qa: [], states: [{ id: "x", prompt: "y" }] }); })
      .some((m) => /states: Only character, location, prop, style, image, frame assets can have states/.test(m))).toBe(true);
    expect(bad((d) => { a(d, "keeper").states = [{ prompt: "p" } as never]; }).some((m) => /states\[0\]\.id: Each state needs an "id"/.test(m))).toBe(true);
    expect(bad((d) => { a(d, "keeper").states = [{ id: "a.b", prompt: "p" }]; }).some((m) => /states\[0\]\.id/.test(m))).toBe(true);
    expect(bad((d) => { a(d, "keeper").states = [{ id: "w", prompt: "p" }, { id: "w", prompt: "q" }]; }).some((m) => /Duplicate state id "w"/.test(m))).toBe(true);
    expect(bad((d) => { a(d, "keeper").states = [{ id: "w", prompt: "p", source: "lastFrame" as never }]; }).some((m) => /source must be "generate" or "upload"/.test(m))).toBe(true);
    expect(bad((d) => { a(d, "keeper").states = [{ id: "w", prompt: "" }]; }).some((m) => /states\[0\]/.test(m))).toBe(true);
    expect(bad((d) => { d.shots[0].assets.push("nobody@wet"); }).some((m) => /"nobody@wet" names state "wet" of asset "nobody", but there is no such asset/.test(m))).toBe(true);
    expect(bad((d) => { a(d, "keeper").states = [{ id: "soaked", prompt: "p" }]; d.shots[0].assets.push("keeper@dry"); }).some((m) => /Asset "keeper" has no state "dry" \(states: soaked\)/.test(m))).toBe(true);
    expect(bad((d) => { a(d, "keeper").states = [{ id: "s1", prompt: "p" }, { id: "s2", prompt: "q", references: ["keeper@s1"] }]; d.shots[0].assets.push("keeper@s1", "keeper@s2"); })
      .some((m) => /assets\[0\]\.states\[1\]\.references\[0\]: State "keeper@s2" can't be made from another state/.test(m))).toBe(true);
    const w = clone(); a(w, "keeper").states = [{ id: "old", prompt: "Older", tint: 1 } as never];
    const ws = warns(w);
    expect(ws).toContain('assets[0].states[0]: State "keeper@old" isn\'t used by any shot.');
    expect(ws.some((m) => /^assets\[0\]\.states\[0\]\.tint: Unknown state field "tint"/.test(m))).toBe(true);
  });

  it("the guide example uses a state and imports cleanly", () => {
    expect(warns(EXAMPLE_STORYBOARD)).toEqual([]);
    const b = board.storyboardFromDoc(parse(EXAMPLE_STORYBOARD));
    expect(b.slots["hill@sunrise"]).toMatchObject({ name: "Hill road · Sunrise", stateOf: "hill", type: "location" });
    expect(refs.referencesBlock(b, b.shots.s3)).toContain("Image 1 (Hill road · Sunrise)");
    expect(refs.stateBlock(b, "sun-flare")).toMatch(/^Only character, location, prop, style, image, frame assets can have states/);
    expect(refs.stateBlock(b, "text-card")).toBeDefined();
  });
});

describe("asset states on the board (V2-SB-136)", () => {
  const start = () => board.setStoryboard(createProject("s"), board.storyboardFromDoc(parse(withStates())));

  it("makes state slots; a state's prompt attaches its base first, with the keep-it-the-same note", () => {
    const p = start(), b = p.storyboard!;
    expect(refs.statesOf(b, "keeper").map((x) => x.id)).toEqual(["keeper@soaked"]);
    const items = refs.slotAttachList(b, b.slots["keeper@soaked"]);
    expect(items[0]).toMatchObject({ no: 1, slotId: "keeper", role: "identity" });
    expect(refs.slotPromptWithReferences(b, b.slots["keeper@soaked"])).toMatch(/^References:\nImage 1 \(The keeper\)/);
    // The base is made first.
    const keys = board.productionSteps(p).map((s) => s.key);
    expect(keys.indexOf("slot:keeper")).toBeLessThan(keys.indexOf("slot:keeper@soaked"));
    expect(keys.indexOf("slot:keeper@soaked")).toBeLessThan(keys.indexOf("shot:s2"));
  });

  it("references resolve to the state's selected version, not the base's", () => {
    let p = start();
    p = up(p, { slot: "keeper" }, img);
    p = up(p, { slot: "keeper@soaked" }, img);
    p = up(p, { slot: "keeper@soaked" }, img);
    const b = p.storyboard!;
    const v = refs.attachVersions(p, b.shots.s2).find((x) => x.item.slotId === "keeper@soaked")!;
    expect(v.versionId).toBe(board.selectedOf(p, b.slots["keeper@soaked"]));
    expect(v.versionId).not.toBe(board.selectedOf(p, b.slots.keeper));
    const sv = refs.attachVersions(p, b.slots["keeper@soaked"]).find((x) => x.item.slotId === "keeper")!;
    expect(sv.versionId).toBe(board.selectedOf(p, b.slots.keeper));
  });

  it("send to timeline puts the state's selected version in its image layer", () => {
    let p = start();
    for (const s of ["s1", "s2", "s3"]) p = up(p, { shot: s }, vid);
    p = up(p, { slot: "lantern" }, img);
    p = up(p, { slot: "lantern@lit" }, img);
    const lit = p.storyboard!.slots["lantern@lit"], base = p.storyboard!.slots.lantern;
    const { project } = sendStory(p);
    const comp = project.compositions[project.rootCompositionId];
    const layer = comp.tracks.flatMap((t) => t.placements).find((x) => x.source.kind === "assetVersion" && x.source.assetId === lit.assetId);
    expect(layer).toBeDefined();
    expect(layer!.source).toMatchObject({ assetId: lit.assetId, versionId: board.selectedOf(p, lit) });
    expect(lit.assetId).not.toBe(base.assetId);
  });

  it("adds states (unique ids from the name), blocks deleting a base with states, follows the base's type and aspect", () => {
    let p = start();
    expect(refs.stateBlock(p.storyboard!, "keeper")).toBeUndefined();
    expect(refs.stateBlock(p.storyboard!, "keeper@soaked")).toMatch(/can't have states of its own/);
    p = refs.addState(p, "keeper", "After rain");
    p = refs.addState(p, "keeper", "After rain");
    p = refs.addState(p, "keeper", "夜");
    const b = p.storyboard!;
    expect(refs.statesOf(b, "keeper").map((x) => x.id)).toEqual(["keeper@soaked", "keeper@after-rain", "keeper@after-rain-2", "keeper@state"]);
    expect(b.slots["keeper@after-rain"]).toMatchObject({ name: "The keeper · After rain", type: "character", stateOf: "keeper", references: ["keeper"], refRoles: { keeper: { role: "identity", note: stateBaseNote("The keeper") } } });
    expect(refs.slotDeleteBlock(b, "keeper")).toMatch(/^It has states \(Soaked, After rain, After rain, 夜\)\. Delete them first\./);
    expect(refs.deleteSlot(p, "keeper")).toBe(p);
    p = refs.deleteSlot(p, "keeper@state");
    expect(p.storyboard!.slots["keeper@state"]).toBeUndefined();
    // A state keeps its base: its type and aspect are locked and the base stays first.
    p = refs.updateSlot(p, "keeper@after-rain", { type: "prop", aspect: "9:16", references: ["cliff"] });
    expect(p.storyboard!.slots["keeper@after-rain"]).toMatchObject({ type: "character", aspect: p.storyboard!.slots.keeper.aspect, references: ["keeper", "cliff"] });
    // The base's changes flow to its states; a base with states only becomes another image-like type.
    p = refs.updateSlot(p, "keeper", { name: "Keeper", aspect: "4:5", type: "prop" });
    expect(p.storyboard!.slots["keeper@after-rain"]).toMatchObject({ name: "Keeper · After rain", type: "prop", aspect: "4:5" });
    expect(p.storyboard!.slots["keeper@soaked"]).toMatchObject({ name: "Keeper · Soaked", type: "prop" });
    p = refs.updateSlot(p, "keeper", { type: "audio" });
    expect(p.storyboard!.slots.keeper.type).toBe("prop");
    // A state's "Made from" never offers its sibling states.
    expect(refs.referenceChoices(p.storyboard!, "keeper@soaked").map((x) => x.id)).not.toContain("keeper@after-rain");
    // A frame asset can have states too; a state can't.
    expect(refs.addState(p, "s1-end", "x").storyboard!.slots["s1-end@x"]).toBeDefined();
    expect(refs.addState(p, "keeper@soaked", "x")).toBe(p);
  });
});
