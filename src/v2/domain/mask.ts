/**
 * P49 clip visibility mask. Coordinates are fractions of the full source picture (origin top-left), before crop,
 * transform and preview letterboxing. A mask multiplies that clip's alpha. It is not an effect-scope limit: blurring
 * only part of a frame stays on the Effects track (`applyTo`) and is not faked by cutting the clip away.
 * Tracker box masks (`motionTracks[].mask`) are unchanged.
 *
 * Keyframe times are ticks from the clip start, same as transform keys. Storyboard JSON and WebMCP use seconds;
 * `scaleMaskTimes` converts at that boundary. Path keys are addressed by stable node id, never by index.
 */
import { evalKeys, sourceAt, type Keyframe, type Placement } from "./model";
import { TICKS_PER_SECOND } from "./time";
import { sampleAt, tracksOf, type NamedTrack, type TrackSample } from "./tracking";

export const MASK_SHAPES = ["rect", "ellipse", "linear", "band", "path"] as const;
export type MaskShape = (typeof MASK_SHAPES)[number];
/** Bezier handle offset from its node, in source fractions (x of width, y of height). */
export interface MaskHandle { x: number; y: number }
export interface MaskNode { id: string; x: number; y: number; in?: MaskHandle; out?: MaskHandle }
export type MaskScalar = "feather" | "expand" | "x" | "y" | "w" | "h" | "rotation" | "radius";
export interface MaskKeys {
  feather?: Keyframe[]; expand?: Keyframe[]; x?: Keyframe[]; y?: Keyframe[]; w?: Keyframe[]; h?: Keyframe[];
  rotation?: Keyframe[]; radius?: Keyframe[];
  /** Channels for one node id. A missing id is not interpolated from a neighbour. */
  nodes?: Record<string, Partial<Record<"x" | "y" | "inX" | "inY" | "outX" | "outY", Keyframe[]>>>;
}
export interface ClipMask {
  shape: MaskShape;
  /** false = bypass (the shape is kept, the clip draws unmasked). Absent = on. */
  enabled?: boolean;
  invert?: boolean;
  /** 0–0.5, fraction of the shorter source side. Softened by a box blur, not canvas.filter. */
  feather?: number;
  /** −0.5–0.5, fraction of the shorter source side. Positive grows the kept region. */
  expand?: number;
  /** rect / ellipse / linear / band: centre (linear and band: a point on the line). */
  x?: number; y?: number; w?: number; h?: number;
  /** Degrees clockwise. rect/ellipse spin about their centre; linear/band spin the line (0 = horizontal, keeping the top). */
  rotation?: number;
  /** rect only: corner radius as a fraction of min(w, h), 0–0.5. */
  radius?: number;
  nodes?: MaskNode[];
  /** false while the user is still placing points. A mask that hides the clip must be closed. */
  closed?: boolean;
  /** A tracker on this same clip (id or name). Lost / out of range holds the last found sample and never invents one. */
  trackId?: string;
  /** Sample the authored geometry was aligned to. Absent until the user binds a tracker that has a found frame. */
  trackAnchor?: { x: number; y: number; scale: number };
  trackScale?: boolean;
  keys?: MaskKeys;
}

export const canMask = (p: Pick<Placement, "clipType" | "placeholder"> | undefined): boolean =>
  !!p && !p.placeholder && (p.clipType === "video" || p.clipType === "image" || p.clipType === "html");

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number) => Math.round(v * 1e5) / 1e5;

export function freshNodeId(nodes: Pick<MaskNode, "id">[]): string {
  const ids = new Set(nodes.map((n) => n.id));
  let i = nodes.length + 1;
  while (ids.has(`n${i}`)) i += 1;
  return `n${i}`;
}

export function defaultMask(shape: MaskShape = "rect"): ClipMask {
  if (shape === "path") return { shape, closed: false, nodes: [] };
  if (shape === "linear") return { shape, x: 0.5, y: 0.5, rotation: 0 };
  if (shape === "band") return { shape, x: 0.5, y: 0.5, w: 0.28, rotation: 0 };
  return { shape, x: 0.5, y: 0.5, w: 0.56, h: 0.56, rotation: 0, ...(shape === "rect" ? { radius: 0 } : {}) };
}

