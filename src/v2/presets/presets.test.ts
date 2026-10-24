import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESET_DESCRIPTORS, PRESET_FONTS, PRESET_MODULE_PATHS, PRESET_PROBLEMS } from ".";
import { loadPresetModules, pathKey } from "./load";
import { defineTextEffect, defineVideoEffect, type PresetModule } from "./define";
import { applyPreset, getPreset, identityFrame, listPresets, registerPresets, registerRenderer, unregisterPreset, RENDERERS, type ParamSpec, type PresetDescriptor, type PresetFrame, type PresetKind } from "../registry";
import { applyEffectFrame } from "../render/effects";
import { drawWithLook } from "../render/transitionDraw";
import { clearPaintScratch } from "../render/paintScratch";
import { mockCtx, stubOffscreen } from "./__testutils__/mockCanvas";

afterEach(() => { vi.unstubAllGlobals(); clearPaintScratch(); });

const KINDS: PresetKind[] = ["textAnimIn", "textAnimOut", "textAnimLoop", "effect", "videoEffect", "transition", "sticker", "textStyle"];
const finiteFrame = (f: PresetFrame) => {
  for (const k of ["alpha", "scale", "dx", "dy", "rot", "chars", "blur", "gray", "vignette"] as const) {
    const v = f[k]; if (v !== undefined) expect(Number.isFinite(v), k).toBe(true);
  }
};
const paramSets = (d: PresetDescriptor) => {
  const at = (pick: (p: ParamSpec) => number | string) => Object.fromEntries(d.params.map((p) => [p.key, pick(p)]));
  return [undefined, at((p) => (p.type === "number" ? p.min ?? p.default : p.default)), at((p) => (p.type === "number" ? p.max ?? p.default : p.default))];
};

