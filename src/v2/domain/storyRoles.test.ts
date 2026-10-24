import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import * as refs from "./storyRefs";
import * as edit from "./storyEdit";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";
import { inferReferenceRole, validateStoryboard, type StoryDoc } from "./storyJson";

const base = (shot: Record<string, unknown>, extraAssets: unknown[] = []) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "mara", name: "Mara", type: "character", prompt: "Mara" },
    { id: "flat", name: "Mara's flat", type: "location", prompt: "Flat" },
    { id: "look", name: "Series look", type: "style", prompt: "Look" },
    { id: "a-end", name: "Last frame of a", type: "frame", source: { type: "lastFrame", shot: "a" } },
    ...extraAssets,
  ],
  shots: [
    { id: "a", title: "A", durationSec: 4, prompt: "Walk", assets: ["mara"], qa: [] },
    { id: "b", title: "B", durationSec: 5, prompt: "Mara opens the window.", assets: ["flat", "mara"], qa: [], ...shot },
  ],
});
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const fresh = (d: StoryDoc) => board.setStoryboard(createProject("s"), board.storyboardFromDoc(d));
const img = (k: string): MediaRef => ({ blobKey: k, mime: "image/png", width: 16, height: 9 });
let n = 0;
const up = (p: Project, slot: string) => board.addStoryVersion(p, { slot }, img(`k${++n}`), { versionId: `v${n}`, now: "2026-10-24T00:00:00Z" });