/** Issues that make a mask unusable. Empty means it can be stored and rendered. */
export function maskErrors(mask: ClipMask | undefined): string[] {
  if (!mask) return [];
  const out: string[] = [];
  if (!(MASK_SHAPES as readonly string[]).includes(mask.shape)) out.push(`Unknown mask shape ${JSON.stringify(mask.shape)}. Use rect, ellipse, linear, band or path.`);
  const num = (v: number | undefined, name: string, lo: number, hi: number) => {
    if (v === undefined) return;
    if (!finite(v)) out.push(`${name} must be a finite number.`);
    else if (v < lo || v > hi) out.push(`${name} must be between ${lo} and ${hi}.`);
  };
  num(mask.feather, "feather", 0, 0.5);
  num(mask.expand, "expand", -0.5, 0.5);
  num(mask.rotation, "rotation", -3600, 3600);
  if (mask.shape === "rect" || mask.shape === "ellipse") {
    for (const k of ["x", "y", "w", "h"] as const) if (!finite(mask[k])) out.push(`A ${mask.shape} mask needs a finite "${k}".`);
    if (finite(mask.w) && mask.w! <= 0) out.push("Width must be greater than 0.");
    if (finite(mask.h) && mask.h! <= 0) out.push("Height must be greater than 0.");
    num(mask.radius, "radius", 0, 0.5);
  } else if (mask.shape === "linear" || mask.shape === "band") {
    if (!finite(mask.x) || !finite(mask.y)) out.push(`A ${mask.shape} mask needs a finite centre "x" and "y".`);
    if (mask.shape === "band" && (!finite(mask.w) || mask.w! <= 0)) out.push("A band needs a width greater than 0.");
  } else if (mask.shape === "path") {
    const nodes = mask.nodes ?? [];
    if (mask.closed === false) out.push("Close the path first (at least 3 points).");
    else if (nodes.length < 3) out.push("A path needs at least 3 points.");
    const ids = new Set<string>();
    nodes.forEach((n, i) => {
      if (!n.id || ids.has(n.id)) out.push(`Point ${i + 1} needs its own id.`);
      ids.add(n.id);
      if (!finite(n.x) || !finite(n.y)) out.push(`Point ${n.id || i + 1} needs a finite x and y.`);
      for (const h of [n.in, n.out]) if (h && (!finite(h.x) || !finite(h.y))) out.push(`Point ${n.id} has a handle that is not a finite offset.`);
    });
  }
  if (mask.keys?.nodes && mask.shape === "path") {
    const ids = new Set((mask.nodes ?? []).map((n) => n.id));
    for (const id of Object.keys(mask.keys.nodes)) if (!ids.has(id)) out.push(`Keyframe for unknown point "${id}". Path keys use the point's id, not its index.`);
  }
  return out;
}

