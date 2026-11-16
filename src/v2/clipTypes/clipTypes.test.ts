import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CLIP_TYPE_MODULE_PATHS, CLIP_TYPE_PROBLEMS, CLIP_TYPES, UNKNOWN_CLIP_TYPE, checkClipType, clipTypeOf, createClipTypeRegistry, defineClipType, variantOf } from ".";
import { loadClipTypeModules } from "./load";
import type { ClipTypeCore } from "./types";
import { DEFAULT_CLIP_STORY, kindForSlotType, storyOf } from "./story";
import { STORY_ASSET_TYPES } from "../domain/storyJson";

const BUILT_INS = ["audio", "blank", "effect", "html", "image", "scene", "text", "unknown", "video"];
const ok = (over: Partial<ClipTypeCore> = {}): ClipTypeCore => defineClipType({
  id: "demo", description: "A demo.", trackKind: "video",
  caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: false, thumb: false, asset: "none" }, ...over,
});

describe("clip type registry (P65)", () => {
  it("discovers every built-in folder with no problems", () => {
    expect(CLIP_TYPE_PROBLEMS).toEqual([]);
    expect(CLIP_TYPES.list().map((c) => c.id).sort()).toEqual(BUILT_INS);
    const folders = readdirSync(__dirname).filter((n) => statSync(join(__dirname, n)).isDirectory()).sort();
    expect(folders).toEqual(BUILT_INS);
    expect(CLIP_TYPE_MODULE_PATHS.sort()).toEqual(BUILT_INS.map((id) => `./${id}/core.ts`));
  });

  it("defineClipType defaults version to 1", () => {
    expect(ok().version).toBe(1);
    expect(defineClipType({ ...ok(), version: 3 }).version).toBe(3);
  });

  it("checkClipType reports invalid fields", () => {
    expect(checkClipType(ok())).toEqual([]);
    expect(checkClipType(undefined)).toHaveLength(1);
    expect(checkClipType(ok({ id: "Bad id" })).join()).toMatch(/id must match/);
    expect(checkClipType(ok({ version: 0 })).join()).toMatch(/version/);
    expect(checkClipType(ok({ description: " " })).join()).toMatch(/description/);
    expect(checkClipType(ok({ trackKind: "scene" as never })).join()).toMatch(/trackKind/);
    expect(checkClipType(ok({ caps: { ...ok().caps, sound: "yes" as never } })).join()).toMatch(/caps\.sound/);
    expect(checkClipType(ok({ caps: { ...ok().caps, asset: "file" as never } })).join()).toMatch(/caps\.asset/);
    expect(checkClipType({ ...ok(), caps: undefined }).join()).toMatch(/caps is required/);
  });

  it("register rejects invalid and duplicate types", () => {
    const r = createClipTypeRegistry();
    r.register(ok());
    expect(r.core("demo")?.id).toBe("demo");
    expect(() => r.register(ok())).toThrow(/already registered/);
    expect(() => r.register(ok({ id: "x", trackKind: "nope" as never }))).toThrow(/trackKind/);
    expect(r.list()).toHaveLength(1);
  });

  it("the loader reports bad modules and keeps the good ones", () => {
    const { registry, problems } = loadClipTypeModules({
      "./demo/core.ts": { default: ok() },
      "./other/core.ts": { default: ok({ id: "wrong" }) },
      "./empty/core.ts": {},
      "./bad/core.ts": { default: ok({ id: "bad", version: -1 }) },
      "./ghost/core.ts": { default: ok({ id: "ghost", variant: { of: "image", field: "blank" } }) },
    });
    expect(registry.list().map((c) => c.id).sort()).toEqual(["demo", "ghost"]);
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toMatch(/"wrong" must equal its folder name "other"/);
    expect(problems.join("\n")).toMatch(/empty\/core\.ts: no default export/);
    expect(problems.join("\n")).toMatch(/bad\/core\.ts: .*version/);
    expect(problems.join("\n")).toMatch(/ghost: variant of unregistered type "image"/);
  });

  it("variantOf resolves the blank variant; clipTypeOf checks the placeholder state first; unknown ids", () => {
    expect(variantOf({ clipType: "image" })).toBe("image");
    // P73 (decision 9): a placeholder is a clip state, not a variant: variantOf no longer returns it.
    expect(variantOf({ clipType: "image", placeholder: { label: "Shot 1" } })).toBe("image");
    expect(clipTypeOf({ clipType: "image", placeholder: { label: "Shot 1" } }).id).toBe("placeholder");
    expect(variantOf({ clipType: "image", blank: { color: "#000000" } })).toBe("blank");
    expect(variantOf({ clipType: "video", blank: { color: "#000000" } })).toBe("video");
    // P67: both flags (never produced by the app) behave as the placeholder, as the player always drew it (P73: clipTypeOf checks the state first).
    expect(variantOf({ clipType: "image", blank: { color: "#000000" }, placeholder: { label: "x" } })).toBe("blank");
    expect(clipTypeOf({ clipType: "image", blank: { color: "#000000" }, placeholder: { label: "x" } }).id).toBe("placeholder");
    expect(clipTypeOf({ clipType: "text" }).id).toBe("text");
    expect(clipTypeOf({ clipType: "hologram" as never }).id).toBe(UNKNOWN_CLIP_TYPE);
    // P74: "scene" is registered now (it was the stand-in unknown id before).
    expect(clipTypeOf({ clipType: "scene" }).id).toBe("scene");
  });
});

