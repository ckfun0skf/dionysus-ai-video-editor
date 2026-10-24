/** V2-SB-123: asset-level reference roles (docs/v2/STORYBOARD_FORMAT.md §2.3.1). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, type Project } from "./model";
import * as board from "./storyboard";
import * as refs from "./storyRefs";
import { parseStoryboard, validateStoryboard, type StoryDoc } from "./storyJson";

const base = (assets: unknown[]) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "hero", name: "Hero", type: "character", prompt: "A hero" },
    { id: "room", name: "Room", type: "location", prompt: "A room" },
    { id: "look", name: "Look", type: "style", prompt: "A look" },
    { id: "plate", name: "Plate", type: "frame", prompt: "A plate" },
    ...assets,
  ],
  shots: [{ id: "s1", title: "S", description: "", durationSec: 4, prompt: "Go", assets: ["hero", "room", "look", "plate", "key"], qa: [] }],
  connections: [],
});
const key = (references: unknown) => ({ id: "key", name: "Key", type: "image", prompt: "A key image", references });
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const fresh = (d: StoryDoc): Project => board.setStoryboard(createProject("s"), board.storyboardFromDoc(d));

describe("assets[].references objects (V2-SB-123)", () => {
  it("accepts ids and { asset, role, note } mixed, keeps them as written and stores roles on the slot", () => {
    const list = ["look", { asset: "room", role: "detail", note: "the lamp only" }, { asset: "hero" }];
    const r = validateStoryboard(base([key(list)]));
    expect(r.ok && r.warnings).toEqual([]);
    if (!r.ok) return;
    expect(r.doc.assets.find((a) => a.id === "key")!.references).toEqual(list);
    const slot = board.storyboardFromDoc(r.doc).slots.key;
    expect(slot.references).toEqual(["look", "room", "hero"]);
    expect(slot.refRoles).toEqual({ room: { role: "detail", note: "the lamp only" } });
    expect(board.storyboardFromDoc(r.doc).slots.hero.refRoles).toBeUndefined();
  });

  it("warns on end-frame, unknown roles and repeats; rejects two base images, unknown ids and loops", () => {
    const r = validateStoryboard(base([key([{ asset: "room", role: "end-frame" }, { asset: "look", role: "glow" }, "look"])]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.path)).toEqual(["assets[4].references[0].role", "assets[4].references[1].role", "assets[4].references[2]"]);
      expect(r.doc.assets[4].references).toEqual([{ asset: "room", role: "detail" }, { asset: "look", role: "detail" }]);
    }
    const two = validateStoryboard(base([key([{ asset: "plate", role: "start-frame" }, { asset: "room", role: "start-frame" }])]));
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors.map((e) => e.path)).toContain("assets[4].references");
    const unknown = validateStoryboard(base([key([{ asset: "nope", role: "look" }])]));
    expect(!unknown.ok && unknown.errors.map((e) => e.message).join()).toContain('Unknown asset "nope"');
    const loop = validateStoryboard(base([key([{ asset: "key2" }]), { id: "key2", name: "K2", type: "image", prompt: "x", references: [{ asset: "key", role: "look" }] }]));
    expect(!loop.ok && loop.errors.map((e) => e.message).join()).toMatch(/loop/);
    const bad = validateStoryboard(base([key([{ role: "look" }, 3])]));
    expect(!bad.ok && bad.errors.map((e) => e.path)).toEqual(["assets[4].references[0]", "assets[4].references[1]"]);
  });

  it("builds the attach list and References block: stated roles first-class, others inferred, one base image", () => {
    const b = board.storyboardFromDoc(parse(base([key(["plate", { asset: "room", role: "look", note: "warm light." }, "hero", "look"])])));
    expect(refs.slotAttachList(b, b.slots.key).map((x) => [x.no, x.slotId, x.role, x.inferred])).toEqual([
      [1, "plate", "start-frame", true], [2, "room", "look", false], [3, "hero", "identity", true], [4, "look", "look", true],
    ]);
    expect(refs.slotReferencesBlock(b, b.slots.key)).toBe([
      "References:",
      "Image 1 (Plate): BASE IMAGE: start from exactly this image and change only what the prompt asks.",
      "Image 2 (Room): reference only: overall look (palette, light, texture) only. warm light.",
      "Image 3 (Hero): reference only: keep this identity (face, body, clothes).",
      "Image 4 (Look): reference only: overall look (palette, light, texture) only.",
    ].join("\n"));
    expect(refs.slotPromptWithReferences(b, b.slots.key)).toBe(`${refs.slotReferencesBlock(b, b.slots.key)}\n\nA key image`);
    expect(refs.slotReferencesBlock(b, b.slots.hero)).toBe("");
    expect(refs.slotPromptWithReferences(b, b.slots.hero)).toBe("A hero");
    // A second inferred base image is details only; a prompt that has its own block is copied as written.
    const two = board.storyboardFromDoc(parse(base([{ ...key(["plate", "plate2"]), prompt: "References:\nImage 1 …\n\nA key" }, { id: "plate2", name: "P2", type: "frame", prompt: "x" }])));
    expect(refs.slotAttachList(two, two.slots.key).map((x) => x.role)).toEqual(["start-frame", "detail"]);
    expect(refs.slotPromptWithReferences(two, two.slots.key)).toBe("References:\nImage 1 …\n\nA key");
  });

  it("editing keeps roles only for remaining references; deleting a referenced asset drops its role", () => {
    let p = fresh(parse(base([key([{ asset: "room", role: "detail", note: "lamp" }, { asset: "hero", role: "identity" }])])));
    p = refs.updateSlot(p, "key", { references: ["hero", "look"] });
    expect(p.storyboard!.slots.key.refRoles).toEqual({ hero: { role: "identity" } });
    p = refs.updateSlot(p, "key", { refRoles: { hero: { role: "start-frame" }, look: { role: "start-frame" } } });
    expect(p.storyboard!.slots.key.refRoles).toEqual({ hero: { role: "start-frame" }, look: { role: "detail" } });
    p = refs.deleteSlot(p, "hero");
    expect(p.storyboard!.slots.key.references).toEqual(["look"]);
    expect(p.storyboard!.slots.key.refRoles).toEqual({ look: { role: "detail" } });
    p = refs.updateSlot(p, "key", { refRoles: {} });
    expect(p.storyboard!.slots.key.refRoles).toBeUndefined();
  });

  it("the ep01 fixture uses an object reference with a matching References block", () => {
    const r = parseStoryboard(readFileSync(resolve(__dirname, "__fixtures__/ep01_opening.storyboard.json"), "utf8"));
    expect(r.ok && r.warnings).toEqual([]);
    if (!r.ok) return;
    const b = board.storyboardFromDoc(r.doc);
    const card = b.slots["card-still"];
    expect(card.refRoles?.flat?.role).toBe("detail");
    expect(refs.slotAttachList(b, card).map((x) => [x.slotId, x.role])).toEqual([["flat", "detail"], ["style", "look"]]);
    expect(card.prompt.startsWith("References:\nImage 1 (Mara's flat (N1 room reference)): reference only: materials")).toBe(true);
    expect(refs.slotPromptWithReferences(b, card)).toBe(card.prompt);
  });
});