export interface MaskIssue { level: "error" | "warning"; path: string; message: string }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Parse a storyboard / WebMCP mask. Key times are seconds and stored as ticks. A bad mask is dropped (ok: false). */
export function parseMask(raw: unknown, path = "mask"): { ok: boolean; mask?: ClipMask; issues: MaskIssue[] } {
  const issues: MaskIssue[] = [];
  const warn = (p: string, message: string) => issues.push({ level: "warning", path: p, message });
  const err = (message: string) => issues.push({ level: "error", path, message });
  if (!isObj(raw)) { err('A mask is { "shape": "rect" | "ellipse" | "linear" | "band" | "path", … }.'); return { ok: false, issues }; }
  const shape = raw.shape;
  if (typeof shape !== "string" || !(MASK_SHAPES as readonly string[]).includes(shape)) {
    err(`shape ${JSON.stringify(shape)} must be rect, ellipse, linear, band or path.`);
    return { ok: false, issues };
  }
  const mask: ClipMask = { shape: shape as MaskShape };
  if (raw.enabled === false) mask.enabled = false;
  else if (raw.enabled !== undefined && raw.enabled !== true) warn(`${path}.enabled`, 'enabled must be true or false; ignoring it.');
  if (raw.invert === true) mask.invert = true;
  else if (raw.invert !== undefined && raw.invert !== false) warn(`${path}.invert`, "invert must be true or false; ignoring it.");
  const take = (key: MaskScalar, lo: number, hi: number) => {
    if (raw[key] === undefined) return;
    const n = typeof raw[key] === "number" ? raw[key] as number : Number.NaN;
    if (!finite(n)) warn(`${path}.${key}`, `${key} must be a number; ignoring it.`);
    else if (n < lo || n > hi) warn(`${path}.${key}`, `${key} ${n} is outside ${lo}–${hi}; ignoring it.`);
    else mask[key] = n;
  };
  take("feather", 0, 0.5); take("expand", -0.5, 0.5); take("rotation", -3600, 3600); take("radius", 0, 0.5);
  take("x", -2, 3); take("y", -2, 3); take("w", 0, 4); take("h", 0, 4);
  if ((shape === "rect" || shape === "ellipse") && (!(finite(mask.w) && mask.w! > 0) || !(finite(mask.h) && mask.h! > 0) || !finite(mask.x) || !finite(mask.y))) {
    err(`A ${shape} mask needs "x", "y", "w" and "h" (w and h greater than 0).`);
    return { ok: false, issues };
  }
  if ((shape === "linear" || shape === "band") && (!finite(mask.x) || !finite(mask.y))) { err(`A ${shape} mask needs "x" and "y".`); return { ok: false, issues }; }
  if (shape === "band" && !(finite(mask.w) && mask.w! > 0)) { err('A band mask needs "w" greater than 0.'); return { ok: false, issues }; }
  if (shape === "rect" && mask.radius === undefined) mask.radius = 0;
  if (shape === "linear" || shape === "band") { if (mask.rotation === undefined) mask.rotation = 0; }
  if (shape === "path") {
    if (!Array.isArray(raw.nodes)) { err('A path mask needs "nodes": at least 3 { "id", "x", "y" } points.'); return { ok: false, issues }; }
    if (raw.closed === false) { err("A path mask must be closed. Place at least 3 points and close the path."); return { ok: false, issues }; }
    const nodes: MaskNode[] = [];
    const ids = new Set<string>();
    raw.nodes.forEach((node, i) => {
      const p = `${path}.nodes[${i}]`;
      if (!isObj(node) || !finite(node.x) || !finite(node.y)) { err(`${p} needs a finite "x" and "y".`); return; }
      const id = typeof node.id === "string" && node.id.trim() ? node.id.trim() : "";
      if (!id) { err(`${p} needs an "id" (stable; do not renumber points).`); return; }
      if (ids.has(id)) { err(`${p} repeats id "${id}".`); return; }
      ids.add(id);
      const handle = (h: unknown, name: string): MaskHandle | undefined => {
        if (h === undefined) return undefined;
        if (!isObj(h) || !finite(h.x) || !finite(h.y)) { warn(`${p}.${name}`, `${name} must be { "x", "y" } offsets; ignoring it.`); return undefined; }
        return { x: h.x as number, y: h.y as number };
      };
      const inn = handle(node.in, "in"), outH = handle(node.out, "out");
      nodes.push({ id, x: node.x as number, y: node.y as number, ...(inn ? { in: inn } : {}), ...(outH ? { out: outH } : {}) });
    });
    if (issues.some((i) => i.level === "error")) return { ok: false, issues };
    if (nodes.length < 3) { err("A path needs at least 3 points."); return { ok: false, issues }; }
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    if (Math.max(...xs) - Math.min(...xs) < 1e-4 && Math.max(...ys) - Math.min(...ys) < 1e-4) warn(path, "The path has no area (every point is in the same place). It will hide nothing unless inverted.");
    mask.nodes = nodes;
    mask.closed = true;
  }
  const track = typeof raw.track === "string" ? raw.track : typeof raw.trackId === "string" ? raw.trackId : undefined;
  if ((raw.track !== undefined && typeof raw.track !== "string") || (raw.trackId !== undefined && typeof raw.trackId !== "string")) warn(`${path}.track`, 'track must be the name of a tracker on this clip; ignoring it.');
  else if (track?.trim()) mask.trackId = track.trim().slice(0, 40);
  if (raw.trackScale === true) mask.trackScale = true;
  if (isObj(raw.trackAnchor) && finite(raw.trackAnchor.x) && finite(raw.trackAnchor.y)) mask.trackAnchor = { x: raw.trackAnchor.x as number, y: raw.trackAnchor.y as number, scale: finite(raw.trackAnchor.scale) && (raw.trackAnchor.scale as number) > 0 ? raw.trackAnchor.scale as number : 1 };
  const keys = parseKeys(raw.keys, raw.nodeKeys, `${path}.keys`, issues);
  if (keys) mask.keys = keys;
  if (mask.keys?.nodes && shape === "path") {
    const ids = new Set((mask.nodes ?? []).map((n) => n.id));
    for (const id of Object.keys(mask.keys.nodes)) if (!ids.has(id)) { warn(`${path}.nodeKeys.${id}`, `No point has id "${id}". Keys are by id, not by index; this channel is ignored.`); delete mask.keys.nodes[id]; }
  }
  const bad = maskErrors(mask);
  if (bad.length) { err(bad[0]); return { ok: false, issues }; }
  return { ok: true, mask, issues };
}

function parseKeys(keys: unknown, nodeKeys: unknown, path: string, issues: MaskIssue[]): MaskKeys | undefined {
  const out: MaskKeys = {};
  const seq = (v: unknown, p: string): Keyframe[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) { issues.push({ level: "warning", path: p, message: "A keyframe list is [{ t, v }]; ignoring it." }); return undefined; }
    const ks: Keyframe[] = [];
    v.forEach((k, i) => {
      if (!isObj(k) || !finite(k.t) || !finite(k.v) || (k.t as number) < 0) issues.push({ level: "warning", path: `${p}[${i}]`, message: "A key needs t (seconds, 0 or more) and v (a number); ignoring it." });
      else ks.push({ t: Math.round((k.t as number) * TICKS_PER_SECOND), v: k.v as number });
    });
    ks.sort((a, b) => a.t - b.t);
    return ks.length ? ks : undefined;
  };
  if (keys !== undefined && !isObj(keys)) issues.push({ level: "warning", path, message: 'keys must be { "feather": [{ "t", "v" }], … }; ignoring them.' });
  else if (isObj(keys)) for (const k of ["feather", "expand", "x", "y", "w", "h", "rotation", "radius"] as const) { const s = seq(keys[k], `${path}.${k}`); if (s) out[k] = s; }
  const nk = nodeKeys ?? (isObj(keys) ? keys.nodes : undefined);
  if (nk !== undefined && !isObj(nk)) issues.push({ level: "warning", path: path.replace(/keys$/, "nodeKeys"), message: "nodeKeys must be { pointId: { x: [{ t, v }] } }; ignoring them." });
  else if (isObj(nk)) {
    const nodes: NonNullable<MaskKeys["nodes"]> = {};
    for (const [id, ch] of Object.entries(nk)) {
      if (!isObj(ch)) continue;
      const one: NonNullable<MaskKeys["nodes"]>[string] = {};
      for (const k of ["x", "y", "inX", "inY", "outX", "outY"] as const) { const s = seq(ch[k], `${path}.nodes.${id}.${k}`); if (s) one[k] = s; }
      if (Object.keys(one).length) nodes[id] = one;
    }
    if (Object.keys(nodes).length) out.nodes = nodes;
  }
  return Object.keys(out).length ? out : undefined;
}

