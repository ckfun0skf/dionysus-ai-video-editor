/** Preset registry (V2-097): the only source of animation / effect / transition / sticker lists. */
import { BUILTIN_PRESETS } from "./presets";
import { RENDERERS } from "./renderers";
import { identityFrame, PRESET_KINDS, type Params, type PresetDescriptor, type PresetFrame, type PresetKind, type RenderFn } from "./types";
export * from "./types";
export * from "./fonts";
export { RENDERERS } from "./renderers";

/** Preset ids are lowercase-friendly slugs; "@" is reserved for version pins (`ken-burns@2`). */
export const PRESET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const key = (kind: PresetKind, id: string) => `${kind}:${id}`;
const table = new Map<string, PresetDescriptor>();
let version = 0;

/** Validate and add (or replace) descriptors, e.g. parsed from JSON. Returns the ids that were rejected. */
export function registerPresets(list: unknown[]): string[] {
  const bad: string[] = [];
  for (const d of list as PresetDescriptor[]) {
    const ok = d && typeof d.id === "string" && PRESET_ID_RE.test(d.id) && PRESET_KINDS.includes(d.kind) && typeof d.name === "string" && typeof d.type === "string" && d.type in RENDERERS && Array.isArray(d.params ?? [])
      && (d.version === undefined || (Number.isInteger(d.version) && d.version >= 1));
    if (!ok) { bad.push(String((d as { id?: unknown })?.id)); continue; }
    table.set(key(d.kind, d.id), { ...d, version: d.version ?? 1, description: typeof d.description === "string" ? d.description : "", category: d.category ?? "Other", preview: d.preview ?? {}, params: d.params ?? [] });
  }
  version += 1;
  return bad;
}
export function unregisterPreset(kind: PresetKind, id: string) { version += 1; return table.delete(key(kind, id)); }
/** Register a render function for a new descriptor `type` (code side of a new preset). */
export function registerRenderer(type: string, fn: RenderFn) { (RENDERERS as Record<string, RenderFn>)[type] = fn; }
export const registryVersion = () => version;
export function resetPresets() { table.clear(); registerPresets(BUILTIN_PRESETS); }
resetPresets();

export const listPresets = (kind: PresetKind): PresetDescriptor[] => [...table.values()].filter((d) => d.kind === kind);
export const getPreset = (kind: PresetKind, id: string | undefined): PresetDescriptor | undefined => (id ? table.get(key(kind, id)) : undefined);
export const categories = (kind: PresetKind) => [...new Set(listPresets(kind).map((d) => d.category))];
export function defaultsOf(d: PresetDescriptor, over?: Params): Params {
  const out: Params = {};
  for (const p of d.params) out[p.key] = p.default;
  return { ...out, ...over };
}
/** Apply preset `id` of `kind` at progress p (clamped to 0..1) onto frame f. Unknown ids leave f unchanged. */
export function applyPreset(kind: PresetKind, id: string | undefined, p: number, f: PresetFrame = identityFrame(), params?: Params): PresetFrame {
  const d = getPreset(kind, id);
  if (!d) return f;
  const fn = RENDERERS[d.type];
  return fn ? fn(f, Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0)), defaultsOf(d, params)) : f;
}
export const loopPeriod = (id: string | undefined, params?: Params) => { const d = getPreset("textAnimLoop", id); const v = d ? defaultsOf(d, params).period : 1; return typeof v === "number" && v > 0 ? v : 1; };

/** A preset reference as written in a storyboard: `"ken-burns"` or `"ken-burns@2"`. */
export interface PresetRef { id: string; version?: number }
export function parsePresetRef(ref: string): PresetRef | undefined {
  const m = /^([A-Za-z0-9][A-Za-z0-9_.-]*)(?:@(\d+))?$/.exec(ref.trim());
  return m ? { id: m[1], ...(m[2] !== undefined ? { version: Number(m[2]) } : {}) } : undefined;
}
/**
 * Resolve a written reference against the live registry. `@N` always resolves to the current descriptor (old render
 * functions are not kept); `versionMismatch` tells the caller to warn.
 */
export function resolvePresetRef(kind: PresetKind, ref: string | undefined): { descriptor?: PresetDescriptor; ref?: PresetRef; versionMismatch: boolean } {
  const r = ref ? parsePresetRef(ref) : undefined;
  const descriptor = r ? getPreset(kind, r.id) : undefined;
  return { descriptor, ref: r, versionMismatch: !!descriptor && r?.version !== undefined && r.version !== descriptor.version };
}
