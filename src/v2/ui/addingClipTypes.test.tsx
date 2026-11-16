/**
 * P73: the worked example of docs/v2/ADDING_CLIP_TYPES.md ("bars", a colour-bars test card), checked against the real
 * loaders and lookups. `barsCore`, `barsRenderer` and `barsUi` below are the guide's `clipTypes/bars/core.ts`,
 * `render.ts` and `ui.tsx` (keep them in sync with the guide). They are registered for this test file only (vitest
 * isolates module state per file), so the app's built-in list does not change.
 */
import { describe, expect, it } from "vitest";
import { CLIP_TYPES, clipTypeOf, defineClipType, isKnownClipType } from "../clipTypes";
import { loadClipTypeModules } from "../clipTypes/load";
import { placeRect } from "../render/frame";
import { drawWithLook } from "../render/transitionDraw";
import { CLIP_RENDERERS, clipRendererFor, loadClipRenderers, type ClipDrawHost, type ClipRenderer } from "../render/clipRenderers";
import { PLACEHOLDER_RENDERER } from "../render/placeholderSlate";
import { CLIP_TYPE_UIS, clipUi, loadClipTypeUis, type ClipTypeUi } from "./clipTypeUi";
import { canChromaKey, createProject, hasSound, isStill, TEXT_SOURCE, trackKindFor, validateComposition, type MediaKind, type Placement, type Track } from "../domain";

// ---- clipTypes/bars/core.ts ----
const barsCore = defineClipType({
  id: "bars",
  description: "Colour bars: a test card of seven vertical stripes. No media; placed and faded like a photo.",
  trackKind: "video",
  caps: { sourceTime: false, still: true, sound: false, visual: true, keyable: true, thumb: false, asset: "none" },
});

// ---- clipTypes/bars/render.ts ----
const STRIPES = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
const barsRenderer: ClipRenderer = {
  id: "bars",
  draw(h) {
    const { width, height, placement } = h;
    const r = placeRect(placement, width, height, width, height, h.time);
    h.setBox(r);
    h.paint(placement.blend, (dc) => drawWithLook(dc, width, height, h.tfx, (g) => {
      g.save(); g.globalAlpha = r.alpha * (h.mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
      h.blit(g, width, height, r, (gg) => {
        const w = r.w / STRIPES.length;
        STRIPES.forEach((c, i) => { gg.fillStyle = c; gg.fillRect(-r.w / 2 + i * w, -r.h / 2, w + 0.5, r.h); });
      });
      g.restore();
    }));
  },
};

// ---- clipTypes/bars/ui.tsx ----
const barsUi: ClipTypeUi = {
  id: "bars",
  name: () => "Colour bars",
  kindClass: "is-bars",
  thumbBackground: false,
  waveform: () => undefined,
  assetThumb: "none",
  assetPreviews: { peaks: false, filmstrip: false },
  inspectorIcon: "image",
  inspectorTitle: () => "Colour bars",
  inspectorTabs: ["basic", "chroma", "transition"],
  speed: false,
  volume: false,
};

const S = 120_000;
const bars = (over: Partial<Placement> = {}): Placement => ({ id: "b1", startTicks: 0, durationTicks: 3 * S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "bars" as MediaKind, ...over });

describe("ADDING_CLIP_TYPES.md worked example: bars", () => {
  it("is an unknown type until it is registered", () => {
    expect(isKnownClipType("bars")).toBe(false);
    expect(clipTypeOf(bars()).id).toBe("unknown");
    expect(clipRendererFor(bars())?.id).toBe("unknown");
    expect(clipUi(bars()).id).toBe("unknown");
  });

  it("the three modules load without problems (as the globs would load clipTypes/bars/*)", () => {
    const core = loadClipTypeModules({ "./bars/core.ts": { default: barsCore } });
    expect(core.problems).toEqual([]);
    // What the glob in clipTypes/index.ts does for the folder:
    CLIP_TYPES.register(barsCore);
    const r = loadClipRenderers({ "../clipTypes/bars/render.ts": { default: barsRenderer } });
    const u = loadClipTypeUis({ "../clipTypes/bars/ui.tsx": { default: barsUi } });
    expect([r.problems, u.problems]).toEqual([[], []]);
    CLIP_RENDERERS.set("bars", r.renderers.get("bars")!);
    CLIP_TYPE_UIS.set("bars", u.uis.get("bars")!);
  });

  it("then the host uses it everywhere: predicates, track check, renderer, timeline and inspector", () => {
    const p = bars();
    expect(isKnownClipType("bars")).toBe(true);
    expect(clipTypeOf(p)).toBe(barsCore);
    expect([trackKindFor(p.clipType), isStill(p), hasSound(p), canChromaKey(p)]).toEqual(["video", true, false, true]);
    const project = createProject("bars");
    const comp = project.compositions[project.rootCompositionId];
    comp.tracks.find((t) => t.kind === "video")!.placements.push(p);
    expect(validateComposition(comp)).toEqual([]);
    comp.tracks.find((t) => t.kind === "audio")!.placements.push({ ...p, id: "b2" });
    expect(validateComposition(comp)).toEqual(["b2: bars on audio track"]);
    expect(clipRendererFor(p)).toBe(barsRenderer);
    const u = clipUi(p);
    expect([u.id, u.name(p, project), u.inspectorTitle(p, project), u.kindClass, u.inspectorTabs]).toEqual(["bars", "Colour bars", "Colour bars", "is-bars", ["basic", "chroma", "transition"]]);
  });

  it("draws seven stripes inside the clip's box", () => {
    const log: string[] = [];
    const g = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, k) => (typeof k === "string" ? (...a: unknown[]) => { log.push(`${k}(${a.map((x) => (typeof x === "number" ? Math.round(x) : JSON.stringify(x))).join(",")})`); } : undefined),
      set: (_t, k, v) => { log.push(`${String(k)}=${JSON.stringify(v)}`); return true; },
    });
    const host = { g, width: 640, height: 360, time: 0, offline: false, track: { kind: "video" } as Track, placement: bars(), sourceTicks: 0, mix: undefined, tfx: undefined,
      setBox: () => undefined, paint: (_b: unknown, fn: (x: CanvasRenderingContext2D) => void) => fn(g), blit: (_g: unknown, _w: number, _h: number, _r: unknown, fn: (x: CanvasRenderingContext2D) => void) => fn(g) } as unknown as ClipDrawHost;
    barsRenderer.draw!(host);
    expect(log.filter((l) => l.startsWith("fillStyle="))).toEqual(STRIPES.map((c) => `fillStyle="${c}"`));
    expect(log.filter((l) => l.startsWith("fillRect(")).length).toBe(7);
  });

  it("gets the placeholder state for free: a bars placeholder draws the host slate and keeps its type", () => {
    const p = bars({ placeholder: { label: "Shot 1 · test card" } });
    expect(clipTypeOf(p).id).toBe("placeholder");
    expect(clipTypeOf(p).trackKind).toBe("video");
    expect(clipRendererFor(p)).toBe(PLACEHOLDER_RENDERER);
    expect(clipUi(p).id).toBe("placeholder");
    expect(clipUi(p).extraTools).toEqual([]); // bars has no assets, so no Fill
  });
});