const secOf = (t: number) => Math.round((t / TICKS_PER_SECOND) * 1000) / 1000;
const keysOut = (ks: Keyframe[] | undefined) => ks?.map((k) => ({ t: secOf(k.t), v: round(k.v) }));

/** Storyboard / WebMCP form. Key times are seconds. */
export function maskToJson(mask: ClipMask): Record<string, unknown> {
  const o: Record<string, unknown> = { shape: mask.shape };
  if (mask.enabled === false) o.enabled = false;
  if (mask.invert) o.invert = true;
  if (mask.feather) o.feather = round(mask.feather);
  if (mask.expand) o.expand = round(mask.expand);
  for (const k of ["x", "y", "w", "h", "rotation", "radius"] as const) if (mask[k] !== undefined) o[k] = round(mask[k]!);
  if (mask.nodes) o.nodes = mask.nodes.map((n) => ({ id: n.id, x: round(n.x), y: round(n.y), ...(n.in ? { in: { x: round(n.in.x), y: round(n.in.y) } } : {}), ...(n.out ? { out: { x: round(n.out.x), y: round(n.out.y) } } : {}) }));
  if (mask.trackId) o.track = mask.trackId;
  if (mask.trackScale) o.trackScale = true;
  if (mask.trackAnchor) o.trackAnchor = { x: round(mask.trackAnchor.x), y: round(mask.trackAnchor.y), scale: round(mask.trackAnchor.scale) };
  if (mask.keys) {
    const keys: Record<string, unknown> = {};
    for (const k of ["feather", "expand", "x", "y", "w", "h", "rotation", "radius"] as const) { const s = keysOut(mask.keys[k]); if (s) keys[k] = s; }
    if (Object.keys(keys).length) o.keys = keys;
    if (mask.keys.nodes) {
      const nodes: Record<string, unknown> = {};
      for (const [id, ch] of Object.entries(mask.keys.nodes)) {
        const one: Record<string, unknown> = {};
        for (const k of ["x", "y", "inX", "inY", "outX", "outY"] as const) { const s = keysOut(ch[k]); if (s) one[k] = s; }
        if (Object.keys(one).length) nodes[id] = one;
      }
      if (Object.keys(nodes).length) o.nodeKeys = nodes;
    }
  }
  return o;
}

const scaleKeys = (ks: Keyframe[] | undefined, factor: number): Keyframe[] | undefined => ks?.map((k) => ({ t: Math.round(k.t * factor), v: k.v }));

/** Multiply every key time (ticks → seconds uses 1/TICKS_PER_SECOND). Node ids are unchanged. */
export function scaleMaskTimes(mask: ClipMask, factor: number): ClipMask {
  if (!mask.keys) return mask;
  const k = mask.keys;
  const keys: MaskKeys = {};
  for (const name of ["feather", "expand", "x", "y", "w", "h", "rotation", "radius"] as const) { const s = scaleKeys(k[name], factor); if (s) keys[name] = s; }
  if (k.nodes) {
    keys.nodes = {};
    for (const [id, ch] of Object.entries(k.nodes)) {
      const one: NonNullable<MaskKeys["nodes"]>[string] = {};
      for (const name of ["x", "y", "inX", "inY", "outX", "outY"] as const) { const s = scaleKeys(ch[name], factor); if (s) one[name] = s; }
      if (Object.keys(one).length) keys.nodes[id] = one;
    }
  }
  return { ...mask, keys };
}

const numAt = (keys: Keyframe[] | undefined, t: number, base: number | undefined) => evalKeys(keys, t) ?? base;

