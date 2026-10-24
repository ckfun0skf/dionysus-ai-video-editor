import { describe, expect, it, afterEach } from "vitest";
import { applyPreset, defaultsOf, FONTS, fontStack, fontIdOfStack, getPreset, listPresets, parsePresetRef, PRESET_KINDS, registerPresets, registerRenderer, RENDERERS, resetPresets, resolvePresetRef, unregisterPreset, type PresetFrame } from ".";

const finite = (f: PresetFrame) => [f.alpha, f.dx, f.dy, f.scale, f.rot, f.chars].every(Number.isFinite);

describe("preset registry", () => {
  afterEach(() => resetPresets());
  it("has presets for every kind, each descriptor complete and JSON-serializable", () => {
    for (const k of PRESET_KINDS) {
      const list = listPresets(k);
      expect(list.length, k).toBeGreaterThan(0);
      for (const d of list) {
        expect(d.id && d.name && d.category && d.type).toBeTruthy();
        expect(Number.isInteger(d.version) && d.version >= 1, `${k}:${d.id} version`).toBe(true);
        expect(d.description.length, `${k}:${d.id} description`).toBeGreaterThan(10);
        expect(RENDERERS[d.type], `${k}:${d.id} renderer`).toBeTypeOf("function");
        expect(JSON.parse(JSON.stringify(d))).toEqual(d);
        for (const p of d.params) expect(defaultsOf(d)[p.key]).toBe(p.default);
      }
      expect(new Set(list.map((d) => d.id)).size, `${k} ids unique`).toBe(list.length);
    }
  });
  it("every preset renders at t=0, 0.5 and 1 without throwing", () => {
    for (const k of PRESET_KINDS) for (const d of listPresets(k)) for (const t of [0, 0.5, 1]) {
      const f = applyPreset(k, d.id, t);
      expect(finite(f), `${k}:${d.id}@${t}`).toBe(true);
      expect(f.alpha).toBeGreaterThanOrEqual(0);
    }
  });
  it("in/out presets are identity when fully shown (p=1)", () => {
    for (const k of ["textAnimIn", "textAnimOut"] as const) for (const d of listPresets(k)) {
      const f = applyPreset(k, d.id, 1);
      expect([f.alpha, f.scale, f.chars], `${k}:${d.id}`).toEqual([1, 1, 1]);
    }
  });
  it("loads descriptors from JSON, rejects bad ones, and can remove them", () => {
    const json = JSON.stringify([{ id: "big-fade", kind: "textAnimIn", category: "Custom", name: "Big fade", type: "fade", params: [], preview: {} }, { id: "x", kind: "nope", name: "X", type: "fade" }, { id: "y", kind: "effect", name: "Y", type: "missing" }]);
    expect(registerPresets(JSON.parse(json))).toEqual(["x", "y"]);
    expect(getPreset("textAnimIn", "big-fade")?.name).toBe("Big fade");
    expect(applyPreset("textAnimIn", "big-fade", 0).alpha).toBe(0);
    expect(unregisterPreset("textAnimIn", "big-fade")).toBe(true);
    expect(applyPreset("textAnimIn", "big-fade", 0).alpha).toBe(1); // unknown = identity
  });
  it("new render types can be registered in code", () => {
    registerRenderer("half", (f) => ({ ...f, alpha: f.alpha / 2 }));
    registerPresets([{ id: "half", kind: "effect", category: "Test", name: "Half", type: "half", params: [], preview: {} }]);
    expect(applyPreset("effect", "half", 0.3).alpha).toBe(0.5);
  });
  it("clamps progress and applies param overrides", () => {
    expect(applyPreset("textAnimIn", "fade", -3).alpha).toBe(0);
    expect(applyPreset("textAnimIn", "fade", 9).alpha).toBe(1);
    expect(applyPreset("textAnimLoop", "wiggle", 0.125, undefined, { degrees: 10 }).rot).toBeCloseTo(10);
  });
  it("textStyle presets carry JSON text data with font ids", () => {
    const ids = listPresets("textStyle").map((d) => d.id);
    expect(ids).toEqual(["plain", "caption", "outline", "neon", "pop", "typewriter", "glow", "echo", "soft-shadow", "cinematic"]);
    for (const d of listPresets("textStyle")) {
      expect(d.type).toBe("none");
      expect(d.data, d.id).toBeTypeOf("object");
      const font = d.data?.font;
      if (font !== undefined) expect(FONTS.some((f) => f.id === font), `${d.id} font ${String(font)}`).toBe(true);
    }
  });
  it("fonts: ids, stacks and fallbacks", () => {
    expect(FONTS.map((f) => f.id)).toEqual(["sans", "serif", "mono", "impact", "rounded", "hand", "script", "condensed"]);
    for (const f of FONTS) { expect(fontIdOfStack(fontStack(f.id))).toBe(f.id); expect(f.width).toBeGreaterThan(0.3); expect(f.description).toBeTruthy(); }
    expect(fontStack("nope")).toBe(FONTS[0].stack);
    expect(fontStack("Foo, serif")).toBe("Foo, serif");
  });
  it("parses and resolves id@version references", () => {
    expect(parsePresetRef("ken-burns")).toEqual({ id: "ken-burns" });
    expect(parsePresetRef(" ken-burns@2 ")).toEqual({ id: "ken-burns", version: 2 });
    expect(parsePresetRef("bad id")).toBeUndefined();
    expect(parsePresetRef("x@")).toBeUndefined();
    expect(resolvePresetRef("videoEffect", "ken-burns@1")).toMatchObject({ descriptor: { id: "ken-burns" }, versionMismatch: false });
    expect(resolvePresetRef("videoEffect", "ken-burns@3")).toMatchObject({ descriptor: { id: "ken-burns", version: 1 }, versionMismatch: true });
    expect(resolvePresetRef("videoEffect", "grain")).toMatchObject({ descriptor: undefined, ref: { id: "grain" }, versionMismatch: false });
    expect(resolvePresetRef("videoEffect", undefined).descriptor).toBeUndefined();
  });
  it("registerPresets validates id and version and fills defaults", () => {
    const base = { kind: "videoEffect", name: "X", type: "none", params: [] };
    expect(registerPresets([{ ...base, id: "has space" }, { ...base, id: "v0", version: 0 }, { ...base, id: "v1.5", version: 1.5 }])).toEqual(["has space", "v0", "v1.5"]);
    expect(registerPresets([{ ...base, id: "ok" }])).toEqual([]);
    expect(getPreset("videoEffect", "ok")).toMatchObject({ version: 1, description: "", category: "Other" });
  });
});