describe("shots[].references validation (V2-SB-120)", () => {
  it("keeps references in order, adds missing assets to the shot, and infers a missing role", () => {
    const r = validateStoryboard(base({ references: [{ asset: "a-end", role: "start-frame" }, { asset: "flat", role: "detail", note: "materials and colours only" }, { asset: "look" }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.doc.shots[1];
    expect(b.references).toEqual([{ asset: "a-end", role: "start-frame" }, { asset: "flat", role: "detail", note: "materials and colours only" }, { asset: "look", role: "look" }]);
    expect(b.assets).toEqual(["flat", "mara", "a-end", "look"]);
    expect(r.warnings.filter((w) => w.path.startsWith("shots"))).toEqual([]);
    // a-end is a last frame, so b now depends on a (continuity inferred for the default connection).
    expect(r.doc.connections[0].kind).toBe("continuity");
  });

  it("rejects unknown asset ids and two start frames", () => {
    const r = validateStoryboard(base({ references: [{ asset: "nope", role: "detail" }, { asset: "a-end", role: "start-frame" }, { asset: "flat", role: "start-frame" }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["shots[1].references[0].asset", "shots[1].references"]));
    expect(r.errors.find((e) => e.path === "shots[1].references")?.message).toContain('only one "start-frame"');
  });

  it("rejects two end frames and a non-list", () => {
    expect(validateStoryboard(base({ references: [{ asset: "flat", role: "end-frame" }, { asset: "look", role: "end-frame" }] })).ok).toBe(false);
    const r = validateStoryboard(base({ references: "flat" }));
    expect(!r.ok && r.errors[0].path).toBe("shots[1].references");
  });

  it("warns on an unknown role (used as detail) and on a repeated asset", () => {
    const r = validateStoryboard(base({ references: [{ asset: "flat", role: "background" }, { asset: "flat", role: "detail" }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.shots[1].references).toEqual([{ asset: "flat", role: "detail" }]);
    expect(r.warnings.map((w) => w.path).filter((x) => x.startsWith("shots"))).toEqual(["shots[1].references[0].role", "shots[1].references[1]"]);
    expect(r.warnings[0].message).toContain('using "detail"');
  });

  it("infers roles from asset types", () => {
    expect(inferReferenceRole("frame")).toBe("start-frame");
    expect(inferReferenceRole("image", true)).toBe("start-frame");
    expect(inferReferenceRole("character")).toBe("identity");
    expect(inferReferenceRole("style")).toBe("look");
    expect(inferReferenceRole("location")).toBe("detail");
    expect(inferReferenceRole("prop")).toBe("detail");
  });

  it("the example storyboard uses references and every clip prompt starts with a References block", () => {
    const d = parse(LANTERN_KEEPER);
    expect(d.shots[1].references?.[0]).toEqual({ asset: "s1-end", role: "start-frame" });
    for (const s of d.shots) expect(s.prompt.startsWith("References:\n")).toBe(true);
  });
});

describe("attach list and References block (V2-SB-120)", () => {
  it("falls back to the assets order with inferred roles", () => {
    const p = fresh(parse(base({ assets: ["a-end", "flat", "mara", "look"] })));
    const b = p.storyboard!;
    expect(refs.attachList(b, b.shots.b).map((x) => [x.no, x.slotId, x.role, x.inferred])).toEqual([
      [1, "a-end", "start-frame", true], [2, "flat", "detail", true], [3, "mara", "identity", true], [4, "look", "look", true],
    ]);
    const block = refs.referencesBlock(b, b.shots.b);
    expect(block.split("\n")).toEqual([
      "References:",
      "Image 1 (Last frame of a): START FRAME: the clip opens on exactly this image.",
      "Image 2 (Mara's flat): reference only, not a frame: materials, colours and objects only; do not reproduce its framing or wide view.",
      "Image 3 (Mara): reference only, not a frame: keep this identity (face, body, clothes).",
      "Image 4 (Series look): reference only, not a frame: overall look (palette, light, texture) only.",
    ]);
  });

  it("puts explicit references first, then the other assets, and says when no image is the start frame", () => {
    const p = fresh(parse(base({ camera: "Wide to close-up.", references: [{ asset: "look", role: "look" }, { asset: "flat", role: "detail", note: "do not show the wide view" }] })));
    const b = p.storyboard!;
    expect(refs.attachList(b, b.shots.b).map((x) => x.slotId)).toEqual(["look", "flat", "mara"]);
    const block = refs.referencesBlock(b, b.shots.b);
    expect(block).toContain("Image 2 (Mara's flat): reference only, not a frame: materials, colours and objects only; do not reproduce its framing or wide view. do not show the wide view.");
    expect(block).toContain("No image is the start frame");
    expect(block).toContain("Framing, first frame to last: Wide to close-up.");
  });

  it("uses only one start frame when two frames are inferred", () => {
    const d = parse(base({ assets: ["a-end", "still2"] }, [{ id: "still2", name: "Other frame", type: "frame", source: "upload" }]));
    const b = fresh(d).storyboard!;
    expect(refs.attachList(b, b.shots.b).map((x) => x.role)).toEqual(["start-frame", "detail"]);
  });

  it("prepends the block to the copied prompt unless the prompt already has one", () => {
    const b = fresh(parse(base({}))).storyboard!;
    expect(refs.promptWithReferences(b, b.shots.b)).toMatch(/^References:\nImage 1 \(Mara's flat\)[\s\S]*\n\nMara opens the window\.$/);
    const own = { ...b.shots.b, prompt: "References:\nImage 1 (Mara's flat): detail.\n\nMara opens the window." };
    expect(refs.promptWithReferences(b, own)).toBe(own.prompt);
    const none = { ...b.shots.b, slotIds: [] };
    expect(refs.promptWithReferences(b, none)).toBe("Mara opens the window.");
  });

  it("thumbnails use the pinned version", () => {
    let p = fresh(parse(base({})));
    p = up(up(p, "flat"), "flat");
    const [v1, v2] = p.assets[p.storyboard!.slots.flat.assetId!].versions.map((v) => v.id);
    expect(refs.attachVersions(p, p.storyboard!.shots.b)[0].versionId).toBe(v2);
    p = refs.setRefOverride(p, "b", "flat", v1);
    expect(refs.attachVersions(p, p.storyboard!.shots.b)[0].versionId).toBe(v1);
  });

  it("editing a shot's assets keeps the roles that stay; deleting an asset drops its reference", () => {
    let p = fresh(parse(base({ references: [{ asset: "flat", role: "detail", note: "n" }, { asset: "mara", role: "identity" }] })));
    p = edit.updateShot(p, "b", { slotIds: ["mara", "look"] });
    expect(p.storyboard!.shots.b.references).toEqual([{ slotId: "mara", role: "identity" }]);
    expect(refs.attachList(p.storyboard!, p.storyboard!.shots.b).map((x) => [x.slotId, x.role])).toEqual([["mara", "identity"], ["look", "look"]]);
    p = refs.deleteSlot(p, "mara");
    expect(p.storyboard!.shots.b.references).toBeUndefined();
  });
});