/** Bake keyframes at a clip offset. Node channels resolve by id; a new point keeps its authored place. */
export function evalMask(mask: ClipMask, offsetTicks: number): ClipMask {
  const k = mask.keys;
  if (!k) return mask;
  const out: ClipMask = { ...mask, x: numAt(k.x, offsetTicks, mask.x), y: numAt(k.y, offsetTicks, mask.y), w: numAt(k.w, offsetTicks, mask.w), h: numAt(k.h, offsetTicks, mask.h), rotation: numAt(k.rotation, offsetTicks, mask.rotation), radius: numAt(k.radius, offsetTicks, mask.radius), feather: numAt(k.feather, offsetTicks, mask.feather), expand: numAt(k.expand, offsetTicks, mask.expand) };
  delete out.keys;
  if (mask.nodes && k.nodes) {
    out.nodes = mask.nodes.map((n) => {
      const ch = k.nodes?.[n.id];
      if (!ch) return { ...n };
      const inn = n.in ?? { x: 0, y: 0 }, outH = n.out ?? { x: 0, y: 0 };
      const hasIn = ch.inX || ch.inY, hasOut = ch.outX || ch.outY;
      return {
        ...n, x: numAt(ch.x, offsetTicks, n.x)!, y: numAt(ch.y, offsetTicks, n.y)!,
        ...(hasIn || n.in ? { in: { x: numAt(ch.inX, offsetTicks, inn.x)!, y: numAt(ch.inY, offsetTicks, inn.y)! } } : {}),
        ...(hasOut || n.out ? { out: { x: numAt(ch.outX, offsetTicks, outH.x)!, y: numAt(ch.outY, offsetTicks, outH.y)! } } : {}),
      };
    });
  }
  return out;
}

/** Shift key times (split's right half). Node ids stay put. */
export function shiftMaskKeys(mask: ClipMask | undefined, by: number): ClipMask | undefined {
  return mask?.keys ? shiftOnly(mask, by) : mask;
}
function shiftOnly(mask: ClipMask, by: number): ClipMask {
  if (!mask.keys) return mask;
  const k = mask.keys;
  const sh = (ks?: Keyframe[]) => ks?.map((x) => ({ ...x, t: x.t + by }));
  const keys: MaskKeys = {};
  for (const name of ["feather", "expand", "x", "y", "w", "h", "rotation", "radius"] as const) { const s = sh(k[name]); if (s) keys[name] = s; }
  if (k.nodes) {
    keys.nodes = {};
    for (const [id, ch] of Object.entries(k.nodes)) {
      const one: NonNullable<MaskKeys["nodes"]>[string] = {};
      for (const name of ["x", "y", "inX", "inY", "outX", "outY"] as const) { const s = sh(ch[name]); if (s) one[name] = s; }
      keys.nodes[id] = one;
    }
  }
  return { ...mask, keys };
}

function trackerOf(p: Placement, id: string): NamedTrack | undefined {
  const q = id.toLowerCase();
  return tracksOf(p).find((t) => t.id === id || t.name.toLowerCase() === q);
}
/** Last found sample at or before `s` once the range has started. Nothing before the range or when every frame is lost. */
export function heldSample(tr: NamedTrack, s: number): TrackSample | undefined {
  if (s < tr.inS) return undefined;
  let best: TrackSample | undefined;
  for (const x of tr.samples) if (!x.lost && x.s >= tr.inS && x.s < tr.outS && x.s <= s) best = x;
  return best;
}

export interface TrackFollow { found: boolean; held: boolean; missing: boolean }
/**
 * Move the baked mask by the tracker's motion since `trackAnchor`. Lost and out-of-range frames hold the last found
 * sample (no invented position). Before the range, or when the feature was never found, the mask stays where it was authored.
 */
export function followTracker(p: Placement, mask: ClipMask, sourceTicks: number): { mask: ClipMask; follow: TrackFollow } {
  if (!mask.trackId) return { mask, follow: { found: false, held: false, missing: false } };
  const tr = trackerOf(p, mask.trackId);
  if (!tr) return { mask, follow: { found: false, held: false, missing: true } };
  const live = sampleAt(tr, sourceTicks);
  const good = live && !live.lost ? live : heldSample(tr, sourceTicks);
  if (!good) return { mask, follow: { found: false, held: false, missing: false } };
  const anchor = mask.trackAnchor ?? { x: good.x, y: good.y, scale: good.scale || 1 };
  const k = mask.trackScale ? (good.scale || 1) / (anchor.scale || 1) : 1;
  return { mask: offsetMask(mask, good.x - anchor.x, good.y - anchor.y, k, anchor), follow: { found: !!live && !live.lost, held: !live || !!live.lost, missing: false } };
}

function offsetMask(mask: ClipMask, dx: number, dy: number, k: number, anchor: { x: number; y: number }): ClipMask {
  const scaleAbout = (x: number, y: number) => ({ x: anchor.x + (x - anchor.x) * k + dx, y: anchor.y + (y - anchor.y) * k + dy });
  if (mask.shape === "path" && mask.nodes) {
    return { ...mask, nodes: mask.nodes.map((n) => {
      const p = scaleAbout(n.x, n.y);
      return { ...n, ...p, ...(n.in ? { in: { x: n.in.x * k, y: n.in.y * k } } : {}), ...(n.out ? { out: { x: n.out.x * k, y: n.out.y * k } } : {}) };
    }) };
  }
  const c = scaleAbout(mask.x ?? 0.5, mask.y ?? 0.5);
  return { ...mask, x: c.x, y: c.y, ...(mask.w !== undefined ? { w: mask.w * k } : {}), ...(mask.h !== undefined ? { h: mask.h * k } : {}) };
}