describe("storyboard mapping and file import in the cores (P71)", () => {
  const cores = () => CLIP_TYPES.list();
  it("accepts lists do not overlap, so the old MIME-then-extension order cannot matter", () => {
    const seen = new Map<string, string>();
    for (const c of cores()) if (c.accepts) {
      for (const k of [...(c.accepts.mimePrefix ? [`prefix:${c.accepts.mimePrefix}`] : []), ...(c.accepts.mime ?? []).map((m) => `mime:${m}`), ...c.accepts.ext.map((e) => `ext:${e}`), ...Object.keys(c.accepts.mimeByExt).map((e) => `guess:${e}`)]) {
        expect(seen.get(k), `${k} in ${c.id} and ${seen.get(k)}`).toBeUndefined();
        seen.set(k, c.id);
      }
      for (const e of c.accepts.ext) expect(c.accepts.mimeByExt[e], `${c.id} ${e}`).toBeTruthy();
    }
    for (const a of cores().filter((c) => c.accepts?.mimePrefix)) for (const b of cores().filter((c) => c !== a && c.accepts?.mimePrefix)) expect(a.accepts!.mimePrefix!.startsWith(b.accepts!.mimePrefix!)).toBe(false);
  });
  it("every storyboard asset type maps to exactly one kind, with one fallback", () => {
    expect(cores().filter((c) => c.story?.slotFallback).map((c) => c.id)).toEqual(["image"]);
    for (const t of STORY_ASSET_TYPES) expect(cores().filter((c) => c.story?.assetTypes.includes(t)).length, t).toBe(1);
    expect(kindForSlotType("not-a-type")).toBe("image");
  });
  it("types without a story mapping use the default; checkClipType validates the new fields", () => {
    for (const id of ["text", "effect", "placeholder", "blank", "unknown", "scene3d"]) expect(storyOf(id), id).toBe(DEFAULT_CLIP_STORY);
    const base = { id: "x", version: 1, description: "x", trackKind: "video", caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: false, thumb: false, asset: "none" } };
    expect(checkClipType({ ...base, accepts: { ext: [".MP4"] } }).join()).toMatch(/accepts.ext.*accepts.mimeByExt/);
    expect(checkClipType({ ...base, story: { assetTypes: [], sendLength: "x", layerType: "audio", layer: 1 } }).join()).toMatch(/sendLength.*layerType.*story.layer/);
    expect(checkClipType({ ...base, story: { ...DEFAULT_CLIP_STORY } })).toEqual([]);
  });
});