describe("preset modules (V2-FX-MOD)", () => {
  it("every module under src/v2/presets loads without problems", () => {
    expect(PRESET_PROBLEMS).toEqual([]);
    const loaded = new Set([...PRESET_DESCRIPTORS.map((d) => `${d.kind}/${d.id}`), ...PRESET_FONTS.map((f) => `font/${f.id}`)]);
    for (const path of PRESET_MODULE_PATHS) {
      const k = pathKey(path);
      expect(k, path).toBeDefined();
      expect(loaded.has(`${k!.kind}/${k!.id}`), path).toBe(true);
    }
    expect(PRESET_MODULE_PATHS.length).toBe(loaded.size);
  });
  it("every discovered preset is in the registry, listed for its kind", () => {
    for (const d of PRESET_DESCRIPTORS) {
      expect(getPreset(d.kind, d.id)).toBeDefined();
      expect(listPresets(d.kind).some((x) => x.id === d.id), `${d.kind}/${d.id}`).toBe(true);
      expect(RENDERERS[d.type], d.type).toBeTypeOf("function");
    }
  });
  it("descriptors are complete: description, and every param described with its unit or range", () => {
    const unit = /(second|pixel|px|fraction|percent|%|degree|°|count|times|0 *\(|1 *\(|0\.\.1|0–1|0-1|\bto\b|#rrggbb|colour|color|multiplier|×|ratio|text|svg|frame)/i;
    for (const d of PRESET_DESCRIPTORS) {
      expect(d.description.length, `${d.kind}/${d.id}`).toBeGreaterThanOrEqual(10);
      expect(d.name.trim(), `${d.kind}/${d.id}`).not.toBe("");
      for (const p of d.params) {
        expect(p.description, `${d.kind}/${d.id}.${p.key}`).toBeTruthy();
        expect(p.description!, `${d.kind}/${d.id}.${p.key}: say the unit or range`).toMatch(unit);
      }
    }
  });
});

describe("smoke render: every preset on a mock canvas", () => {
  it("applyPreset gives finite frames at every progress with default, min and max params", () => {
    for (const kind of KINDS) for (const d of listPresets(kind)) for (const params of paramSets(d)) for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const f = applyPreset(kind, d.id, p, identityFrame(), params);
      finiteFrame(f);
      if (kind === "sticker") expect(f.svg, d.id).toMatch(/<svg/);
    }
  });
  it("video effects composite (built-in look and draw hooks) without errors", () => {
    stubOffscreen();
    for (const d of listPresets("videoEffect")) for (const params of paramSets(d)) for (const p of [0, 0.5, 1]) {
      const { ctx, calls } = mockCtx(160, 90);
      applyEffectFrame(ctx, 160, 90, applyPreset("videoEffect", d.id, p, identityFrame(), params));
      expect(calls.filter((c) => c === "save").length, d.id).toBe(calls.filter((c) => c === "restore").length);
    }
  });
  it("transitions draw both sides (look and paint hooks) without errors", () => {
    stubOffscreen();
    for (const d of listPresets("transition")) for (const params of paramSets(d)) for (const p of [0, 0.3, 0.7, 1]) {
      const f = applyPreset("transition", d.id, p, identityFrame(), params);
      for (const side of [f.tOut, f.tIn]) {
        const { ctx, calls } = mockCtx(160, 90);
        let drawn = 0;
        drawWithLook(ctx, 160, 90, side, () => { drawn += 1; });
        expect(drawn, d.id).toBe(1);
        expect(calls.filter((c) => c === "save").length, d.id).toBe(calls.filter((c) => c === "restore").length);
      }
    }
  });
});

describe("loader validation", () => {
  const good = (id = "demo"): PresetModule => defineTextEffect({ id, name: "Demo", category: "Test", description: "A demo text effect for tests.", params: [{ key: "size", label: "Size", type: "number", min: 0, max: 1, step: 0.1, default: 0.5, description: "Size as a fraction of the font size." }], frame: (f) => f });
  const load = (m: Record<string, PresetModule | undefined>) => loadPresetModules(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { default: v }])));
  it("accepts a valid module and derives its descriptor", () => {
    const r = load({ "./effect/demo.ts": good() });
    expect(r.problems).toEqual([]);
    const d = r.descriptors.find((x) => x.id === "demo")!;
    expect(d).toMatchObject({ kind: "effect", type: "effect/demo", version: 1 });
    expect(r.renderers["effect/demo"]).toBeTypeOf("function");
  });
  it("rejects a file whose path does not match kind/id", () => {
    expect(load({ "./effect/other.ts": good() }).problems.join()).toMatch(/must live at/);
    expect(load({ "./videoEffect/demo.ts": good() }).problems.join()).toMatch(/must live at|kind/);
  });
  it("rejects duplicates, bad ids and missing fields", () => {
    expect(load({ "./effect/demo.ts": good(), "./effect/demo/index.ts": good() }).problems.join()).toMatch(/duplicate/);
    expect(load({ "./effect/Bad Id.ts": good("Bad Id") }).problems.join()).toMatch(/id/);
    expect(load({ "./effect/demo.ts": { ...good(), description: "" } as PresetModule }).problems.join()).toMatch(/description/);
    expect(load({ "./effect/demo.ts": undefined }).problems.length).toBeGreaterThan(0);
  });
  it("rejects unfilled scaffold placeholders", () => {
    expect(load({ "./effect/demo.ts": { ...good(), category: "TODO" } as PresetModule }).problems.join()).toMatch(/TODO/);
  });
  it("rejects bad params", () => {
    const p = (patch: Partial<ParamSpec>) => ({ ...good(), params: [{ key: "size", label: "Size", type: "number", min: 0, max: 1, step: 0.1, default: 0.5, description: "Size as a fraction of the font size.", ...patch }] }) as PresetModule;
    expect(load({ "./effect/demo.ts": p({ description: undefined }) }).problems.join()).toMatch(/description/);
    expect(load({ "./effect/demo.ts": p({ default: 2 }) }).problems.join()).toMatch(/default|min|max/);
    expect(load({ "./effect/demo.ts": p({ step: 0 }) }).problems.join()).toMatch(/step/);
    expect(load({ "./effect/demo.ts": p({ type: "color", default: "red" }) }).problems.join()).toMatch(/colou?r|#rrggbb/);
  });
  it("rejects a render function that throws and two modules claiming one type", () => {
    expect(load({ "./effect/demo.ts": { ...good(), frame: () => { throw new Error("boom"); } } as PresetModule }).problems.join()).toMatch(/boom|throw/);
    const a = { ...good("a"), type: "shared" } as PresetModule, b = { ...good("b"), type: "shared", frame: (f: PresetFrame) => ({ ...f }) } as PresetModule;
    expect(load({ "./effect/a.ts": a, "./effect/b.ts": b }).problems.join()).toMatch(/type/);
  });
  it("a video effect needs frame or draw", () => {
    const v = defineVideoEffect({ id: "v", name: "V", category: "Test", description: "A video effect without render code." });
    expect(load({ "./videoEffect/v.ts": v }).problems.join()).toMatch(/frame|draw/);
  });
});

describe("registerRenderer with hooks (runtime JSON presets)", () => {
  it("a JSON descriptor can use a registered draw hook", () => {
    const draw = vi.fn();
    registerRenderer("test/hooked", (f) => f, { draw });
    expect(registerPresets([{ kind: "videoEffect", id: "test-hooked", version: 1, name: "Hooked", description: "A runtime hooked effect.", category: "Test", type: "test/hooked", params: [], preview: {} }])).toEqual([]);
    const { ctx } = mockCtx();
    applyEffectFrame(ctx, 64, 36, applyPreset("videoEffect", "test-hooked", 0.5, identityFrame()));
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0][0]).toMatchObject({ w: 64, h: 36, p: 0.5 });
    unregisterPreset("videoEffect", "test-hooked");
  });
});