/** The mask that hides pixels at this frame, or undefined when it should not change the clip. */
export function maskAt(p: Placement, sourceTicks: number, offsetTicks: number): { mask?: ClipMask; follow: TrackFollow } {
  const src = p.mask;
  if (!src || src.enabled === false) return { follow: { found: false, held: false, missing: false } };
  if (src.shape === "path" && src.closed === false) return { follow: { found: false, held: false, missing: false } };
  const baked = evalMask(src, offsetTicks);
  const { mask, follow } = followTracker(p, baked, sourceTicks);
  return { mask, follow };
}

/** Source time the placement shows at absolute `t` (for the sheet and the renderer). */
export const maskSourceTicks = (p: Placement, t: number) => sourceAt(p, t);

// --- geometry edits (the sheet mutates a draft; nothing is stored until Apply) ---

export function withShape(mask: ClipMask, shape: MaskShape): ClipMask {
  const next = defaultMask(shape);
  return { ...next, feather: mask.feather, expand: mask.expand, invert: mask.invert, enabled: mask.enabled, trackId: mask.trackId, trackAnchor: mask.trackAnchor, trackScale: mask.trackScale };
}

export function moveBy(mask: ClipMask, dx: number, dy: number): ClipMask {
  if (mask.shape === "path") return { ...mask, nodes: (mask.nodes ?? []).map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })) };
  return { ...mask, x: (mask.x ?? 0.5) + dx, y: (mask.y ?? 0.5) + dy };
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const shorterOf = (sw: number, sh: number) => Math.max(1, Math.min(sw, sh));
const toU = (nx: number, ny: number, sw: number, sh: number) => { const m = shorterOf(sw, sh); return { x: nx * sw / m, y: ny * sh / m }; };
const fromU = (ux: number, uy: number, sw: number, sh: number) => { const m = shorterOf(sw, sh); return { x: (ux * m) / sw, y: (uy * m) / sh }; };
/** Local axes in shorter-side units so rotation is circular on the picture, not stretched by the aspect. */
export function worldToLocal(mask: ClipMask, nx: number, ny: number, sw = 1, sh = 1): { x: number; y: number } {
  const c = toU(mask.x ?? 0.5, mask.y ?? 0.5, sw, sh), p = toU(nx, ny, sw, sh);
  const th = rad(mask.rotation ?? 0), cs = Math.cos(th), sn = Math.sin(th);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: dx * cs + dy * sn, y: -dx * sn + dy * cs };
}
export function localToWorld(mask: ClipMask, lx: number, ly: number, sw = 1, sh = 1): { x: number; y: number } {
  const c = toU(mask.x ?? 0.5, mask.y ?? 0.5, sw, sh);
  const th = rad(mask.rotation ?? 0), cs = Math.cos(th), sn = Math.sin(th);
  return fromU(c.x + lx * cs - ly * sn, c.y + lx * sn + ly * cs, sw, sh);
}

const CORNER: Record<string, [number, number]> = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] };

/** Drag a corner. The opposite corner of `start` stays put, including when the shape is rotated. `sw`/`sh` are the source pixel size (1,1 in tests). */
export function resizeFromCorner(start: ClipMask, corner: string, nx: number, ny: number, sw = 1, sh = 1): ClipMask {
  const sign = CORNER[corner];
  if (!sign) return start;
  const m = shorterOf(sw, sh);
  const hw = (Math.abs(start.w ?? 0.5) / 2) * sw / m, hh = (Math.abs(start.h ?? 0.5) / 2) * sh / m;
  const opp = { x: -sign[0] * hw, y: -sign[1] * hh };
  const drag = worldToLocal(start, nx, ny, sw, sh);
  const mid = { x: (opp.x + drag.x) / 2, y: (opp.y + drag.y) / 2 };
  const c = localToWorld(start, mid.x, mid.y, sw, sh);
  return { ...start, x: c.x, y: c.y, w: Math.max(0.02, Math.abs(drag.x - opp.x) * m / sw), h: Math.max(0.02, Math.abs(drag.y - opp.y) * m / sh) };
}

export function setRotation(mask: ClipMask, rotation: number): ClipMask {
  return { ...mask, rotation: round(rotation) };
}
/** `w` is the strip thickness as a fraction of the source width, so it keeps the same pixel thickness when rotated. */
export function setBandWidth(start: ClipMask, nx: number, ny: number, sw = 1, sh = 1): ClipMask {
  const local = worldToLocal(start, nx, ny, sw, sh);
  return { ...start, w: Math.max(0.02, Math.abs(local.y) * 2 * shorterOf(sw, sh) / sw) };
}

