import { describe, expect, it, afterEach } from "vitest";
import { applyPreset, defaultsOf, getPreset, listPresets, PRESET_KINDS, registerPresets, registerRenderer, RENDERERS, resetPresets, unregisterPreset, type PresetFrame } from ".";

const finite = (f: PresetFrame) => [f.alpha, f.dx, f.dy, f.scale, f.rot, f.chars].every(Number.isFinite);

describe("preset registry", () => {
  afterEach(() => resetPresets());
  it("has presets for every kind, each descriptor complete and JSON-serializable", () => {
    for (const k of PRESET_KINDS) {
      const list = listPresets(k);
      expect(list.length, k).toBeGreaterThan(0);
      for (const d of list) {
        expect(d.id && d.name && d.category && d.type).toBeTruthy();
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
});
