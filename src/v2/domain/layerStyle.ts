/**
 * Layer styles (V2-103): a text layer can carry a shared style; each clip stores only its overrides.
 * Effective style = DEFAULT_TEXT ← layer style ← clip overrides (clip wins). Same for position/scale.
 */
import { DEFAULT_TEXT, type TextData } from "./text";
import type { Composition, Placement, Track, Transform } from "./model";

export type LayerTextStyle = Partial<Omit<TextData, "text">>;
export type LayerTransform = Partial<Pick<Transform, "x" | "y" | "scale" | "rotation" | "opacity">>;
export interface LayerStyle { text?: LayerTextStyle; transform?: LayerTransform; /** SRT-created layer: gizmo defaults to "Whole layer". */ subtitle?: boolean }

/** Default look of an imported SRT layer: bottom centre, readable caption box. */
export const SUBTITLE_STYLE: LayerStyle = { subtitle: true, text: { size: 0.06, bold: true, color: "#ffffff", align: "center", background: { color: "#000000", opacity: 0.55 } }, transform: { y: 0.38 } };

const TF_KEYS = ["x", "y", "scale", "rotation", "opacity"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The placement as rendered/edited: layer style merged under the clip's own overrides. Non-text or unstyled → unchanged. */
export function effectivePlacement(track: Pick<Track, "layerStyle"> | undefined, p: Placement): Placement {
  const ls = track?.layerStyle;
  if (!ls || p.clipType !== "text") return p;
  const transform = ls.transform ? { ...ls.transform, ...p.transform } as Transform : p.transform;
  return { ...p, text: { ...DEFAULT_TEXT, ...ls.text, ...p.text } as TextData, ...(transform ? { transform } : {}) };
}

/** Effective style value the layer gives a key (without any clip override). */
const layerText = (ls: LayerStyle) => ({ ...DEFAULT_TEXT, ...ls.text }) as Record<string, unknown>;

/** True when a clip on a styled layer has overrides that differ from the layer style. */
export function isCustom(track: Pick<Track, "layerStyle">, p: Placement): boolean {
  const ls = track.layerStyle;
  if (!ls || p.clipType !== "text") return false;
  const lt = layerText(ls);
  for (const [k, v] of Object.entries(p.text ?? {})) if (k !== "text" && !same(v, lt[k])) return true;
  const t = p.transform as Partial<Transform> | undefined;
  if (t) for (const k of TF_KEYS) if (t[k] !== undefined && !same(t[k], ls.transform?.[k] ?? (k === "scale" || k === "opacity" ? 1 : 0))) return true;
  if (t?.crop && (t.crop.l || t.crop.t || t.crop.r || t.crop.b)) return true;
  return false;
}

function strip<T extends object>(o: T | undefined, keys: string[]): T | undefined {
  if (!o) return o;
  const n = { ...o } as Record<string, unknown>;
  for (const k of keys) delete n[k];
  return n as T;
}

/** Bulk edit: merge `patch` into the layer style and drop those keys from every clip's overrides so the edit reaches all clips. */
export function setLayerStyle(comp: Composition, trackId: string, patch: { text?: LayerTextStyle; transform?: LayerTransform }): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const ls = t.layerStyle ?? {};
    const layerStyle: LayerStyle = { ...ls, ...(patch.text ? { text: { ...ls.text, ...patch.text } } : {}), ...(patch.transform ? { transform: { ...ls.transform, ...patch.transform } } : {}) };
    const tk = Object.keys(patch.text ?? {}), fk = Object.keys(patch.transform ?? {});
    return { ...t, layerStyle, placements: t.placements.map((p) => {
      if (p.clipType !== "text") return p;
      const next: Placement = { ...p, text: strip(p.text, tk) };
      if (fk.length && p.transform) {
        const tr = strip(p.transform, fk)!;
        const c = tr.crop;
        const empty = Object.keys(tr).every((k) => k === "crop") && (!c || !(c.l || c.t || c.r || c.b));
        if (empty) delete next.transform; else next.transform = tr;
      }
      return next;
    }) };
  }) };
}

/** Per-clip "Reset to layer style": keep only the clip's words (and keyframes/timing). */
export function resetToLayer(comp: Composition, placementId: string): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => ({ ...t, placements: t.placements.map((p) => {
    if (p.id !== placementId || p.clipType !== "text") return p;
    const { transform: _t, ...rest } = p; void _t;
    return { ...rest, text: { text: p.text?.text ?? "" } as TextData };
  }) })) };
}

/** Number of text clips on a layer. */
export const textClipCount = (t: Track) => t.placements.filter((p) => p.clipType === "text").length;