export function addPoint(mask: ClipMask, x: number, y: number, index?: number): ClipMask {
  const nodes = [...(mask.nodes ?? [])];
  const node: MaskNode = { id: freshNodeId(nodes), x, y };
  const at = index === undefined ? nodes.length : clamp(Math.round(index), 0, nodes.length);
  nodes.splice(at, 0, node);
  return { ...mask, shape: "path", nodes, closed: mask.closed === true && nodes.length >= 3 };
}
export function closePath(mask: ClipMask): { mask: ClipMask; error?: string } {
  if ((mask.nodes ?? []).length < 3) return { mask, error: "Add at least 3 points before closing the path." };
  return { mask: { ...mask, closed: true } };
}
/** Delete one point and its keys. Other points keep their ids and their keys. Refuses to open a closed path. */
export function deletePoint(mask: ClipMask, id: string): { mask: ClipMask; error?: string } {
  const nodes = mask.nodes ?? [];
  if (!nodes.some((n) => n.id === id)) return { mask, error: "That point is not on the path." };
  if (mask.closed !== false && nodes.length <= 3) return { mask, error: "A closed path needs at least 3 points." };
  const next = nodes.filter((n) => n.id !== id);
  const keys = mask.keys?.nodes ? { ...mask.keys, nodes: { ...mask.keys.nodes } } : mask.keys;
  if (keys?.nodes) delete keys.nodes[id];
  return { mask: { ...mask, nodes: next, ...(keys ? { keys } : {}) } };
}
export function movePoint(mask: ClipMask, id: string, x: number, y: number): ClipMask {
  return { ...mask, nodes: (mask.nodes ?? []).map((n) => (n.id === id ? { ...n, x, y } : n)) };
}
/** Set one Bezier handle. `mirror` keeps the other handle opposite (a smooth point) unless it was already a corner. */
export function setHandle(mask: ClipMask, id: string, which: "in" | "out", hx: number, hy: number, mirror = true): ClipMask {
  return { ...mask, nodes: (mask.nodes ?? []).map((n) => {
    if (n.id !== id) return n;
    const h = { x: hx, y: hy };
    const other = which === "in" ? "out" : "in";
    const prev = n[other];
    const smooth = mirror && (!prev || !n[which] || Math.hypot(prev.x, prev.y) < 1e-6 || Math.hypot(n[which]!.x, n[which]!.y) < 1e-6 || prev.x * n[which]!.x + prev.y * n[which]!.y <= 0);
    return { ...n, [which]: h, ...(smooth ? { [other]: { x: -hx, y: -hy } } : {}) };
  }) };
}
export function insertPoint(mask: ClipMask, afterId: string): ClipMask {
  const nodes = mask.nodes ?? [];
  const i = nodes.findIndex((n) => n.id === afterId);
  if (i < 0) return mask;
  const a = nodes[i], b = nodes[(i + 1) % nodes.length];
  return addPoint({ ...mask, nodes }, (a.x + b.x) / 2, (a.y + b.y) / 2, i + 1);
}

/** Record the current geometry as keys at `offsetTicks` (replacing keys at that time). Path channels are per point id. */
export function keyMask(mask: ClipMask, offsetTicks: number): ClipMask {
  const t = Math.round(offsetTicks);
  const put = (ks: Keyframe[] | undefined, v: number | undefined): Keyframe[] | undefined => {
    if (v === undefined) return ks;
    return [...(ks ?? []).filter((k) => Math.abs(k.t - t) > 600), { t, v: round(v) }].sort((a, b) => a.t - b.t);
  };
  const keys: MaskKeys = { ...(mask.keys ?? {}) };
  for (const name of ["feather", "expand", "x", "y", "w", "h", "rotation", "radius"] as const) keys[name] = put(keys[name], mask[name]);
  if (mask.shape === "path" && mask.nodes) {
    const nodes = { ...(keys.nodes ?? {}) };
    for (const n of mask.nodes) {
      const ch = { ...(nodes[n.id] ?? {}) };
      ch.x = put(ch.x, n.x); ch.y = put(ch.y, n.y);
      if (n.in) { ch.inX = put(ch.inX, n.in.x); ch.inY = put(ch.inY, n.in.y); }
      if (n.out) { ch.outX = put(ch.outX, n.out.x); ch.outY = put(ch.outY, n.out.y); }
      nodes[n.id] = ch;
    }
    keys.nodes = nodes;
  }
  return { ...mask, keys };
}

// --- coverage in source space (positive distance is inside; units are fractions of the shorter side) ---

export interface PreparedMask { mask: ClipMask; srcW: number; srcH: number; segs: { x: number; y: number }[] }
const uni = (nx: number, ny: number, srcW: number, srcH: number) => {
  const m = Math.max(1, Math.min(srcW, srcH));
  return { x: nx * srcW / m, y: ny * srcH / m };
};

export function prepareMask(mask: ClipMask, srcW: number, srcH: number): PreparedMask {
  const segs: { x: number; y: number }[] = [];
  if (mask.shape === "path" && mask.closed !== false && (mask.nodes?.length ?? 0) >= 3) {
    const nodes = mask.nodes!;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i], b = nodes[(i + 1) % nodes.length];
      const p0 = uni(a.x, a.y, srcW, srcH);
      const p1 = uni(a.x + (a.out?.x ?? 0), a.y + (a.out?.y ?? 0), srcW, srcH);
      const p2 = uni(b.x + (b.in?.x ?? 0), b.y + (b.in?.y ?? 0), srcW, srcH);
      const p3 = uni(b.x, b.y, srcW, srcH);
      for (let s = 1; s <= 8; s += 1) {
        const t = s / 8, u = 1 - t;
        segs.push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y });
      }
    }
  }
  return { mask, srcW: Math.max(1, srcW), srcH: Math.max(1, srcH), segs };
}

