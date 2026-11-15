import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CLIP_TYPE_MODULE_PATHS, CLIP_TYPE_PROBLEMS, CLIP_TYPES, UNKNOWN_CLIP_TYPE, checkClipType, clipTypeOf, createClipTypeRegistry, defineClipType, variantOf } from ".";
import { loadClipTypeModules } from "./load";
import type { ClipTypeCore } from "./types";

const BUILT_INS = ["audio", "blank", "effect", "html", "image", "placeholder", "text", "unknown", "video"];
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

  it("variantOf / clipTypeOf resolve placeholder and blank variants and unknown ids", () => {
    expect(variantOf({ clipType: "image" })).toBe("image");
    expect(variantOf({ clipType: "image", placeholder: { label: "Shot 1" } })).toBe("placeholder");
    expect(variantOf({ clipType: "image", blank: { color: "#000000" } })).toBe("blank");
    expect(variantOf({ clipType: "video", blank: { color: "#000000" } })).toBe("video");
    // P67: both flags (never produced by the app) resolve to the placeholder, as the player always drew it.
    expect(variantOf({ clipType: "image", blank: { color: "#000000" }, placeholder: { label: "x" } })).toBe("placeholder");
    expect(clipTypeOf({ clipType: "text" }).id).toBe("text");
    expect(clipTypeOf({ clipType: "scene" as never }).id).toBe(UNKNOWN_CLIP_TYPE);
  });
});
