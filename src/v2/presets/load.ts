/**
 * Preset module loader (V2-FX-MOD): turns discovered module files into registry descriptors + render functions,
 * validating each one. Pure (no import.meta, no DOM) so tests can feed it fake module maps.
 */
import { identityFrame, PRESET_ID_RE, PRESET_KINDS, type FontDef, type ParamSpec, type PresetDescriptor, type RenderFn, type RenderHooks } from "../registry/types";
import type { ModuleKind, PresetModule } from "./define";

export interface LoadedPresets {
  descriptors: PresetDescriptor[];
  renderers: Record<string, RenderFn>;
  hooks: Record<string, RenderHooks>;
  fonts: FontDef[];
  /** One line per rejected module ("path: reason"). Rejected modules are left out; everything else still loads. */
  problems: string[];
}

const KINDS: readonly ModuleKind[] = [...PRESET_KINDS, "font"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const TEXT_KINDS = ["textAnimIn", "textAnimOut", "textAnimLoop", "effect"];
const isFn = (v: unknown): v is (...a: never[]) => unknown => typeof v === "function";
const str = (v: unknown, min = 1) => typeof v === "string" && v.trim().length >= min;
/** The sticker render function: draws the `svg` param. */
export const stickerRenderer: RenderFn = (f, _p, k) => ({ ...f, svg: typeof k.svg === "string" ? k.svg : "" });
export const noneRenderer: RenderFn = (f) => f;

/** "./videoEffect/glow.ts" or "./videoEffect/glow/index.ts" → { kind, id } from the path. */
export function pathKey(path: string): { kind: string; id: string } | undefined {
  const m = /(?:^|\/)([^/]+)\/([^/]+?)(?:\/index)?\.[cm]?[jt]sx?$/.exec(path);
  return m ? { kind: m[1], id: m[2] } : undefined;
}

export function paramProblems(params: unknown): string[] {
  if (!Array.isArray(params)) return ["params must be an array"];
  const out: string[] = [], keys = new Set<string>();
  for (const q of params as ParamSpec[]) {
    const at = `param "${String(q?.key)}"`;
    if (!q || !str(q.key) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(q.key)) { out.push(`${at}: key must be an identifier`); continue; }
    if (keys.has(q.key)) out.push(`${at}: duplicate key`);
    keys.add(q.key);
    if (!str(q.label)) out.push(`${at}: label is required`);
    if (!str(q.description, 8)) out.push(`${at}: description is required (say what the value means and its unit)`);
    if (q.type === "number") {
      if (![q.min, q.max, q.default].every(Number.isFinite)) out.push(`${at}: min, max and default must be finite numbers`);
      else if (!(q.min <= q.default && q.default <= q.max)) out.push(`${at}: needs min <= default <= max`);
      if (q.step !== undefined && !(Number.isFinite(q.step) && q.step > 0)) out.push(`${at}: step must be > 0`);
    } else if (q.type === "color") { if (typeof q.default !== "string" || !HEX.test(q.default)) out.push(`${at}: colour default must be #rrggbb`); }
    else if (q.type === "string") { if (typeof q.default !== "string") out.push(`${at}: string default must be a string`); }
    else out.push(`${at}: type must be number, color or string`);
  }
  return out;
}

/** Problems of one module (empty = valid). `fonts` = font ids known so far (for textStyle `data.font`). */
export function moduleProblems(m: PresetModule | undefined, path: string, fontIds: Set<string>): string[] {
  if (!m || typeof m !== "object") return ["no default export (export default defineX({...}))"];
  const out: string[] = [], at = pathKey(path);
  if (!KINDS.includes(m.kind)) return [`unknown kind "${String((m as { kind?: unknown }).kind)}"`];
  if (!str(m.id) || !PRESET_ID_RE.test(m.id)) out.push(`id "${String(m.id)}" must match ${PRESET_ID_RE}`);
  if (at && (at.kind !== m.kind || at.id !== m.id)) out.push(`file must live at ${m.kind}/${m.id}.ts (found ${at.kind}/${at.id})`);
  if (m.kind === "font") {
    if (!str(m.label) || !str(m.stack) || !str(m.description, 10) || !(m.width > 0 && m.width < 2)) out.push("font needs label, stack, description and a width in em (0..2)");
    return out;
  }
  if (!str(m.name)) out.push("name is required");
  if (!str(m.category)) out.push("category is required");
  if (!str(m.description, 10)) out.push("description is required (one plain-English line)");
  if (m.version !== undefined && !(Number.isInteger(m.version) && m.version >= 1)) out.push("version must be an integer >= 1");
  if (m.order !== undefined && !Number.isFinite(m.order)) out.push("order must be a number");
  if (m.preview !== undefined && (typeof m.preview !== "object" || m.preview === null)) out.push("preview must be an object");
  const params = "params" in m ? m.params ?? [] : [];
  out.push(...paramProblems(params));
  // Scaffolds (npm run new:preset) leave TODO markers; they must be filled in before the preset ships.
  const texts = [m.name, m.category, m.description, ...(Array.isArray(params) ? params.map((p) => (p as { description?: unknown })?.description) : [])];
  if (texts.some((t) => typeof t === "string" && /\bTODO\b/.test(t))) out.push("replace the TODO placeholders (name, category, description, param descriptions)");
  if (m.ai !== undefined) {
    if (typeof m.ai !== "object" || m.ai === null) out.push("ai must be an object");
    else {
      if ((m.ai.use !== undefined && !str(m.ai.use)) || (m.ai.avoid !== undefined && !str(m.ai.avoid))) out.push("ai.use / ai.avoid must be non-empty strings");
      const keys = new Set((params as ParamSpec[]).map((q) => q.key));
      for (const k of Object.keys(m.ai.example ?? {})) if (!keys.has(k)) out.push(`ai.example: unknown param "${k}"`);
    }
  }
  if (m.kind === "sticker") { if (typeof m.svg !== "string" || !m.svg.trimStart().startsWith("<svg")) out.push("sticker needs svg markup starting with <svg"); }
  else if (m.kind === "textStyle") {
    if (!m.data || typeof m.data !== "object") out.push("textStyle needs data");
    else if (m.data.font !== undefined && !fontIds.has(m.data.font)) out.push(`data.font "${m.data.font}" is not a font id`);
  } else if (m.kind === "videoEffect") {
    if (!isFn(m.frame) && !isFn(m.draw)) out.push("videoEffect needs frame and/or draw");
    if (m.draw !== undefined && !isFn(m.draw)) out.push("draw must be a function");
  } else {
    if (!isFn(m.frame)) out.push("frame (render function) is required");
    if (m.kind === "transition" && m.paint !== undefined && !isFn(m.paint)) out.push("paint must be a function");
  }
  if ((TEXT_KINDS.includes(m.kind) || m.kind === "transition" || m.kind === "videoEffect") && isFn((m as { frame?: unknown }).frame)) {
    try { const f = (m as { frame: RenderFn }).frame(identityFrame(), 0.5, Object.fromEntries((params as ParamSpec[]).map((q) => [q.key, q.default]))); if (!f || typeof f.alpha !== "number") out.push("frame must return a frame ({ ...f, … })"); }
    catch (e) { out.push(`frame threw: ${(e as Error).message}`); }
  }
  return out;
}

/** Load every discovered module. Order within a kind: `order` (missing = after all ordered ones), then id. */
export function loadPresetModules(found: Record<string, { default?: PresetModule } | undefined>): LoadedPresets {
  const problems: string[] = [], renderers: Record<string, RenderFn> = { none: noneRenderer, sticker: stickerRenderer }, hooks: Record<string, RenderHooks> = {};
  const entries = Object.entries(found).map(([path, mod]) => ({ path, m: mod?.default }));
  const fonts: (FontDef & { order?: number })[] = [], fontIds = new Set<string>();
  const seen = new Set<string>(), ok: { path: string; m: Exclude<PresetModule, { kind: "font" }> }[] = [];
  // Fonts first, so textStyle modules can be checked against them.
  for (const { path, m } of [...entries].sort((a, b) => Number(b.m?.kind === "font") - Number(a.m?.kind === "font"))) {
    const bad = moduleProblems(m, path, fontIds);
    const k = m ? `${m.kind}:${m.id}` : path;
    if (!bad.length && seen.has(k)) bad.push(`duplicate id "${m!.id}" in kind ${m!.kind}`);
    if (bad.length) { problems.push(...bad.map((b) => `${path}: ${b}`)); continue; }
    seen.add(k);
    if (m!.kind === "font") { const { kind: _k, ...f } = m!; fonts.push(f); fontIds.add(f.id); }
    else ok.push({ path, m: m! });
  }
  const rank = (o: number | undefined) => (o === undefined ? Number.POSITIVE_INFINITY : o);
  const byOrder = <T extends { order?: number; id: string }>(a: T, b: T) => rank(a.order) - rank(b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  ok.sort((a, b) => byOrder(a.m, b.m));
  const descriptors: PresetDescriptor[] = [];
  for (const { path, m } of ok) {
    let type = "none", params: ParamSpec[] = [], data: Record<string, unknown> | undefined;
    if (m.kind === "sticker") { type = "sticker"; params = [{ key: "svg", label: "SVG", type: "string", default: m.svg, description: "SVG markup of the sticker (200 × 200 viewBox)." }]; }
    else if (m.kind === "textStyle") data = { ...m.data };
    else {
      type = m.type ?? `${m.kind}/${m.id}`;
      params = m.params ?? [];
      const fn: RenderFn = ("frame" in m && m.frame) || noneRenderer;
      const h: RenderHooks = { ...(m.kind === "videoEffect" && m.draw ? { draw: m.draw } : {}), ...(m.kind === "transition" && m.paint ? { paint: m.paint } : {}) };
      if (type in renderers && (renderers[type] !== fn || hooks[type]?.draw !== h.draw || hooks[type]?.paint !== h.paint)) { problems.push(`${path}: type "${type}" is already used by a different render function`); continue; }
      renderers[type] = fn;
      if (h.draw || h.paint) hooks[type] = h;
      if (m.kind === "transition" && m.popular) data = { popular: true };
    }
    descriptors.push({
      id: m.id, kind: m.kind, category: m.category, name: m.name, version: m.version ?? 1, description: m.description,
      type, params, preview: { ...(m.preview ?? {}) }, ...(data ? { data } : {}), ...(m.ai ? { ai: m.ai } : {}),
    });
  }
  fonts.sort(byOrder);
  return { descriptors, renderers, hooks, fonts: fonts.map(({ order: _o, ...f }) => f), problems };
}