function rotLocal(mask: ClipMask, nx: number, ny: number, srcW: number, srcH: number) {
  const c = uni(mask.x ?? 0.5, mask.y ?? 0.5, srcW, srcH);
  const p = uni(nx, ny, srcW, srcH);
  const th = rad(mask.rotation ?? 0), cs = Math.cos(th), sn = Math.sin(th);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: dx * cs + dy * sn, y: -dx * sn + dy * cs, cx: c.x, cy: c.y, px: p.x, py: p.y };
}

/** Signed distance after expand, in shorter-side fractions. Positive is inside the kept region (before invert). */
export function signedDistance(prep: PreparedMask, nx: number, ny: number): number {
  const { mask, srcW, srcH } = prep;
  const expand = mask.expand ?? 0;
  let sd = -1e6;
  if (mask.shape === "rect" || mask.shape === "ellipse") {
    const L = rotLocal(mask, nx, ny, srcW, srcH);
    const hw = ((mask.w ?? 0) / 2) * srcW / Math.min(srcW, srcH);
    const hh = ((mask.h ?? 0) / 2) * srcH / Math.min(srcW, srcH);
    if (mask.shape === "ellipse") {
      if (hw < 1e-6 || hh < 1e-6) sd = -1e6;
      else {
        const p = Math.hypot(L.x / hw, L.y / hh);
        sd = (1 - p) * Math.min(hw, hh);
      }
    } else {
      const radU = Math.min(hw, hh, (mask.radius ?? 0) * Math.min((mask.w ?? 0) * srcW, (mask.h ?? 0) * srcH) / Math.min(srcW, srcH));
      const qx = Math.abs(L.x) - (hw - radU), qy = Math.abs(L.y) - (hh - radU);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      sd = -(outside + inside - radU);
    }
  } else if (mask.shape === "linear" || mask.shape === "band") {
    const L = rotLocal(mask, nx, ny, srcW, srcH);
    // rotLocal already un-rotates by `rotation`, so the line's kept normal is local +y up, i.e. local y negative? 
    // worldToLocal uses the same matrix. For rotation 0, local y = world dy (y down). Keeping the top means local y <= 0.
    const line = -L.y; // positive above the line (smaller source y)
    sd = mask.shape === "linear" ? line : ((mask.w ?? 0) / 2) * srcW / Math.min(srcW, srcH) - Math.abs(L.y);
  } else if (mask.shape === "path" && prep.segs.length >= 3) {
    const p = uni(nx, ny, srcW, srcH);
    let wind = 0, dist = 1e6;
    const segs = prep.segs;
    for (let i = 0; i < segs.length; i += 1) {
      const a = segs[i], b = segs[(i + 1) % segs.length];
      if ((a.y > p.y) !== (b.y > p.y)) {
        const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y || 1e-12);
        if (x >= p.x) wind += b.y > a.y ? 1 : -1;
      }
      const abx = b.x - a.x, aby = b.y - a.y;
      const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1), 0, 1);
      dist = Math.min(dist, Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)));
    }
    sd = (wind !== 0 ? 1 : -1) * dist;
  }
  return sd + expand;
}

export function maskInside(prep: PreparedMask, nx: number, ny: number): boolean {
  return signedDistance(prep, nx, ny) >= 0;
}

/** Where a source-normalised point lands on the canvas after crop, contain-fit letterbox and the clip transform. */
export function sourceToCanvas(nx: number, ny: number, srcW: number, srcH: number, r: { cx: number; cy: number; w: number; h: number; rot: number; sx: number; sy: number; sw: number; sh: number }): { x: number; y: number } {
  const lx = -r.w / 2 + ((nx * srcW - r.sx) / (r.sw || 1)) * r.w;
  const ly = -r.h / 2 + ((ny * srcH - r.sy) / (r.sh || 1)) * r.h;
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  return { x: r.cx + lx * c - ly * s, y: r.cy + lx * s + ly * c };
}

/** SVG path in source fractions (0–1), for the editor overlay. Empty when there is nothing to draw. */
export function maskSvgPath(mask: ClipMask): string {
  if (mask.shape === "path") {
    const nodes = mask.nodes ?? [];
    if (nodes.length < 2) return "";
    const d = [`M ${nodes[0].x} ${nodes[0].y}`];
    const last = mask.closed === false ? nodes.length - 1 : nodes.length;
    for (let i = 0; i < last; i += 1) {
      const a = nodes[i], b = nodes[(i + 1) % nodes.length];
      d.push(`C ${a.x + (a.out?.x ?? 0)} ${a.y + (a.out?.y ?? 0)} ${b.x + (b.in?.x ?? 0)} ${b.y + (b.in?.y ?? 0)} ${b.x} ${b.y}`);
    }
    if (mask.closed !== false && nodes.length >= 3) d.push("Z");
    return d.join(" ");
  }
  return "";
}
